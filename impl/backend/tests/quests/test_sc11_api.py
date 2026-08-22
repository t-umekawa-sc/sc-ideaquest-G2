"""C-TC-110〜126: クエスト作成/編集/公開・パーティー差分・候補・アイコン（SC-11・C.2/C.3/C.4）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にグループと候補ユーザーを直接 seed。
サーバー強制ルール（候補制限・owner 付与は作成者のみ・作成者保護・状態機械・strict 検証）と
入力検証・CSRF/認可を API 経由で検証する。teardown で seed 行を物理削除。ストレージは Fake。
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
from app.tenant.quests.orm import Quest, QuestCategory, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

QUESTS = "/api/v1/quests"
GROUPS = "/api/v1/quest-groups"

# 最小の PNG（サーバーは MIME/サイズのみ検証）。
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000154a24f0e0000000049454e44ae426082"
)


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

    group_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    third_user_id = uuid.uuid4()
    created_quests: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=other_user_id, account_id=uuid.uuid4(), display_name="Bravo", locale="ja", status="active"))
        ts.add(User(id=third_user_id, account_id=uuid.uuid4(), display_name="Charlie", locale="ja", status="active"))
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="SC11 Group"))
        ts.flush()
        for uid in (user_id, other_user_id, third_user_id):  # 全員同一グループ＝候補になり得る
            qg_repo.upsert_membership(ts, group_id, uid)
        ts.commit()

    def seed_quest(*, status="recruiting", owner=None, with_owner_member=True) -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            repo.create_quest(
                ts, quest_id=qid, quest_group_id=group_id, owner_id=the_owner,
                title="Seed", color="#3B82F6", status=status,
            )
            repo.replace_categories(ts, qid, [("UX", False)])
            if with_owner_member:
                repo.add_member(ts, qid, the_owner, permissions=["owner"])
            ts.commit()
        created_quests.append(qid)
        return qid

    def track(qid: uuid.UUID) -> uuid.UUID:
        created_quests.append(qid)
        return qid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, group_id=group_id,
        other_user_id=other_user_id, third_user_id=third_user_id,
        seed_quest=seed_quest, track=track,
    )

    with get_tenant_session(db_identifier) as ts:
        # env が作った分＋API が作ったクエスト（seed user 所有・当該グループ）をまとめて掃除。
        api_made = list(
            ts.execute(select(Quest.id).where(Quest.quest_group_id == group_id)).scalars()
        )
        qids = list(set(created_quests) | set(api_made))
        if qids:
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(qids))).scalars())
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(qids)))
            ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(qids)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(qids)))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == group_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id.in_([other_user_id, third_user_id])))
        ts.commit()


def _base_body(env, **overrides) -> dict:
    body = {
        "title": "New Quest",
        "color": "#3B82F6",
        "quest_group_id": str(env.group_id),
        "categories": ["UX"],
        "status": "draft",
    }
    body.update(overrides)
    return body


def test_c_tc_110_create_draft(client, env):
    """C-TC-110: 下書き作成＝201・my_state=draft・作成者が owner でパーティーに入る。"""
    _login_seed(client)
    r = client.post(QUESTS, json=_base_body(env), headers=_csrf(client))
    assert r.status_code == 201, r.text
    body = r.json()
    env.track(uuid.UUID(body["id"]))
    assert body["status"] == "draft"
    assert body["my_state"] == "draft"
    assert body["member_count"] == 1
    creator = next(m for m in body["members"] if m["is_creator"])
    assert creator["user"]["user_id"] == str(env.user_id)
    assert "owner" in creator["permissions"]


def test_c_tc_111_create_recruiting_with_member(client, env):
    """C-TC-111: 即公開作成＋メンバー追加＝status=recruiting・追加者に既定権限・作成者は owner。"""
    _login_seed(client)
    body = _base_body(env, status="recruiting", members=[{"user_id": str(env.other_user_id)}])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = r.json()
    env.track(uuid.UUID(data["id"]))
    assert data["status"] == "recruiting"
    assert data["member_count"] == 2
    added = next(m for m in data["members"] if m["user"]["user_id"] == str(env.other_user_id))
    assert set(added["permissions"]) == {"vote", "idea_create", "comment"}
    assert not added["is_creator"]


def test_c_tc_112_create_invalid_group(client, env):
    """C-TC-112: 自分が有効所属しないグループでの作成は 422（quest_group_id・IDOR 対策）。"""
    _login_seed(client)
    body = _base_body(env, quest_group_id=str(uuid.uuid4()))
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "quest_group_id"


def test_c_tc_113_create_recruiting_requires_categories(client, env):
    """C-TC-113: 即公開はカテゴリ1件以上が必須（strict 検証）＝未充足は 422。"""
    _login_seed(client)
    body = _base_body(env, status="recruiting", categories=[])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e["field"] == "categories" for e in r.json()["errors"])


def test_c_tc_114_create_draft_allows_empty_categories(client, env):
    """C-TC-114: 下書きはカテゴリ空でも保存可（緩い検証・公開時に strict で担保・C.7 確定）。"""
    _login_seed(client)
    body = _base_body(env, status="draft", categories=[])
    r = client.post(QUESTS, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    env.track(uuid.UUID(r.json()["id"]))
    assert r.json()["categories"] == []


def test_c_tc_115_update_then_publish(client, env):
    """C-TC-115: 下書きを PATCH で編集→ publish で recruiting に遷移（アトミック）。"""
    _login_seed(client)
    qid = env.seed_quest(status="draft")
    r = client.patch(f"{QUESTS}/{qid}", json={"title": "Edited"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Edited"
    r2 = client.post(f"{QUESTS}/{qid}/publish", json={}, headers=_csrf(client))
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "recruiting"


def test_c_tc_116_publish_non_draft_conflicts(client, env):
    """C-TC-116: draft 以外への publish は 409 conflict（invalid_state・状態機械）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.post(f"{QUESTS}/{qid}/publish", json={}, headers=_csrf(client))
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "conflict"


def test_c_tc_117_publish_non_owner_forbidden(client, env):
    """C-TC-117: 作成者でない者の publish は 403（owner のみ・公開中クエスト）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting", owner=env.other_user_id)
    r = client.post(f"{QUESTS}/{qid}/publish", json={}, headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_c_tc_118_update_completed_frozen(client, env):
    """C-TC-118: 完了後の編集は 409（書き込み凍結・C.5）。"""
    _login_seed(client)
    qid = env.seed_quest(status="completed")
    r = client.patch(f"{QUESTS}/{qid}", json={"title": "X"}, headers=_csrf(client))
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "conflict"


def test_c_tc_119_candidates_exclude(client, env):
    """C-TC-119: 候補は同一グループの有効メンバー。exclude_user_ids はサーバー側で除外（C.4）。"""
    _login_seed(client)
    r = client.get(f"{GROUPS}/{env.group_id}/members")
    assert r.status_code == 200, r.text
    ids = {c["user_id"] for c in r.json()["data"]}
    assert str(env.other_user_id) in ids
    r2 = client.get(f"{GROUPS}/{env.group_id}/members", params={"exclude_user_ids": [str(env.other_user_id)]})
    ids2 = {c["user_id"] for c in r2.json()["data"]}
    assert str(env.other_user_id) not in ids2


def test_c_tc_120_candidates_non_member_group_hidden(client, env):
    """C-TC-120: 非所属グループの候補要求は 404（存在秘匿・C.4）。"""
    _login_seed(client)
    r = client.get(f"{GROUPS}/{uuid.uuid4()}/members")
    assert r.status_code == 404, r.text


def test_c_tc_121_party_candidate_limit(client, env):
    """C-TC-121: 候補外（グループ非所属）のユーザー追加は 422（user_id・候補制限・C.3）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    outsider = str(uuid.uuid4())  # どのグループにも属さない
    r = client.patch(f"{QUESTS}/{qid}", json={"members": [{"user_id": outsider}]}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "user_id"


def test_c_tc_122_owner_grant_only_by_creator(client, env):
    """C-TC-122: 作成者以外による owner 権限付与は 403（権限昇格の悪用防止・C.3）。"""
    _login_seed(client)
    # 作成者＝other_user、seed user は quest_admin メンバー（編集権限あり・作成者ではない）。
    qid = env.seed_quest(status="recruiting", owner=env.other_user_id)
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_member(ts, qid, env.user_id, permissions=["quest_admin"])
        ts.commit()
    body = {"members": [{"user_id": str(env.third_user_id), "permissions": ["owner", "vote"]}]}
    r = client.patch(f"{QUESTS}/{qid}", json=body, headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_c_tc_123_creator_protected_on_diff(client, env):
    """C-TC-123: members に作成者を含めず送っても、作成者はパーティーから外れない（作成者保護・C.3）。"""
    _login_seed(client)
    body = _base_body(env, status="recruiting", members=[{"user_id": str(env.other_user_id)}])
    created = client.post(QUESTS, json=body, headers=_csrf(client))
    qid = created.json()["id"]
    env.track(uuid.UUID(qid))
    # 作成者も other も含めない空 members＝other を外し、作成者は保護されて残る。
    r = client.patch(f"{QUESTS}/{qid}", json={"members": []}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    member_ids = {m["user"]["user_id"] for m in r.json()["members"]}
    assert str(env.user_id) in member_ids  # 作成者は残る
    assert str(env.other_user_id) not in member_ids  # 指定外は外れる


def test_c_tc_124_write_requires_csrf(client, env):
    """C-TC-124: 変更系は CSRF トークン必須＝欠落は 403（A.0 ダブルサブミット）。"""
    _login_seed(client)
    r = client.post(QUESTS, json=_base_body(env))  # CSRF ヘッダ無し
    assert r.status_code == 403, r.text
    assert r.json()["code"] == "csrf_failed"


def test_c_tc_125_icon_put_and_delete(client, env, storage):
    """C-TC-125: アイコン設定＝200＋署名URL（quest-icons/）、削除＝204（論点2・K.4 流儀）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.put(
        f"{QUESTS}/{qid}/icon-image", files={"file": ("i.png", PNG, "image/png")}, headers=_csrf(client)
    )
    assert r.status_code == 200, r.text
    assert r.json()["icon_image_url"].startswith("https://minio.test/quest-icons/")
    r2 = client.delete(f"{QUESTS}/{qid}/icon-image", headers=_csrf(client))
    assert r2.status_code == 204, r2.text


def test_c_tc_126_create_requires_auth(client, env):
    """C-TC-126: 未認証の作成は 401（require_me・P1）。"""
    r = client.post(QUESTS, json=_base_body(env))
    assert r.status_code == 401, r.text


def test_c_tc_127_get_own_draft_detail(client, env):
    """C-TC-127: 自分の下書き詳細を取得＝200・status draft・作成者がメンバーに含まれ my_permissions に owner。"""
    _login_seed(client)
    qid = env.seed_quest(status="draft")
    r = client.get(f"{QUESTS}/{qid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "draft"
    assert body["my_state"] == "draft"
    assert "owner" in body["my_permissions"]
    assert any(m["is_creator"] for m in body["members"])


def test_c_tc_128_get_detail_non_member_hidden(client, env):
    """C-TC-128: 自分がパーティー外のクエスト詳細は 404（存在秘匿・C.1 可視性）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting", owner=env.other_user_id)  # seed user は非メンバー
    r = client.get(f"{QUESTS}/{qid}")
    assert r.status_code == 404, r.text


def test_c_tc_129_get_recruiting_detail_as_member(client, env):
    """C-TC-129: 参加中の公開クエスト詳細を取得＝200・カテゴリ/パーティーを同梱（SC-11 編集プリフィル）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")  # seed user が owner＝メンバー
    r = client.get(f"{QUESTS}/{qid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "recruiting"
    assert body["categories"] == ["UX"]
    assert body["quest_group"]["id"] == str(env.group_id)


# ---- SC-12: パーティー粒度（C.3）／状態遷移（C.5）／削除（C-TC-130〜142） ----


def test_c_tc_130_list_members(client, env):
    """C-TC-130: GET /quests/{id}/members＝作成者を含むパーティーを返す（SC-12 パーティータブ）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.get(f"{QUESTS}/{qid}/members")
    assert r.status_code == 200, r.text
    assert any(m["is_creator"] for m in r.json()["data"])


def test_c_tc_131_put_party_bulk(client, env):
    """C-TC-131: PUT /party＝あるべき全体像で一括差分適用（作成者は保護され残る）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.put(f"{QUESTS}/{qid}/party", json={"members": [{"user_id": str(env.other_user_id)}]}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    ids = {m["user"]["user_id"] for m in r.json()["data"]}
    assert str(env.user_id) in ids and str(env.other_user_id) in ids


def test_c_tc_132_add_member(client, env):
    """C-TC-132: POST /members＝1名追加・既定権限（vote/idea_create/comment）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.post(f"{QUESTS}/{qid}/members", json={"user_id": str(env.other_user_id)}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    assert set(r.json()["permissions"]) == {"vote", "idea_create", "comment"}


def test_c_tc_133_remove_member(client, env):
    """C-TC-133: DELETE /members/{user_id}＝論理削除でパーティーから外れる。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    client.post(f"{QUESTS}/{qid}/members", json={"user_id": str(env.other_user_id)}, headers=_csrf(client))
    r = client.delete(f"{QUESTS}/{qid}/members/{env.other_user_id}", headers=_csrf(client))
    assert r.status_code == 204, r.text
    ids = {m["user"]["user_id"] for m in client.get(f"{QUESTS}/{qid}/members").json()["data"]}
    assert str(env.other_user_id) not in ids


def test_c_tc_134_cannot_remove_creator(client, env):
    """C-TC-134: 作成者はパーティーから外せない（422 作成者保護・C.3）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.delete(f"{QUESTS}/{qid}/members/{env.user_id}", headers=_csrf(client))
    assert r.status_code == 422, r.text


def test_c_tc_135_set_member_permissions(client, env):
    """C-TC-135: PUT .../permissions＝権限セットを置換。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    client.post(f"{QUESTS}/{qid}/members", json={"user_id": str(env.other_user_id)}, headers=_csrf(client))
    r = client.put(f"{QUESTS}/{qid}/members/{env.other_user_id}/permissions", json={"permissions": ["vote", "evaluator"]}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert set(r.json()["permissions"]) == {"vote", "evaluator"}


def test_c_tc_136_cannot_change_creator_permissions(client, env):
    """C-TC-136: 作成者の権限は変更不可（422 保護・owner 剥奪防止・C.3）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.put(f"{QUESTS}/{qid}/members/{env.user_id}/permissions", json={"permissions": ["vote"]}, headers=_csrf(client))
    assert r.status_code == 422, r.text


def test_c_tc_137_transition_forward(client, env):
    """C-TC-137: 前進遷移 recruiting→in_progress＝200。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.post(f"{QUESTS}/{qid}/transition", json={"to": "in_progress"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_progress"


def test_c_tc_138_transition_skip_conflicts(client, env):
    """C-TC-138: 飛び越え遷移 recruiting→evaluating は 409（逆行/飛び越え禁止・C.5）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.post(f"{QUESTS}/{qid}/transition", json={"to": "evaluating"}, headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_c_tc_139_transition_draft_publishes_with_strict(client, env):
    """C-TC-139: draft→recruiting は publish 相当＝strict 充足なら 200 recruiting。"""
    _login_seed(client)
    qid = env.seed_quest(status="draft")  # seed_quest は category UX 付き＝strict 充足
    r = client.post(f"{QUESTS}/{qid}/transition", json={"to": "recruiting"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "recruiting"


def test_c_tc_140_delete_quest(client, env):
    """C-TC-140: DELETE /quests/{id}＝論理削除。以後 GET 詳細は 404。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting")
    r = client.delete(f"{QUESTS}/{qid}", headers=_csrf(client))
    assert r.status_code == 204, r.text
    assert client.get(f"{QUESTS}/{qid}").status_code == 404


def test_c_tc_141_party_edit_forbidden_for_non_admin(client, env):
    """C-TC-141: owner/quest_admin でない者のパーティー編集は 403（C.3 認可）。"""
    _login_seed(client)
    qid = env.seed_quest(status="recruiting", owner=env.other_user_id)  # seed user は非 owner/非メンバー
    r = client.put(f"{QUESTS}/{qid}/party", json={"members": []}, headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_c_tc_142_completed_party_frozen(client, env):
    """C-TC-142: 完了クエストのパーティー編集は 409（書き込み凍結・C.5）。"""
    _login_seed(client)
    qid = env.seed_quest(status="completed")
    r = client.post(f"{QUESTS}/{qid}/members", json={"user_id": str(env.other_user_id)}, headers=_csrf(client))
    assert r.status_code == 409, r.text
