# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。red-green 必須（`doc/規約/テスト規約.md` §5.1）。**
> **本セッションで完了＝K.3 メール変更をダブルオプトイン（新メールへ確認リンク・確定まで pending・旧メールへ変更通知）に改修＝ADR-0008 新設。`POST /me/email` を 202 化・`POST /me/email/confirm`（未認証）を新設。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-12 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン）。
- 最新コミット: 本 handoff コミット（`origin/main` へ **プッシュ済み**）。直前＝**`e6d1f17`**（実装 K.3 メール変更ダブルオプトイン）。
- 本セッションのコミット（古い順）:
  - `e6d1f17` 実装 K.3 メール変更ダブルオプトイン（確認リンク・ADR-0008）＝`POST /me/email` 202・`POST /me/email/confirm` 未認証・migration 0010（accounts.pending_email）・mail category 2種・frontend 確認ページ。
  - （本コミット）handoff 全文更新。
- 前セッションまでの最新＝`3c78926`（handoff）／`6a71ed9`（K.3 メール・PW 変更＝即時反映版・本セッションで double opt-in に改修）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **プッシュはユーザー依頼時のみ**。コミットは **実装本体→handoff にハッシュ追記の2段**が基本。コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

### K.3 メール変更のダブルオプトイン（`e6d1f17`）＝本セッションの主成果
目的＝これまで「再認証→会社内一意→`accounts.email` 即更新＋outbox」で**入力文字列を即反映**していたメール変更（到達確認なし＝タイプミス/他人アドレス誤登録で本人が締め出され得る）を、**新メールへの確認リンク**で到達確認してから確定する方式に改める。正＝`doc/ADR/ADR-0008_メール変更のダブルオプトイン.md`（新設）・`doc/API設計/K_プロフィール・背景画像.md`（K.3）・`doc/データモデル.md` §4.2/§4.4・`doc/テスト/K_プロフィール.md`。

**確定仕様（ADR-0008・2026-08-12 ユーザー承認）**:
- **方式＝ダブルオプトイン**（新メールへ確認リンク・確定まで `accounts.pending_email` で pending）。
- **旧メールへ変更通知**（`email_change_notice`・乗っ取り検知・新メールアドレスは載せない＝最小開示）。
- **確定時のセッション破棄はしない**（§A.9-③ 対象外＝要求時の現在PW再認証で担保）。
- **確認 EP は未認証**（トークンが認可＝新メール受信＝到達確認・`password-setup/complete` と同型・CSRF 免除・Origin のみ検証）。
- **確認リンク TTL＝24h**（`email_change_ttl_seconds`）。**会社DB ミラー（account_sync）enqueue は確定時**（pending 段階で未確認 email を users に漏らさない）。

**backend（`impl/backend/app/control_plane/me/` 中心）**:
- `me/application.py`＝`request_email_change`（現在PW再認証→no-op抑止422→会社内一意→`pending_email` 格納＋`otp_challenges` purpose=`email_change` 発行〔旧チャレンジ失効〕＋新メールへ `email_change_confirm`・旧メールへ `email_change_notice` を同一Tx enqueue／`account_sync` は積まない）／`confirm_email_change`（トークン照合＝無効/期限切れ/使用済み一律 410／**会社内一意を再検証**〔TOCTOU・衝突 409＋pending クリア〕／`email=pending_email`・pending クリア・単回消費・**確定時に account_sync upsert{email} enqueue**・監査 `email.change.confirm`）。`_challenge_is_valid`（used_at None＋未期限切れ）。
- `me/router.py`＝`POST /me/email`（**202** `EmailChangeAcceptedResponse`・Origin/CSRF 必須）／`POST /me/email/confirm`（**未認証**・`verify_origin` のみ・200 `EmailChangeConfirmedResponse`）。
- `me/schemas.py`＝`EmailChangeAcceptedResponse{status:"accepted"}`／`EmailChangeConfirmRequest{token}`（extra=forbid）／`EmailChangeConfirmedResponse{status:"confirmed"}`。
- `auth/orm.py`＝`Account.pending_email`（nullable）追加・`OtpChallenge.purpose` コメントに email_change。
- `auth/repository.py`＝`invalidate_email_change_challenges`／`create_email_change_challenge`／`find_email_change_challenge_by_hash`（`password_setup` と同型・purpose=`email_change`）。
- `mail_outbox/templates.py`＝`CATEGORY_EMAIL_CHANGE_CONFIRM`（リンク `{app_base_url}/email-change/confirm?token=`・TTL 時間を本文表示）／`CATEGORY_EMAIL_CHANGE_NOTICE`（旧メール・静的本文）。
- `core/config.py`＝`email_change_ttl_seconds`（既定 86400）。`compose.yaml` の `&backend_env`・`.env.example` に `EMAIL_CHANGE_TTL_SECONDS` 配線。
- migration＝`0010_accounts_pending_email.py`（`accounts.pending_email` text NULL・**一意制約なし**＝確定時に再検証）。**control head＝0010**。

**frontend（`impl/frontend/src/features/profile/` ＋ `app/(auth)/`）**:
- `components/SecuritySection.tsx`＝メール変更フォームの API を `requestEmailChange` に変更・送信後メッセージを「**確認メールを … に送信しました**（リンクを開くと確定）」に・ボタン文言「確認メールを送信」・説明文追記。
- `components/EmailChangeConfirm.tsx`（新規）＝確認ページ本体。**明示ボタン押下で確定**（メールスキャナ先読みでの自動確定を避ける）・410 は「無効/期限切れ」表示・成功で「変更を確定しました」→ /profile。`features/profile/index.ts` に export。
- `app/(auth)/email-change/confirm/page.tsx`（新規）＝token を取り出し `EmailChangeConfirm` へ渡すだけ（`password-setup` と同型・未認証で動く）。
- `features/profile/api.ts`＝`changeEmail`→`requestEmailChange`（202・null）＋`confirmEmailChange(token)`。`types.ts`＝`EmailChangeConfirmInput` 追加。`src/lib/api/schema.d.ts` は `npm run codegen` で再生成。

**テスト**:
- backend `tests/me/test_me.py`＝K-TC-008 改定（`test_k_tc_008_change_email_request`＝再認証403／重複409／成功 **202**＋`email` 不変・`pending_email` セット・`email_change` チャレンジ1件・mail 2通〔confirm 新宛＋notice 旧宛〕・account_sync に email 行なし）・**K-TC-010 追加**（`confirm` 正常＝email 確定・pending クリア・単回消費・mirror enqueue／無効・使用済みトークン 410／`_confirm_expired`＝期限切れ 410／`_confirm_conflict`＝確定時衝突 409＋pending クリア）。
- e2e `frontend/e2e/k-profile.spec.ts`＝K-TC-009(email) 追加（メール変更 error-path〔現在PW不一致 403〕＋要求成功 202 の文言。**確定 happy は共有 OPS 資格情報を壊さぬよう踏まない**＝pending を立てるだけで email/PW は不変）。
- `doc/テスト/K_プロフィール.md`＝K-TC-008 改定・K-TC-010・K-TC-009(email) 追記。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **動いているもの（backend で縦通し済み）**:
  - **ドメイン A ログイン**：状態A（PWログイン）・B（初回/再設定PW）・C（MFA）・D（再設定要求）。SC-00 は frontend も完了。アカウント一時ロック（ADR-0005）＋クライアントIP確定（ADR-0006）。
  - **account_sync_outbox**（管理DB→会社DB `users` ミラー・§4.6・`app/worker.py`）＝writer は `password_set`／`last_login_at`／発行・編集・無効化・再有効化（B）／プロフィール編集（K `PATCH /me`）／**メール変更の確定（K.3 `POST /me/email/confirm`＝本セッション・upsert{email}）**。**worker は payload の `memberships` を `users` の後に会社DB `quest_group_members` へ適用（B.5 step3・FK 順）＝加算専用（upsert のみ・削除しない）**。所属の「修正」（差分・削除）は会社DB を直接更新する編集経路（`admin/application._apply_membership_diff`・B.3）／QG管理者 API（B.4）が担う。
  - **mail_outbox**（認証系メール非同期・ADR-0007・`app/mail_worker.py`）＝OTP・設定リンク・ロック通知＋**メール変更の確認リンク（`email_change_confirm`・新宛）／変更通知（`email_change_notice`・旧宛）＝本セッション**。フルスタックで MailHog 送達（`done`・secret 送信後NULL）を実測。
  - **ドメイン B アカウント管理 API（`/admin/*`）**＝会社CRUD／会社スコープのアカウント発行/編集/disable/enable/password-reset（system_admin）／`/admin/accounts`（company_account_admin・セッション会社固定・SoD）／QG管理者 API（B.4）／quest_groups CRUD。bootstrap で OPS 運営テナント＋初期 system_admin を seed。
  - **ドメイン K**＝`GET /me`（identity）・`PATCH /me`（display_name/locale）・`POST /me/password`（204＋全セッション破棄＋信頼端末失効）・**`POST /me/email`（本セッションで 202＝要求・pending 化）／`POST /me/email/confirm`（本セッション・未認証・確定＝email 反映＋ミラー）**。
  - **監査ログ**＝`system_audit_logs`（control 0009）に特権操作を記録（`AuditContextMiddleware` が実行者/IP/UA 供給・B.6）。本セッションで `email.change.confirm` を追加（確定は未認証のため actor は NULL 可）。
  - **session `is_qg_admin`**＝ログイン時に会社DBの admin 所属を集計し session にスナップショット（SC-90 ナビ出し分け）。
- **frontend（フルスタックで実測）**＝features に companies／accounts（AccountSection＝system_admin クロステナント／AccountSelfSection＝会社アカ管理者 自社）／questgroups／qgadmin／**profile（ProfileForm＋SecuritySection＋EmailChangeConfirm）**。route＝`(app)/admin/companies[/[id]]`・`/admin/accounts`・`/admin/quest-groups`・`/profile`・**`(auth)/email-change/confirm`（新規・未認証）**。ヘッダーナビは system_role と is_qg_admin でゲート。**口座一覧 UI は暫定 per_page=100（ページング/検索 UI 未実装）**。
- **テスト（本セッションで実測）**:
  - **backend pytest = 164 passed**（マウント版で実測。migration head＝**control 0010**・**company 0006**）。※`B-TC-005` HOL・`A-TC-077` ロック通知・`A-TC-096` mail reclaim は稀に timing フレーク＝再実行で green（本セッションの 164 passed は 1 回で green）。
  - **full e2e = 22 passed**（`docker compose exec -T frontend npx playwright test --workers=1`・`LOGIN_RATE_LIMIT_MAX=50` で自己スロットル無し）。内訳＝sc-00 系5＋sc-91 系3＋sc-92 系5＋sc-93 系3＋sc-90 系3＋k-profile 3（K-TC-006／K-TC-009〔PW〕／K-TC-009(email)）。
  - **フルスタック メール実測**＝メール変更要求で `email_change_confirm`（新宛）＋`email_change_notice`（旧宛）が `mail_outbox` で `done`・0 failed・secret 送信後NULL。
- **Docker（本 handoff 時点）**＝**フルスタック起動中**（db/redis/mailhog/backend/frontend/worker/mail-worker）。**実イメージは K.3 double opt-in の最新をビルド済み**。
- **壊れているもの＝無し**。
- **未実装 / 負債**:
  - **ドメイン K 残り**＝`GET /me` の残高・画像（署名URL）同梱＝K.1 全体（MinIO・別スライス）。K.4 画像（背景/アバター・MinIO）。PW 変更完了メール通知（H・任意）。
  - **メール変更 pending・期限切れ email_change トークンの物理掃除**（現状は論理無効化のみ＝最新要求で上書き／確定で消費。バッチ削除は password_setup と共通の後続運用課題）。
  - **口座一覧のページング・検索 UI**（現状 per_page=100 の暫定＝SC-92 `AccountSection`／SC-93 `AccountSelfSection`）。
  - **監査ログの閲覧 UI/API**・保持/エクスポート方針（B.6 は記録まで）。両 outbox（account_sync/mail）の `failed` 行の可視化/手動再送・管理者ロック解除＝管理面が無い。
  - **ドメイン C 以降**（クエスト等）未着手。`delete_company_quest_group` の quests 参照チェックは quests テーブル実装時に追加する TODO（コードにコメント済み）。
  - **本番デプロイ設定**（`TRUSTED_PROXY_COUNT` 実値・エッジ XFF 確定）＝`doc/本番デプロイ要件.md` §6・未確認。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションのハマり（解消済み）**:
  - **frontend 再ビルドで Playwright ブラウザ本体が消える**＝`install-deps`（システム依存）だけでは足りず `npx playwright install chromium`（ブラウザ本体）も要る。再ビルド後に e2e が全件「browser not installed」で落ちた→ブラウザ本体を再取得して 22 passed。**frontend を焼き直したら deps＋browser の両方を入れ直す**。
  - **frontend の新規 EP 型は codegen 先行**＝`types.ts` が新スキーマ（`EmailChangeConfirmRequest` 等）を参照するので、**backend を新コードでビルド/起動→`npm run codegen`（OPENAPI_URL＝backend）→ schema.d.ts 再生成→ frontend ビルド** の順でないと tsc/next build が落ちる。
- **過去セッションからの重要な教訓（再発防止）**:
  - **worker プロセスの import 隔離＝FK ターゲット未登録**＝`mail_worker` は別プロセスで `mail_outbox.orm` しか import せず FK 先が metadata に無いと書込で `NoReferencedTableError`（pytest では再現しない）。**worker エントリは必ずフルスタックでスモークする**（本セッションの新 mail category 2種も `done` を実測）。回帰ガード＝A-TC-100。
  - **alembic の revision id は 32 字以内**（`alembic_version.version_num` が varchar(32)）。長い id は upgrade 末尾で `StringDataRightTruncation`（`0010_accounts_pending_email`＝27字）。
  - **JSONB payload に datetime**＝ISO 文字列で積み、適用側（`upsert_user_mirror`）で `datetime.fromisoformat` に戻す（`_DATETIME_FIELDS`）。
  - **監査ログ detail に UUID/datetime**＝`json.dumps(default=str)`（`audit/repository.py` `_json_safe`）。detail に PW/トークンを入れない（§15）。
  - **session に足したフラグが GET /session に出ない**＝`auth/application.py` `_SESSION_PUBLIC_KEYS`（ホワイトリスト）に載せる必要がある。
- **環境まわりの定番ハマり**:
  - **Bash の cwd ドリフト**＝`docker compose` は必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl` してから。
  - **backend はイメージにソース焼き込み**（`COPY . .`）＝ホスト編集を反映するには `-v "$PWD/backend:/app"` マウントで実行（テスト）／実起動は再ビルド。
  - **frontend の tsc**＝`-v "$PWD/frontend/src:/app/src"`（src だけマウント）＋ `node_modules/.bin/tsc --noEmit`。
  - **compose の `environment:` に列挙した変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `&backend_env` に配線（worker/mail-worker も同アンカー）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（K.3 メール変更 double opt-in・ADR-0008）
- **方式＝ダブルオプトイン**（不採用＝即時反映＋旧メール通知のみ〔到達確認できずタイプミス/誤登録を防げない〕）。
- **保持＝`accounts.pending_email` ＋ `otp_challenges` purpose=email_change 流用**（不採用＝otp_challenges に payload 列／専用テーブル新設＝1 アカ 1 pending で足りるため過剰）。
- **確定 EP は未認証**（トークンが認可・不採用＝認証必須＝リンククリック先にセッションが無いと踏めず UX を損なう）。
- **旧メールへ変更通知**（乗っ取り検知・新アドレスは載せない＝最小開示）。
- **確定時のセッション破棄はしない**（不採用＝全破棄＝メール変更は資格情報でもロールでもなく再ログイン強制は過剰）。
- **TTL 24h**（PW 設定 72h より時限的でよい＝本人が自分の操作直後に確認する前提）。**ミラー enqueue は確定時**（pending を users に漏らさない）。
- **frontend 確定は明示ボタン**（メールスキャナ先読みでの自動確定を避ける）。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001）。初回/再設定PW（ADR-0002）。MFA/信頼端末（ADR-0004）。アカウント一時ロック（ADR-0005）。クライアントIP確定（ADR-0006）。設定の置き場所（ADR-0003）。メール非同期化（ADR-0007）。**メール変更 double opt-in（ADR-0008・本セッション）**。
- account_sync_outbox（§4.6）＝管理DB→会社DB `users` ミラー・seq 順・冪等・HOLブロッキング（メール outbox は HOL 無し）。
- SoD（§8-⑯）＝system_admin／company_account_admin／QG admin（per-group）。
- 2プレーン×縦スライス4層（router→application→domain→repository・エントリは `main.py`/`worker.py`/`mail_worker.py` の3つ）。

---

## 7. 次にやること — 優先順に、具体的に

> ドメイン B バックエンド＋B/K 管理系 frontend＋K identity 自己編集（K.3＝display_name/locale・PW 変更・メール変更 double opt-in）は縦通し済み。次スライスの選択はユーザーと相談。以下は候補（優先順）。

### (1) GET /me の残高・画像同梱＝K.1 全体（MinIO 署名URL）
- 現状 `me/application.py` の `get_me` は identity サブセットのみ。K.1 は残高（コイン/XP 等）と画像（背景/アバターの署名URL）を同梱。
- 前提＝MinIO クライアント基盤（署名URL 生成）未整備＝**先に画像ストレージの ADR/設計を確認**（`doc/API設計/K_プロフィール・背景画像.md` K.1/K.4）。残高の源泉テーブル（C/ゲーミフィケーション系）未実装なら K.1 は C 着手後が自然＝要相談。

### (2) 口座一覧のページング・検索 UI
- backend 一覧 EP（`GET /admin/companies/{id}/accounts`＝SC-92／`/admin/accounts`＝SC-93）はページング対応済みだが frontend が `per_page=100` 固定（`features/accounts` `api.ts`・`AccountSection`/`AccountSelfSection`）。ページャ＋検索 UI を足す。**モック対応＝SC-92 会社詳細／SC-93 会社アカウント管理**。

### (3) 管理面（監査ログ閲覧・outbox failed 可視化）
- 監査ログ閲覧 API/UI（`system_audit_logs` 一覧・フィルタ）＝B.6 は記録まで。両 outbox（account_sync/mail）の `failed` 行の一覧・手動再送、管理者ロック解除。

### (4) ドメイン C 着手（クエスト等）
- 未着手。`doc/API設計/C_*.md`・`doc/データモデル.md` §5.x を正に、テーブル→repository→application→router で縦通し。quests 実装時に `delete_company_quest_group` に quests 参照チェックを足す（TODO コメント済み）。

### 仕上げパス（ドキュメント正規化）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化）＝**折衷方針で先送り**（設計確定後の最終パス）。

### 手法（毎スライス共通）
- **red-green 必須**（テスト規約 §5.1）＝実装前に対象の振る舞いで落ちる red を目視（証跡はコミットメッセージ）。
- **API設計に新規 EP を追記する時は既存節と同じ表形式に揃える**（memory 記録済み）。
- テストパターン md の TC 表を持つ各節に「テスト範囲の概要」を必須（テスト規約 §1.1）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog SMTP `:1025`・UI `:8025`／backend `:8000`／frontend `:3000`。**worker / mail-worker はポート無し**（常駐のみ）。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001-**0010**・company 0001-**0006**〕→seed＝2社＋OPS 運営テナント＋初期 system_admin〔`BOOTSTRAP_ADMIN_PASSWORD` 供給時〕・冪等）してから uvicorn。
- **dev ログイン**:
  - system_admin＝会社コード `OPS`／`admin@ops.example`／`Passw0rd!`。
  - seed 会社＝`ACME-01`（`mfa_required=false`）/`user@acme.example`／`ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（**本セッション実測 164 passed**・build 不要でホスト変更が即反映）。部分＝`pytest tests/me -q`（10 passed）。
- **メールワーカ単体スモーク**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" -e MAIL_OUTBOX_POLL_INTERVAL_SECONDS=0.2 backend timeout 2 python -m app.mail_worker`。account_sync ワーカは `python -m app.worker`。
- **frontend 型/OpenAPI**＝tsc＝`docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。**OpenAPI 型は手書きせず codegen**＝backend 起動後 `docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen`（`src/lib/api/schema.d.ts` 再生成）。**frontend の実挙動/e2e に反映するには frontend を再ビルド**（`docker compose up -d --build frontend`＝src 焼き込み・マウント無し）。
- **e2e**＝フル起動後、**frontend を焼くたびに** `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `docker compose exec -T frontend npx playwright install chromium`（**ブラウザ本体も必須**・本セッションで踏んだ）→ `docker compose exec -T frontend npx playwright test --workers=1`（**本セッション実測 22 passed**）。編集した spec を焼き直さず走らせるなら `docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>`。**メール依存 e2e（sc-00-mfa/password-setup）は `mail-worker` 起動が前提**。**多数ログインの 429 は `LOGIN_RATE_LIMIT_MAX=50` で解消済み**＝それでも詰まったら `docker compose exec redis redis-cli flushall`。
- **MailHog**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`。コンテナ内からは `http://mailhog:8025`。メール配送の確認は `mail_outbox` の `status`（`done`/`failed`）を psql で見るのが確実。
- **主要 env**＝`impl/.env.example` が雛形（`.env` は追跡外）。**実設定は `impl/compose.yaml` の `&backend_env` アンカー**（worker/mail-worker も同一）。本セッション追加＝**`EMAIL_CHANGE_TTL_SECONDS`（既定 86400＝24h・ADR-0008）**。既存＝`LOGIN_RATE_LIMIT_*`／`LOGIN_LOCK_*`／`MAIL_OUTBOX_*`／`PASSWORD_SETUP_TTL`（config 既定 72h）／`OPS_COMPANY_CODE`・`BOOTSTRAP_ADMIN_*`／`OUTBOX_MAX_ATTEMPTS`／`TRUSTED_PROXY_COUNT`。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf`・`.env` は追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff の2段**・末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`・**プッシュはユーザー依頼時のみ**。
  - TC-ID＝`<ドメイン>-TC-<3桁>`。設計の正は1箇所・他は参照（drift 回避）。`CLAUDE.md` が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(1) GET /me 残高・画像（K.1 全体・MinIO）／(2) 口座一覧ページング・検索 UI〔SC-92/SC-93〕／(3) 管理面（監査ログ閲覧・outbox failed）／(4) ドメイン C 着手**。本セッション完了＝K.3 メール変更 double opt-in（ADR-0008）。
- ✅ 状態＝**backend 164 passed・full e2e 22 passed**（本セッション実測）。migration head＝control 0010・company 0006。作業ツリー クリーン・`origin/main` へ push 済み。
- ✅ 本セッションの全変更（ADR-0008・me/{application,router,schemas}.py・auth/{orm,repository}.py・mail_outbox/templates.py・config/compose/.env・migration 0010・profile/{SecuritySection,EmailChangeConfirm}・(auth)/email-change/confirm・doc/テスト/K）と理由・設計判断を §3/§6 に、ハマりと再発防止を §5 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/ADR/*.md`・`doc/データモデル.md`・`doc/API設計/*.md`・`doc/テスト/*.md`・`doc/規約/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
- ⚠ Docker は本 handoff 時点で **フルスタック起動中**（イメージは K.3 double opt-in 込みの最新）。
