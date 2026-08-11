# テストパターン B. 会社・アカウント（account_sync_outbox ミラー＋アカウント管理 API）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../データモデル.md`](../データモデル.md) §4.6（`account_sync_outbox`）・[`../API設計/README.md`](../API設計/README.md) §1.8/§1.13・[`../API設計/B_会社・アカウント・所属.md`](../API設計/B_会社・アカウント・所属.md) B.0.1/B.2/B.5。
> 本スライスの対象＝**outbox 機構の縦通し**（テーブル＋書込側の同一Tx INSERT＋常駐ワーカの冪等適用）。書込側＝A.7 `complete_password_setup`（`password_set` ミラー）と **login 成功（`last_login_at` ミラー・B-TC-006・2026-08-11 追加）**。発行/編集/無効化（B.2）・プロフィール編集（K）の writer は該当エンドポイント実装時に追加する。
> ワーカ本体＝`app/control_plane/account_sync/application.py` の `process_outbox_once()`（worker.py がループで呼ぶ）。テストは本関数を直接呼ぶ（常駐プロセス不要）。

## 前提（共通フィクスチャ）

- §1「前提」は [`A_認証.md`](A_認証.md) と共通（seed 会社 ACME-01/02・factory）。
- 実 DB を持つ会社＝`factory.make_seed_company_account()`（ACME-01・会社DB あり）。**DB を持たない会社**＝`factory.make_company()`＋`make_account()`（`db_identifier` は実在しない＝ワーカの会社DB 接続が失敗する＝失敗系の検証に使う）。
- outbox 行は seq（挿入順の単調増加）昇順で取り出す。`op=upsert`・`payload={"password_set": true}`。

## 1. テストパターン一覧

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-001 | int | ACME-01 実アカウント＋有効 `password_setup` トークン | `POST /auth/password-setup/complete`（新PW）成功 | **accounts 更新と同一 Tx** で `account_sync_outbox` に **pending 1行**（`op=upsert`・`payload.password_set=true`・`company_id` 正） | データモデル §4.6／ADR-0002 §2.4 |
| B-TC-002 | int | B-TC-001 で pending 1行がある状態 | `process_outbox_once()` | 会社DB `users.password_set` が **true に upsert**され、行 `status=done`・`processed_at` 打刻 | §4.6（適用・消し込み） |
| B-TC-003 | int | 同一 account に upsert pending が **2行** | `process_outbox_once()` | 2行とも done、`users` は**1行のまま**（`account_id` キー upsert＝冪等・at-least-once 前提） | §4.6（冪等） |
| B-TC-004 | int | 会社DB が存在しない会社の pending 1行・`OUTBOX_MAX_ATTEMPTS=2` | `process_outbox_once()` を 2回 | 1回目 `attempts=1・status=pending`、2回目で **`status=failed`**（上限超＝要手動対応） | §4.6（リトライ/failed） |
| B-TC-005 | int | 会社DB 無し会社の account X に pending 2行（X1,X2）＋ ACME-01 の account Y に pending 1行（Y1） | `process_outbox_once()` | Y1 は **done**（別 account は独立に進む）／X1 は `attempts=1・pending`／**X2 は未処理（`attempts=0・pending`）**＝同一 account はヘッドオブライン・ブロッキング | §4.6（順序・HOL） |
| B-TC-006 | int | ACME-01 実アカウント（未ログイン＝`last_login_at` NULL） | `POST /auth/login` 成功 → `process_outbox_once()` | ログイン成功で **`accounts.last_login_at` 更新＋同一Tx で outbox pending 1行**（`op=upsert`・`payload.last_login_at`＝ISO 文字列）→ ワーカ適用で **会社DB `users.last_login_at` がミラー**される | データモデル §4.6／§5.3（認証イベント③） |

## 2. アカウント管理 API（B0＝認可基盤＋一覧・B.2/B.0.1）

> 対象＝`GET /admin/companies/{company_id}/accounts`（system_admin 専用・SC-92）。認可基盤（`/admin/*` の P1〜P6）とブートストラップ（B.5.1＝運営テナント OPS＋初期 system_admin を seed）の実証。**system_admin セッションは bootstrap が seed する OPS 管理者でログインして得る**（`ops_company_code`/`bootstrap_admin_login`/`bootstrap_admin_password`）。所属グループ（会社DB `quest_group_members`）付与・発行/編集/disable/enable/password-reset は後続スライス。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-010 | api | system_admin（OPS 管理者）でログイン | `GET /admin/companies/{ACME-01}/accounts` | `200`＋`{data, page_info}`。`page_info.total≥1`・ACME-01 の seed アカウントを含む・**`password_hash` 等の機密を返さない** | B.2／§1.8／§B.6 |
| B-TC-011 | api | セッション無し | 同 GET | `401 {code:"unauthenticated"}`（B.0.1 P1） | B.0.1 P1 |
| B-TC-012 | api | 非 system_admin（`general`）でログイン | 同 GET | `403 {code:"forbidden"}`（B.0.1 P6＝権限なしは 403） | B.0.1 P6 |
| B-TC-013 | api | system_admin | 存在しない `company_id` で GET | `404 {code:"not_found"}`（存在秘匿・§1.6） | B.2／§1.6 |
| B-TC-014 | api | system_admin | `?status=active&per_page=1&page=1`／`?q=…` | オフセットページング（`page_info.per_page/page/total`）＋`q`/`status` フィルタが効く | §1.8 |

**発行（`POST /admin/companies/{company_id}/accounts`・system_admin・B.2/B.5）**。memberships（会社DB `quest_group_members`）は本スライス非対応（別スライス）。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-020 | api | system_admin | 正しい `display_name/login_id/email` で `POST .../accounts` | `201`＋アカウント（`status=active`・`password_set=false`・機密非返却）。**accounts INSERT＋同一Tx で account_sync_outbox 1行（users ミラー）＋mail_outbox 1行（password_setup・secret 有）**→ `process_outbox_once()` で会社DB `users` 行が生成される | B.2／B.5／§4.6 |
| B-TC-021 | api | system_admin | 会社内で `login_id`／`email` が既存と重複 | `409 {code:"conflict"}`＋`errors[].field`（`login_id`/`email`） | B.2（会社内一意・§4.2） |
| B-TC-022 | api | 未認証／general | `POST .../accounts` | 未認証＝`401 unauthenticated`／general＝`403 forbidden`（B.0.1 P1/P6） | B.0.1 |
| B-TC-023 | api | system_admin・CSRF トークン無し | `POST .../accounts` | `403 {code:"csrf_failed"}`（変更系＝CSRF 必須・B.0.1 P3） | B.0.1 P3 |
| B-TC-024 | api | system_admin | 不明 `company_id`／不正 `system_role`（`quest_group_admin`）／想定外プロパティ | 不明会社＝`404 not_found`／enum 外・extra＝`422`（Mass Assignment 防止・§B.6） | B.2／§B.6 |

**状態管理（disable/enable/password-reset・`POST .../accounts/{id}/{op}`・system_admin・B.2）**。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-025 | api | 対象アカウントがログイン中（有効セッション） | `POST .../disable` | `200`＋`status=disabled`＋outbox（disable）。**対象の全アクティブセッション破棄＋信頼端末失効**＝対象の `GET /session` が 401（A.9-③） | B.2／A.9-③ |
| B-TC-026 | api | `disabled` のアカウント | `POST .../enable` | `200`＋`status=active`（outbox enable） | B.2 |
| B-TC-027 | api | 実アカウント | `POST .../password-reset` | `200 {status:"sent"}`＋**新 `password_setup` チャレンジ＋mail_outbox 1行**（旧リンク失効・A.7・非同期送信） | B.2／A.7 |
| B-TC-028 | api | 有効な system_admin が 1 名だけ（seed OPS 管理者） | その system_admin を `POST .../disable` | `422 {code:"last_system_admin"}`（0 名化の拒否・運営テナント保護・B.5.1） | B.2／B.5.1 |
| B-TC-029 | api | system_admin | 不明/他会社の `account_id` で `POST .../disable` | `404 not_found`（存在秘匿・§1.6） | B.2 |

**編集（`PATCH .../accounts/{id}`・system_admin・差分・B.2）**。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-030 | api | system_admin | `display_name`/`login_id` を差分 PATCH | `200`＋accounts 更新＋outbox（upsert・payload に変更列）＝users ミラー | B.2 |
| B-TC-031 | api | system_admin | 既存の別アカウントと `login_id`/`email` が重複する編集 | `409 conflict`＋`errors[].field`（自分は一意検証から除外） | B.2 |
| B-TC-032 | api | 対象がログイン中 | `system_role` を変更（general→company_account_admin） | `200`＋**対象の全セッション破棄**（新権限適用・A.9-③）＝対象の `GET /session` が 401 | B.2／A.9-③ |
| B-TC-033 | api | 自分（system_admin）を編集 | 自分の `system_role` を `general` に降格 | `422 last_system_admin`（自己降格は常に不可・自己ロックアウト防止） | B.2 |
| B-TC-034 | api | system_admin | 不正 `system_role`／想定外プロパティ／不明 account | enum 外・extra＝`422`／不明＝`404` | B.2／§B.6 |

**会社アカウント管理者（`/admin/accounts`・`company_account_admin`・セッション会社固定・B.2.1）**。system_admin は上位互換で可。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-040 | api | company_account_admin（ACME-01） | `GET /admin/accounts` | `200`＋**セッション会社（ACME-01）スコープ**の一覧（`company_id` を受けない） | B.2.1 |
| B-TC-041 | api | company_account_admin | `POST /admin/accounts` | `201`＋`system_role=general` 固定・セッション会社配下に作成 | B.2.1 |
| B-TC-042 | api | company_account_admin | ボディに `system_role`／system_admin を `disable` | `system_role` は受け取らない＝`422`（付与不可）／system_admin の disable は `403`（B.2.1・§8-⑯） | B.2.1 |
| B-TC-043 | api | general／system_admin | `GET /admin/accounts` | general＝`403`／system_admin＝`200`（上位互換） | B.2.1／B.0.1 |

- **red 確認（後追い）**＝ガード無効化で B-TC-011/012（200）・`verify_csrf` 無効化で B-TC-023（201）・`delete_account_sessions` 無効化で B-TC-025（session 401 にならない）・B-TC-028/033 は反転で 422 発火・`forbid_system_admin_target` 無効化で B-TC-042 が 200（system_admin を disable できてしまう）を確認。証跡＝[`red確認台帳.md`](red確認台帳.md)。

## 3. 補足・非対象

- **発行/編集/無効化（B.2・B.5）・プロフィール編集（K）の writer** は該当エンドポイント実装時に追加（`password_set`＝complete／`last_login_at`＝login は実装済み）。
- **初期所属 `memberships` の相乗適用**（B.5＝`users`→`quest_group_members` の順）は B ドメイン実装時（本スライスの payload は `password_set` のみ）。
- **メール送信の非同期化**は別機構（§4.6 outbox は DB ミラー専用）＝別スライス。
- ワーカの常駐ループ（`worker.py`）自体は疎通のみ＝TC 対象外（本体ロジックは `process_outbox_once` の int TC で担保）。
