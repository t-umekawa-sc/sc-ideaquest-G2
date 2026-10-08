"""AI 評価（`task_type=idea_evaluate`）のプロンプト生成と結果適用（FR-50・API設計 F.7）。

ai_jobs ワーカーが実行する。入力は `{idea_id}`（参照のみ＝機微本文の滞留を最小化・F.7.2）。本層が会社DBから
文脈（アイデア本文＋由来クエスト〔＋将来：関連情報・経営資料 embedding〕）を収集してプロンプト化し、構造化
JSON の結果を `evaluations` に `evaluator_kind='ai'`・`status='submitted'`・`visibility='party'` で保存する。

レイヤ＝評価ドメイン（ai_jobs は汎用のまま・idea_evaluate 分岐から本モジュールを遅延 import する）。
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.tenant.evaluations import repository as repo
from app.tenant.evaluations.repository import ASPECTS
from app.tenant.ideas.orm import Idea
from app.tenant.quests.orm import Quest

# 5観点の採点ルーブリック（人間評価と同一＝比較可能性・F.1）。
ASPECT_LABELS: dict[str, str] = {
    "novelty": "新規性（アイデアの目新しさ・独自性）",
    "impact": "影響度（実現した場合のインパクトの大きさ）",
    "feasibility": "実現度（実現可能性の高さ）",
    "fit": "適合性（クエストのテーマ・目的への合致度）",
    "cost": "コスト（低コストほど高得点＝★5 が最も低コスト）",
}


class AiEvalError(ValueError):
    """入力不正・出力パース不能（恒久失敗＝リトライしない）。ai_jobs 側で _PermanentError/failed に変換。"""


def build_messages(ts: Session, idea_id: uuid.UUID) -> list[dict]:
    """評価対象の文脈を会社DBから収集し、構造化JSON を要求するプロンプトを組む（F.7.2・§3）。"""
    idea = ts.get(Idea, idea_id)
    if idea is None or getattr(idea, "deleted_at", None) is not None:
        raise AiEvalError(f"idea not found: {idea_id}")
    quest = ts.get(Quest, idea.quest_id)
    rubric = "\n".join(f"- {k}：{v}（1〜5）" for k, v in ASPECT_LABELS.items())
    schema = (
        '{"scores":[{"aspect":"novelty|impact|feasibility|fit|cost","score":1-5,'
        '"comment":"その観点の採点根拠(日本語・任意)"}],"overall_comment":"全体の総評(日本語)"}'
    )
    system = (
        "あなたは社内の公平なアイデア評価者です。以下のアイデアを5観点で1〜5点で採点し、"
        "各観点に採点根拠、そして全体の総評を日本語で付けてください。\n"
        f"【観点】\n{rubric}\n"
        "※アイデア本文・クエストに無い事実は創作しないでください。"
        f"出力は次の JSON オブジェクトのみ（前後に説明やコードフェンスを付けない）：\n{schema}"
    )
    parts = [f"# アイデア\nタイトル: {idea.title}\n価値: {idea.value}\n本文: {idea.body}"]
    if quest is not None:
        parts.append(f"# 由来クエスト\nタイトル: {quest.title}\n目的・テーマ: {quest.purpose or '—'}")
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def _extract_json(text: str) -> dict:
    """LLM 出力から JSON オブジェクトを取り出す（コードフェンス等の前後ノイズに耐える）。"""
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
    ts: Session, *, idea_id: uuid.UUID, ai_job_id: uuid.UUID, model: str | None,
    editor_id: uuid.UUID | None, text: str,
) -> uuid.UUID:
    """LLM 出力(JSON)を検証して `evaluations` に AI 評価として保存（upsert＋観点スコア置換＋版スナップ）。

    返り値＝evaluation_id。検証失敗は AiEvalError（呼び出し側でジョブ failed）。
    """
    data = _extract_json(text)
    by_aspect: dict[str, tuple[int, str | None]] = {}
    for row in data.get("scores") or []:
        if not isinstance(row, dict):
            continue
        aspect = str(row.get("aspect", "")).strip()
        if aspect not in ASPECTS:
            continue
        try:
            score = int(row.get("score"))
        except (TypeError, ValueError) as exc:
            raise AiEvalError(f"score not an int for {aspect}") from exc
        if score < 1 or score > 5:
            raise AiEvalError(f"score out of range for {aspect}: {score}")
        raw_c = row.get("comment")
        comment = str(raw_c).strip() if raw_c not in (None, "") else None
        by_aspect[aspect] = (score, comment)
    missing = [a for a in ASPECTS if a not in by_aspect]
    if missing:
        raise AiEvalError(f"missing aspects: {missing}")
    overall = str(data.get("overall_comment") or "").strip()
    if not overall:
        raise AiEvalError("overall_comment is empty")

    ev, _created = repo.upsert_ai_evaluation(ts, idea_id, ai_job_id=ai_job_id, model=model, overall_comment=overall)
    ev.submitted_at = datetime.now(timezone.utc)
    repo.replace_scores(ts, ev.id, [(a, by_aspect[a][0], by_aspect[a][1]) for a in ASPECTS])
    # 再生成の履歴＝確定版スナップ（§5.22b・人間評価と同じ変更履歴標準）。editor_id＝再生成の実行者／自動は NULL。
    latest = repo.latest_eval_revision(ts, ev.id)
    next_rev = (latest.revision + 1) if latest is not None else 1
    changes = {
        "scores": {a: by_aspect[a][0] for a in ASPECTS},
        "comments": {a: by_aspect[a][1] for a in ASPECTS if by_aspect[a][1]},
        "overall_comment": overall,
        "visibility": "party",
    }
    repo.add_eval_revision(ts, ev.id, revision=next_rev, editor_id=editor_id, changes=changes)
    return ev.id
