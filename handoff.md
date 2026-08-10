# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。**
> **SC-00 ログインは全状態（A/B/C/D）が frontend＋backend とも縦に完了済み。本セッションで「アカウント一時ロック（ADR-0005）」を backend で縦に実装完了（red-green 経由・backend 60 passed）。次スライス＝outbox/worker または logout-all の frontend 導線（§7）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-10 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・`origin/main` と同期）。
- 最新の実装コミット: **`89c9265`**（本 handoff 更新はこの後の別コミット＝2段目・ハッシュは git 参照）。
- 本セッションのコミット（新しい順・**すべて `origin/main` へプッシュ済み**）:
  - `89c9265` 実装 アカウント一時ロック（ADR-0005・ログイン第二層防御）＝**本セッションの主成果**
  - `a45e791` docs(ADR-0001) 状態A の定義正本(SC-00 §3 画面状態)への参照リンクを追記
  - `198f7e6` docs(SC-00) otp_expired の文言・導線を追記＋再送クールダウンを30秒に統一
- 前セッションの最終は `f0ac9b4`（handoff 全文更新）。remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。**未プッシュのコミットは無い**。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(全文検索 PGroonga・会社DBのみ)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

本セッションは (a) SC-00 の otp_expired 整備 → (b) ADR-0004 値の全文書整合確認 → (c) ADR-0001 参照リンク → (d) **ADR-0005 アカウント一時ロックの実装**、の順。(a)〜(c) は軽微なドキュメント整備、(d) が主成果。

### (a) SC-00 otp_expired の文言・導線＋クールダウン統一＝`198f7e6`
- **`doc/画面設計/画面API連携/SC-00_ログイン.md`**＝§1c C1 に `otp_expired` の導線（`role="alert"` 表示＋コード欄クリア→「コードを再送信」へ誘導・状態Cに留まる）、§3 に `otp_expired` の文言行を追加。
- **`doc/画面設計/screens/SC-00_ログイン.md`**＝再送クールダウンの表記を **60秒→30秒** に統一（ADR-0004 §2.1 が確定値＝30秒。画面設計側だけ 60秒 が残っていた**ドリフト解消**）＋出典リンク明記。

### (b) ADR-0004 §2.1 値の全文書整合確認（コミット無し・確認のみ）
- OTP 6桁/TTL600/失敗上限5/resend30s/pre-auth600/信頼端末30日(2592000) が **設計・テスト・実装（config.py/.env.example/compose.yaml）で一致**していることを横断 grep で確認。上記 (a) の 60秒 以外の不整合は無し。

### (c) ADR-0001 状態A の参照リンク＝`a45e791`
- **`doc/ADR/ADR-0001_認証・セッション基本パラメータ.md`**＝「状態A＝パスワードログイン」の初出に、定義の正本 `screens/SC-00_ログイン.md §3 画面状態`（A/B/C/D）への相対リンクを追記（どの「状態A」かを一意化）。

### (d) ADR-0005 アカウント一時ロックの実装＝`89c9265`（主成果・red-green 経由）
既存の (IP+login_id) レート制限（10回/5分→429）と OTP 失敗上限（5）の上に載る**第二層**。正＝[`doc/ADR/ADR-0005_アカウント一時ロック.md`](doc/ADR/ADR-0005_アカウント一時ロック.md)。
- **`impl/backend/app/core/config.py`**＝`login_lock_max_attempts=5` / `login_lock_ttl_seconds=900` / `login_lock_notify_cooldown_seconds=3600`（env）。
- **`impl/backend/app/core/security.py`**＝`is_login_locked` / `register_login_failure`（閾値到達で lock を張り「新規発火」を bool 返し・streak リセット） / `clear_login_lock`（成功時） / `clear_login_locks_for_login_id`（PW 再設定・SCAN 削除） / `should_send_lock_notification`（NX+EX でクールダウン原子的判定）。キー＝`login_fail_streak:{ip}:{login_id}`（TTL 窓）・`login_lock:{ip}:{login_id}`（TTL 15分）・`lock_notified:{account_id}`（TTL 60分）。すべて Redis（自動失効）。
- **`impl/backend/app/control_plane/auth/application.py`**＝`login()` を再構成: レート制限の後に `is_login_locked`→真なら**ダミー照合（`verify_password(password, None)`）してから一律 401**（タイミング差を作らない・列挙耐性）。資格照合 INVALID で `register_login_failure`→**新規発火かつ実在 active** なら通知対象として持ち出し、**session を閉じてから** `should_send_lock_notification`→`_send_lock_notification` 送信して 401。PROCEED（成功）で `clear_login_lock`。`complete_password_setup` の成功時に `clear_login_locks_for_login_id`。
- **`impl/.env.example` / `impl/compose.yaml`**＝`LOGIN_LOCK_*` を `${VAR:-既定}` で配線（compose の backend `environment:` に列挙＝ドリフト再発防止）。`compose config` で `LOGIN_LOCK_*` 解決を確認済み。
- **`doc/API設計/A_認証・セッション.md`**＝総当り対策節の「後続 ADR へ委譲」を **ADR-0005 への確定参照** に更新。
- **テスト**＝`doc/テスト/A_認証.md` §5（A-TC-071〜079）追加、`impl/backend/tests/auth/test_auth_lock.py`（新規9件）。`doc/テスト/red確認台帳.md` にガード3件の反転証跡を追記。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend / frontend の機能**＝SC-00 状態A/B/C/D は縦に完了済み。**アカウント一時ロックは backend で実装完了**（frontend は既存の一律 401 応答のまま変わらない＝ADR-0005 §2.3 の設計どおり）。
- **テスト（本セッションで実測）**:
  - **backend pytest = 60 passed**（従来 51＋ロック 9・回帰なし。ホストソースを `/app` にマウントして実行・§8）。
  - **frontend tsc = クリーン**（`tsc --noEmit` exit 0）。
  - **e2e = 本セッションでは再実行していない**（ユーザー判断＝backend+tsc の一致で十分）。**前回時点は 4 passed**。frontend に触っていないので緑のはず（再確認は §8 の手順で）。
- **Docker（今回終了時点）**＝**db / redis のみ起動中（healthy）。backend / frontend は停止**（`docker compose run --rm` で都度使い捨てコンテナで pytest/tsc を実行したため）。**Playwright ブラウザ依存は未導入**（frontend コンテナが無い＝e2e 実行時は §8 の install が再度必要）。
- **要注意（負債・未実装）**:
  - **outbox 未実装**（ADR-0002 §2.4）＝`complete_password_setup`（`impl/backend/app/control_plane/auth/application.py`）にコード TODO。会社DB `users` の `password_set` ミラーは worker スライスまで反映されない（login は管理DB `accounts` 直参照なので認証は正しい）。
  - **`MAIL_ALERT_TO` は宛先の器のみ**＝運用アラートの実送信経路は未実装（ADR-0003 §4 TODO）。
  - **`logout-all` の frontend 導線は未実装**（backend EP は在る）。
  - **（ロック実装は完了。以下は既知の限界＝ADR-0005 §5 と本 handoff §6 に記載）**。
- **シード**（不変）＝**ACME-01（MFA OFF・`user@acme.example`）／ACME-02（MFA ON・`mfa@acme2.example`）**、PW いずれも `Passw0rd!`。テストは `impl/backend/tests/conftest.py` の `factory` が作成行を teardown。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **ハマりどころ（記録・再発防止）**:
  - **backend/e2e ともイメージにソースが焼かれている**（`COPY . .`・bind mount 無し）。**ホストの編集はそのままではコンテナに反映されない**。
    - backend＝`docker compose build backend` で焼き直すか、テスト時のみ **`-v "$PWD/backend:/app"` でマウント**して走らせる（本セッションもマウント方式・§8）。マウント時も editable install なので `app.*`/`tests.*` は解決する。
    - e2e＝spec も焼かれているため、編集した spec は **`docker compose cp`** でコンテナへ流し込む（§8）。
  - **e2e は frontend コンテナにブラウザ依存が無い**と全 spec が失敗。初回のみ `install-deps chromium` → `install chromium`（§8）。**今回 frontend コンテナは起動していない＝次回 e2e 時は再導入が必要**。
  - **ロックテストの IP 差し替え**＝`login` の IP は `request.client.host`。テストは **`TestClient(app, client=(ip, port))`** で IP を持たせて (IP+login_id) 単位を検証した（`tests/auth/test_auth_lock.py` の `_client(ip)`）。
  - **ロック通知メールは `mail` フェイク必須**＝ロック発火するテストは通知送信が走るため、`mail` フィクスチャ（`conftest.py`）を付けないと実 SMTP へ出て `socket.gaierror` になる。発火する 071/072/073/075/076/077 は `mail` を引数に取る。
  - **red-green（テスト規約 §5.1）の運用**＝test-first の自然 red（071/073/074/075/076/077）はコミットメッセージに記載。ガード（悪い挙動の不在を確認＝実装前も green）の 072/078/079 は**反転手技**で red 目視し `doc/テスト/red確認台帳.md` に証跡を追記した。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッションのロック実装で採った具体（ADR-0005 準拠・実装レベルの判断）
正は [`doc/ADR/ADR-0005_アカウント一時ロック.md`](doc/ADR/ADR-0005_アカウント一時ロック.md)。実装で埋めた点:
- **ロック中はダミー照合してから一律 401**＝資格照合に到達させない（§2.3）が、`verify_password(password, None)`（ダミー Argon2）を通してから 401 にし、誤資格失敗パスと時間差を作らない（列挙耐性・A.1）。
- **通知は session を閉じてから送信**＝SMTP 中に DB 接続を保持しない。宛先無し（非実在/非 active）・クールダウン中は無送信（列挙耐性を壊さない・§2.4）。
- **発火判定は `register_login_failure` が返す bool**＝`is_login_locked` が偽のときだけ計数するので count==max の一度だけ発火。ロック TTL は発火時に一度だけ設定＝追加試行で延長しない（§2.2）。

### 既知の限界（本セッションで気づいた・ADR-0005 §5 の残課題に関連）
- **リバースプロキシ配下の `client_ip`**＝現状 `request.client.host` を使用（既存レート制限も同じ）。本番の同一オリジンリバプロ下では**プロキシ IP** になり、(IP+login_id) が実質 account 単位に縮退し得る（DoS 回避の意図が効かない）。X-Forwarded-For の信頼扱いは ADR-0005 スコープ外で**未対応**。第一層レート制限と共通の課題＝別途要検討（§7 候補）。
- **通知メールの同期送信**＝(a) ADR §5 既知の弱いタイミングオラクル、(b) SMTP 失敗時に 401 が 500 になり得る（列挙耐性の綻び）。best-effort 化は**していない**（既存 `_send_otp_email` と挙動を揃えた）。outbox 非同期化（後続）で両方解消可能。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001/A.10）／状態A 具体値（ADR-0001・アイドル30分/絶対12時間・Argon2id・(IP+login_id)10回/5分の 429 レート制限）。
- 初回・再設定PW（ADR-0002）＝設定リンク CSPRNG 32B・SHA-256 保存・72h・単回／PWポリシー 8文字＋英字＋数字／`request` は列挙耐性で常に 202。
- MFA/信頼端末（ADR-0004）＝OTP 6桁/TTL600s/失敗上限5/resend30s・pre-auth600s は Redis 一体保持・信頼端末は DB（`trusted_devices`・30日）。
- **アカウント一時ロック（ADR-0005・本セッションで実装）**＝(IP+login_id) 単位・5回→15分・ロック中も一律 401・発火時に本人へ通知メール（1通/60分/account）・PW 再設定成功で即解除・OTP 失敗は非連動・保持先 Redis。
- 設定の置き場所（ADR-0003）＝env（デプロイ環境軸）／DB（テナント軸）。SMTP・各しきい値は env。
- 2プレーン×縦スライス4層（コーディング規約 §3.4 router→application→domain→repository）／フロント feature ベース（§4.1・`app/` はルーティングのみ）。
- **テスト運用**＝red-green 全レベル必須（テスト規約 §5.1）。証跡＝test-first はコミットメッセージ／後追い（反転手技）は `doc/テスト/red確認台帳.md`。

---

## 7. 次にやること — 優先順に、具体的に

ADR-0005 ロックは実装完了。次スライスの候補（いずれも前セッションから継続の負債）:

### (1) outbox / worker スライス＝最有力（複数の TODO を一気に解消できる）
- `account_sync_outbox`（データモデル §4.6）を実装し、`complete_password_setup`（`impl/backend/app/control_plane/auth/application.py` の TODO）で **同一Tx に outbox INSERT** →会社DB `users` の `password_set` ミラーを worker が反映。
- **ロック通知メールの非同期化**もこの基盤に載せられる（ADR-0005 §5 残課題＝同期送信のタイミングオラクル/500 化を解消）。
- `MAIL_ALERT_TO` の実送信経路（ADR-0003 §4 TODO）もここで一緒に整えられる。
- 手順＝データモデル §4.6・ADR-0002 §2.4 を正にテストパターン→red 経由テスト→実装（4層）。

### (2) `logout-all` の frontend 導線
- `impl/frontend/src/components/layout/AppHeader.tsx` のユーザーメニューに追加（backend EP `POST /api/v1/auth/logout-all` は実装済み）。e2e を薄く1本。

### (3) ロックのハードニング残（任意・小）
- **リバプロ配下の実クライアント IP**＝X-Forwarded-For を信頼境界付きで採用するか検討（§6 既知の限界）。レート制限とロック双方に効く。ADR 追記が要るなら ADR-0005 §5 か新 ADR。
- **管理者による強制解除・ロック可視化**（ADR-0005 §2.5・§5＝後続）＝管理面が整ってから。

### (4) 次ドメイン（API設計は確定済み）
- K（プロフィール `GET /me`）・H（通知）等。フロント本格化（`next/font`・`impl/frontend/src/components/ui/` 拡充・背景画像）。

### 仕上げパス（設計確定に伴い実施可）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化・現状は折衷で新規のみ準拠）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`（or `up --build`）。ポート＝db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001/0002/0003〕→seed 2社・冪等）してから起動。**今回終了時点で起動中は db / redis のみ**。
- **seed（開発用ログイン）**＝会社 `ACME-01`（`mfa_required=false`）/`user@acme.example`／会社 `ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（イメージ焼き直し版）**＝`cd impl && docker compose up -d db redis && docker compose build backend && docker compose run --rm backend pytest -q`（**60 passed**）。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest tests/ -q`（build 不要でホストの変更が即反映）。
- **frontend 型チェック/lint**＝`docker compose run --rm --no-deps -T frontend npx tsc --noEmit` ／ `docker compose exec -T frontend npm run lint`（lint は frontend 起動中のみ）。
- **codegen（型クライアント再生成）**＝backend 起動中に **ホストで** `cd impl/frontend && npx --yes openapi-typescript@7.5.0 http://localhost:8000/openapi.json -o src/lib/api/schema.d.ts`。
- **e2e**＝フル起動後、**初回のみ** `docker compose exec -u root frontend npx playwright install-deps chromium` → `docker compose exec frontend npx playwright install chromium`（**今回 frontend コンテナは無い＝再導入が必要**）→ `docker compose exec frontend npx playwright test`（**前回 4 passed**）。**コンテナ内実行時 MailHog は `http://mailhog:8025`**。編集した spec の反映は `docker compose cp`。
- **MailHog でメール確認**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は password_setup=base64／MFA OTP=quoted-printable と一定でない＝抽出は base64 デコード試行→ダメなら生テキスト）。
- **主要 env（`impl/.env.example` が雛形・`.env` は追跡外で任意。無ければ Compose が `${VAR:-既定}` で既定にフォールバック＝現在 `.env` は不在）**＝`COOKIE_SECURE`（本番 true）／`SMTP_*`・`MAIL_FROM`・`MAIL_ALERT_TO`（ADR-0003）／`OTP_*`・`OTP_LENGTH`・`PREAUTH_TTL_SECONDS`・`TRUSTED_DEVICE_TTL_SECONDS`（ADR-0004）／**`LOGIN_LOCK_MAX_ATTEMPTS`・`LOGIN_LOCK_TTL_SECONDS`・`LOGIN_LOCK_NOTIFY_COOLDOWN_SECONDS`（ADR-0005）**。**実設定は `impl/compose.yaml` の backend `environment:` に列挙された変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `environment:` に配線すること。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf` は追跡外（Markdown が正）・`.env` も追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff にハッシュ追記の2段**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**プッシュはユーザー依頼時のみ**。
  - **テストは red-green 必須**（`doc/規約/テスト規約.md` §5.1）＝test-first の red はコミットメッセージに1行／後追い（反転手技）は `doc/テスト/red確認台帳.md` に追記。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY は §2.3。`CLAUDE.md` が各規約への入口（ドキュメント作成/コーディング/リポジトリ構成/テスト）。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**(1) outbox/worker スライス**（`complete_password_setup` の TODO＋ロック通知の非同期化＋`MAIL_ALERT_TO` 送信をまとめて解消）。次点＝logout-all frontend 導線。手順・対象ファイルを §7 に明記。
- ✅ 本セッションの成果（SC-00 otp_expired＋クールダウン統一／ADR-0004 値整合確認／ADR-0001 参照リンク／**ADR-0005 ロック実装**）と実装判断・既知の限界を §3/§6 に記録。ロックの全決定値は §6・正は `doc/ADR/ADR-0005_*.md`。
- ✅ 状態＝backend 60 passed・tsc クリーン（本セッション実測）。e2e は未再実行（前回 4 passed）。起動中は db/redis のみ・Playwright 依存は未導入。未実装/負債（outbox・MAIL_ALERT_TO 送信・logout-all frontend 導線）は §4 に明記。
- ✅ ハマりどころ（ソース焼き込み＝マウント/`docker compose cp`／playwright install／ロックテストの IP 差し替え＝TestClient client kwarg／通知は mail フェイク必須／red-green 運用）を §5・§8 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/API設計/*.md`・`doc/ADR/*.md`・`doc/テスト/A_認証.md`・`doc/規約/テスト規約.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
