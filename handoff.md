# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地＝実装スキャフォールド進行中。手法＝「設計書→（必要なら ADR で具体値確定）→テストパターン→テストコード→実装」で 1 スライスずつ縦に通す。red-green 必須（`doc/規約/テスト規約.md` §5.1）。**
> **本セッションで完了＝K.3 メール・PW 変更（自己再認証・全セッション破棄）＝ドメイン K の identity 自己編集が一通り縦通し。併せて full e2e の自己スロットル（ログインレート制限）を compose env で解消。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-11 JST**（セッション終了時）。
- ブランチ: **main**（作業ツリー クリーン）。
- 最新コミット: **`40a9a71`**（handoff: K.3 完了反映）。**`origin/main` へプッシュ済み**（`c7d6638..40a9a71`）。直近の流れ＝`6a71ed9`（実装 K.3 メール・PW 変更）→`40a9a71`（handoff）。
- 本セッションのコミット（古い順・すべてプッシュ済み）:
  - `6a71ed9` 実装 K.3 メール・PW 変更（自己再認証・全セッション破棄）＝`POST /me/password`・`POST /me/email`・`GET /me`＋compose `LOGIN_RATE_LIMIT_*` 外出し。
  - `40a9a71` handoff 更新。
- 直前セッションの最新＝`7a7cf6b`（session is_qg_admin フラグ）／`c7d6638`（その handoff）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **プッシュはユーザー依頼時のみ**。コミットは **実装本体→handoff にハッシュ追記の2段**が基本。コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内のアイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev メール)／Docker。
- 設計フェーズは **API設計 A〜L 全確定＋横断再レビュー済み**。現在は **実装スキャフォールドを 1 スライスずつ縦に通す段階**。

---

## 3. 今回やったこと — 変更ファイルと理由

### K.3 メール・PW 変更（`6a71ed9`）＝本セッションの主成果
目的＝ドメイン K の identity 自己編集の残り（メール変更・パスワード変更）を、**現在パスワードでの再認証**を挟んで安全に縦通しする。正＝`doc/API設計/K_プロフィール・背景画像.md`（K.3）・`doc/データモデル.md` §4.2（accounts＝identity 源泉）・§4.6（account_sync_outbox）・`doc/テスト/K_プロフィール.md`。

**backend（`impl/backend/app/control_plane/me/`）**:
- `application.py`＝`get_me`（identity サブセットのみ返却＝PW ハッシュ等の機密は返さない）／`change_password`（新PWポリシー違反→422／`_require_current_password` で再認証・不一致は `AppError(403,"reauth_failed")`／成功で `hash_password`＋`revoke_all_trusted_devices`＋`delete_account_sessions`＝**全セッション破棄**）／`change_email`（再認証→会社内 email 一意再検証・重複は 409 `conflict` field=email／`accounts.email` 更新＋**同一Tx で account_sync_outbox に upsert{email} enqueue**＝会社DB `users` ミラーはワーカが結果整合）。`_require_current_password` は account None でも 403。
- `router.py`＝`GET /me`（200・`MeProfileResponse`）／`POST /me/password`（204）／`POST /me/email`（200・`MeProfileResponse`）。
- `schemas.py`＝`MeProfileResponse`／`PasswordChangeRequest{current_password,new_password}`／`EmailChangeRequest{new_email,current_password}`（いずれも `extra="forbid"`＝Mass Assignment 防止）。

**frontend（`impl/frontend/src/features/profile/`）**:
- `components/SecuritySection.tsx`（新規）＝PW 変更フォーム（cur/new/confirm・**クライアントで確認不一致を弾き送信抑止**・204 で `router.push("/login")` 再ログイン誘導）＋メール変更フォーム（再認証）。`reauthMessage` が `reauth_failed`/`validation_error`/`conflict` を文言化。
- `index.ts` に `SecuritySection` を export／`app/(app)/profile/page.tsx` の `<ProfileForm/>` の下に配置。
- `api.ts`/`types.ts` 更新・`src/lib/api/schema.d.ts` は OpenAPI から再生成（`npm run codegen`）。

**テスト**:
- backend `tests/me/test_me.py`＝K-TC-004/005（GET /me＝identity のみ・401）・K-TC-007（PW 変更＝不一致403／ポリシー422／成功204＋全破棄）・K-TC-008（メール変更＝不一致403／重複409／成功200＋outbox）。
- e2e `frontend/e2e/k-profile.spec.ts`＝K-TC-009（**error-path のみ**＝確認不一致〔クライアント〕・現在PW不一致〔403〕。**成功パスは共有 OPS 資格情報を壊すため踏まない**＝happy は backend K-TC-007/008 が担保）。
- `doc/テスト/K_プロフィール.md`＝§1.1 に GET /me（K-TC-004/005）・§1 に K-TC-007/008・§2 に K-TC-009 を追記。

### full e2e の自己スロットル解消（同 `6a71ed9`）
- `impl/compose.yaml` の `&backend_env` に **`LOGIN_RATE_LIMIT_MAX`（dev 既定 50）** と **`LOGIN_RATE_LIMIT_WINDOW_SECONDS`（既定 300）** を `${VAR:-default}` で外出し。
- 理由＝full e2e を `--workers=1` 直列で回すと OPS 管理者（`admin@ops.example`）へ ~11 回ログインし、`login_rate_limit_max` の既定 10（IP+login_id/300s 固定窓）で 11 回目が 429 → ログイン後の `getByText("ようこそ")` が出ず落ちる（B-TC-122）。dev/e2e スタックだけ 50 に上げて解消。**prod は別 env で不変**（compose はあくまで dev/test スタック）。ログインレート制限を直接検証する pytest は存在しない（lock は別カウンタ `LOGIN_LOCK_MAX_ATTEMPTS`）ので退行なし。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **動いているもの（backend で縦通し済み）**:
  - **ドメイン A ログイン**：状態A（PWログイン）・B（初回/再設定PW）・C（MFA）・D（再設定要求）。SC-00 は frontend も完了。アカウント一時ロック（ADR-0005）＋クライアントIP確定（ADR-0006）。
  - **account_sync_outbox**（管理DB→会社DB `users` ミラー・§4.6・`app/worker.py`）＝writer は `password_set`／`last_login_at`／発行・編集・無効化・再有効化（B）／プロフィール編集（K `PATCH /me`）／**メール変更（K.3 `POST /me/email`＝本セッション）**。**worker は payload の `memberships` を `users` の後に会社DB `quest_group_members` へ適用（B.5 step3・FK 順）＝加算専用（upsert のみ・削除しない）**。所属の「修正」（差分・削除）は会社DB を直接更新する編集経路（`admin/application._apply_membership_diff`＝PATCH /admin/.../accounts・B.3）／QG管理者 API（B.4）が担う（ワーカに修正を載せると削除が効かない silent bug）。
  - **mail_outbox**（認証系メール非同期化・ADR-0007・`app/mail_worker.py`）＝OTP・設定リンク・ロック通知を enqueue → 別プロセスワーカが SMTP 送信。フルスタックで MailHog 非同期配信を目視確認済み。
  - **ドメイン B アカウント管理 API（`/admin/*`）**＝`/admin/companies`（会社CRUD・system_admin）／`/admin/companies/{id}/accounts`（会社スコープのアカウント発行/編集/disable/enable/password-reset・system_admin）／`/admin/accounts`（company_account_admin・セッション会社固定・SoD）／`/admin/company-quest-groups`（会社アカ管理者向け自社グループ一覧・B.2.1）／B.4 QG管理者 API（`/admin/quest-groups`・`/admin/company-directory`・参加追加/除外・per-group 認可）／quest_groups CRUD（作成/一覧/リネーム/削除＝トゥームストーン）。bootstrap で OPS 運営テナント＋初期 system_admin を seed。
  - **ドメイン K**＝`GET /me`（identity）・`PATCH /me`（display_name/locale）・**`POST /me/password`（本セッション・204＋全セッション破棄＋信頼端末失効）・`POST /me/email`（本セッション・再認証＋会社内一意→409・200＋outbox）**。
  - **監査ログ**＝`system_audit_logs`（control migration 0009）に特権操作を記録。実行者/IP/UA は `AuditContextMiddleware`（contextvar）が供給（B.6）。
  - **session `is_qg_admin`**＝ログイン時に会社DBの admin 所属を集計し session にスナップショット（SC-90 ナビ出し分け）。
- **frontend（フルスタックで実測）**＝features に companies／accounts（AccountSection＝system_admin クロステナント／AccountSelfSection＝会社アカ管理者 自社・MembershipsEditor）／questgroups／qgadmin／**profile（ProfileForm＋SecuritySection）**。route＝`(app)/admin/companies[/[id]]`・`/admin/accounts`・`/admin/quest-groups`・`/profile`。ヘッダーナビは system_role と is_qg_admin でゲート。**口座一覧 UI は暫定 per_page=100（ページング/検索 UI 未実装）**。
- **テスト（本セッションで実測）**:
  - **backend pytest = 161 passed**（マウント版で実測。migration head＝**control 0009**・**company 0006**）。※`B-TC-005` HOL・`A-TC-077` ロック通知・`A-TC-096` mail reclaim は稀に timing フレーク＝再実行で green（本セッションの 161 passed は 1 回で green）。
  - **full e2e = 21 passed**（`docker compose exec -T frontend npx playwright test --workers=1`・`LOGIN_RATE_LIMIT_MAX=50` 反映済みで自己スロットル無し）。内訳＝sc-00 系5＋sc-91 系3＋sc-92 系5＋sc-93 系3＋sc-90 系3＋k-profile 2（K-TC-006/009）。
- **Docker（本 handoff 時点）**＝**db / redis のみ起動中**（backend フルスイート実測のため up した）。frontend/backend/worker/mail-worker は停止。**backend/frontend の実イメージは K.3 の変更を焼いた最新**（本セッション中に build 済み）。フルスタックで試すなら §8 の手順で up。
- **壊れているもの＝無し**。
- **未実装 / 負債**:
  - **ドメイン K 残り**＝`GET /me` の残高・画像（署名URL）同梱＝K.1 全体（MinIO・別スライス）。K.4 画像（背景/アバター・MinIO）。PW 変更完了メール通知（H・任意）。
  - **口座一覧のページング・検索 UI**（現状 per_page=100 の暫定）。
  - **監査ログの閲覧 UI/API**・保持/エクスポート方針（B.6 は記録まで）。両 outbox（account_sync/mail）の `failed` 行の可視化/手動再送・管理者ロック解除＝管理面が無い。
  - **ドメイン C 以降**（クエスト等）未着手。`delete_company_quest_group` の quests 参照チェックは quests テーブル実装時に追加する TODO（コードにコメント済み）。
  - **本番デプロイ設定**（`TRUSTED_PROXY_COUNT` 実値・エッジ XFF 確定）＝`doc/本番デプロイ要件.md` §6・未確認。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションで解消した問題**:
  - **full e2e が末尾で 1 failed（B-TC-122・OPS ログイン 429）**＝直列実行で同一 OPS 管理者へ ~11 ログイン → `login_rate_limit_max`（既定 10・IP+login_id/300s 固定窓）を超過。**失敗ロック（LOGIN_LOCK・5回）とは別カウンタ**（こちらは成功試行も数える）。試した/採った対処＝(a) `redis flushall` でカウンタ消去（一時しのぎ・再実行で再発）→ 採用せず、(b) **compose env で dev/e2e の閾値を 50 に外出し**（恒久・prod 不変）→ 採用。
- **過去セッションからの重要な教訓（再発防止）**:
  - **worker プロセスの import 隔離＝FK ターゲット未登録**＝`mail_worker` は別プロセスで `mail_outbox.orm` しか import せず FK 先 `accounts`/`companies` が SQLAlchemy metadata に無いと `done` 書込で `NoReferencedTableError`（pytest は conftest が auth.orm を import 済みで再現しない）。**worker エントリは必ずフルスタックでスモークする**。回帰ガード＝A-TC-100。
  - **alembic の revision id は 32 字以内**（`alembic_version.version_num` が varchar(32)）。長い id は upgrade 末尾で `StringDataRightTruncation`。
  - **JSONB payload に datetime を載せる**＝ISO 文字列で積み、適用側（`upsert_user_mirror`）で `datetime.fromisoformat` に戻す（`_DATETIME_FIELDS`）。
  - **監査ログ detail に UUID/datetime**＝`json.dumps(default=str)`（`audit/repository.py` の `_json_safe`）。detail に PW/トークンを入れない（§15）。
  - **session に足したフラグが GET /session に出ない**＝`auth/application.py` の `_SESSION_PUBLIC_KEYS`（ホワイトリスト）に載せる必要がある（is_qg_admin で踏んだ）。
- **環境まわりの定番ハマり**:
  - **Bash の cwd ドリフト**＝`docker compose` は必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl` してから（さもないと「no configuration file」/「No module named scripts」）。
  - **backend はイメージにソース焼き込み**（`COPY . .`）＝ホスト編集を反映するには `-v "$PWD/backend:/app"` マウントで実行。
  - **frontend の tsc**＝`-v "$PWD/frontend/src:/app/src"`（src だけマウント・焼いた node_modules を残す）＋ `node_modules/.bin/tsc --noEmit`。
  - **frontend 再ビルドで Playwright system deps が消える**＝`docker compose exec -u root frontend npx playwright install-deps chromium` を都度再実行。
  - **compose の `environment:` に列挙した変数のみコンテナへ届く**（`env_file:` 無し）。新規しきい値は必ず `&backend_env` に配線（worker/mail-worker も同アンカー）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（K.3・full e2e 安定化）
- **PW 変更成功で全セッション破棄＋信頼端末失効**（A.9-③）＝再認証で本人性を担保しつつ、漏洩端末を締め出す。メール変更は**セッション破棄しない**（再認証で担保・利便性優先・K.3 設計）。
- **メール変更の一意性は会社内**（§4.2＝identity は会社スコープ一意）＝重複は 409 conflict field=email。
- **e2e happy を踏まない**＝共有 OPS 資格情報（多数の spec がログインに使う）を PW 変更で壊さないため、e2e は error-path のみ。happy は backend K-TC-007/008。
- **ログインレート制限は dev/e2e だけ 50 へ**（不採用＝e2e ごとに redis flush〔再発する〕／e2e を storageState で 1 ログイン化〔大きめの改修・今回は見送り〕）。compose は dev スタックなので env 既定を上げるのが最小・恒久。prod は別 env。

### 過去の確定（正は各 `doc/API設計/*.md`・`doc/ADR/*.md`。ここは要約）
- ログイン＝Cookie＋Redis 不透明セッション（ADR-0001）。初回/再設定PW（ADR-0002）。MFA/信頼端末（ADR-0004）。アカウント一時ロック（ADR-0005・(IP+login_id)・5回→15分・固定窓）。クライアントIP確定（ADR-0006）。設定の置き場所（ADR-0003）。メール非同期化（ADR-0007＝管理DB `mail_outbox`・別プロセスワーカ・秘匿値は `secret` 列隔離・送信後 NULL・control-plane 認証系メール専用〔§2.9〕）。
- account_sync_outbox（§4.6）＝管理DB→会社DB `users` ミラー・seq 順・冪等・HOLブロッキング（メール outbox とは方針が逆＝メールは独立事象で HOL 無し）。
- SoD（§8-⑯）＝system_admin（全体）／company_account_admin（自社アカウント・system_role 付与不可・system_admin の disable 不可・グループ別 admin 任命可）／QG admin（per-group role=admin・参加のみ・アカウント本体に触れない）。
- 2プレーン×縦スライス4層（router→application→domain→repository・エントリは `main.py`/`worker.py`/`mail_worker.py` の3つ）。

---

## 7. 次にやること — 優先順に、具体的に

> ドメイン B バックエンド＋B/K 管理系 frontend＋K identity 自己編集（K.3 含む）は縦通し済み。次スライスの選択はユーザーと相談。以下は候補（優先順）。

### (1) GET /me の残高・画像同梱＝K.1 全体（MinIO 署名URL）
- 現状 `app/control_plane/me/application.py` の `get_me` は identity サブセットのみ。K.1 は残高（コイン/XP 等）と画像（背景/アバターの署名URL）を同梱する。
- 前提＝MinIO クライアント基盤（署名URL 生成）＝未整備。**先に画像ストレージの ADR/設計を確認**（`doc/API設計/K_プロフィール・背景画像.md` K.1/K.4・`doc/データモデル.md`）。残高の源泉テーブル（ドメイン C/ゲーミフィケーション系）が未実装なら K.1 は C 着手後が自然＝要相談。

### (2) 口座一覧のページング・検索 UI
- backend 一覧 EP（`GET /admin/companies/{id}/accounts`・`/admin/accounts`）はページング対応済みだが frontend が `per_page=100` 固定（`features/accounts` の `api.ts`・`AccountSection`/`AccountSelfSection`）。ページャ＋検索 UI を足す。

### (3) 管理面（監査ログ閲覧・outbox failed 可視化）
- 監査ログ閲覧 API/UI（`system_audit_logs` の一覧・フィルタ）＝B.6 は記録まで。両 outbox（account_sync/mail）の `failed` 行の一覧・手動再送、管理者ロック解除。

### (4) ドメイン C 着手（クエスト等）
- 未着手。`doc/API設計/C_*.md`・`doc/データモデル.md` §5.x を正に、テーブル→repository→application→router で縦通し。quests 実装時に `admin/quest_group_application.py`（または該当）の `delete_company_quest_group` に quests 参照チェックを足す（TODO コメント済み）。

### 仕上げパス（ドキュメント正規化）
- ドキュメント作成規約の網羅適用（裸 `§x` の文書名接頭辞化）＝**折衷方針で先送り**（設計確定後の最終パス）。

### 手法（毎スライス共通）
- **red-green 必須**（テスト規約 §5.1）＝実装前に対象の振る舞いで落ちる red を目視（証跡はコミットメッセージ／後追い＝反転手技は `doc/テスト/red確認台帳.md`）。
- **API設計に新規 EP を追記する時は既存節と同じ表形式に揃える**（ユーザー指摘・memory 記録済み）。
- テストパターン md の TC 表を持つ各節に「テスト範囲の概要」を必須（テスト規約 §1.1）。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog SMTP `:1025`・UI `:8025`／backend `:8000`／frontend `:3000`。**worker / mail-worker はポート無し**（常駐のみ・service 名は `worker` と `mail-worker`＝ハイフン）。backend entrypoint が bootstrap（DB作成→`alembic` head〔control 0001-**0009**・company 0001-**0006**〕→seed＝2社＋OPS 運営テナント＋初期 system_admin〔`BOOTSTRAP_ADMIN_PASSWORD` 供給時〕・冪等）してから uvicorn。
- **dev ログイン**:
  - system_admin＝会社コード `OPS`／`admin@ops.example`／`Passw0rd!`。
  - seed 会社＝`ACME-01`（`mfa_required=false`）/`user@acme.example`／`ACME-02`（`mfa_required=true`）/`mfa@acme2.example`。PW いずれも `Passw0rd!`。
- **backend テスト（ホスト編集を反映＝マウント版・編集中はこちら）**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（**本セッション実測 161 passed**・build 不要でホスト変更が即反映）。部分実行例＝`pytest tests/me tests/auth -q`（77 passed）。
- **メールワーカ単体スモーク**＝`cd impl && docker compose run --rm --no-deps -v "$PWD/backend:/app" -e MAIL_OUTBOX_POLL_INTERVAL_SECONDS=0.2 backend timeout 2 python -m app.mail_worker`。account_sync ワーカは `python -m app.worker`。
- **frontend 型チェック/lint**＝tsc＝`docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`／lint＝`docker compose exec -T frontend npm run lint`。**OpenAPI 型は手書きせず `npm run codegen`**（backend openapi.json から `src/lib/api/schema.d.ts` を再生成）。
- **e2e**＝フル起動後、**初回のみ** `docker compose exec -u root frontend npx playwright install-deps chromium` → `... install chromium` → `docker compose exec -T frontend npx playwright test --workers=1`（**本セッション実測 21 passed**）。編集した spec を焼き直さず走らせるなら `docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>`。**メール依存 e2e（sc-00-mfa/password-setup）は `mail-worker` 起動が前提**。**多数ログインの 429 は `LOGIN_RATE_LIMIT_MAX=50`（compose 既定・本セッションで配線）で解消済み**＝それでも詰まったら `docker compose exec redis redis-cli flushall`。
- **MailHog**＝ブラウザ `http://localhost:8025`／API `GET http://localhost:8025/api/v2/messages`（本文 encode は種別で不定＝base64 デコード試行→ダメなら生テキスト）。コンテナ内からは `http://mailhog:8025`。
- **主要 env**＝`impl/.env.example` が雛形（`.env` は追跡外）。**実設定は `impl/compose.yaml` の `&backend_env` アンカー**（worker/mail-worker も同一）。本セッション追加＝**`LOGIN_RATE_LIMIT_MAX`（dev 既定 50）/`LOGIN_RATE_LIMIT_WINDOW_SECONDS`（既定 300）**。既存の関連＝`LOGIN_LOCK_*`／`MAIL_OUTBOX_*`／`OPS_COMPANY_CODE`・`BOOTSTRAP_ADMIN_*`／`OUTBOX_MAX_ATTEMPTS`／`TRUSTED_PROXY_COUNT`。
- **リポジトリ運用**:
  - `.gitignore` で `*.pdf`・`.env` は追跡外（`.env.example` が雛形）。
  - コミットは **実装本体→handoff の2段**・末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`・**プッシュはユーザー依頼時のみ**。
  - TC-ID＝`<ドメイン>-TC-<3桁>`。設計の正は1箇所・他は参照（drift 回避）。`CLAUDE.md` が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(1) GET /me 残高・画像（K.1 全体・MinIO）／(2) 口座一覧ページング・検索 UI／(3) 管理面（監査ログ閲覧・outbox failed）／(4) ドメイン C 着手**。本セッション完了＝K.3 メール・PW 変更（再認証・全セッション破棄）＋full e2e 安定化。
- ✅ 状態＝**backend 161 passed・full e2e 21 passed**（本セッション実測）。migration head＝control 0009・company 0006。作業ツリー クリーン・`origin/main` へ push 済み（最新 `40a9a71`）。
- ✅ 本セッションの全変更（me/{application,router,schemas}.py・profile/SecuritySection.tsx・compose の LOGIN_RATE_LIMIT・doc/テスト/K）と理由・設計判断を §3/§6 に、ハマりと再発防止を §5 に記録。
- ✅ 起動/テスト/型/e2e コマンドと dev ログイン・env を §8 に記録。
- ⚠ 詳細な決定理由・具体値は各 `doc/ADR/*.md`・`doc/データモデル.md`・`doc/API設計/*.md`・`doc/テスト/*.md`・`doc/規約/*.md` を正とすること（本 handoff は要約）。会話ログは参照不可。
- ⚠ Docker は本 handoff 時点で **db/redis のみ起動**（他は停止・イメージは K.3 込みの最新）。フルスタックは §8 で up。
