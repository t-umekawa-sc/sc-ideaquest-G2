# API 設計

> ideaquest の HTTP API 設計。**本 README の第1章（API 全体規約）を「全体設計」として先に確定**し、第2章のドメイン別エンドポイントを**分割レビュー**で順に詳細化する方針（2026-07-21 合意）。詳細確定したドメインは**このディレクトリ配下の個別ファイル**（`A_認証・セッション.md` 等）に切り出す（2026-07-27 ファイル分割方針・`screens/` と同じ発想）。
> 仕様の本体は `doc/要件定義/README.md`（唯一の要件定義書）、データ構造は `doc/データモデル.md` を参照。本ファイルはその API 展開。**全フィールドを網羅する機械可読仕様は OpenAPI 3.1（SoT・§1.1）側**であり、本ディレクトリは*設計意図・req/res の形・エラー・画面対応をレビューするための人間向けドキュメント*。

- 最終更新: 2026-07-29
- 対象フェーズ: **API 設計フェーズ＝ドメイン別分割レビュー進行中（全体設計＝確定・実装前）**
- スタイル: **REST / JSON ＋ OpenAPI**（FastAPI 自動生成の OpenAPI をソースオブトゥルースに）
- 関連: `doc/データモデル.md`（テーブル/Enum）・`doc/画面設計/screens/SC-*.md`（各画面の「API」節）・各 `mocks/SC-*.html`（mock API 注記）

---

## 0. 前提・アーキテクチャ

- **1 デプロイ構成**: Web(リバプロ)1 ＋ フロント(Next.js)1 ＋ バックエンド(FastAPI)1 ＋ 管理DB(PostgreSQL)1 ＋ 会社DB N ＋ MinIO 1 ＋ Redis 1。
- **2 層 DB**: ①管理DB（コントロールプレーン＝認証/アカウント/会社/接続情報）②会社DB（データプレーン＝会社ごと物理分離、クエスト等の機密データ）。
- **動的ルーティング**: バックエンドは 1 つ。**ログイン時に管理DBで所属会社を判定し、以降のリクエストはセッションが持つ `company_id` からその会社DBへ動的に接続**（SQLAlchemy のエンジン/セッションを会社ごとに切替。§1.5）。
- **API の 2 系統**:
  - **コントロールプレーン API**（`/api/v1/auth/*`・`/api/v1/admin/*`）＝管理DB を操作（認証・会社/アカウント管理）。
  - **テナント API**（上記以外の `/api/v1/*`）＝セッションで確定した会社DB を操作（クエスト・アイデア・評価・チャット・ゲーム・通知）。

---

## 1. API 全体規約（＝全体設計・先に確定する部分）

### 1.1 スタイル・フォーマット

- **REST / JSON**。リクエスト/レスポンスボディは `application/json`（添付アップロードのみ `multipart/form-data`、§1.10）。
- **OpenAPI 3.1** を FastAPI が自動生成（`/api/v1/openapi.json`・`/api/v1/docs`）。**これを API 仕様のソースオブトゥルース**とし、本ディレクトリは設計意図・非自明な規約・画面との対応を残す（エンドポイントの網羅表は本ディレクトリのドメイン別ファイル＋OpenAPI）。
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

**フロー＝会社コードで会社特定 → login_id＋PW → （信頼端末なら OTP スキップ）→ メール OTP(MFA) → セッション発行**（データモデル §4.1〜4.4・SC-00・§8-②）。詳細は `A_認証・セッション.md`。

- **セッション**: ログイン成功でサーバーがセッションを発行し、**httpOnly + Secure + SameSite=Lax の Cookie**（`iq_session`）に格納。セッション実体は **Redis の TTL ストア**（`company_id`・`account_id`・`system_role` 等を保持＝以降の会社DBルーティングと認可に使用。データモデル §8-⑨＝Redis 基本で確定・OTP チャレンジ／pre-auth トークンも同一 Redis）。
  - **CSRF＝ダブルサブミット Cookie ＋ Origin/Sec-Fetch 検証の両方併用（確定）**: 状態変更系（POST/PUT/PATCH/DELETE）は (a) 非 httpOnly Cookie `iq_csrf` とリクエストヘッダ `X-CSRF-Token` の一致、かつ (b) `Origin`/`Sec-Fetch-Site` が同一サイト、の**両方**を満たすことを要求。どちらか欠落・不一致は **403 `csrf_failed`**。
  - ※ ネイティブ/外部クライアント将来対応時は `Authorization: Bearer <token>` も受理できる設計にするが、MVP は Cookie セッションを基本とする。
- **列挙耐性**: `login`/OTP 失敗はアカウント有無を区別しない一律メッセージ＋レート制限（SC-00 の方針）。会社コード不正・login_id 不在も同様に曖昧化。`company_suspended` は資格情報照合成功後に判定（会社コードの存在を漏らさない）。
- **セッション固定・失効ルール（横断）**: 認証成功時は常に新規セッションID を発行。**ロール（`system_role`）変更・アカウント無効化(disable)・PW 変更/再設定でサーバーが該当アカウントの全セッション破棄＋信頼端末失効を強制**（詳細＝`A_認証・セッション.md` §A.9。トリガはドメイン B／A）。無操作タイムアウト＋絶対有効期限を併用。
- **監査列の自動設定**: `created_by_id`/`updated_by_id`/`*_program` 等の共通監査列（データモデル §2.1）は**サーバーがセッションから設定**（クライアントは送らない・送っても無視）。認証イベント（ログイン成功/失敗・MFA・logout・PW変更・ロール変更）は**セキュリティ監査ログ**に記録（PW/セッションID/OTP/トークンは出力しない・§A.9-⑥）。

### 1.5 会社DB 動的ルーティング（マルチテナント）

- テナント API では**セッションの `company_id` からその会社の DB エンジン/セッションを解決**し、リクエストスコープに束縛する（FastAPI 依存性 `Depends(get_tenant_session)`）。**接続情報は `.env`／`db_identifier` から解決**（データモデル §4.1）、会社ごとにコネクションプール（or PgBouncer・§8-⑫）。
- **クロステナントアクセス禁止**: パスやボディに `company_id` を受け取らない（常にセッション由来）。管理者（system_admin）が別会社を操作する `admin` API のみ、対象会社を明示（§ 第2章 B）。
- 会社が `suspended`（メンテ中）の場合、一般ユーザのテナント API は 503 相当（`company_suspended`）。system_admin の管理操作は可。

### 1.6 認可（ロール・権限）

- **システムロール（`system_role`）**: `system_admin`（運営＝全社・会社設定/プロビジョニング/ロール付与）/ **`company_account_admin`（会社アカウント管理者＝自社全アカウントの発行/無効化/identity/PW・会社設定は不可・§8-⑯）** / `general` の 3 値（会社/全社スコープの役割）。管理 API の門番＝`/admin/companies/*` は `system_admin`／`/admin/accounts/*` は `company_account_admin`（セッション会社固定）。ロール付与（`system_admin`/`company_account_admin`/`admin`）は system_admin のみ。
- **クエストグループ管理者（QG管理者）**: `system_role` では表さず、**会社DB `quest_group_members.role=admin`（per-group）で表現**（B案・2026-07-27 決定＝二重定義の解消）。QG向け管理 API（`/admin/quest-groups/*`）は**セッションユーザーが対象グループに有効な `admin` 所属（`removed_at IS NULL`）を持つか**で門番（会社DB 判定）。`admin` の付与/剥奪は system_admin のみ（SC-92）。
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
- 代表 `code`: `unauthenticated`(401) / `forbidden`(403) / `csrf_failed`(403) / `not_found`(404) / `validation_error`(422) / `conflict`(409) / `rate_limited`(429) / `company_suspended`(503) / `mfa_required`(200相当のログイン継続) / `idempotency_replayed`。

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

### 1.12 リアルタイム配信（WebSocket・2026-07-21 決定）

**トランスポート＝WebSocket の単一多重接続**（クライアント1本の WS で複数トピックを多重化）。用途＝**チャット（新着メッセージ・リアクション・魔法エフェクト・編集/削除）と通知（新着・未読数）の即時反映**（SC-24・SC-02＋ヘッダーベル）。ダッシュボード等は対象外（表示時取得/再取得）。

- **書き込みは REST 維持・WS は配信専用**（重要）: 全ての変更は通常の REST（router→application→domain→repository）を通し、権限・業務検証・冪等を経る（コーディング規約 §1/§3.1）。**WS を書き込み経路にしない**（ドメイン層の迂回禁止）。WS は receive-only（＋購読制御メッセージのみ）。
  ```
  書き込み: client ──REST──> application(検証/永続化/元帳) ──> Redis へ event 発行
  配信:     application ─event→ Redis Pub/Sub ─> WS ハブが購読 ─(WS)→ 対象クライアント
  ```
- **fan-out backbone ＝ Redis Pub/Sub**（セッション/OTP と同じ Redis を流用）。API・outbox ワーカ・複数インスタンス跨ぎでも配信可（水平スケール時も WS ハブが Redis を購読して転送）。
- **エンドポイント**: `GET /realtime`（WS ハンドシェイク）。**認証＝既存 httpOnly Cookie セッション**（§1.4）をハンドシェイクで検証（未認証は 401 でクローズ）。接続は**セッションの `company_id` にバインド**（クロステナント配信を物理的に遮断）。
- **多重化とトピック購読**: 1 本の WS 上でメッセージにトピックを付与。
  - **常時購読**: `notifications:{user_id}`（新着通知・未読数）。接続時に自動購読。
  - **動的購読**: チャット部屋 `chat:{chat_group_id}` を、クライアントが `{ "op": "subscribe", "topic": "chat:{id}" }` / `unsubscribe` で開閉（SC-24 を開いた時に購読・離脱で解除）。**サーバーは購読要求時にそのユーザーの閲覧権限（パーティー内）を検証**してから購読を許可。
  - メッセージ形（サーバー→クライアント）: `{ "topic": "...", "type": "chat.message.created|chat.reaction.added|chat.message.updated|chat.message.deleted|notification.created|notification.unread_count", "data": {...}, "id": "<event_id>" }`。**`type` は機械可読**、`data` は該当リソースの表示用ペイロード。
- **順序・再接続・取りこぼし対策**: 切断中の欠落は**REST を正**として補う（再接続時にチャットは `GET /ideas/{id}/chat?after=<cursor>`、通知は `GET /notifications` と未読数で再同期）。WS は「速報」・REST は「真実」。将来 `Last-Event-ID` 相当の再送を検討。
- **プレゼンス/タイピング表示は将来**（同 WS 上で拡張可能な設計にしておく）。**外部通知（メール等）も将来**（i18n の通知テンプレは §1.13/コーディング規約 §2.1）。
- **ポーリング併用（フォールバック）**: WS 未接続時やベルの初期表示は `GET /notifications/unread-count`／`GET /notifications` で取得（WS はあくまで push の上乗せ）。
- **ops**: リバプロで WS Upgrade を許可（`Connection: upgrade`）。アイドル接続の ping/pong ハートビート。

### 1.13 ユーザ同期（accounts→users アウトボックス）との関係

- **アカウントの発行/編集/無効化/PWリセット/本人プロフィール編集は管理DB `accounts` が源泉**。API は `accounts` を更新するのと**同一Tx で `account_sync_outbox` に 1 行 INSERT**（データモデル §4.6・§8-①）。会社DB `users` のミラー列はワーカが冪等反映するため、**API は会社DB の `users.login_id/email/status/...` を直接更新しない**。
- 会社DB `users` の一覧・表示はミラー列で完結（管理DBへの往復なし）。

### 1.14 Redis に保持するデータ一覧（用途・キー・TTL・更新/無効化するエンドポイント）

Redis（1 インスタンス・§1.4/§1.12）に載る情報を**一元管理**する。**目的＝(1) 何を Redis に持つかを明示、(2) その情報を書き込む/無効化するエンドポイントを対応づける**（分散した記述の一覧化）。**キー名は例**（実装時に接頭辞規約を確定）。

| データ | Redis キー（例） | 保持内容 | TTL | 書き込み/無効化する契機（エンドポイント） |
| --- | --- | --- | --- | --- |
| 本セッション | `session:{sid}` | `account_id`/`company_id`/`company_code`/`system_role`/`locale`/`user`（A.6）＋認証メタ・CSRF 紐付け | アイドル延長＋絶対有効期限（§A.8） | 作成=`POST /auth/login`・`POST /auth/mfa/verify`／削除=`POST /auth/logout`・`logout-all`／**強制失効**=ロール変更・`disable`・PW 変更/再設定（A.9-③・B.2） |
| pre-auth トークン | `preauth:{tid}` | `account_id`/`company_id`/`otp_challenge_id`（未MFA中間状態・最小権限） | 既定 10 分（§A.8） | 作成=`POST /auth/login`（要MFA分岐）／消費・削除=`POST /auth/mfa/verify`・期限切れ |
| OTP チャレンジ | `otp:{cid}` | コードのハッシュ・試行回数・宛先マスク（データモデル §4.4・§8-⑨） | 10 分 | 作成=`login`（要MFA）・`POST /auth/mfa/resend`／消費=`mfa/verify` |
| **会社コンフィグ（キャッシュ）** | `company_config:{company_id}` | `status`／`vote_anonymized`／`hide_voters_from_managers`／`mfa_required`／`db_identifier`（管理DB `companies` のミラー） | 短 TTL（既定 60 秒目安・実装時確定）＋**明示無効化** | **充填**=会社解決時（§1.5・キャッシュミス時に `companies` から読む）／**更新・無効化**=`PATCH /admin/companies/{id}`・`PATCH /admin/companies/{id}/settings`・会社 `active`/`suspend` 化（B.1） |
| レート制限カウンタ | `ratelimit:{scope}` | 失敗回数・ロック状態（§A.8） | 窓/ロック時間 | `POST /auth/login`・`POST /auth/password-setup/request` 等の失敗計上時 |
| 冪等キー結果 | `idem:{key}` | `Idempotency-Key` 単位の最初の結果（再送で再生＝`idempotency_replayed`・§1.9） | 短期（実装時確定） | 非冪等 POST（アイデア投稿・クエスト作成・購入・評価確定・魔法解放・投票 等）の初回実行時に保存 |
| リアルタイム配信（Pub/Sub・キャッシュではない） | ch `notifications:{user_id}`・`chat:{chat_group_id}` | イベント fan-out（§1.12） | —（購読中のみ） | 発行=書込側（D/E/H）の application が REST 処理内で publish |

- **反映タイミングの原則（会社コンフィグ）**: 設定は**セッションに焼き込まない**（A.6 に含めない＝再ログイン不要）。`PATCH` 成功時に**同一処理で `company_config:{company_id}` を更新（または削除して次回充填）**するため、**ログイン中ユーザーにも次リクエストから即時反映**（例＝投票匿名化 ON/OFF の切替は、次に `GET /ideas/{id}` 等を取得した時点で表示が切り替わる・ドメイン D.1/D.5）。`mfa_required` はログインフロー時に参照＝**次回以降のログイン**に効く（既存セッションはゲート通過済みで影響なし）。
- **`db_identifier` の同居**: 会社DB 動的ルーティング（§1.5）の解決も `company_config` から賄える（会社ごとに管理DBへ都度問い合わせない）。`company_code→company_id` の対応は不変寄りのため長 TTL 別キャッシュ可。
- **キャッシュ無効化の責務**: 会社設定・状態を変える**すべての書き込み経路**（B.1）が、成功時に対象 `company_id` のキャッシュ更新/無効化を行う（コーディング規約 §3.4＝application が副作用の殻で実施）。取りこぼすと**古い設定で表示/判定される**ため、B.1 の各エンドポイントに反映義務を明記（下記相互参照）。

---

## 2. エンドポイント一覧（ドメイン別＝分割レビューの単位）

> 各ドメインを 1 セッション（or 数ターン）で req/res・権限・エラー・画面対応まで詳細化し、都度ユーザー承認のうえコミットする（handoff の 2 段コミット運用）。**詳細確定したドメインは個別ファイルへ切り出し**、下表からリンクする。未着手のドメインはここに代表エンドポイントの目次だけを置く。「詳細確定」列が済んだドメインから OpenAPI に落とす。

| # | ドメイン | 主対象画面 | プレーン | 詳細確定 | ファイル |
| --- | --- | --- | --- | --- | --- |
| A | 認証・セッション | SC-00 | コントロール | ✅ | [`A_認証・セッション.md`](./A_認証・セッション.md) |
| B | 会社・アカウント・所属（運営/QG管理） | SC-90/91/92 | コントロール＋テナント | ✅ | [`B_会社・アカウント・所属.md`](./B_会社・アカウント・所属.md) |
| C | クエスト・パーティー・権限 | SC-10/11/12 | テナント | ✅ | [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md) |
| D | アイデア・添付・版・投票・フォロー | SC-21/22 | テナント | ✅ | [`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md) |
| E | チャット・リアクション・魔法発動 | SC-24 | テナント | ⬜ | （目次＝§2-E） |
| F | 評価 | SC-25/22 | テナント | ⬜ | （目次＝§2-F） |
| G | ゲーミフィケーション（ショップ/装備/魔法/実績/ランキング/XP・コイン・SP） | SC-30/31/32/40/41 | テナント | ⬜ | （目次＝§2-G） |
| H | 通知 | SC-02 | テナント | ⬜ | （目次＝§2-H） |
| I | ダッシュボード集約 | SC-01 | テナント | ⬜ | （目次＝§2-I） |
| J | 全文検索 | SC-12 | テナント | ⬜ | （目次＝§2-J） |
| K | プロフィール・背景画像 | 共通ヘッダー | テナント | ⬜ | （目次＝§2-K） |
| L | リアルタイム配信（WebSocket） | SC-24/SC-02 | テナント | ⬜ | （目次＝§2-L） |

### A. 認証・セッション（コントロールプレーン）＝詳細確定
→ **[`A_認証・セッション.md`](./A_認証・セッション.md)**（状態機械・Cookie/トークン・8 エンドポイントの req/res・エラー・SC-00 対応）。

### B. 会社・アカウント・所属（system_admin＝全社／会社アカウント管理者＝自社アカウント／QG管理者＝参加選択）＝詳細確定
→ **[`B_会社・アカウント・所属.md`](./B_会社・アカウント・所属.md)**。決定＝**①ロール別パス分離**（system_admin=`/admin/companies/{company_id}/...`／会社アカウント管理者=`/admin/accounts/...`〔セッション会社固定〕／QG管理者=`/admin/quest-groups/{group_id}/...`＋`/admin/company-directory`）**②B案ロールモデル**（QG管理者は `quest_group_members.role=admin` で表現・§1.6）**③発行時の初期所属を outbox に相乗**（会社DBでusers→memberships upsert・FK順序保証）**④SC-92 は SC-90 の上位互換**（無効化/PW再設定を全社範囲でも）**⑤ブートストラップ＝運営テナント seed＋最初の system_admin**（B.5.1・データモデル §8-⑮）＝「会社レス」アカウントは非採用（案A・`accounts.company_id` は `NOT NULL`）・system_admin は予約会社〔例 `OPS`〕に収容し認可は role で判定・運営テナントと最後の system_admin は削除/無効化不可**⑥職務分離（SoD・§8-⑯）＝会社アカウント管理者（`company_account_admin`）を新設**（自社全アカウントの発行/無効化/identity/PW・会社設定/ロール付与は不可）し、**QG管理者は「参加選択専任」に縮小**（自社ディレクトリ参照＋既存垢の per-group 参加追加/除外のみ・破壊系なし）＝会社DBアカウント参照の緩和と両立させても権限昇格を構造的に遮断。ロール付与（`system_admin`/`company_account_admin`/`admin`）は system_admin のみ。ロール変更・disable でセッション破棄＋信頼端末失効（§A.9-③）、権限変更履歴を `system_audit_logs` に記録（2-⑬）。

### C. クエスト・パーティー・権限（テナント）＝詳細確定
→ **[`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)**。決定＝**①パーティー所属を門番に**（非パーティーは 404・可視範囲＝パーティー内）**②クエスト内 6 権限をサーバー強制**（`owner` 付与は作成者のみ・作成者は剥奪不可・新規既定＝vote/idea_create/comment）**③パーティー編集は一括差分 `PUT /quests/{id}/party`＋増分 `POST/DELETE /members`・`PUT /members/{user_id}/permissions` を両立**（SC-11 モーダル保存に対応）**④`quest_group_id` は作成時のみ・以後不変**（参照範囲/既存アイデア整合の保護）**⑤状態機械を前進のみサーバー強制**（`draft→recruiting→in_progress→evaluating→completed`・完了で書き込み凍結）**⑥クエスト公開に XP は付与しない**（canonical XP 表に無い＝SC-11 の「作成 XP」表現は要修正）。主エンドポイント＝`GET /quests`（所属グループ×参加中・FR-15）・`POST /quests`・`GET/PATCH/DELETE /quests/{id}`（DELETE=論理削除 owner/quest_admin）・`POST /quests/{id}/publish`・`POST /quests/{id}/transition`・パーティー `PUT /quests/{id}/party`／`POST/DELETE /quests/{id}/members`／`PUT /quests/{id}/members/{user_id}/permissions`・候補 `GET /quest-groups`・`GET /quest-groups/{id}/members`。クエスト内ランキングは G、全文検索は J、通知発火は H を参照。

### D. アイデア・添付・版・投票・フォロー（テナント）＝詳細確定
→ **[`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)**。決定＝**①門番＝パーティー所属**（非パーティー・下書き他人は 404・可視範囲＝パーティー内）**②公開処理は published になる瞬間に 1 回**（`chat_groups` 自動作成＋投稿 XP+50〔日次上限外〕・公開は一方向）**③投票は `POST /ideas/{id}/vote {type}`〔登録/切替〕＋`DELETE /ideas/{id}/vote`〔取消〕**（冪等 upsert・**XP+5 は各アイデア初回のみ・日次上限**・押し直しで陳腐化解消・匿名/記名は表示のみ制御）**④公開後の全保存で 1 版**（`idea_revisions` スナップショット・差分は表示時算出・投票者/フォロワーへ `idea_updated` 通知）**⑤削除は論理削除**（投稿者本人＋owner/quest_admin）**⑥添付は `POST /ideas/{id}/attachments`〔multipart・§1.10〕**（20MB/10件/allowlist をサーバー検証・物理名ハッシュ・DL は署名 URL）。主エンドポイント＝`GET /quests/{id}/ideas`・`GET /ideas/{id}`・`POST /quests/{id}/ideas`・`GET/PATCH/DELETE /ideas/{id}`・`POST /ideas/{id}/publish`・添付 `POST/DELETE /ideas/{id}/attachments`・`GET /attachments/{id}/download`・版 `GET /ideas/{id}/revisions`＋`/{revision}/diff`・投票 `POST/DELETE /ideas/{id}/vote`・フォロー `POST/DELETE /ideas/{id}/follow`。評価結果は F、議論アクティビティ・グラフとチャットプレビューは E、通知発火は H を参照。

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
`GET/PATCH /me`（プロフィール・`login_id`/`email`/`locale` は accounts 源泉→outbox）・`PUT /me/background-image`・`DELETE /me/background-image`（MinIO）。
- **セキュリティ（A.9 委譲分）**: **認証済みユーザーの自己 PW 変更＝現在の PW 再確認**（セキュリティ一覧 1-㉒）／**email・MFA 設定変更時は再認証**（同 1-㉓）を設計する（`A_認証・セッション.md` §A.9-⑦）。

### L. リアルタイム配信（WebSocket）
`GET /realtime`（WS ハンドシェイク・Cookie セッション認証・`company_id` バインド）。常時購読 `notifications:{user_id}`／動的購読 `chat:{chat_group_id}`（`subscribe`/`unsubscribe`・購読時に閲覧権限検証）。配信専用（書き込みは各ドメインの REST）。イベント種別・ペイロード・再接続再同期は §1.12。**書き込み側（D/E/H）の application が Redis へ event を発行する連携点**を各ドメイン詳細で規定。

---

## 3. 次アクション

1. **E→…→L の順で分割レビュー**（依存の少ない順に前倒し可・L は D/E/H の event 発行点と併せて確定）。詳細化した各ドメインは `X_ドメイン名.md` に切り出し、上表からリンク＋「詳細確定」を ✅。
2. **次の着手＝ドメイン E（チャット・リアクション・魔法発動／SC-24）**。※ドメイン D が参照する議論アクティビティ・グラフ（`GET /ideas/{id}/chat-activity`）とチャットプレビューは E で確定する。
3. 詳細確定したドメインから **FastAPI + Pydantic スキーマ / OpenAPI** に落とし込み（実装スキャフォールドフェーズと接続）。
