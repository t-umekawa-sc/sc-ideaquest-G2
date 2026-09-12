"""C-TC-220〜232: 複数部署横断＝参加部署（アクセス条件）・作成者別格・動的失効（FR-38 再設計・C.0/C.2/C.4）。

参加部署（`quest_group_links`）はフラット 0..N・すべて同格（主グループ廃止）＝アクセス条件（門番）。
- 非作成者は「有効パーティー員 かつ（参加部署 0 件なら条件なし／1 件以上なら現在いずれかに有効所属）」で参照可。
- 作成者（owner）は別格＝常に全参照可・参加部署所属不要。候補も同一条件（0 件＝会社全体）。409 group_in_use は撤去。
seed 一般ユーザー（ACME-01）でログインし、会社DB にグループ/所属ユーザーを直接 seed。teardown で物理削除。
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

    group_a = uuid.uuid4()   # seed user が所属
    group_b = uuid.uuid4()   # seed user は非所属（作成者別格の検証に使う）
    group_c = uuid.uuid4()   # 誰も所属しない（候補空・ディレクトリ用）
    b_user = uuid.uuid4()    # group_b のみ所属
    ab_user = uuid.uuid4()   # group_a と group_b の両方に所属
    created_quests: list[uuid.UUID] = []
    extra_users: list[uuid.UUID] = []  # テスト内で追加した会社ユーザ（teardown で最後に物理削除）

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

    def seed_quest(*, groups=(), owner=None, members=()) -> uuid.UUID:
        """参加部署 `groups`（フラット）のクエストを直接 seed（owner＋パーティー員も付与）。"""
        qid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            repo.create_quest(
                ts, quest_id=qid, owner_id=(owner or user_id),
                title="Multi", color="#3B82F6", status="recruiting",
            )
            repo.replace_categories(ts, qid, [("UX", False)])
            repo.create_group_links(ts, qid, group_ids=list(groups))
            repo.add_member(ts, qid, (owner or user_id), permissions=["owner"])
            for uid in members:
                repo.add_member(ts, qid, uid, permissions=["vote"])
            ts.commit()
        return track(qid)

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id,
        group_a=group_a, group_b=group_b, group_c=group_c,
        b_user=b_user, ab_user=ab_user, track=track, seed_quest=seed_quest,
        extra_users=extra_users,
    )

    with get_tenant_session(db_identifier) as ts:
        api_made = list(ts.execute(
            select(QuestGroupLink.quest_id).where(
                QuestGroupLink.quest_group_id.in_([group_a, group_b, group_c]))
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
        ts.execute(User.__table__.delete().where(User.id.in_([b_user, ab_user, *extra_users])))
        ts.commit()


def _base_body(env, **overrides) -> dict:
    body = {
        "title": "MG Quest",
        "color": "#3B82F6",
        "quest_group_ids": [str(env.group_a)],
        "categories": ["UX"],
        "status": "draft",
    }
    body.update(overrides)
    return body


def test_c_tc_220_create_with_multiple_groups(client, env):
    """C-TC-220: 参加部署を複数付けて作成＝quest_groups に全部署（同格）・単一 quest_group は無い。作成者は非所属でも可（別格）。"""
    _login_seed(client)
    # 参加部署に group_b（seed user 非所属）も含める＝作成者別格の検証。
    body = _base_body(env, quest_group_ids=[str(env.group_a), str(env.group_b)])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = r.json()
    env.track(uuid.UUID(data["id"]))
    assert "quest_group" not in data  # 単一 quest_group DTO は廃止
    gids = {g["id"] for g in data["quest_groups"]}
    assert gids == {str(env.group_a), str(env.group_b)}


def test_c_tc_221_candidate_from_participating_group(client, env):
    """C-TC-221: 参加部署（group_b）の所属者 b_user を members でパーティー追加できる。"""
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


def test_c_tc_222_invalid_group(client, env):
    """C-TC-222: 存在しない参加部署は 422（field quest_group_ids）。"""
    _login_seed(client)
    body = _base_body(env, quest_group_ids=[str(uuid.uuid4())])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e["field"] == "quest_group_ids" for e in r.json()["errors"])


def test_c_tc_223_list_visibility_via_group(client, env):
    """C-TC-223: 参加部署に現所属＋パーティー員の視点で当該クエストが一覧に出る（repository 直）。"""
    qid = env.seed_quest(groups=[env.group_b], members=[env.b_user])
    with get_tenant_session(env.db_identifier) as ts:
        rows = repo.list_quests_for_user(
            ts, user_id=env.b_user, visible_group_ids=[env.group_b], limit=50,
        )
    assert qid in {q.id for q in rows}


def test_c_tc_224_cross_group_candidates(client, env):
    """C-TC-224: 候補 EP＝指定参加部署の和集合を返し、各候補に所属 group_ids が付く。"""
    _login_seed(client)
    r = client.get(CANDIDATES, params={"group_ids": [str(env.group_a), str(env.group_b)]})
    assert r.status_code == 200, r.text
    data = {c["user_id"]: c for c in r.json()["data"]}
    assert str(env.b_user) in data and str(env.ab_user) in data
    assert data[str(env.b_user)]["group_ids"] == [str(env.group_b)]
    assert set(data[str(env.ab_user)]["group_ids"]) == {str(env.group_a), str(env.group_b)}


def test_c_tc_225_candidates_gate_relaxed(client, env):
    """C-TC-225: 候補 EP は同一会社なら非所属でも 200（旧 404 撤廃・会社内は部署をこえて可視）。"""
    _login_seed(client)
    r = client.get(CANDIDATES, params={"group_ids": [str(env.group_c)]})
    assert r.status_code == 200, r.text  # group_c は seed user 非所属だが 200（作成者別格で他部署も選べる）
    assert r.json()["data"] == []  # group_c には所属者が居ない＝空


def test_c_tc_228_group_directory_includes_non_member(client, env):
    """C-TC-228: 部署ディレクトリは会社内の全グループを返す（seed user 非所属の group_c を含む）。"""
    _login_seed(client)
    r = client.get("/api/v1/quest-group-directory")
    assert r.status_code == 200, r.text
    ids = {g["id"] for g in r.json()["data"]}
    assert str(env.group_c) in ids


def test_c_tc_226_patch_adds_group(client, env):
    """C-TC-226: PATCH quest_group_ids で参加部署を追加＝quest_groups が2件になる。"""
    _login_seed(client)
    created = client.post(QUESTS, json=_base_body(env, status="recruiting"), headers=_csrf(client))
    qid = created.json()["id"]
    env.track(uuid.UUID(qid))
    r = client.patch(f"{QUESTS}/{qid}",
                     json={"quest_group_ids": [str(env.group_a), str(env.group_b)]}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    gids = {g["id"] for g in r.json()["quest_groups"]}
    assert gids == {str(env.group_a), str(env.group_b)}


def test_c_tc_227_remove_group_no_conflict_but_revokes(client, env):
    """C-TC-227: 参加部署除外はブロックしない（409 撤去）＝200・そこにしか属さない非作成者は失効（アクセス不可）。"""
    _login_seed(client)
    body = _base_body(
        env, status="recruiting", quest_group_ids=[str(env.group_a), str(env.group_b)],
        members=[{"user_id": str(env.b_user)}],
    )
    created = client.post(QUESTS, json=body, headers=_csrf(client))
    qid = created.json()["id"]
    env.track(uuid.UUID(qid))
    # group_b を外す＝b_user（B のみ所属）は失効するが 409 にはならない。
    r = client.patch(f"{QUESTS}/{qid}", json={"quest_group_ids": [str(env.group_a)]}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert {g["id"] for g in r.json()["quest_groups"]} == {str(env.group_a)}
    with get_tenant_session(env.db_identifier) as ts:
        quest = repo.get_quest(ts, uuid.UUID(qid))
        assert repo.can_access_quest(ts, quest, env.b_user) is False  # 参加部署から外れて失効


def test_c_tc_229_zero_groups_candidate_company_wide(client, env):
    """C-TC-229: 参加部署 0 件＝候補は会社の有効ユーザー全体（部署条件なし）＝任意 active を追加できる。"""
    _login_seed(client)
    body = _base_body(
        env, status="recruiting", quest_group_ids=[],
        members=[{"user_id": str(env.b_user)}],  # b_user は group_a/b いずれにも縛られないが 0 件なら会社全体で可
    )
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = r.json()
    env.track(uuid.UUID(data["id"]))
    assert data["quest_groups"] == []
    assert str(env.b_user) in {m["user"]["user_id"] for m in data["members"]}


def test_c_tc_230_creator_is_exempt(client, env):
    """C-TC-230: 作成者は別格＝参加部署に非所属でも自クエスト詳細を参照できる（404 にならない）。"""
    _login_seed(client)
    # 参加部署は group_b のみ（seed user は B 非所属）。それでも owner として作成・参照できる。
    created = client.post(QUESTS, json=_base_body(env, status="recruiting",
                                                  quest_group_ids=[str(env.group_b)]), headers=_csrf(client))
    assert created.status_code == 201, created.text
    qid = created.json()["id"]
    env.track(uuid.UUID(qid))
    r = client.get(f"{QUESTS}/{qid}")
    assert r.status_code == 200, r.text  # owner は参加部署非所属でも参照可


def test_c_tc_231_dynamic_revocation_on_transfer(client, env):
    """C-TC-231: 動的失効＝非作成者パーティー員が全参加部署を離脱→アクセス失効（都度再判定）。"""
    # owner=ab_user のクエスト（参加部署 group_a）に、group_a 所属の別ユーザ b2 を member として入れる。
    b2 = uuid.uuid4()
    env.extra_users.append(b2)  # teardown で最後に物理削除（quest_members/memberships の後）
    with get_tenant_session(env.db_identifier) as ts:
        ts.add(User(id=b2, account_id=uuid.uuid4(), display_name="Cara", locale="ja", status="active"))
        ts.flush()
        qg_repo.upsert_membership(ts, env.group_a, b2)
        ts.commit()
    qid = env.seed_quest(groups=[env.group_a], owner=env.ab_user, members=[b2])
    with get_tenant_session(env.db_identifier) as ts:
        quest = repo.get_quest(ts, qid)
        assert repo.can_access_quest(ts, quest, b2) is True   # 参加部署に現所属＝可
        qg_repo.remove_membership(ts, env.group_a, b2)        # 異動で group_a を離脱
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        quest = repo.get_quest(ts, qid)
        assert repo.can_access_quest(ts, quest, b2) is False  # 全参加部署を外れて失効


def test_c_tc_232_can_access_quest_truth_table(client, env):
    """C-TC-232: can_access_quest 真偽表（門番の単一ソース）＝owner／party+現所属／party+離脱／0件+party／非party。"""
    # (1) 参加部署 group_a・owner=ab_user・member=b_user（B のみ所属＝A 非所属）
    qid = env.seed_quest(groups=[env.group_a], owner=env.ab_user, members=[env.b_user])
    with get_tenant_session(env.db_identifier) as ts:
        quest = repo.get_quest(ts, qid)
        assert repo.can_access_quest(ts, quest, env.ab_user) is True    # owner は別格
        assert repo.can_access_quest(ts, quest, env.user_id) is False   # 非 party（seed user は member でない）
        assert repo.can_access_quest(ts, quest, env.b_user) is False    # party だが group_a 非所属（現所属なし）
    # (2) 参加部署 0 件・member=b_user
    qid0 = env.seed_quest(groups=[], owner=env.ab_user, members=[env.b_user])
    with get_tenant_session(env.db_identifier) as ts:
        quest0 = repo.get_quest(ts, qid0)
        assert repo.can_access_quest(ts, quest0, env.b_user) is True    # 0 件＝部署条件なし（party なら可）
        assert repo.can_access_quest(ts, quest0, env.user_id) is False  # 非 party は不可


def test_c_tc_233_member_in_scope_flag(client, env):
    """C-TC-233: メンバー DTO の in_scope＝参加部署外メンバーを失効表示（作成者/部署内=true・部署外=false）。"""
    # 参加部署 group_a・owner=seed user（別格）・member=ab_user（A所属=in_scope）＋b_user（B のみ=部署外）。
    qid = env.seed_quest(groups=[env.group_a], owner=env.user_id, members=[env.ab_user, env.b_user])
    _login_seed(client)
    r = client.get(f"{QUESTS}/{qid}")
    assert r.status_code == 200, r.text
    scope = {m["user"]["user_id"]: m["in_scope"] for m in r.json()["members"]}
    assert scope[str(env.user_id)] is True    # 作成者は別格＝常に in_scope
    assert scope[str(env.ab_user)] is True     # group_a に所属＝in_scope
    assert scope[str(env.b_user)] is False     # group_b のみ＝参加部署外＝失効中
