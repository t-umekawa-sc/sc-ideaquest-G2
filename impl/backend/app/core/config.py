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

    # クライアント IP の確定（ADR-0006）。backend 手前の信頼プロキシ段数。
    # 0＝直アクセス（request.client.host をそのまま使う）。本番はエッジ段数に一致させる。
    trusted_proxy_count: int = 0

    # account_sync_outbox ワーカ（データモデル §4.6）。失敗リトライ上限（超で failed＝要手動対応）。
    outbox_max_attempts: int = 5
    outbox_poll_interval_seconds: float = 1.0  # 常駐ワーカのポーリング間隔（worker.py）

    # ログインのレート制限（ADR-0001 §2.6）。(IP+login_id) 単位
    login_rate_limit_max: int = 10
    login_rate_limit_window_seconds: int = 300

    # アカウント一時ロック（ADR-0005・(IP+login_id) 単位の第二層防御・しきい値は env）
    login_lock_max_attempts: int = 5                 # ロックまでの連続失敗回数（窓内）
    login_lock_ttl_seconds: int = 900                # ロック期間＝連続失敗の計数窓（15分）
    login_lock_notify_cooldown_seconds: int = 3600   # ロック通知メールの最小間隔（60分/account）

    # 初回・再設定パスワード（ADR-0002）
    # 設定リンクトークン TTL（72時間・単回・A.7／データモデル §4.4）
    password_setup_ttl_seconds: int = 259200
    # request（自己サービス再設定要求）のレート制限（ADR-0002 §2.3・超過時も 202 維持）
    pw_request_rate_limit_max: int = 5
    pw_request_rate_limit_window_seconds: int = 600

    # MFA（メールOTP）・信頼端末（ADR-0004・しきい値は env＝ADR-0003 §2.1）
    otp_length: int = 6                          # OTP 桁数（数字）
    otp_ttl_seconds: int = 600                   # OTP 有効期限（10分）
    otp_max_attempts: int = 5                    # 連続失敗上限（超過で pre-auth 失効・A.0-④）
    otp_resend_cooldown_seconds: int = 30        # resend クールダウン（経過前は 429）
    preauth_ttl_seconds: int = 600               # pre-auth（iq_preauth）寿命＝MFA 完了までの猶予
    trusted_device_ttl_seconds: int = 2592000    # 信頼端末（iq_trust）TTL（30日）
    # メール送信（dev=MailHog／prod=SMTP・ADR-0002 §2.5・置き場所は ADR-0003）
    # 接続（dev=MailHog は認証なし・平文＝user/password 空・start_tls=False で無効化）
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str = ""            # 秘匿（本番はシークレットマネージャ供給・空なら未ログイン）
    smtp_password: str = ""        # 秘匿（同上）
    smtp_start_tls: bool = False   # STARTTLS（本番の 587 送信で True。MailHog は False）
    # 差出人・宛先
    mail_from: str = "no-reply@ideaquest.example"
    mail_alert_to: str = "alerts@ideaquest.example"  # 運用/システムアラートの送信先
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
