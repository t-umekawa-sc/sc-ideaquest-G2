"""G.5.1 アクティビティフィード（SC-12 クエスト内 / SC-01 チーム）＝activities の公開種別絞り込み。

他者フィードは成果系のみ（idea_post/selection/achievement_reward/levelup_sp）＝vote/chat/login/購入/解放/
評価 は出さない（プライバシー・FR-23/F 従属）。門番＝当該クエストのパーティー所属（quest 内）／自分の参加
クエスト集合（team）。judge=False＋小額付与で実績/レベルアップの副次 activity を出さず検体を純化する。
"""
from __future__ import annotations

import uuid

from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.gamification.orm import Activity
from app.tenant.profile.orm import User
from tests.gamification.test_rankings import _cleanup, _db, _login_new, _make_quest_with


def _grant_reason(user_id, *, kind, reason, quest_id) -> None:
    """検体活動を quest に紐付けて1件付与（judge=False＝実績フック無効で純化）。"""
    with get_tenant_session(_db()) as s:
        ledger.grant(s, s.get(User, user_id), kind=kind, amount=5, reason=reason,
                     ref_type="ideas", ref_id=uuid.uuid4(), quest_id=quest_id, judge=False)
        s.commit()


def _make_user(name) -> uuid.UUID:
    uid = uuid.uuid4()
    with get_tenant_session(_db()) as s:
        s.add(User(id=uid, account_id=uuid.uuid4(), display_name=name, locale="ja", status="active"))
        s.commit()
    return uid


def _del_user(uid) -> None:
    with get_tenant_session(_db()) as s:
        s.execute(User.__table__.delete().where(User.id == uid))
        s.commit()


QF = lambda qid: f"/api/v1/quests/{qid}/activities"  # noqa: E731


def test_g_tc_109_quest_feed_public_only_and_gate(client, factory):
    """G-TC-109 クエスト内フィード＝公開種別のみ・actor 付き／非メンバーは 404（G.5.1）。"""
    me = _login_new(client, factory)                 # owner
    qid, gid, (bob,) = _make_quest_with(me, ["Bob"])
    try:
        _grant_reason(bob, kind="xp_gain", reason="idea_post", quest_id=qid)  # 公開
        _grant_reason(bob, kind="xp_gain", reason="vote", quest_id=qid)       # 非公開（匿名化）
        _grant_reason(bob, kind="xp_gain", reason="chat", quest_id=qid)       # 非公開（ノイズ）

        r = client.get(QF(qid))
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        reasons = {d["reason"] for d in data}
        assert "idea_post" in reasons                # 公開種別は出る
        assert "vote" not in reasons and "chat" not in reasons  # 非公開は出ない
        row = next(d for d in data if d["reason"] == "idea_post")
        assert row["actor"]["id"] == str(bob) and row["actor"]["name"] == "Bob"

        # 非メンバー（別ユーザーでログイン）は 404（門番＝存在秘匿）
        _login_new(client, factory)
        assert client.get(QF(qid)).status_code == 404
    finally:
        _cleanup(qid, gid, [bob])


def test_g_tc_110_team_feed_cross_quest_public_only(client, factory):
    """G-TC-110 チームフィード＝参加クエスト横断の公開種別のみ・各行に quest／不参加クエストは出ない（G.5.1）。"""
    me = _login_new(client, factory)
    qid1, gid1, (bob,) = _make_quest_with(me, ["Bob"])
    qid2, gid2, (carol,) = _make_quest_with(me, ["Carol"])
    eve = _make_user("Eve")
    qid3, gid3, (frank,) = _make_quest_with(eve, ["Frank"])  # me は不参加
    try:
        _grant_reason(bob, kind="xp_gain", reason="idea_post", quest_id=qid1)   # 公開・参加
        _grant_reason(bob, kind="xp_gain", reason="vote", quest_id=qid1)        # 非公開
        _grant_reason(carol, kind="xp_gain", reason="selection", quest_id=qid2)  # 公開・参加
        _grant_reason(frank, kind="xp_gain", reason="idea_post", quest_id=qid3)  # 公開だが me 不参加

        r = client.get("/api/v1/me/feed")
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        pairs = {(d["quest_id"], d["reason"]) for d in data}
        assert (str(qid1), "idea_post") in pairs and (str(qid2), "selection") in pairs
        assert all(d["quest_id"] in {str(qid1), str(qid2)} for d in data)  # qid3（不参加）は出ない
        assert all(d["reason"] in {"idea_post", "selection", "achievement_reward", "levelup_sp"} for d in data)
        assert all(d.get("quest_title") for d in data)  # 各行に quest_title
    finally:
        _cleanup(qid1, gid1, [bob])
        _cleanup(qid2, gid2, [carol])
        _cleanup(qid3, gid3, [frank])
        _del_user(eve)
