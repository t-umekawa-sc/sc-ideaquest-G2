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
LINKS = "/api/v1/info-links"


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
    """作成した情報の後始末（tokens/links/item を物理削除）。"""
    from app.tenant.info.orm import InfoItem, InfoLink, InfoToken
    import uuid as _uuid
    iid = _uuid.UUID(info_id)
    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoToken.__table__.delete().where(InfoToken.info_item_id == iid))
        ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id == iid))
        ts.execute(InfoItem.__table__.delete().where(InfoItem.id == iid))
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
    assert {"all", "raw", "curated"} == set(facets.keys())
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
