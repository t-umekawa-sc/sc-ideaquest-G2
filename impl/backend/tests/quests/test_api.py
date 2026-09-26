"""C-TC-101〜105: GET /quests・GET /quest-groups の API（SC-10・API設計 C.1/C.4・FR-15）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にグループ/クエスト/パーティーを直接 seed して
参照制限（(A) 所属グループ×パーティー参加中／(B) 自分の下書き）と DTO 形状・カーソルを検証する。
teardown で seed 行を物理削除。未認証は 401。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from decimal import Decimal

from app.tenant.ideas.orm import Idea
from app.tenant.info.orm import InfoItem, InfoLink
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import Quest, QuestCategory, QuestGroupLink, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

QUESTS = "/api/v1/quests"
GROUPS = "/api/v1/quest-groups"


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
    created_quests: list[uuid.UUID] = []
    created_group_member_ids: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        # 他人（他クエストの owner/パーティー用）の実ユーザー＝FK(quests.owner_id→users) を満たす。
        ts.add(User(id=other_user_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="C-TC Group"))
        ts.flush()
        for uid in (user_id, other_user_id):  # 両者とも同一グループに所属＝可視グループ条件を満たす
            m = qg_repo.upsert_membership(ts, group_id, uid)
            ts.flush()
            created_group_member_ids.append(m.id)
        ts.commit()

    def make_quest(*, status="recruiting", party=True, owner=None, title="C-TC Quest", discoverable=False) -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            repo.create_quest(
                ts, quest_id=qid, owner_id=the_owner,
                title=title, color="#3B82F6", status=status, discoverable=discoverable,
            )
            repo.create_group_links(ts, qid, group_ids=[group_id])  # 参加部署（FR-38 再設計）
            repo.replace_categories(ts, qid, [("UX", False)])
            if party:
                repo.add_member(ts, qid, the_owner, permissions=["owner"])
            ts.commit()
        created_quests.append(qid)
        return qid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, group_id=group_id,
        other_user_id=other_user_id, make_quest=make_quest,
    )

    with get_tenant_session(db_identifier) as ts:
        if created_quests:
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(created_quests))).scalars())
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(created_quests)))
            ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(created_quests)))
            ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id.in_(created_quests)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(created_quests)))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == group_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id == other_user_id))
        ts.commit()


def test_c_tc_101_list_returns_joined_quest(client, env):
    """C-TC-101: 所属グループ×パーティー参加中の公開クエストが DTO 形状で返る。"""
    qid = env.make_quest(status="recruiting")
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS)
    assert r.status_code == 200, r.text
    body = r.json()
    card = next((c for c in body["data"] if c["id"] == str(qid)), None)
    assert card is not None
    assert card["status"] == "recruiting"
    assert card["member_count"] == 1
    assert card["idea_count"] == 0
    assert card["categories"] == ["UX"]
    assert card["owner"]["user_id"] == str(env.user_id)
    assert {g["id"] for g in card["quest_groups"]} == {str(env.group_id)}
    assert card["my_state"] == "member"
    assert "next_cursor" in body["page_info"] and "has_next" in body["page_info"]


def test_c_tc_102_hides_non_party_quest(client, env):
    """C-TC-102: 同じ可視グループでも自分がパーティー非参加のクエストは出さない（C.0 門番）。"""
    hidden = env.make_quest(status="recruiting", owner=env.other_user_id, party=True)  # 他人だけがパーティー
    # other_user_id は会社DB users に存在しないが、パーティー門番（自分=seed user が非参加）だけで除外される
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS)
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["data"]}
    assert str(hidden) not in ids


def test_c_tc_103_status_filter_validation(client, env):
    """C-TC-103: 想定外の status 値は 422（enum 限定・§C.6 入力検証）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS, params={"status": "bogus"})
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "validation_error"


def test_c_tc_104_groups_returns_membership(client, env):
    """C-TC-104: GET /quest-groups は自分が有効所属するグループを返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(GROUPS)
    assert r.status_code == 200, r.text
    ids = {g["id"] for g in r.json()["data"]}
    assert str(env.group_id) in ids


def test_c_tc_105_requires_auth(client, env):
    """C-TC-105: 未認証は 401（require_me・P1）。"""
    r = client.get(QUESTS)
    assert r.status_code == 401, r.text


def _seed_ideas_for_count(db_identifier, quest_id, author_id) -> list[uuid.UUID]:
    """idea_count 検証用に published 2件・draft 1件・published+削除 1件を seed。返り値＝cleanup 用 id。"""
    ids: list[uuid.UUID] = []
    with get_tenant_session(db_identifier) as ts:
        def _add(status, deleted=False):
            iid = uuid.uuid4()
            ts.add(Idea(
                id=iid, quest_id=quest_id, author_id=author_id,
                title="t", body="b", value="v", status=status,
                deleted_at=datetime.now(timezone.utc) if deleted else None,
            ))
            ids.append(iid)
        _add("published")
        _add("published")
        _add("draft")               # 下書き＝件数に含めない
        _add("published", deleted=True)  # 削除＝deleted_at で除外
        ts.commit()
    return ids


def _delete_ideas(db_identifier, ids):
    with get_tenant_session(db_identifier) as ts:
        ts.execute(Idea.__table__.delete().where(Idea.id.in_(ids)))
        ts.commit()


def test_c_tc_143_detail_idea_count_published_only(client, env):
    """C-TC-143: GET /quests/{id} の idea_count は公開アイデア数（下書き/削除は除外）。"""
    qid = env.make_quest(status="recruiting")
    idea_ids = _seed_ideas_for_count(env.db_identifier, qid, env.user_id)
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        r = client.get(f"{QUESTS}/{qid}")
        assert r.status_code == 200, r.text
        assert r.json()["idea_count"] == 2
    finally:
        _delete_ideas(env.db_identifier, idea_ids)


def test_c_tc_144_list_idea_count_published_only(client, env):
    """C-TC-144: GET /quests のカード idea_count も公開アイデア数を反映（batch 集計）。"""
    qid = env.make_quest(status="recruiting")
    idea_ids = _seed_ideas_for_count(env.db_identifier, qid, env.user_id)
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        r = client.get(QUESTS)
        assert r.status_code == 200, r.text
        card = next((c for c in r.json()["data"] if c["id"] == str(qid)), None)
        assert card is not None
        assert card["idea_count"] == 2
    finally:
        _delete_ideas(env.db_identifier, idea_ids)


def test_c_tc_247_card_is_owner_flag(client, env):
    """C-TC-247: クエストカードの is_owner＝閲覧者が作成者か（SC-01 で「自分のクエスト」を参加中と分離）。"""
    own = env.make_quest(status="recruiting", title="自分のクエスト")  # owner=user_id
    other = env.make_quest(status="recruiting", owner=env.other_user_id, title="他人のクエスト")  # owner=other
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_member(ts, other, env.user_id, permissions=["comment"])  # seed を参加させて可視に
        ts.commit()
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    cards = {c["id"]: c for c in client.get(QUESTS).json()["data"]}
    assert cards[str(own)]["is_owner"] is True    # 作成者＝自分のクエスト
    assert cards[str(other)]["is_owner"] is False  # 他者作成で参加中


def test_c_tc_252_card_discoverable_flag(client, env):
    """C-TC-252: クエストカードに discoverable（発見カタログ掲載）を含む＝一覧の列/ソート/絞込・複製プリフィルに使う（FR-40・C.9.0）。"""
    on = env.make_quest(status="recruiting", title="発見ON クエスト", discoverable=True)
    off = env.make_quest(status="recruiting", title="発見OFF クエスト", discoverable=False)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    cards = {c["id"]: c for c in client.get(QUESTS).json()["data"]}
    assert cards[str(on)]["discoverable"] is True
    assert cards[str(off)]["discoverable"] is False


def test_c_tc_251_list_q_and_group_filters(client, env):
    """C-TC-251: GET /quests の q（件名部分一致）・group_id（所属グループ絞り）フィルタ（C.1）。"""
    import uuid as _uuid
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    uniq = f"ズンドコ{_uuid.uuid4().hex[:6]}"
    hit = env.make_quest(status="recruiting", title=uniq)
    other = env.make_quest(status="recruiting", title="別件クエスト")
    # q＝件名部分一致（ヒットのみ返り、別件は出ない）
    ids = {c["id"] for c in client.get(QUESTS, params={"q": uniq}).json()["data"]}
    assert str(hit) in ids and str(other) not in ids
    # group_id＝所属グループのクエストが返る
    ids2 = {c["id"] for c in client.get(QUESTS, params={"group_id": str(env.group_id)}).json()["data"]}
    assert str(hit) in ids2


def _seed_n_published(db_identifier, quest_id, author_id, n) -> list[uuid.UUID]:
    """公開アイデアを n 件 seed（sort=-idea_count 検証用）。返り値＝cleanup 用 id。"""
    ids: list[uuid.UUID] = []
    with get_tenant_session(db_identifier) as ts:
        for _ in range(n):
            iid = uuid.uuid4()
            ts.add(Idea(id=iid, quest_id=quest_id, author_id=author_id,
                        title="t", body="b", value="v", status="published"))
            ids.append(iid)
        ts.commit()
    return ids


def test_c_tc_106_sort_by_idea_count_desc(client, env):
    """C-TC-106: GET /quests?sort=-idea_count でカードが idea_count 降順（アイデア多い方が前・§1.8.1）。"""
    rich = env.make_quest(status="recruiting", title="rich")
    poor = env.make_quest(status="recruiting", title="poor")
    idea_ids = _seed_n_published(env.db_identifier, rich, env.user_id, 2)
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        r = client.get(QUESTS, params={"group_id": str(env.group_id), "sort": "-idea_count"})
        assert r.status_code == 200, r.text
        ids = [c["id"] for c in r.json()["data"]]
        assert ids.index(str(rich)) < ids.index(str(poor))
    finally:
        _delete_ideas(env.db_identifier, idea_ids)


def test_c_tc_107_unknown_sort_key_422(client, env):
    """C-TC-107: 未知ソートキーは 422 validation_error・errors[].field=sort（ホワイトリスト・§1.8.1）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS, params={"sort": "bogus"})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "sort" for e in body.get("errors", []))


def test_c_tc_108_sort_cursor_stable(client, env):
    """C-TC-108: ソート指定時も keyset ページングが重複なく降順継続（§1.8.1）。"""
    rich = env.make_quest(status="recruiting", title="rich")
    poor = env.make_quest(status="recruiting", title="poor")
    idea_ids = _seed_n_published(env.db_identifier, rich, env.user_id, 2)
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        base = {"group_id": str(env.group_id), "sort": "-idea_count", "limit": 1}
        p1 = client.get(QUESTS, params=base)
        assert p1.status_code == 200, p1.text
        d1 = p1.json()
        ids1 = [c["id"] for c in d1["data"]]
        assert ids1 == [str(rich)]                    # idea_count 最大が先頭
        assert d1["page_info"]["has_next"] is True
        cursor = d1["page_info"]["next_cursor"]
        assert cursor
        p2 = client.get(QUESTS, params={**base, "cursor": cursor})
        assert p2.status_code == 200, p2.text
        ids2 = [c["id"] for c in p2.json()["data"]]
        assert ids2 == [str(poor)]                    # 続きは重複なく次の順位
        assert set(ids1).isdisjoint(ids2)
    finally:
        _delete_ideas(env.db_identifier, idea_ids)


# ---- C.8b 関連情報（成果物→情報・FR-41・SC-12 上部ストリップ） ----
RELATED_INFO_Q = "/api/v1/quests/{}/related-info"


def _seed_info_link(db_identifier, *, target_type, target_id, created_by, title,
                    kind="related", origin="auto", score=None, status="curated",
                    rejected=False, source_url=None, impact_class=None, summary=None):
    """情報＋リンクを1組直接 seed（EP を介さず決定的に用意）。返り値＝(info_id, link_id)。"""
    info_id = uuid.uuid4()
    link_id = uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(InfoItem(id=info_id, title=title, status=status, created_by_id=created_by,
                        summary=summary, source_url=source_url, impact_class=impact_class))
        ts.add(InfoLink(id=link_id, info_item_id=info_id, target_type=target_type, target_id=target_id,
                        kind=kind, origin=origin, score=score,
                        created_by_id=(created_by if origin == "manual" else None),
                        rejected_at=(datetime.now(timezone.utc) if rejected else None)))
        ts.commit()
    return info_id, link_id


def _cleanup_info(db_identifier, info_ids):
    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id.in_(info_ids)))
        ts.execute(InfoItem.__table__.delete().where(InfoItem.id.in_(info_ids)))
        ts.commit()


def test_c_tc_285_quest_related_info(client, env):
    """C-TC-285: クエストの関連情報＝score 降順・rejected/archived 除外・manual は linked_by（関連付けた人）。"""
    qid = env.make_quest(status="recruiting")
    auto_i, _ = _seed_info_link(env.db_identifier, target_type="quests", target_id=qid, created_by=env.user_id,
                                title="裏付け285", kind="supporting", origin="auto", score=Decimal("0.90"),
                                impact_class="opportunity", summary="要約A")
    man_i, _ = _seed_info_link(env.db_identifier, target_type="quests", target_id=qid, created_by=env.user_id,
                               title="反証285", kind="refuting", origin="manual", source_url="https://x.example")
    rej_i, _ = _seed_info_link(env.db_identifier, target_type="quests", target_id=qid, created_by=env.user_id,
                               title="棄却285", origin="auto", score=Decimal("0.99"), rejected=True)
    arc_i, _ = _seed_info_link(env.db_identifier, target_type="quests", target_id=qid, created_by=env.user_id,
                               title="アーカイブ285", origin="auto", score=Decimal("0.95"), status="archived")
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        r = client.get(RELATED_INFO_Q.format(qid))
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        ids = [d["info_id"] for d in data]
        assert str(auto_i) in ids and str(man_i) in ids
        assert str(rej_i) not in ids and str(arc_i) not in ids  # 棄却・archived は除外
        assert ids.index(str(auto_i)) < ids.index(str(man_i))  # score 降順（auto 0.90 が NULL より前）
        auto = next(d for d in data if d["info_id"] == str(auto_i))
        man = next(d for d in data if d["info_id"] == str(man_i))
        assert auto["origin"] == "auto" and auto["kind"] == "supporting" and auto["score"] == 0.90
        assert auto["impact_class"] == "opportunity" and auto["linked_by"] is None  # auto は system＝linked_by なし
        assert man["origin"] == "manual" and man["kind"] == "refuting" and man["source_url"] == "https://x.example"
        assert man["linked_by"]["user_id"] == str(env.user_id)  # 手動＝関連付けた人（created_by_id）
    finally:
        _cleanup_info(env.db_identifier, [auto_i, man_i, rej_i, arc_i])


def test_c_tc_286_quest_related_info_gate(client, env):
    """C-TC-286: 門番＝クエスト詳細と同一。範囲外（非パーティー）／不明 ID は 404（存在秘匿）。"""
    hidden = env.make_quest(status="recruiting", owner=env.other_user_id, party=True)  # seed 非参加
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(RELATED_INFO_Q.format(hidden)).status_code == 404
    assert client.get(RELATED_INFO_Q.format(uuid.uuid4())).status_code == 404


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


DISPOSE_Q = "/api/v1/quests/{}/related-info/{}"
LINKS = "/api/v1/info-links"


def test_c_tc_289_quest_link_disposition(client, env):
    """C-TC-289: 採否（disposition）＝owner が adopted→declined→pending を設定。read に状態＋can_dispose。"""
    qid = env.make_quest(status="recruiting")  # owner=seed
    info_i, link_id = _seed_info_link(env.db_identifier, target_type="quests", target_id=qid,
                                      created_by=env.user_id, title="採否289", origin="manual")
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        r = client.patch(DISPOSE_Q.format(qid, link_id),
                         json={"disposition": "adopted", "note": "案Aに反映"}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["disposition"] == "adopted" and d["disposition_note"] == "案Aに反映"
        assert d["disposed_by"]["user_id"] == str(env.user_id) and d["disposed_at"]
        rl = client.get(RELATED_INFO_Q.format(qid)).json()["data"]
        row = next(x for x in rl if x["link_id"] == str(link_id))
        assert row["disposition"] == "adopted" and row["can_dispose"] is True  # owner＝採否可
        # declined（read に返る＝クライアントが隠すのは表示層）
        r2 = client.patch(DISPOSE_Q.format(qid, link_id),
                          json={"disposition": "declined", "note": "範囲外"}, headers=_csrf(client))
        assert r2.status_code == 200 and r2.json()["disposition"] == "declined"
        rl2 = client.get(RELATED_INFO_Q.format(qid)).json()["data"]
        assert any(x["link_id"] == str(link_id) and x["disposition"] == "declined" for x in rl2)
        # pending＝ロック解除＝メモ/設定者/日時クリア
        r3 = client.patch(DISPOSE_Q.format(qid, link_id), json={"disposition": "pending"}, headers=_csrf(client))
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["disposition"] == "pending" and d3["disposition_note"] is None
        assert d3["disposed_by"] is None and d3["disposed_at"] is None
    finally:
        _cleanup_info(env.db_identifier, [info_i])


def test_c_tc_290_quest_disposition_requires_manager(client, env):
    """C-TC-290: 採否は owner/quest_admin のみ＝一般メンバーは 403・read の can_dispose=false。"""
    other = env.make_quest(status="recruiting", owner=env.other_user_id)
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_member(ts, other, env.user_id, permissions=["comment"])  # seed を可視だが非管理で参加
        ts.commit()
    info_i, link_id = _seed_info_link(env.db_identifier, target_type="quests", target_id=other,
                                      created_by=env.user_id, title="採否290", origin="manual")
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        r = client.patch(DISPOSE_Q.format(other, link_id), json={"disposition": "adopted"}, headers=_csrf(client))
        assert r.status_code == 403, r.text
        rl = client.get(RELATED_INFO_Q.format(other)).json()["data"]
        assert next(x for x in rl if x["link_id"] == str(link_id))["can_dispose"] is False
    finally:
        _cleanup_info(env.db_identifier, [info_i])


def test_c_tc_291_disposition_locks_link(client, env):
    """C-TC-291: 採否ロック＝adopted 中は棄却/種別変更が 409／pending で解除。"""
    qid = env.make_quest(status="recruiting")
    info_i, link_id = _seed_info_link(env.db_identifier, target_type="quests", target_id=qid,
                                      created_by=env.user_id, title="ロック291", origin="manual")
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.patch(DISPOSE_Q.format(qid, link_id),
                            json={"disposition": "adopted"}, headers=_csrf(client)).status_code == 200
        assert client.post(f"{LINKS}/{link_id}/reject", headers=_csrf(client)).status_code == 409  # ロック
        assert client.patch(f"{LINKS}/{link_id}", json={"kind": "refuting"}, headers=_csrf(client)).status_code == 409
        assert client.patch(DISPOSE_Q.format(qid, link_id),
                            json={"disposition": "pending"}, headers=_csrf(client)).status_code == 200
        assert client.post(f"{LINKS}/{link_id}/reject", headers=_csrf(client)).status_code == 200  # 解除後は可
    finally:
        _cleanup_info(env.db_identifier, [info_i])


def test_c_tc_292_disposition_404(client, env):
    """C-TC-292: 当該クエストのリンクでない/不明 link_id は 404（存在秘匿）。"""
    qid = env.make_quest(status="recruiting")
    other = env.make_quest(status="recruiting")
    info_i, link_id = _seed_info_link(env.db_identifier, target_type="quests", target_id=other,
                                      created_by=env.user_id, title="別クエスト292", origin="manual")
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.patch(DISPOSE_Q.format(qid, link_id),
                            json={"disposition": "adopted"}, headers=_csrf(client)).status_code == 404
        assert client.patch(DISPOSE_Q.format(qid, uuid.uuid4()),
                            json={"disposition": "adopted"}, headers=_csrf(client)).status_code == 404
    finally:
        _cleanup_info(env.db_identifier, [info_i])


# ---- C-TC-299〜302: クエスト定義の変更履歴＋ステータスログ（変更履歴標準 §3.1/§3.2・migration 0039） ----


def test_c_tc_299_quest_revision_bump(client, env):
    """C-TC-299: クエスト定義の編集で版が増える（新しい順・changed_fields）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    qid = env.make_quest()
    client.patch(f"/api/v1/quests/{qid}", json={"title": "改題1"}, headers=_csrf(client))
    client.patch(f"/api/v1/quests/{qid}", json={"title": "改題2"}, headers=_csrf(client))
    data = client.get(f"/api/v1/quests/{qid}/revisions").json()["data"]
    assert [r["revision"] for r in data] == [2, 1]
    assert "title" in data[0]["changed_fields"]


def test_c_tc_300_quest_empty_update_no_bump(client, env):
    """C-TC-300: 定義が変わらない編集は版を進めない（既存仕様踏襲）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    qid = env.make_quest()
    client.patch(f"/api/v1/quests/{qid}", json={"title": "確定タイトル"}, headers=_csrf(client))  # rev1
    client.patch(f"/api/v1/quests/{qid}", json={"title": "確定タイトル"}, headers=_csrf(client))  # 同値
    data = client.get(f"/api/v1/quests/{qid}/revisions").json()["data"]
    assert [r["revision"] for r in data] == [1]


def test_c_tc_301_quest_status_decision_log(client, env):
    """C-TC-301: ステータス遷移が意思決定ログに記録される（kind=status・recruiting→in_progress）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    qid = env.make_quest(status="recruiting")
    client.post(f"/api/v1/quests/{qid}/transition", json={"to": "in_progress"}, headers=_csrf(client))
    log = client.get(f"/api/v1/quests/{qid}/decision-log").json()["data"]
    st = [e for e in log if e["kind"] == "status"]
    assert st and st[0]["from_value"] == "recruiting" and st[0]["to_value"] == "in_progress"


def test_c_tc_302_quest_revision_diff(client, env):
    """C-TC-302: クエスト定義の版差分（前版比較・title は text segments）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    qid = env.make_quest()
    client.patch(f"/api/v1/quests/{qid}", json={"title": "AAA"}, headers=_csrf(client))
    client.patch(f"/api/v1/quests/{qid}", json={"title": "AAB"}, headers=_csrf(client))
    diff = client.get(f"/api/v1/quests/{qid}/revisions/2/diff").json()
    assert diff["from_revision"] == 1 and diff["to_revision"] == 2
    assert diff["fields"]["title"]["kind"] == "text" and diff["fields"]["title"]["segments"]
