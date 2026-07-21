# API 設計

> ideaquest の HTTP API 設計。**本ファイルの第1章（API 全体規約）を「全体設計」として先に確定**し、第2章のドメイン別エンドポイントを**分割レビュー**で順に詳細化する方針（2026-07-21 合意）。
> 仕様の本体は `doc/要件定義/README.md`（唯一の要件定義書）、データ構造は `doc/データモデル.md` を参照。本ファイルはその API 展開。

- 最終更新: 2026-07-21
- 対象フェーズ: **API 設計フェーズ（開始）＝データモデル詳細フェーズ完了・実装前**
- スタイル: **REST / JSON ＋ OpenAPI**（FastAPI 自動生成の OpenAPI をソースオブトゥルースに）
- 関連: `doc/データモデル.md`（テーブル/Enum）・`doc/画面設計/screens/SC-*.md`（各画面の「API」節）・各 `mocks/SC-*.html`（mock API 注記）

---

## 0. 前提・アーキテクチャ

- **1 デプロイ構成**: Web(リバプロ)1 ＋ フロント(Next.js)1 ＋ バックエンド(FastAPI)1 ＋ 管理DB(PostgreSQL)1 ＋ 会社DB N ＋ MinIO 1。
- **2 層 DB**: ①管理DB（コントロールプレーン＝認証/アカウント/会社/接続情報）②会社DB（データプレーン＝会社ごと物理分離、クエスト等の機密データ）。
- **動的ルーティング**: バックエンドは 1 つ。**ログイン時に管理DBで所属会社を判定し、以降のリクエストはセッションが持つ `company_id` からその会社DBへ動的に接続**（SQLAlchemy のエンジン/セッションを会社ごとに切替。§1.5）。
- **API の 2 系統**:
  - **コントロールプレーン API**（`/api/v1/auth/*`・`/api/v1/admin/*`）＝管理DB を操作（認証・会社/アカウント管理）。
  - **テナント API**（上記以外の `/api/v1/*`）＝セッションで確定した会社DB を操作（クエスト・アイデア・評価・チャット・ゲーム・通知）。

---

## 1. API 全体規約（＝全体設計・先に確定する部分）

### 1.1 スタイル・フォーマット

- **REST / JSON**。リクエスト/レスポンスボディは `application/json`（添付アップロードのみ `multipart/form-data`、§1.10）。
- **OpenAPI 3.1** を FastAPI が自動生成（`/api/v1/openapi.json`・`/api/v1/docs`）。**これを API 仕様のソースオブトゥルース**とし、本ファイルは設計意図・非自明な規約・画面との対応を残す（エンドポイントの網羅表は本ファイル第2章＋OpenAPI）。
- **文字コード**: UTF-8。**日時**: `timestamptz` を **ISO 8601・UTC（`Z` 付き）** で送受信し、**JST 表示・週起点（月曜0時JST）等の変換はフロント**で行う（集計の週境界はサーバーが JST で判定＝データモデル §7）。
- **金額/ポイント**（XP/コイン/SP）は整数。ID は **UUID（文字列）**。

### 1.2 バージョニング・ベース URL

- ベースパス **`/api/v1`**。破壊的変更は `/api/v2` で並走（MVP は v1 のみ）。
- フロント（Next.js）からは同一オリジンのリバプロ経由で `/api/v1/*` を叩く（CORS 実質不要・將来別オリジン時は許可オリジンを明示）。

### 1.3 URL・命名規約

- **リソースはケバブケースの複数形**（例 `/quests`・`/ideas`・`/quest-groups`・`/chat-messages`）。ネストは 1〜2 段まで（例 `/quests/{quest_id}/ideas`）、深い関連はトップレベル＋クエリで表現。
- **JSON フィールドは snake_case**（データモデルのカラム名と一致させ、変換レイヤを増やさない）。列挙値はデータモデル §3 の Enum 値をそのまま使用（例 `status: "recruiting"`、`permission_type: "evaluator"`）。
- **HTTP メソッド**: `GET`（取得）/`POST`（作成・非冪等アクション）/`PUT`（全体更新）/`PATCH`（部分更新）/`DELETE`（削除＝論理削除はサーバー側で `deleted_at` 設定）。状態遷移やアクション系（投票・公開・解放・購入など）は **`POST /{resource}/{id}/{action}`** のサブアクション形で表す（例 `POST /ideas/{id}/vote`・`POST /quests/{id}/publish`・`POST /spells/{id}/unlock`）。
- **ID パラメータ**は `{resource}_id`（例 `{quest_id}`）。

### 1.4 認証・セッション

**フロー＝会社コードで会社特定 → login_id＋PW → （信頼端末なら OTP スキップ）→ メール OTP(MFA) → セッション発行**（データモデル §4.1〜4.4・SC-00・§8-②）。

- **セッション**: ログイン成功でサーバーがセッションを発行し、**httpOnly + Secure + SameSite=Lax の Cookie**（`iq_session`）に格納。セッション実体は **Redis 等の TTL ストア**（`company_id`・`account_id`・`system_role` 等を保持＝以降の会社DBルーティングと認可に使用）。**状態変更系（POST/PUT/PATCH/DELETE）は CSRF トークン**（ダブルサブミット or `Origin`/`Sec-Fetch` 検証）で保護。
  - ※ ネイティブ/外部クライアント将来対応時は `Authorization: Bearer <token>` も受理できる設計にするが、MVP は Cookie セッションを基本とする。
- **主要エンドポイント**（詳細は第2章 A で確定）:
  | メソッド/パス | 説明 |
  | --- | --- |
  | `POST /auth/login` | in: `company_code`,`login_id`,`password`。PW 照合成功で **信頼端末 Cookie を検証**→有効なら即セッション発行、無効かつ `mfa_required` なら **OTP を発行してメール送信**し `mfa_required: true` を返す（セッション未発行） |
  | `POST /auth/mfa/verify` | in: `code`（6桁）,`trust_device`(bool)。OTP 照合→セッション発行。`trust_device` 時は信頼端末（30日）Cookie 発行 |
  | `POST /auth/mfa/resend` | OTP 再送（レート制限） |
  | `POST /auth/logout` | 現端末のセッション破棄 |
  | `POST /auth/logout-all` | 全端末サインアウト（trusted_devices を `revoked`・全セッション破棄） |
  | `GET /auth/session` | 現在のセッション情報（`account_id`/`company_id`/`system_role`/`user`（会社DBの表示情報）） |
  | `POST /auth/password-setup/verify` | in: `token`（メールリンク・`otp_purpose=password_setup`・72h）。トークン検証（初回PW設定/再設定画面の入口） |
  | `POST /auth/password-setup/complete` | in: `token`,`new_password`。PW を設定し `password_set=true`・当該アカウントの信頼端末を失効。**accounts 更新と同一Txで account_sync_outbox に upsert** |
- **列挙耐性**: `login`/OTP 失敗はアカウント有無を区別しない一律メッセージ＋レート制限（SC-00 の方針）。会社コード不正・login_id 不在も同様に曖昧化。
- **監査列の自動設定**: `created_by_id`/`updated_by_id`/`*_program` 等の共通監査列（データモデル §2.1）は**サーバーがセッションから設定**（クライアントは送らない・送っても無視）。

### 1.5 会社DB 動的ルーティング（マルチテナント）

- テナント API では**セッションの `company_id` からその会社の DB エンジン/セッションを解決**し、リクエストスコープに束縛する（FastAPI 依存性 `Depends(get_tenant_session)`）。**接続情報は `.env`／`db_identifier` から解決**（データモデル §4.1）、会社ごとにコネクションプール（or PgBouncer・§8-⑫）。
- **クロステナントアクセス禁止**: パスやボディに `company_id` を受け取らない（常にセッション由来）。管理者（system_admin）が別会社を操作する `admin` API のみ、対象会社を明示（§ 第2章 B）。
- 会社が `suspended`（メンテ中）の場合、一般ユーザのテナント API は 503 相当（`company_suspended`）。system_admin の管理操作は可。

### 1.6 認可（ロール・権限）

- **システムロール（`system_role`）**: `system_admin`（運営＝会社/全アカウント操作）/ `quest_group_admin`（自グループ内アカウント発行・編集・論理削除）/ `general`。管理 API はロールで門番。
- **フロント/バック境界（`doc/コーディング規約.md` §1）**: 認可・業務バリデーション・ゲーム計算・状態遷移/冪等はすべて**バックエンド専任**。フロントは表示・UX 出し分け・API 呼び出しのみ（クライアント側検証は UX 便宜で権威にしない）。
- **クエスト内 6 権限（`permission_type`）**: `owner`/`quest_admin`/`evaluator`/`vote`/`idea_create`/`comment`。**全アクションはサーバーが権限を強制**（フロントの出し分けは UX のみ）。代表マッピング:
  - アイデア作成 = `idea_create`、投票 = `vote`、コメント/チャット投稿 = `comment`、評価 = `evaluator`、クエスト編集/パーティー・権限変更 = `owner`/`quest_admin`、所有者権限の付与 = `owner`（作成者）のみ。
  - **可視範囲**: アイデア/チャットは**そのクエストのパーティー内のみ**（会社全体・グループ全体には非公開）。一覧・全文検索・集計は `deleted_at IS NULL` / `status='active'` で絞る。
- 認可失敗は **403 `forbidden`**、未認証は **401 `unauthenticated`**、存在秘匿が必要な場合は **404**（パーティー外リソースは 404 に倒す）。

### 1.7 エラー形式（RFC 7807 風）

- `Content-Type: application/problem+json`。共通スキーマ:
  ```json
  {
    "type": "about:blank",
    "title": "Validation failed",
    "status": 422,
    "code": "validation_error",
    "detail": "件名は必須です",
    "errors": [{ "field": "title", "code": "required", "message": "件名は必須です" }],
    "request_id": "req_..."
  }
  ```
- **`code`（機械可読・アプリ定義）で分岐**、`errors[]` はフィールド単位のバリデーション詳細（フォーム表示用）。
- 代表 `code`: `unauthenticated`(401) / `forbidden`(403) / `not_found`(404) / `validation_error`(422) / `conflict`(409) / `rate_limited`(429) / `company_suspended`(503) / `mfa_required`(200相当のログイン継続) / `idempotency_replayed`。

### 1.8 一覧: ページング・ソート・フィルタ

- **ページング＝カーソル基本＋オフセット併記**。
  - カーソル: `?limit=<n>&cursor=<opaque>`。レスポンスに `page_info: { next_cursor, has_next }`。既定 `limit=20`・上限 100。
  - オフセット（管理テーブル等の総件数が要る画面）: `?page=<n>&per_page=<n>`＋`page_info: { total, page, per_page }`。
- **一覧レスポンス共通形**: `{ "data": [...], "page_info": {...} }`。件数バッジ（`.list-count`）は `page_info.total`（オフセット時）または別途 `count` を返す。
- **フィルタ/検索/並び替え**は `.list-toolbar`（各 SC の一覧標準）に対応するクエリ: `?q=`（検索）・`?status=`・`?sort=`（例 `sort=-created_at`＝降順）・画面固有フィルタ（例 クエスト一覧 `?group_id=`、アイデア一覧 `?rating=`）。

### 1.9 冪等性・共通ヘッダ

- **冪等キー**: 非冪等 POST のうち二重送信で不整合が出るもの（アイデア投稿・購入・評価確定・魔法解放）は `Idempotency-Key` ヘッダを受理し、同キーの再送は最初の結果を返す（`idempotency_replayed`）。
- **投票の冪等**は業務ルールで担保（1人1票・`ref_type='ideas',ref_id=idea_id` の初回のみ XP＝データモデル §7/votes）＝ `POST /ideas/{id}/vote` は現在値へ収束させる冪等アクション（賛成/反対/取消）。
- **共通レスポンスヘッダ**: `X-Request-Id`（`request_id` と一致）。**レート制限**時は `Retry-After`。
- **XP日次上限**（投票5/チャット10/ログイン1＝データモデル §8-⑥）は付与時にサーバーが判定し、超過分は付与しない（レスポンスの獲得量に反映）。

### 1.10 添付ファイル（MinIO・署名付き URL）

- **上限＝1ファイル 20MB・1リクエスト 10 件・許可 MIME は allowlist**（データモデル §5.12・§8-⑦）。実体は **MinIO**、**物理名はハッシュ化**、DB（`attachments`）はパス＋元名＋サイズ＋MIME＋uploader を保持。
- **アップロード方式（MVP＝サーバー経由）**: `POST /ideas/{id}/attachments`・`POST /chat-messages/{id}/attachments` に `multipart/form-data`。サーバーが検証（サイズ/MIME/件数）→ MinIO へ put → `attachments` 行を作成。
  - 将来: MinIO 直 PUT の**署名付きアップロード URL 発行**（`POST /attachments/presign`）へ拡張可（設計余地を残す）。
- **ダウンロード**: `GET /attachments/{id}/download` が**権限検証（パーティー内）後に署名付き GET URL へ 302**（or URL を JSON で返す）。TTL 短め。
- **画像/アバター/背景/クエストアイコン/会社アイコン**も同様に MinIO（それぞれ `users.background_image_path`・`quests.icon_image_path`・`companies.icon_image_path`）。

### 1.11 全文検索（PGroonga）

- 会社DB の **PGroonga** で `ideas`（件名/本文/価値/備考）＋`chat_messages`（本文）＋`attachments.original_name` を横断検索（データモデル §6・§8-④）。
- **`GET /search`**（クエスト内スコープは `GET /quests/{id}/search`）: `?q=`・`?types=idea,chat,attachment`（既定 all）。**結果は種別バッジ＋所属アイデア＋ハイライトスニペット**（SC-12）。ヒットは親（アイデア=SC-22 / チャット・添付=SC-24）への導線 ID を含む。

### 1.12 リアルタイム・通知配信

- MVP は**アプリ内通知のポーリング**（`GET /notifications`＋未読数 `GET /notifications/unread-count`＝ヘッダーベルのバッジ）。**外部通知（メール等）とリアルタイム（WS/SSE）は将来**（設計上ブロックしない）。

### 1.13 ユーザ同期（accounts→users アウトボックス）との関係

- **アカウントの発行/編集/無効化/PWリセット/本人プロフィール編集は管理DB `accounts` が源泉**。API は `accounts` を更新するのと**同一Tx で `account_sync_outbox` に 1 行 INSERT**（データモデル §4.6・§8-①）。会社DB `users` のミラー列はワーカが冪等反映するため、**API は会社DB の `users.login_id/email/status/...` を直接更新しない**。
- 会社DB `users` の一覧・表示はミラー列で完結（管理DBへの往復なし）。

---

## 2. エンドポイント一覧（ドメイン別＝分割レビューの単位）

> 以下は**分割レビューの割当と代表エンドポイントの目次**。各ドメインを 1 セッション（or 数ターン）で req/res・権限・エラー・画面対応まで詳細化し、都度ユーザー承認のうえコミットする（handoff の 2 段コミット運用）。「詳細確定」列が済んだドメインから OpenAPI に落とす。

| # | ドメイン | 主対象画面 | プレーン | 詳細確定 |
| --- | --- | --- | --- | --- |
| A | 認証・セッション | SC-00 | コントロール | ⬜ |
| B | 会社・アカウント・所属（運営/QG管理） | SC-90/91/92 | コントロール | ⬜ |
| C | クエスト・パーティー・権限 | SC-10/11/12 | テナント | ⬜ |
| D | アイデア・添付・版・投票・フォロー | SC-21/22 | テナント | ⬜ |
| E | チャット・リアクション・魔法発動 | SC-24 | テナント | ⬜ |
| F | 評価 | SC-25/22 | テナント | ⬜ |
| G | ゲーミフィケーション（ショップ/装備/魔法/実績/ランキング/XP・コイン・SP） | SC-30/31/32/40/41 | テナント | ⬜ |
| H | 通知 | SC-02 | テナント | ⬜ |
| I | ダッシュボード集約 | SC-01 | テナント | ⬜ |
| J | 全文検索 | SC-12 | テナント | ⬜ |
| K | プロフィール・背景画像 | 共通ヘッダー | テナント | ⬜ |

### A. 認証・セッション（コントロールプレーン）
`POST /auth/login`・`POST /auth/mfa/verify`・`POST /auth/mfa/resend`・`POST /auth/logout`・`POST /auth/logout-all`・`GET /auth/session`・`POST /auth/password-setup/verify`・`POST /auth/password-setup/complete`（詳細＝§1.4）。

### B. 会社・アカウント・所属（system_admin／quest_group_admin）
- 会社（運営・SC-91/92）: `GET/POST /admin/companies`・`GET/PATCH /admin/companies/{id}`（設定フラグ `vote_anonymized`/`hide_voters_from_managers`/`mfa_required`・`color`/`icon`）・（プロビジョニング系は MVP 手動＝§8-⑫、API 化は将来）。
- アカウント（SC-90/92）: `GET/POST /admin/companies/{id}/accounts`・`PATCH /admin/.../accounts/{id}`（編集・ロール）・`POST /.../accounts/{id}/disable`・`/enable`（論理削除⇄復活）・`POST /.../accounts/{id}/password-reset`（再設定リンク再送）。※すべて accounts 更新＋outbox（§1.13）。
- 所属（クエストグループ割当）: 会社DB `quest_group_members` に対して実施（§8-①）。QG管理者は自グループのみ、admin 付与/剥奪は system_admin のみ（SC-90 §9）。

### C. クエスト・パーティー・権限
`GET /quests`（所属グループ×参加中・FR-15）・`POST /quests`・`GET/PATCH /quests/{id}`・`DELETE /quests/{id}`（論理削除＝owner/quest_admin）・`POST /quests/{id}/publish`（下書き→公開）・カテゴリ/カラー/アイコン・パーティー `POST/DELETE /quests/{id}/members`・権限 `PUT /quests/{id}/members/{user_id}/permissions`・クエストグループ `GET /quest-groups`。

### D. アイデア・添付・版・投票・フォロー
`GET /quests/{id}/ideas`・`POST /quests/{id}/ideas`・`GET/PATCH /ideas/{id}`・`DELETE /ideas/{id}`（論理削除＝投稿者本人＋管理）・`POST /ideas/{id}/publish`（下書き→公開＋投稿XP＋チャットグループ自動作成）・添付（§1.10）・版 `GET /ideas/{id}/revisions`＋差分（FR-34）・投票 `POST /ideas/{id}/vote`（賛成/反対/取消・冪等・+5XP・匿名/記名は表示制御）・フォロー `POST/DELETE /ideas/{id}/follow`。

### E. チャット・リアクション・魔法発動
`GET /ideas/{id}/chat`（=chat_group メッセージ）・`POST /chat-messages`・`PATCH/DELETE /chat-messages/{id}`（本人編集/論理削除）・メンション・添付・通常リアクション `POST/DELETE /chat-messages/{id}/reactions`（絵文字・複数可）・魔法リアクション（1メッセージ1魔法・各魔法1チャット1回＝FR-33・reactions ユニーク制約）。

### F. 評価
`GET /ideas/{id}/evaluation`（自分の・結果集計）・`PUT /ideas/{id}/evaluation`（下書き保存/確定＝`status` draft/submitted・5観点＋観点別コメント＋総評必須〔確定時〕＋公開範囲 `visibility`）・確定でコイン確定（評価締切一括＝§8-⑥）。

### G. ゲーミフィケーション
ショップ `GET /items`・`POST /items/{id}/purchase`（残高/価格サーバー検証・コイン消費）／装備 `GET /me/items`・`PUT /me/equipment`（5スロット・部分ユニーク）／魔法 `GET /spells`・`GET /me/spells`・`POST /spells/{id}/unlock`（SP消費・系統前提チェック）／実績 `GET /achievements`・`GET /me/achievements`／ランキング `GET /rankings`（`?period=this_week|last_week|this_month|all`・`?scope=company|quest:{id}`・スコア=XP＋コイン）／XP・コイン・SP 履歴 `GET /me/activities`。

### H. 通知
`GET /notifications`（種別/状態フィルタ）・`GET /notifications/unread-count`・`POST /notifications/{id}/read`・`POST /notifications/read-all`。

### I. ダッシュボード集約（SC-01）
`GET /dashboard`（下書き〔クエスト/アイデア/評価〕・未投票アイデア・参加中クエスト・フォロー中アイデア・週間ランキングTOP3＋自分・ヒーロー〔Lv/XP/コイン/SP〕・最近の通知を 1 レスポンスに集約 or 分割かは分割レビューで決定＝SC-01 §10 の未決）。

### J. 全文検索
`GET /search`・`GET /quests/{id}/search`（§1.11）。

### K. プロフィール・背景画像
`GET/PATCH /me`（プロフィール・`login_id`/`email` は accounts 源泉→outbox）・`PUT /me/background-image`・`DELETE /me/background-image`（MinIO）。

---

## 3. 次アクション

1. **ドメイン A（認証・セッション）から分割レビュー**で詳細化（req/res スキーマ・状態遷移・エラー・SC-00 対応）→ ユーザー承認 → コミット。
2. 以降 B→C→…→K の順で詳細化（依存の少ない順に前倒し可）。
3. 詳細確定したドメインから **FastAPI + Pydantic スキーマ / OpenAPI** に落とし込み（実装スキャフォールドフェーズと接続）。
