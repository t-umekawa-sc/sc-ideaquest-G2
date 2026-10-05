"""I-TC-131/141/142/143: ダッシュボードの横断 read（D/F）と best-effort 合成（I.3/I.4）。

141/142/143＝ドメイン D/F の repository を会社DB に直接 seed して横断 read の絞りを検証（int）。
131＝`get_dashboard()` の1パネル合成が例外でも全体は落とさず当該パネル null（best-effort・I.4）。
production コードは変更しない（実装済みの振る舞いへの純テスト）。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as evals_repo
from app.tenant.evaluations.orm import Evaluation, EvaluationScore
from app.tenant.ideas import repository as ideas_repo
from app.tenant.ideas.orm import Idea, Vote
from app.tenant.profile.orm import User
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.conftest import SEED_COMPANY_CODE
from tests.dashboard.test_api import _db, _login_dash


@pytest.fixture
def tenant():
    """会社DB に quest＋自分＝member・下書き/公開アイデア・投票・下書き/確定評価を seed（横断 read 検証）。"""
    db = _db()
    gid, qid = uuid.uuid4(), uuid.uuid4()
    me = uuid.uuid4()
    draft_i, pub_mine, pub_a, pub_b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=me, account_id=uuid.uuid4(), display_name="Me", locale="ja", status="active"))
        quests_repo.create_quest(ts, quest_id=qid, owner_id=me, title="Q", color="#3B82F6", status="recruiting")
        quests_repo.add_member(ts, qid, me, permissions=["owner", "vote"])
        qg_repo.upsert_membership(ts, gid, me, "member")
        ts.add(Idea(id=draft_i, quest_id=qid, author_id=me, title="下書き", body="b", value="v", status="draft"))
        ts.add(Idea(id=pub_mine, quest_id=qid, author_id=me, title="公開自作", body="b", value="v", status="published"))
        ts.add(Idea(id=pub_a, quest_id=qid, author_id=me, title="公開A", body="b", value="v", status="published"))
        ts.add(Idea(id=pub_b, quest_id=qid, author_id=me, title="公開B", body="b", value="v", status="published"))
        ts.flush()
        ts.add(Vote(id=uuid.uuid4(), idea_id=pub_a, user_id=me, type="approve", voted_revision=1))  # A に投票（→未投票から除外）
        ev, _ = evals_repo.upsert_evaluation(ts, pub_a, me, overall_comment=None, status="draft", visibility="party")
        evals_repo.replace_scores(ts, ev.id, [("novelty", 4, None), ("impact", 3, None)])  # 下書き評価 scored=2
        evals_repo.upsert_evaluation(ts, pub_b, me, overall_comment=None, status="submitted", visibility="party")  # 確定＝除外対象
        ts.commit()

    yield SimpleNamespace(db=db, me=me, qid=qid, draft_i=draft_i, pub_mine=pub_mine, pub_a=pub_a, pub_b=pub_b)

    with get_tenant_session(db) as ts:
        idea_ids = [draft_i, pub_mine, pub_a, pub_b]
        ev_ids = [e.id for e in ts.execute(select(Evaluation).where(Evaluation.idea_id.in_(idea_ids))).scalars()]
        if ev_ids:
            ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(ev_ids)))
            ts.execute(Evaluation.__table__.delete().where(Evaluation.id.in_(ev_ids)))
        ts.execute(Vote.__table__.delete().where(Vote.idea_id.in_(idea_ids)))
        ts.execute(Idea.__table__.delete().where(Idea.id.in_(idea_ids)))
        ts.execute(QuestMemberPermission.__table__.delete().where(
            QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == gid))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
        ts.execute(User.__table__.delete().where(User.id == me))
        ts.commit()


def test_i_tc_141_draft_ideas_by_author(tenant):
    """I-TC-141 本人下書きアイデア（全クエスト横断）＝下書きのみ・公開は除外（author=自分・D 横断 read）。"""
    with get_tenant_session(tenant.db) as ts:
        ids = {i.id for i in ideas_repo.list_draft_ideas_by_author(ts, tenant.me)}
    assert ids == {tenant.draft_i}  # 下書きのみ（公開自作/A/B は含まない）


def test_i_tc_142_unvoted_published_ideas(tenant):
    """I-TC-142 参加クエストの published で自票なしのみ（A は投票済み→除外・下書きは published でない→除外）。"""
    with get_tenant_session(tenant.db) as ts:
        ids = {i.id for i in ideas_repo.list_unvoted_published_ideas(ts, tenant.me, [tenant.qid], limit=50)}
    assert tenant.pub_b in ids and tenant.pub_mine in ids  # 未投票の published
    assert tenant.pub_a not in ids                          # 投票済みは除外
    assert tenant.draft_i not in ids                        # 下書きは除外


def test_i_tc_143_draft_evaluations_by_evaluator(tenant):
    """I-TC-143 本人下書き評価（全アイデア横断）＝下書きのみ・進捗 scored/5（確定 submitted は除外）。"""
    with get_tenant_session(tenant.db) as ts:
        evs = evals_repo.list_draft_evaluations_by_evaluator(ts, tenant.me)
        assert len(evs) == 1 and evs[0].idea_id == tenant.pub_a  # 下書きのみ（B の submitted は除外）
        assert len(evals_repo.list_scores(ts, evs[0].id)) == 2   # 進捗 scored=2/5


def test_i_tc_131_partial_failure_best_effort(client, factory, monkeypatch):
    """I-TC-131 1パネルの合成が例外でも全体は落とさず当該パネルのみ null（best-effort・I.4）。"""
    from app.tenant.dashboard import application as dash_app

    acc, _uid = _login_dash(client, factory)  # 会社DB の user ミラーを保証
    with control_session() as s:
        company_id = str(s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id)

    def _boom(*a, **k):
        raise RuntimeError("panel down")

    monkeypatch.setattr(dash_app.gami_app, "get_rankings", _boom)  # 週間ランキング合成を故障させる
    result = dash_app.get_dashboard({"account_id": str(acc["id"]), "company_id": company_id})
    assert result["weekly_ranking"] is None  # 例外パネルは null（default）
    assert result["hero"] is not None        # 他パネルは正常
    assert "notifications" in result and "drafts" in result  # 全体は例外送出せず返る（200 相当）


def test_i_tc_163_dashboard_includes_approved_contest():
    """I-TC-163(int): 議論/未投票スコープに参加承認済みコンテストの backing quest を含む・未参加は含まない（FR-46 統合）。"""
    from app.tenant.contests import repository as contest_repo
    from app.tenant.dashboard import application as dash
    db = _db()
    me, other = uuid.uuid4(), uuid.uuid4()
    cqid, iid = uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(User(id=me, account_id=uuid.uuid4(), display_name="参加者", locale="ja", status="active"))
        ts.add(User(id=other, account_id=uuid.uuid4(), display_name="投稿者", locale="ja", status="active"))
        # 承認制コンテスト＋backing quest（器）＋公開アイデア（作者=other）。
        quests_repo.create_quest(ts, quest_id=cqid, owner_id=other, title="コンテスト器", color="#6366F1", status="recruiting")
        ts.flush()
        c = contest_repo.create(ts, quest_id=cqid, theme="統合テスト", description=None, mode="bounded",
                                status="open", starts_at=None, ends_at=None, auto_archive_days=None,
                                prize_config=None, created_by_id=other, auto_approve=False)
        ts.add(Idea(id=iid, quest_id=cqid, author_id=other, title="コンテスト案", body="b", value="v", status="published"))
        contest_repo.upsert_contest_participation(ts, c.id, me, status="approved")  # me＝参加承認済み
        ts.commit()
        cid = c.id
    try:
        with get_tenant_session(db) as ts:
            user = ts.get(User, me)
            # 承認済み me＝scope に backing quest を含み、未投票に当該アイデアが出る。
            assert cqid in contest_repo.approved_participation_quest_ids(ts, me)
            assert cqid in dash._scope_quest_ids(ts, user)
            assert any(u["id"] == str(iid) for u in dash._unvoted(ts, user))
            # 未参加ユーザー（me2）＝scope に含まない。
            assert cqid not in dash._scope_quest_ids(ts, SimpleNamespace(id=uuid.uuid4()))
    finally:
        from sqlalchemy import text as _sqltext
        with get_tenant_session(db) as ts:
            ts.execute(_sqltext("DELETE FROM votes WHERE idea_id=:i"), {"i": str(iid)})
            ts.execute(_sqltext("DELETE FROM ideas WHERE id=:i"), {"i": str(iid)})
            ts.execute(_sqltext("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": str(cid)})
            ts.execute(_sqltext("DELETE FROM contests WHERE id=:c"), {"c": str(cid)})
            ts.execute(_sqltext("DELETE FROM quest_members WHERE quest_id=:q"), {"q": str(cqid)})
            ts.execute(_sqltext("DELETE FROM quest_revisions WHERE quest_id=:q"), {"q": str(cqid)})
            ts.execute(_sqltext("DELETE FROM quests WHERE id=:q"), {"q": str(cqid)})
            ts.execute(_sqltext("DELETE FROM users WHERE id IN (:a,:b)"), {"a": str(me), "b": str(other)})
            ts.commit()


def test_i_tc_164_165_166_zone_d_e_panels(client, factory):
    """I-TC-164/165/166(int): Zone D/E 合成＝募集中コンテスト(open・未参加)／参加中コンテスト(approved)／おすすめクエスト(catalog my_state=none)。

    get_dashboard を直接呼び、作成した特定 ID で絞り込みの正しさを検証（共有 seed DB 対応＝件数ではなく id の包含/除外）。
    """
    from sqlalchemy import text as _sqltext

    from app.tenant.contests import repository as contest_repo
    from app.tenant.dashboard import application as dash_app
    from app.tenant.quests.orm import QuestFollow

    acc, uid = _login_dash(client, factory)  # 会社DB の user ミラー＝uid（fresh アカウント＝何も参加/フォローしていない）
    with control_session() as s:
        company_id = str(s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id)
    db = _db()

    # コンテスト用の backing quest（器）＝他者 owner。
    other = uuid.uuid4()
    cq_none, cq_appr, cq_draft, cq_req = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    # おすすめ用の discoverable クエスト（全社公開＝部署リンク0）。owner は other。
    q_none, q_member, q_follow = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(User(id=other, account_id=uuid.uuid4(), display_name="主催者", locale="ja", status="active"))
        # open×未参加／open×approved／draft／open×requested の4コンテスト。
        for cqid in (cq_none, cq_appr, cq_draft, cq_req):
            quests_repo.create_quest(ts, quest_id=cqid, owner_id=other, title="器", color="#6366F1", status="recruiting")
        ts.flush()
        c_none = contest_repo.create(ts, quest_id=cq_none, theme="募集中(未参加)", description=None, mode="bounded",
                                     status="open", starts_at=None, ends_at=None, auto_archive_days=None,
                                     prize_config=None, created_by_id=other, auto_approve=False)
        c_appr = contest_repo.create(ts, quest_id=cq_appr, theme="参加中", description=None, mode="bounded",
                                     status="open", starts_at=None, ends_at=None, auto_archive_days=None,
                                     prize_config=None, created_by_id=other, auto_approve=False)
        c_draft = contest_repo.create(ts, quest_id=cq_draft, theme="下書き", description=None, mode="bounded",
                                      status="draft", starts_at=None, ends_at=None, auto_archive_days=None,
                                      prize_config=None, created_by_id=other, auto_approve=False)
        c_req = contest_repo.create(ts, quest_id=cq_req, theme="申請中", description=None, mode="bounded",
                                    status="open", starts_at=None, ends_at=None, auto_archive_days=None,
                                    prize_config=None, created_by_id=other, auto_approve=False)
        contest_repo.upsert_contest_participation(ts, c_appr.id, uid, status="approved")   # me＝参加承認済み
        contest_repo.upsert_contest_participation(ts, c_req.id, uid, status="requested")   # me＝参加リクエスト中
        # discoverable クエスト（全社）＝my_state が member/following/none になる3件。
        for qid in (q_none, q_member, q_follow):
            q = quests_repo.create_quest(ts, quest_id=qid, owner_id=other, title="おすすめ候補", color="#3B82F6", status="recruiting")
            q.discoverable = True
        quests_repo.add_member(ts, q_member, uid, permissions=[])               # my_state=member（権限行は作らない＝teardown FK 回避）
        ts.add(QuestFollow(id=uuid.uuid4(), quest_id=q_follow, user_id=uid))     # my_state=following
        ts.commit()
        cid_none, cid_appr, cid_draft, cid_req = c_none.id, c_appr.id, c_draft.id, c_req.id
    try:
        result = dash_app.get_dashboard({"account_id": str(acc["id"]), "company_id": company_id})
        open_ids = {c["id"] for c in result["open_contests"]}
        joined_ids = {c["id"] for c in result["joined_contests"]}
        requested_ids = {c["id"] for c in result["requested_contests"]}
        rec_ids = {q["id"] for q in result["recommended_quests"]}
        # I-TC-164 募集中＝open かつ未参加のみ（approved/draft/requested は出ない）。
        assert str(cid_none) in open_ids
        assert str(cid_appr) not in open_ids
        assert str(cid_draft) not in open_ids
        assert str(cid_req) not in open_ids
        # I-TC-165 参加中＝approved のみ（未参加/申請中は出ない）。
        assert str(cid_appr) in joined_ids
        assert str(cid_none) not in joined_ids
        # I-TC-167 参加リクエスト中＝requested のみ（approved/未参加は出ない）。
        assert str(cid_req) in requested_ids
        assert str(cid_appr) not in requested_ids
        assert str(cid_none) not in requested_ids
        # I-TC-166 おすすめ＝catalog my_state=none のみ（member/following は出ない）。
        assert str(q_none) in rec_ids
        assert str(q_member) not in rec_ids
        assert str(q_follow) not in rec_ids
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(_sqltext("DELETE FROM quest_follows WHERE quest_id=:q"), {"q": str(q_follow)})
            ts.execute(_sqltext("DELETE FROM contest_participants WHERE contest_id IN (:a,:r)"), {"a": str(cid_appr), "r": str(cid_req)})
            ts.execute(_sqltext("DELETE FROM contests WHERE id IN (:a,:b,:c,:r)"),
                       {"a": str(cid_none), "b": str(cid_appr), "c": str(cid_draft), "r": str(cid_req)})
            for qid in (cq_none, cq_appr, cq_draft, cq_req, q_none, q_member, q_follow):
                ts.execute(_sqltext("DELETE FROM quest_members WHERE quest_id=:q"), {"q": str(qid)})
                ts.execute(_sqltext("DELETE FROM quest_revisions WHERE quest_id=:q"), {"q": str(qid)})
                ts.execute(_sqltext("DELETE FROM quests WHERE id=:q"), {"q": str(qid)})
            ts.execute(_sqltext("DELETE FROM users WHERE id=:o"), {"o": str(other)})
            ts.commit()
