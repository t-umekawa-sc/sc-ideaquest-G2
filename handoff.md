# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。**
> **SC-00 ログインは全状態（A=PWログイン／B=初回・再設定PW設定／C=MFA認証コード／D=再設定リクエスト）が frontend＋backend とも一通り縦に完了した。** 次は認証まわりのハードニング（アカウントロック）か、別ドメイン/フロント本格化へ。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-09 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・`origin/main` と同期＝`git status` で確認済み）。
- 最新コミット: **`e62311d`**（handoff の push 状況更新・2段方式の2段目）。本セッションの実装本体コミット（新しい順）:
  - `1f58fc5` 実装 状態C frontend（MFA 認証コード入力）
  - `2d87d82` 実装 MFA(状態C) backend（メールOTP・pre-auth・信頼端末・ADR-0004）
  - `dd4d8ce` 実装 状態B/D frontend（初回・再設定パスワード画面）
  - `3def11d` 実装 メール設定 env 配線（SMTP認証/STARTTLS・From・アラート宛先）
  - `6317a6e` docs(ADR) ADR-0003 設定と秘匿情報の置き場所／`9ea486a` README 参照案内
  - （各実装本体の直後に handoff 追記コミットが1つずつ入る＝コミット運用 §8）
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。**本セッション分は全て `origin/main` へプッシュ済み**（未プッシュのコミットは無い）。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(全文検索 PGroonga・会社DBのみ)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

本セッションは 3 スライス＋設定方針 ADR。時系列（＝依存順）:

### (a) 設定/秘匿の置き場所を確定（ADR-0003）＋メール設定を env 配線
- **`doc/ADR/ADR-0003_設定と秘匿情報の置き場所.md`（新規）**＝「設定は“何の軸で変わるか”で置き場所を決める（デプロイ環境軸→env／テナント軸→DB）」を確定。SMTP 等は env（DB不採用）。`.env` 管理項目を秘匿/非秘匿で分類明記。本番の秘匿値供給＝シークレットマネージャ経由（env 方式は不変・供給元だけ替える）。理由＝ユーザーの相談（SMTP をどこに置くか）に一次回答を残すため。`ADR-0002` §2.5 から相互参照追記。
- **`impl/backend/app/core/config.py`**＝メール7項目（`smtp_host/port/user/password/start_tls`＋`mail_from`＋`mail_alert_to`）を `Settings` に追加。TLS は参照システムに合わせ**真偽値 `SMTP_START_TLS`**。
- **`impl/backend/app/infra/mail.py`**＝`SmtpMailSender` を `smtp_start_tls` で STARTTLS・`smtp_user` 非空で `login` に対応（dev の MailHog は空/False でそのまま動作）。
- **`impl/.env.example` / `impl/compose.yaml`**＝上記7項目を配線（`${VAR:-既定}`）。
- **`README.md`**＝設定一覧はベタ書きせず「追跡対象の `.env.example`（コメント付き）＋ADR-0003」への参照に統一（DRY/drift 回避）。`MAIL_ALERT_TO` は**宛先の器のみ**で実送信経路は未実装（ADR-0003 §4 TODO）。

### (b) 状態B/D frontend（初回・再設定パスワード画面）＝`dd4d8ce`
- **`impl/frontend/src/features/auth/components/PasswordResetRequestForm.tsx`（新規）**＝状態D。会社コード＋ログインID→`request`→**常に同一の確認メッセージ**（列挙耐性）。
- **`impl/frontend/src/features/auth/components/PasswordSetupForm.tsx`（新規）**＝状態B。表示前に `verify`→有効なら新PW＋確認→`complete`。410=期限切れ表示＋再要求導線／422=`errors[]` をフィールド直下。PWポリシー（8＋英数）はクライアント補助検証。
- **`impl/frontend/src/app/(auth)/password-reset/page.tsx`・`impl/frontend/src/app/(auth)/password-setup/page.tsx`（新規）**＝ルーティングのみ（`?token=` を取り出し渡す）。メールのリンク先は `password-setup?token=`。
- **`.../features/auth/api.ts`**＝`requestPasswordSetup/verifyPasswordSetup/completePasswordSetup` 追加。**`.../LoginForm.tsx`** に「パスワードをお忘れですか？」導線。`schema.d.ts` 再生成。
- **`doc/画面設計/画面API連携/SC-00_ログイン.md`**＝状態D/B のシーケンス・CSRF 配線を追記。
- **`impl/frontend/e2e/sc-00-password-setup.spec.ts`（新規）**＝D→MailHog→B→complete→login。complete は seed と同一 PW（`Passw0rd!`）で実行し共有資格情報を保つ。

### (c) MFA（状態C）backend＝`2d87d82`（ADR-0004）
- **`doc/ADR/ADR-0004_MFA・信頼端末基本パラメータ.md`（新規）**＝しきい値は env（ADR-0003 と一貫）。**login OTP＋pre-auth は Redis 一体保持**（`otp_challenges` テーブルは `password_setup` 専用に留める＝意図的選択）。**信頼端末は DB**（`trusted_devices`・30日）。OTP 失敗上限=5。**アカウントロックは後続 ADR へ委譲**。
- **`impl/backend/app/core/config.py`**＝MFA しきい値6項目（`otp_length/otp_ttl_seconds/otp_max_attempts/otp_resend_cooldown_seconds/preauth_ttl_seconds/trusted_device_ttl_seconds`）。`.env.example`/`compose.yaml` にも配線。
- **`impl/backend/app/core/security.py`**＝`generate_otp` と pre-auth（Redis）＝`create_preauth/read_preauth/save_preauth/delete_preauth`（キー `preauth:{token}`・`save_preauth` は `keepttl=True` で TTL 据え置き＝pre-auth の 10分上限を延ばさない）。
- **`impl/backend/app/control_plane/auth/repository.py`**＝`trusted_devices` の CRUD（`create_trusted_device/find_active_trusted_device/revoke_all_trusted_devices`）＋`get_company`。
- **`impl/backend/app/control_plane/auth/domain/service.py`**＝`mask_email`（`y****@acme.co.jp`）。
- **`impl/backend/app/control_plane/auth/application.py`**＝`login` に `mfa_required` 分岐（OTPメール＋pre-auth 発行・信頼端末なら MFA スキップ）／`verify_mfa`（失敗上限で pre-auth 失効・成功で新セッション＋`trust_device`）／`resend_mfa`（クールダウン 429＋Retry-After）／`logout_all`／`_issue_session`（共通化）／`_send_otp_email`。
- **`impl/backend/app/control_plane/auth/router.py`**＝`/mfa/verify`・`/mfa/resend`・`/logout-all` と Cookie ヘルパ（`_set_preauth_cookies`/`_set_trust_cookie`）。**`impl/backend/app/core/deps.py`** に `require_preauth`。
- **`impl/backend/app/core/errors.py`**＝`AppError` に `extra`（otp_invalid の `attempts_left`）と `headers`（429 の `Retry-After`）を追加。
- **`impl/backend/app/control_plane/auth/orm.py`＋migration `0003_control_trusted_devices.py`（新規）**＝`TrustedDevice`（`token_hash`=SHA-256・`expires_at`・`revoked`）。
- **`impl/backend/scripts/bootstrap.py`**＝MFA 必須のシード会社 `ACME-02`（+会社DB+アカウント `mfa@acme2.example`）を追加（`_SEEDS` でループ）。**`impl/backend/tests/conftest.py`** に `make_seed_mfa_account` と `trusted_devices` の teardown。
- **`impl/backend/tests/auth/test_auth_mfa.py`（新規・A-TC-060〜070）**／**`doc/テスト/A_認証.md` §4**／`doc/API設計/A_認証・セッション.md` A.8 を ADR-0004 参照へ。

### (d) MFA（状態C）frontend＝`1f58fc5`
- **`impl/frontend/src/features/auth/components/MfaForm.tsx`（新規）**＝masked_to 表示・6桁コード入力（`inputmode=numeric`/`one-time-code`）・「このデバイスを信頼する」・`verify`・**resend クールダウンのカウントダウン**・「別のIDでログイン」。`otp_invalid` は `attempts_left` 残回数表示、上限/`preauth_expired` は状態Aへ戻す。
- **`.../components/LoginForm.tsx`**＝`login` が `mfa_required` を返したら `MfaForm` へ遷移（PW は保持しない）。従来の「未対応」表示を置換。
- **`.../features/auth/api.ts`**＝`verifyMfa/resendMfa`。**`types.ts`** に `MfaChallenge/MfaResendResponse`（生成物から導出）。CSRF は `impl/frontend/src/lib/api/client.ts` の `apiFetch` が `iq_csrf`→`X-CSRF-Token` を自動付与。
- **`doc/画面設計/画面API連携/SC-00_ログイン.md` §1c**／**`impl/frontend/e2e/sc-00-mfa.spec.ts`（新規）**＝ACME-02 login→MailHog OTP→状態C→ダッシュボード。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend（ドメイン A・コントロールプレーン）**＝状態A（`login`/`GET /auth/session`/`logout`）＋状態B/D（`/auth/password-setup/{request,verify,complete}`）＋状態C（`login` の `mfa_required` 分岐／`/auth/mfa/{verify,resend}`／`/auth/logout-all`）が実装済み。pre-auth/OTP は Redis、セッションは Redis（`sess:{token}`＋逆引き `acct_sess:{account_id}`）、信頼端末・アカウント・OTP設定リンクは管理DB。
- **frontend**＝SC-00 状態A/B/C/D＋共通ヘッダー app-shell。実体は `impl/frontend/src/features/auth/`（`app/` はルーティングのみ）。型は OpenAPI 生成物 `impl/frontend/src/lib/api/schema.d.ts` から導出（`login/logout/session/password-setup×3/mfa×2/logout-all` を反映済み）。
- **壊れているもの＝無し（本セッションで確認）**:
  - **pytest 51 passed**（状態A/B/D＋MFA・確認は MFA backend ビルド後。以降 backend コードは未変更）。
  - **frontend tsc・lint クリーン**（状態C 実装後に確認）。
  - **e2e 4 passed**＝`sc-00-login`(A-TC-020/021)＋`sc-00-password-setup`＋`sc-00-mfa`（状態C 実装後に確認）。
  - **live 疎通確認済み**＝MFA login→MailHog OTP→verify（会社DBから表示名解決）→trust_device で次回 login が MFA スキップ、まで curl で確認。
- **要注意（負債・未実装）**:
  - **アカウント一時ロック未実装**＝後続 ADR へ委譲（ADR-0004 §2.5・ADR-0001 §2.6）。現状は (IP＋login_id) 10回/5分のレート制限＋OTP 失敗上限5 で一次防御。
  - **outbox 未実装**（ADR-0002 §2.4）＝`complete_password_setup` にコード TODO。会社DB `users` の `password_set` ミラーは worker スライスまで反映されない（login は管理DB `accounts` 直参照なので認証は正しい）。
  - **`MAIL_ALERT_TO` は宛先の器のみ**＝運用アラートの実送信経路は未実装（ADR-0003 §4 TODO）。
  - **`logout-all` の frontend 導線は未実装**（backend EP は在る）。
  - **e2e 実行環境**＝frontend コンテナ（Debian）に Playwright のブラウザ依存が未同梱。実行前に毎回 `install-deps` が要る（§8）。
- **シード/テストデータ**＝`impl/backend/tests/conftest.py` の `factory` が作成行を teardown で削除（accounts/otp_challenges/trusted_devices・会社DB users ミラー）。seed は不変＝**ACME-01（MFA OFF・`user@acme.example`）／ACME-02（MFA ON・`mfa@acme2.example`）**、PW いずれも `Passw0rd!`。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **ハマりどころ（記録・再発防止）**:
  - `docker compose run --rm backend pytest` は**既存イメージを使う**（自動リビルドしない）。backend コードを変えたら **`docker compose build backend` を先に**打たないと古いコードで走る（本セッションでも状態B/D 時に一度踏んだ）。
  - **e2e は frontend コンテナにブラウザ依存が無い**と全 spec が「Missing libraries」で失敗する（既存の login spec も含め全滅）。初回は `docker compose exec -u root frontend npx playwright install-deps chromium`（Debian・apt）が必要。イメージに焼くのは後続。
  - **MailHog のメール本文の encode は一定でない**（password_setup のリンクは base64／MFA の OTP は quoted-printable だった）。抽出は「base64 デコードを試す→ダメなら生テキスト」の順で正規表現。e2e/スクリプトの実装は `impl/frontend/e2e/sc-00-mfa.spec.ts` の `fetchOtp`・`sc-00-password-setup.spec.ts` の `fetchResetToken` が参考。
  - **e2e で seed の共有資格情報を壊さない**＝password-setup の complete は seed と同じ `Passw0rd!` を設定して他テストのログインを保つ。MFA の e2e は trust_device を付けない（trusted_devices 行を残さない）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッションの決定
- **設定の置き場所＝env（DB不採用）**＝ADR-0003（ユーザー承認 2026-08-09）。原則「デプロイ環境軸→env／テナント軸→DB」。SMTP は単一基盤・秘匿値・ブートストラップ依存回避で env。不採用＝DB（テナント設定/グローバル設定表）＝会社別に変える要件が無い・秘匿値を平文で持てない。会社別 BYO-SMTP は将来別 ADR。
- **本番の秘匿値供給＝シークレットマネージャ経由**（ADR-0003 §2.4）＝env という受け渡し方式は不変・供給元だけ dev=平文`.env`／本番=暗号化ストア注入に替える。平文 `.env` は本番サーバに置かない。
- **設定一覧は README にベタ書きしない**＝正は追跡対象の `.env.example`（コメント付き）＋ADR-0003。README は参照リンクのみ（DRY/drift 回避）。※`.env.example` は git 追跡対象・`.env` は追跡外で Compose が自動ロード・コンテナ環境変数の実設定は `compose.yaml` の `environment:`。
- **MFA しきい値＝env**（ADR-0004・ユーザー承認 2026-08-09）＝OTP 6桁/TTL600s/**失敗上限5**/resend30s/pre-auth600s/信頼端末30日。不採用＝DB（テナント別 or グローバル表）＝共通方針値で会社別要件が無い・既存しきい値が全部 config.py にあるのと不整合。
- **login OTP＋pre-auth は Redis 一体保持**（ADR-0004 §2.2・意図的選択）＝10分の揮発値・自動失効・スタック方針(Redis=OTP/pre-auth)・DBマイグ不要。不採用＝`otp_challenges`(DB) に purpose=login で保持（将来 OTP 監査要件が出たら移行）。
- **信頼端末は DB（`trusted_devices`）**＝30日永続・restart 越え・logout-all で失効が要る。不採用＝Redis（揮発値と性質が違う）。
- **OTP 失敗上限=5**（ユーザー選択）。不採用＝3（打ち間違いで失効しやすい）／10（10分TTL内の総当り試行が増える）。
- **アカウント一時ロックは本スライス範囲外**（ユーザー選択「MFAコア先行・ロックは後続」）＝列挙耐性/DoS/解除経路の争点整理が要るため後続 ADR。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001/A.10）／状態A 具体値（ADR-0001・アイドル30分/絶対12時間・Argon2id・(IP+login_id)10回/5分）。
- 初回・再設定PW（ADR-0002）＝設定リンク CSPRNG 32B・SHA-256 保存・72h・単回／PWポリシー 8文字＋英字＋数字／`request` は列挙耐性で常に 202（超過も 202）。
- 2プレーン×縦スライス4層（コーディング規約 §3.4 router→application→domain→repository）／フロント feature ベース（§4.1・`app/` はルーティングのみ）。

---

## 7. 次にやること — 優先順に、具体的に

### (1) アカウントロック方針の確定（後続 ADR＝ADR-0005 想定）＝最有力
- **委譲元**＝ADR-0004 §2.5・ADR-0001 §2.6。**着手時にユーザー確認が要る値が多い**（連続失敗 N回→T分ロック・解除経路〔自動T分/管理者/PW再設定〕・ロック対象アカウントの秘匿〔存在漏洩回避〕・他人IDの故意ロックによる DoS・OTP 連続失敗→pre-auth 失効との連動）。
- **手順**＝(1) `doc/ADR/ADR-0005_*.md` で値を確定（ADR-0001/0002/0004 と同じ体裁・ユーザー承認必須）→(2) `doc/テスト/A_認証.md` にテストパターン追加→(3) 実装。
- **実装の当たり**＝カウンタ/ロック状態は `impl/backend/app/core/security.py`（`check_login_rate_limit` の隣にロック関数を足す想定・Redis or `accounts` に列追加かは ADR で決める）／判定は `impl/backend/app/control_plane/auth/application.py` の `login`（`decide_login` の前後）。列挙耐性のため「ロック中でも一律 401」等の応答設計を ADR で固める。

### (2) フロント本格化(4)
- `impl/frontend/src/app/layout.tsx` 等に `next/font`（実フォント）／`impl/frontend/src/components/ui/` 拡充（Modal/Table/Badge）／背景画像（`.app-bg`）。共通ヘッダーの残高/ベルは K(`GET /me`)・H(通知)実装時。

### (3) outbox/worker スライス
- `account_sync_outbox`（データモデル §4.6）＝`complete_password_setup`（`impl/backend/app/control_plane/auth/application.py`）の TODO を解消。会社DB `users` に `password_set` 列追加＋同一Tx で outbox INSERT＋常駐 worker（`worker.py` は現状プレースホルダ）。

### (4) その他
- **`logout-all` の frontend 導線**＝`impl/frontend/src/components/layout/AppHeader.tsx` のユーザーメニューに「全端末からログアウト」を追加（backend EP `/auth/logout-all` は在る）。
- **`MAIL_ALERT_TO` の実送信経路**（監視/例外通知）＝送信元スライスを別途。
- **次ドメイン**＝K（プロフィール `GET /me`）・H（通知）等。API設計は `doc/API設計/` に確定済み。

### 仕上げパス（設計確定に伴い実施可）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化・現状は折衷で新規のみ準拠）。
- 門番表記2系統の統一（最終パスで一括）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up --build`。ポート＝db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`。backend の entrypoint が bootstrap（DB作成→`alembic` head〔control 0001/0002/0003〕→seed 2社・冪等）してから起動。
- **seed（開発用ログイン）**＝会社 `ACME-01`（`mfa_required=false`）/`user@acme.example`／会社 `ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose build backend && docker compose run --rm backend pytest -q`（**51 passed**。build を忘れると古いコードで走る＝§5）。MFA テストは `mail` フェイクで OTP を捕捉（本文 `認証コード: NNNNNN`）。
- **frontend 型チェック/lint**＝`docker compose run --rm --no-deps -T frontend npx tsc --noEmit` ／ `docker compose exec -T frontend npm run lint`。
- **codegen（型クライアント再生成）**＝backend 起動中に **ホストで** `cd impl/frontend && npx --yes openapi-typescript@7.5.0 http://localhost:8000/openapi.json -o src/lib/api/schema.d.ts`（frontend コンテナは source を bind mount しないためホスト生成が簡単・host に node22+npx あり）。生成物はホスト側に直接書かれる＝そのままコミット可。
- **e2e**＝フル起動後、初回のみ `docker compose exec -u root frontend npx playwright install-deps chromium`（Debian・apt）→ `docker compose exec frontend npx playwright install chromium` → `docker compose exec frontend npx playwright test`。spec＝`sc-00-login`/`sc-00-password-setup`/`sc-00-mfa`＝**4 passed**。**コンテナ内実行時 MailHog は `http://mailhog:8025`**（spec 既定・ホスト実行時は `MAILHOG_URL` で上書き）。
- **MailHog でメール確認**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は §5）。
- **主要 env（`impl/.env.example` が雛形・`.env` は追跡外で Compose が自動ロード）**＝`COOKIE_SECURE`（本番 true）／`SMTP_*`・`MAIL_FROM`・`MAIL_ALERT_TO`（ADR-0003）／`OTP_*`・`PREAUTH_TTL_SECONDS`・`TRUSTED_DEVICE_TTL_SECONDS`（ADR-0004）。実設定は `impl/compose.yaml` の backend `environment:`。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf` は追跡外（Markdown が正）・`.env` も追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff にハッシュ追記の2段**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**プッシュはユーザー依頼時のみ**。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY は §2.3。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**(1) アカウントロック方針の ADR（着手時にユーザー確認）**。SC-00 全状態は縦に完了。
- ✅ 本セッションの成果（ADR-0003＋メール env 配線／状態B/D frontend／ADR-0004＋MFA 状態C backend＋frontend）と採否理由を §3/§6 に記録。
- ✅ 状態＝pytest 51 緑・frontend tsc/lint クリーン・e2e 4 緑・live 疎通（いずれも本セッションで確認）。未確認・未実装は §4 に「未実装/負債」として明記（ロック・outbox・MAIL_ALERT_TO 送信・logout-all frontend 導線）。
- ✅ ハマりどころ（build 忘れ／playwright install-deps／メール encode／seed 資格情報の保全）を §5 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/API設計/*.md`・`doc/ADR/*.md`・`doc/テスト/A_認証.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
