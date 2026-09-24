"""N-TC-101〜106: GET /info-items・GET /info-items/word-cloud の API（SC-50・API設計 N.1/N.6）。

seed 一般ユーザー（ACME-01）でログインし、会社DB に seed した情報（conftest.info_env）で
DTO 形状・全文検索・入力検証・認可を検証する。情報プールは会社内 active ユーザーなら閲覧可（N.0）。
"""
from __future__ import annotations

from app.db.tenant import get_tenant_session
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

INFO = "/api/v1/info-items"
WORD_CLOUD = "/api/v1/info-items/word-cloud"
IMAGES = "/api/v1/info-items/images"
LINKS = "/api/v1/info-links"
CURATORS = "/api/v1/info-curators"


def _seed_member_account_id() -> str:
    """seed 一般ユーザー（SEED_LOGIN）の account_id（curator 付与の対象）。"""
    from app.control_plane.auth.orm import Account
    from app.db.control import control_session
    from sqlalchemy import select as _select
    with control_session() as s:
        return str(s.execute(_select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one().id)


def _purge_curators(db_identifier):
    """info_curators を全削除（テスト間の権限漏れ防止）。"""
    from app.tenant.info.orm import InfoCurator
    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoCurator.__table__.delete()); ts.commit()


def _seed_quest_idea_vote(db_identifier):
    """反証通知の宛先解決用に quest（所有者）＋idea（作成者）＋vote（評価者）を seed。namespace を返す。"""
    import uuid as _uuid
    from types import SimpleNamespace
    from app.tenant.ideas.orm import Idea, Vote
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest
    owner, author, voter = _uuid.uuid4(), _uuid.uuid4(), _uuid.uuid4()
    qid, iid = _uuid.uuid4(), _uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        for u, nm in [(owner, "所有者"), (author, "起案者"), (voter, "評価者")]:
            ts.add(User(id=u, account_id=_uuid.uuid4(), display_name=nm, locale="ja", status="active"))
        ts.flush()  # users を先に確定（FK: quests.owner_id / ideas.author_id）
        ts.add(Quest(id=qid, owner_id=owner, title="反証対象クエスト", color="#0D9488", status="recruiting"))
        ts.flush()  # quest を先に確定（FK: ideas.quest_id）
        ts.add(Idea(id=iid, quest_id=qid, author_id=author, title="反証対象アイデア", body="b", value="v", status="published"))
        ts.flush()  # idea を先に確定（FK: votes.idea_id）
        ts.add(Vote(id=_uuid.uuid4(), idea_id=iid, user_id=voter, type="approve", voted_revision=1))
        ts.commit()
    return SimpleNamespace(quest_id=qid, idea_id=iid, owner=owner, author=author, voter=voter, users=[owner, author, voter])


def _cleanup_refuting_seed(db_identifier, seed):
    """N-TC-138/139 の seed 後始末（notifications〔FK ref_idea_id〕→vote→idea→quest→users）。"""
    from app.tenant.ideas.orm import Idea, Vote
    from app.tenant.notifications.orm import Notification
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest
    with get_tenant_session(db_identifier) as ts:
        ts.execute(Notification.__table__.delete().where(Notification.recipient_id.in_(seed.users)))
        ts.execute(Vote.__table__.delete().where(Vote.idea_id == seed.idea_id))
        ts.execute(Idea.__table__.delete().where(Idea.id == seed.idea_id))
        ts.execute(Quest.__table__.delete().where(Quest.id == seed.quest_id))
        ts.execute(User.__table__.delete().where(User.id.in_(seed.users)))
        ts.commit()


def _notified(db_identifier, ntype, among):
    """among（user_id 群）のうち type=ntype の通知を受け取った recipient_id 集合。"""
    from sqlalchemy import select as _select
    from app.tenant.notifications.orm import Notification
    with get_tenant_session(db_identifier) as ts:
        return set(ts.execute(_select(Notification.recipient_id)
                              .where(Notification.type == ntype, Notification.recipient_id.in_(among))).scalars().all())

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64  # 有効な PNG シグネチャ（validate_image_upload はシグネチャ検証）


def _new_link(client, info_env):
    """ids.d に手動リンクを1件作成して link id を返す（teardown が created_items のリンクを削除）。"""
    import uuid as _uuid
    r = client.post(LINKS, json={"info_item_id": str(info_env.ids.d), "target_type": "ideas",
                                 "target_id": str(_uuid.uuid4())}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _delete_info(db_identifier, info_id):
    """作成した情報の後始末（attachments/tokens/links/revisions/item を物理削除）。"""
    from app.tenant.info.orm import InfoAttachment, InfoItem, InfoItemRevision, InfoLink, InfoToken
    import uuid as _uuid
    iid = _uuid.UUID(info_id)
    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoAttachment.__table__.delete().where(InfoAttachment.info_item_id == iid))
        ts.execute(InfoToken.__table__.delete().where(InfoToken.info_item_id == iid))
        ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id == iid))
        # 版1を作成時に必ず記録するようになった（N-TC-147）＝FK 順序で revisions を先に消す。
        ts.execute(InfoItemRevision.__table__.delete().where(InfoItemRevision.info_item_id == iid))
        ts.execute(InfoItem.__table__.delete().where(InfoItem.id == iid))
        ts.commit()


def _delete_quest(db_identifier, quest_id):
    """テスト作成クエストの後始末（info_links〔逆リンク〕＋パーティー/権限/部署/カテゴリ→本体を物理削除）。"""
    import uuid as _uuid
    from app.tenant.info.orm import InfoLink
    from app.tenant.quests.orm import (
        Quest, QuestCategory, QuestGroupLink, QuestMember, QuestMemberPermission,
    )
    qid = _uuid.UUID(quest_id)
    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoLink.__table__.delete().where(InfoLink.target_type == "quests", InfoLink.target_id == qid))
        member_ids = [m.id for m in ts.execute(
            QuestMember.__table__.select().where(QuestMember.quest_id == qid)).all()]
        if member_ids:
            ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(member_ids)))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id == qid))
        ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.commit()


def test_n_tc_101_list_card_shape(client, info_env):
    """N-TC-101: 一覧が card DTO 形状で返る（派生集計・created_by・page_info）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO)
    assert r.status_code == 200, r.text
    body = r.json()
    card = next((c for c in body["data"] if c["id"] == str(info_env.ids.a)), None)
    assert card is not None
    assert card["status"] == "curated"
    assert card["impact_class"] == "opportunity"
    assert set(card["categories"]) == {"ext_technology", "ext_industry"}
    assert card["link_count"] == 2  # 棄却1件は除外
    assert card["follow_up_count"] == 2
    assert card["created_by"]["user_id"] == str(info_env.user_id)
    assert card["created_by"]["display_name"]
    assert "summary" in card and "source_url" in card and "due_date" in card
    assert {"total", "page", "per_page"} <= set(body["page_info"].keys())


def test_n_tc_102_status_enum_validation(client, info_env):
    """N-TC-102: status enum の入力検証（422・field=status）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO, params={"status": "bogus"})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "status" for e in body.get("errors", []))


def test_n_tc_103_unknown_sort_key_422(client, info_env):
    """N-TC-103: 未知ソートキーは 422（ホワイトリスト・field=sort）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO, params={"sort": "bogus"})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "sort" for e in body.get("errors", []))


def test_n_tc_104_unauthenticated_401(client):
    """N-TC-104: 未認証は 401。"""
    r = client.get(INFO)
    assert r.status_code == 401, r.text


def test_n_tc_105_full_text_search(client, info_env):
    """N-TC-105: 全文検索タブ（q）でヒット行のみ返る。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO, params={"q": "ブロックチェーン"})
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["data"]}
    assert ids == {str(info_env.ids.b)}


def test_n_tc_107_status_facets(client, info_env):
    """N-TC-107: 状態 facet 件数（all/raw/curated・archived 除外）を返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO)
    assert r.status_code == 200, r.text
    facets = r.json()["facets"]
    assert {"all", "raw", "curated"} <= set(facets.keys())
    assert facets["all"] == facets["raw"] + facets["curated"]
    # seed（info_env）は raw(3: fu1,fu2,b と d?) 実際の内訳に依らず archived は含めない → all>=4。
    assert facets["all"] >= 1 and facets["raw"] >= 1 and facets["curated"] >= 1


def _grant_curator(db_identifier, user_id):
    from app.tenant.info.orm import InfoCurator
    with get_tenant_session(db_identifier) as ts:
        ts.add(InfoCurator(user_id=user_id)); ts.commit()


def _revoke_curators(db_identifier, user_id):
    from app.tenant.info.orm import InfoCurator
    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoCurator.__table__.delete().where(InfoCurator.user_id == user_id)); ts.commit()


def _seed_other_item(db_identifier):
    """他ユーザーが作成した情報を1件 seed（越権テスト用）。(info_id, user_id) を返す。"""
    import uuid as _uuid
    from app.tenant.info.orm import InfoItem
    from app.tenant.profile.orm import User
    other_uid, iid = _uuid.uuid4(), _uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=other_uid, account_id=_uuid.uuid4(), display_name="別ユーザー", locale="ja", status="active"))
        ts.flush()
        ts.add(InfoItem(id=iid, created_by_id=other_uid, title="他者の情報", status="raw"))
        ts.commit()
    return iid, other_uid


def _delete_user(db_identifier, user_id):
    from app.tenant.profile.orm import User
    with get_tenant_session(db_identifier) as ts:
        ts.execute(User.__table__.delete().where(User.id == user_id)); ts.commit()


def test_n_tc_115_patch_content(client, info_env):
    """N-TC-115: 内容編集（作成者・再派生＋版履歴+1）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # info_env.ids.a は seed 一般ユーザー（＝ログイン本人）が作成者＝内容編集可。
    r = client.patch(f"{INFO}/{info_env.ids.a}", json={"body_html": "<p>更新後の<strong>本文</strong><script>x()</script></p>"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    d = r.json()
    assert "<script" not in (d["body_html"] or "") and "更新後" in (d["body_html"] or "")  # 再サニタイズ
    assert d["summary"] and d["tokens_top"]  # 要約/トークン再生成
    from app.tenant.info import repository as repo
    with get_tenant_session(info_env.db_identifier) as ts:
        assert repo.revision_count(ts, info_env.ids.a) == 1  # 内容変更で1版


def test_n_tc_116_patch_curation(client, info_env):
    """N-TC-116: キュレーション（curator・raw→curated）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    _grant_curator(info_env.db_identifier, info_env.user_id)
    try:
        r = client.patch(f"{INFO}/{info_env.ids.b}", json={"priority": "high", "due_date": "2026-12-31", "categories": ["ext_competitor"]}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["priority"] == "high" and d["status"] == "curated"  # 属性付与で raw→curated
        assert d["due_date"] == "2026-12-31"
        assert set(d["categories"]) == {"ext_competitor"}
    finally:
        _revoke_curators(info_env.db_identifier, info_env.user_id)


def test_n_tc_117_patch_forbidden(client, info_env):
    """N-TC-117: 越権は 403（非curator が属性／非作成者が内容）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # 非 curator が属性を編集 → 403
    r = client.patch(f"{INFO}/{info_env.ids.a}", json={"priority": "high"}, headers=_csrf(client))
    assert r.status_code == 403, r.text
    # 非作成者が内容を編集 → 403
    other_id, other_uid = _seed_other_item(info_env.db_identifier)
    try:
        r2 = client.patch(f"{INFO}/{other_id}", json={"title": "書き換え"}, headers=_csrf(client))
        assert r2.status_code == 403, r2.text
    finally:
        _delete_info(info_env.db_identifier, str(other_id))
        _delete_user(info_env.db_identifier, other_uid)


def test_n_tc_124_link_candidates(client, info_env):
    """N-TC-124: リンク候補検索（quests）／不正 target_type は 422。"""
    import uuid as _uuid
    from app.tenant.quests.orm import Quest
    qid = _uuid.uuid4()
    with get_tenant_session(info_env.db_identifier) as ts:
        ts.add(Quest(id=qid, owner_id=info_env.user_id, title="候補EPテストQ", color="#3B82F6", status="recruiting"))
        ts.commit()
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    try:
        r = client.get("/api/v1/info-link-candidates", params={"target_type": "quests", "q": "候補EPテストQ"})
        assert r.status_code == 200, r.text
        assert any(c["target_id"] == str(qid) and c["target_type"] == "quests" for c in r.json()["candidates"])
        r2 = client.get("/api/v1/info-link-candidates", params={"target_type": "bogus", "q": "x"})
        assert r2.status_code == 422, r2.text
    finally:
        with get_tenant_session(info_env.db_identifier) as ts:
            ts.execute(Quest.__table__.delete().where(Quest.id == qid)); ts.commit()


def _seed_link_targets(db_identifier):
    """対象ピッカーの候補（quest＋idea 複数・文脈メタ/期限あり）を seed。namespace を返す。"""
    import uuid as _uuid
    from datetime import date
    from types import SimpleNamespace
    from app.tenant.ideas.orm import Idea
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest
    owner = _uuid.uuid4()
    qid, i1, i2, i3 = _uuid.uuid4(), _uuid.uuid4(), _uuid.uuid4(), _uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=owner, account_id=_uuid.uuid4(), display_name="候補起票者ZZ", locale="ja", status="active"))
        ts.flush()
        ts.add(Quest(id=qid, owner_id=owner, title="候補ピッカーQ_ZZ", color="#0D9488", status="recruiting", deadline=date(2026, 12, 31)))
        ts.flush()
        ts.add(Idea(id=i1, quest_id=qid, author_id=owner, title="候補ピッカーI_ZZ_A", body="b", value="v", status="published", time_limit=date(2026, 11, 30)))
        ts.add(Idea(id=i2, quest_id=qid, author_id=owner, title="候補ピッカーI_ZZ_B", body="b", value="v", status="published"))
        ts.add(Idea(id=i3, quest_id=qid, author_id=owner, title="候補ピッカーI_ZZ_C", body="b", value="v", status="draft"))  # draft は候補に出ない
        ts.commit()
    return SimpleNamespace(owner=owner, qid=qid, i1=i1, i2=i2, i3=i3)


def _cleanup_link_targets(db_identifier, s):
    from app.tenant.ideas.orm import Idea
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest
    with get_tenant_session(db_identifier) as ts:
        ts.execute(Idea.__table__.delete().where(Idea.id.in_([s.i1, s.i2, s.i3])))
        ts.execute(Quest.__table__.delete().where(Quest.id == s.qid))
        ts.execute(User.__table__.delete().where(User.id == s.owner))
        ts.commit()


def test_n_tc_141_candidate_context_meta(client, info_env):
    """N-TC-141: 候補に文脈メタ（quest_title/owner_name/status/due）を付けて返す。"""
    s = _seed_link_targets(info_env.db_identifier)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    try:
        r = client.get("/api/v1/info-link-candidates", params={"types": "ideas,quests", "q": "候補ピッカー"})
        assert r.status_code == 200, r.text
        by_id = {c["target_id"]: c for c in r.json()["candidates"]}
        idea = by_id[str(s.i1)]
        assert idea["quest_title"] == "候補ピッカーQ_ZZ" and idea["owner_name"] == "候補起票者ZZ"
        assert idea["status"] == "published" and idea["due"] == "2026-11-30"
        assert idea["created_at"]  # 同名識別用の作成日（非null）
        quest = by_id[str(s.qid)]
        assert quest["owner_name"] == "候補起票者ZZ" and quest["due"] == "2026-12-31"
        assert quest["created_at"]
        assert str(s.i3) not in by_id  # draft アイデアは候補に出ない
    finally:
        _cleanup_link_targets(info_env.db_identifier, s)


def test_n_tc_142_candidate_filters(client, info_env):
    """N-TC-142: 候補をクエスト/状態/期限で絞込（AND・期限未設定は範囲指定時に除外）。"""
    s = _seed_link_targets(info_env.db_identifier)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    try:
        # クエスト絞込＝当該 quest 配下の idea＋quest 自身のみ。
        r = client.get("/api/v1/info-link-candidates", params={"types": "ideas,quests", "q": "候補ピッカー", "quest_ids": str(s.qid)})
        ids = {c["target_id"] for c in r.json()["candidates"]}
        assert {str(s.i1), str(s.i2), str(s.qid)} <= ids and str(s.i3) not in ids
        # 期限範囲＝time_limit を持つ i1 のみ（i2 は未設定で除外）。
        r2 = client.get("/api/v1/info-link-candidates", params={"types": "ideas", "q": "候補ピッカーI_ZZ", "due_from": "2026-11-01", "due_to": "2026-12-31"})
        ids2 = {c["target_id"] for c in r2.json()["candidates"]}
        assert ids2 == {str(s.i1)}
    finally:
        _cleanup_link_targets(info_env.db_identifier, s)


def test_n_tc_143_candidate_pagination(client, info_env):
    """N-TC-143: 候補のページング（limit＋cursor）で重複なく続きが取れる。"""
    s = _seed_link_targets(info_env.db_identifier)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    try:
        # published idea は i1/i2 の2件。limit=1 で 1件＋next_cursor→続きで残り1件。
        r1 = client.get("/api/v1/info-link-candidates", params={"types": "ideas", "q": "候補ピッカーI_ZZ", "limit": 1})
        b1 = r1.json()
        assert len(b1["candidates"]) == 1 and b1["next_cursor"] is not None
        r2 = client.get("/api/v1/info-link-candidates", params={"types": "ideas", "q": "候補ピッカーI_ZZ", "limit": 1, "cursor": b1["next_cursor"]})
        b2 = r2.json()
        assert len(b2["candidates"]) == 1 and b2["next_cursor"] is None
        assert b1["candidates"][0]["target_id"] != b2["candidates"][0]["target_id"]  # 重複なし
    finally:
        _cleanup_link_targets(info_env.db_identifier, s)


def test_n_tc_144_content_revisions(client, info_env):
    """N-TC-144: 内容編集で更新履歴（content_revisions）を版降順で返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # 作成者本人（ids.a）が内容を2回編集＝2版増える。
    before = len(client.get(f"{INFO}/{info_env.ids.a}").json()["content_revisions"])
    assert client.patch(f"{INFO}/{info_env.ids.a}", json={"body_html": "<p>更新履歴テスト1</p>"}, headers=_csrf(client)).status_code == 200
    assert client.patch(f"{INFO}/{info_env.ids.a}", json={"body_html": "<p>更新履歴テスト2</p>"}, headers=_csrf(client)).status_code == 200
    revs = client.get(f"{INFO}/{info_env.ids.a}").json()["content_revisions"]
    assert len(revs) == before + 2
    assert revs[0]["revision"] > revs[1]["revision"]  # 版降順（新しい版が先頭）
    assert all(("editor_name" in x and x.get("created_at")) for x in revs)


def test_n_tc_145_create_with_curation_requires_curator(client, info_env):
    """N-TC-145: 登録時の属性付与は curator のみ（非curator=403／curator=201・curated）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # 非curator が属性つきで登録 → 403。
    r = client.post(INFO, json={"title": "属性つき登録X", "priority": "high"}, headers=_csrf(client))
    assert r.status_code == 403, r.text
    # curator に昇格して登録 → 201・status=curated で属性反映。
    _grant_curator(info_env.db_identifier, info_env.user_id)
    try:
        r2 = client.post(INFO, json={"title": "属性つき登録Y", "priority": "high", "impact_class": "opportunity"}, headers=_csrf(client))
        assert r2.status_code == 201, r2.text
        d = r2.json()
        try:
            assert d["status"] == "curated" and d["priority"] == "high" and d["impact_class"] == "opportunity"
        finally:
            _delete_info(info_env.db_identifier, d["id"])
    finally:
        _revoke_curators(info_env.db_identifier, info_env.user_id)


def test_n_tc_146_capabilities(client, info_env):
    """N-TC-146: 現ユーザーの curator 判定（登録フォーム出し分け用）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get("/api/v1/info-capabilities").json()["can_curate"] is False
    _grant_curator(info_env.db_identifier, info_env.user_id)
    try:
        assert client.get("/api/v1/info-capabilities").json()["can_curate"] is True
    finally:
        _revoke_curators(info_env.db_identifier, info_env.user_id)


def test_n_tc_147_create_records_initial_revision(client, info_env):
    """N-TC-147: 登録直後に初版（版1）が記録され更新履歴に出る（内容編集を待たない・§85/N.1）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(INFO, json={"title": "初版記録テスト", "body_html": "<p>本文です。</p>"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    try:
        assert len(d["content_revisions"]) == 1 and d["content_revisions"][0]["revision"] == 1
    finally:
        _delete_info(info_env.db_identifier, d["id"])


def test_n_tc_211_revision_changed_fields(client, info_env):
    """N-TC-211: 更新履歴 content_revisions に前版比の changed_fields が付く（初版は空・§85）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(INFO, json={"title": "変更履歴X", "body_html": "<p>旧本文</p>"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    try:
        # 初版（版1）は changed_fields 空。
        assert d["content_revisions"][0]["revision"] == 1
        assert d["content_revisions"][0]["changed_fields"] == []
        # 本文だけ変更 → 版2 の changed_fields=["body_html"]。
        assert client.patch(f"{INFO}/{d['id']}", json={"body_html": "<p>新本文</p>"}, headers=_csrf(client)).status_code == 200
        revs = client.get(f"{INFO}/{d['id']}").json()["content_revisions"]
        assert revs[0]["revision"] == 2
        assert revs[0]["changed_fields"] == ["body_html"]
    finally:
        _delete_info(info_env.db_identifier, d["id"])


def test_n_tc_212_revision_diff(client, info_env):
    """N-TC-212: 版差分 EP＝テキスト差分（add/del/equal セグメント）を変わったフィールドのみ返す（§85）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(INFO, json={"title": "差分タイトルA", "body_html": "<p>本文</p>"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    try:
        # タイトルを変更 → 版2。
        assert client.patch(f"{INFO}/{d['id']}", json={"title": "差分タイトルB"}, headers=_csrf(client)).status_code == 200
        diff = client.get(f"{INFO}/{d['id']}/revisions/2/diff")
        assert diff.status_code == 200, diff.text
        body = diff.json()
        assert body["from_revision"] == 1 and body["to_revision"] == 2
        # 変わったのは title のみ（body_html は不変＝差分に出ない）。
        assert set(body["fields"].keys()) == {"title"}
        title_diff = body["fields"]["title"]
        assert title_diff["kind"] == "text"
        ops = {s["op"] for s in title_diff["segments"]}
        assert "del" in ops and "add" in ops  # A→B の置換＝削除+追加セグメント
        # 範囲外の版は 404。
        assert client.get(f"{INFO}/{d['id']}/revisions/99/diff").status_code == 404
    finally:
        _delete_info(info_env.db_identifier, d["id"])


def test_n_tc_214_search_match_snippet(client, info_env):
    """N-TC-214: 全文検索（q）は一致箇所の抜粋 match_snippet を返す＝要約に出ない語での一致も可視化（§1.11）。
    q 無しの一覧では match_snippet は None（検索時のみの付加情報）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # 要約（先頭約150字）に一致語を含めないため、フィラー文を先に並べ、末尾の文に特徴語を置く。
    filler = "".join([
        "これは全文検索の一致抜粋を確認するためのダミー本文の説明文になります。",
        "本文は要約の対象となる先頭部分に特徴語を含めないよう十分に長くしてあります。",
        "検索の対象はタイトルと本文（body_text）で要約ではないことを確かめます。",
        "したがって要約抜粋に出ない語で一致しても抜粋で該当箇所を見せる必要があります。",
    ])
    body = f"<p>{filler}末尾の一文にだけ特徴語ゾルタンネスビットが登場します。</p>"
    r = client.post(INFO, json={"title": "抜粋テスト", "body_html": body}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    try:
        assert "ゾルタンネスビット" not in (d.get("summary") or ""), "前提崩れ＝一致語が要約に入ってしまった"
        hit = next((c for c in client.get(INFO, params={"q": "ゾルタンネスビット"}).json()["data"] if c["id"] == d["id"]), None)
        assert hit is not None, "全文検索でヒットしない"
        assert hit["match_snippet"] and "ゾルタンネスビット" in hit["match_snippet"], f"抜粋に一致語が無い: {hit.get('match_snippet')!r}"
        # q 無しの一覧では match_snippet は付かない。
        hit2 = next((c for c in client.get(INFO).json()["data"] if c["id"] == d["id"]), None)
        assert hit2 is not None and hit2["match_snippet"] is None
    finally:
        _delete_info(info_env.db_identifier, d["id"])


def test_n_tc_148_summary_capped(client, info_env):
    """N-TC-148: 選別用要約は約150字で丸める（長い記事でも一覧/選別で一目・末尾…・§12-3）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    sents = [
        "生成AIの業務利用が急速に拡大しており各社が対応を迫られている状況にあります。",
        "特にカスタマーサポート領域での自動応答の導入が顕著に進んでいると報告されています。",
        "一方で情報漏洩や品質のばらつきといった無視できないリスクも同時に指摘されています。",
        "各社はガイドライン整備と社内教育の両輪で慎重に対応を進める必要があるとされています。",
        "競合他社の先行事例では現場の生産性が大幅に向上したとする調査結果も出てきています。",
        "今後は規制動向を注視しつつ段階的な展開を図ることが現実的な選択肢になるでしょう。",
    ]
    body = "<p>" + "".join(sents) + "</p>"
    r = client.post(INFO, json={"title": "要約長テスト", "body_html": body}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    try:
        assert d["summary"], "要約が空"
        assert len(d["summary"]) <= 151, f"要約が長すぎる（{len(d['summary'])}字）: {d['summary']}"
        assert d["summary"].endswith("…"), "丸めた要約は末尾…"
    finally:
        _delete_info(info_env.db_identifier, d["id"])


def test_n_tc_119_add_link(client, info_env):
    """N-TC-119: 手動リンク追加（全員・201・origin=manual・kind=related）。"""
    import uuid as _uuid
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(LINKS, json={"info_item_id": str(info_env.ids.d), "target_type": "quests",
                                 "target_id": str(_uuid.uuid4())}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["origin"] == "manual" and d["kind"] == "related" and d["target_type"] == "quests"


def test_n_tc_120_duplicate_link_409(client, info_env):
    """N-TC-120: 同一 (info,target,type) の重複は 409。"""
    import uuid as _uuid
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    body = {"info_item_id": str(info_env.ids.d), "target_type": "ideas", "target_id": str(_uuid.uuid4())}
    assert client.post(LINKS, json=body, headers=_csrf(client)).status_code == 201
    r2 = client.post(LINKS, json=body, headers=_csrf(client))
    assert r2.status_code == 409, r2.text
    assert r2.json()["code"] == "conflict"


def test_n_tc_223_readd_revives_rejected_link(client, info_env):
    """N-TC-223: 棄却済みリンクの再追加は 409 ではなく復活（rejected_at→NULL・選んだ種別で上書き）。

    成果物側の逆向きピッカーは棄却行を知らずに再追加を試みる（read EP が rejected を返さない）。
    UNIQUE (info,target,type) のため INSERT 不可＝既存棄却行を再活性させる。
    """
    import uuid as _uuid
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    tid = str(_uuid.uuid4())
    body = {"info_item_id": str(info_env.ids.d), "target_type": "quests", "target_id": tid}
    r1 = client.post(LINKS, json=body, headers=_csrf(client))
    assert r1.status_code == 201, r1.text
    lid = r1.json()["id"]
    assert client.post(f"{LINKS}/{lid}/reject", headers=_csrf(client)).json()["rejected"] is True
    # 棄却後に同一 (info,target,type) を別種別で再追加＝409 ではなく復活（201）。
    r2 = client.post(LINKS, json={**body, "kind": "refuting"}, headers=_csrf(client))
    assert r2.status_code == 201, r2.text
    d = r2.json()
    assert d["id"] == lid                    # 同一行を再活性（新規 INSERT ではない）
    assert d["rejected"] is False            # 復活（rejected_at→NULL）
    assert d["kind"] == "refuting"           # 選んだ種別で上書き
    assert d["origin"] == "manual"


def test_n_tc_121_change_link_kind(client, info_env):
    """N-TC-121: 種別変更（related→refuting）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    lid = _new_link(client, info_env)
    r = client.patch(f"{LINKS}/{lid}", json={"kind": "refuting"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "refuting"


def test_n_tc_122_reject_unreject(client, info_env):
    """N-TC-122: 棄却／棄却解除（rejected_at セット→NULL）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    lid = _new_link(client, info_env)
    assert client.post(f"{LINKS}/{lid}/reject", headers=_csrf(client)).json()["rejected"] is True
    assert client.post(f"{LINKS}/{lid}/unreject", headers=_csrf(client)).json()["rejected"] is False


def test_n_tc_123_link_enum_validation(client, info_env):
    """N-TC-123: enum 検証（target_type/kind）。"""
    import uuid as _uuid
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(LINKS, json={"info_item_id": str(info_env.ids.d), "target_type": "bogus",
                                 "target_id": str(_uuid.uuid4())}, headers=_csrf(client))
    assert r.status_code == 422 and any(e.get("field") == "target_type" for e in r.json().get("errors", []))
    lid = _new_link(client, info_env)
    r2 = client.patch(f"{LINKS}/{lid}", json={"kind": "bogus"}, headers=_csrf(client))
    assert r2.status_code == 422 and any(e.get("field") == "kind" for e in r2.json().get("errors", []))


def test_n_tc_112_create(client, info_env):
    """N-TC-112: 低摩擦登録（全員・201・サニタイズ→body_text→tokens→summary）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(INFO, json={
        "title": "新規情報（テスト）",
        "body_html": "<p>生成AIの<strong>導入</strong>が拡大している。<script>alert(1)</script></p>",
    }, headers=_csrf(client))
    assert r.status_code == 201, r.text
    d = r.json()
    try:
        assert d["status"] == "raw" and d["title"] == "新規情報（テスト）"
        assert "<script" not in (d["body_html"] or "")   # サニタイズ済み
        assert d["can"]["edit_content"] is True           # 作成者本人
        assert d["tokens_top"]                            # トークンが生成される
    finally:
        _delete_info(info_env.db_identifier, d["id"])


def test_n_tc_113_source_url_validation(client, info_env):
    """N-TC-113: 出典URL は http/https のみ（422・field=source_url）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(INFO, json={"title": "x", "source_url": "javascript:evil()"}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e.get("field") == "source_url" for e in r.json().get("errors", []))


def test_n_tc_114_title_required(client, info_env):
    """N-TC-114: title 必須（422・field=title）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(INFO, json={"title": "   "}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e.get("field") == "title" for e in r.json().get("errors", []))


def test_n_tc_108_detail_shape(client, info_env):
    """N-TC-108: 詳細が DTO 形状（全属性＋links＋thread＋tokens_top＋can）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(f"{INFO}/{info_env.ids.a}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["id"] == str(info_env.ids.a)
    assert d["status"] == "curated" and d["impact_class"] == "opportunity"
    assert set(d["categories"]) == {"ext_technology", "ext_industry"}
    assert "body_html" in d and "summary" in d
    assert len(d["links"]) == 3 and any(l["rejected"] for l in d["links"])  # 棄却1件含む
    assert d["thread"]["parent"] is None
    assert {t["id"] for t in d["thread"]["follow_ups"]} == {str(info_env.ids.fu1), str(info_env.ids.fu2)}
    assert d["tokens_top"] and d["tokens_top"][0]["token"] == "生成ai"
    assert set(d["can"].keys()) == {"edit_content", "curate", "add_link"}


def test_n_tc_140_follow_up_detail_thread_root_based(client, info_env):
    """N-TC-140: 続報を開くと root 基準の続報スレッド（parent=根・follow_ups=根の全続報）を返す（SC-50 §80）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    d = client.get(f"{INFO}/{info_env.ids.fu1}").json()  # 続報 fu1 を開く
    assert d["thread"]["parent"] and d["thread"]["parent"]["id"] == str(info_env.ids.a)  # 元情報＝根 a
    # 続報から開いても根の全続報（fu1/fu2）が時系列で返る＝続報側で「続報スレッドが空」にならない。
    assert {t["id"] for t in d["thread"]["follow_ups"]} == {str(info_env.ids.fu1), str(info_env.ids.fu2)}


def test_n_tc_109_can_flags(client, info_env):
    """N-TC-109: can＝作成者(edit_content)／curator(curate)／全員(add_link)。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # info_env は seed 一般ユーザーを作成者にしているので edit_content=true・curate=false・add_link=true。
    d = client.get(f"{INFO}/{info_env.ids.a}").json()
    assert d["can"]["edit_content"] is True   # 本人が作成者
    assert d["can"]["curate"] is False        # curator 未付与
    assert d["can"]["add_link"] is True       # 全員


def test_n_tc_110_not_found_404(client, info_env):
    """N-TC-110: 不在/他テナントは 404（存在秘匿）。"""
    import uuid as _uuid
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(f"{INFO}/{_uuid.uuid4()}")
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "not_found"


def test_n_tc_111_detail_unauthenticated_401(client, info_env):
    """N-TC-111: 未認証は 401。"""
    r = client.get(f"{INFO}/{info_env.ids.a}")
    assert r.status_code == 401, r.text


def test_n_tc_106_word_cloud(client, info_env):
    """N-TC-106: ワードクラウドが tokens[] を count 降順で返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(WORD_CLOUD)
    assert r.status_code == 200, r.text
    tokens = r.json()["tokens"]
    assert tokens and tokens[0]["token"] == "生成ai"
    counts = [t["count"] for t in tokens]
    assert counts == sorted(counts, reverse=True)


def test_n_tc_125_rehost_image(client, info_env):
    """N-TC-125: 貼付画像を自社ホスト（MinIO）へ再ホスト＝201・自社署名URL（外部参照を持ち込まない）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(IMAGES, files={"file": ("p.png", PNG, "image/png")}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    assert url and "info-images/" in url  # 自社ホスト（prefix=info-images）へ保存された署名URL


def test_n_tc_126_rehost_image_signature_mismatch(client, info_env):
    """N-TC-126: 申告 image/png だが中身が非画像→422 validation_error（field=file・MIME 偽装拒否）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(IMAGES, files={"file": ("p.png", b"not really a png", "image/png")}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "file" for e in body.get("errors", []))


# 有効な PDF（%PDF- シグネチャ）＝validate_attachment_upload は拡張子→MIME＋マジックバイトを検証。
PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n" + b"0" * 64


def test_n_tc_127_add_attachment(client, info_env):
    """N-TC-127: 参考資料の追加（作成者・201）＝詳細の attachments[] に署名 url 付きで現れる。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # info_env.ids.a は seed 一般ユーザー（ログイン本人）が作成者＝内容群を編集可。
    r = client.post(f"{INFO}/{info_env.ids.a}/attachments",
                    files={"files": ("ref.pdf", PDF, "application/pdf")}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    atts = r.json()["attachments"]
    assert any(a["original_name"] == "ref.pdf" and a["url"] for a in atts)
    # 詳細にも反映（署名 url・uploaded_by）。
    d = client.get(f"{INFO}/{info_env.ids.a}").json()
    got = next((a for a in d["attachments"] if a["original_name"] == "ref.pdf"), None)
    assert got is not None and got["url"] and got["mime_type"] == "application/pdf"
    assert got["uploaded_by"]["user_id"] == str(info_env.user_id)


def test_n_tc_128_add_attachment_forbidden(client, info_env):
    """N-TC-128: 参考資料は作成者のみ（非作成者の情報へ添付は 403）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    other_id, other_uid = _seed_other_item(info_env.db_identifier)
    try:
        r = client.post(f"{INFO}/{other_id}/attachments",
                        files={"files": ("ref.pdf", PDF, "application/pdf")}, headers=_csrf(client))
        assert r.status_code == 403, r.text
        assert r.json()["code"] == "forbidden"
    finally:
        _delete_info(info_env.db_identifier, str(other_id))
        _delete_user(info_env.db_identifier, other_uid)


def test_n_tc_129_remove_attachment(client, info_env):
    """N-TC-129: 参考資料の削除（作成者・204）＝詳細から消える／他情報の aid は 404。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(f"{INFO}/{info_env.ids.a}/attachments",
                    files={"files": ("del.pdf", PDF, "application/pdf")}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    aid = next(a["id"] for a in r.json()["attachments"] if a["original_name"] == "del.pdf")
    # 別情報配下の aid は 404（所属チェック）。
    r404 = client.delete(f"{INFO}/{info_env.ids.d}/attachments/{aid}", headers=_csrf(client))
    assert r404.status_code == 404, r404.text
    # 正しい情報配下なら 204。
    r204 = client.delete(f"{INFO}/{info_env.ids.a}/attachments/{aid}", headers=_csrf(client))
    assert r204.status_code == 204, r204.text
    d = client.get(f"{INFO}/{info_env.ids.a}").json()
    assert all(a["id"] != aid for a in d["attachments"])


def test_n_tc_130_add_attachment_validation(client, info_env):
    """N-TC-130: 参考資料の検証（拡張子外/シグネチャ不一致は 422・field=files・部分保存しない）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(f"{INFO}/{info_env.ids.a}/attachments",
                    files={"files": ("evil.exe", b"MZ\x90\x00malware", "application/octet-stream")}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "files" for e in body.get("errors", []))
    # 部分保存しない＝詳細に混入していない。
    d = client.get(f"{INFO}/{info_env.ids.a}").json()
    assert all(a["original_name"] != "evil.exe" for a in d["attachments"])


def test_n_tc_131_archive(client, info_env):
    """N-TC-131: アーカイブ（curator・論理削除）＝status=archived・既定一覧から消える・非curator は 403。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # 非 curator は 403。
    r403 = client.post(f"{INFO}/{info_env.ids.a}/archive", headers=_csrf(client))
    assert r403.status_code == 403, r403.text
    _grant_curator(info_env.db_identifier, info_env.user_id)
    try:
        r = client.post(f"{INFO}/{info_env.ids.a}/archive", headers=_csrf(client))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "archived"
        # 既定一覧（archived 除外）から消える。
        ids = {c["id"] for c in client.get(INFO).json()["data"]}
        assert str(info_env.ids.a) not in ids
    finally:
        _revoke_curators(info_env.db_identifier, info_env.user_id)


def test_n_tc_132_unarchive(client, info_env):
    """N-TC-132: アーカイブ解除（curator）＝属性があれば curated へ戻る。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    _grant_curator(info_env.db_identifier, info_env.user_id)
    try:
        client.post(f"{INFO}/{info_env.ids.a}/archive", headers=_csrf(client))
        r = client.post(f"{INFO}/{info_env.ids.a}/unarchive", headers=_csrf(client))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "curated"  # ids.a は priority/impact_class/categories あり＝curated へ
        ids = {c["id"] for c in client.get(INFO).json()["data"]}
        assert str(info_env.ids.a) in ids  # 既定一覧に復帰
    finally:
        _revoke_curators(info_env.db_identifier, info_env.user_id)


def test_n_tc_133_archived_facet_and_tab(client, info_env):
    """N-TC-133: facets に archived 件数／status=archived で archived 行のみ返る。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    body = client.get(INFO).json()
    facets = body["facets"]
    assert "archived" in facets and facets["archived"] >= 1  # seed の ids.c が archived
    assert facets["all"] == facets["raw"] + facets["curated"]  # all は非archived
    # archived タブ＝archived のみ。
    arch = client.get(INFO, params={"status": "archived"}).json()["data"]
    assert arch and all(c["status"] == "archived" for c in arch)
    assert str(info_env.ids.c) in {c["id"] for c in arch}


def test_n_tc_134_create_quest_from_info(client, info_env):
    """N-TC-134: この情報からクエスト作成＝逆リンク（quests/related/manual）を自動生成・不在は 422。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    quests = "/api/v1/quests"
    # 正常＝from_info_id 指定でクエスト作成 → 当該情報の links に quests への関連リンクが現れる。
    r = client.post(quests, json={"title": "この情報からのクエスト", "color": "#0D9488",
                                  "from_info_id": str(info_env.ids.a)}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    try:
        links = client.get(f"{INFO}/{info_env.ids.a}").json()["links"]
        got = next((l for l in links if l["target_type"] == "quests" and l["target_id"] == qid), None)
        assert got is not None
        assert got["kind"] == "related" and got["origin"] == "manual"
        assert got["target_title"] == "この情報からのクエスト"
    finally:
        _delete_quest(info_env.db_identifier, qid)
    # 不在の from_info_id は 422（field=from_info_id）。
    import uuid as _uuid
    r422 = client.post(quests, json={"title": "x", "color": "#0D9488", "from_info_id": str(_uuid.uuid4())}, headers=_csrf(client))
    assert r422.status_code == 422, r422.text
    assert any(e.get("field") == "from_info_id" for e in r422.json().get("errors", []))


def test_n_tc_135_delete_raw_owner(client, info_env):
    """N-TC-135: 未判定の物理削除＝本人・raw のみ 204／非本人 403／curated 済みは 409 invalid_state。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    rid = client.post(INFO, json={"title": "削除対象raw"}, headers=_csrf(client)).json()["id"]
    try:
        # 非本人（他者の情報）は 403。
        other_id, other_uid = _seed_other_item(info_env.db_identifier)
        try:
            assert client.delete(f"{INFO}/{other_id}", headers=_csrf(client)).status_code == 403
        finally:
            _delete_info(info_env.db_identifier, str(other_id)); _delete_user(info_env.db_identifier, other_uid)
        # curated 済み（ids.a＝本人作成・curated）は 409 invalid_state。
        r409 = client.delete(f"{INFO}/{info_env.ids.a}", headers=_csrf(client))
        assert r409.status_code == 409, r409.text
        assert any(e.get("reason") == "invalid_state" for e in r409.json().get("errors", []))
        # 本人の raw は 204・詳細から消える。
        assert client.delete(f"{INFO}/{rid}", headers=_csrf(client)).status_code == 204
        assert client.get(f"{INFO}/{rid}").status_code == 404
    finally:
        _delete_info(info_env.db_identifier, rid)  # 保険（204 済みなら no-op 相当）


def test_n_tc_136_delete_blocked_by_follow_ups(client, info_env):
    """N-TC-136: 続報がある raw 情報は削除不可（409 has_follow_ups・孤児化防止）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    pid = client.post(INFO, json={"title": "raw親"}, headers=_csrf(client)).json()["id"]
    fid = client.post(INFO, json={"title": "続報", "parent_info_id": pid}, headers=_csrf(client)).json()["id"]
    try:
        r = client.delete(f"{INFO}/{pid}", headers=_csrf(client))
        assert r.status_code == 409, r.text
        assert any(e.get("reason") == "has_follow_ups" for e in r.json().get("errors", []))
    finally:
        _delete_info(info_env.db_identifier, fid); _delete_info(info_env.db_identifier, pid)


def test_n_tc_137_curator_grant_revoke(client, info_env, factory):
    """N-TC-137: 情報判定権限の付与/剥奪（会社アカウント管理者のみ）＝付与201/一覧/二重409/剥奪204/未付与404/一般403。"""
    acc_id = _seed_member_account_id()
    try:
        # 一般ユーザーは付与不可（403）。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.post(CURATORS, json={"account_id": acc_id}, headers=_csrf(client)).status_code == 403
        # 会社アカウント管理者でログインし直して付与。
        admin = factory.make_seed_company_account(system_role="company_account_admin")
        _login(client, admin["company_code"], admin["login_id"], admin["password"])
        r = client.post(CURATORS, json={"account_id": acc_id}, headers=_csrf(client))
        assert r.status_code == 201, r.text
        assert any(c["account_id"] == acc_id for c in r.json()["data"])
        # 二重付与は 409。
        assert client.post(CURATORS, json={"account_id": acc_id}, headers=_csrf(client)).status_code == 409
        # 一覧に出現。
        assert any(c["account_id"] == acc_id for c in client.get(CURATORS).json()["data"])
        # 剥奪 204 → 一覧から消える → 未付与の再剥奪は 404。
        assert client.delete(f"{CURATORS}/{acc_id}", headers=_csrf(client)).status_code == 204
        assert all(c["account_id"] != acc_id for c in client.get(CURATORS).json()["data"])
        assert client.delete(f"{CURATORS}/{acc_id}", headers=_csrf(client)).status_code == 404
    finally:
        _purge_curators(info_env.db_identifier)  # 権限漏れ防止（他テスト保護）


def test_n_tc_138_refuting_link_notifies(client, info_env):
    """N-TC-138: 反証リンク作成で作成者/評価者/クエスト管理者へ info_refuting_raised（本人は除外）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    seed = _seed_quest_idea_vote(info_env.db_identifier)
    try:
        # 本人（member）が ids.d（member 作成）→ idea へ反証リンクを作成。
        r = client.post(LINKS, json={"info_item_id": str(info_env.ids.d), "target_type": "ideas",
                                     "target_id": str(seed.idea_id), "kind": "refuting"}, headers=_csrf(client))
        assert r.status_code == 201, r.text
        notified = _notified(info_env.db_identifier, "info_refuting_raised", seed.users)
        assert {seed.owner, seed.author, seed.voter} <= notified  # 3者全員に通知
    finally:
        _cleanup_refuting_seed(info_env.db_identifier, seed)


def test_n_tc_139_change_to_refuting_notifies(client, info_env):
    """N-TC-139: related→refuting の遷移で通知が発火（related のままなら通知しない）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    seed = _seed_quest_idea_vote(info_env.db_identifier)
    try:
        # まず related で作成＝この時点では通知なし。
        r = client.post(LINKS, json={"info_item_id": str(info_env.ids.b), "target_type": "ideas",
                                     "target_id": str(seed.idea_id), "kind": "related"}, headers=_csrf(client))
        assert r.status_code == 201, r.text
        assert not _notified(info_env.db_identifier, "info_refuting_raised", seed.users)  # related は通知しない
        # refuting へ変更＝遷移で通知が飛ぶ。
        link_id = r.json()["id"]
        r2 = client.patch(f"{LINKS}/{link_id}", json={"kind": "refuting"}, headers=_csrf(client))
        assert r2.status_code == 200, r2.text
        assert {seed.owner, seed.author, seed.voter} <= _notified(info_env.db_identifier, "info_refuting_raised", seed.users)
    finally:
        _cleanup_refuting_seed(info_env.db_identifier, seed)
