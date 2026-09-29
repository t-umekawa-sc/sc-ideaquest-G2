"""整合率（アイデア↔経営資料）の算出・保存・コイン付与（R.2/R.3・§5.55・FR-44）。

SimilarityProvider＝Phase1 はキーワード TF-IDF cosine（`derive.token_cosine`・永続 entity_tokens を読む）。差し替え式
（後続サブStep＝ローカル埋め込み）。母集合＝アイデアの所属クエストが選んだ経営資料（quest_strategy_documents）。
複数資料は**最大採用**＋効いた方針トークンを提示。コイン＝best_score の段階（≥50%→+3／≥70%→+7／≥90%→+15）で
G 台帳に**冪等付与**（初回のみ・下げない・exists_ref）。呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid

from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.info import derive
from app.tenant.strategy import repository as repo
from app.tenant.tokens import repository as tokens_repo

_COIN_REASON = "idea_alignment"
# (しきい値, コイン)＝降順。best_score(0..1) がこの閾値以上で該当ティアのコインを付与（合意 2026-09-29）。
_TIERS: list[tuple[float, int]] = [(0.90, 15), (0.70, 7), (0.50, 3)]
_MATCHED_TOP = 8


def score(a_tokens, b_tokens) -> float:
    """SimilarityProvider（keyword）＝トークン頻度ベクトルの cosine（0..1）。"""
    return derive.token_cosine(a_tokens, b_tokens)


def _matched(a_tokens, b_tokens) -> list[str]:
    """効いた方針トークン＝アイデアと経営資料の重なり語（アイデア側の頻度順・上位）。"""
    bset = {t for t, _ in b_tokens}
    return [t for t, _ in a_tokens if t in bset][:_MATCHED_TOP]


def coins_for(best: float) -> int:
    for th, coins in _TIERS:
        if best >= th:
            return coins
    return 0


def recompute_for_idea(ts, idea, *, award: bool = False) -> float:
    """アイデア×所属クエストの選択経営資料の整合率を再計算・upsert し best を返す。

    `award=True` なら best 段階のコインを**アイデア作成者へ冪等付与**（初回のみ・R.3）。母集合外の行は掃除。
    """
    idea_toks = tokens_repo.tokens_for(ts, "idea", idea.id)
    doc_ids = repo.doc_ids_for_quest(ts, idea.quest_id)
    repo.prune_alignment(ts, idea.id, doc_ids)  # 選択解除された資料の整合行を掃除
    best = 0.0
    for doc_id in doc_ids:
        doc_toks = tokens_repo.tokens_for(ts, "strategy_doc", doc_id)
        s = score(idea_toks, doc_toks)
        repo.upsert_alignment(ts, idea.id, doc_id, score=s, method="keyword",
                              matched_tokens=_matched(idea_toks, doc_toks))
        best = max(best, s)
    if award and best > 0:
        coins = coins_for(best)
        if coins:
            from app.tenant.profile.orm import User
            author = ts.get(User, idea.author_id)
            if author is not None and not gami_repo.exists_ref(
                ts, author.id, ledger.COIN_GAIN, _COIN_REASON, "ideas", idea.id
            ):
                ledger.grant(ts, author, kind=ledger.COIN_GAIN, amount=coins, reason=_COIN_REASON,
                             ref_type="ideas", ref_id=idea.id, quest_id=idea.quest_id)
    return best


def recompute_for_quest(ts, quest_id: uuid.UUID) -> None:
    """クエストの資料選択変更時＝配下の公開アイデアの整合率を再計算（コインは付与し直さない＝維持・R.3）。"""
    from app.tenant.ideas.orm import Idea
    for iid in repo.published_idea_ids_for_quest(ts, quest_id):
        idea = ts.get(Idea, iid)
        if idea is not None:
            recompute_for_idea(ts, idea, award=False)


def alignment_payload(ts, idea) -> dict | None:
    """アイデア詳細/SC-22 バッジ用＝best＋どの方針に効いたか＋効いた語＋獲得コイン。整合行が無ければ None。"""
    rows = repo.alignments_for_idea(ts, idea.id)  # (score, method, matched, doc_id, doc_title)・score 降順
    if not rows:
        return None
    top = rows[0]
    best = float(top[0])
    coin_row = gami_repo.get_ref_activity(ts, idea.author_id, ledger.COIN_GAIN, _COIN_REASON, "ideas", idea.id)
    return {
        "best_score": round(best, 3),
        "best_strategy": {"id": str(top[3]), "title": top[4]},
        "matched_tokens": top[2] or [],
        "tier_coins": coins_for(best),
        "coins_awarded": int(coin_row.amount) if coin_row else 0,
        "documents": [
            {"id": str(r[3]), "title": r[4], "score": round(float(r[0]), 3), "matched_tokens": r[2] or []}
            for r in rows
        ],
    }
