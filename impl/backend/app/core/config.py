"""アプリ設定（環境変数から読む）。値の根拠は doc/ADR/ADR-0001。

秘密の供給＝env に加え **`/run/secrets/<name>` ファイルマウント**に対応（設計=シークレット管理(SOPS) §5・D6）。
優先順位は **file > env**（`settings_customise_sources` で反転）＝env は `docker inspect`/`/proc/<pid>/environ`/
子プロセス継承で覗ける露出面（T3）なので、安全にマウントした file が迷い込んだ/残留 env に負けないようにする。
dev は `/run/secrets` が無い＝従来どおり env。本番は env をやめ file をマウントする（compose.secrets.yaml）。
"""
from __future__ import annotations

import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

# ファイルマウントの既定ディレクトリ（compose `secrets:` → `/run/secrets/<name>`）。存在する時だけ有効化し、
# dev（ディレクトリ無し）では pydantic の "directory does not exist" 警告を出さない。
_SECRETS_DIR = "/run/secrets"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        secrets_dir=_SECRETS_DIR if os.path.isdir(_SECRETS_DIR) else None,
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # file(/run/secrets/<name>) を env/dotenv より優先（T3: env 露出面に file が負けない・設計 §5）。
        # 優先順＝明示 init > file secrets > env > dotenv > 既定値。
        return (init_settings, file_secret_settings, env_settings, dotenv_settings)

    app_env: str = "dev"

    # セルフサインアップ（FR-48②・§8.1・決定L）＝デプロイ既定会社コード。デモ用デプロイのみ env 設定。
    # 設定があれば SC-00 の会社コード欄を隠して自動セット（`DEMO` をコードに焼かない＝設定値を読むだけ）。
    # env 名は IQ_DEFAULT_COMPANY_CODE（決定L）。未設定（空）＝通常デプロイ＝会社コード欄を出す。
    default_company_code: str = Field(default="", validation_alias="IQ_DEFAULT_COMPANY_CODE")

    # e2e 並列隔離（ワーカ別DB）＝Playwright の各ワーカに専用会社DBを割り当てて並列競合を断つため、
    # bootstrap が ACME-01 に加えて N 社（ACME-W0..W{N-1}／ideaquest_company_acme_w{i}）を seed する。
    # 既定0＝seed しない（通常スタック/本番は不変）。e2e 隔離プロジェクト（iqe2e）でのみ env で立てる。
    e2e_worker_companies: int = 0

    # システムログ（本番の問題/データ不整合の追跡・JSONL ファイル出力・doc/本番デプロイ要件.md §6.6）。
    # 出力先はデプロイで永続化を決める（dev=消えてよい／prod=永続ボリューム）。保持日数は env で調整可（既定30日）。
    log_level: str = "INFO"                 # ルートログレベル（dev は DEBUG も可）
    log_format: str = "json"                # "json"（JSONL・機械解析用）/"plain"（人間可読）
    log_to_file: bool = True                # ファイル出力の ON/OFF（stdout は常時）
    log_dir: str = "/var/log/ideaquest"     # ログファイルの出力ディレクトリ（コンテナ内・マウント先）
    log_retention_days: int = 30            # 日次ローテーションの保持日数（超過分は削除・アーカイブは §6.6）
    log_utc: bool = False                   # ローテーション境界を UTC にするか（既定=コンテナ現地時刻）

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

    # mail_outbox（認証系メールの非同期送信・ADR-0007・別プロセス mail_worker.py）
    mail_outbox_max_attempts: int = 5                  # 送信リトライ上限（超で failed）
    mail_outbox_poll_interval_seconds: float = 1.0     # メールワーカのポーリング間隔
    mail_outbox_sending_reclaim_seconds: int = 60      # sending 滞留を再送へ戻す閾値（§2.5）
    mail_outbox_done_retention_seconds: int = 604800   # done 行の保持（7日・掃除まで・§2.7）

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

    # セルフサインアップ（FR-48②・SEC C/G）のレート制限（超過時も 202 維持＝送信スキップ・列挙耐性）。
    # IP／(会社,メール) 単位で作成・再送を抑制（メール爆撃・自動化対策）。
    signup_request_rate_limit_max: int = 5
    signup_request_rate_limit_window_seconds: int = 600

    # セルフサインアップ強化（FR-48② SEC D/G/H・follow-up）。既定は安全側（外部依存/副作用は OFF・本番で有効化）。
    # 漏洩PW拒否（SEC D・外部 HIBP range API・k-匿名性＝PW先頭5hexのみ送信）。prod で true。外部障害は fail-open（通す）。
    hibp_enabled: bool = False
    hibp_timeout_seconds: float = 2.0
    # 使い捨てメールドメイン拒否（SEC G・ローカル同梱 blocklist・外部不要）。既定 ON（test メールは非該当）。
    signup_disposable_email_block: bool = True
    # 新規登録の管理者通知（SEC H・既存 notifications/mail 基盤）。prod で true。クールダウンでまとめ件数。
    signup_admin_notify_enabled: bool = False
    signup_admin_notify_cooldown_seconds: int = 3600
    # CAPTCHA（SEC G・Cloudflare Turnstile）。site（公開）/secret（秘匿）とも空なら無効（dev/test）。prod で設定。
    turnstile_site_key: str = Field(default="", validation_alias="TURNSTILE_SITE_KEY")
    turnstile_secret_key: str = Field(default="", validation_alias="TURNSTILE_SECRET_KEY")
    turnstile_timeout_seconds: float = 3.0

    # メール変更のダブルオプトイン（ADR-0008）。確認リンクトークン TTL（24時間・単回・otp_challenges purpose=email_change）
    email_change_ttl_seconds: int = 86400
    # メールアドレス確認（ADR-0009・管理者 opt-in）。確認リンクトークン TTL（72時間・単回・otp_challenges purpose=email_verify）
    email_verify_ttl_seconds: int = 259200

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

    # MinIO（オブジェクトストレージ・画像/添付・API設計 §1.10・infra/storage.py）
    # endpoint＝backend→MinIO の内部ホスト（put/remove/bucket）。public_endpoint＝ブラウザが叩く
    # 署名URL のホスト（presign 用・dev は localhost 公開ポート）。署名は host を含むため両者を分ける。
    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str = "localhost:9000"
    minio_access_key: str = "ideaquest"
    minio_secret_key: str = "ideaquest-secret"
    minio_bucket: str = "ideaquest"
    minio_secure: bool = False            # dev は HTTP（本番は TLS＝True）
    minio_url_ttl_seconds: int = 300      # 署名URL の TTL（短命・直リンク流出耐性・§1.10）
    # region を明示＝presign が region 解決の HTTP を打たずオフライン署名できる（公開ホストへ到達不要）。
    minio_region: str = "us-east-1"

    # ブートストラップ（運営テナント＋初期 system_admin・API設計 B.5.1・案a＝シークレット直投入）
    ops_company_code: str = "OPS"             # 運営テナントの予約会社コード
    ops_db_identifier: str = "ideaquest_ops"  # 運営テナントの会社DB識別子
    bootstrap_admin_login: str = "admin@ops.example"
    bootstrap_admin_email: str = "admin@ops.example"
    # 初期 system_admin のパスワード（秘匿・env 供給）。空なら system_admin を seed しない
    # （既知/デフォルトPW の埋め込み禁止・B.5.1）。本番は必ず強い秘密を供給する。
    bootstrap_admin_password: str = ""

    # 埋め込み（意味的一致・A-2・FR-44）＝LLM 基盤の OpenAI 互換 `/embeddings` を叩く薄いクライアント
    # （infra/llm/embeddings.py）。モデルは基盤側（backend に焼き込まない＝データ主権・横断集約）。
    # base_url は宛先（dev=compose 内 Ollama／prod=自社 vLLM／将来クラウド）＝env で差し替え。
    alignment_embed_base_url: str = "http://ollama:11434/v1"  # OpenAI 互換 embeddings のベースURL
    alignment_embed_model: str = "bge-m3"                     # 既定モデル（多言語・日本語強）。env で上書き可
    alignment_embed_api_key: str = ""                         # 認証が要る基盤向け（Ollama は不要＝空）
    alignment_embed_timeout_seconds: float = 15.0            # 1リクエストのタイムアウト（同期・軽量）
    # ハイブリッド合成の既定重み（keyword と embedding の加重・案B）。会社 UI には出さず config で調整。
    alignment_hybrid_keyword_weight: float = 0.5
    # 埋め込み cosine→整合率(0..1) の線形リスケール境界（bge-m3 は cosine が ≈0.31..0.61 に圧縮＝生値だと
    # 50/70/90 の上位ティアが死ぬ・実測 2026-09-30）。floor 未満=0%・ceil 以上=100%・間は線形。keyword は
    # 生値のまま（リスケールしない）。既定は bge-m3 実測分布から選定（無関係 p50≈0.44・意味近 p90≈0.60）＝
    # モデルを替えたら同様の評価セットで再計測して更新（詳細＝設計 §4.1a・R-TC-207/208）。
    alignment_embed_score_floor: float = 0.42
    alignment_embed_score_ceil: float = 0.62

    # AI評価 RAG の経営資料 top-k 追補（FR-50・設計 §3/§11・A-2 基盤）＝クエストが明示選択した経営資料に加え、
    # 成果物（アイデア/コンセプト）に意味的に近い経営資料を entity_embeddings の cosine で top-k 追補する。
    # selected（admin の明示意図＝権威）を優先し、空き枠を top-k で補充（合計 total 上限でトークン抑制）。
    # 埋め込み不可（サーバ不達・モデル不一致・ベクトル欠損）は現行動作（選択分のみ）へ graceful 縮退。
    eval_rag_strategy_topk: int = 3              # 意味的に近い経営資料の追補候補数（cosine 上位）
    eval_rag_strategy_total: int = 5             # selected＋top-k の合計上限（プロンプト肥大を抑える）
    eval_rag_strategy_min_cosine: float = 0.45  # この生 cosine 未満の資料は追補しない（無関係文書の混入防止）

    # LLMゲートウェイ（生成・チャット補完・FR-45）＝OpenAI 互換 `/chat/completions` を叩く自前の薄い層
    # （infra/llm/gateway.py）。埋め込み（上）と同じ「物理は基盤側・キーは論理」方針。base_url は宛先
    # （dev=Ollama／prod=vLLM／将来クラウド）＝env で差し替え。物理モデル名は論理キー→config で解決し、
    # キー名は dev/prod 同一に保つ（registry.py）。
    llm_base_url: str = "http://ollama:11434/v1"     # OpenAI 互換 chat のベースURL
    llm_api_key: str = ""                            # 認証が要る基盤向け（Ollama は不要＝空）
    llm_timeout_seconds: float = 120.0               # 生成は数分許容（Phase1 バックグラウンド）
    llm_max_tokens: int = 0                           # 生成トークンのグローバル上限（0=無制限・会社別上限 S.5 が無い時の技術ガード。env 可変）
    llm_model_light: str = "qwen3:4b"                # 論理キー qwen3-light の物理（軽量・info_summarize 既定）
    llm_model_swallow: str = "hf.co/tokyotech-llm/Llama-3.1-Swallow-8B"  # 論理キー qwen3-swallow の物理（高品質日本語・iso_generate）
    # AIジョブ・ワーカー（tenant/ai_jobs・llm_worker.py・FR-45・設計 §5）
    llm_worker_concurrency: int = 1                  # 同時実行 N（最小スペック＝1件ずつ・設計 §5.3）
    llm_worker_poll_interval_seconds: float = 2.0    # ワーカのポーリング間隔
    llm_job_max_attempts: int = 3                    # 失敗リトライ上限（超で failed）
    llm_job_running_reclaim_seconds: int = 300       # running 無更新の孤児回収閾値（設計 §5.4）
    # アイデア/コンセプトの AI 自動評価（FR-50・F.7.1）。公開時の自動 enqueue をデプロイ単位で opt-in
    # （LLM ワーカー `--profile ai` と同思想・既定 OFF＝LLM 基盤を伴わない dev/test では自動起動しない）。
    # 再生成 EP（評価者権限）は本フラグに依らず常時可（明示操作）。
    llm_auto_evaluate_on_publish: bool = False

    # おすすめクエスト選出（SC-01 ダッシュボード Zone D・ダッシュボード再設計 Phase3）。
    # score = w_align·整合率 + w_active·直近活発 + w_admin·recommended（各成分 0..1 正規化の加重和）。
    # 「参加可」は候補母集団のハードフィルタ（can_discover_quest ∩ 未参加 ∩ 非pending）であり重み化しない。
    recommend_weight_align: float = 0.45          # 経営資料整合率の重み（適用資料の平均マッチ度）
    recommend_weight_active: float = 0.35         # 直近活発度の重み（窓内活動を母集団 max で正規化）
    recommend_weight_admin: float = 0.20          # 管理者お勧め（quests.recommended）の加重和ブースト
    recommend_active_window_days: int = 30        # 「直近活発」の集計窓（公開アイデア＋チャット＋参加/申請）
    recommend_default_limit: int = 3              # パネル既定件数（Zone D 最大3）
    recommend_max_limit: int = 10                 # limit の上限（クランプ）

    # 帳票・レポート（ドメインV・JasperReports 疎結合連携・API設計 V.4）。帳票基盤 infra/reports は
    # LLM ゲートウェイ（infra/llm）と同作法＝「描画は差し替え可能な port」。`REPORT_RENDERER` で着脱し、
    # Jasper は内部ネットワーク限定の純レンダラ（データ・プッシュ JSON・S2S 秘密）。設計 §10/§17.5。
    report_renderer: str = "none"                  # jasper / fallback（純Python）/ none（機能オフ・ボタン非活性）
    jasper_base_url: str = "http://jasper:8000"    # 内部エンドポイント（公開ポート無・専用 network）
    jasper_timeout_seconds: float = 30.0           # Jasper 呼び出しのタイムアウト（同期ストリーム）
    jasper_shared_secret: str = ""                 # S2S 認証ヘッダ X-Report-Secret（本番は compose secrets ファイル供給・§17.5 G1）
    jasper_max_response_bytes: int = 25_000_000    # 受領 PDF の応答サイズ上限（SSRF/DoS 緩和・§17.5 軽微a）

    def server_dsn(self, db_name: str) -> str:
        """指定データベースへの DSN を組み立てる（会社DBは db_identifier をそのまま db 名に使う）。"""
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{db_name}"
        )

    @property
    def control_dsn(self) -> str:
        return self.server_dsn(self.control_db_name)


# 本番で絶対に許してはいけない「dev 既定値/プレースホルダ」の秘密（値が一致したら起動拒否＝fail-closed）。
# ※ 空を強制はしない＝`bootstrap_admin_password=""`（seed しない）・`turnstile_secret_key=""`（CAPTCHA 無効）
#   など「空＝無効化」が正当な意味を持つ秘密の運用を壊さないため。実際の footgun（dev 既定の本番流入）だけ塞ぐ。
#   （完全な秘密棚卸し＝SOPS 本体スライスで精緻化・設計 §12-3）
_DEV_DEFAULT_SECRETS: dict[str, set[str]] = {
    "postgres_password": {"ideaquest"},
    "minio_access_key": {"ideaquest"},
    "minio_secret_key": {"ideaquest-secret"},
    "bootstrap_admin_password": {"Passw0rd!"},
    "jasper_shared_secret": {"dev-jasper-secret"},
}


def insecure_prod_secrets(settings: Settings) -> list[str]:
    """本番(`app_env=prod`)で安全でない秘密のフィールド名を返す（非 prod は常に `[]`）。

    非空リスト＝起動拒否（fail-closed・main.lifespan）＝dev 既定値のまま本番へ出す事故を防ぐ（D6・広ガード）。
    (1) dev 既定値/プレースホルダのまま／(2) 機能有効時に必須の秘密が空（renderer=jasper の S2S 秘密）を検出する。
    """
    if settings.app_env != "prod":
        return []
    bad: set[str] = set()
    for name, dev_defaults in _DEV_DEFAULT_SECRETS.items():
        if getattr(settings, name, "") in dev_defaults:
            bad.add(name)
    # renderer=jasper のとき S2S 秘密は空も不可（秘密無しで帳票描画を通さない＝jasper 側も 401 fail-closed）。
    if settings.report_renderer == "jasper" and not settings.jasper_shared_secret:
        bad.add("jasper_shared_secret")
    return sorted(bad)


@lru_cache
def get_settings() -> Settings:
    return Settings()
