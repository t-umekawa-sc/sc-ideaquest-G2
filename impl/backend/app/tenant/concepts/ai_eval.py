"""コンセプト AI 評価（`task_type=concept_evaluate`）のプロンプト生成と結果適用（FR-50・API設計 P.5a・設計 §11）。

アイデア評価（`evaluations/ai_eval.py`）と同型だが、コンセプト固有＝**8観点（中核5＋補助3）＋Go/Pivot/Kill 推奨**、
RAG に**前提(assumptions)と検証結果(current_verdict)**を含む。**起動は手動のみ**（自動起動しない・設計 §11）。
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.tenant._shared import prompt_safety
from app.tenant.concepts import repository as repo
from app.tenant.concepts.orm import Concept
from app.tenant.concepts.repository import ALL_ASPECTS, CORE_ASPECTS
from app.tenant.ideas.orm import Idea

ASPECT_LABELS: dict[str, str] = {
    "desirability": "望ましさ（ユーザー/市場が本当に欲しいか）",
    "feasibility": "実現可能性（技術・運用で作れるか）",
    "viability": "採算・事業性（コスト/収益/ROI が成り立つか）",
    "assumption_strength": "前提検証の強さ（証拠で前提がどれだけ支持されているか）",
    "differentiation": "差別化（競合に対する優位）",
    "novelty": "新規性",
    "sustainability": "持続可能性",
    "ip": "知的財産",
}
_REC = ("go", "pivot", "kill")


class AiEvalError(ValueError):
    """入力不正・出力パース不能（恒久失敗＝リトライしない）。"""


def build_messages(ts: Session, concept_id: uuid.UUID) -> list[dict]:
    """コンセプト本体＋由来アイデア＋前提/検証を収集し、8観点＋Go/Pivot/Kill の構造化JSON を要求（設計 §11）。"""
    c = ts.get(Concept, concept_id)
    if c is None or c.deleted_at is not None:
        raise AiEvalError(f"concept not found: {concept_id}")
    rubric = "\n".join(f"- {k}：{v}（1〜5）" for k, v in ASPECT_LABELS.items())
    schema = (
        '{"scores":[{"aspect":"desirability|feasibility|viability|assumption_strength|differentiation|novelty|'
        'sustainability|ip","score":1-5,"comment":"採点根拠(日本語・任意)"}],'
        '"recommendation":"go|pivot|kill","overall_comment":"総評(日本語)"}'
    )
    system = (
        "あなたは社内の公平なコンセプト評価者です（ISO56001 の②創造・③検証段）。以下のコンセプトを8観点で"
        "1〜5点で採点し、各観点に根拠、全体の総評、そして Go（推進）/Pivot（方向転換）/Kill（中止）の推奨を"
        "日本語で付けてください。\n"
        f"【観点】\n{rubric}\n"
        "※前提の検証結果（支持/反証/保留）を『前提検証の強さ』採点の根拠にしてください。コンセプトに無い事実は"
        f"創作しないでください。出力は次の JSON オブジェクトのみ（前後に説明やコードフェンスを付けない）：\n{schema}\n"
        f"{prompt_safety.DATA_NOTICE}"
    )
    parts = [
        "# コンセプト",
        f"タイトル: {c.title}",
        f"課題・機会: {c.problem or '—'}",
        f"狙う価値: {c.value_proposition or '—'}",
        f"対象: {c.target or '—'}",
        f"競合・差別化: {c.differentiation or '—'}",
        f"解の形態: {c.solution_form or '—'}",
    ]
    # 由来アイデア（タイトル）。
    src_ids = repo.list_source_idea_ids(ts, concept_id)
    titles = [i.title for i in (ts.get(Idea, sid) for sid in src_ids) if i is not None]
    if titles:
        parts.append("# 由来アイデア\n" + "\n".join(f"- {t}" for t in titles))
    # 前提と検証（current_verdict）。
    links = repo.list_links_for_concept(ts, concept_id)
    arows = []
    for lk in links:
        a = repo.get_assumption(ts, lk.assumption_id)
        if a is not None:
            arows.append(f"- {a.statement}（検証結果: {a.current_verdict}）")
    if arows:
        parts.append("# 前提と検証\n" + "\n".join(arows))
    # RAG＝関連情報（FR-41）＋経営資料（FR-44・viability/差別化の根拠）。要約主体・graceful（§11）。
    from app.tenant._shared import eval_rag
    info_lines = eval_rag.related_info_lines(ts, "concepts", concept_id)
    if info_lines:
        parts.append("# 関連情報（外部情報の知識レイヤ・反証を優先提示）\n" + "\n".join(info_lines))
    # concept は保存埋め込みを持たないため、本文（主要項目）を top-k クエリ用テキストとして渡す（その場 embed）。
    concept_text = " ".join(x for x in (c.title, c.problem, c.value_proposition,
                                        c.target, c.differentiation, c.solution_form) if x)
    strat_lines = eval_rag.strategy_doc_lines(ts, c.quest_id, target_type="concept",
                                              target_id=concept_id, target_text=concept_text)
    if strat_lines:
        parts.append("# 経営資料（方針との整合の根拠）\n" + "\n".join(strat_lines))
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt_safety.wrap_as_data("\n".join(parts))},
    ]


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", (text or "").strip(), re.S)
    if not m:
        raise AiEvalError("no JSON object in output")
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise AiEvalError(f"invalid JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise AiEvalError("output is not a JSON object")
    return obj


def apply_result(
    ts: Session, *, concept_id: uuid.UUID, ai_job_id: uuid.UUID, model: str | None,
    editor_id: uuid.UUID | None, text: str,
) -> uuid.UUID:
    """LLM 出力(JSON)を検証して `concept_evaluations` に AI 評価として保存（中核5必須＋recommendation 必須）。"""
    data = _extract_json(text)
    by_aspect: dict[str, tuple[int, str | None]] = {}
    for row in data.get("scores") or []:
        if not isinstance(row, dict):
            continue
        aspect = str(row.get("aspect", "")).strip()
        if aspect not in ALL_ASPECTS:
            continue
        try:
            score = int(row.get("score"))
        except (TypeError, ValueError) as exc:
            raise AiEvalError(f"score not an int for {aspect}") from exc
        if score < 1 or score > 5:
            raise AiEvalError(f"score out of range for {aspect}: {score}")
        raw_c = row.get("comment")
        by_aspect[aspect] = (score, str(raw_c).strip() if raw_c not in (None, "") else None)
    missing = [a for a in CORE_ASPECTS if a not in by_aspect]  # 中核5は必須・補助3は任意
    if missing:
        raise AiEvalError(f"missing core aspects: {missing}")
    recommendation = str(data.get("recommendation") or "").strip().lower()
    if recommendation not in _REC:
        raise AiEvalError(f"invalid recommendation: {recommendation!r}")
    overall = str(data.get("overall_comment") or "").strip()
    if not overall:
        raise AiEvalError("overall_comment is empty")

    ev, _created = repo.upsert_ai_evaluation(
        ts, concept_id, ai_job_id=ai_job_id, model=model, overall_comment=overall, recommendation=recommendation,
    )
    ev.submitted_at = datetime.now(timezone.utc)
    repo.replace_scores(ts, ev.id, [(a, by_aspect[a][0], by_aspect[a][1]) for a in ALL_ASPECTS if a in by_aspect])
    latest = repo.latest_eval_revision(ts, ev.id)
    next_rev = (latest.revision + 1) if latest is not None else 1
    changes = {
        "scores": {a: by_aspect[a][0] for a in ALL_ASPECTS if a in by_aspect},
        "comments": {a: by_aspect[a][1] for a in ALL_ASPECTS if a in by_aspect and by_aspect[a][1]},
        "overall_comment": overall,
        "recommendation": recommendation,
        "visibility": "party",
    }
    repo.add_eval_revision(ts, ev.id, revision=next_rev, editor_id=editor_id, changes=changes)
    return ev.id
