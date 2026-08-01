# ドメイン B. 会社・アカウント・所属（コントロールプレーン中心）＝詳細確定（2026-07-27）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.4 認証・§1.5 会社DB動的ルーティング・§1.6 認可・§1.13 outbox）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)。本ファイルはドメイン B の分割レビュー成果。

対象画面＝**SC-91（会社一覧）/ SC-92（会社詳細・設定・全社アカウント）/ SC-90（QGグループ内アカウント管理）**。会社・アカウントは**コントロールプレーン**（管理DB `companies`/`accounts`/`account_sync_outbox`）、所属は**テナントDB**（会社DB `quest_group_members`）。データモデル §4.1〜4.6・§5.4/5.5・§8-①⑭。コーディング規約 §1（認可はサーバー強制）・§2.2（セキュリティ）準拠。

## B.0 アクター・認可スコープ

| アクター | 判定 | 範囲 | パス接頭辞 |
| --- | --- | --- | --- |
| **システム管理者** | `session.system_role == system_admin` | **全会社・全アカウント・会社設定・所属/グループ内ロール** | `/admin/companies/...`（対象会社を `company_id` で明示＝クロステナント admin・§1.5） |
| **クエストグループ管理者** | セッションユーザーが**対象グループに有効な `admin` 所属**（`quest_group_members.role=admin` かつ `removed_at IS NULL`）を持つ（会社DB判定・B案） | **自分が `admin` のグループ**内のメンバー発行/編集/無効化/PW再設定（`admin` 付与は不可） | `/admin/quest-groups/{group_id}/...`（`group_id` は**セッション会社**内・所属で門番） |

- **B案（2026-07-27）**: QG管理者は `system_role` では表さず `quest_group_members.role=admin`（per-group）で表現（データモデル §8-⑭）。**SC-92 は SC-90 の上位互換**＝SC-90 の全操作を全社範囲で実施でき、加えて会社設定・所属割当・`admin` 付与が可能。
  - **なぜ（採用理由）**: **制御する対象（スコープ）が違う**から。`system_role`（`accounts.role`）は**全社横断の運営権限**（システム全体で誰が運営者か）を表すのに対し、QG管理者は**特定グループ内だけの管理権限**＝本来 per-group（グループごとに管理者が違う）。これを `system_role` に持たせると、同じ「QG管理者」という概念が**管理DB `accounts.role` と会社DB `quest_group_members.role` の 2 箇所に重複**し、(a) 二重管理・不整合、(b) 「どのグループの管理者か」を `system_role` では表せない粒度の不一致、(c) グループ管理者がシステム全体の運営権限に読み替えられる**権限昇格の矛盾**、が生じる。よって `system_role` は `{system_admin, general}` の 2 値に絞り（全社スコープのみ）、**グループスコープの権限は会社DB側の所属（per-group role）一本で表す**＝スコープと保管場所を一致させる。
- **クロステナント原則（§1.5）**: 一般テナント API は `company_id` を受けないが、**system_admin の `/admin/companies/{company_id}/*` は対象会社を明示的に受ける**（唯一の例外）。QG管理者 API はセッション会社に固定（`company_id` を受けない）。
- **system_admin アカウントの所在＝運営テナント（seed・データモデル §8-⑮）**: `accounts.company_id` は**運営テナント（プラットフォーム管理用の予約会社・例 `OPS`）**を指す（「会社レス＝どの会社にも属さないアカウント」は**非採用**＝案A）。認可は会社所属ではなく `session.system_role==system_admin` で判定するため、運営者は業務クエストに参加しない（テナントデータへの足跡ゼロは運用で担保）。**最初の system_admin は seed で作成**（B.5 ブートストラップ）。
- 認可失敗＝**403 `forbidden`**／対象が範囲外（他会社・他グループ）は**404**（存在秘匿・§1.6）。

### B.0.1 認可判定の基本ルール（全 `/admin/*` 共通の前提・セキュリティ）

以下は本ドメインの**全 `/admin/*` エンドポイントに共通の前提**（各エンドポイントで再掲しない）。**認可はすべてサーバー側の権威データで判定し、リクエストボディ/クエリで自己申告されたロール・ID は一切信用しない**（コーディング規約 §1・§2.2）。**なぜ**＝認可はセキュリティ境界そのもので、フロントの出し分けやクライアント申告を信頼すると権限昇格・越権・クロステナントの侵害口になるため、条件を曖昧にせずサーバーで一意に定義する。

- **P1 認証済みセッション必須**: 有効な `iq_session`（§A）を持つこと。未認証・失効は **401 `unauthenticated`**。**pre-auth（MFA 未完了）セッションでは `/admin/*` を受理しない**（`iq_preauth` は `mfa/verify` 専用・§A）。
- **P2 呼び出し元が有効**: セッションの `account` が `status=active`（`disabled` は認証時に全セッション破棄済みだが、サーバーで都度再確認）。
- **P3 CSRF/Origin**: 変更系（POST/PATCH/DELETE）は §1.4（ダブルサブミット `iq_csrf`＋Origin/Sec-Fetch 検証）を満たす。不一致は **403 `csrf_failed`**。
- **P4 会社スコープはサーバー由来**: system_admin の `/admin/companies/{company_id}/*` のみ `company_id` を明示的に受ける（§1.5 の唯一の例外）。QG系 `/admin/quest-groups/*` は `company_id` を受けず**セッション会社固定**（`session.company_id`）。
- **P5 判定材料の源泉**: `session.system_role`（源泉＝管理DB `accounts.role`・ログイン時にセッションへ確定。変更時は全セッション破棄で再評価＝A.9-③）／会社DB `quest_group_members`（QG 所属・`removed_at IS NULL`）。
  - **`session` とは**＝**サーバー側（Redis）に保持する不透明セッション**。ブラウザの `iq_session` Cookie は**意味を持たない不透明ID（引換券）のみ**で、`system_role` 等の権威データはサーバーが Redis から引いて判定する（クライアント申告は一切信用しない）。**Cookie/トークン一覧・属性＝A.0**、**`session` のスキーマ＝A.6**、**Cookie＋Redis 不透明セッションを採用した理由（JWT 不採用の ADR）＝A.10** を参照。`GET /auth/session`（A.5）でフロントに返す `session` は**UI 出し分け用の表示コピー**であり権威ではない（実アクションは各エンドポイントで再判定）。
- **P6 失敗コードの使い分け（明確化）**: 認証前提の不成立＝上記 401/403(csrf)。**操作権限そのものが無い＝403 `forbidden`**。**権限の種類はあるが対象が権限範囲外（他会社・他グループ・非所属アカウント）＝404 `not_found`（存在秘匿・§1.6）**。原則＝*「見えてよい相手には 403 で拒否理由を示し、見えてはいけない相手には 404 で存在ごと隠す」*。

**アクター判定の厳密定義**（B.0 表の形式化・この 2 条件だけが `/admin/*` の入口）:

- **system_admin（システム管理者）** ⟺ `session.system_role == "system_admin"`。**会社スコープの限定なし（全会社・全アカウント）**。対象会社は `company_id` パスで明示し、会社の実在を確認（存在しなければ 404）。
- **QG管理者（クエストグループ管理者）** ⟺ セッション会社の会社DBに `quest_group_members(user_id=session.user_id, quest_group_id={group_id}, role='admin', removed_at IS NULL)` の行が**存在**する。**`system_role` は判定に無関係**（`general` でも QG管理者たりうる／`system_admin` でも当該グループに `admin` 所属が無ければ QG系パスでは 404＝全社操作は `/admin/companies/*` を使う）。

---

## B.1 会社（`/admin/companies`・system_admin 専用・SC-91/92）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /admin/companies` | 会社一覧を取得（SC-91） | クエリ: `q`（会社名/会社コード/db_identifier の部分一致）・`status`（`active\|suspended`）・`page`/`per_page`（オフセット・§1.8） | `data`=会社の配列。各行に基本情報＋`status`＋集計 `account_count`/`group_count`。`page_info.total`＝総件数（バッジ） |
| `POST /admin/companies` | 会社を新規作成（SC-91） | ボディ: `name`,`company_code`,`db_identifier`,`color`,`icon_image_path?` | 作成された会社（**`status=suspended`＝準備中**で返す）。`company_code` は大文字正規化＋一意検証／DBプロビジョニングは MVP 手動（§8-⑫）・完了後に `active` 化 |
| `GET /admin/companies/{company_id}` | 会社詳細を取得（SC-92 バナー/カード） | パス: `company_id` | 会社の詳細＋設定フラグ（`vote_anonymized` 等）＋件数（`account_count`/`group_count`） |
| `PATCH /admin/companies/{company_id}` | 会社プロフィールを更新（SC-92） | パス: `company_id`／ボディ: `color`,`icon_image_path?`（アイコンは MinIO・§1.10） | 更新後の会社プロフィール |
| `PATCH /admin/companies/{company_id}/settings` | 会社設定フラグを更新（SC-92） | パス: `company_id`／ボディ: `vote_anonymized`,`hide_voters_from_managers`,`mfa_required` | 更新後の設定フラグ。**`vote_anonymized=false`（記名）時は `hide_voters_from_managers` を無効化して保存**（サーバーで整合） |

- **認可条件（B.1 全エンドポイント・共通）**: **system_admin 専用**＝B.0.1 の P1〜P6 を満たし、かつ `session.system_role == "system_admin"`。QG管理者・一般ユーザーは会社管理 API を呼べない＝**一律 403 `forbidden`**（会社そのものは system_admin には全社可視のため、個別会社の存在秘匿〔404〕は不要＝非 system_admin には 403 で拒否）。GET も同条件（会社の存在・件数を非 system_admin に開示しない）。
- **会社コード**: 半角英大文字/数字/ハイフン・4〜20字・先頭英字・大文字正規化・全社一意。重複＝**409 `conflict`**（`errors[].field=company_code`）。作成時確定・以後不変。
- **設定変更の反映タイミング（`PATCH /{company_id}`・`/settings`・status 変更）**: 会社コンフィグは**セッションに焼き込まない**（A.6 に含めない＝再ログイン不要）。**`PATCH` 成功時に同一処理で Redis `company_config:{company_id}` を更新/無効化**（全体規約 §1.14）するため、**ログイン中ユーザーにも次リクエストから即時反映**。例＝`vote_anonymized` の ON/OFF 切替は、次に投票情報を取得した時点（`GET /ideas/{id}` 等・ドメイン D.1/D.5）で記名/匿名の表示が切り替わる。`mfa_required` はログイン時参照＝次回以降のログインに効く。**この無効化はサーバーの責務**（クライアントに依存しない）＝取りこぼすと古い設定で判定されるため必須。
- **`status` 遷移**: `suspended`（準備中/メンテ）⇄ `active`。`active` 化は会社DB接続確認が前提（プロビジョニング完了）。`suspended` 中は一般ユーザのテナント API が **503 `company_suspended`**（§1.5・admin 操作は可）。status 変更も上記と同様に `company_config` を無効化（§1.14）。
- **プロビジョニング/停止・削除・データ退避**は MVP 手動（§8-⑫）。API 化・退会フローは将来（SC-91/92 §9）。

## B.2 アカウント（`/admin/companies/{company_id}/accounts`・system_admin 専用・SC-92）

**アカウント本体は管理DB `accounts`。氏名・所属は会社DB `users`/`quest_group_members`。** すべての更新は §1.13 outbox で会社DB へミラー。

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /admin/companies/{company_id}/accounts` | この会社のアカウント一覧を取得（SC-92） | パス: `company_id`／クエリ: `q`（氏名/login_id/email）・`status`（`active\|disabled`）・`group_id`・`page`/`per_page`（オフセット） | `data`=アカウントの配列。各行に氏名/`login_id`/`email`/`system_role`/`status`＋所属グループ＋グループ内ロール。`page_info.total` |
| `POST /admin/companies/{company_id}/accounts` | アカウントを発行（→ B.5 発行フロー） | パス: `company_id`／ボディ: `display_name`,`login_id`,`email`,`system_role`(`general\|system_admin`),`memberships`(`[{group_id, role: member\|admin}]`) | 発行されたアカウント（`status=active`・`password_set=false`）。初回PW設定リンクを送信 |
| `PATCH /admin/companies/{company_id}/accounts/{account_id}` | アカウントを編集 | パス: `company_id`,`account_id`／ボディ（差分）: `display_name`/`login_id`/`email`/`system_role`/`memberships` | 更新後のアカウント。identity（`login_id`/`email`）は会社内一意検証 |
| `POST /.../accounts/{account_id}/disable` | アカウントを無効化 | パス: `account_id` | 無効化後の状態（`status=disabled`）。**全アクティブセッション破棄＋信頼端末失効**（A.9-③）。入力データは保持（監査） |
| `POST /.../accounts/{account_id}/enable` | アカウントを再有効化 | パス: `account_id` | 再有効化後の状態（`status=active`） |
| `POST /.../accounts/{account_id}/password-reset` | 初回/再設定PWリンクを再送 | パス: `account_id` | 送信結果（`otp_challenges` purpose=`password_setup`・72h・旧リンク失効・A.7） |

- **認可条件（B.2 全エンドポイント・共通）**: **system_admin 専用**＝B.0.1 の P1〜P6 を満たし、かつ `session.system_role == "system_admin"`。非 system_admin は **403 `forbidden`**。対象会社（`company_id`）は実在必須（無ければ 404）。対象アカウント（`account_id`）は当該会社に属すること（他会社のアカウントは **404**）。以下は**エンドポイント個別の追加条件/不変条件**（満たさなければ 403/409/422）:

| エンドポイント | 追加の認可・不変条件 |
| --- | --- |
| `GET .../accounts` | 追加条件なし（system_admin） |
| `POST .../accounts`（発行） | `system_role=system_admin` の付与・`memberships[].role=admin`（QG管理者任命）を含められるのは system_admin のみ＝本 API は満たす。`login_id`/`email` は会社内一意（重複=**409 `conflict`**） |
| `PATCH .../accounts/{id}`（編集） | `system_role` 変更は system_admin（満たす）。**自分自身の `system_admin→general` 降格は不可**（自己ロックアウト防止・422 `last_system_admin`）。**この降格で有効な system_admin が 0 名になる場合も拒否**（下記「最低 1 名」）。identity 変更は会社内一意（重複=409） |
| `POST .../disable` | **この無効化で有効な system_admin が 0 名になる場合は拒否**（422 `last_system_admin`）。**運営テナントの最後の system_admin は無効化不可**（B.5.1）。成功時は対象の**全アクティブセッション破棄＋信頼端末失効**（A.9-③） |
| `POST .../enable` | 追加条件なし（system_admin） |
| `POST .../password-reset` | 追加条件なし（system_admin）。旧リンク失効（A.7） |

- **`system_role` 変更**（general⇄system_admin）は **admin 権限操作**＝実施後に当該アカウントの全セッション破棄（新権限を確実に適用・A.9-③）。
- **最低 1 名の有効な system_admin を常に残す（不変条件）**: 剥奪（降格）・無効化のいずれでも、**操作後にプラットフォーム全体で `system_role=system_admin` かつ `status=active` のアカウントが 0 名**になる操作は **422 `last_system_admin`** で拒否（ロックアウト防止）。加えて**自分自身の降格は常に不可**（UX 上の自己ロックアウト防止・上と独立のガード）。
- **`memberships` の `role=admin` 指定＝QG管理者任命**は system_admin のみ（§8-①）。member/admin を per-group に指定。
- **バリデーション**: `system_role` は enum（general/system_admin のみ・quest_group_admin は不受理）。`login_id`/`email` 会社内一意（重複=409）。件数上限（memberships）・想定外プロパティ拒否（Mass Assignment 防止・§2.2）。

## B.3 所属・グループ内ロール（system_admin 専用・SC-92）

- **認可条件（B.3・共通）**: **system_admin 専用**（B.0.1 P1〜P6＋`system_role==system_admin`）。所属候補の参照・`memberships` による所属/ロールの一括設定はすべて system_admin のみ。特に **`role=admin`（QG管理者）の付与/剥奪は system_admin のみ**（§8-①）。QG管理者はこの API を使えない（QG管理者が使えるのは B.4 のみ・admin 付与不可）。


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

- **認可条件（B.4 全エンドポイント・共通）**: **QG管理者**＝B.0.1 の P1〜P6 を満たし、かつ **`group_id` がセッション会社に属し・呼び出し元が当該グループに有効 `admin` 所属を持つ**（B.0.1 の QG管理者判定）。満たさなければ **404 `not_found`**（存在秘匿＝そのグループの存在自体を非管理者に見せない）。加えて**操作対象アカウント（`account_id`）が当該グループに有効所属を持つ**こと（他グループ専属は 404）。**不可操作**＝`system_role` 変更・グループ内 `role=admin` 付与（system_admin 専用＝B.2/B.3）／発行は `system_role=general`・`role=member` 固定。※判定は**所属ベース**＝`system_admin` であっても当該グループに `admin` 所属が無ければ本パスは 404（全社操作は B.1/B.2 を使う）。
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

### B.5.1 ブートストラップ（運営テナント seed＋最初の system_admin・データモデル §8-⑮）

プラットフォーム初期化時は会社もアカウントも 0 件のため、通常の発行フロー（B.2＝system_admin が API で発行）を起動できない（ニワトリ・タマゴ）。これを **seed で解決**（案A で確定・2026-07-31）:

1. **運営テナントを seed**: `companies` に**プラットフォーム管理用の予約会社**（会社コード＝予約値〔例 `OPS`〕・`status=active`・専用会社DB をプロビジョニング）。一般テナントと同じ物理構造を**用途で分離**（業務利用しない＝クエスト等を作らない）。
2. **最初の system_admin を seed**: `accounts` に運営テナント所属の system_admin（`role=system_admin`・`password_set=false`）を INSERT → 通常の outbox で会社DB `users` へミラー。
3. **初回ログイン**: 運営テナントの会社コードでログイン → PW 設定リンク（A.7）で初期 PW 設定 → 以後 `/admin/companies/*`（B.1/B.2）で各社と各社アカウントを発行。

- **会社レス（`company_id` を持たない）アカウントは非採用**（案A）＝`accounts.company_id` は `NOT NULL` 維持。system_admin の認可は**所属ではなく role**（コントロールプレーン・B.0）なので、運営テナント所属でも全社を管理でき、かつ業務クエストに参加しなくてよい。
- **保護**: **運営テナント・最後の system_admin は削除/無効化不可**（ロックアウト防止・B.6）。
- **将来（案B）**: 監査で「運営者はテナントデータに構造的にアクセス不能」を保証する要件が出たら、コントロールプレーン専用の運用者アイデンティティ＋専用ログイン経路へ拡張（B.7）。

## B.6 セキュリティ対策マッピング（`doc/WEBアプリ開発時のセキュリティ対策一覧.md` 突合・§2認可/4入力/9API/15ログ/18業務）

- **認可（2）**: 全エンドポイントでサーバー強制。**IDOR 対策**＝`company_id`/`group_id`/`account_id` の書き換えで範囲外に触れないよう、system_admin=ロール＋対象会社、QG管理者=対象グループの `admin` 所属＋そのグループのメンバーであることを都度検証（範囲外は 404）。**クロステナント遮断**（QG API はセッション会社固定）。CRUD 個別権限（発行/編集/無効化/PW再設定）を分離。**退職・異動時の権限停止**＝disable＋所属トゥームストーン＋セッション破棄。
- **権限変更履歴（2-⑬）**: `system_role` 変更・グループ内 `role` 変更・disable/enable・会社設定変更を**監査記録**（`system_audit_logs`＝データモデル §4.5・操作者/対象/前後/日時/IP・UA）。PW・トークン等の機密は非出力（§15・A.9-⑥）。
- **入力検証（4）**: enum 限定（`system_role`/`status`/`role`）、会社コード/コード形式、件数上限、想定外プロパティ拒否（**Mass Assignment 防止**・§9）。
- **API（9）**: 一覧は最大件数＋ページング必須（§1.8）。レスポンスに不要項目を含めない（`password_hash` 等は絶対に返さない）。DBモデル直返し禁止（Pydantic DTO・§3.2）。
- **業務ロジック（18）**: 発行の二重送信は `Idempotency-Key`（§1.9）。**最後の system_admin 剥奪/無効化を拒否＋運営テナント（予約会社）の削除/無効化を拒否**（ロックアウト防止・B.5.1）。会社 `suspended` 中の一般アクセス遮断。

## B.7 未確定（実装時に確定でも可）

- **DBプロビジョニングの自動化**（MVP 手動 compose／将来 Docker Engine API・k8s＋CloudNativePG）＝会社 `active` 化トリガの API 化（SC-91 §9）。
- **会社の停止/削除・データ保持/エクスポート**（テナント退会フロー・SC-92 §9）。
- **会社単位の追加設定**（XP日次上限・添付上限・機能フラグを会社別に持たせるか・SC-92 §9）。
- **監査ログ専用 UI**（記録は共通監査列＋`system_audit_logs`・表示 UI は後回し＝SC-90/92 §9）。
- **共有アカウントに対する QG管理者編集の作用範囲**（identity 編集・無効化がアカウント全体に及ぶ）を運用上どこまで許すか（B.4 注記）。
- **CSV 一括発行/無効化**は MVP 見送り（SC-90 §9）。
- **運営者アイデンティティの構造分離（案B・将来）**: MVP は運営テナント収容（B.5.1・案A）。厳密な職務分離（運営者はテナントデータに構造的にアクセス不能）が要件化されたら、コントロールプレーン専用の運用者テーブル＋専用ログイン経路（会社コード非依存）へ拡張するか。運営テナントの会社コード予約値・seed 投入方式（migration/初期化スクリプト）の実装細部も併せて確定。
