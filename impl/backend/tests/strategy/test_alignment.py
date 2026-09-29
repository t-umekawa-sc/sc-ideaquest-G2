"""整合率＋コイン（R.2/R.3・§5.55・FR-44）＝キーワード cosine で best 算出→段階コイン（初回のみ）。

直接シード（test_auto_link と同型）で recompute_for_idea を呼び、idea_alignment・best・コイン付与を検証する
（full publish フローは teardown FK が重いため）。cosine([脱炭素3,水素2],[脱炭素5,水素1])≈0.924≥0.9→+15。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.gamification.orm import Activity
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.quests.orm import Quest
from app.tenant.strategy import alignment as strat_align
from app.tenant.strategy.orm import IdeaAlignment, QuestStrategyDocument, StrategyDocument
from app.tenant.tokens.orm import EntityToken
from tests.conftest import SEED_COMPANY_CODE


def _seed_db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def test_r_tc_201_alignment_best_and_coin():
    """R-TC-201 整合率＝母集合(クエストの選択資料)で cosine を算出し best・効いた語を保存／best 段階でコイン初回付与。"""
    db = _seed_db()
    owner, qid, iid, did = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="整合test作者", locale="ja", status="active"))
            ts.flush()
            ts.add(Quest(id=qid, owner_id=owner, title="整合testクエスト", color="#0D9488", status="recruiting"))
            ts.add(StrategyDocument(id=did, title="脱炭素方針", doc_kind="policy", created_by_id=owner,
                                    body_text="脱炭素 水素 再生可能エネルギー", status="active"))
            ts.flush()  # quest/doc の id を確定（idea.quest_id・link の FK に使う）
            ts.add(Idea(id=iid, quest_id=qid, author_id=owner, title="脱炭素アイデア", body="本文", value="v", status="published"))
            ts.add(QuestStrategyDocument(id=uuid.uuid4(), quest_id=qid, strategy_document_id=did))
            # 永続トークン（cosine≈0.924）。
            ts.add(EntityToken(owner_type="idea", owner_id=iid, token="脱炭素", count=3))
            ts.add(EntityToken(owner_type="idea", owner_id=iid, token="水素", count=2))
            ts.add(EntityToken(owner_type="strategy_doc", owner_id=did, token="脱炭素", count=5))
            ts.add(EntityToken(owner_type="strategy_doc", owner_id=did, token="水素", count=1))
            ts.commit()

        with get_tenant_session(db) as ts:
            idea = ts.get(Idea, iid)
            best = strat_align.recompute_for_idea(ts, idea, award=True)
            ts.commit()
            assert best >= 0.9, f"高い重なりで best が高い（{best}）"

        with get_tenant_session(db) as ts:
            idea = ts.get(Idea, iid)
            # idea_alignment に行＋効いた語。
            rows = ts.execute(
                IdeaAlignment.__table__.select().where(IdeaAlignment.idea_id == iid)
            ).all()
            assert len(rows) == 1
            payload = strat_align.alignment_payload(ts, idea)
            assert payload is not None
            assert payload["best_strategy"]["id"] == str(did)
            assert "脱炭素" in payload["matched_tokens"]
            assert payload["best_score"] >= 0.9
            # コイン＝best≥0.9→+15（初回のみ）。
            assert payload["coins_awarded"] == 15
            assert gami_repo.exists_ref(ts, owner, ledger.COIN_GAIN, "idea_alignment", "ideas", iid)

        # 2回目の recompute でコインは増えない（冪等・初回のみ）。
        with get_tenant_session(db) as ts:
            idea = ts.get(Idea, iid)
            strat_align.recompute_for_idea(ts, idea, award=True)
            ts.commit()
        with get_tenant_session(db) as ts:
            coins = ts.execute(
                Activity.__table__.select().where(Activity.user_id == owner, Activity.reason == "idea_alignment")
            ).all()
            assert len(coins) == 1, "コインは初回のみ（冪等）"
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(IdeaAlignment.__table__.delete().where(IdeaAlignment.idea_id == iid))
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_id.in_([iid, did])))
            ts.execute(QuestStrategyDocument.__table__.delete().where(QuestStrategyDocument.quest_id == qid))
            ts.execute(Activity.__table__.delete().where(Activity.user_id == owner))
            ts.execute(Idea.__table__.delete().where(Idea.id == iid))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()
