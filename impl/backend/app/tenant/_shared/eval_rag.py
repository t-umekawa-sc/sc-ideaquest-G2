"""AI 評価（idea/concept）の RAG 文脈収集（FR-50・設計 §3/§11）。

採点を**根拠づける**ための文脈注入＝(1) 成果物に紐づく関連情報（info_links・FR-41）、(2) クエストが選んだ
経営資料（strategy_documents・FR-44・方針整合の根拠）を、**要約主体でトークンを抑えて**行化する。
経営資料は**クエスト選択分（admin の明示意図＝権威）を優先**し、空き枠を**成果物に意味的に近い資料の top-k
追補**（entity_embeddings の cosine・A-2 基盤）で埋める＝admin が貼り忘れた関連資料も根拠に載せる。
いずれも**graceful**＝収集失敗（テーブル未整備・データ欠損・埋め込みサーバ不達等）でも評価本体を止めない
（埋め込みが引けなければ選択分のみの現行動作へ縮退）。
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy.orm import Session

log = logging.getLogger("app")
_LINK_JA = {"related": "関連", "supporting": "裏付け", "refuting": "反証"}


def related_info_lines(ts: Session, target_type: str, target_id: uuid.UUID, *, limit: int = 5) -> list[str]:
    """成果物（ideas/concepts）に紐づく関連情報を要約主体で行化。反証（refuting）を先頭に寄せる。"""
    try:
        from app.tenant.info import repository as info_repo
        rows = info_repo.list_links_for_target(ts, target_type, target_id, limit=limit)
        rows = sorted(rows, key=lambda r: 0 if r[0].kind == "refuting" else 1)  # 反証を優先提示（前提を揺さぶる）
        out: list[str] = []
        for lk, it in rows:
            summ = (it.summary or it.body_text or "").strip().replace("\n", " ")[:200]
            out.append(f"- [{_LINK_JA.get(lk.kind, lk.kind)}] {it.title}（影響: {it.impact_class or '—'}）：{summ}")
        return out
    except Exception:  # noqa: BLE001 — RAG は補助＝失敗しても評価本体を止めない
        log.warning("related_info_lines failed for %s/%s", target_type, target_id, exc_info=True)
        return []


def _doc_line(d) -> str:
    """経営資料1件を ISO 構造化項目で1行に要約（fit/方針整合の根拠・FR-44）。"""
    bits = [d.title]
    if d.intent:
        bits.append(f"意図: {d.intent[:120]}")
    if d.policy_commitment:
        bits.append(f"方針: {d.policy_commitment[:120]}")
    if d.strategy:
        bits.append(f"戦略: {d.strategy[:120]}")
    if d.objectives:
        bits.append(f"目標: {d.objectives[:120]}")
    if d.focus_areas:
        bits.append(f"重点領域: {' / '.join(d.focus_areas[:5])}")
    return "- " + " ／ ".join(bits)


def _query_vector(ts: Session, target_type: str | None, target_id: uuid.UUID | None,
                  target_text: str | None, *, model: str) -> list[float] | None:
    """成果物のクエリベクトルを解決。idea=保存済み埋め込み／concept=本文をその場で埋め込み（低頻度・手動）。

    concept は保存埋め込みを持たない（alignment 用途が無く更新も多い）ため、評価時に本文を embed する。
    欠損/サーバ不達は None＝呼び出し側で top-k をスキップ（選択分のみへ縮退）。
    """
    from app.tenant.tokens import repository as tokens_repo
    if target_type == "idea" and target_id is not None:
        return tokens_repo.embedding_for(ts, "idea", target_id, model=model)
    if target_type == "concept" and (target_text or "").strip():
        from app.infra.llm.embeddings import get_embeddings_client
        vecs = get_embeddings_client().embed([target_text])
        return vecs[0] if vecs and vecs[0] else None
    return None


def _topk_doc_ids(ts: Session, query_vec: list[float], exclude: set[uuid.UUID], *,
                  topk: int, min_cos: float, model: str) -> list[uuid.UUID]:
    """成果物ベクトルに cosine が近い経営資料 doc_id を上位 topk（min_cos 以上・exclude 除外）で返す。"""
    from app.infra.llm.embeddings import cosine
    from app.tenant.tokens import repository as tokens_repo
    cands = tokens_repo.embeddings_by_type(ts, "strategy_doc", model=model)
    scored = [
        (did, cosine(query_vec, vec))
        for did, vec in cands.items()
        if did not in exclude
    ]
    scored = [(did, c) for did, c in scored if c >= min_cos]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [did for did, _ in scored[:topk]]


def strategy_doc_lines(ts: Session, quest_id: uuid.UUID, *, target_type: str | None = None,
                       target_id: uuid.UUID | None = None, target_text: str | None = None,
                       limit: int = 3) -> list[str]:
    """クエストが選んだ経営資料＋成果物に意味的に近い top-k 追補を ISO 構造化項目で行化（FR-44・A-2）。

    selected（クエスト選択・admin の明示意図＝権威）を先頭に保ち、`target_*` が与えられ埋め込みが引ければ、
    空き枠を cosine 上位の資料で**追補**（合計 `eval_rag_strategy_total` 上限・重複排除）。target 情報が無い/
    埋め込み不可なら選択分のみ（現行動作）。失敗は graceful（空 or 選択分へ縮退）。
    """
    try:
        from app.core.config import get_settings
        from app.tenant.strategy import repository as strat_repo
        s = get_settings()
        selected = strat_repo.doc_ids_for_quest(ts, quest_id)[:limit]
        ordered: list[uuid.UUID] = list(selected)  # 権威＝先頭
        seen = set(selected)
        # 意味的 top-k 追補（成果物クエリベクトルが引けた時のみ・graceful）。
        if target_type is not None and len(ordered) < s.eval_rag_strategy_total:
            try:
                from app.infra.llm.embeddings import get_embeddings_client
                model = get_embeddings_client().model
                qv = _query_vector(ts, target_type, target_id, target_text, model=model)
                if qv:
                    for did in _topk_doc_ids(ts, qv, seen, topk=s.eval_rag_strategy_topk,
                                             min_cos=s.eval_rag_strategy_min_cosine, model=model):
                        if len(ordered) >= s.eval_rag_strategy_total:
                            break
                        ordered.append(did)
                        seen.add(did)
            except Exception:  # noqa: BLE001 — 追補は任意＝失敗しても選択分で続行
                log.warning("strategy top-k augment failed for %s/%s", target_type, target_id, exc_info=True)
        out: list[str] = []
        for did in ordered:
            d = strat_repo.get_document(ts, did)
            if d is not None:
                out.append(_doc_line(d))
        return out
    except Exception:  # noqa: BLE001
        log.warning("strategy_doc_lines failed for quest %s", quest_id, exc_info=True)
        return []
