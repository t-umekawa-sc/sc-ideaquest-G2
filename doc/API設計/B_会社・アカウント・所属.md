# ドメイン B. 会社・アカウント・所属（コントロールプレーン中心）＝詳細確定（2026-07-27）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.4 認証・§1.5 会社DB動的ルーティング・§1.6 認可・§1.13 outbox）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)。本ファイルはドメイン B の分割レビュー成果。

対象画面＝**SC-91（会社一覧）/ SC-92（会社詳細・設定・全社アカウント）/ SC-90（QGグループ内アカウント管理）**。会社・アカウントは**コントロールプレーン**（管理DB `companies`/`accounts`/`account_sync_outbox`）、所属は**テナントDB**（会社DB `quest_group_members`）。データモデル §4.1〜4.6・§5.4/5.5・§8-①⑭。コーディング規約 §1（認可はサーバー強制）・§2.2（セキュリティ）準拠。

## B.0 アクター・認可スコープ

| アクター | 判定 | 範囲 | パス接頭辞 |
| --- | --- | --- | --- |
| **システム管理者** | `session.system_role == system_admin` | **全会社・全アカウント・会社設定・所属/グループ内ロール** | `/admin/companies/...`（対象会社を `company_id` で明示＝クロステナント admin・§1.5） |
| **クエストグループ管理者** | セッションユーザーが**対象グループに有効な `admin` 所属**（`quest_group_members.role=admin` かつ `removed_at IS NULL`）を持つ（会社DB判定・B案） | **自分が `admin` のグループ**内のメンバー発行/編集/無効化/PW再設定（`admin` 付与は不可） | `/admin/quest-groups/{group_id}/...`（`group_id` は**セッション会社**内・所属で門番） |

- **B案（2026-07-27）**: QG管理者は `system_role` では表さず `quest_group_members.role=admin`（per-group）で表現（データモデル §8-⑭）。**SC-92 は SC-90 の上位互換**＝SC-90 の全操作を全社範囲で実施でき、加えて会社設定・所属割当・`admin` 付与が可能。
- **クロステナント原則（§1.5）**: 一般テナント API は `company_id` を受けないが、**system_admin の `/admin/companies/{company_id}/*` は対象会社を明示的に受ける**（唯一の例外）。QG管理者 API はセッション会社に固定（`company_id` を受けない）。
- 認可失敗＝**403 `forbidden`**／対象が範囲外（他会社・他グループ）は**404**（存在秘匿・§1.6）。

---

## B.1 会社（`/admin/companies`・system_admin 専用・SC-91/92）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /admin/companies` | 会社一覧を取得（SC-91） | クエリ: `q`（会社名/会社コード/db_identifier の部分一致）・`status`（`active\|suspended`）・`page`/`per_page`（オフセット・§1.8） | `data`=会社の配列。各行に基本情報＋`status`＋集計 `account_count`/`group_count`。`page_info.total`＝総件数（バッジ） |
| `POST /admin/companies` | 会社を新規作成（SC-91） | ボディ: `name`,`company_code`,`db_identifier`,`color`,`icon_image_path?` | 作成された会社（**`status=suspended`＝準備中**で返す）。`company_code` は大文字正規化＋一意検証／DBプロビジョニングは MVP 手動（§8-⑫）・完了後に `active` 化 |
| `GET /admin/companies/{company_id}` | 会社詳細を取得（SC-92 バナー/カード） | パス: `company_id` | 会社の詳細＋設定フラグ（`vote_anonymized` 等）＋件数（`account_count`/`group_count`） |
| `PATCH /admin/companies/{company_id}` | 会社プロフィールを更新（SC-92） | パス: `company_id`／ボディ: `color`,`icon_image_path?`（アイコンは MinIO・§1.10） | 更新後の会社プロフィール |
| `PATCH /admin/companies/{company_id}/settings` | 会社設定フラグを更新（SC-92） | パス: `company_id`／ボディ: `vote_anonymized`,`hide_voters_from_managers`,`mfa_required` | 更新後の設定フラグ。**`vote_anonymized=false`（記名）時は `hide_voters_from_managers` を無効化して保存**（サーバーで整合） |

- **会社コード**: 半角英大文字/数字/ハイフン・4〜20字・先頭英字・大文字正規化・全社一意。重複＝**409 `conflict`**（`errors[].field=company_code`）。作成時確定・以後不変。
- **`status` 遷移**: `suspended`（準備中/メンテ）⇄ `active`。`active` 化は会社DB接続確認が前提（プロビジョニング完了）。`suspended` 中は一般ユーザのテナント API が **503 `company_suspended`**（§1.5・admin 操作は可）。
- **プロビジョニング/停止・削除・データ退避**は MVP 手動（§8-⑫）。API 化・退会フローは将来（SC-91/92 §9）。

## B.2 アカウント（`/admin/companies/{company_id}/accounts`・system_admin・SC-92）

**アカウント本体は管理DB `accounts`。氏名・所属は会社DB `users`/`quest_group_members`。** すべての更新は §1.13 outbox で会社DB へミラー。

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /admin/companies/{company_id}/accounts` | この会社のアカウント一覧を取得（SC-92） | パス: `company_id`／クエリ: `q`（氏名/login_id/email）・`status`（`active\|disabled`）・`group_id`・`page`/`per_page`（オフセット） | `data`=アカウントの配列。各行に氏名/`login_id`/`email`/`system_role`/`status`＋所属グループ＋グループ内ロール。`page_info.total` |
| `POST /admin/companies/{company_id}/accounts` | アカウントを発行（→ B.5 発行フロー） | パス: `company_id`／ボディ: `display_name`,`login_id`,`email`,`system_role`(`general\|system_admin`),`memberships`(`[{group_id, role: member\|admin}]`) | 発行されたアカウント（`status=active`・`password_set=false`）。初回PW設定リンクを送信 |
| `PATCH /admin/companies/{company_id}/accounts/{account_id}` | アカウントを編集 | パス: `company_id`,`account_id`／ボディ（差分）: `display_name`/`login_id`/`email`/`system_role`/`memberships` | 更新後のアカウント。identity（`login_id`/`email`）は会社内一意検証 |
| `POST /.../accounts/{account_id}/disable` | アカウントを無効化 | パス: `account_id` | 無効化後の状態（`status=disabled`）。**全アクティブセッション破棄＋信頼端末失効**（A.9-③）。入力データは保持（監査） |
| `POST /.../accounts/{account_id}/enable` | アカウントを再有効化 | パス: `account_id` | 再有効化後の状態（`status=active`） |
| `POST /.../accounts/{account_id}/password-reset` | 初回/再設定PWリンクを再送 | パス: `account_id` | 送信結果（`otp_challenges` purpose=`password_setup`・72h・旧リンク失効・A.7） |

- **`system_role` 変更**（general⇄system_admin）は **`admin` 権限操作**＝実施後に当該アカウントの全セッション破棄（新権限を確実に適用・A.9-③）。**自分自身の system_admin 剥奪は不可**（ロックアウト防止＝最低 1 名の system_admin を残す・422 `last_system_admin`）。
- **`memberships` の `role=admin` 指定＝QG管理者任命**は system_admin のみ（§8-①）。member/admin を per-group に指定。
- **バリデーション**: `system_role` は enum（general/system_admin のみ・quest_group_admin は不受理）。`login_id`/`email` 会社内一意（重複=409）。件数上限（memberships）・想定外プロパティ拒否（Mass Assignment 防止・§2.2）。

## B.3 所属・グループ内ロール（system_admin・SC-92）

- `GET /admin/companies/{company_id}/quest-groups` … 割当候補（この会社のクエストグループ一覧・会社DB `quest_groups`）。
- アカウントの所属は **B.2 の `memberships`**（発行/編集の payload）で一括設定＝**会社DB `quest_group_members` を upsert/トゥームストーン**（差分適用）。
  - 追加＝行を作成（or `removed_at` を NULL に戻して再所属）。解除＝`removed_at` を設定（**論理削除・監査保持**・§5.5）。ロール変更＝`role` 更新。
  - **`admin` の付与/剥奪は system_admin のみ**（§8-①）。**部分ユニーク `UNIQUE(quest_group_id,user_id) WHERE removed_at IS NULL`** を尊重（重複所属不可）。
- 会社DB 書き込みのため対象会社の `get_tenant_session`（§1.5）で解決。**account 側（管理DB）更新とは別 DB のため単一 Tx にできない**＝発行時は B.5 の outbox に相乗、既存アカウントの所属変更は user ミラー存在済みのため会社DB へ直接適用（冪等）。

## B.4 QG管理者 API（`/admin/quest-groups`・SC-90）

セッションユーザーが `admin` 所属を持つグループに限定。`company_id` は**セッション会社固定**（受け取らない）。

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /admin/quest-groups` | 自分が `admin` のグループ一覧を取得（SC-90 グループ切替） | （セッション会社固定・パラメータなし） | `data`=グループの配列（メンバー数付き）。空なら SC-90 自体が **403** |
| `GET /admin/quest-groups/{group_id}/accounts` | そのグループのメンバー一覧を取得 | パス: `group_id`／クエリ: `q`・`status` | `data`=メンバーの配列（会社DB `quest_group_members`×`users`＝`removed_at IS NULL`） |
| `POST /admin/quest-groups/{group_id}/accounts` | メンバーを発行（→ B.5） | パス: `group_id`／ボディ: `display_name`,`login_id`,`email` | 発行されたアカウント。**`system_role=general` 固定・グループ内 `role=member` 固定**（admin 不可＝§8-①） |
| `PATCH /admin/quest-groups/{group_id}/accounts/{account_id}` | メンバーを編集 | パス: `group_id`,`account_id`／ボディ: `display_name`/`login_id`/`email` | 更新後のアカウント（**`system_role`・グループ内ロールは変更不可**） |
| `POST /.../accounts/{account_id}/disable` ／ `/enable` | メンバーを無効化⇄再有効化 | パス: `account_id` | 状態更新（B.2 と同挙動＝セッション破棄含む） |
| `POST /.../accounts/{account_id}/password-reset` | 初回/再設定PWリンクを再送 | パス: `account_id` | 送信結果（A.7） |

- **門番**: `group_id` がセッション会社に属し、かつセッションユーザーがそのグループに有効 `admin` 所属を持つこと。満たさなければ **404**（存在秘匿）。
- **対象アカウントの範囲**: そのグループに**有効な所属を持つアカウントのみ**操作可（他グループ専属のアカウントは 404）。
- **共有アカウントの注意**: アカウントは会社内で 1 人 1 レコード（複数グループ所属可）。QG管理者による identity（login_id/email/display_name）編集は**アカウント全体に反映**（そのユーザーの他グループ表示にも影響）。無効化も同様にアカウント全体（会社レベル）を停止する＝**この作用は SC-90 の注記／§B.7 で明示**。

## B.5 発行フロー・クロスプレーン整合（決定：outbox に初期所属を相乗）

アカウント発行（B.2/B.4）の確定シーケンス:

1. **管理DB Tx**: `accounts` に INSERT（`password_hash=NULL`・`password_set=false`・`status=active`）＋一意検証（login_id/email）。**同一 Tx で `account_sync_outbox` に 1 行 INSERT**（`op=upsert`・`payload` に `display_name`/`login_id`/`email`/`status`/`password_set`/`system_role`/`locale` に加え **初期所属 `memberships:[{group_id, role}]` を相乗**）。
2. **PW設定リンク**: `otp_challenges` purpose=`password_setup`（72h）を発行しメール送信（A.7・dev=MailHog/prod=SMTP）。
3. **outbox ワーカ（会社DB）**: 対象会社DB で **`account_id` をキーに `users` を upsert**（ミラー生成）→ **同じパスで `quest_group_members` を upsert**（初期所属・`removed_at` を NULL・role 設定）。**users を先に作るため FK 順序を保証**（membership.user_id→users の順序問題を回避）。冪等（再適用安全）。
4. 対象者が初回ログイン→PW設定（A.7 complete）で `password_set=true`＝再び outbox で会社DB へ反映。

- **既存アカウントの所属変更**（B.3）は user ミラー存在済みのため会社DB へ直接 upsert/トゥームストーン（outbox を介さない）。
- **順序**: 同一 `account_id` の outbox は `id` 順で直列適用（§4.6）。失敗はリトライ、上限超で `failed`＝要手動対応。
- **会社DB は別インスタンス**＝2相コミットせず outbox＋再試行で結果整合（§1.13）。

## B.6 セキュリティ対策マッピング（`doc/WEBアプリ開発時のセキュリティ対策一覧.md` 突合・§2認可/4入力/9API/15ログ/18業務）

- **認可（2）**: 全エンドポイントでサーバー強制。**IDOR 対策**＝`company_id`/`group_id`/`account_id` の書き換えで範囲外に触れないよう、system_admin=ロール＋対象会社、QG管理者=対象グループの `admin` 所属＋そのグループのメンバーであることを都度検証（範囲外は 404）。**クロステナント遮断**（QG API はセッション会社固定）。CRUD 個別権限（発行/編集/無効化/PW再設定）を分離。**退職・異動時の権限停止**＝disable＋所属トゥームストーン＋セッション破棄。
- **権限変更履歴（2-⑬）**: `system_role` 変更・グループ内 `role` 変更・disable/enable・会社設定変更を**監査記録**（`system_audit_logs`＝データモデル §4.5・操作者/対象/前後/日時/IP・UA）。PW・トークン等の機密は非出力（§15・A.9-⑥）。
- **入力検証（4）**: enum 限定（`system_role`/`status`/`role`）、会社コード/コード形式、件数上限、想定外プロパティ拒否（**Mass Assignment 防止**・§9）。
- **API（9）**: 一覧は最大件数＋ページング必須（§1.8）。レスポンスに不要項目を含めない（`password_hash` 等は絶対に返さない）。DBモデル直返し禁止（Pydantic DTO・§3.2）。
- **業務ロジック（18）**: 発行の二重送信は `Idempotency-Key`（§1.9）。**最後の system_admin 剥奪/無効化を拒否**（ロックアウト防止）。会社 `suspended` 中の一般アクセス遮断。

## B.7 未確定（実装時に確定でも可）

- **DBプロビジョニングの自動化**（MVP 手動 compose／将来 Docker Engine API・k8s＋CloudNativePG）＝会社 `active` 化トリガの API 化（SC-91 §9）。
- **会社の停止/削除・データ保持/エクスポート**（テナント退会フロー・SC-92 §9）。
- **会社単位の追加設定**（XP日次上限・添付上限・機能フラグを会社別に持たせるか・SC-92 §9）。
- **監査ログ専用 UI**（記録は共通監査列＋`system_audit_logs`・表示 UI は後回し＝SC-90/92 §9）。
- **共有アカウントに対する QG管理者編集の作用範囲**（identity 編集・無効化がアカウント全体に及ぶ）を運用上どこまで許すか（B.4 注記）。
- **CSV 一括発行/無効化**は MVP 見送り（SC-90 §9）。
