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
| B-TC-007 | int | ACME-01 実アカウント（users ミラー行あり） | `login_id`/`email`/`system_role` を payload に upsert enqueue → `process_outbox_once()` | 会社DB `users.login_id`/`email`/`system_role` に**ミラー反映**（会社DB 単独でユーザ一覧を描画するための identity/role 列・§5.3） | データモデル §4.6／§5.3 |

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

## 3. 会社 CRUD API（B.1・system_admin・SC-91/92）

> `/admin/companies`。作成は DBプロビジョニング MVP 手動＝`status=suspended` で管理DB 行を作るのみ。`group_count`（会社DB `quest_groups`）はドメインC実装時に付与（本スライスは `account_count` のみ）。設定の Redis `company_config` 無効化はキャッシュ未実装ゆえ現状 no-op（§1.14）。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-050 | api | system_admin | `GET /admin/companies` | `200`＋`{data, page_info}`・各行に `account_count`・seed 会社を含む | B.1／§1.8 |
| B-TC-051 | api | system_admin | `POST /admin/companies`（小文字 code） | `201`＋**`status=suspended`**＋`company_code` は**大文字正規化** | B.1／§4.1 |
| B-TC-052 | api | system_admin | 既存 code で作成／不正形式 code | 既存＝`409 conflict`（field=company_code）／形式違反＝`422` | B.1／§4.1 |
| B-TC-053 | api | system_admin | `GET /admin/companies/{id}`／不明 id | `200`＋設定フラグ＋`account_count`／不明＝`404` | B.1 |
| B-TC-054 | api | system_admin | `PATCH .../settings`（`vote_anonymized=false`）／`PATCH .../{id}`（color） | 記名時は **`hide_voters_from_managers` を無効化して保存**（サーバー整合）／プロフィール更新 200 | B.1 |
| B-TC-055 | api | general | `GET /admin/companies` | `403 forbidden`（system_admin 専用） | B.1／B.0.1 |

- **red 確認（後追い）**＝記名時整合行の無効化で B-TC-054 が `hide_voters_from_managers=true` のまま（本来 false）を確認。証跡＝[`red確認台帳.md`](red確認台帳.md)。

## 4. クエストグループ・所属スキーマ（会社DB `quest_groups`/`quest_group_members`・§5.4/§5.5・C テーブル）

> B と C の境界＝所属（`quest_group_members`）は会社DB（テナントプレーン）に置く（データモデル §8-①）。本スライスは**テーブルとスキーマ制約のみ**を縦通し（データ層）。所属の割当操作（発行相乗り・B.5／編集差分・B.3）と QG 管理者 API（B.4/B.7）は後続スライス。仕様の正＝[`../データモデル.md`](../データモデル.md) §5.4/§5.5・[`../API設計/B_会社・アカウント・所属.md`](../API設計/B_会社・アカウント・所属.md) B.3。会社DB は seed 会社（ACME-01）を使い、作成した行は teardown で物理削除する。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-060 | int | ACME-01 会社DB | `quest_groups` に行を追加／同一 `quest_group_code` で2行目 | 1行目は作成できる／2行目は **UNIQUE 違反**（`quest_group_code` は会社内一意・§5.4） | データモデル §5.4 |
| B-TC-061 | int | 同一グループ・同一ユーザーに**有効な**所属（`removed_at IS NULL`）が1行 | 同一 `(quest_group_id, user_id)` で2行目（`removed_at IS NULL`）を追加 | **部分ユニーク違反**＝`UNIQUE(quest_group_id, user_id) WHERE removed_at IS NULL`（重複する有効所属は不可・§5.5） | データモデル §5.5 |
| B-TC-062 | int | 既存所属を `removed_at` 設定で解除済み | 同一 `(quest_group_id, user_id)` で新規に有効所属を追加 | **作成できる**（部分ユニークは `removed_at` 有りの行を無視＝解除後の再所属を許容・§5.5） | データモデル §5.5 |
| B-TC-063 | int | ACME-01 会社DB・グループ+ユーザーあり | `role` を指定せず `quest_group_members` に所属を追加 | `role` の既定が **`member`**（§5.5・`quest_group_role` default） | データモデル §5.5 |

- **red 確認（後追い）**＝部分ユニーク index を張らずに migration すると B-TC-061 が重複有効所属を許容（IntegrityError にならない）ことを目視→index 追加で green。証跡＝[`red確認台帳.md`](red確認台帳.md)。

### 4.1 quest_group repository（所属の永続化プリミティブ・B.3/B.4/B.5）

> 対象＝`app/tenant/quest_group/repository.py`。所属の割当を支える会社DB 永続化プリミティブ（`upsert_membership`／`remove_membership`／`get_active_membership`／`list_active_group_ids_for_user`）。仕様＝API設計 B.3（編集差分＝upsert/トゥームストーン）・B.4（参加追加＝行作成 or `removed_at` を NULL に戻す／除外＝`removed_at` 設定）・B.5 step3（発行相乗り）・データモデル §5.5。**再有効化の意味論**＝解除済み（tombstone）行があれば `removed_at` を NULL に戻して再有効化（1 (group,user) 1行の不変条件・監査は別テーブル `system_audit_logs`＝B.6 に残す前提）。割当の差分適用（application）と QG 門番（deps）は後続スライス。ACME-01 会社DB を使い teardown で物理削除。test-first（red 証跡＝コミットメッセージ）。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-064 | int | グループ+ユーザーあり・所属なし | `upsert_membership(group, user, role='member')` | 有効所属が **1行作成**（`removed_at IS NULL`・`role='member'`） | B.4／B.5 step3 |
| B-TC-065 | int | 有効所属が1行（`role='member'`） | `upsert_membership(..., role='admin')` を実行（＋同値で再実行） | 同一行の **`role` が `admin` に更新**・**行数は不変**（冪等＝再適用で増えない） | B.3（ロール変更）／§5.5 |
| B-TC-066 | int | 解除済み（`removed_at` 値あり）の行が1件・有効所属なし | `upsert_membership(group, user, role='member')` | **`removed_at` が NULL に戻り再有効化**・有効所属は **1件**（部分ユニークに抵触しない・新規行を増やさない） | B.4（`removed_at` を NULL に戻す）／§5.5 |
| B-TC-067 | int | 有効所属が1行 | `remove_membership(group, user)` を2回 | 1回目で **`removed_at` 設定（トゥームストーン）**・有効所属0件／2回目は **no-op**（`None` を返す・既に解除済み） | B.4（除外）／§5.5 |
| B-TC-068 | int | ユーザーが G1=`admin`（有効）・G2=`member`（有効）・G3=`member`（解除済み）に所属 | `list_active_group_ids_for_user(user)`／`(user, role='admin')` | 前者＝{G1,G2}（`removed_at IS NULL` のみ・G3 除外）／後者＝{G1}（role フィルタ） | §5.5（参照範囲）／B.0.1 P5（QG門番の材料） |

### 4.2 outbox worker の memberships 適用（発行相乗り・B.5 step3）

> 対象＝`app/control_plane/account_sync/application.py` の `process_outbox_once`／`_apply_one`。発行時に `account_sync_outbox` の payload へ相乗した初期所属 `memberships:[{group_id, role}]` を、会社DB `users` upsert の**後**に `quest_group_members` へ upsert する（**`users`→`quest_group_members` の FK 順序**・B.5 step3）。所属適用は quest_group repository（§4.1）を使い冪等。テストは worker 関数を直接呼ぶ。ACME-01 会社DB に事前にグループを seed し、作成物は teardown で物理削除。test-first（red 証跡＝コミットメッセージ）。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-069 | int | ACME-01 に quest_group を seed・発行相当の pending 1行（payload に `display_name`＋`memberships:[{group_id, role:'admin'}]`） | `process_outbox_once()` | 会社DB `users` 生成の後に `quest_group_members` に**有効所属を作成**（`role='admin'`・`removed_at IS NULL`）・行 done | B.5 step3／§4.6／§5.5 |
| B-TC-070 | int | B-TC-069 と同じ payload の pending が 2行（再送） | `process_outbox_once()` | `quest_group_members` は**有効所属1行**（冪等＝再適用で増えない）・users も1行 | §4.6（冪等）／§5.5（部分ユニーク） |
| B-TC-071 | int | `memberships` を**含まない** payload（従来の発行/編集/last_login）の pending 1行 | `process_outbox_once()` | `quest_group_members` に**触れない**（0行のまま）・users ミラーは従来どおり適用（回帰保護） | §4.6（前方互換） |

### 4.3 発行 API の memberships 相乗（B.2/B.5・system_admin＋会社アカウント管理者）

> 対象＝`POST /admin/companies/{company_id}/accounts`（system_admin）・`POST /admin/accounts`（会社アカウント管理者・B.2.1）。ボディに初期所属 `memberships:[{group_id, role}]` を受け取り、発行 Tx で `account_sync_outbox` の payload へ相乗（§4.2 の worker が会社DB へ適用）。**`role=admin`（QG管理者任命）は system_admin＋会社アカウント管理者の双方が可**（B.2.1・2026-08-02 改定）。想定外プロパティ・不正 role は 422（extra=forbid／Literal・§B.6）。end-to-end（発行→`process_outbox_once`→会社DB `quest_group_members`）で検証。ACME-01 にグループを seed し、発行アカウント・所属は teardown で物理削除。test-first。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-072 | api | system_admin・ACME-01 に quest_group を seed | `POST /admin/companies/{ACME-01}/accounts`（`memberships:[{group_id, role:'admin'}]`） | `201`＋`account_sync_outbox` payload に `memberships` が乗る→`process_outbox_once` で会社DB `quest_group_members` に **`role='admin'` の有効所属** | B.2／B.5 step3／§4.6 |
| B-TC-073 | api | company_account_admin セッション（自社=ACME-01）・グループ seed | `POST /admin/accounts`（`memberships:[{group_id, role:'admin'}]`） | `201`＋発行成功。**会社アカウント管理者も `role=admin`（QG管理者任命）を含められる**（B.2.1・2026-08-02）＝payload に memberships が乗る | B.2.1 |
| B-TC-074 | api | system_admin | 発行ボディの `memberships` に不正 role（`owner`）／想定外プロパティ | `422`（`role` は `member\|admin` の Literal・`extra=forbid`・Mass Assignment 防止・§B.6） | §B.6／B.2 |

### 4.4 編集 API の memberships 差分適用（B.3・会社DB 直接・outbox 非経由）

> 対象＝`PATCH /admin/companies/{company_id}/accounts/{account_id}`（system_admin）・`PATCH /admin/accounts/{account_id}`（会社アカウント管理者）。**既存アカウントは users ミラー存在済み**のため、`memberships` 差分は会社DB `quest_group_members` へ**直接** upsert/トゥームストーン（別DB＝単一Txにできないので outbox 非経由・B.3）。**`memberships` を指定したときは、その値をその account の希望有効所属の全集合として扱う（一括設定＝差分適用）**＝集合に無い現有効所属は解除（`removed_at` 設定）、集合内は upsert（role 反映）。`memberships` を**指定しない** PATCH は所属に触れない（差分・`exclude_unset`）。system_role 変更のセッション破棄（A.9-③）とは独立（per-group role はセッション判定に無関係）。ACME-01 実アカウント（`factory.make_seed_company_account`＝mirror あり）を使い、グループ/所属は teardown で物理削除。test-first。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-075 | api | system_admin・ACME-01 実アカウント（mirror あり）・グループ G1 seed | `PATCH .../accounts/{id}`（`memberships:[{G1, role:'admin'}]`） | `200`＋会社DB `quest_group_members` に **G1 の有効所属（role=admin）**が直接作成される（outbox を介さず即時） | B.3／§5.5 |
| B-TC-076 | api | 実アカウントが G1 に有効所属（member）・G2 seed | `PATCH .../accounts/{id}`（`memberships:[{G2, role:'member'}]`＝G1 を含めない） | **G1 は解除（`removed_at` 設定・有効所属から消える）**・**G2 は有効所属に**＝一括設定の差分適用（集合外は tombstone） | B.3（一括設定・トゥームストーン）／§5.5 |
| B-TC-077 | api | 実アカウントが G1 に有効所属 | `PATCH .../accounts/{id}`（`display_name` のみ・`memberships` 未指定） | `200`＋**G1 の有効所属は不変**（`memberships` 未指定は所属に触れない・差分） | B.3（差分・`exclude_unset`） |

## 4.5 QG管理者 API（`/admin/quest-groups`・`/admin/company-directory`・B.4・SC-90）

> **QG管理者＝参加選択専任（SoD・§8-⑯）**。認可は per-group＝`system_role` 非依存（`general` でも当該グループに有効 `admin` 所属があれば QG管理者／`system_admin`・`company_account_admin` でも `admin` 所属が無ければ QG系は 404）。`company_id` は受けず**セッション会社固定**。deps＝`require_qg_admin_actor`（P1/P2＝有効な active セッション）＋application で group 単位の admin 所属を判定（404 存在秘匿）。会社DB 直接操作＝quest_group repository（§4.1）を組合せ。参加追加/除外は **`quest_group_members` の per-group 行のみ**＝アカウント本体（`accounts`）には触れない（SoD の肝）。グループは本スライスでは会社DB へ直接 seed（作成 EP は非対象＝プロビジョニング別途）。test-first。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-080 | api | ACME-01 の `general` アカウントが G1 に有効 `admin` 所属（seed）・当人でログイン | `GET /admin/quest-groups` | `200`＋`data` に G1（`member_count` 付き）。**`system_role=general` でも per-group admin で QG管理者**（B案） | B.4／B.0.1 §1.6 |
| B-TC-081 | api | `admin` 所属を持たないアカウント／セッション無し | `GET /admin/quest-groups` | 所属ゼロ＝`403 forbidden`（QG管理者でない＝SC-90 到達不可）／未認証＝`401 unauthenticated` | B.4／B.0.1 P1/P6 |
| B-TC-082 | api | G1 の admin（当人ログイン）・別会社 or 不明 group・admin でない group | `GET /admin/quest-groups/{group_id}/members` | G1＝`200`＋メンバー配列（`removed_at IS NULL`・`users` join・role 付き）／不明・非 admin・他会社＝`404 not_found`（存在秘匿・所属ベース＝system_admin でも admin 所属無しは 404） | B.4／B.0.1 P6/§1.6 |
| B-TC-083 | api | G1 admin（当人ログイン）／`admin` 所属ゼロのアカウント | `GET /admin/company-directory` | admin＝`200`＋**最小射影**（`account_id`/`display_name`/`avatar_url` のみ＝`email`/`system_role`/所属は**返さない**・`status=active`）／ゼロ admin＝`403` | B.4（ディレクトリ緩和・最小射影）／§8-⑯ |
| B-TC-084 | api | G1 admin（当人ログイン）・別の既存アカウント target | `POST /admin/quest-groups/{G1}/members`（`{account_id: target}`） | `201`＋会社DB `quest_group_members` に target の有効所属（**`role=member` 固定**＝QG管理者は admin 任命不可）。**target の `accounts` は不変**（SoD）。CSRF 無しは `403 csrf_failed` | B.4（参加追加・member 固定・SoD） |
| B-TC-085 | api | G1 に target が有効所属 | `DELETE /admin/quest-groups/{G1}/members/{target}` を2回 | 1回目 `204`＋`removed_at` 設定（有効所属から消える）・`accounts` は不変／2回目も `204`（冪等） | B.4（除外＝トゥームストーン・§5.5） |

## 4.6 会社のクエストグループ候補一覧（B.3・system_admin・クロステナント）

> 対象＝`GET /admin/companies/{company_id}/quest-groups`（system_admin 専用・所属割当の候補一覧・B.3）。`company_id` を明示（クロステナント admin・§1.5）→対象会社DB `quest_groups` を列挙（`member_count` 付き）。会社が無ければ 404。**グループ作成 EP は API 設計に未定義＝本スライス非対象**（プロビジョニングは設計判断待ち）。ACME-01 にグループを seed し teardown で物理削除。test-first。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-086 | api | system_admin・ACME-01 に quest_group を seed | `GET /admin/companies/{ACME-01}/quest-groups` | `200`＋`data` に seed したグループ（`group_id`/`quest_group_code`/`name`/`member_count`）。不明 `company_id` は `404`（存在秘匿・§1.6） | B.3／§1.8 |
| B-TC-087 | api | 非 system_admin（`general`）／セッション無し | 同 GET | `general`＝`403 forbidden`／未認証＝`401 unauthenticated`（B.0.1 P1/P6） | B.0.1 |
| B-TC-088 | api | system_admin | `POST /admin/companies/{ACME-01}/quest-groups`（小文字 code＋name） | `201`＋`quest_group_code` は**大文字正規化**・一覧に現れる（`member_count=0`）。会社構造変更＝**system_admin 専用**（B.3・2026-08-11） | B.3／§5.4 |
| B-TC-089 | api | system_admin | 既存 code で作成／不正形式 code（`ab`〔先頭数字/短すぎ〕）／不明会社／CSRF 無し／`general` | 既存＝`409 conflict`（field=`quest_group_code`）／形式違反＝`422`／不明会社＝`404`／CSRF 無し＝`403 csrf_failed`／`general`＝`403 forbidden` | B.3／§5.4／B.0.1 |

## 5. 補足・非対象

- **発行/編集/無効化（B.2・B.5）・プロフィール編集（K）の writer** は該当エンドポイント実装時に追加（`password_set`＝complete／`last_login_at`＝login は実装済み）。
- **初期所属 `memberships` の相乗適用**（B.5＝`users`→`quest_group_members` の順）は B ドメイン実装時（本スライスの payload は `password_set` のみ）。
- **メール送信の非同期化**は別機構（§4.6 outbox は DB ミラー専用）＝別スライス。
- ワーカの常駐ループ（`worker.py`）自体は疎通のみ＝TC 対象外（本体ロジックは `process_outbox_once` の int TC で担保）。
