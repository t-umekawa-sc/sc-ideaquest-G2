"""経営資料への情報の影響率/機会率/脅威率（R.4・Step4・doc/テスト/R_経営資料.md §3）。

母集団＝当該資料とトークン関連度が閾値以上（会社別 `auto_link_threshold`・既定 0.12）の **curated（非アーカイブ）情報**。
機会/脅威は `info_items.impact_class`（人手トリアージ）由来。専用テーブルは持たず `GET /strategy-documents/{id}`
の read で集計（設計 §4.2）。**共有 dev DB を汚さぬよう、ユニーク語で母集団を投入分に限定**して検証する。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.info.orm import InfoItem
from app.tenant.profile.orm import User
from app.tenant.strategy import application as strategy_app
from app.tenant.strategy.orm import StrategyDocument
from app.tenant.tokens.orm import EntityToken
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE

BASE = "/api/v1/strategy-documents"


def _seed_company() -> Company:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()


def _admin(client, factory):
    a = factory.make_seed_company_account(system_role="company_account_admin",
                                          display_name=f"影響率admin_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _tok(owner_type, owner_id, pairs):
    return [EntityToken(owner_type=owner_type, owner_id=owner_id, token=t, count=c) for t, c in pairs]


def test_r_tc_110_detail_includes_impact_rates(client, factory):
    """R-TC-110 詳細 read に影響率/機会率/脅威率を同梱＝母集団（関連度≥閾値の curated 情報）で集計・非関連/非curated は除外。"""
    db = _seed_company().db_identifier
    u = uuid.uuid4().hex[:8]
    uA, uB, uZ = f"影響{u}a", f"影響{u}b", f"影響{u}z"  # ユニーク語＝既存 curated 情報と重ならない
    owner = uuid.uuid4()
    did = uuid.uuid4()
    a_id, b_id, c_id, d_id = (uuid.uuid4() for _ in range(4))
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="影響率作者", locale="ja", status="active"))
            ts.add(StrategyDocument(id=did, title="影響率テスト方針", doc_kind="policy",
                                    created_by_id=owner, body_text=f"{uA} {uA} {uB}", status="active"))
            ts.flush()
            # 資料トークン＝ユニーク語（uA×2, uB×1）。
            ts.add_all(_tok("strategy_doc", did, [(uA, 2), (uB, 1)]))
            # curated：A=機会/関連（uA）・B=脅威/関連（uB）・C=その他/非関連（uZ）。
            ts.add(InfoItem(id=a_id, title="機会情報", created_by_id=owner, status="curated", impact_class="opportunity"))
            ts.add(InfoItem(id=b_id, title="脅威情報", created_by_id=owner, status="curated", impact_class="threat"))
            ts.add(InfoItem(id=c_id, title="無関係情報", created_by_id=owner, status="curated", impact_class="other"))
            # raw（非 curated）だが関連＝母集団にも分母にも入らない。
            ts.add(InfoItem(id=d_id, title="下書き情報", created_by_id=owner, status="raw", impact_class="opportunity"))
            ts.flush()
            ts.add_all(_tok("info", a_id, [(uA, 1)]))
            ts.add_all(_tok("info", b_id, [(uB, 1)]))
            ts.add_all(_tok("info", c_id, [(uZ, 1)]))
            ts.add_all(_tok("info", d_id, [(uA, 1)]))
            ts.commit()

        _admin(client, factory)
        r = client.get(f"{BASE}/{did}")
        assert r.status_code == 200, r.text
        imp = r.json()["impact"]
        assert imp is not None
        # 母集団＝A,B（ユニーク語で限定）。C は非関連・D は非 curated で除外。
        assert imp["related_count"] == 2, imp
        assert imp["opportunity_count"] == 1 and imp["threat_count"] == 1, imp
        assert imp["opportunity_rate"] == 0.5 and imp["threat_rate"] == 0.5, imp
        assert imp["threshold"] == 0.12, imp
        # 影響率＝母集団/全 curated（共有DB依存＝整合のみ検証）。分母には A,B,C を含み D は含まない。
        assert imp["info_total"] >= 3
        assert imp["impact_rate"] == round(imp["related_count"] / imp["info_total"], 3)
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(EntityToken.__table__.delete().where(
                EntityToken.owner_id.in_([did, a_id, b_id, c_id, d_id])))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id.in_([a_id, b_id, c_id, d_id])))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()


def test_r_tc_111_impact_rates_zero_when_no_doc_tokens():
    """R-TC-111 資料トークン空/母集団0はゼロ除算せず率0を返す（例外なし）。"""
    company = _seed_company()
    db = company.db_identifier
    owner = uuid.uuid4()
    did = uuid.uuid4()
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="影響率0作者", locale="ja", status="active"))
            # トークンを永続しない資料＝母集団は必ず 0。
            ts.add(StrategyDocument(id=did, title="トークン無し方針", doc_kind="policy",
                                    created_by_id=owner, body_text=None, status="active"))
            ts.commit()
        with get_tenant_session(db) as ts:
            doc = ts.get(StrategyDocument, did)
            rates = strategy_app._impact_rates(ts, doc, company)
            assert rates["related_count"] == 0
            assert rates["impact_rate"] == 0.0
            assert rates["opportunity_rate"] == 0.0 and rates["threat_rate"] == 0.0
            assert rates["info_total"] >= 0  # 全 curated 件数（共有DB依存）
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()
