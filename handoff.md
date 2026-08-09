# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）と `doc/API設計/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→テストパターン→テストコード」の連鎖で 1 スライスずつ縦に通す。**
> 既済＝(a) ログイン状態A（PWログイン＋session＋logout・backend pytest＋frontend SC-00＋e2e）／(b) フロント本格化(1)〜(3)（トークン移植・OpenAPI 型クライアント codegen・共通ヘッダー app-shell）／**(c) 状態B/D＝初回・再設定パスワード（backend `dc5fdcd`＋frontend `dd4d8ce`＝縦に完了）**／(d) 設定/秘匿の置き場所 ADR-0003＋メール設定 env 配線。
> **次の最有力＝(2) MFA（状態C）**（login の `mfa_required` 分岐・OTP メール・pre-auth・trusted_devices）。(3) アカウントロック方針確定（MFA と一緒に設計すると手戻り少）(4) フロント本格化(4)。いずれも「少しずつ」。

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-09 JST**（セッション終了時）
- ブランチ: **main**（作業ツリー クリーン＝確認済み）。
- 最新コミット（本体）: **`dd4d8ce`**＝「実装 状態B/D frontend: 初回・再設定パスワードの画面を縦に通す」。**本 handoff 更新はこの直後の単独コミット**（2段方式の2段目・確定ハッシュは本コミット後に git log で確認）。関連の直近＝`9ea486a`(README参照案内)・`3def11d`(メール設定 env 配線)・`6317a6e`(ADR-0003)・`dc5fdcd`(PW設定 B/D backend)。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`（`origin/main`）。**本セッション分（`dd4d8ce` 状態B/D frontend＋各 handoff まで）ユーザー依頼で `origin/main` へプッシュ済み**。次回開始時は `git status` がクリーン・`origin/main` と同期している想定。
- 直近コミット（新しい順）:
  - （本 handoff 単独コミット・本セッション末）
  - `dd4d8ce` 実装 状態B/D frontend（本セッション・未プッシュ）
  - `9ea486a` docs(README): 設定は .env.example と ADR-0003 を参照
  - `3def11d` 実装 メール設定 env 配線
  - `6317a6e` docs(ADR): ADR-0003 設定と秘匿情報の置き場所
  - `dc5fdcd` 実装 PW設定(B/D) backend
  - `51ddbb7` docs: README に OpenAPI 確認方法追記
  - `bda86a5` frontend 本格化(3) 共通ヘッダー app-shell
  - `c82ed2f` frontend 本格化(2) OpenAPI 型クライアント codegen
  - `1cc7bd1` frontend 本格化(1) トークン移植＋components/ui＋SC-00

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js／バック FastAPI／PostgreSQL（全文検索 PGroonga）／Redis／MinIO／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと（本セッション）＝状態B/D の backend 実装

**スライス範囲＝ドメイン A の状態B/D（初回・再設定パスワード）を backend で縦に。** 手法＝設計→テストパターン→テストコード。frontend は後続（§7-(1)）。本体コミット＝`dc5fdcd`。

- **設計（ADR-0002 新設）**＝`doc/ADR/ADR-0002_初回・再設定パスワード基本パラメータ.md`。A.7/A.8 で「実装時に確定」だった具体値を採否理由つきで確定:
  - 設定リンクトークン＝CSPRNG 32B base64url・**SHA-256 ハッシュ保存**（高エントロピーゆえ Argon2 不要）・**72h・単回**・`request` で旧未使用チャレンジ失効（最新のみ有効）。
  - **PWポリシー＝最低8文字＋英字1＋数字1**（SC-00 §4 どおり・MVP最小。漏えい済み/よく使われるPW拒否は後続＝ユーザー選択）。
  - `request` レート制限＝**(IP＋company_code＋login_id) 5回/10分**。**超過時も `202` 維持**（`429` を返すと実在を漏らす＝列挙耐性優先。ログイン ADR-0001 §2.6 とは秘匿要件が異なる）。
  - **タイミング差＝限定的**（同期メール送信で eligible 経路が遅い＝残余差あり・既知MVP限界。等時間化は非同期送信=worker 導入時）。
  - **outbox（会社DB users への password_set ミラー・§4.6）は延期**（worker 未存在・users ミラーに password_set 列なし・login は accounts 直参照で機能は縦に通る＝ユーザー選択）。complete にコード TODO を明記。
  - `A_認証・セッション.md` §A.8 の該当TBD を ADR-0002 参照へ更新。
- **テストパターン**＝`doc/テスト/A_認証.md` に §3（A-TC-030〜051）追加。request（030〜040・列挙耐性202/CSRF免除/不正Origin403/レート/欠落422/旧失効）・verify（041〜044・200/410）・complete（045〜049・200/422/410/単回/全セッション破棄）・PWポリシー unit（051）。ヘッダの範囲記述も状態B/D を含むよう更新。
- **実装（コーディング規約 §3.4 の4層・control_plane/auth）**:
  - EP＝`POST /api/v1/auth/password-setup/{request,verify,complete}`（router・**CSRF 免除＝Origin/Sec-Fetch のみ**・未認証起点）。
  - domain＝`password_policy_errors()`（純粋関数）。application＝`request/verify/complete_password_setup`（request は常に無戻り値=202・実送信は eligible のみ・post-commit 送信）。repository＝otp_challenges の CRUD（失効/作成/ハッシュ検索）＋`get_account`。
  - core/security＝`hash_token`（SHA-256）・`create_session` に account 逆引き集合（`acct_sess:{id}`）・`delete_account_sessions`（A.9-③ 全セッション破棄）・`within_pw_request_rate_limit`（超過でも例外を投げず False）。
  - control migration **0002**＝`otp_challenges`（id/account_id/code_hash/purpose/expires_at/used_at・index(account_id,purpose)）。ORM に `OtpChallenge`。
  - infra/mail＝送信ポート `MailSender`＋`SmtpMailSender`（MailHog）＋`FakeMailSender`（テスト捕捉）＋`set/get_mail_sender`。config に SMTP/APP_BASE_URL/TTL/レート値。compose に **mailhog**（SMTP 1025 / UI 8025）＋backend env。`.env.example` 追記。
  - **complete 成功時**＝`accounts.password_hash` を Argon2id で更新（=`password_set` true）＋トークン消費＋全セッション破棄。**新セッションは張らない**（設定後は通常ログイン）。
- **検証**:
  - `docker compose run --rm backend pytest -q` ＝ **40 passed**（既存19＋新21）。
  - **live**（`docker compose up -d backend`）＝seed アカウントで request→MailHog（`:8025`）受信→本文（base64）から token 抽出→`verify` が `{valid:true}`。**seed は complete せず PW 温存**（他テストのため）。OpenAPI に3EP反映を確認。stray チャレンジは掃除済み。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend**＝ドメイン A の状態A（login/session/logout）＋状態B/D（password-setup）が実装済み。MFA（状態C）は `application.login` に契約形 stub のみ（`mfa_required=true` で `{delivery:"email"}` を返すだけ）。
- **frontend**＝SC-00 状態A（ログイン）＋共通ヘッダー app-shell＋**状態D（`/password-reset` 再設定リクエスト）／状態B（`/password-setup?token=` PW設定）を実装済み（`dd4d8ce`）**。`schema.d.ts` は3EP反映で再生成済み。
- **壊れているもの**＝なし（pytest 40 緑・frontend tsc/lint クリーン・**e2e 3 passed**＝A-TC-020/021＋新 sc-00-password-setup）。
- **要注意（負債）**:
  - **outbox 未実装**（ADR-0002 §2.4・complete に TODO）。会社DB users の password_set ミラーは worker スライスまで反映されない（login は accounts 直参照なので認証は正しい）。
  - **e2e の実行環境**＝frontend コンテナ（Debian）に Playwright のブラウザ依存が未同梱。初回は `docker compose exec -u root frontend npx playwright install-deps chromium` が必要（§8 に追記）。イメージに焼くのは後続。
  - MFA（状態C）は `application.login` に契約形 stub のみ（`mfa_required=true` で `{delivery:"email"}` を返すだけ）。frontend の login は現状 `mfa_required` を「未対応」表示で握っている。
- **DB のテストデータ**＝pytest の `factory` は作成行を teardown で削除（control の accounts/otp_challenges・会社DB users ミラーも）。seed（ACME-01 / `user@acme.example` / `Passw0rd!`）は不変。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーなし**。
- **ハマりどころ（記録）**＝`docker compose run --rm backend pytest` は**既存イメージを使う**（自動リビルドしない）。backend コードを変えたら **`docker compose build backend` を先に**打たないと古いコードでテストが走る（本セッションで一度踏んだ＝新テストが collect されず 19 のままだった）。
- **メール本文は base64 エンコード**（quoted-printable ではない）。MailHog から token を取るときは `base64.b64decode` して `password-setup?token=(\S+)` を拾う。

---

## 6. 決定事項と根拠（本セッション・採用しなかった案も）

- **（本セッション追記）SMTP 等の設定は `.env`（環境変数・本番はシークレットマネージャ経由）。DB 不採用**＝[`doc/ADR/ADR-0003_設定と秘匿情報の置き場所.md`](doc/ADR/ADR-0003_設定と秘匿情報の置き場所.md) で確定（ユーザー承認 2026-08-09）。原則＝「デプロイ環境軸→env／テナント軸→DB」。SMTP は単一基盤・秘匿値・ブートストラップ依存回避で env。`.env` 管理項目を秘匿/非秘匿で分類明記。会社別 BYO-SMTP は別 ADR へ委譲。ADR-0002 §2.5 から相互参照追記。
- **（本セッション追記）メール設定7項目を env に配線（`3def11d`）**＝`SMTP_HOST/PORT/USER/PASSWORD/START_TLS`＋`MAIL_FROM`＋`MAIL_ALERT_TO`（アラート宛先の器）を `config.py`＋`.env.example`＋`compose.yaml` の三点に追加。TLS は参照システムに合わせ**真偽値 `SMTP_START_TLS`**。`SmtpMailSender` を STARTTLS/認証対応（dev の MailHog は空/False でそのまま動作）。pytest 40 緑。**アラートメールの実送信経路は未実装＝宛先の器のみ（ADR-0003 §4 TODO）**。
- **（本セッション追記）設定項目の共有方針＝README にベタ書きしない**（`9ea486a`）。一覧の正は**追跡対象の `.env.example`（コメント付き）**、方針は ADR-0003。README は両者へのリンクのみ（DRY/drift回避）。※`.env.example` は git 追跡対象・`.env` は追跡外で Compose が自動ロードする実値置き場・コンテナ環境変数の設定箇所は `compose.yaml` の `environment:` ブロック（`.env.example` はどこからも読まれない雛形）。

- **PWポリシー＝8文字＋英字＋数字**（ユーザー選択）。不採用＝NIST式(12文字・文字種不問)／拒否リスト同梱（後続へ）。
- **outbox は本スライスで作らず延期**（ユーザー選択）。不採用＝table＋同一Tx INSERT を今入れる。理由＝worker 未存在・users 列未拡張・login は accounts 直参照で機能は通る。**同一Tx要件の設計は維持**（TODO 明記）。
- **`request` 超過は 429 でなく 202 維持**（列挙耐性優先・ADR-0002 §2.3）。
- **トークンは SHA-256**（高エントロピーゆえ Argon2 不要）。
- **全セッション破棄の実装＝account 逆引き集合**（`acct_sess:{account_id}`）を create_session で登録し complete/将来の logout-all で列挙削除（A.9-③）。
- 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/`）＝ログイン Cookie+Redis 不透明セッション（ADR-0001/A.10）／状態A 具体値（ADR-0001）／2プレーン×縦スライス4層（コーディング規約 §3.4）／フロント feature ベース（§4.1）。

---

## 7. 次にやること — 優先順に、具体的に

### (1) 状態B/D の frontend ＝ **完了（本セッション・`dd4d8ce`）**
- ✅ 実装済み: `PasswordResetRequestForm`(状態D)／`PasswordSetupForm`(状態B)／`app/(auth)/password-reset`・`app/(auth)/password-setup`／login に導線リンク／`api.ts` に request/verify/complete／`schema.d.ts` 再生成／画面API連携 md 追記／e2e `sc-00-password-setup`（D→MailHog→B→complete→login・3 passed）。
- 以下は当初計画（記録として保持）。
- **SC-00 状態B（初回/再設定PW設定）と状態D（再設定リクエスト）の画面**を `impl/frontend/src/features/auth/` に実装（`app/` はルーティングのみ・§4.1）。
  - 状態D＝ログイン画面の「パスワードをお忘れですか？」→ company_code＋login_id フォーム→ `POST /password-setup/request`→ **常に同一の確認メッセージ**（列挙耐性・SC-00 §7）。
  - 状態B＝**メールリンク先の専用ページ**（例 `app/(auth)/password-setup/page.tsx`・`?token=`）。表示前に `POST /password-setup/verify`→ 有効なら新PW＋確認フォーム→ `POST /password-setup/complete`→ 成功でログイン画面へ。無効/期限切れ/使用済（410）は再要求案内。
  - PWポリシー（8文字＋英字＋数字）はクライアント補助検証＋サーバ最終判断（422 の `errors[]` をフィールド下に）。
- **`codegen` 再生成**（backend に3EP追加済み・§8手順）＝`schema.d.ts` を更新しコミット対象に。`features/auth/types.ts` を生成物から導出（drift 防止・本格化(2)の方針）。
- **画面API連携 md**＝`doc/画面設計/画面API連携/SC-00_ログイン.md` に状態B/D の呼び出し順序/画面反映/Cookie・CSRF 配線を追記（スキーマは OpenAPI/A.7 が SoT）。
- **e2e/api テスト**＝状態D→メール（MailHog API で取得）→状態B→complete→login の一連を Playwright で（A-TC-020 系の隣に）。または API レベルで十分なら pytest 側は既済なので e2e はハッピーパス薄く。

### (2) MFA（状態C）＝次に大きいスライス
- login の `mfa_required` 分岐を実装（現在 stub）。OTP メール送信（`otp_challenges` purpose=`login`・6桁・10分・**同テーブルを既に用意済み**）／pre-auth セッション（`iq_preauth`・別実体・最小権限）／`POST /auth/mfa/{verify,resend}`（resend クールダウン）／`trusted_devices`（`iq_trust` 30日・新規テーブル要）。設計の正＝`A_認証・セッション.md` A.0〜A.1。**アカウントロック方針（下記(3)）と一緒に設計すると手戻り少（ADR-0001 §2.6 の委譲先）**。

### (3) アカウントロック方針の確定
- ADR-0001 §2.6 で **MFA/ハードニングスライスへ委譲**済み。連続失敗 N回→T分ロック・解除経路・OTP連続失敗→pre-auth 失効との連動・DoS/列挙耐性の衝突を、A設計＋後続 ADR で確定してから login/mfa に実装。

### (4) フロント本格化(4)
- `next/font`（実フォント）／`components/ui` 拡充（Modal/Table/Badge）／背景画像（`.app-bg`・K）。ヘッダーの残高/ベルは K(`GET /me`)・H(通知)実装時に追加。

### 仕上げパス（設計確定に伴い実施可）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化・現状は折衷で新規のみ準拠）。
- 門番表記2系統の統一（A系統=散文／B系統=`AND`明示。意味は同一・最終パスで B系統へ一括）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up --build`（db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`）。seed＝会社 `ACME-01`（`mfa_required=false`）＋`user@acme.example`/`Passw0rd!`。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose build backend && docker compose run --rm backend pytest -q`（**40 passed**。build を忘れると古いコードで走る＝§5）。entrypoint が bootstrap（DB作成→migrate head〔0001+0002〕→seed・冪等）してから pytest を exec する。
- **codegen（frontend 型クライアント）**＝frontend コンテナは source を bind mount しないため、**ホストで直接生成するのが簡単**（host に node22+npx あり）。backend 起動中に `cd impl/frontend && npx --yes openapi-typescript@7.5.0 http://localhost:8000/openapi.json -o src/lib/api/schema.d.ts`。生成物はホスト側 `impl/frontend/src/lib/api/schema.d.ts` に直接書かれる＝そのままコミット可（本セッションはこの方法で3EP反映済み）。
- **e2e**＝フル起動後、初回のみブラウザ依存を入れる: `docker compose exec -u root frontend npx playwright install-deps chromium`（Debian・apt）→ `docker compose exec frontend npx playwright install chromium` → `docker compose exec frontend npx playwright test`。spec＝`sc-00-login`（A-TC-020/021）＋`sc-00-password-setup`（状態D→B→login）。**コンテナ内実行時 MailHog は `http://mailhog:8025`**（spec の既定・ホスト実行時は `MAILHOG_URL` で上書き）。※ブラウザ依存はイメージ未同梱＝毎回 install-deps が要る（イメージに焼くのは後続）。
- **MailHog でメール確認**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文は base64＝§5）。
- **技術スタック**＝フロント Next.js(App Router)／バック FastAPI(4層 router→application→domain→repository・2プレーン control_plane/tenant)／DB PostgreSQL(管理DB1＋会社DB N・PGroonga 会社DBのみ)／Redis(セッション/OTP/pre-auth/冪等/PubSub)／MinIO(画像)／MailHog(dev メール)／全て Docker。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf` は追跡外（Markdown が正）。
  - コミットは **本体→handoff にハッシュ追記の2段**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。プッシュはユーザー依頼時のみ。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY は §2.3。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**(1) 状態B/D の frontend（画面＋password-setup ページ＋codegen 再生成＋画面API連携 md＋e2e）**。backend は完了済み（`dc5fdcd`・pytest 40 緑）。
- ✅ 本セッションの成果（ADR-0002・A-TC-030〜051・4層実装・otp_challenges・infra/mail・MailHog）と採否理由（PW=8+英数／outbox延期／request=202維持＝いずれもユーザー選択）を §3/§6 に記録。
- ✅ 未処理を明記＝**schema.d.ts 未再生成**・**outbox 未実装(TODO)**・状態B/D frontend 未着手・MFA/ロックは後続。
- ✅ ハマりどころ（`docker compose build backend` 忘れ／メール本文 base64）を §5 に記録。
- ⚠ 詳細な決定理由は各 `doc/API設計/*.md`・`doc/ADR/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
