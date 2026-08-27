# テストパターン B. 会社・アカウント（account_sync_outbox ミラー＋アカウント管理 API）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../データモデル.md`](../データモデル.md) §4.6（`account_sync_outbox`）・[`../API設計/README.md`](../API設計/README.md) §1.8/§1.13・[`../API設計/B_会社・アカウント・所属.md`](../API設計/B_会社・アカウント・所属.md) B.0.1/B.2/B.5。
> 本スライスの対象＝**outbox 機構の縦通し**（テーブル＋書込側の同一Tx INSERT＋常駐ワーカの冪等適用）。書込側＝A.7 `complete_password_setup`（`password_set` ミラー）と **login 成功（`last_login_at` ミラー・B-TC-006・2026-08-11 追加）**。発行/編集/無効化（B.2）・プロフィール編集（K）の writer は該当エンドポイント実装時に追加する。
> ワーカ本体＝`app/control_plane/account_sync/application.py` の `process_outbox_once()`（worker.py がループで呼ぶ）。テストは本関数を直接呼ぶ（常駐プロセス不要）。

## 前提（共通フィクスチャ）

- §1「前提」は [`A_認証.md`](A_認証.md) と共通（seed 会社 ACME-01/02・factory）。
- 実 DB を持つ会社＝`factory.make_seed_company_account()`（ACME-01・会社DB あり）。**DB を持たない会社**＝`factory.make_company()`＋`make_account()`（`db_identifier` は実在しない＝ワーカの会社DB 接続が失敗する＝失敗系の検証に使う）。
- outbox 行は seq（挿入順の単調増加）昇順で取り出す。`op=upsert`・`payload={"password_set": true}`。

## 1. account_sync_outbox（管理DB→会社DB `users` ミラー・§4.6）

> 対象＝**account_sync_outbox 機構の縦通し**（テーブル＋書込側の同一Tx INSERT＋常駐ワーカ `process_outbox_once` の冪等適用/リトライ/順序）。書込側 writer＝A.7 `complete`（`password_set`）／login 成功（`last_login_at`）／identity・role のミラー（§5.3）。前提＝seed 会社 ACME-01/02・factory（§前提）。仕様の正＝データモデル §4.6／§5.3。memberships の worker 適用は §4.2、発行/編集の enqueue 側は §4.3/§4.4。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-001 | int | accounts 更新と outbox 記録の原子性担保 | ACME-01 実アカウント＋有効 `password_setup` トークン | `POST /auth/password-setup/complete`（新PW）成功 | **accounts 更新と同一 Tx** で `account_sync_outbox` に **pending 1行**（`op=upsert`・`payload.password_set=true`・`company_id` 正） | データモデル §4.6／ADR-0002 §2.4 |
| B-TC-002 | int | ミラーの冪等 upsert と消し込みの確認 | B-TC-001 で pending 1行がある状態 | `process_outbox_once()` | 会社DB `users.password_set` が **true に upsert**され、行 `status=done`・`processed_at` 打刻 | §4.6（適用・消し込み） |
| B-TC-003 | int | at-least-once 前提での再適用冪等性 | 同一 account に upsert pending が **2行** | `process_outbox_once()` | 2行とも done、`users` は**1行のまま**（`account_id` キー upsert＝冪等・at-least-once 前提） | §4.6（冪等） |
| B-TC-004 | int | 恒久失敗の failed 遷移と手動対応境界 | 会社DB が存在しない会社の pending 1行・`OUTBOX_MAX_ATTEMPTS=2` | `process_outbox_once()` を 2回 | 1回目 `attempts=1・status=pending`、2回目で **`status=failed`**（上限超＝要手動対応） | §4.6（リトライ/failed） |
| B-TC-005 | int | 同一 account の HOL ブロッキングと account 間独立性 | 会社DB 無し会社の account X に pending 2行（X1,X2）＋ ACME-01 の account Y に pending 1行（Y1） | `process_outbox_once()` | Y1 は **done**（別 account は独立に進む）／X1 は `attempts=1・pending`／**X2 は未処理（`attempts=0・pending`）**＝同一 account はヘッドオブライン・ブロッキング | §4.6（順序・HOL） |
| B-TC-006 | int | ログイン成功の last_login_at ミラー縦通し | ACME-01 実アカウント（未ログイン＝`last_login_at` NULL） | `POST /auth/login` 成功 → `process_outbox_once()` | ログイン成功で **`accounts.last_login_at` 更新＋同一Tx で outbox pending 1行**（`op=upsert`・`payload.last_login_at`＝ISO 文字列）→ ワーカ適用で **会社DB `users.last_login_at` がミラー**される | データモデル §4.6／§5.3（認証イベント③） |
| B-TC-007 | int | identity/role 列の会社DB ミラー担保 | ACME-01 実アカウント（users ミラー行あり） | `login_id`/`email`/`system_role` を payload に upsert enqueue → `process_outbox_once()` | 会社DB `users.login_id`/`email`/`system_role` に**ミラー反映**（会社DB 単独でユーザ一覧を描画するための identity/role 列・§5.3） | データモデル §4.6／§5.3 |

## 2. アカウント管理 API（B0＝認可基盤＋一覧・B.2/B.0.1）

> 対象＝`GET /admin/companies/{company_id}/accounts`（system_admin 専用・SC-92）。認可基盤（`/admin/*` の P1〜P6）とブートストラップ（B.5.1＝運営テナント OPS＋初期 system_admin を seed）の実証。**system_admin セッションは bootstrap が seed する OPS 管理者でログインして得る**（`ops_company_code`/`bootstrap_admin_login`/`bootstrap_admin_password`）。所属グループ（会社DB `quest_group_members`）付与・発行/編集/disable/enable/password-reset は後続スライス。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-010 | api | 一覧の機密非開示とページング形の担保 | system_admin（OPS 管理者）でログイン | `GET /admin/companies/{ACME-01}/accounts` | `200`＋`{data, page_info}`。`page_info.total≥1`・ACME-01 の seed アカウントを含む・**`password_hash` 等の機密を返さない** | B.2／§1.8／§B.6 |
| B-TC-011 | api | 未認証アクセスの一律遮断 | セッション無し | 同 GET | `401 {code:"unauthenticated"}`（B.0.1 P1） | B.0.1 P1 |
| B-TC-012 | api | 非 system_admin の越権遮断 | 非 system_admin（`general`）でログイン | 同 GET | `403 {code:"forbidden"}`（B.0.1 P6＝権限なしは 403） | B.0.1 P6 |
| B-TC-013 | api | 存在しない会社の存在秘匿 | system_admin | 存在しない `company_id` で GET | `404 {code:"not_found"}`（存在秘匿・§1.6） | B.2／§1.6 |
| B-TC-014 | api | 検索/状態フィルタ/オフセットページングの実効性 | system_admin | `?status=active&per_page=1&page=1`／`?q=…` | オフセットページング（`page_info.per_page/page/total`）＋`q`/`status` フィルタが効く | §1.8 |

### 2.1 §1.8.1 DataTable クエリ契約の横展開（アカウント一覧・B.2）

> 会社一覧（§3 B-TC-126〜135）で実証した §1.8.1 契約を、共通パーサ（`app/control_plane/admin/list_query.py`）経由で
> アカウント一覧（`GET /admin/companies/{company_id}/accounts`・`GET /admin/accounts`）へ展開。検証データは factory の
> 専用会社＋アカウント（管理DB のみ・会社DB 不要）で決定的に作る。`group_id` フィルタ（会社DB `quest_group_members`）は所属スライス後。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-141 | api | 複数ソート（氏名昇順/降順） | 専用会社に display_name の異なる3件 | `?sort=display_name`／`-display_name` | キー順に昇順/降順（作成順でない・§1.8.1①） | §1.8.1①／B.2 |
| B-TC-142 | api | ソートキーのホワイトリスト検証 | 専用会社 | `?sort=password_hash` | `422 validation_error`（`errors[].field="sort"`） | §1.8.1①／§2.2 |
| B-TC-143 | api | status の enum 多値 OR | active/disabled を各1件 | `?status=disabled`／`=active,disabled` | 単値＝該当のみ／多値＝和集合（§1.8.1②） | §1.8.1②／B.2 |
| B-TC-144 | api | status enum 値のホワイトリスト検証 | 専用会社 | `?status=bogus` | `422 validation_error`（`errors[].field="status"`） | §1.8.1②／§2.2 |
| B-TC-145 | api | system_role の enum 多値フィルタ | general/company_account_admin を各1件 | `?system_role=company_account_admin` | 該当ロールのみ（§1.8.1②） | §1.8.1②／B.2 |
| B-TC-146 | api | system_role enum 値のホワイトリスト検証 | 専用会社 | `?system_role=root` | `422 validation_error`（`errors[].field="system_role"`） | §1.8.1②／§2.2 |
| B-TC-147 | api | ピン行のページ/絞込跨ぎ解決 | 専用会社に active1件＋disabled2件 | `?status=disabled&pin_ids=<active id>` | `pinned` に当該行（絞込外でも必ず解決・当該会社スコープ）／`data` からは除外／`page_info.total`＝非固定母集合のみ（§1.8.1④） | §1.8.1④／B.2 |
| B-TC-148 | api | pin_ids の形式検証 | 専用会社 | `?pin_ids=not-a-uuid` | `422 validation_error`（`errors[].field="pin_ids"`） | §1.8.1④／§2.2 |
| B-TC-149 | api | CSV エクスポート（同条件・全件・BOM・表示列） | 専用会社に display_name の異なる2件 | `?format=csv&columns=display_name,status&sort=display_name` | `200`＋`text/csv`＋`attachment`＋**UTF-8 BOM**。ヘッダ＝表示列ラベル・列順／同じ絞込・ソートの**全件**（§1.8.1③） | §1.8.1③／B.2 |
| B-TC-150 | api | 管理系 CSV エクスポートの監査記録 | 専用会社に1件 | `?format=csv` | `system_audit_logs` に `action=account.export` を**1件**（`detail.count`＝出力件数）（§1.8.1③・B.6） | §1.8.1③／B.6 |
| B-TC-151 | api | CSV 列のホワイトリスト検証 | 専用会社 | `?format=csv&columns=display_name,bogus` | `422 validation_error`（`errors[].field="columns"`） | §1.8.1③／§2.2 |

**red 確認（test-first）**＝B-TC-141〜151 は各機能の実装前に確認（未対応＝順序が作成順・未知キー/値が無視され 200・pinned 非返却・format=csv 無視で JSON 200）。証跡＝コミットメッセージ。

**発行（`POST /admin/companies/{company_id}/accounts`・system_admin・B.2/B.5）**。memberships（会社DB `quest_group_members`）は本スライス非対応（別スライス）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-020 | api | 発行の accounts・ミラー・メールの一貫生成 | system_admin | 正しい `display_name/login_id/email` で `POST .../accounts` | `201`＋アカウント（`status=active`・`password_set=false`・機密非返却）。**accounts INSERT＋同一Tx で account_sync_outbox 1行（users ミラー）＋mail_outbox 1行（password_setup・secret 有）**→ `process_outbox_once()` で会社DB `users` 行が生成される | B.2／B.5／§4.6／§4.7（mail_outbox）／ADR-0007 |
| B-TC-021 | api | 会社内 identity 一意の担保 | system_admin | 会社内で `login_id`／`email` が既存と重複 | `409 {code:"conflict"}`＋`errors[].field`（`login_id`/`email`） | B.2（会社内一意・§4.2） |
| B-TC-022 | api | 発行の認証・認可ガード | 未認証／general | `POST .../accounts` | 未認証＝`401 unauthenticated`／general＝`403 forbidden`（B.0.1 P1/P6） | B.0.1 |
| B-TC-023 | api | 変更系の CSRF 必須担保 | system_admin・CSRF トークン無し | `POST .../accounts` | `403 {code:"csrf_failed"}`（変更系＝CSRF 必須・B.0.1 P3） | B.0.1 P3 |
| B-TC-024 | api | Mass Assignment と enum 外入力の遮断 | system_admin | 不明 `company_id`／不正 `system_role`（`quest_group_admin`）／想定外プロパティ | 不明会社＝`404 not_found`／enum 外・extra＝`422`（Mass Assignment 防止・§B.6） | B.2／§B.6 |

**状態管理（disable/enable/password-reset・`POST .../accounts/{id}/{op}`・system_admin・B.2）**。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-025 | api | 無効化による全セッション即時失効 | 対象アカウントがログイン中（有効セッション） | `POST .../disable` | `200`＋`status=disabled`＋outbox（disable）。**対象の全アクティブセッション破棄＋信頼端末失効**＝対象の `GET /session` が 401（A.9-③） | B.2／A.9-③ |
| B-TC-026 | api | 再有効化の状態復帰 | `disabled` のアカウント | `POST .../enable` | `200`＋`status=active`（outbox enable） | B.2 |
| B-TC-027 | api | PW再設定の旧リンク失効と再送 | 実アカウント | `POST .../password-reset` | `200 {status:"sent"}`＋**新 `password_setup` チャレンジ＋mail_outbox 1行**（旧リンク失効・A.7・非同期送信） | B.2／A.7／§4.7（mail_outbox） |
| B-TC-028 | api | 最後の system_admin 無効化の拒否 | OPS テナント内の有効な system_admin が 1 名だけ（seed OPS 管理者） | その system_admin を `POST .../disable` | `422 {code:"last_system_admin"}`（0 名化の拒否・運営テナント保護・B.5.1） | B.2／B.5.1 |
| B-TC-029 | api | 範囲外アカウントの存在秘匿 | system_admin | 不明/他会社の `account_id` で `POST .../disable` | `404 not_found`（存在秘匿・§1.6） | B.2 |
| B-TC-170 | api | last_system_admin 保護は OPS スコープ（他社 system_admin を数えない） | 非 OPS 会社に active な system_admin が別途存在＋OPS 管理者は 1 名 | OPS 管理者を `POST .../disable` | `422 last_system_admin`（他社に system_admin が居ても OPS の最後の1人は保護＝会社横断カウントの抜けを修正・B.5.1） | B.2／B.5.1 |

**編集（`PATCH .../accounts/{id}`・system_admin・差分・B.2）**。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-030 | api | 編集差分のミラー反映 | system_admin | `display_name`/`login_id` を差分 PATCH | `200`＋accounts 更新＋outbox（upsert・payload に変更列）＝users ミラー | B.2 |
| B-TC-031 | api | 編集時の自己除外つき一意検証 | system_admin | 既存の別アカウントと `login_id`/`email` が重複する編集 | `409 conflict`＋`errors[].field`（自分は一意検証から除外） | B.2 |
| B-TC-032 | api | ロール変更時の権限再評価強制（全セッション破棄**＋信頼端末失効**） | 対象がログイン中＋**有効な信頼端末1件** | `system_role` を変更（general→company_account_admin） | `200`＋**対象の全セッション破棄**（対象の `GET /session` が 401）＋**信頼端末が全て `revoked`**（変更後の端末が MFA スキップを続けない・A.9-③） | B.2／A.9-③ |
| B-TC-033 | api | 自己降格による自己ロックアウト防止 | 自分（system_admin）を編集 | 自分の `system_role` を `general` に降格 | `422 last_system_admin`（自己降格は常に不可・自己ロックアウト防止） | B.2 |
| B-TC-034 | api | 編集の enum 外/不明対象の遮断 | system_admin | 不正 `system_role`／想定外プロパティ／不明 account | enum 外・extra＝`422`／不明＝`404` | B.2／§B.6 |

**会社アカウント管理者（`/admin/accounts`・`company_account_admin`・セッション会社固定・B.2.1）**。system_admin は上位互換で可。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-040 | api | 会社アカ管理者のセッション会社スコープ固定 | company_account_admin（ACME-01） | `GET /admin/accounts` | `200`＋**セッション会社（ACME-01）スコープ**の一覧（`company_id` を受けない） | B.2.1 |
| B-TC-041 | api | 会社アカ管理者発行の general 固定 | company_account_admin | `POST /admin/accounts` | `201`＋`system_role=general` 固定・セッション会社配下に作成 | B.2.1 |
| B-TC-042 | api | system_role 付与不可と system_admin 保護の担保 | company_account_admin | ボディに `system_role`／system_admin を `disable` | `system_role` は受け取らない＝`422`（付与不可）／system_admin の disable は `403`（B.2.1・§8-⑯） | B.2.1 |
| B-TC-043 | api | 会社アカ管理 API の権限帯と上位互換 | general／system_admin | `GET /admin/accounts` | general＝`403`／system_admin＝`200`（上位互換） | B.2.1／B.0.1 |
| B-TC-044 | api | 発行候補となる自社グループ一覧の提供 | company_account_admin（ACME-01）・ACME-01 にグループ seed | `GET /admin/company-quest-groups` | `200`＋**セッション会社（ACME-01）の全グループ**（`group_id`/`quest_group_code`/`name`/`member_count`）。所属エディタの候補。general＝`403` | B.2.1（2026-08-11 追加） |

- **red 確認（後追い）**＝ガード無効化で B-TC-011/012（200）・`verify_csrf` 無効化で B-TC-023（201）・`delete_account_sessions` 無効化で B-TC-025（session 401 にならない）・B-TC-028/033 は反転で 422 発火・`forbid_system_admin_target` 無効化で B-TC-042 が 200（system_admin を disable できてしまう）を確認。証跡＝[`red確認台帳.md`](red確認台帳.md)。

## 3. 会社 CRUD API（B.1・system_admin・SC-91/92）

> `/admin/companies`。作成は DBプロビジョニング MVP 手動＝`status=suspended` で管理DB 行を作るのみ。`group_count`（会社DB `quest_groups`）はドメインC実装時に付与（本スライスは `account_count` のみ）。設定の Redis `company_config` 無効化はキャッシュ未実装ゆえ現状 no-op（§1.14）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-050 | api | 会社一覧の集計付き取得 | system_admin | `GET /admin/companies` | `200`＋`{data, page_info}`・各行に `account_count`・seed 会社を含む | B.1／§1.8 |
| B-TC-051 | api | 会社作成の suspended 既定とコード正規化 | system_admin | `POST /admin/companies`（小文字 code） | `201`＋**`status=suspended`**＋`company_code` は**大文字正規化** | B.1／§4.1 |
| B-TC-052 | api | 会社コードの一意と形式検証 | system_admin | 既存 code で作成／不正形式 code | 既存＝`409 conflict`（field=company_code）／形式違反＝`422` | B.1／§4.1 |
| B-TC-053 | api | 会社詳細取得と不明時の秘匿 | system_admin | `GET /admin/companies/{id}`／不明 id | `200`＋設定フラグ＋`account_count`／不明＝`404` | B.1 |
| B-TC-054 | api | 記名設定時の開示フラグ整合強制 | system_admin | `PATCH .../settings`（`vote_anonymized=false`）／`PATCH .../{id}`（color） | 記名時は **`hide_voters_from_managers` を無効化して保存**（サーバー整合）／プロフィール更新 200 | B.1 |
| B-TC-055 | api | 会社管理 API の system_admin 専用担保 | general | `GET /admin/companies` | `403 forbidden`（system_admin 専用） | B.1／B.0.1 |
| B-TC-126 | api | 複数ソートキーの優先順位適用（DataTable 契約） | system_admin・名前に一意トークンを持つ会社を name が昇順と異なる作成順で3件作成 | `GET /admin/companies?q=<token>&sort=name`／`&sort=-name`／同名2件で `&sort=name,-company_code` | `sort=name`＝name 昇順・`-name`＝降順（作成順でなくキー順）／複数キー＝第1キー同値は第2キーで解決（左が最優先・§1.8.1①） | §1.8.1①／B.1 |
| B-TC-127 | api | ソートキーのホワイトリスト検証（列挙・注入耐性） | system_admin | `GET /admin/companies?sort=badcol` | `422 validation_error`（`errors[].field="sort"`）＝ホワイトリスト外の任意列ソートを拒否（§1.8.1①） | §1.8.1①／§2.2 |
| B-TC-128 | api | enum フィルタの多値 OR（DataTable 契約） | 同一トークンの会社を DB で active/suspended に振り分け | `?q=<t>&status=active`／`=suspended`／`=active,suspended` | 単値＝該当のみ／多値＝和集合（`page_info.total` も反映）＝enum 多値（§1.8.1②） | §1.8.1②／B.1 |
| B-TC-129 | api | enum フィルタ値のホワイトリスト検証 | system_admin | `?status=bogus` | `422 validation_error`（`errors[].field="status"`）＝未知 enum 値を拒否 | §1.8.1②／§2.2 |
| B-TC-130 | api | number 範囲フィルタ（account_count の _min/_max） | `account_count=0` の会社群（token） | `?q=<t>&account_count_min=1`／`&account_count_max=0` | `min=1`＝0件／`max=0`＝全件（`page_info.total` も反映）＝number 範囲（§1.8.1②） | §1.8.1②／B.1 |
| B-TC-131 | api | CSV エクスポート（同条件・全件・BOM・表示列） | 同一トークンの会社2件 | `?q=<t>&format=csv&columns=name,company_code&sort=name` | `200`＋`text/csv`＋`Content-Disposition: attachment`＋**UTF-8 BOM**。ヘッダ行＝表示列ラベル・列順／同じ絞込・ソートを適用した**全件**（ページング無視）＝§1.8.1③ | §1.8.1③／B.1 |
| B-TC-132 | api | 管理系 CSV エクスポートの監査記録 | system_admin・トークンの会社1件 | `?q=<t>&format=csv` | `system_audit_logs` に `action=company.export` を**1件**（`detail.count`＝出力件数）＝管理系エクスポートは監査対象（§1.8.1③・B.6） | §1.8.1③／B.6 |
| B-TC-133 | api | CSV 列のホワイトリスト検証 | system_admin | `?format=csv&columns=name,bogus` | `422 validation_error`（`errors[].field="columns"`）＝表示列ホワイトリスト外を拒否（§1.8.1③） | §1.8.1③／§2.2 |
| B-TC-134 | api | ピン行のページ/絞込跨ぎ解決（DataTable 契約） | トークンの会社3件・1件を DB で active に | `?q=<t>&status=suspended&pin_ids=<active id>` | `pinned` に当該行（絞込外でも**必ず解決**）／`data` からは除外／`page_info.total`＝非固定母集合のみ（§1.8.1④） | §1.8.1④／B.1 |
| B-TC-135 | api | pin_ids の形式検証 | system_admin | `?pin_ids=not-a-uuid` | `422 validation_error`（`errors[].field="pin_ids"`）＝不正な固定行 ID を拒否（§1.8.1④） | §1.8.1④／§2.2 |

- **red 確認（後追い）**＝記名時整合行の無効化で B-TC-054 が `hide_voters_from_managers=true` のまま（本来 false）を確認。証跡＝[`red確認台帳.md`](red確認台帳.md)。
- **red 確認（test-first）**＝B-TC-126/127 は複数ソート実装前に確認（`sort` 未対応＝順序が作成順のまま／未知キーが無視され 200）。証跡＝コミットメッセージ。

## 4. クエストグループ・所属スキーマ（会社DB `quest_groups`/`quest_group_members`・§5.4/§5.5・C テーブル）

> B と C の境界＝所属（`quest_group_members`）は会社DB（テナントプレーン）に置く（データモデル §8-①）。本スライスは**テーブルとスキーマ制約のみ**を縦通し（データ層）。所属の割当操作（発行相乗り・B.5／編集差分・B.3）と QG 管理者 API（B.4/B.7）は後続スライス。仕様の正＝[`../データモデル.md`](../データモデル.md) §5.4/§5.5・[`../API設計/B_会社・アカウント・所属.md`](../API設計/B_会社・アカウント・所属.md) B.3。会社DB は seed 会社（ACME-01）を使い、作成した行は teardown で物理削除する。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-060 | int | グループコードの会社内一意担保 | ACME-01 会社DB | `quest_groups` に行を追加／同一 `quest_group_code` で2行目 | 1行目は作成できる／2行目は **UNIQUE 違反**（`quest_group_code` は会社内一意・§5.4） | データモデル §5.4 |
| B-TC-061 | int | 有効所属の重複を防ぐ部分ユニーク | 同一グループ・同一ユーザーに**有効な**所属（`removed_at IS NULL`）が1行 | 同一 `(quest_group_id, user_id)` で2行目（`removed_at IS NULL`）を追加 | **部分ユニーク違反**＝`UNIQUE(quest_group_id, user_id) WHERE removed_at IS NULL`（重複する有効所属は不可・§5.5） | データモデル §5.5 |
| B-TC-062 | int | 解除後の再所属を許容する部分ユニーク | 既存所属を `removed_at` 設定で解除済み | 同一 `(quest_group_id, user_id)` で新規に有効所属を追加 | **作成できる**（部分ユニークは `removed_at` 有りの行を無視＝解除後の再所属を許容・§5.5） | データモデル §5.5 |
| B-TC-063 | int | グループ内ロール既定 member の担保 | ACME-01 会社DB・グループ+ユーザーあり | `role` を指定せず `quest_group_members` に所属を追加 | `role` の既定が **`member`**（§5.5・`quest_group_role` default） | データモデル §5.5 |

- **red 確認（後追い）**＝部分ユニーク index を張らずに migration すると B-TC-061 が重複有効所属を許容（IntegrityError にならない）ことを目視→index 追加で green。証跡＝[`red確認台帳.md`](red確認台帳.md)。

### 4.1 quest_group repository（所属の永続化プリミティブ・B.3/B.4/B.5）

> 対象＝`app/tenant/quest_group/repository.py`。所属の割当を支える会社DB 永続化プリミティブ（`upsert_membership`／`remove_membership`／`get_active_membership`／`list_active_group_ids_for_user`）。仕様＝API設計 B.3（編集差分＝upsert/トゥームストーン）・B.4（参加追加＝行作成 or `removed_at` を NULL に戻す／除外＝`removed_at` 設定）・B.5 step3（発行相乗り）・データモデル §5.5。**再有効化の意味論**＝解除済み（tombstone）行があれば `removed_at` を NULL に戻して再有効化（1 (group,user) 1行の不変条件・監査は別テーブル `system_audit_logs`＝B.6 に残す前提）。割当の差分適用（application）と QG 門番（deps）は後続スライス。ACME-01 会社DB を使い teardown で物理削除。test-first（red 証跡＝コミットメッセージ）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-064 | int | 所属永続化プリミティブの新規作成 | グループ+ユーザーあり・所属なし | `upsert_membership(group, user, role='member')` | 有効所属が **1行作成**（`removed_at IS NULL`・`role='member'`） | B.4／B.5 step3 |
| B-TC-065 | int | ロール変更の冪等 upsert | 有効所属が1行（`role='member'`） | `upsert_membership(..., role='admin')` を実行（＋同値で再実行） | 同一行の **`role` が `admin` に更新**・**行数は不変**（冪等＝再適用で増えない） | B.3（ロール変更）／§5.5 |
| B-TC-066 | int | tombstone の再有効化で行を増やさない担保 | 解除済み（`removed_at` 値あり）の行が1件・有効所属なし | `upsert_membership(group, user, role='member')` | **`removed_at` が NULL に戻り再有効化**・有効所属は **1件**（部分ユニークに抵触しない・新規行を増やさない） | B.4（`removed_at` を NULL に戻す）／§5.5 |
| B-TC-067 | int | 除外のトゥームストーン化と冪等性 | 有効所属が1行 | `remove_membership(group, user)` を2回 | 1回目で **`removed_at` 設定（トゥームストーン）**・有効所属0件／2回目は **no-op**（`None` を返す・既に解除済み） | B.4（除外）／§5.5 |
| B-TC-068 | int | 有効所属の参照範囲とロール絞り込み | ユーザーが G1=`admin`（有効）・G2=`member`（有効）・G3=`member`（解除済み）に所属 | `list_active_group_ids_for_user(user)`／`(user, role='admin')` | 前者＝{G1,G2}（`removed_at IS NULL` のみ・G3 除外）／後者＝{G1}（role フィルタ） | §5.5（参照範囲）／B.0.1 P5（QG門番の材料） |

### 4.2 outbox worker の memberships 適用（発行相乗り・B.5 step3）

> 対象＝`app/control_plane/account_sync/application.py` の `process_outbox_once`／`_apply_one`／`_apply_memberships`。発行時に `account_sync_outbox` の payload へ相乗した初期所属 `memberships:[{group_id, role}]` を、会社DB `users` upsert の**後**に `quest_group_members` へ upsert する（**`users`→`quest_group_members` の FK 順序**・B.5 step3）。**このワーカ経路は加算専用（upsert のみ・削除しない）**＝入力は発行時（新規アカウント＝既存所属ゼロ）に限るため。**所属の「修正」（差分＝omitted を解除・追加/除外・role 変更）は本ワーカではなく、会社DB を直接更新する編集経路が担う**（`PATCH /admin/companies/{id}/accounts/{account_id}`＝§4.4／QG管理者 API＝§4.5・いずれも outbox 非経由）。所属適用は quest_group repository（§4.1）を使い冪等。テストは worker 関数を直接呼ぶ。ACME-01 会社DB に事前にグループを seed し、作成物は teardown で物理削除。test-first（red 証跡＝コミットメッセージ／後追いは台帳）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-069 | int | 発行相乗り所属の FK 順序付き適用 | ACME-01 に quest_group を seed・発行相当の pending 1行（payload に `display_name`＋`memberships:[{group_id, role:'admin'}]`） | `process_outbox_once()` | 会社DB `users` 生成の後に `quest_group_members` に**有効所属を作成**（`role='admin'`・`removed_at IS NULL`）・行 done | B.5 step3／§4.6／§5.5 |
| B-TC-070 | int | 相乗り所属の再送冪等性 | B-TC-069 と同じ payload の pending が 2行（再送） | `process_outbox_once()` | `quest_group_members` は**有効所属1行**（冪等＝再適用で増えない）・users も1行 | §4.6（冪等）／§5.5（部分ユニーク） |
| B-TC-071 | int | memberships 無し payload の前方互換 | `memberships` を**含まない** payload（従来の発行/編集/last_login）の pending 1行 | `process_outbox_once()` | `quest_group_members` に**触れない**（0行のまま）・users ミラーは従来どおり適用（回帰保護） | §4.6（前方互換） |
| B-TC-096 | int | 加算専用ワーカでの既存所属保持 | ユーザーに既存の有効所属が1行・`memberships` を**含まない** payload | `process_outbox_once()` | 既存の有効所属は**保持される（削除されない）**＝「payload に無い＝削除」ではない（加算専用・修正は編集経路） | §4.6（加算専用） |
| B-TC-097 | int | omitted を消さない加算専用セマンティクス | ユーザーが G1・G2 に有効所属（2行）・payload に `memberships:[{G1, admin},{G3, member}]`（G2 は含めない） | `process_outbox_once()` | G1＝role を admin に更新／**G2＝含めていないが削除されない（加算専用）**／G3＝新規作成＝計3有効所属。omitted の解除は編集経路（§4.4）が担う | §4.6（加算専用）／§5.5 |

### 4.3 発行 API の memberships 相乗（B.2/B.5・system_admin＋会社アカウント管理者）

> 対象＝`POST /admin/companies/{company_id}/accounts`（system_admin）・`POST /admin/accounts`（会社アカウント管理者・B.2.1）。ボディに初期所属 `memberships:[{group_id, role}]` を受け取り、発行 Tx で `account_sync_outbox` の payload へ相乗（§4.2 の worker が会社DB へ適用）。**`role=admin`（QG管理者任命）は system_admin＋会社アカウント管理者の双方が可**（B.2.1・2026-08-02 改定）。想定外プロパティ・不正 role は 422（extra=forbid／Literal・§B.6）。end-to-end（発行→`process_outbox_once`→会社DB `quest_group_members`）で検証。ACME-01 にグループを seed し、発行アカウント・所属は teardown で物理削除。test-first。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-072 | api | system_admin 発行の初期所属 end-to-end 反映 | system_admin・ACME-01 に quest_group を seed | `POST /admin/companies/{ACME-01}/accounts`（`memberships:[{group_id, role:'admin'}]`） | `201`＋`account_sync_outbox` payload に `memberships` が乗る→`process_outbox_once` で会社DB `quest_group_members` に **`role='admin'` の有効所属** | B.2／B.5 step3／§4.6 |
| B-TC-073 | api | 会社アカ管理者の admin 相乗り任命許可 | company_account_admin セッション（自社=ACME-01）・グループ seed | `POST /admin/accounts`（`memberships:[{group_id, role:'admin'}]`） | `201`＋発行成功。**会社アカウント管理者も `role=admin`（QG管理者任命）を含められる**（B.2.1・2026-08-02）＝payload に memberships が乗る | B.2.1 |
| B-TC-074 | api | 相乗り所属の Mass Assignment 遮断 | system_admin | 発行ボディの `memberships` に不正 role（`owner`）／想定外プロパティ | `422`（`role` は `member\|admin` の Literal・`extra=forbid`・Mass Assignment 防止・§B.6） | §B.6／B.2 |

### 4.4 編集 API の memberships 差分適用（B.3・会社DB 直接・outbox 非経由）

> 対象＝`PATCH /admin/companies/{company_id}/accounts/{account_id}`（system_admin）・`PATCH /admin/accounts/{account_id}`（会社アカウント管理者）。**既存アカウントは users ミラー存在済み**のため、`memberships` 差分は会社DB `quest_group_members` へ**直接** upsert/トゥームストーン（別DB＝単一Txにできないので outbox 非経由・B.3）。**`memberships` を指定したときは、その値をその account の希望有効所属の全集合として扱う（一括設定＝差分適用）**＝集合に無い現有効所属は解除（`removed_at` 設定）、集合内は upsert（role 反映）。`memberships` を**指定しない** PATCH は所属に触れない（差分・`exclude_unset`）。system_role 変更のセッション破棄（A.9-③）とは独立（per-group role はセッション判定に無関係）。ACME-01 実アカウント（`factory.make_seed_company_account`＝mirror あり）を使い、グループ/所属は teardown で物理削除。test-first。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-075 | api | 編集の会社DB 直接即時適用 | system_admin・ACME-01 実アカウント（mirror あり）・グループ G1 seed | `PATCH .../accounts/{id}`（`memberships:[{G1, role:'admin'}]`） | `200`＋会社DB `quest_group_members` に **G1 の有効所属（role=admin）**が直接作成される（outbox を介さず即時） | B.3／§5.5 |
| B-TC-076 | api | 一括設定差分での集合外解除 | 実アカウントが G1 に有効所属（member）・G2 seed | `PATCH .../accounts/{id}`（`memberships:[{G2, role:'member'}]`＝G1 を含めない） | **G1 は解除（`removed_at` 設定・有効所属から消える）**・**G2 は有効所属に**＝一括設定の差分適用（集合外は tombstone） | B.3（一括設定・トゥームストーン）／§5.5 |
| B-TC-077 | api | memberships 未指定時の所属不変 | 実アカウントが G1 に有効所属 | `PATCH .../accounts/{id}`（`display_name` のみ・`memberships` 未指定） | `200`＋**G1 の有効所属は不変**（`memberships` 未指定は所属に触れない・差分） | B.3（差分・`exclude_unset`） |

## 4.5 QG管理者 API（`/admin/quest-groups`・`/admin/company-directory`・B.4・SC-90）

> **QG管理者＝参加選択専任（SoD・§8-⑯）**。認可は per-group＝`system_role` 非依存（`general` でも当該グループに有効 `admin` 所属があれば QG管理者／`system_admin`・`company_account_admin` でも `admin` 所属が無ければ QG系は 404）。`company_id` は受けず**セッション会社固定**。deps＝`require_qg_admin_actor`（P1/P2＝有効な active セッション）＋application で group 単位の admin 所属を判定（404 存在秘匿）。会社DB 直接操作＝quest_group repository（§4.1）を組合せ。参加追加/除外は **`quest_group_members` の per-group 行のみ**＝アカウント本体（`accounts`）には触れない（SoD の肝）。グループは本スライスでは会社DB へ直接 seed（作成 EP は非対象＝プロビジョニング別途）。test-first。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-080 | api | per-group admin による QG管理者判定 | ACME-01 の `general` アカウントが G1 に有効 `admin` 所属（seed）・当人でログイン | `GET /admin/quest-groups` | `200`＋`data` に G1（`member_count` 付き）。**`system_role=general` でも per-group admin で QG管理者**（B案） | B.4／B.0.1 §1.6 |
| B-TC-081 | api | admin 所属有無での到達可否分岐 | `admin` 所属を持たないアカウント／セッション無し | `GET /admin/quest-groups` | 所属ゼロ＝`403 forbidden`（QG管理者でない＝SC-90 到達不可）／未認証＝`401 unauthenticated` | B.4／B.0.1 P1/P6 |
| B-TC-082 | api | 所属ベースのメンバー一覧と存在秘匿 | G1 の admin（当人ログイン）・別会社 or 不明 group・admin でない group | `GET /admin/quest-groups/{group_id}/members` | G1＝`200`＋メンバー配列（`removed_at IS NULL`・`users` join・role 付き）／不明・非 admin・他会社＝`404 not_found`（存在秘匿・所属ベース＝system_admin でも admin 所属無しは 404） | B.4／B.0.1 P6/§1.6 |
| B-TC-083 | api | ディレクトリ最小射影による PII 秘匿 | G1 admin（当人ログイン）／`admin` 所属ゼロのアカウント | `GET /admin/company-directory` | admin＝`200`＋**最小射影**（`account_id`/`display_name`/`avatar_url` のみ＝`email`/`system_role`/所属は**返さない**・`status=active`）／ゼロ admin＝`403` | B.4（ディレクトリ緩和・最小射影）／§8-⑯ |
| B-TC-084 | api | 参加追加の member 固定と SoD 境界 | G1 admin（当人ログイン）・別の既存アカウント target | `POST /admin/quest-groups/{G1}/members`（`{account_id: target}`） | `201`＋会社DB `quest_group_members` に target の有効所属（**`role=member` 固定**＝QG管理者は admin 任命不可）。**target の `accounts` は不変**（SoD）。CSRF 無しは `403 csrf_failed` | B.4（参加追加・member 固定・SoD） |
| B-TC-085 | api | 除外のトゥームストーン化と冪等性 | G1 に target が有効所属 | `DELETE /admin/quest-groups/{G1}/members/{target}` を2回 | 1回目 `204`＋`removed_at` 設定（有効所属から消える）・`accounts` は不変／2回目も `204`（冪等） | B.4（除外＝トゥームストーン・§5.5） |

## 4.6 会社のクエストグループ候補一覧（B.3・system_admin・クロステナント）

> 対象＝`GET /admin/companies/{company_id}/quest-groups`（system_admin 専用・所属割当の候補一覧・B.3）。`company_id` を明示（クロステナント admin・§1.5）→対象会社DB `quest_groups` を列挙（`member_count` 付き）。会社が無ければ 404。**グループ作成 EP は API 設計に未定義＝本スライス非対象**（プロビジョニングは設計判断待ち）。ACME-01 にグループを seed し teardown で物理削除。test-first。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-086 | api | 所属割当候補のクロステナント列挙 | system_admin・ACME-01 に quest_group を seed | `GET /admin/companies/{ACME-01}/quest-groups` | `200`＋`data` に seed したグループ（`group_id`/`quest_group_code`/`name`/`member_count`）。不明 `company_id` は `404`（存在秘匿・§1.6） | B.3／§1.8 |
| B-TC-087 | api | 候補一覧の認証・認可ガード | 非 system_admin（`general`）／セッション無し | 同 GET | `general`＝`403 forbidden`／未認証＝`401 unauthenticated`（B.0.1 P1/P6） | B.0.1 |
| B-TC-088 | api | グループ作成のコード正規化と system_admin 専用 | system_admin | `POST /admin/companies/{ACME-01}/quest-groups`（小文字 code＋name） | `201`＋`quest_group_code` は**大文字正規化**・一覧に現れる（`member_count=0`）。会社構造変更＝**system_admin 専用**（B.3・2026-08-11） | B.3／§5.4 |
| B-TC-089 | api | グループ作成の一意/形式/CSRF/認可検証 | system_admin | 既存 code で作成／不正形式 code（`ab`〔先頭数字/短すぎ〕）／不明会社／CSRF 無し／`general` | 既存＝`409 conflict`（field=`quest_group_code`）／形式違反＝`422`／不明会社＝`404`／CSRF 無し＝`403 csrf_failed`／`general`＝`403 forbidden` | B.3／§5.4／B.0.1 |
| B-TC-090 | api | リネームの name のみ変更とコード不変 | system_admin・ACME-01 にグループ seed | `PATCH /admin/companies/{ACME-01}/quest-groups/{group_id}`（`name` 変更） | `200`＋`name` 更新・**`quest_group_code` は不変**。不明 group は `404` | B.3.1／§5.4 |
| B-TC-091 | api | 空グループ削除の tombstone と同コード再作成 | system_admin・**空**グループ（有効所属なし） | `DELETE /admin/companies/{ACME-01}/quest-groups/{group_id}` | `204`＋一覧から消える（`deleted_at` トゥームストーン）。**同一 `quest_group_code` を再作成できる**（部分ユニーク） | B.3.1／§5.4 |
| B-TC-092 | api | 使用中グループ削除の拒否（孤児化防止） | system_admin・**有効所属を持つ**グループ | 同 DELETE | `409 conflict`（`in_use`）＝空グループのみ削除可（孤児化防止） | B.3.1／§5.5 |
| B-TC-093 | api | グループ変更系の認証/CSRF/認可ガード | 非 system_admin／セッション無し／CSRF 無し | PATCH・DELETE | `general`＝`403`／未認証＝`401`／CSRF 無し＝`403 csrf_failed`（変更系・B.0.1 P1/P3/P6） | B.0.1 |

## 5. 認可の SoD 境界（system_admin 専用 EP の一括 403・B.0.1 P6・§8-⑯）

> 対象＝**`require_system_admin` を課す全 EP**（B.1 会社 CRUD／B.2 クロステナント `/admin/companies/{id}/accounts` 系〔一覧/発行/編集/disable/enable/password-reset〕／B.3 `/admin/companies/{id}/quest-groups` CRUD）。範囲＝**職務分離（SoD・§8-⑯）の境界**＝「特権ロールである**会社アカウント管理者でも** system_admin 専用操作（会社設定・会社/グループ構造・クロステナント）には到達できない」ことを一括で保証する（`general` も同様に 403）。個別節（B-TC-012/055/087/089/093 等）は代表 EP の 403 を確認するが、本節は**全 system_admin 専用 EP × {general, company_account_admin}** を横断で塞ぐ（権限昇格のリグレッションガード）。認可 dep は CSRF/Origin より先に評価されるため、正当な CSRF を付けても 403 `forbidden` が返る。前提＝各ロールで seed アカウントを作りログイン。出典＝B.0.1 P6／§8-⑯。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-094 | api | general の system_admin 専用 EP 一括遮断 | `general` でログイン | 上記 system_admin 専用 EP 群を順に叩く | すべて `403 forbidden`（B.0.1 P6） | B.0.1 P6 |
| B-TC-095 | api | 会社アカ管理者の構造/クロステナント越権遮断 | `company_account_admin` でログイン | 同上（自社の `/admin/accounts` 系は別権限＝対象外） | すべて `403 forbidden`＝**会社アカ管理者は会社/グループ構造・クロステナントに越権できない**（SoD・§8-⑯） | §8-⑯／B.0.1 P6 |

## 6. システム監査ログ（system_audit_logs・B.6・§4.5）

> 対象＝特権操作（アカウント発行/編集/disable/enable/PW再設定・会社作成/更新/設定・クエストグループ CRUD・所属追加/除外）が **管理DB `system_audit_logs` に監査行を残す**こと。範囲＝(a) 変更系操作が対応する `action` の行を1件書く（`actor_account_id`＝実行者・`ip`/`user_agent`＝middleware が確定・`detail`＝対象/前後）、(b) **読み取り系は監査しない**、(c) **失敗操作（403/422/409）は監査しない**（操作が起きていない）。実行者/IP/UA は `AuditContextMiddleware`（contextvar）が供給＝application は `action`/`detail` のみ。記録は control-plane 操作は同一Tx 相乗、テナントのみの操作（B.4 参加追加/除外・グループ CRUD）は独立記録。前提＝OPS system_admin または QG admin でログイン。機密（PW/token）は `detail` に入れない（§15）。出典＝B.6／§4.5。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-100 | api | 変更系操作の監査行記録 | system_admin（OPS）でログイン | アカウント disable／会社 `settings` 更新 | 各操作で `system_audit_logs` に **1 行**（`action=account.disable`/`company.settings_update`・`actor_account_id`＝OPS 管理者・`detail` に対象 ID・`ip` 記録） | B.6／§4.5 |
| B-TC-101 | api | 読み取り系の非監査 | system_admin | 一覧 GET（会社/アカウント） | 監査行は**増えない**（読み取りは非監査） | B.6（変更系のみ） |
| B-TC-102 | api | 認可失敗（未実行）の非監査 | `general`（権限なし） | disable を試行（403） | 監査行は**作られない**（操作が起きていない＝認可失敗は非監査） | B.6／§4.5／B.0.1 P6 |
| B-TC-103 | api | QG管理者の参加追加/除外の監査記録 | QG管理者（`general`＋admin 所属）でログイン | 参加追加／除外（B.4） | `membership.add`/`membership.remove` の行（`actor_account_id`＝QG管理者・`detail` に group_id/account_id） | B.6／B.4 |

## 7. 補足・非対象

- **account_sync_outbox の writer は主要が実装済み**＝`password_set`（A.7 complete）／`last_login_at`（login 成功）／発行・編集・無効化・再有効化（B.2）／初期所属 `memberships` の相乗（B.5＝`users`→`quest_group_members` の順・§4.2/§4.3）／プロフィール編集（K・`PATCH /me`＝`display_name`/`locale`）。
- **本ドメインの非対象（別スライス/別ドメイン）**:
  - K.3 メール変更（`POST /me/email`＝再認証）・PW 変更（`POST /me/password`）、`GET /me` 全体（残高・署名URL＝K.1）＝ドメイン K の別スライス。
  - 監査ログ `system_audit_logs`（B.6・membership/発行/編集/グループ操作の記録）＝未実装。
  - quest_groups 削除の「クエスト参照による `in_use`」チェック＝quests（ドメイン C）実装時に追加（現状は有効所属のみで判定・§4.6 の `DELETE`）。
  - メール送信の非同期化（`mail_outbox`）は別機構（§4.6 account_sync outbox は会社DB ミラー専用）＝ドメイン A 相乗（[`A_認証.md`](A_認証.md) §7）。
- ワーカの常駐ループ（`worker.py`）自体は疎通のみ＝TC 対象外（本体ロジックは `process_outbox_once` の int TC で担保）。

## 8. frontend e2e（SC-91 会社一覧・B.1）

> 対象＝`frontend/e2e/sc-91-companies.spec.ts`（Playwright・階層 e2e）。範囲＝SC-91（システム管理・会社一覧）の**実 UI 縦通し**＝OPS system_admin でログイン→一覧表示→会社作成が一覧に反映／非 system_admin は入れない（サーバーガード）。**会社作成はモーダル**（デザイン標準§モーダルダイアログ・登録/編集は原則モーダル）で行い、**一覧は検索（q＝会社名/会社コード）＋状態フィルタ＋ページャ（per_page=20・`page_info`）付き**。B-TC-111 は蓄積で新規会社が先頭ページ外になり得るため**検索で絞って**一覧反映を確認する。前提＝フルスタック起動（backend/frontend 再ビルド）＋OPS 管理者 seed（`BOOTSTRAP_ADMIN_PASSWORD`）。出典＝画面設計 SC-91／API設計 B.1／§1.8。UI 設計の正＝`doc/画面設計/screens/SC-91_システム管理.md`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-110 | e2e | 会社一覧画面の実 UI 表示 | OPS system_admin でログイン | `/admin/companies` を開く | 見出し「会社一覧」＋seed 会社（ACME-01）が表示 | SC-91／B.1 |
| B-TC-111 | e2e | 会社作成の一覧即時反映 | 同上 | 「＋ 会社作成」→ name/code/db を入力し作成 | 作成した会社コードが一覧に現れる（`status=suspended`＝「停止」バッジ） | SC-91／B.1／§4.1 |
| B-TC-112 | e2e | 非 system_admin のサーバーガード遮断 | 一般ユーザー（general）でログイン | `/admin/companies` を開く | ダッシュボード（`/`）へリダイレクト＝サーバーガード（API も 403 で二重防御） | B.0.1 P6 |

## 9. frontend e2e（SC-92 会社詳細・B.1）

> 対象＝`frontend/e2e/sc-92-company-detail.spec.ts`（Playwright・階層 e2e）。範囲＝SC-92（会社詳細/設定）の縦通し＝会社作成（モーダル）→詳細へ遷移→会社設定トグル（`PATCH /settings`）が永続。**B-TC-113 は会社一覧がページャ付き（新規会社が先頭ページ外になり得る）ため、作成会社の id を一覧 API で解決して詳細 URL へ直接遷移**して検証する（設定永続が主眼）。アカウント管理・グループ CRUD・所属エディタは後続サブスライス（92B/92C）。前提＝フルスタック＋OPS 管理者 seed。UI 設計の正＝`doc/画面設計/screens/SC-92_会社詳細.md`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-113 | e2e | 会社設定トグルのサーバー永続 | OPS system_admin | SC-91 で会社作成→会社名リンクで詳細へ→設定トグル（MFA）→リロード | 詳細に会社名/コード/状態＋設定が表示され、トグルした値が**リロード後も保持**（サーバー保存） | SC-92／B.1 |
| B-TC-121 | e2e | 非 system_admin 一律リダイレクトの担保 | 一般ユーザー（general） | `/admin/companies/{id}`（SC-92 詳細）を開く | `/` へリダイレクト＝サーバーガード。**`system_role!=="system_admin"` は一律 redirect＝company_account_admin も同分岐**（frontend で company_account_admin を別途検証しない理由。SoD の越権不可は backend B-TC-095 が担保）。SC-93 は system_admin を上位互換で許可＝リダイレクトしない（B-TC-117） | B.0.1 P6／§8-⑯ |

## 10. frontend e2e（SC-92B アカウント管理・B.2/B.5）

> 対象＝`frontend/e2e/sc-92b-accounts.spec.ts`（Playwright・階層 e2e）。範囲＝SC-92 の「アカウント & 所属」セクションの縦通し＝会社詳細でアカウント発行→一覧反映（所属エディタ・disable/enable/PW再設定 も UI 実装。所属付与の e2e はグループが要るため SC-92C 実装後）。編集(PATCH)は 92B-2。前提＝フルスタック＋OPS 管理者。UI 設計の正＝`doc/画面設計/screens/SC-92_会社詳細.md`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-114 | e2e | アカウント発行の一覧反映（e2e） | OPS system_admin | ACME-01 の会社詳細で「＋ アカウント発行」→氏名/ログインID/メール入力→発行 | 発行したログインID が会社のアカウント一覧に現れる（`status=有効`・初回PW設定リンク送信） | SC-92／B.2／B.5 |

## 11. frontend e2e（SC-92B-2 アカウント編集・B.2）

> 対象＝`frontend/e2e/sc-92b2-account-edit.spec.ts`（Playwright・階層 e2e）。範囲＝SC-92 のアカウント編集（`PATCH .../accounts/{id}`）＝発行フォームを edit 兼用にし identity を差分更新。**所属（memberships）は一覧に現状が無いため「置き換える」オプトイン時のみ送信**（B.3 一括設定・誤消去防止）。前提＝フルスタック＋OPS 管理者。UI 設計の正＝`doc/画面設計/screens/SC-92_会社詳細.md`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-115 | e2e | アカウント編集差分の一覧反映（e2e） | OPS system_admin・ACME-01 詳細 | アカウント発行→当該行「編集」→氏名変更→保存 | 変更後の氏名が一覧に反映（PATCH・identity 差分） | SC-92／B.2 |

## 12. frontend e2e（SC-92C クエストグループ CRUD・B.3.1）

> 対象＝`frontend/e2e/sc-92c-quest-groups.spec.ts`（Playwright・階層 e2e）。範囲＝SC-92 のクエストグループ CRUD（`/admin/companies/{id}/quest-groups`）＝作成→リネーム→削除（空グループ）の縦通し。作成後は AccountSection の所属エディタ候補が埋まる。前提＝フルスタック＋OPS 管理者。UI 設計の正＝`doc/画面設計/screens/SC-92_会社詳細.md`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-116 | e2e | グループ CRUD の一覧反映（e2e） | OPS system_admin・ACME-01 詳細 | グループ作成→リネーム（prompt）→削除（confirm・空グループ） | 作成したコードが一覧に現れ、リネーム後の名称に更新、削除で一覧から消える | SC-92／B.3.1／§5.4 |

## 13. frontend e2e（SC-93 会社アカウント管理者・B.2.1）

> 対象＝`frontend/e2e/sc-93-own-accounts.spec.ts`（Playwright・階層 e2e）。範囲＝SC-93（会社アカウント管理者＝自社アカウント管理・`/admin/accounts`＝セッション会社固定）＝一覧＋発行/編集/lifecycle。**system_role 付与は不可（general 固定）**・**所属エディタは自社グループ一覧 EP 未定義のため本画面ではスコープ外**。認可＝company_account_admin＋system_admin 上位互換（e2e は OPS 上位互換で検証）。前提＝フルスタック＋OPS 管理者。UI 設計の正＝`doc/画面設計/screens/SC-93_*.md`（該当）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-117 | e2e | 会社アカ管理者発行の自社一覧反映 | OPS（system_admin 上位互換） | `/admin/accounts` で発行 | 発行したログインID が自社アカウント一覧に現れる | SC-93／B.2.1 |
| B-TC-118 | e2e | 自社アカウント画面のサーバーガード | 一般ユーザー（general） | `/admin/accounts` を開く | `/` へリダイレクト（サーバーガード） | B.0.1／B.2.1 |
| B-TC-122 | e2e | 所属ピッカーの候補配線と所属付き発行 | OPS（上位互換）・自社にグループ作成 | `/admin/accounts` 発行フォームの所属ピッカーでグループ選択→発行 | 自社グループ一覧 EP（`/admin/company-quest-groups`）が候補を返しピッカーが機能、所属付きで発行できる（一覧に反映） | B.2.1（2026-08-11 追加） |

## 14. frontend e2e（SC-90 QG管理者・B.4）

> 対象＝`frontend/e2e/sc-90-quest-group-admin.spec.ts`（Playwright・階層 e2e）。範囲＝SC-90（QG管理者＝参加選択専任）の縦通し＝自分が admin のグループのメンバーをディレクトリから参加追加。認可は per-group（`system_role` 非依存）。B-TC-120 は**編集（PATCH＝会社DB 直接適用・ワーカ非依存）で OPS を当該グループの admin にして**決定的に検証（QG管理者性はセッションから判定できないため画面は 403 を「管理グループなし」と graceful に扱う）。前提＝フルスタック＋OPS 管理者。UI 設計の正＝`doc/画面設計/screens/SC-90_クエストグループ管理.md`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-119 | e2e | QG非管理者への graceful 403 表示 | 一般ユーザー（admin 所属なし） | `/admin/quest-groups` を開く | 「あなたが管理するクエストグループはありません」（403 graceful） | B.4／B.0.1 §1.6 |
| B-TC-120 | e2e | ディレクトリ経由の参加追加縦通し | OPS を編集で当該グループの `admin` に＋候補アカウント発行 | SC-90 でグループ選択→ディレクトリ検索→参加追加 | 候補が当該グループのメンバー（`role=member`）として一覧に現れる | B.4（参加追加・member 固定） |

## 15. session is_qg_admin ＝ SC-90 ナビ出し分け（B.4）

> セッションに `is_qg_admin`（ログイン時点で会社DBに有効な `quest_group_members.role=admin` を1つ以上持つか）をスナップショットし、SC-90「クエストグループ管理」ナビを QG管理者にのみ出す。認可の実体は per-group（サーバー・§4.5）で、本フラグは**ナビ表示の出し分け**用（変更は再ログインで再評価）。backend＝A-TC-101/102（session.is_qg_admin true/false）。frontend e2e＝B-TC-123。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-123 | e2e | is_qg_admin による SC-90 ナビ出し分け | 一般ユーザー（admin 所属なし＝`is_qg_admin=false`） | ヘッダーのユーザーメニューを開く | 「クエストグループ管理」メニューが**出ない** | B.4／A.6（session.is_qg_admin） |

## 16. frontend e2e（SC-92/SC-93 アカウント一覧のページング・検索 UI・B.2/B.2.1）

> 対象＝`frontend/e2e/sc-92b-accounts.spec.ts`（B-TC-125）・`frontend/e2e/sc-93-own-accounts.spec.ts`（B-TC-124）。範囲＝一覧の**検索（`q`＝氏名/ログインID/メール）・状態フィルタ（有効/無効）・オフセットページャ（前へ/次へ＝`page_info`）・メールアドレス列**の縦通し。backend の一覧 EP は `q`/`status`/`page`/`per_page`（既定20・最大100）と `page_info{total,page,per_page}` を実装済み（API層は B-TC-014 で検証済み）＝本節は **frontend UI が backend の絞り込み/ページングに配線され、`page_info` を反映する**ことを実 UI で確認する。**発行時は login と email を別値**にし、検索絞り込み後に両セルが出る＝メール列が email を表示している証拠とする（従来の一覧は login==email で両者を判別できなかった）。所属クエストグループ列は会社DB 依存のため本スライス対象外（別スライス）。前提＝フルスタック＋OPS 管理者 seed。認可＝SC-93 は company_account_admin＋system_admin 上位互換（e2e は OPS 上位互換で検証）。UI 設計の正＝`doc/画面設計/screens/SC-92_会社詳細.md`・`doc/画面設計/screens/SC-93_会社アカウント管理.md`（ツールバー＝検索＋状態フィルタ＋発行）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-124 | e2e | 検索/ページャ/メール列の UI 配線（SC-93） | OPS（system_admin 上位互換）・`/admin/accounts`（SC-93） | メール列/ページャの表示を確認→一意スタンプで発行（login≠email）→検索ボックスにスタンプ入力→検索→クリア | 「メールアドレス」列ヘッダが出る・1ページ目は「前へ」不可／検索で当該行の login/email 両セルが出て seed 管理者行が消え「（1 件）」表示＋「次へ」不可／クリアで「（1 件）」表示が消える（全件に復帰） | SC-93／B.2.1／§1.8 |
| B-TC-125 | e2e | 検索/ページャ/メール列の UI 配線（SC-92） | OPS system_admin・ACME-01 会社詳細（SC-92） | 同上（会社スコープの一覧で） | 「メールアドレス」列ヘッダが出る・1ページ目は「前へ」不可／検索で当該行の login/email 両セルが出て「（1 件）」表示＋「次へ」不可／クリアで「（1 件）」表示が消える | SC-92／B.2／§1.8 |

## 17. frontend e2e（SC-91 会社一覧の DataTable サーバー駆動＋URL モーダル・B.1/§1.8.1）

> 対象＝`frontend/e2e/sc-91-companies.spec.ts`。範囲＝会社一覧（system_admin・SC-91）の **DataTable サーバー駆動モード**（§1.8.1 委譲＝初期 per_page/ソート・項目別フィルタ・行固定のフィルタ跨ぎ・CSV エクスポート）と、**会社作成の URL 付きモーダル**（Parallel@modal＋Intercept・直アクセス時フルページ）。前提＝フルスタック＋OPS 管理者 seed。UI 設計の正＝`doc/画面設計/screens/SC-91_システム管理.md`。**（2026-08-22 逆追記＝トレーサビリティ整備）**

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-137 | e2e | サーバー駆動の初期クエリ（per_page/sort） | OPS・`/admin/companies` | 一覧初期表示 | 初期 `per_page` と `sort=name` が EP クエリに載る（§1.8.1 委譲） | B.1／§1.8.1 |
| B-TC-138 | e2e | 項目別フィルタのサーバー委譲 | OPS・会社一覧 | 状態＝停止 を適用 | `status=suspended` がクエリに飛び結果が絞られる | §1.8.1② |
| B-TC-139 | e2e | 行固定のフィルタ跨ぎ | OPS・会社一覧 | ACME-01 を固定→状態=停止 で絞る | 母集合から外れてもピン行は残る（`pin_ids`） | §1.8.1④ |
| B-TC-140 | e2e | CSV エクスポート | OPS・会社一覧 | エクスポート押下 | 同一 EP の `?format=csv` で `companies.csv` をダウンロード | §1.8.1③ |
| B-TC-160 | e2e | 会社作成は URL モーダル（intercept） | OPS・会社一覧 | 「＋ 会社を作成」→ソフト遷移／直アクセス | `/admin/companies/new` の URL モーダル／直アクセスはフルページにフォールバック | B.1／§112 |
| B-TC-161 | e2e | **カード形式**の ⋯「複製」が誤遷移しない（回帰） | OPS・会社一覧をカード表示 | カードの ⋯→「複製」をクリック | 会社作成（複製）モーダル `/admin/companies/new?dup=` が開く（会社詳細へ遷移**しない**）＝RowMenu を body へ portal し最前面化した回帰担保 | B.1／§4.5⑪／デザイン標準 §4.5 複製 |

## 18. 会社DB プロビジョニング（SC-92「会社DB」・B.1・system_admin）

> 対象＝`POST /admin/companies/{company_id}/provision`（`company_application.provision_company`）＝DB作成→マイグレーション head→users ミラー seed→`active` 化。MVP 手動運用（§8-⑫）を管理 EP 化・**冪等**。前提＝OPS system_admin。seed 会社（ACME-01）は既に整備済み＝再実行が冪等に 200 で通ることを確認（新規DB作成/DROP は伴わない）。**（2026-08-22 追加）**

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-162 | api | プロビジョニングは冪等・active 化 | OPS・seed 会社 ACME-01（整備済み） | `POST /admin/companies/{id}/provision` | 200・`status=active`（DB作成/移行/ミラーは存在済みで no-op） | B.1／§8-⑫ |
| B-TC-163 | api | 非 system_admin の越権遮断 | 一般ユーザー | 同 POST | 403 forbidden | B.0.1 P6 |
| B-TC-164 | api | 存在しない会社の存在秘匿 | OPS | 不明 company_id で POST | 404 not_found | B.2／§1.6 |

## 19. テストパターン（管理者によるメールアドレス確認 送信＝opt-in・ADR-0009）

> 仕様の正＝[`../ADR/ADR-0009_管理者によるメールアドレス確認.md`](../ADR/ADR-0009_管理者によるメールアドレス確認.md)。送信 EP＝`POST /admin/companies/{cid}/accounts/{id}/email-verification`（B.2・system_admin）／`POST /admin/accounts/{id}/email-verification`（B.2.1・company_account_admin・自社）。現メール宛に確認リンク（`mail_category=email_verify_link`・`purpose=email_verify`・72h・旧未使用チャレンジは失効）。確定は [`A_認証.md`](A_認証.md) §8。一覧行に `email_verified`（bool）。`PATCH email` の変更で `email_verified_at` は NULL リセット。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-165 | api | 確認メール送信（system_admin・B.2） | OPS・対象 active アカウント | `POST /admin/companies/{cid}/accounts/{id}/email-verification` | 202・`otp_challenges`（`purpose=email_verify`・未使用・72h）1件・`mail_outbox` に `email_verify_link`（現メール宛・`secret`＝トークン） | ADR-0009 §2.1／§4.4 |
| B-TC-166 | api | 確認メール送信（company_account_admin・B.2.1・自社） | 自社アカウント管理者・対象 active | `POST /admin/accounts/{id}/email-verification` | 202・同上（会社スコープはセッション固定） | ADR-0009 §2.1／B.2.1 |
| B-TC-167 | api | email 変更で email_verified が NULL リセット | 確認済み（`email_verified_at` 有）アカウント | `PATCH .../accounts/{id}`（email 変更）→ `GET .../accounts` | 変更後の行 `email_verified=false`（新アドレスは未確認・ADR-0009 §2.3） | ADR-0009 §2.3 |
| B-TC-168 | api | 一覧行に email_verified（発行直後は false） | 新規発行アカウント | `GET .../accounts` | 当該行 `email_verified=false`（未確認）／confirm 後は true | ADR-0009 §2.4 |

## 20. frontend e2e（SC-92 メール確認バッジ＋⋯「確認メールを送信」・ADR-0009）

> 対象＝SC-92 会社詳細のアカウント一覧（`features/accounts/AccountSection`・OPS system_admin）。メール列の未確認/確認済みバッジ（`email_verified`）と ⋯ RowMenu「確認メールを送信」（202→成功トースト）を検証する。確定 EP の分岐は [`A_認証.md`](A_認証.md) §8、送信 API は §19 で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| B-TC-169 | e2e | 未確認バッジ＋確認メール送信アクション | OPS で SC-92・新規アカウント発行（発行直後は未確認） | 当該行のメール列を確認→⋯「確認メールを送信」→確認ダイアログ「送信する」 | 行に「未確認」バッジ・実行で成功トースト「確認メールを送信しました。」（`sendEmailVerification`・202） | ADR-0009 §2.4／SC-92 |
