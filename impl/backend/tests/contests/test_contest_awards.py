"""アイデアコンテストの表彰・ランキング・恒久フラグ（Step2c・T.1 finalize/T.3・設計 §6・doc/テスト/T_アイデアコンテスト.md §4）。

既存基盤（votes/evaluations/activities/ledger/achievements）を会期×backing quest で再利用＝新テーブル不要。
共有 dev DB を汚さないよう、backing quest 配下の全子行＋contest を finally で物理掃除。実績/台帳/通知の
受賞者ぶんは conftest teardown（created users 単位）が併せて掃除する。
"""
from __future__ import annotations

import uuid

from sqlalchemy import text as _text

from app.db.tenant import get_tenant_session
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE
from tests.contests.test_contests import BASE, _admin, _body, _cleanup_contest, _seed_db, _user_id


def _mk_idea(qid: str, author_uid, *, published=True) -> uuid.UUID:
    iid = uuid.uuid4()
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text(
            "INSERT INTO ideas (id, quest_id, author_id, title, body, value, status, created_at, updated_at) "
            "VALUES (:i, :q, :a, 'アイデア', 'b', 'v', :st, now(), now())"),
            {"i": str(iid), "q": qid, "a": str(author_uid), "st": "published" if published else "draft"})
        ts.commit()
    return iid


def _add_votes(iid: uuid.UUID, voter_uids, vote_type="approve") -> None:
    with get_tenant_session(_seed_db()) as ts:
        for uid in voter_uids:
            ts.execute(_text(
                "INSERT INTO votes (id, idea_id, user_id, type, voted_revision, voted_at) "
                "VALUES (:id, :i, :u, :t, 1, now())"),
                {"id": str(uuid.uuid4()), "i": str(iid), "u": str(uid), "t": vote_type})
        ts.commit()


def _add_submitted_eval(iid: uuid.UUID, evaluator_uid, score: int) -> None:
    eid = uuid.uuid4()
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text(
            "INSERT INTO evaluations (id, idea_id, evaluator_id, status, visibility, overall_comment, submitted_at) "
            "VALUES (:e, :i, :u, 'submitted', 'party', '総評', now())"),
            {"e": str(eid), "i": str(iid), "u": str(evaluator_uid)})
        for aspect in ("novelty", "impact", "feasibility", "fit", "cost"):
            ts.execute(_text(
                "INSERT INTO evaluation_scores (id, evaluation_id, aspect, score) VALUES (:id, :e, :a, :s)"),
                {"id": str(uuid.uuid4()), "e": str(eid), "a": aspect, "s": score})
        ts.commit()


def _add_activity(uid, qid: str, reason: str) -> None:
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text(
            "INSERT INTO activities (id, user_id, kind, amount, reason, quest_id, created_at) "
            "VALUES (:id, :u, 'xp_gain', 5, :r, :q, now())"),
            {"id": str(uuid.uuid4()), "u": str(uid), "r": reason, "q": qid})
        ts.commit()


def _purge_contest_and_quest(cid: str) -> None:
    """contest の backing quest 配下の全子行＋contest＋quest を物理掃除（受賞者の台帳/実績は conftest が掃除）。"""
    with get_tenant_session(_seed_db()) as ts:
        qid = ts.execute(_text("SELECT quest_id FROM contests WHERE id = :c"), {"c": cid}).scalar()
        if qid:
            ts.execute(_text("DELETE FROM notifications WHERE ref_quest_id=:q OR ref_idea_id IN "
                             "(SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM activities WHERE quest_id=:q OR ref_id IN "
                             "(SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM contest_idea_flags WHERE contest_id=:c"), {"c": cid})
            ts.execute(_text("DELETE FROM evaluation_scores WHERE evaluation_id IN (SELECT id FROM evaluations "
                             "WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q))"), {"q": qid})
            ts.execute(_text("DELETE FROM evaluation_revisions WHERE evaluation_id IN (SELECT id FROM evaluations "
                             "WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q))"), {"q": qid})
            ts.execute(_text("DELETE FROM evaluations WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM votes WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM idea_participants WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM idea_revisions WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM idea_stakeholders WHERE idea_id IN (SELECT id FROM ideas WHERE quest_id=:q)"), {"q": qid})
            ts.execute(_text("DELETE FROM ideas WHERE quest_id=:q"), {"q": qid})
        ts.execute(_text("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": cid})
        ts.commit()
    _cleanup_contest(cid)


def _prize(axes) -> dict:
    return {"axes": axes}


def test_t_tc_130_ranking_axes_within_contest(client, factory):
    """T-TC-130(api): ランキング軸＝賛成投票数/平均評価点/活動貢献が backing quest×会期で集計される。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    a1 = factory.make_seed_company_account(display_name=f"投稿A_{uuid.uuid4().hex[:6]}")
    a2 = factory.make_seed_company_account(display_name=f"投稿B_{uuid.uuid4().hex[:6]}")
    v1 = factory.make_seed_company_account(display_name=f"票1_{uuid.uuid4().hex[:6]}")
    v2 = factory.make_seed_company_account(display_name=f"票2_{uuid.uuid4().hex[:6]}")
    i1, i2 = _mk_idea(qid, _user_id(a1["id"])), _mk_idea(qid, _user_id(a2["id"]))
    try:
        # approve_votes: i1=2票・i2=1票 → i1 が1位。
        _add_votes(i1, [_user_id(v1["id"]), _user_id(v2["id"])])
        _add_votes(i2, [_user_id(v1["id"])])
        rv = client.get(f"{BASE}/{cid}/ranking", params={"axis": "approve_votes"})
        assert rv.status_code == 200, rv.text
        data = rv.json()["data"]
        assert [e["idea_id"] for e in data[:2]] == [str(i1), str(i2)]
        assert data[0]["rank"] == 1 and data[0]["metric"] == 2.0
        # avg_score: i2=5点・i1=3点 → i2 が1位。
        _add_submitted_eval(i1, _user_id(v1["id"]), 3)
        _add_submitted_eval(i2, _user_id(v1["id"]), 5)
        ra = client.get(f"{BASE}/{cid}/ranking", params={"axis": "avg_score"})
        assert ra.status_code == 200, ra.text
        assert ra.json()["data"][0]["idea_id"] == str(i2)
        # contribution: v1 に貢献活動3件・v2 に1件 → v1 が1位。
        for r in ("vote", "chat", "evaluation"):
            _add_activity(_user_id(v1["id"]), qid, r)
        _add_activity(_user_id(v2["id"]), qid, "vote")
        rc = client.get(f"{BASE}/{cid}/ranking", params={"axis": "contribution"})
        assert rc.status_code == 200, rc.text
        cdata = rc.json()["data"]
        assert cdata[0]["user_id"] == str(_user_id(v1["id"])) and cdata[0]["metric"] == 3.0
        assert cdata[0]["idea_id"] is None  # 貢献軸はユーザー主体
        # 不正 axis は 422。
        assert client.get(f"{BASE}/{cid}/ranking", params={"axis": "bogus"}).status_code == 422
    finally:
        _purge_contest_and_quest(cid)


def _xp_coin_for(uid, reason="contest_award"):
    with get_tenant_session(_seed_db()) as ts:
        xp = ts.execute(_text("SELECT COALESCE(SUM(amount),0) FROM activities WHERE user_id=:u AND kind='xp_gain' "
                              "AND reason=:r"), {"u": str(uid), "r": reason}).scalar()
        coin = ts.execute(_text("SELECT COALESCE(SUM(amount),0) FROM activities WHERE user_id=:u AND kind='coin_gain' "
                                "AND reason=:r"), {"u": str(uid), "r": reason}).scalar()
    return int(xp), int(coin)


def test_t_tc_131_finalize_awards_idempotent(client, factory):
    """T-TC-131(int): 表彰確定＝上位N へ XP/コイン（冪等 reason='contest_award'）＋入賞実績＋is_selected＋殿堂入り／再実行で重複なし。"""
    admin = _admin(client, factory)
    prize = _prize([{"key": "approve_votes", "top": 3, "xp": [300, 200, 100], "coin": [100, 60, 30]}])
    cid = client.post(BASE, json=_body(status="open", prize_config=prize), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    a1 = factory.make_seed_company_account(display_name=f"金_{uuid.uuid4().hex[:6]}")
    a2 = factory.make_seed_company_account(display_name=f"銀_{uuid.uuid4().hex[:6]}")
    a3 = factory.make_seed_company_account(display_name=f"銅_{uuid.uuid4().hex[:6]}")
    v = [factory.make_seed_company_account(display_name=f"票_{i}_{uuid.uuid4().hex[:4]}") for i in range(3)]
    vu = [_user_id(x["id"]) for x in v]
    i1, i2, i3 = _mk_idea(qid, _user_id(a1["id"])), _mk_idea(qid, _user_id(a2["id"])), _mk_idea(qid, _user_id(a3["id"]))
    try:
        _add_votes(i1, vu)          # 3票=1位
        _add_votes(i2, vu[:2])      # 2票=2位
        _add_votes(i3, vu[:1])      # 1票=3位
        client.patch(f"{BASE}/{cid}", json={"status": "judging"}, headers=_csrf(client))
        r = client.post(f"{BASE}/{cid}/finalize", headers=_csrf(client))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "closed"
        assert body["selected_ideas"] == 3 and body["awarded_users"] == 3
        assert body["granted_now"] > 0
        # XP/コイン（順位どおり）。
        assert _xp_coin_for(_user_id(a1["id"])) == (300, 100)
        assert _xp_coin_for(_user_id(a2["id"])) == (200, 60)
        assert _xp_coin_for(_user_id(a3["id"])) == (100, 30)
        with get_tenant_session(_seed_db()) as ts:
            # is_selected が3件とも立つ。
            sel = ts.execute(_text("SELECT COUNT(*) FROM ideas WHERE id IN (:i1,:i2,:i3) AND is_selected=true"),
                             {"i1": str(i1), "i2": str(i2), "i3": str(i3)}).scalar()
            assert sel == 3
            # 1位は殿堂入りフラグ。
            hof = ts.execute(_text("SELECT idea_id FROM contest_idea_flags WHERE contest_id=:c AND flag='hall_of_fame'"),
                             {"c": cid}).scalars().all()
            assert [str(x) for x in hof] == [str(i1)]
            # 入賞バッジ（gold/silver/bronze）が各受賞者に解除される。
            for uid, tier in [(_user_id(a1["id"]), "gold"), (_user_id(a2["id"]), "silver"), (_user_id(a3["id"]), "bronze")]:
                n = ts.execute(_text("SELECT COUNT(*) FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id "
                                     "WHERE ua.user_id=:u AND a.code=:code AND ua.unlocked_at IS NOT NULL"),
                               {"u": str(uid), "code": f"contest_award_{tier}"}).scalar()
                assert n == 1, f"{tier} バッジ未解除"
        # 再実行（closed）は冪等＝新規付与0・XP は増えない。
        r2 = client.post(f"{BASE}/{cid}/finalize", headers=_csrf(client))
        assert r2.status_code == 200 and r2.json()["granted_now"] == 0, r2.text
        assert _xp_coin_for(_user_id(a1["id"])) == (300, 100)  # 二重付与なし
    finally:
        _purge_contest_and_quest(cid)


def test_t_tc_132_rolling_auto_shelve(client, factory):
    """T-TC-132(int): rolling は期限超過アイデアに shelved を自動付与（contest_idea_flags・ideas 無改修）・冪等。"""
    from app.tenant.contests import application as contest_app

    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open", mode="rolling", auto_archive_days=30),
                      headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    old_i = _mk_idea(qid, _user_id(author["id"]))
    new_i = _mk_idea(qid, _user_id(author["id"]))
    try:
        # old_i を 40日前に created_at を後退（期限超過）。new_i は今日のまま。
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("UPDATE ideas SET created_at = now() - interval '40 days' WHERE id=:i"), {"i": str(old_i)})
            ts.commit()
        out = contest_app.auto_shelve_expired(uuid.UUID(str(admin["id"])), uuid.UUID(_company_id()), cid)
        assert out["shelved"] == 1
        with get_tenant_session(_seed_db()) as ts:
            flags = ts.execute(_text("SELECT idea_id FROM contest_idea_flags WHERE contest_id=:c AND flag='shelved'"),
                               {"c": cid}).scalars().all()
            assert [str(x) for x in flags] == [str(old_i)]  # 超過アイデアのみ
        # 冪等＝再実行で追加0。
        out2 = contest_app.auto_shelve_expired(uuid.UUID(str(admin["id"])), uuid.UUID(_company_id()), cid)
        assert out2["shelved"] == 0
    finally:
        _purge_contest_and_quest(cid)


def _company_id() -> str:
    from app.control_plane.auth.orm import Company
    from app.db.control import control_session
    with control_session() as s:
        return str(s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id)
