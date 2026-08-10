# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。red-green 必須（テスト規約 §5.1）。**
> **直近スライス＝`account_sync_outbox`（管理DB→会社DB `users` ミラー・§4.6）を backend で縦通し完了。次スライス＝② メール非同期化（着手前に設計方針の相談が要る＝§7）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-11 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・`origin/main` と同期＝`git status` で確認済み）。
- 最新コミット: **`0fa2387`**（本 handoff 更新はこの後の別コミット＝2段目・ハッシュは git 参照）。
- 前回 handoff（`87e19e3`）以降のコミット（新しい順・**すべて `origin/main` へプッシュ済み**）:
  - `0fa2387` 実装 account_sync_outbox（管理DB→会社DB users ミラー・§4.6）＝**本セッションの成果**
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。**未プッシュのコミットは無い**。
- （参考）これ以前の主なコミット＝`c18006d` クライアントIP確定(ADR-0006)、`89c9265` アカウント一時ロック(ADR-0005)、それ以前に SC-00 ログイン全状態(A/B/C/D)。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

本セッションの成果＝**① `account_sync_outbox`（DBミラー）スライス**（`0fa2387`）。目的＝`complete_password_setup` に残っていた「outbox 未実装」TODO を解消し、**管理DB `accounts` → 会社DB `users` の一方向ミラー**（今回は `password_set`）を outbox＋常駐ワーカで結果整合に反映する機構を縦通しすること（データモデル §4.6・ADR-0002 §2.4）。

> 重要な用語整理（会話で混同があったため明記）＝**`account_sync_outbox`（§4.6）は「DB→DB のコピー」であってメール送信ではない**。メール（OTP・設定リンク・ロック通知）は別機構で、その非同期化は **②（未着手・§7）**。

### 新規ファイル
- `impl/backend/app/control_plane/account_sync/`＝新モジュール。
  - `orm.py`＝`OutboxEntry`（テーブル `account_sync_outbox`）。**`seq`（BIGSERIAL/Identity）で挿入順＝因果順を担保**（理由＝§5/§6）。
  - `repository.py`＝`enqueue(session, account_id, company_id, op, payload)`（呼び出し側 Tx に相乗）／`fetch_unfinished(session)`（`status!=done` を `seq` 昇順）。
  - `application.py`＝`process_outbox_once()`（1巡処理・要約 dict 返す）／`_apply_one(entry_id)`（会社DB へ冪等 upsert→`done`、失敗は `attempts++`・上限超で `failed`）。**両プレーンを跨ぐ唯一の実行主体**。
- `impl/backend/migrations/control/versions/0004_control_account_sync_outbox.py`＝`account_sync_outbox` 作成。
- `impl/backend/migrations/company/versions/0002_company_users_password_set.py`＝会社DB `users.password_set` 列追加。
- `doc/テスト/B_会社・アカウント.md`＝テストパターン B-TC-001〜005。
- `impl/backend/tests/account_sync/test_outbox.py`＝上記の int テスト。

### 変更ファイル
- `impl/backend/app/control_plane/auth/application.py`＝`complete_password_setup` が accounts 更新と**同一Tx**で `account_sync_repo.enqueue(...)`（`op=upsert`・`payload={"password_set": True}`）を実行（TODO 解消）。import 追加。
- `impl/backend/app/tenant/profile/orm.py`＝`User.password_set` 列（`Boolean`）追加。`Boolean` を import。
- `impl/backend/app/tenant/profile/repository.py`＝`upsert_user_mirror(session, account_id, payload)`（`account_id` キーで upsert・`_MIRROR_FIELDS` のみ反映＝前方互換）。
- `impl/backend/app/worker.py`＝プレースホルダ→常駐ループ（`process_outbox_once` を `outbox_poll_interval_seconds` 間隔で poll・SIGTERM/SIGINT で停止）。
- `impl/backend/app/core/config.py`＝`outbox_max_attempts=5`／`outbox_poll_interval_seconds=1.0`。
- `impl/backend/migrations/control/env.py`＝`account_sync.orm` を import（metadata 登録）。
- `impl/backend/scripts/bootstrap.py`＝seed users 作成時に `password_set=(account.password_hash is not None)` を設定（新規作成時のみ・既存行は据え置き）。
- `impl/backend/tests/conftest.py`＝factory teardown で `OutboxEntry`（FK→accounts）を accounts 削除前に掃除。
- `impl/compose.yaml`＝`worker` サービス追加（backend 同一イメージ・env は YAML アンカー `&backend_env`/`*backend_env` で共有・`entrypoint` を `python -m app.worker` に上書き）。`OUTBOX_*` env を追加。
- `impl/.env.example`＝`OUTBOX_MAX_ATTEMPTS`/`OUTBOX_POLL_INTERVAL_SECONDS`。
- `doc/ADR/ADR-0002_…md` §2.4＝「委譲/TODO」→「実装済み（2026-08-11）」に更新。`doc/テスト/A_認証.md` §3.5＝outbox を B テスト参照に更新。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **動いているもの（backend で縦通し済み）**:
  - ドメイン A ログイン：状態A（PWログイン）・B（初回/再設定PW）・C（MFA）・D（再設定要求）。**SC-00 は frontend も完了**。
  - アカウント一時ロック（ADR-0005・(IP+login_id)・第二層）。
  - クライアント IP 確定（ADR-0006・信頼プロキシ段数・env `TRUSTED_PROXY_COUNT`）。
  - **account_sync_outbox（本セッション）**：complete で pending 生成 → `process_outbox_once`/`worker.py` が会社DB `users.password_set` へ冪等反映。
- **テスト（本セッションで実測）**:
  - **backend pytest = 67 passed**（従来 62＋outbox 5・回帰なし。ホストソースを `/app` にマウントして実行・§8）。
  - **worker 起動スモーク**＝`python -m app.worker` が起動→SIGTERM で停止することを確認（実処理はテスト側 `process_outbox_once` で担保）。
  - **frontend tsc / e2e は本セッションでは未再実行**（frontend を変更していない）。**前回時点＝tsc クリーン・e2e 4 passed**。
- **Docker（今回終了時点）**＝**db / redis のみ起動中（healthy）。backend / frontend / worker は停止**（テストは `docker compose run --rm` の使い捨てコンテナで実行したため）。**Playwright ブラウザ依存は未導入**（frontend コンテナが無い＝e2e 時は §8 の install 再実行が必要）。
- **壊れているもの＝無し**（既知の未実装/負債は下記）。
- **未実装 / 負債**:
  - **② メール送信の非同期化**（OTP・設定リンク・ロック通知・`MAIL_ALERT_TO`）＝未着手（§7）。現状はすべて同期送信。
  - **outbox の他 writer 未実装**＝`last_login_at`（login 成功時）・発行/編集/無効化（B ドメイン）・プロフィール編集（K）。今回は `password_set` writer 1 本のみ。`users` ミラー列も `login_id`/`email`/`system_role`/`last_login_at` は未追加。
  - **outbox `failed` 行の可視化/手動対応・管理者によるロック解除**＝管理面が無いため後続。
  - **`logout-all` の frontend 導線**＝未実装（backend EP は在る）。
  - **本番デプロイ設定**（`TRUSTED_PROXY_COUNT` の実値・エッジの XFF 確定・Next の XFF 転送検証）＝`doc/本番デプロイ要件.md` §6 に集約・未確認。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションで判明・対処した点**:
  - **outbox の順序キーに uuid `id` は使えない**＝`id` は `uuid4`（ランダム）で挿入順を表さないため、データモデル §4.6 が言う「id（生成順）」を `ORDER BY id` では実現できない。→ **`seq`（BIGSERIAL/Identity）列を追加し `seq` 昇順で取り出す**ことで因果順を担保した（`account_sync/orm.py`・`repository.fetch_unfinished`）。**注意＝`doc/データモデル.md` §4.6 の本文は「id（生成順）」表記のままで seq に触れていない＝ドキュメントと実装に軽微な差**（未反映。§6 の判断を §4.6 に追記して正規化するのが望ましい）。
  - **factory teardown で FK 順序**＝`account_sync_outbox` は `accounts` に FK。accounts 削除前に outbox 行を消さないと teardown が落ちる。→ `tests/conftest.py` の factory teardown に `OutboxEntry` 掃除を追加。
  - **失敗系テストの作り方**＝ワーカ適用失敗は「会社DB が存在しない会社」（`factory.make_company()` の `db_identifier` は実DBを作らない）で `get_tenant_session` 接続失敗を起こして再現（B-TC-004/005）。PG サーバは起動しているので「DB 不在」は即 FATAL＝速い。
- **一般のハマりどころ（継続・重要）**:
  - **backend/e2e ともイメージにソースが焼かれている**（`COPY . .`・bind mount 無し）。ホスト編集を反映するには backend＝`-v "$PWD/backend:/app"` マウント（§8）、e2e＝`docker compose cp` で spec 流し込み。
  - **env の上書きテスト**＝`monkeypatch.setenv(...)＋get_settings.cache_clear()`（`get_settings` は `lru_cache`）。finally で `cache_clear()` して後片付け（例＝`tests/account_sync/test_outbox.py` B-TC-004・`tests/auth/test_client_ip.py`）。
  - **IP 差し替え**＝`TestClient(app, client=(ip, port))`（lock/IP テスト）。**メール送信が走るテストは `mail` フェイク必須**（無いと実 SMTP で `socket.gaierror`）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（outbox スライスの実装判断）
正＝`doc/データモデル.md` §4.6・`doc/API設計/README.md` §1.13・`doc/API設計/B_会社・アカウント・所属.md` B.5。
- **順序キー＝`seq`（単調増加）**。不採用＝`ORDER BY id`（uuid でランダム）／`created_at`（§4.6 が「壁時計ではない」と明記）。
- **ワーカ本体は関数 `process_outbox_once()`**（`worker.py` はループするだけ）＝常駐プロセス無しで int テスト可能。
- **クロスDB は 2 相コミットしない**＝会社DB へ冪等 upsert（`account_id` キー）→ その後 `status=done`。途中で落ちても **at-least-once＋冪等**で安全（§4.6）。
- **ヘッドオブライン・ブロッキング**＝同一 account は `seq` 順で直列、失敗したら後続を今回進めない（退行防止）。**別 account は独立**に処理（1件の滞留が全体を止めない）。
- **`outbox_max_attempts`（既定5・env）**＝§4.6 は「上限超で failed」と方針のみで数値未定＝運用しきい値として env に置く（ADR-0003 の env 原則に沿う・新規 ADR は起こさず config コメントに根拠）。
- **スコープ＝`password_set` writer 1 本のみ**（ADR-0002 §2.4 の範囲）。`last_login_at`・発行/編集（B）・プロフィール（K）は該当エンドポイント実装時に writer を足す。
- **メール非同期化（②）は §4.6 outbox に載せない**＝§4.6 は DB ミラー専用。メールは別機構（別スライス）。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001・アイドル30分/絶対12時間・Argon2id・(IP+login_id)10回/5分の429）。
- 初回・再設定PW（ADR-0002）＝設定リンク CSPRNG32B・SHA-256・72h・単回／PWポリシー8文字＋英字＋数字／`request` は列挙耐性で常に202。
- MFA/信頼端末（ADR-0004）＝OTP6桁/TTL600/失敗上限5/resend30s・pre-auth600s は Redis 一体・信頼端末は DB（`trusted_devices`・30日）。
- アカウント一時ロック（ADR-0005）＝(IP+login_id)・5回→15分・ロック中も一律401・発火時に本人へ通知メール（1通/60分/account）・PW再設定成功で即解除・OTP失敗は非連動・Redis 保持。**失敗計数 `login_fail_streak` は固定窓15分（最初の失敗でTTL設定・延長しない）＝成功 or 15分経過で0**。
- クライアントIP確定（ADR-0006）＝`trusted_proxy_count`（env・既定0）で XFF を右から数え実クライアントIPを確定。本番はエッジで XFF 確定（`doc/本番デプロイ要件.md`）。
- 設定の置き場所（ADR-0003）＝env（環境軸）／DB（テナント軸）。
- 2プレーン×縦スライス4層（コーディング規約 §3.4 router→application→domain→repository・エントリは `main.py`/`worker.py` の2つ）／フロント feature ベース（§4.1）。
- テスト運用＝red-green 全レベル必須（テスト規約 §5.1）。証跡＝test-first はコミットメッセージ／後追い（反転手技）は `doc/テスト/red確認台帳.md`。

---

## 7. 次にやること — 優先順に、具体的に

### (1) ② メール送信の非同期化＝最有力（着手前に設計方針の相談が必要）
- **目的**＝現在同期送信のメールを「キューに積んで後で送る」に変え、(a) ADR-0005 §5 の弱いタイミングオラクル・(b) SMTP 失敗時に 401/202 が 500 になる列挙耐性の綻び・(c) ADR-0002 §2.3 の `request` 残余タイミング差を解消する。
- **未決の設計判断（ユーザー相談事項）**＝機構の選択＝(A) `account_sync_outbox` と同型の**メール用 DB アウトボックス**（確実配送・§4.6 の資産流用）か、(B) **Redis キュー**か。→ **新 ADR（例 ADR-0007「メール送信の非同期化」）を起票**してから実装する。§4.6 とは別テーブル/別ワーカになる点に注意（`worker.py` に相乗させるか別プロセスかも決める）。
- **対象コード**＝`impl/backend/app/control_plane/auth/application.py` の `_send_otp_email`／`_send_password_setup_email`／`_send_lock_notification`、`impl/backend/app/infra/mail.py`（`MailSender`/`FakeMailSender`）。
- **テスト**＝新テストパターン（ドメイン記号は要検討＝メールは横断。暫定 A か新設）。red-green 必須。

### (2) outbox の writer 追加（②と独立・B/K ドメイン実装時）
- `last_login_at` ミラー＝`login` 成功時（`impl/backend/app/control_plane/auth/application.py` の `_issue_session` 近辺）に enqueue。会社DB `users.last_login_at` 列追加（company migration）＋`_MIRROR_FIELDS` 拡張（`impl/backend/app/tenant/profile/repository.py`）。
- 発行/編集/無効化（B.2/B.5）＝B ドメイン API 実装時に enqueue（`op=upsert/disable/enable`・payload に `display_name`/`login_id`/`email`/`system_role`/`locale`＋初期所属 `memberships`）。

### (3) `logout-all` の frontend 導線
- `impl/frontend/src/components/layout/AppHeader.tsx` のユーザーメニューに追加（backend EP `POST /api/v1/auth/logout-all` は実装済み）。e2e を薄く1本。

### (4) 運用・本番系（実装ではなく設定/検証・`doc/本番デプロイ要件.md` §6）
- 本番トポロジのホップ数確定→`TRUSTED_PROXY_COUNT` 設定／Next `rewrites()` の XFF 転送検証。
- outbox `failed` 行の監視/アラート、管理者ロック解除の可視化（管理面が整ってから）。

### 仕上げパス
- **`doc/データモデル.md` §4.6 に `seq`（順序キー）を明記**して実装と正規化（§5 の差分解消）。
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化・現状は折衷で新規のみ準拠）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`。**worker はポート無し**（常駐のみ）。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001-0004・company 0001-0002〕→seed 2社・冪等）してから uvicorn。**今回終了時点で起動中は db / redis のみ**。
- **seed（開発用ログイン）**＝会社 `ACME-01`（`mfa_required=false`）/`user@acme.example`／会社 `ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（イメージ焼き直し版）**＝`cd impl && docker compose up -d db redis && docker compose build backend && docker compose run --rm backend pytest -q`（**67 passed**）。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest tests/ -q`（build 不要でホスト変更が即反映）。
- **worker 単体スモーク**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" -e OUTBOX_POLL_INTERVAL_SECONDS=0.2 backend timeout 2 python -m app.worker`（起動→停止ログを確認）。
- **frontend 型チェック/lint**＝`docker compose run --rm --no-deps -T frontend npx tsc --noEmit` ／ `docker compose exec -T frontend npm run lint`（lint は frontend 起動中のみ）。
- **codegen（型クライアント再生成）**＝backend 起動中に **ホストで** `cd impl/frontend && npx --yes openapi-typescript@7.5.0 http://localhost:8000/openapi.json -o src/lib/api/schema.d.ts`。
- **e2e**＝フル起動後、**初回のみ** `docker compose exec -u root frontend npx playwright install-deps chromium` → `docker compose exec frontend npx playwright install chromium`（**今回 frontend コンテナは無い＝再導入が必要**）→ `docker compose exec frontend npx playwright test`（**前回 4 passed**）。コンテナ内 MailHog は `http://mailhog:8025`。編集 spec は `docker compose cp` で反映。
- **MailHog**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は password_setup=base64／MFA OTP=quoted-printable と一定でない＝base64 デコード試行→ダメなら生テキスト）。
- **主要 env（`impl/.env.example` が雛形・`.env` は追跡外で任意。無ければ Compose が `${VAR:-既定}` で既定にフォールバック＝現在 `.env` は不在）**＝`COOKIE_SECURE`（本番true）／`SMTP_*`・`MAIL_FROM`・`MAIL_ALERT_TO`（ADR-0003）／`OTP_*`・`OTP_LENGTH`・`PREAUTH_TTL_SECONDS`・`TRUSTED_DEVICE_TTL_SECONDS`（ADR-0004）／`LOGIN_LOCK_*`（ADR-0005）／`TRUSTED_PROXY_COUNT`（ADR-0006・既定0）／**`OUTBOX_MAX_ATTEMPTS`・`OUTBOX_POLL_INTERVAL_SECONDS`（§4.6）**。**実設定は `impl/compose.yaml` の backend `environment:`（worker は YAML アンカーで同一）に列挙された変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `environment:` に配線すること。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf`・`.env` は追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff にハッシュ追記の2段**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**プッシュはユーザー依頼時のみ**。
  - **テストは red-green 必須**（`doc/規約/テスト規約.md` §5.1）。TC-ID＝`<ドメイン>-TC-<3桁>`（ドメイン記号は API設計の接頭辞 A〜L）。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`。`CLAUDE.md` が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**(1) ② メール非同期化**（新 ADR 起票→設計相談→red-green 実装）。対象関数（`_send_otp_email`/`_send_password_setup_email`/`_send_lock_notification`・`infra/mail.py`）と未決の機構選択（DBアウトボックス vs Redisキュー）を §7 に明記。
- ✅ 本セッションの成果（account_sync_outbox＝§4.6・password_set ミラー）と変更ファイル・実装判断・既知の差分（§4.6 の `seq` 未反映）を §3/§5/§6 に記録。
- ✅ 状態＝backend 67 passed・worker スモーク OK（本セッション実測）。tsc/e2e は未再実行（前回 tsc クリーン・e2e 4 passed）。起動中は db/redis のみ・Playwright 依存未導入。未実装/負債（②メール非同期・他 writer・logout-all frontend・failed 可視化）は §4 に明記。
- ✅ ハマりどころ（ソース焼き込み＝マウント/`cp`／env 上書き＝monkeypatch＋cache_clear／IP 差し替え＝TestClient client kwarg／mail フェイク必須／FK teardown 順序）を §5・§8 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/API設計/*.md`・`doc/ADR/*.md`・`doc/データモデル.md` §4.6・`doc/テスト/*.md`・`doc/規約/テスト規約.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
