"""動的タブ（D4・§5.37c・N.5c）のテスト＝N-TC-335〜349。

「すべて」(system) の seed／タブ CRUD／予約語・同名・アーカイブ検証／tab_id フィルタ（「すべて」=全件）／
登録先・続報継承／タブ間移動（curator＋登録者・1件/一括）／auto_link_enabled／ワードクラウド絞り。
repository/application 直呼び（conftest.info_env の会社DB）＋一部 API（認可）。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update

from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.info import application as svc
from app.tenant.info import repository as repo
from app.tenant.info.orm import InfoItem, InfoItemCategory, InfoItemRevision, InfoLink, InfoTab
from app.tenant.profile.orm import User
from app.tenant.tokens.orm import EntityToken
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _acct_company() -> tuple[uuid.UUID, uuid.UUID]:
    with control_session() as s:
        aid = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one().id
        cid = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id
    return aid, cid


def _mk(**kw):
    """部分更新リクエストの簡易オブジェクト（schemas の属性アクセスを満たす）。"""
    return SimpleNamespace(**kw)


@pytest.fixture
def tab_env(info_env):
    """info_env（会社DB＋seed 情報）に account_id/company_id を足し、teardown でタブ/テスト行を掃除。"""
    aid, cid = _acct_company()
    new_items: list[uuid.UUID] = []
    new_users: list[uuid.UUID] = []
    yield SimpleNamespace(db=info_env.db_identifier, uid=info_env.user_id, aid=aid, cid=cid,
                          ids=info_env.ids, new_items=new_items, new_users=new_users)
    with get_tenant_session(info_env.db_identifier) as ts:
        sys = repo.get_system_tab(ts)
        if sys is not None:  # 移動した情報を「すべて」へ戻してから非 system タブを削除（FK）。
            ts.execute(update(InfoItem).where(InfoItem.tab_id != sys.id).values(tab_id=sys.id))
        ts.execute(InfoTab.__table__.delete().where(InfoTab.kind != "system"))
        if new_items:
            ts.execute(EntityToken.__table__.delete().where(
                EntityToken.owner_type == "info", EntityToken.owner_id.in_(new_items)))
            ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id.in_(new_items)))
            ts.execute(InfoItemCategory.__table__.delete().where(InfoItemCategory.info_item_id.in_(new_items)))
            ts.execute(InfoItemRevision.__table__.delete().where(InfoItemRevision.info_item_id.in_(new_items)))
            # 続報（子）→ 親の順（自己参照 FK）。
            ts.execute(InfoItem.__table__.delete().where(InfoItem.parent_info_id.in_(new_items)))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id.in_(new_items)))
        if new_users:
            ts.execute(User.__table__.delete().where(User.id.in_(new_users)))
        repo.revoke_curator(ts, info_env.user_id)  # テストで付与した curator を戻す
        ts.commit()


def test_n_tc_335_system_tab_seeded(tab_env):
    """N-TC-335: 「すべて」(system・sort_order=0) が seed 済み・既存情報は tab_id=すべて。"""
    with get_tenant_session(tab_env.db) as ts:
        sys = repo.get_system_tab(ts)
        assert sys is not None and sys.kind == "system" and sys.sort_order == 0 and sys.name == "すべて"
        item = repo.get_info_item(ts, tab_env.ids.a)
        assert item.tab_id == sys.id  # トリガ/backfill で「すべて」へ


def test_n_tc_336_create_tab(tab_env):
    """N-TC-336: タブ作成＝kind=user・sort_order 採番・作成者記録。"""
    dto = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="情報共有"))
    assert dto["kind"] == "user" and dto["status"] == "active" and dto["sort_order"] >= 1
    assert dto["is_system"] is False and dto["count"] == 0


def test_n_tc_337_reserved_name_rejected(tab_env):
    """N-TC-337: 予約語「すべて」「カメリオ連携」は作成/改名不可（422 reserved_tab_name）。"""
    for name in ("すべて", "カメリオ連携"):
        with pytest.raises(AppError) as e:
            svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name=name))
        assert e.value.status == 422 and e.value.code == "reserved_tab_name"
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="改名元"))
    with pytest.raises(AppError) as e2:
        svc.update_info_tab(tab_env.aid, tab_env.cid, tab["id"], is_admin=True, body=_mk(name="カメリオ連携"))
    assert e2.value.status == 422 and e2.value.code == "reserved_tab_name"


def test_n_tc_338_duplicate_name_rejected(tab_env):
    """N-TC-338: active 同名は 409 conflict。"""
    svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="情報共有"))
    with pytest.raises(AppError) as e:
        svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="情報共有"))
    assert e.value.status == 409 and e.value.code == "conflict"


def test_n_tc_339_archive_only_when_empty(tab_env):
    """N-TC-339: 配下に情報があればアーカイブ不可（409 tab_not_empty）・空なら可。"""
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="空タブ"))
    # 空タブはアーカイブ可。
    dto = svc.update_info_tab(tab_env.aid, tab_env.cid, tab["id"], is_admin=True, body=_mk(status="archived"))
    assert dto["status"] == "archived"
    # 情報を入れたタブはアーカイブ不可。
    tab2 = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="満タブ"))
    with get_tenant_session(tab_env.db) as ts:
        repo.move_item_tab(ts, tab_env.ids.d, uuid.UUID(tab2["id"]))
        ts.commit()
    with pytest.raises(AppError) as e:
        svc.update_info_tab(tab_env.aid, tab_env.cid, tab2["id"], is_admin=True, body=_mk(status="archived"))
    assert e.value.status == 409 and e.value.code == "tab_not_empty"


def test_n_tc_340_system_tab_protected(tab_env):
    """N-TC-340: 「すべて」(system) は改名/アーカイブ不可（403）。"""
    with get_tenant_session(tab_env.db) as ts:
        sys_id = str(repo.get_system_tab(ts).id)
    with pytest.raises(AppError) as e1:
        svc.update_info_tab(tab_env.aid, tab_env.cid, sys_id, is_admin=True, body=_mk(name="全部"))
    assert e1.value.status == 403
    with pytest.raises(AppError) as e2:
        svc.update_info_tab(tab_env.aid, tab_env.cid, sys_id, is_admin=True, body=_mk(status="archived"))
    assert e2.value.status == 403


def test_n_tc_341_list_tab_filter_all_shows_everything(tab_env):
    """N-TC-341: tab_id フィルタ＝指定タブで絞る／「すべて」は全件（他タブ所属も含む）。"""
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="競合動向"))
    with get_tenant_session(tab_env.db) as ts:
        repo.move_item_tab(ts, tab_env.ids.b, uuid.UUID(tab["id"]))  # ids.b を競合動向へ
        ts.commit()
        sys_id = str(repo.get_system_tab(ts).id)
    # そのタブ＝ids.b のみ。
    only = svc.get_info_items(tab_env.aid, tab_env.cid, tab_id=tab["id"])
    assert {r["id"] for r in only["data"]} == {str(tab_env.ids.b)}
    # 「すべて」＝全件（ids.b も含む・非 archived）。
    allv = svc.get_info_items(tab_env.aid, tab_env.cid, tab_id=sys_id)
    ids_all = {r["id"] for r in allv["data"]}
    assert str(tab_env.ids.b) in ids_all and str(tab_env.ids.a) in ids_all
    # tab_id 未指定も全件。
    none = svc.get_info_items(tab_env.aid, tab_env.cid)
    assert {r["id"] for r in none["data"]} == ids_all


def _create_body(**over):
    """svc.create_info_item 用の body（全属性 None 既定・over で上書き）。"""
    base = dict(title="情報", body={"type": "doc", "content": []}, source_url=None,
                parent_info_id=None, tab_id=None, auto_link_enabled=None, source_template_id=None,
                **{k: None for k in ("priority", "source", "classification", "scope", "target_business",
                                     "impact_level", "impact_class", "impact_timing", "triage",
                                     "triage_reason", "triaged_on", "due_date", "categories")})
    base.update(over)
    return _mk(**base)


def test_n_tc_342_register_tab_and_inherit(tab_env):
    """N-TC-342: 登録先＝指定で所属・省略で「すべて」・続報は親継承。"""
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="技術トレンド"))
    with get_tenant_session(tab_env.db) as ts:
        sys_id = repo.get_system_tab(ts).id
    # 指定タブへ。
    d1 = svc.create_info_item(tab_env.aid, tab_env.cid, body=_create_body(title="指定タブ", tab_id=tab["id"]))
    tab_env.new_items.append(uuid.UUID(d1["id"]))
    # 省略＝すべて。
    d2 = svc.create_info_item(tab_env.aid, tab_env.cid, body=_create_body(title="省略"))
    tab_env.new_items.append(uuid.UUID(d2["id"]))
    # 続報は親（技術トレンド）継承。
    d3 = svc.create_info_item(tab_env.aid, tab_env.cid, body=_create_body(title="続報", parent_info_id=d1["id"]))
    tab_env.new_items.append(uuid.UUID(d3["id"]))
    with get_tenant_session(tab_env.db) as ts:
        assert repo.get_info_item(ts, uuid.UUID(d1["id"])).tab_id == uuid.UUID(tab["id"])
        assert repo.get_info_item(ts, uuid.UUID(d2["id"])).tab_id == sys_id
        assert repo.get_info_item(ts, uuid.UUID(d3["id"])).tab_id == uuid.UUID(tab["id"])


def test_n_tc_343_move_permission_single(tab_env):
    """N-TC-343: タブ移動（1件）＝curator は任意・登録者は自分のみ・他人は 403。"""
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="移動先"))
    # 他ユーザー所有の情報を作る。
    with get_tenant_session(tab_env.db) as ts:
        other = User(id=uuid.uuid4(), account_id=uuid.uuid4(), display_name="他者", locale="ja", status="active")
        ts.add(other); ts.flush()
        tab_env.new_users.append(other.id)
        other_item = repo.create_info_item(ts, created_by_id=other.id, title="他者の情報")
        ts.flush()
        tab_env.new_items.append(other_item.id)
        oid = str(other_item.id)
        ts.commit()
    # 自分の情報（ids.d）は非 curator でも移動可。
    svc.move_info_item_tab(tab_env.aid, tab_env.cid, str(tab_env.ids.d), tab_id=tab["id"])
    # 他者の情報は非 curator では 403。
    with pytest.raises(AppError) as e:
        svc.move_info_item_tab(tab_env.aid, tab_env.cid, oid, tab_id=tab["id"])
    assert e.value.status == 403
    # curator 付与後は他者の情報も移動可。
    with get_tenant_session(tab_env.db) as ts:
        repo.grant_curator(ts, tab_env.uid, tab_env.uid); ts.commit()
    svc.move_info_item_tab(tab_env.aid, tab_env.cid, oid, tab_id=tab["id"])


def test_n_tc_344_bulk_move_fail_closed(tab_env):
    """N-TC-344: 一括移動＝権限外混在は fail-closed 403（何も移動しない）・curator は全件可。"""
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="一括先"))
    with get_tenant_session(tab_env.db) as ts:
        other = User(id=uuid.uuid4(), account_id=uuid.uuid4(), display_name="他者2", locale="ja", status="active")
        ts.add(other); ts.flush()
        tab_env.new_users.append(other.id)
        other_item = repo.create_info_item(ts, created_by_id=other.id, title="他者の情報2")
        ts.flush()
        tab_env.new_items.append(other_item.id)
        oid = str(other_item.id)
        sys_id = repo.get_system_tab(ts).id
        ts.commit()
    # 自分＋他人を混ぜる → 403・何も移動しない。
    with pytest.raises(AppError) as e:
        svc.move_info_items_tab(tab_env.aid, tab_env.cid, info_ids=[str(tab_env.ids.d), oid], tab_id=tab["id"])
    assert e.value.status == 403
    with get_tenant_session(tab_env.db) as ts:
        assert repo.get_info_item(ts, tab_env.ids.d).tab_id == sys_id  # 巻き込まれず「すべて」のまま
    # curator 付与で全件移動可。
    with get_tenant_session(tab_env.db) as ts:
        repo.grant_curator(ts, tab_env.uid, tab_env.uid); ts.commit()
    r = svc.move_info_items_tab(tab_env.aid, tab_env.cid, info_ids=[str(tab_env.ids.d), oid], tab_id=tab["id"])
    assert r["moved"] == 2


def test_n_tc_345_auto_link_disabled_excluded(tab_env):
    """N-TC-345: auto_link_enabled=false の情報は自動類似リンクの対象外（逆方向 all_info_tokens から除外）。"""
    with get_tenant_session(tab_env.db) as ts:
        on = repo.create_info_item(ts, created_by_id=tab_env.uid, title="link on", auto_link_enabled=True)
        off = repo.create_info_item(ts, created_by_id=tab_env.uid, title="link off", auto_link_enabled=False)
        ts.flush()
        tab_env.new_items += [on.id, off.id]
        repo.replace_tokens(ts, on.id, [("共通語x", 3)])
        repo.replace_tokens(ts, off.id, [("共通語x", 3)])
        ts.commit()
    with get_tenant_session(tab_env.db) as ts:
        keys = set(repo.all_info_tokens(ts).keys())
        assert on.id in keys and off.id not in keys  # off は auto 対象外


def test_n_tc_346_word_cloud_tab_filter(tab_env):
    """N-TC-346: ワードクラウドの tab_id 絞り＝指定タブのトークンのみ／未指定は全件。"""
    tab = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="WC絞り"))
    with get_tenant_session(tab_env.db) as ts:
        repo.move_item_tab(ts, tab_env.ids.b, uuid.UUID(tab["id"]))  # ids.b（token=競合）をタブへ
        ts.commit()
    scoped = svc.get_word_cloud(tab_env.aid, tab_env.cid, tab_id=tab["id"])
    toks = {t["token"] for t in scoped["tokens"]}
    assert "競合" in toks and "生成ai" not in toks  # タブ内（ids.b）のみ
    allv = svc.get_word_cloud(tab_env.aid, tab_env.cid)
    assert "生成ai" in {t["token"] for t in allv["tokens"]}  # 未指定は全件


def test_n_tc_347_create_tab_requires_admin_or_curator(tab_env, client):
    """N-TC-347: /info-tabs 作成は admin/curator のみ＝一般ユーザーは 403（読取は可）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)  # seed 一般（非 admin/非 curator）
    csrf = {"X-CSRF-Token": client.cookies.get("iq_csrf")}
    assert client.get("/api/v1/info-tabs").status_code == 200  # 読取は可
    r = client.post("/api/v1/info-tabs", json={"name": "一般が作る"}, headers=csrf)
    assert r.status_code == 403, r.text


def test_n_tc_348_update_unknown_tab_404(tab_env):
    """N-TC-348: 存在しない（他テナント含む）タブ id は 404（存在秘匿）。"""
    with pytest.raises(AppError) as e:
        svc.update_info_tab(tab_env.aid, tab_env.cid, str(uuid.uuid4()), is_admin=True, body=_mk(name="x"))
    assert e.value.status == 404


def test_n_tc_349_api_cannot_create_connector(tab_env):
    """N-TC-349: connector タブは API 作成不可＝作成されるのは常に kind=user（リクエストに kind 無し）。"""
    dto = svc.create_info_tab(tab_env.aid, tab_env.cid, is_admin=True, body=_mk(name="受け口でない"))
    assert dto["kind"] == "user"  # connector は連携設定側が生成（§N.5c）
