"""SEC-TC-045/046: 本番デプロイ ハードニングの決定ロジック（本番デプロイ要件 §2/§5）。

APP_ENV=prod で (1) API スキーマ/Swagger を非公開、(2) 既定PW のデモ会社/アカウントを seed しない。
判断は純ヘルパに切り出しており、ここでその真偽を固定する（実 app/bootstrap への適用は結線側）。
"""
from __future__ import annotations

from app.main import _docs_kwargs
from scripts.bootstrap import _seed_demo_enabled


def test_sec_tc_045_docs_disabled_in_prod():
    # prod は docs/redoc/openapi を全無効
    prod = _docs_kwargs("prod")
    assert prod == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    # 非 prod は既定（空＝公開のまま）
    assert _docs_kwargs("dev") == {}
    assert _docs_kwargs("e2e") == {}


def test_sec_tc_046_demo_seed_gated_in_prod():
    assert _seed_demo_enabled("prod") is False        # 本番はデモを seed しない
    assert _seed_demo_enabled("dev") is True           # 開発は従来どおり
    assert _seed_demo_enabled("e2e") is True
    assert _seed_demo_enabled("test") is True
