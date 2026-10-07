"""T-TC-204/205: 公開モード外周アクセスゲート（FR-48 §8.0・決定O/P'・app/core/access_gate.py）。

public 会社（コンテスト専用テナント）は役割別許可リスト外のEPをサーバーで 404＝存在秘匿（UI非依存・§1.6）。
共有 dev DB の access_mode は書き換えず、`_resolve` を monkeypatch して public とみなす（他テスト非干渉）。
"""
from __future__ import annotations

import app.core.access_gate as gate
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def test_t_tc_204_is_path_allowed():
    """許可判定（純関数）＝コンテスト許可=全ロール／管理許可=管理者のみ／業務EPは管理者でも不可（決定O）。"""
    # コンテスト許可リスト（実パス）＝general/admin とも True。auth は /auth/* に集約（ログイン後の /auth/session 含む）。
    for sub in ("/contests", "/contests/x/ranking", "/ideas/x/vote", "/chat-messages/x",
                "/attachments/x/download", "/me", "/notifications/unread-count", "/auth/session"):
        assert gate.is_path_allowed(sub, is_admin=False) is True, sub
        assert gate.is_path_allowed(sub, is_admin=True) is True, sub
    # 管理許可リスト＝admin のみ True・general False（会社/アカウント/所属/能力は全て /admin/* 配下）。
    for sub in ("/admin/companies", "/admin/accounts/x", "/admin/quest-groups", "/admin/accounts/x/capabilities"):
        assert gate.is_path_allowed(sub, is_admin=False) is False, sub
        assert gate.is_path_allowed(sub, is_admin=True) is True, sub
    # 業務EP＝general/admin とも False（公開会社はコンテスト専用・決定O）。全文検索 /quests/{id}/search も業務扱い。
    for sub in ("/quests", "/quests/x/search", "/concepts", "/dashboard", "/strategy-documents", "/projects"):
        assert gate.is_path_allowed(sub, is_admin=False) is False, sub
        assert gate.is_path_allowed(sub, is_admin=True) is False, sub


def test_t_tc_205_public_gate_blocks_business(client, monkeypatch):
    """public 会社は業務EPを 404＝存在秘匿・コンテスト系は素通し／private は不変（middleware 外周ガード）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)  # 実セッションでログイン
    # private（patch 無し）＝/quests はゲートで 404 にならない（従来どおり＝200/他）。
    assert client.get("/api/v1/quests").status_code != 404

    # 実セッションのまま access_mode=public とみなす（共有DBは汚さない）。
    def fake_resolve(request):
        session = gate.resolve_session(request)
        return (session, "public") if session else (None, None)
    monkeypatch.setattr(gate, "_resolve", fake_resolve)

    assert client.get("/api/v1/quests").status_code == 404        # 業務EP＝公開会社で 404（存在秘匿）
    body = client.get("/api/v1/quests").json()
    assert body.get("code") == "not_found"
    assert client.get("/api/v1/contests").status_code != 404      # コンテスト系＝ゲート非該当（素通し）
