"""N-TC-300〜327: 内部情報テンプレート（会社共通マスタ・N.5b・§5.37b・SC-55／SC-51 ピッカー）。

repository（一意制約/論理削除/一覧）＋application（サニタイズ/defaults 検証/疎結合）＋API（認可/CRUD）。
seed 会社 ACME-01 の会社DB に直接 seed／login して検証する。共有 dev DB ノイズ回避＝テンプレ名は一意化、
作成した template/info_item は teardown で物理削除する（テスト行）。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.info import application as svc
from app.tenant.info import repository as repo
from app.tenant.info.orm import InfoItem, InfoItemCategory, InfoItemRevision, InfoLink, InfoTemplate
from app.tenant.tokens.orm import EntityToken
from app.tenant.info.schemas import InfoTemplateCreateRequest, InfoTemplateUpdateRequest
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

TEMPLATES = "/api/v1/info-templates"
INFO = "/api/v1/info-items"


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def tpl_ctx():
    """会社DB の識別子＋seed ユーザー id＋teardown 用の作成 id トラッカ。"""
    with control_session() as s:
        comp = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        company_id, db_identifier = comp.id, comp.db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
        account_id = account.id
    with get_tenant_session(db_identifier) as ts:
        user = get_user_by_account(ts, account_id)
        assert user is not None
        user_id = user.id
    ctx = SimpleNamespace(company_id=company_id, db_identifier=db_identifier,
                          account_id=account_id, user_id=user_id, templates=[], items=[])
    yield ctx
    with get_tenant_session(db_identifier) as ts:
        if ctx.items:
            # 子（revisions/tokens/links/categories）→ 親（info_items）の順で物理削除（FK）。
            ts.execute(InfoItemRevision.__table__.delete().where(InfoItemRevision.info_item_id.in_(ctx.items)))
            ts.execute(EntityToken.__table__.delete().where(
                EntityToken.owner_type == "info", EntityToken.owner_id.in_(ctx.items)))
            ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id.in_(ctx.items)))
            ts.execute(InfoItemCategory.__table__.delete().where(InfoItemCategory.info_item_id.in_(ctx.items)))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id.in_(ctx.items)))
        if ctx.templates:
            ts.execute(InfoTemplate.__table__.delete().where(InfoTemplate.id.in_(ctx.templates)))
        ts.commit()


# ---- 4.1 repository（N-TC-300〜305）----------------------------------------

def test_n_tc_300_create_and_get_roundtrip(tpl_ctx):
    """N-TC-300: 作成・取得＋defaults jsonb 往復＋監査/既定。"""
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        tpl = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=_uniq("電話対応履歴"),
                                   body_html="<h2>対応日時</h2><p>（記入）</p>",
                                   defaults={"scope": "internal", "source": "customer"})
        ts.flush(); tpl_ctx.templates.append(tpl.id); ts.commit()
        got = repo.get_template(ts, tpl.id)
    assert got is not None
    assert got.defaults == {"scope": "internal", "source": "customer"}  # jsonb 往復
    assert got.created_by_id == tpl_ctx.user_id and got.is_active is True and got.sort_order == 0


def test_n_tc_301_name_unique_within_active(tpl_ctx):
    """N-TC-301: 名称は有効内一意＝重複作成は制約違反（アプリは 409 にマップ）。"""
    from sqlalchemy.exc import IntegrityError
    name = _uniq("作業報告書")
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        t1 = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=name, body_html="<p>x</p>")
        ts.flush(); tpl_ctx.templates.append(t1.id); ts.commit()
    assert repo.template_name_exists  # 事前判定 API が存在
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        assert repo.template_name_exists(ts, name) is True
        with pytest.raises(IntegrityError):
            repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=name, body_html="<p>y</p>")
            ts.flush()


def test_n_tc_302_deleted_name_reusable(tpl_ctx):
    """N-TC-302: 論理削除済みの名称は再利用可。"""
    import datetime as _dt
    name = _uniq("競合動向メモ")
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        t1 = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=name, body_html="<p>x</p>")
        ts.flush(); tpl_ctx.templates.append(t1.id)
        repo.soft_delete_template(ts, t1, deleted_by_id=tpl_ctx.user_id,
                                  now=_dt.datetime.now(_dt.timezone.utc))
        ts.commit()
        assert repo.template_name_exists(ts, name) is False  # 削除済みは一意対象外
        t2 = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=name, body_html="<p>y</p>")
        ts.flush(); tpl_ctx.templates.append(t2.id); ts.commit()
    assert t2.id != t1.id


def test_n_tc_303_inactive_still_unique(tpl_ctx):
    """N-TC-303: 無効（is_active=false）も一意対象に含める。"""
    name = _uniq("無効テンプレ")
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        t1 = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=name,
                                  body_html="<p>x</p>", is_active=False)
        ts.flush(); tpl_ctx.templates.append(t1.id); ts.commit()
        assert repo.template_name_exists(ts, name) is True  # 無効でも deleted_at IS NULL なら一意対象


def test_n_tc_304_picker_list_active_sorted(tpl_ctx):
    """N-TC-304: ピッカー一覧＝有効のみ・sort_order→name 昇順・無効/削除を除外。"""
    import datetime as _dt
    a = _uniq("A有効"); b = _uniq("B有効"); inact = _uniq("無効"); dele = _uniq("削除")
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        t_b = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=b, body_html="<p>b</p>", sort_order=2)
        t_a = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=a, body_html="<p>a</p>", sort_order=1)
        t_i = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=inact, body_html="<p>i</p>", is_active=False)
        t_d = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=dele, body_html="<p>d</p>")
        ts.flush()
        tpl_ctx.templates += [t_b.id, t_a.id, t_i.id, t_d.id]
        repo.soft_delete_template(ts, t_d, deleted_by_id=tpl_ctx.user_id, now=_dt.datetime.now(_dt.timezone.utc))
        ts.commit()
        rows = repo.list_active_templates(ts)
    ids = [r.id for r in rows]
    assert t_i.id not in ids and t_d.id not in ids
    # sort_order 昇順＝A(1) が B(2) より前。
    assert ids.index(t_a.id) < ids.index(t_b.id)


def test_n_tc_305_admin_list_includes_inactive_excludes_deleted(tpl_ctx):
    """N-TC-305: 管理一覧＝無効含む・論理削除は既定除外（include_deleted で含む）・q 絞込。"""
    import datetime as _dt
    tag = uuid.uuid4().hex[:6]
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        t_a = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=f"ACT-{tag}", body_html="<p>a</p>")
        t_i = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=f"INA-{tag}", body_html="<p>i</p>", is_active=False)
        t_d = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=f"DEL-{tag}", body_html="<p>d</p>")
        ts.flush(); tpl_ctx.templates += [t_a.id, t_i.id, t_d.id]
        repo.soft_delete_template(ts, t_d, deleted_by_id=tpl_ctx.user_id, now=_dt.datetime.now(_dt.timezone.utc))
        ts.commit()
        rows, total = repo.list_templates_admin(ts, q=tag)
        ids = {r.id for r in rows}
        assert t_a.id in ids and t_i.id in ids and t_d.id not in ids  # 無効含む・削除除外
        rows2, _ = repo.list_templates_admin(ts, q=tag, include_deleted=True)
        assert t_d.id in {r.id for r in rows2}


# ---- 4.2 application（N-TC-310〜315）---------------------------------------

def _create_req(**kw):
    kw.setdefault("name", _uniq("tpl"))
    kw.setdefault("body_html", "<p>（記入）</p>")
    return InfoTemplateCreateRequest(**kw)


def test_n_tc_310_body_html_sanitized(tpl_ctx):
    """N-TC-310: 本文ひな形は保存時 nh3 サニタイズ（管理者作成でも例外にしない）。"""
    res = svc.create_template(tpl_ctx.account_id, tpl_ctx.company_id,
                              body=_create_req(body_html='<p onclick="x()">hi</p><script>alert(1)</script>'
                                                         '<a href="javascript:evil()">l</a>'))
    tpl_ctx.templates.append(uuid.UUID(res["id"]))
    bh = res["body_html"]
    assert "<script" not in bh and "onclick" not in bh and "javascript:" not in bh


def test_n_tc_311_unknown_defaults_key_422(tpl_ctx):
    """N-TC-311: defaults の未知キーは 422 invalid_template_defaults。"""
    with pytest.raises(AppError) as ei:
        svc.create_template(tpl_ctx.account_id, tpl_ctx.company_id,
                            body=_create_req(defaults={"bogus_key": "x"}))
    assert ei.value.status == 422 and ei.value.code == "invalid_template_defaults"


def test_n_tc_312_invalid_default_value_422(tpl_ctx):
    """N-TC-312: defaults の値は当該 enum/category に実在（不正は 422）。"""
    with pytest.raises(AppError) as ei1:
        svc.create_template(tpl_ctx.account_id, tpl_ctx.company_id,
                            body=_create_req(defaults={"scope": "not_an_enum"}))
    assert ei1.value.status == 422 and ei1.value.code == "invalid_template_defaults"
    with pytest.raises(AppError) as ei2:
        svc.create_template(tpl_ctx.account_id, tpl_ctx.company_id,
                            body=_create_req(defaults={"categories": ["no_such_category"]}))
    assert ei2.value.status == 422 and ei2.value.code == "invalid_template_defaults"


def test_n_tc_313_valid_defaults_roundtrip(tpl_ctx):
    """N-TC-313: 正当な defaults（scalar＋categories）は保存・往復する。"""
    res = svc.create_template(tpl_ctx.account_id, tpl_ctx.company_id,
                              body=_create_req(defaults={"scope": "internal", "source": "customer",
                                                         "classification": "information",
                                                         "categories": ["internal_tech", "internal_tech"]}))
    tpl_ctx.templates.append(uuid.UUID(res["id"]))
    assert res["defaults"]["scope"] == "internal"
    assert res["defaults"]["categories"] == ["internal_tech"]  # 重複除去


def test_n_tc_314_edit_delete_does_not_touch_existing_info(tpl_ctx):
    """N-TC-314: テンプレの編集/論理削除は既存 info_items（source_template_id 参照）に影響しない（疎結合）。"""
    res = svc.create_template(tpl_ctx.account_id, tpl_ctx.company_id,
                              body=_create_req(body_html="<p>original</p>"))
    tid = uuid.UUID(res["id"]); tpl_ctx.templates.append(tid)
    # テンプレ由来で info_item を作成。
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        item = repo.create_info_item(ts, created_by_id=tpl_ctx.user_id, title="由来あり情報",
                                     body_html="<p>snapshot</p>", source_template_id=tid)
        ts.flush(); iid = item.id; tpl_ctx.items.append(iid); ts.commit()
    # テンプレを編集→論理削除。
    svc.update_template(tpl_ctx.account_id, tpl_ctx.company_id, str(tid),
                        body=InfoTemplateUpdateRequest(body_html="<p>CHANGED</p>"))
    svc.delete_template(tpl_ctx.account_id, tpl_ctx.company_id, str(tid))
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        got = repo.get_info_item(ts, iid)
        assert got.body_html == "<p>snapshot</p>"            # 本文は不変
        assert got.source_template_id == tid                 # 由来 ID は履歴として残る（削除後も）


def test_n_tc_315_source_template_recorded_or_ignored(tpl_ctx):
    """N-TC-315: source_template_id＝削除済みは記録・存在しない id は無視（NULL）＝作成は受理。"""
    import datetime as _dt
    # 論理削除済みテンプレ。
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        t = repo.create_template(ts, created_by_id=tpl_ctx.user_id, name=_uniq("del"), body_html="<p>x</p>")
        ts.flush(); deleted_id = t.id; tpl_ctx.templates.append(deleted_id)
        repo.soft_delete_template(ts, t, deleted_by_id=tpl_ctx.user_id, now=_dt.datetime.now(_dt.timezone.utc))
        ts.commit()
    from app.tenant.info.schemas import InfoCreateRequest
    # 削除済み id → 行は残るので FK OK・記録される。
    r1 = svc.create_info_item(tpl_ctx.account_id, tpl_ctx.company_id,
                              body=InfoCreateRequest(title="由来=削除済み", source_template_id=str(deleted_id)))
    tpl_ctx.items.append(uuid.UUID(r1["id"]))
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        assert repo.get_info_item(ts, uuid.UUID(r1["id"])).source_template_id == deleted_id
    # 存在しない id → 無視して NULL（作成は成功）。
    r2 = svc.create_info_item(tpl_ctx.account_id, tpl_ctx.company_id,
                              body=InfoCreateRequest(title="由来=不在", source_template_id=str(uuid.uuid4())))
    tpl_ctx.items.append(uuid.UUID(r2["id"]))
    with get_tenant_session(tpl_ctx.db_identifier) as ts:
        assert repo.get_info_item(ts, uuid.UUID(r2["id"])).source_template_id is None


# ---- 4.3 API 認可・CRUD（N-TC-320〜327）------------------------------------

@pytest.fixture
def tpl_admin(factory):
    """会社アカウント管理者（ACME・会社DB mirror 付き）のアカウント＝管理 EP のアクター。"""
    return factory.make_seed_company_account(system_role="company_account_admin")


def _login_admin(client, admin) -> None:
    _login(client, admin["company_code"], admin["login_id"], admin["password"])


def _track(tpl_ctx, res_json):
    tpl_ctx.templates.append(uuid.UUID(res_json["id"]))
    return res_json


def test_n_tc_320_picker_visible_to_general(client, tpl_admin, tpl_ctx):
    """N-TC-320: ピッカー供給＝会社内 active 全員（非管理者）が有効テンプレを取得。"""
    _login_admin(client, tpl_admin)
    created = _track(tpl_ctx, client.post(
        TEMPLATES, json={"name": _uniq("ピッカー"), "body_html": "<p>x</p>"}, headers=_csrf(client)).json())
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)  # 一般ユーザー
    r = client.get(TEMPLATES)
    assert r.status_code == 200
    assert any(t["id"] == created["id"] for t in r.json()["data"])


def test_n_tc_321_detail_active_only(client, tpl_admin, tpl_ctx):
    """N-TC-321: 適用詳細は有効のみ 200／無効は 404。"""
    _login_admin(client, tpl_admin)
    created = _track(tpl_ctx, client.post(
        TEMPLATES, json={"name": _uniq("詳細"), "body_html": "<h2>見出し</h2>"}, headers=_csrf(client)).json())
    tid = created["id"]
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(f"{TEMPLATES}/{tid}").status_code == 200
    _login_admin(client, tpl_admin)
    assert client.post(f"{TEMPLATES}/{tid}/deactivate", headers=_csrf(client)).status_code == 200
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(f"{TEMPLATES}/{tid}").status_code == 404


def test_n_tc_322_admin_list_requires_admin(client, tpl_admin, tpl_ctx):
    """N-TC-322: 管理一覧（admin=1）は会社管理者のみ・一般は 403。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(f"{TEMPLATES}?admin=1").status_code == 403
    _login_admin(client, tpl_admin)
    r = client.get(f"{TEMPLATES}?admin=1")
    assert r.status_code == 200 and "page_info" in r.json()


def test_n_tc_323_writes_require_admin(client, tpl_ctx):
    """N-TC-323: 作成/編集/削除は会社管理者のみ・一般は 403。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(TEMPLATES, json={"name": _uniq("x"), "body_html": "<p>x</p>"},
                       headers=_csrf(client)).status_code == 403
    assert client.patch(f"{TEMPLATES}/{uuid.uuid4()}", json={"name": "y"},
                        headers=_csrf(client)).status_code == 403
    assert client.delete(f"{TEMPLATES}/{uuid.uuid4()}", headers=_csrf(client)).status_code == 403


def test_n_tc_324_create_and_name_conflict(client, tpl_admin, tpl_ctx):
    """N-TC-324: 作成（管理者）→ 201／同名は 409。"""
    _login_admin(client, tpl_admin)
    name = _uniq("重複チェック")
    r1 = client.post(TEMPLATES, json={"name": name, "body_html": "<p>x</p>"}, headers=_csrf(client))
    assert r1.status_code == 201
    _track(tpl_ctx, r1.json())
    r2 = client.post(TEMPLATES, json={"name": name, "body_html": "<p>y</p>"}, headers=_csrf(client))
    assert r2.status_code == 409


def test_n_tc_325_activate_toggle_affects_picker(client, tpl_admin, tpl_ctx):
    """N-TC-325: 有効/無効トグル＝無効はピッカーから除外・activate で復帰。"""
    _login_admin(client, tpl_admin)
    created = _track(tpl_ctx, client.post(
        TEMPLATES, json={"name": _uniq("トグル"), "body_html": "<p>x</p>"}, headers=_csrf(client)).json())
    tid = created["id"]
    assert client.post(f"{TEMPLATES}/{tid}/deactivate", headers=_csrf(client)).status_code == 200
    assert all(t["id"] != tid for t in client.get(TEMPLATES).json()["data"])  # ピッカーから消える
    assert client.post(f"{TEMPLATES}/{tid}/activate", headers=_csrf(client)).status_code == 200
    assert any(t["id"] == tid for t in client.get(TEMPLATES).json()["data"])  # 復帰


def test_n_tc_326_delete_is_logical(client, tpl_admin, tpl_ctx):
    """N-TC-326: 削除は論理（204）・ピッカーと管理既定から除外。"""
    _login_admin(client, tpl_admin)
    created = _track(tpl_ctx, client.post(
        TEMPLATES, json={"name": _uniq("論理削除"), "body_html": "<p>x</p>"}, headers=_csrf(client)).json())
    tid = created["id"]
    assert client.delete(f"{TEMPLATES}/{tid}", headers=_csrf(client)).status_code == 204
    assert all(t["id"] != tid for t in client.get(TEMPLATES).json()["data"])              # ピッカー除外
    assert all(t["id"] != tid for t in client.get(f"{TEMPLATES}?admin=1").json()["data"])  # 管理既定も除外
