"""C-TC-220〜227: 複数クエストグループ（複数部署横断・FR-38・C.2/C.4）。

主グループ（`quest_group_id`・不変）に加えて追加グループを `quest_group_ids` でリンクできる。
一覧可視性・パーティー候補は「主＋追加リンクのいずれか」の和集合で判定（詳細/チャット門番はパーティー所属で不変）。
seed 一般ユーザー（ACME-01）でログインし、会社DB に2〜3グループと各所属パターンのユーザーを直接 seed。teardown で物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import (
    Quest,
    QuestCategory,
    QuestGroupLink,
    QuestMember,
    QuestMemberPermission,
)
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

QUESTS = "/api/v1/quests"
CANDIDATES = "/api/v1/quest-group-candidates"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


def _seed_user_id(db_identifier: str) -> uuid.UUID:
    with control_session() as s:
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user = get_user_by_account(ts, account.id)
        assert user is not None, "seed 一般ユーザーの会社DB ミラーが無い"
        return user.id


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
    user_id = _seed_user_id(db_identifier)

    group_a = uuid.uuid4()   # 主グループ（seed user が所属）
    group_b = uuid.uuid4()   # 追加グループ（seed user は非所属）
    group_c = uuid.uuid4()   # seed user も他 seed ユーザも非所属（門番 404 用）
    b_user = uuid.uuid4()    # group_b のみ所属
    ab_user = uuid.uuid4()   # group_a と group_b の両方に所属
    created_quests: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=b_user, account_id=uuid.uuid4(), display_name="Bianca", locale="ja", status="active"))
        ts.add(User(id=ab_user, account_id=uuid.uuid4(), display_name="Avery", locale="ja", status="active"))
        for gid, name in ((group_a, "Dept A"), (group_b, "Dept B"), (group_c, "Dept C")):
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name=name))
        ts.flush()
        qg_repo.upsert_membership(ts, group_a, user_id)   # seed user は A
        qg_repo.upsert_membership(ts, group_a, ab_user)   # ab_user は A/B
        qg_repo.upsert_membership(ts, group_b, ab_user)
        qg_repo.upsert_membership(ts, group_b, b_user)    # b_user は B のみ
        ts.commit()

    def track(qid: uuid.UUID) -> uuid.UUID:
        created_quests.append(qid)
        return qid

    def seed_multi_quest(*, extra_groups=(), members=()) -> uuid.UUID:
        """主=group_a のクエストを直接 seed（追加リンク＋パーティー員も付与）。C-TC-223 用。"""
        qid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            repo.create_quest(
                ts, quest_id=qid, quest_group_id=group_a, owner_id=user_id,
                title="Multi", color="#3B82F6", status="recruiting",
            )
            repo.replace_categories(ts, qid, [("UX", False)])
            repo.create_group_links(ts, qid, primary_group_id=group_a, extra_group_ids=list(extra_groups))
            repo.add_member(ts, qid, user_id, permissions=["owner"])
            for uid in members:
                repo.add_member(ts, qid, uid, permissions=["vote"])
            ts.commit()
        return track(qid)

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id,
        group_a=group_a, group_b=group_b, group_c=group_c,
        b_user=b_user, ab_user=ab_user, track=track, seed_multi_quest=seed_multi_quest,
    )

    with get_tenant_session(db_identifier) as ts:
        api_made = list(ts.execute(
            select(Quest.id).where(Quest.quest_group_id.in_([group_a, group_b, group_c]))
        ).scalars())
        qids = list(set(created_quests) | set(api_made))
        from app.tenant.notifications.orm import Notification as _Notif
        _cond = _Notif.recipient_id.in_([b_user, ab_user])
        if qids:
            _cond = _cond | _Notif.ref_quest_id.in_(qids)
        ts.execute(_Notif.__table__.delete().where(_cond))
        if qids:
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(qids))).scalars())
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(qids)))
            ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(qids)))
            ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id.in_(qids)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(qids)))
        ts.execute(QuestGroupMember.__table__.delete().where(
            QuestGroupMember.quest_group_id.in_([group_a, group_b, group_c])))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id.in_([group_a, group_b, group_c])))
        ts.execute(User.__table__.delete().where(User.id.in_([b_user, ab_user])))
        ts.commit()


def _base_body(env, **overrides) -> dict:
    body = {
        "title": "MG Quest",
        "color": "#3B82F6",
        "quest_group_id": str(env.group_a),
        "categories": ["UX"],
        "status": "draft",
    }
    body.update(overrides)
    return body


def test_c_tc_220_create_with_extra_group(client, env):
    """C-TC-220: 追加グループ付き作成＝quest_groups に主＋追加（主が先頭）・quest_group は主。"""
    _login_seed(client)
    body = _base_body(env, quest_group_ids=[str(env.group_b)])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = r.json()
    env.track(uuid.UUID(data["id"]))
    assert data["quest_group"]["id"] == str(env.group_a)
    gids = [g["id"] for g in data["quest_groups"]]
    assert gids[0] == str(env.group_a)  # 主が先頭
    assert set(gids) == {str(env.group_a), str(env.group_b)}


def test_c_tc_221_cross_group_member_addable(client, env):
    """C-TC-221: 追加グループのみ所属ユーザ（b_user）を横断候補としてパーティー追加できる（単一Gなら 422）。"""
    _login_seed(client)
    body = _base_body(
        env, status="recruiting", quest_group_ids=[str(env.group_b)],
        members=[{"user_id": str(env.b_user)}],
    )
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = r.json()
    env.track(uuid.UUID(data["id"]))
    ids = {m["user"]["user_id"] for m in data["members"]}
    assert str(env.b_user) in ids


def test_c_tc_222_invalid_extra_group(client, env):
    """C-TC-222: 存在しない追加グループは 422（field quest_group_ids）。"""
    _login_seed(client)
    body = _base_body(env, quest_group_ids=[str(uuid.uuid4())])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e["field"] == "quest_group_ids" for e in r.json()["errors"])


def test_c_tc_223_list_visibility_via_extra_group(client, env):
    """C-TC-223: 追加グループのみ所属＋パーティー員の視点で、当該クエストが一覧に出る（repository 直）。"""
    qid = env.seed_multi_quest(extra_groups=[env.group_b], members=[env.b_user])
    with get_tenant_session(env.db_identifier) as ts:
        rows = repo.list_quests_for_user(
            ts, user_id=env.b_user, visible_group_ids=[env.group_b], limit=50,
        )
    assert qid in {q.id for q in rows}


def test_c_tc_224_cross_group_candidates(client, env):
    """C-TC-224: 横断候補 EP＝指定グループ和集合を返し、各候補に所属 group_ids が付く。"""
    _login_seed(client)
    r = client.get(CANDIDATES, params={"group_ids": [str(env.group_a), str(env.group_b)]})
    assert r.status_code == 200, r.text
    data = {c["user_id"]: c for c in r.json()["data"]}
    # b_user（B のみ）と ab_user（A/B）が候補に含まれる。
    assert str(env.b_user) in data and str(env.ab_user) in data
    assert data[str(env.b_user)]["group_ids"] == [str(env.group_b)]
    assert set(data[str(env.ab_user)]["group_ids"]) == {str(env.group_a), str(env.group_b)}


def test_c_tc_225_cross_group_candidates_gate(client, env):
    """C-TC-225: いずれの指定グループにも非所属なら 404（存在秘匿）。"""
    _login_seed(client)
    r = client.get(CANDIDATES, params={"group_ids": [str(env.group_c)]})
    assert r.status_code == 404, r.text


def test_c_tc_228_group_directory_includes_non_member(client, env):
    """C-TC-228: 部署ディレクトリは会社内の全グループを返す（seed user 非所属の group_c を含む）。"""
    _login_seed(client)
    r = client.get("/api/v1/quest-group-directory")
    assert r.status_code == 200, r.text
    ids = {g["id"] for g in r.json()["data"]}
    assert str(env.group_c) in ids  # 非所属でも会社内全部署が選択肢に出る


def test_c_tc_226_patch_adds_extra_group(client, env):
    """C-TC-226: PATCH quest_group_ids で追加グループを付与＝quest_groups が2件になる。"""
    _login_seed(client)
    created = client.post(QUESTS, json=_base_body(env, status="recruiting"), headers=_csrf(client))
    qid = created.json()["id"]
    env.track(uuid.UUID(qid))
    r = client.patch(f"{QUESTS}/{qid}", json={"quest_group_ids": [str(env.group_b)]}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    gids = {g["id"] for g in r.json()["quest_groups"]}
    assert gids == {str(env.group_a), str(env.group_b)}


def test_c_tc_227_remove_group_orphans_member_conflicts(client, env):
    """C-TC-227: 追加グループ除外で他グループ未所属のパーティー員が孤立＝409（group_in_use・user_ids）。"""
    _login_seed(client)
    body = _base_body(
        env, status="recruiting", quest_group_ids=[str(env.group_b)],
        members=[{"user_id": str(env.b_user)}],
    )
    created = client.post(QUESTS, json=body, headers=_csrf(client))
    qid = created.json()["id"]
    env.track(uuid.UUID(qid))
    # group_b を外すと b_user（B のみ所属）がどの関連グループにも属さなくなる → 409。
    r = client.patch(f"{QUESTS}/{qid}", json={"quest_group_ids": []}, headers=_csrf(client))
    assert r.status_code == 409, r.text
    err = r.json()["errors"][0]
    assert err["reason"] == "group_in_use"
    assert str(env.b_user) in err["user_ids"]
