"""経営資料の AI 用 Markdown エクスポート（R.5・生成は外部委譲）。

経営資料本体＋関連度上位のアイデア＋関連情報（機会/脅威ラベル付き）＋関連コンセプトを、ISO56001 の項目立てに
沿った構造化 Markdown に束ねる。**生成（意図/戦略/方針のたたき台）は利用者が任意の LLM に貼って行う**＝サーバーは
外部送信しない（データ主権・§10）。集計は決定的（整合率キャッシュ＋トークン重なり）。
"""
from __future__ import annotations

from app.tenant.concepts import repository as concept_repo
from app.tenant.info import derive
from app.tenant.strategy import repository as repo
from app.tenant.tokens import repository as tokens_repo

_KIND_LABEL = {"midterm_plan": "中期計画", "policy": "方針", "strategy": "戦略", "other": "その他"}
_IMPACT_LABEL = {"opportunity": "機会", "threat": "脅威", "other": "その他"}
_TOP_IDEAS = 10
_TOP_INFO = 20
_TOP_CONCEPTS = 10


def _cell(s) -> str:
    """Markdown テーブルセルの安全化（改行→空白・パイプはエスケープ）。"""
    return str(s or "").replace("\n", " ").replace("\r", " ").replace("|", "\\|").strip()


def _pct(score) -> str:
    return f"{round(float(score) * 100)}%"


def _section(title: str, body: str | None) -> str:
    return f"## {title}\n\n{(body or '').strip() or '（未記入）'}\n"


def _related_concepts(ts, doc, company, *, limit: int = _TOP_CONCEPTS) -> list[tuple[str, float]]:
    """当該資料とトークン関連度が閾値以上のコンセプト＝(title, score)（score 降順・上位 limit）。"""
    from app.tenant.info import application as info_app

    threshold = info_app.auto_link_threshold_of(company)
    doc_tokens = tokens_repo.tokens_for(ts, "strategy_doc", doc.id)
    if not doc_tokens:
        return []
    scored = []
    for cid, toks in tokens_repo.all_tokens_by_type(ts, "concept").items():
        s = derive.token_cosine(doc_tokens, toks)
        if s >= threshold:
            scored.append((cid, round(s, 3)))
    scored.sort(key=lambda x: x[1], reverse=True)
    scored = scored[:limit]
    titles = concept_repo.titles_for_ids(ts, [cid for cid, _ in scored])  # 非削除のみ
    return [(titles[cid], s) for cid, s in scored if cid in titles]


def _table(header: list[str], rows: list[list[str]], *, empty: str = "（該当なし）") -> str:
    if not rows:
        return empty + "\n"
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def build_markdown(ts, doc, company, related_info: list[dict]) -> str:
    """経営資料＋関連（アイデア/情報/コンセプト）を構造化 Markdown に束ねて返す（R.5）。"""
    kind = _KIND_LABEL.get(doc.doc_kind, doc.doc_kind)
    parts: list[str] = [f"# {doc.title}\n"]
    meta = [f"- 種別: {kind}"]
    if doc.period_from or doc.period_to:
        meta.append(f"- 対象期間: {doc.period_from or ''} 〜 {doc.period_to or ''}")
    parts.append("\n".join(meta) + "\n")
    parts.append("> ISO 56001 準拠の経営資料エクスポート（AI 用の下書き素材）。"
                 "意図/戦略/方針のたたき台生成は任意の LLM に貼ってご利用ください（本アプリは外部送信しません）。\n")

    parts.append(_section("1. イノベーションの意図・ビジョン（ISO 4/5.1）", doc.intent))
    parts.append(_section("2. イノベーション方針・コミットメント（ISO 5.2）", doc.policy_commitment))
    parts.append(_section("3. 戦略・方向性（ISO 6.1）", doc.strategy))
    focus = "\n".join(f"- {f}" for f in (doc.focus_areas or [])) or "（未記入）"
    parts.append(f"## 4. 重点領域\n\n{focus}\n")
    parts.append(_section("5. イノベーション目標（ISO 6.2）", doc.objectives))
    if (doc.body_md or "").strip():
        parts.append(_section("6. 補足・全文", doc.body_md))

    ideas = repo.ideas_for_doc(ts, doc.id, limit=_TOP_IDEAS)
    parts.append("## 7. 関連度上位のアイデア\n\n" + _table(
        ["アイデア", "整合率"], [[_cell(t), _pct(s)] for _iid, t, s in ideas]))

    parts.append("## 8. 関連情報（機会/脅威）\n\n" + _table(
        ["情報", "分類", "関連度"],
        [[_cell(r["title"]), _IMPACT_LABEL.get(r["impact_class"], "—"), _pct(r["score"])]
         for r in related_info[:_TOP_INFO]]))

    concepts = _related_concepts(ts, doc, company)
    parts.append("## 9. 関連コンセプト\n\n" + _table(
        ["コンセプト", "関連度"], [[_cell(t), _pct(s)] for t, s in concepts]))

    return "\n".join(parts).strip() + "\n"
