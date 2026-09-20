"""情報インプット（ドメイン N）テストの共通 seed フィクスチャ。

seed 会社 ACME-01 の会社DB に情報（info_items ほか）を直接 seed し、teardown で物理削除する。
created_by_id は seed 一般ユーザー（FK users）を使う。全文検索用に body_text に平文を入れる。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.info.orm import InfoItem, InfoItemCategory, InfoLink, InfoToken
from app.tenant.profile.repository import get_user_by_account
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN


def _seed_user_id(db_identifier: str) -> uuid.UUID:
    with control_session() as s:
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user = get_user_by_account(ts, account.id)
        assert user is not None, "seed 一般ユーザーの会社DB ミラーが無い"
        return user.id


@pytest.fixture
def info_env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
    user_id = _seed_user_id(db_identifier)

    base = datetime(2026, 9, 10, tzinfo=timezone.utc)
    ids = SimpleNamespace(
        a=uuid.uuid4(),  # curated / opportunity / newest
        d=uuid.uuid4(),  # raw / no impact / mid
        b=uuid.uuid4(),  # raw / threat / older（全文検索の distinct 語）
        c=uuid.uuid4(),  # archived（既定除外）
        fu1=uuid.uuid4(), fu2=uuid.uuid4(),  # itA の続報×2
    )
    created_items = [ids.a, ids.d, ids.b, ids.c, ids.fu1, ids.fu2]

    with get_tenant_session(db_identifier) as ts:
        ts.add(InfoItem(id=ids.a, created_by_id=user_id, title="生成AIの業務利用が拡大",
                        body_text="生成AIの活用が全社へ拡大している", summary="生成AI拡大",
                        status="curated", priority="high", source="market_research",
                        impact_class="opportunity", created_at=base + timedelta(days=3)))
        ts.add(InfoItem(id=ids.d, created_by_id=user_id, title="ノーコード需要の高まり",
                        body_text="中小のノーコード需要が強い", summary="ノーコード",
                        status="raw", priority="normal", source="event",
                        impact_class=None, created_at=base + timedelta(days=2)))
        ts.add(InfoItem(id=ids.b, created_by_id=user_id, title="競合が値下げ",
                        body_text="競合Xがブロックチェーン連携で値下げ", summary="競合値下げ",
                        status="raw", priority="low", source="competitor",
                        impact_class="threat", created_at=base + timedelta(days=1)))
        ts.add(InfoItem(id=ids.c, created_by_id=user_id, title="アーカイブ済みの情報",
                        body_text="これは archived", summary="arch",
                        status="archived", priority=None, source=None,
                        impact_class=None, created_at=base))
        # itA の続報×2（parent_info_id）。
        ts.add(InfoItem(id=ids.fu1, created_by_id=user_id, parent_info_id=ids.a, title="続報1",
                        body_text="続報1本文", status="raw", created_at=base + timedelta(days=4)))
        ts.add(InfoItem(id=ids.fu2, created_by_id=user_id, parent_info_id=ids.a, title="続報2",
                        body_text="続報2本文", status="raw", created_at=base + timedelta(days=5)))
        ts.flush()
        # itA のカテゴリ×2。
        ts.add(InfoItemCategory(info_item_id=ids.a, category="ext_technology"))
        ts.add(InfoItemCategory(info_item_id=ids.a, category="ext_industry"))
        # itA のリンク：未棄却×2＋棄却×1 → link_count=2。
        ts.add(InfoLink(info_item_id=ids.a, target_type="ideas", target_id=uuid.uuid4(),
                        kind="supporting", origin="auto"))
        ts.add(InfoLink(info_item_id=ids.a, target_type="quests", target_id=uuid.uuid4(),
                        kind="related", origin="auto"))
        ts.add(InfoLink(info_item_id=ids.a, target_type="concepts", target_id=uuid.uuid4(),
                        kind="related", origin="auto", rejected_at=base))
        # ワードクラウド用トークン（archived の token は集計対象外）。
        ts.add(InfoToken(info_item_id=ids.a, token="生成ai", count=5))
        ts.add(InfoToken(info_item_id=ids.b, token="競合", count=3))
        ts.add(InfoToken(info_item_id=ids.d, token="需要", count=2))
        ts.add(InfoToken(info_item_id=ids.c, token="アーカイブ語", count=99))  # 除外されるべき
        ts.commit()

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id, ids=ids)

    with get_tenant_session(db_identifier) as ts:
        ts.execute(InfoToken.__table__.delete().where(InfoToken.info_item_id.in_(created_items)))
        ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id.in_(created_items)))
        ts.execute(InfoItemCategory.__table__.delete().where(InfoItemCategory.info_item_id.in_(created_items)))
        # 続報（子）→ 親の順で削除（自己参照 FK）。
        ts.execute(InfoItem.__table__.delete().where(InfoItem.parent_info_id.in_(created_items)))
        ts.execute(InfoItem.__table__.delete().where(InfoItem.id.in_(created_items)))
        ts.commit()
