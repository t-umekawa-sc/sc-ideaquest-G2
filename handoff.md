# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/` を参照。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。**
> **SC-00 ログインは全状態（A/B/C/D）が frontend＋backend とも縦に完了済み（前セッション）。本セッションはテスト運用の整備（red-green 必須化・既存55件の red 監査）と、次スライス「アカウント一時ロック」の設計確定（ADR-0005）まで。実装は未着手＝次回の起点。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-09 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン・`origin/main` と同期＝`git status` で確認済み）。
- 最新コミット: **`49471e7`**。本セッションのコミット（新しい順・**すべて `origin/main` へプッシュ済み**）:
  - `49471e7` docs(ADR) ADR-0005 アカウント一時ロック確定＋委譲元(ADR-0001/0004)の参照更新
  - `4fb4ad5` docs(テスト規約) 証跡の置き場所を経路で使い分け（§5.1）
  - `43b98f1` docs(テスト) red確認台帳を追加（既存55件の retro red-green 証跡）
  - `dd9ffe4` docs(テスト規約) red-green を必須化＋テスト規約を `doc/規約/` へ移動
  - `576ecee` 実装 設定配線: OTP_LENGTH を compose backend env に追加（ADR-0004 ドリフト解消）
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。**未プッシュのコミットは無い**。
- 本セッションは**実装コード（app 配下）を新たに書いていない**（`576ecee` は compose 1行のみ）。ADR とテスト運用ドキュメントが中心。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す **WEB アプリ**（マルチテナント SaaS・管理DB1＋会社DB N）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(全文検索 PGroonga・会社DBのみ)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

本セッションは (a) 設定ドリフト修正 → (b) テスト運用の整備 → (c) 既存テストの red 監査 → (d) 次スライスの ADR 確定、の順。

### (a) OTP_LENGTH の配線漏れ修正＝`576ecee`
- **`impl/compose.yaml`**＝backend `environment:` に `OTP_LENGTH: ${OTP_LENGTH:-6}` を1行追加。理由＝`.env.example` に `OTP_LENGTH` があるのに compose の `environment:` に無く（`env_file:` 指定も無い）、`.env` の値がコンテナに届かず `config.py:43` の既定にフォールバックしていた（潜在ドリフト）。`docker compose config` で `OTP_LENGTH: "6"` に解決されることを確認済み。
- **`.env` の一般則**（調査で確認した事実）＝compose は `.env` を**変数展開のためだけ**に自動ロード（`env_file:` 無し＝`.env` はコンテナに丸ごと注入されない）。ゆえに「`.env` に未記載→compose 既定」が成り立つのは、その変数が `environment:` に `${VAR:-default}` 形式で列挙されている場合のみ。

### (b) テスト規約に red-green を必須化＋規約を集約＝`dd9ffe4` / `4fb4ad5`
- **`doc/テスト/テスト規約.md` → `doc/規約/テスト規約.md`（`git mv` で移動）**＝規約は `doc/規約/` に集約。
- **`doc/規約/テスト規約.md` §5・§5.1（追記）**＝「red を必ず経由する」フローを明示（4.red目視→5.green）。§5.1 に原則を新設（**全レベル必須＝unit/int/api/e2e**）: なぜ必要か（緑のまま何も検証していない失敗モード）／red は**対象の振る舞いに起因する失敗**であること（`ImportError`・未定義404・接続エラーで満足しない）／実装が既にある後追いテストは**アサーション一時反転**で red 確認→戻す。理由＝ユーザー要望「最初から緑のテストは信用できない、一度 red を見たい」。
- **§5.1 の証跡ルール（`4fb4ad5` で経路分岐）**＝**test-first はコミットメッセージに1行／後追い（反転手技）は `doc/テスト/red確認台帳.md` に TC-ID 行を追記**（反転は `git checkout` で戻すため差分に残らないのが理由）。
- **`CLAUDE.md`**＝各種規約一覧に「テスト規約.md（テスト作成・編集時に必読）」を1行追加。**`README.md`・`doc/テスト/A_認証.md`**＝テスト規約の参照リンクを新パス（`doc/規約/`・`../規約/`）へ更新。

### (c) 既存テスト55件の retro red 監査＝`43b98f1`
- **`doc/テスト/red確認台帳.md`（新規）**＝§5.1 に基づき、実装が先に在る既存テスト（backend 51＋e2e 4）の主アサーションを一時反転して red を目視した証跡。TC-ID ごとに「反転した主アサーション／観測 red（actual）」を全55行記録。**全55件が自身のアサーションで red 化→復元後 backend 51 passed / e2e 4 passed に復帰。空振り0件。**
- 反転の実体はコミットに含めない（`git checkout` で復元済み・手順は台帳に記載）。以降の後追い確認は本台帳の末尾に追記していく運用。

### (d) ADR-0005 アカウント一時ロック確定＝`49471e7`
- **`doc/ADR/ADR-0005_アカウント一時ロック.md`（新規）**＝ADR-0001 §2.6・ADR-0004 §2.5 が後続へ委譲していたロックを確定（値は §6・env は §2.1）。ユーザー承認 2026-08-09。
- **`doc/ADR/ADR-0001_認証・セッション基本パラメータ.md` §2.6 / `doc/ADR/ADR-0004_MFA・信頼端末基本パラメータ.md` §2.5**＝「後続 ADR」参照を ADR-0005 への相対リンクに更新。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend / frontend の機能**＝前セッションから変化なし（本セッションは app コードを変更していない）。SC-00 状態A/B/C/D は backend＋frontend とも縦に完了済み。
- **テスト（本セッションで実測）**:
  - **backend pytest = 51 passed**（ホストソースを `/app` にマウントして実行・後述 §8）。
  - **frontend tsc = クリーン**（`tsc --noEmit` exit 0）。
  - **e2e = 4 passed**（`sc-00-login` 2＋`sc-00-mfa` 1＋`sc-00-password-setup` 1）。
  - いずれも red 監査の前後で緑を確認済み＝テストコードは無変更（drift なし）。
- **フルスタックは起動したまま**（`db/redis/mailhog/backend/frontend` すべて running）。**frontend コンテナに Playwright のブラウザ依存はインストール済み**＝次回このコンテナが生きていれば e2e は `install-deps` 不要（コンテナを作り直すと消える）。
- **要注意（負債・未実装）**＝前セッションから継続:
  - **アカウント一時ロック＝設計確定(ADR-0005)のみ・実装は未着手**（次回の起点＝§7）。
  - **outbox 未実装**（ADR-0002 §2.4）＝`complete_password_setup`（`impl/backend/app/control_plane/auth/application.py`）にコード TODO。会社DB `users` の `password_set` ミラーは worker スライスまで反映されない（login は管理DB `accounts` 直参照なので認証は正しい）。
  - **`MAIL_ALERT_TO` は宛先の器のみ**＝運用アラートの実送信経路は未実装（ADR-0003 §4 TODO）。
  - **`logout-all` の frontend 導線は未実装**（backend EP は在る）。
- **シード**（不変）＝**ACME-01（MFA OFF・`user@acme.example`）／ACME-02（MFA ON・`mfa@acme2.example`）**、PW いずれも `Passw0rd!`。テストは `impl/backend/tests/conftest.py` の `factory` が作成行を teardown。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **ハマりどころ（記録・再発防止）**:
  - **backend/e2e ともイメージにソースが焼かれている**（`COPY . .`・bind mount 無し）。**ホストの編集はそのままではコンテナに反映されない**。
    - backend＝`docker compose build backend` で焼き直すか、テスト時のみ **`-v "$PWD/backend:/app"` でマウント**して走らせる（本セッションの red 監査はマウント方式を採用＝§8）。マウント時も editable install(`pip install -e .`)なので `app.*`/`tests.*` は解決する。
    - e2e＝spec も焼かれているため、編集した spec は **`docker compose cp ./frontend/e2e/<spec> frontend:/app/e2e/<spec>`** でコンテナへ流し込んで実行し、復元も cp で戻す（本セッションの e2e red 監査で使用）。
  - **e2e は frontend コンテナにブラウザ依存が無い**と全 spec が失敗する。初回のみ `docker compose exec -u root frontend npx playwright install-deps chromium` → `docker compose exec frontend npx playwright install chromium`（Debian・apt）。**本セッションでインストール済み**＝コンテナが生きていれば再実行不要。
  - **MailHog のメール本文の encode は一定でない**（password_setup のリンクは base64／MFA の OTP は quoted-printable だった）。抽出は e2e の `fetchOtp`（`sc-00-mfa.spec.ts`）・`fetchResetToken`（`sc-00-password-setup.spec.ts`）が参考（base64 デコード試行→ダメなら生テキスト）。
  - **red 監査で共有ヘルパは反転しない**＝各テストが自身のアサーションで red になるようにする（`_login_mfa`・`_token_from_mail`・login spec の `login()` は温存）。login spec は `login()` 共有のため A-TC-020/021 を2状態に分けて実施した。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッションの決定（ADR-0005 アカウント一時ロック・2026-08-09 ユーザー承認）
正は [`doc/ADR/ADR-0005_アカウント一時ロック.md`](doc/ADR/ADR-0005_アカウント一時ロック.md)。要約:
- **(IP+login_id) 単位でロック**（account 全体はロックしない）＝他人が login_id を故意失敗させて本人を締め出す**可用性 DoS を回避**。不採用＝account 単位ハードロック（DoS に弱い）／account 単位＋指数バックオフ（サーバリソース拘束・実装複雑）。トレードオフ＝分散IP総当りには原理的に弱い（第一層レート制限等で補う）。
- **窓内 5回連続失敗 → 15分ロック**（env `login_lock_max_attempts`=5 / `login_lock_ttl_seconds`=900）。計数は**認証失敗で+1・成功でリセット**。**ロック TTL は追加試行で延長しない**（無限延長を防ぐ・発火から固定15分で解ける）。
- **ロック中も応答は一律 401 `unauthenticated`**（残時間も返さない）＝列挙耐性（A.1 と一貫）。不採用＝423/429＋残時間（存在＋ロック状態を漏らす）。
- **ロック通知メール**＝ロック発火時に**本人へ out-of-band**（実在・active のみ・宛先無しは黙って何もしない＝列挙耐性維持）。**1通/60分/account スロットル**（`login_lock_notify_cooldown_seconds`=3600・キー `lock_notified:{account_id}`）＝IP を回されての**メール爆撃を防ぐ**。本文は汎用（IP・MFA有無等は載せない）。不採用＝通知なし一律401のみ（本人が気づけない）。
- **解除経路**＝(a) 15分自動（Redis TTL）＋(b) **PW再設定成功で即解除**（`login_id` の lock/streak を SCAN 削除）。**管理者手動解除は後続**（管理面未整備）。
- **OTP(mfa/verify)失敗は本ロックに非連動**＝OTP は既に `otp_max_attempts`(5)＋pre-auth 失効で拘束済み（ADR-0004 §2.4）。
- **保持先は Redis**（TTL 自動失効）。不採用＝`accounts.locked_until` 列（account 単位でないため (IP+login_id) を表現できない）。
- **残課題（ADR-0005 §5）**＝閾値ちょうど(5回目)の同期メール送信による**弱いタイミングオラクル**（将来 outbox で非同期化して解消・MVP許容）／分散IP総当りの限界／管理者解除・可視化は後続。

### テスト運用の決定
- **red-green を全レベル必須化**（テスト規約 §5.1）。証跡＝test-first はコミットメッセージ1行／後追いは `doc/テスト/red確認台帳.md` 追記。
- **テスト規約は `doc/規約/` に置く**（規約の集約・`CLAUDE.md` から参照）。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001/A.10）／状態A 具体値（ADR-0001・アイドル30分/絶対12時間・Argon2id・(IP+login_id)10回/5分の 429 レート制限）。
- 初回・再設定PW（ADR-0002）＝設定リンク CSPRNG 32B・SHA-256 保存・72h・単回／PWポリシー 8文字＋英字＋数字／`request` は列挙耐性で常に 202。
- MFA/信頼端末（ADR-0004）＝OTP 6桁/TTL600s/失敗上限5/resend30s・pre-auth600s は Redis 一体保持・信頼端末は DB（`trusted_devices`・30日）。
- 設定の置き場所（ADR-0003）＝env（デプロイ環境軸）／DB（テナント軸）。SMTP・各しきい値は env。
- 2プレーン×縦スライス4層（コーディング規約 §3.4 router→application→domain→repository）／フロント feature ベース（§4.1・`app/` はルーティングのみ）。

---

## 7. 次にやること — 優先順に、具体的に

### (1) ADR-0005 アカウント一時ロックの実装＝最有力（設計は確定済み・ユーザー確認は不要）
手順＝テストパターン→テストコード（**red を必ず経由**・test-first なので自然に red が出る）→実装。ADR-0005 §4 の実装対象を具体化:

1. **テストパターン**＝`doc/テスト/A_認証.md` に TC 行を追加（`根拠`＝ADR-0005 の該当節）。次の空き番号は **A-TC-071 以降**（060〜070＝MFA で使用済み・051 まで password_setup）。観点＝
   - 窓内 5回連続失敗→6回目以降は**別 IP でも同一 login_id は**…ではなく「**同一 (IP+login_id) が 15分 401**」／**別 IP は影響を受けない**（(IP+login_id) 単位の証明）。
   - **ロック中も一律 401**（残時間を返さない）。**成功でカウンタ解除**。**ロック TTL は追加試行で延びない**。
   - **PW 再設定成功でロック解除**。**ロック通知メール 1通**・**クールダウン中は追加送信なし**・**実在しない login_id では送信なし**（列挙耐性）。**OTP 失敗は非連動**。
2. **テストコード**＝`impl/backend/tests/auth/` に新規 `test_auth_lock.py`（推奨・login と分離）。TC-ID を関数名/docstring に埋める。IP はテスト側で差し替え（`client` のヘッダ/`X-Forwarded-For` 相当。※`login` は `client_ip` をどう受けるか要確認＝`application.py:81 login(...)` の引数と `router.py` の IP 取得を見る）。メール捕捉は `mail` フェイク（`conftest.py`）。**red を目視してから実装**（test-first）。
3. **実装**（4層・DRY）:
   - `impl/backend/app/core/config.py`＝`login_lock_max_attempts=5` / `login_lock_ttl_seconds=900` / `login_lock_notify_cooldown_seconds=3600` を `Settings` に追加。
   - `impl/backend/app/core/security.py`＝`check_login_rate_limit`（`security.py:172`）の隣に追加: `is_login_locked(r, ip, login_id)` / `register_login_failure(r, ip, login_id)`（閾値到達で `login_lock:{ip}:{login_id}` を張り「通知すべきか」を bool 返し・streak リセット） / `clear_login_lock(r, ip, login_id)`（成功時） / `clear_login_locks_for_login_id(r, login_id)`（PW再設定・`login_lock:*:{login_id}` と `login_fail_streak:*:{login_id}` を SCAN 削除）。キー＝`login_fail_streak:{ip}:{login_id}`（TTL 窓）・`login_lock:{ip}:{login_id}`（TTL 15分）・`lock_notified:{account_id}`（TTL 60分）。
   - `impl/backend/app/control_plane/auth/application.py`＝`login`（`:81`）で `check_login_rate_limit` の後・資格照合の前に `is_login_locked`→真なら `AppError(401,"unauthenticated")`。失敗パス（現状 `raise AppError(401,"unauthenticated")` の直前）で `register_login_failure`→通知すべき かつ 実在 active なら通知メール送信。成功パス（`_issue_session` 前後）で `clear_login_lock`。`complete_password_setup` の成功時に `clear_login_locks_for_login_id`。通知本文は `_send_otp_email`（`:137`）と同体裁の `_send_lock_notification(to_email)` を新設（`get_mail_sender().send(to, subject, body)`）。
   - `impl/.env.example` / `impl/compose.yaml`＝上記3 env を `${VAR:-既定}` で配線（compose の backend `environment:` に**必ず列挙**＝§3(a) のドリフト再発防止）。
   - 実装後、`doc/API設計/A_認証・セッション.md` の総当り対策の節から ADR-0005 を参照（ADR-0005 §4 で予告済み）。

### (2) 以降のスライス（前セッションから継続）
- **outbox/worker**＝`account_sync_outbox`（データモデル §4.6）＝`complete_password_setup` の TODO 解消。ロック通知メールの**非同期化**もここに載せられる（ADR-0005 §5 残課題）。
- **`logout-all` の frontend 導線**＝`impl/frontend/src/components/layout/AppHeader.tsx` のユーザーメニューに追加。
- **フロント本格化**＝`next/font`・`impl/frontend/src/components/ui/` 拡充・背景画像。
- **次ドメイン**＝K（プロフィール `GET /me`）・H（通知）等（API設計は確定済み）。

### 仕上げパス（設計確定に伴い実施可）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化・現状は折衷で新規のみ準拠）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`（or `up --build`）。ポート＝db `:5432`／redis `:6379`／**mailhog SMTP `:1025`・UI `:8025`**／backend `:8000`／frontend `:3000`。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001/0002/0003〕→seed 2社・冪等）してから起動。**今回終了時点でフルスタックは起動したまま**。
- **seed（開発用ログイン）**＝会社 `ACME-01`（`mfa_required=false`）/`user@acme.example`／会社 `ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（イメージ焼き直し版）**＝`cd impl && docker compose up -d db redis && docker compose build backend && docker compose run --rm backend pytest -q`（**51 passed**）。
- **backend テスト（ホスト編集を反映＝マウント版・red 監査や編集中はこちら）**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest tests/ -v`（build 不要でホストの変更が即反映）。
- **frontend 型チェック/lint**＝`docker compose run --rm --no-deps -T frontend npx tsc --noEmit` ／ `docker compose exec -T frontend npm run lint`。
- **codegen（型クライアント再生成）**＝backend 起動中に **ホストで** `cd impl/frontend && npx --yes openapi-typescript@7.5.0 http://localhost:8000/openapi.json -o src/lib/api/schema.d.ts`（生成物はホストに直接書かれる＝そのままコミット可）。
- **e2e**＝フル起動後、**初回のみ** `docker compose exec -u root frontend npx playwright install-deps chromium` → `docker compose exec frontend npx playwright install chromium`（**本セッションでインストール済み・コンテナが生きていれば不要**）→ `docker compose exec frontend npx playwright test`（**4 passed**）。**コンテナ内実行時 MailHog は `http://mailhog:8025`**（spec 既定・ホスト実行時は `MAILHOG_URL` で上書き）。編集した spec を反映するには `docker compose cp`（§5）。
- **MailHog でメール確認**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は §5）。
- **主要 env（`impl/.env.example` が雛形・`.env` は追跡外で Compose が自動ロード＝変数展開用）**＝`COOKIE_SECURE`（本番 true）／`SMTP_*`・`MAIL_FROM`・`MAIL_ALERT_TO`（ADR-0003）／`OTP_*`・`OTP_LENGTH`・`PREAUTH_TTL_SECONDS`・`TRUSTED_DEVICE_TTL_SECONDS`（ADR-0004）。**実設定は `impl/compose.yaml` の backend `environment:` に列挙されている変数のみコンテナへ届く**（`env_file:` 無し＝§3(a)）。ADR-0005 実装で追加する `LOGIN_LOCK_*` も必ず `environment:` に配線すること。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf` は追跡外（Markdown が正）・`.env` も追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff にハッシュ追記の2段**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**プッシュはユーザー依頼時のみ**。
  - **テストは red-green 必須**（`doc/規約/テスト規約.md` §5.1）＝test-first の red はコミットメッセージに1行／後追い（反転手技）は `doc/テスト/red確認台帳.md` に追記。
  - ドキュメント方針＝設計の正は1箇所・他は参照（drift 回避）／設計判断はなぜも併記／文書間参照は `doc/規約/ドキュメント作成規約.md`／意図的選択は `doc/規約/コーディング規約.md §3.5`・DRY は §2.3。`CLAUDE.md` が各規約への入口（ドキュメント作成/コーディング/リポジトリ構成/**テスト**）。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝**(1) ADR-0005 アカウント一時ロックの実装**（設計は確定済み＝ユーザー確認不要）。手順・対象ファイル・関数名・キー・env 名を §7(1) に明記。
- ✅ 本セッションの成果（OTP_LENGTH 修正／red-green 必須化＋規約移動／red確認台帳／ADR-0005）と採否理由を §3/§6 に記録。ADR-0005 の全決定値は §6・正は `doc/ADR/ADR-0005_*.md`。
- ✅ 状態＝pytest 51 緑・tsc クリーン・e2e 4 緑（いずれも本セッションで実測）。フルスタック起動中・Playwright 依存導入済み。未実装/負債（ロック実装・outbox・MAIL_ALERT_TO 送信・logout-all frontend 導線）は §4 に明記。
- ✅ ハマりどころ（**ソース焼き込み＝マウント/`docker compose cp` で回避**・playwright install-deps・メール encode・red 監査で共有ヘルパ温存）を §5・§8 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/API設計/*.md`・`doc/ADR/*.md`・`doc/テスト/A_認証.md`・`doc/規約/テスト規約.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
