"""アプリ設定（環境変数から読む）。値の根拠は doc/ADR/ADR-0001。"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"

    # Postgres 接続（管理DB・会社DB は同一サーバの別データベース＝§1.5 動的ルーティング）
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "ideaquest"
    postgres_password: str = "ideaquest"
    control_db_name: str = "ideaquest_control"

    redis_url: str = "redis://localhost:6379/0"

    # Cookie / セッション（ADR-0001 §2.2/§2.3）
    cookie_secure: bool = True
    session_idle_ttl_seconds: int = 1800       # アイドル30分（スライディング）
    session_absolute_ttl_seconds: int = 43200  # 絶対上限12時間

    # CSRF/Origin（A.0）。状態変更系の Origin 許可リスト（ローカル既定）
    allowed_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]

    # ログインのレート制限（ADR-0001 §2.6）。(IP+login_id) 単位
    login_rate_limit_max: int = 10
    login_rate_limit_window_seconds: int = 300

    # 初回・再設定パスワード（ADR-0002）
    # 設定リンクトークン TTL（72時間・単回・A.7／データモデル §4.4）
    password_setup_ttl_seconds: int = 259200
    # request（自己サービス再設定要求）のレート制限（ADR-0002 §2.3・超過時も 202 維持）
    pw_request_rate_limit_max: int = 5
    pw_request_rate_limit_window_seconds: int = 600
    # メール送信（dev=MailHog／prod=SMTP・ADR-0002 §2.5）
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    mail_from: str = "no-reply@ideaquest.example"
    # メールリンクの基点（フロントのオリジン。password-setup ページを開く）
    app_base_url: str = "http://localhost:3000"

    def server_dsn(self, db_name: str) -> str:
        """指定データベースへの DSN を組み立てる（会社DBは db_identifier をそのまま db 名に使う）。"""
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{db_name}"
        )

    @property
    def control_dsn(self) -> str:
        return self.server_dsn(self.control_db_name)


@lru_cache
def get_settings() -> Settings:
    return Settings()
