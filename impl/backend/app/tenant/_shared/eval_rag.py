"""AI 評価（idea/concept）の RAG 文脈収集（FR-50・設計 §3/§11）。

採点を**根拠づける**ための文脈注入＝(1) 成果物に紐づく関連情報（info_links・FR-41）、(2) クエストが選んだ
経営資料（strategy_documents・FR-44・方針整合の根拠）を、**要約主体でトークンを抑えて**行化する。
いずれも**graceful**＝収集失敗（テーブル未整備・データ欠損等）でも評価本体を止めない（空を返す）。
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


def strategy_doc_lines(ts: Session, quest_id: uuid.UUID, *, limit: int = 3) -> list[str]:
    """クエストが選んだ経営資料（基準文書）を ISO 構造化項目で行化（fit/方針整合の根拠・FR-44）。"""
    try:
        from app.tenant.strategy import repository as strat_repo
        out: list[str] = []
        for did in strat_repo.doc_ids_for_quest(ts, quest_id)[:limit]:
            d = strat_repo.get_document(ts, did)
            if d is None:
                continue
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
            out.append("- " + " ／ ".join(bits))
        return out
    except Exception:  # noqa: BLE001
        log.warning("strategy_doc_lines failed for quest %s", quest_id, exc_info=True)
        return []
