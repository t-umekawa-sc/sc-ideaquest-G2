"""SEC-TC-050〜053: 秘密のファイル供給（file>env）と本番 fail-closed ガード（D6・設計 シークレット管理(SOPS)）。

- file(/run/secrets/<name>) を env より優先（迷い込んだ env に負けない＝T3 対策）。
- 本番(APP_ENV=prod)で dev 既定値/プレースホルダのまま or 必須秘密が空なら起動拒否（`insecure_prod_secrets`）。
純ヘルパ/構築ロジックをここで固定する（実 app への適用は main.lifespan 結線側）。
"""
from __future__ import annotations

from app.core.config import Settings, insecure_prod_secrets

# 本番で「全て強い値」を満たす最小セット（dev 既定に該当しない値）。各 TC で必要分を上書きする。
_STRONG = dict(
    postgres_password="S3cure-pg-pw",
    minio_access_key="minio-strong-user",
    minio_secret_key="minio-strong-secret",
    bootstrap_admin_password="A-strong-admin-pw!",
    jasper_shared_secret="a-strong-s2s-secret-value",
)


def test_sec_tc_050_file_secret_beats_env(tmp_path, monkeypatch):
    # /run/secrets/<name> 相当のファイルを置き、同名 env も設定 → ファイルが勝つ（末尾改行は strip）。
    monkeypatch.setenv("JASPER_SHARED_SECRET", "FROM_ENV")
    (tmp_path / "jasper_shared_secret").write_text("FROM_FILE\n")  # 末尾改行あり
    s = Settings(_secrets_dir=str(tmp_path))
    assert s.jasper_shared_secret == "FROM_FILE"  # env に負けない＋改行除去


def test_sec_tc_051_prod_guard_detects_dev_defaults():
    # dev 既定のまま本番 → 当該名を列挙（非空＝起動拒否）。
    s = Settings(app_env="prod", report_renderer="jasper", **{**_STRONG,
                 "postgres_password": "ideaquest", "jasper_shared_secret": "dev-jasper-secret"})
    assert insecure_prod_secrets(s) == ["jasper_shared_secret", "postgres_password"]
    # renderer=jasper で S2S 秘密が空 → 空も fail-closed。
    s_empty = Settings(app_env="prod", report_renderer="jasper", **{**_STRONG, "jasper_shared_secret": ""})
    assert "jasper_shared_secret" in insecure_prod_secrets(s_empty)


def test_sec_tc_052_non_prod_and_strong_prod_are_empty():
    # 非 prod は dev 既定のままでも常に [](dev/test の起動を壊さない)。
    s_dev = Settings(app_env="dev", postgres_password="ideaquest", jasper_shared_secret="dev-jasper-secret")
    assert insecure_prod_secrets(s_dev) == []
    # 本番でも全て強い値＋renderer=jasper の S2S 秘密ありなら []。
    s_prod = Settings(app_env="prod", report_renderer="jasper", **_STRONG)
    assert insecure_prod_secrets(s_prod) == []


def test_sec_tc_053_empty_is_valid_for_optional_secrets():
    # 空が正当な意味を持つ秘密（seed しない/CAPTCHA 無効）は本番でも列挙しない（renderer!=jasper）。
    s = Settings(app_env="prod", report_renderer="none",
                 **{**_STRONG, "bootstrap_admin_password": "", "turnstile_secret_key": "", "jasper_shared_secret": ""})
    assert insecure_prod_secrets(s) == []
    # ただし dev 既定値 Passw0rd! は検出する。
    s_weak = Settings(app_env="prod", report_renderer="none", **{**_STRONG, "bootstrap_admin_password": "Passw0rd!"})
    assert insecure_prod_secrets(s_weak) == ["bootstrap_admin_password"]
