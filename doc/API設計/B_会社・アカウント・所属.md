# ドメイン B. 会社・アカウント・所属（コントロールプレーン中心）＝詳細確定（2026-07-27）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.4 認証・§1.5 会社DB動的ルーティング・§1.6 認可・§1.13 outbox）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)。本ファイルはドメイン B の分割レビュー成果。

対象画面＝**SC-91（会社一覧）/ SC-92（会社詳細・設定・全社アカウント）/ SC-90（QGグループ内アカウント管理）**。会社・アカウントは**コントロールプレーン**（管理DB `companies`/`accounts`/`account_sync_outbox`）、所属は**テナントDB**（会社DB `quest_group_members`）。データモデル §4.1〜4.6・§5.4/5.5・§8-①⑭。コーディング規約 §1（認可はサーバー強制）・§2.2（セキュリティ）準拠。

## B.0 アクター・認可スコープ

| アクター | 判定 | 範囲 | パス接頭辞 |
| --- | --- | --- | --- |
| **システム管理者** | `session.system_role == system_admin` | **全会社・全アカウント・会社設定・所属/グループ内ロール・ロール付与** | `/admin/companies/...`（対象会社を `company_id` で明示＝クロステナント admin・§1.5） |
| **会社アカウント管理者** | `session.system_role == company_account_admin` | **自社（セッション会社）全アカウント**の発行/無効化/identity 編集/PW 再設定＋**per-group `admin`（QG管理者）の任命/剥奪**（2026-08-02 改定）。**会社設定・プロビジョニング・`system_role` 付与は不可** | `/admin/accounts/...`（**セッション会社固定**・`company_id` を受けない） |
| **クエストグループ管理者** | セッションユーザーが**対象グループに有効な `admin` 所属**（`quest_group_members.role=admin` かつ `removed_at IS NULL`）を持つ（会社DB判定・B案） | **参加選択専任**＝自社ディレクトリ参照＋**自分が `admin` のグループへ既存アカウントを参加追加/除外**（`quest_group_members` の per-group 操作のみ）。**発行/無効化/identity/PW・`admin` 付与は不可** | `/admin/quest-groups/{group_id}/...`・`/admin/company-directory`（`group_id` は**セッション会社**内・所属で門番） |

- **職務分離（SoD・2026-08-01・データモデル §8-⑯）**: アカウントの**ライフサイクル管理（会社アカウント管理者）**と、QG への**参加管理（QG管理者）**を分離。**なぜ**＝QG管理者が会社DB内アカウントを参照可能（緩和）になると「任意の既存垢を自 QG に追加 → 無効化/identity 改変」で会社全体を破壊/乗っ取りできる権限昇格が生じるため、QG管理者から破壊系を取り上げる（B.7.2 も参照）。会社アカウント管理者は会社スコープ役割＝`system_role` に格納（B案の原則）。

- **B案（2026-07-27）**: QG管理者は `system_role` では表さず `quest_group_members.role=admin`（per-group）で表現（データモデル §8-⑭）。**SC-92 は SC-90 の上位互換**＝SC-90 の全操作を全社範囲で実施でき、加えて会社設定・所属割当・`admin` 付与が可能。
  - **なぜ（採用理由）**: **制御する対象（スコープ）が違う**から。`system_role`（`accounts.role`）は**全社横断の運営権限**（システム全体で誰が運営者か）を表すのに対し、QG管理者は**特定グループ内だけの管理権限**＝本来 per-group（グループごとに管理者が違う）。これを `system_role` に持たせると、同じ「QG管理者」という概念が**管理DB `accounts.role` と会社DB `quest_group_members.role` の 2 箇所に重複**し、(a) 二重管理・不整合、(b) 「どのグループの管理者か」を `system_role` では表せない粒度の不一致、(c) グループ管理者がシステム全体の運営権限に読み替えられる**権限昇格の矛盾**、が生じる。よって `system_role` には**会社/全社スコープの役割のみ**（`system_admin`・後述 `company_account_admin`・`general`）を持たせ、**グループスコープの権限は会社DB側の所属（per-group role）一本で表す**＝スコープと保管場所を一致させる。※当初は `{system_admin, general}` の 2 値だったが、同じ「会社スコープ役割」の原則に沿って **`company_account_admin` を追加＝3 値化**（§8-⑯・B.2.1）。QG管理者（per-group）を system_role に入れない点は不変。
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

**アクター判定の厳密定義**（B.0 表の形式化・この 3 条件が `/admin/*` の入口）:

- **system_admin（システム管理者）** ⟺ `session.system_role == "system_admin"`。**会社スコープの限定なし（全会社・全アカウント）**。対象会社は `company_id` パスで明示し、会社の実在を確認（存在しなければ 404）。
- **company_account_admin（会社アカウント管理者）** ⟺ `session.system_role == "company_account_admin"`。**スコープ＝セッション会社（`session.company_id`）のアカウントのみ**（`/admin/accounts/*` はセッション会社固定・`company_id` を受けない）。**アカウントのライフサイクル（発行/無効化/identity/PW）＋自社の per-group `admin`（QG管理者）任命/剥奪**が可能（2026-08-02 改定）。**`system_role` の付与（`company_account_admin`/`system_admin`）・会社設定・プロビジョニングは不可**（403）。※`system_admin` は上位互換で `company_account_admin` の操作も可能（ただし通常は `/admin/companies/{company_id}/accounts` を使う）。
- **QG管理者（クエストグループ管理者）** ⟺ セッション会社の会社DBに `quest_group_members(user_id=session.user_id, quest_group_id={group_id}, role='admin', removed_at IS NULL)` の行が**存在**する。**`system_role` は判定に無関係**（`general` でも QG管理者たりうる／`system_admin`・`company_account_admin` でも当該グループに `admin` 所属が無ければ QG系パスでは 404）。**参加管理（メンバーシップ）と自社ディレクトリ参照のみ**＝アカウントの発行/無効化/identity/PW は**不可**（会社アカウント管理者の領分）。

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
| `POST .../accounts`（発行） | `system_role`（`company_account_admin`/`system_admin`）の付与を含められるのは **system_admin のみ**＝本 API は満たす。`memberships[].role=admin`（QG管理者任命）は system_admin＋会社アカウント管理者（B.2.1）が可。`login_id`/`email` は会社内一意（重複=**409 `conflict`**） |
| `PATCH .../accounts/{id}`（編集） | `system_role` 変更は system_admin（満たす）。**自分自身の `system_admin→general` 降格は不可**（自己ロックアウト防止・422 `last_system_admin`）。**この降格で有効な system_admin が 0 名になる場合も拒否**（下記「最低 1 名」）。identity 変更は会社内一意（重複=409） |
| `POST .../disable` | **この無効化で有効な system_admin が 0 名になる場合は拒否**（422 `last_system_admin`）。**運営テナントの最後の system_admin は無効化不可**（B.5.1）。成功時は対象の**全アクティブセッション破棄＋信頼端末失効**（A.9-③） |
| `POST .../enable` | 追加条件なし（system_admin） |
| `POST .../password-reset` | 追加条件なし（system_admin）。旧リンク失効（A.7） |

- **`system_role` 変更**（`general`⇄`company_account_admin`⇄`system_admin`）は **system_admin 専用のロール付与操作**＝実施後に当該アカウントの全セッション破棄（新権限を確実に適用・A.9-③）。**`company_account_admin`・`system_admin` の付与は system_admin のみ**（会社アカウント管理者・QG管理者は付与不可）。
- **最低 1 名の有効な system_admin を常に残す（不変条件）**: 剥奪（降格）・無効化のいずれでも、**操作後にプラットフォーム全体で `system_role=system_admin` かつ `status=active` のアカウントが 0 名**になる操作は **422 `last_system_admin`** で拒否（ロックアウト防止）。加えて**自分自身の降格は常に不可**（UX 上の自己ロックアウト防止・上と独立のガード）。
- **`memberships` の `role=admin` 指定＝QG管理者任命**は system_admin＋会社アカウント管理者（自社・B.2.1・2026-08-02 改定）。member/admin を per-group に指定。QG管理者自身は member 追加のみで `admin` 任命は不可。
- **バリデーション**: `system_role` は enum（`general`/`company_account_admin`/`system_admin`・`quest_group_admin` は不受理）。`login_id`/`email` 会社内一意（重複=409）。件数上限（memberships）・想定外プロパティ拒否（Mass Assignment 防止・§2.2）。

### B.2.1 会社アカウント管理者による自社アカウント管理（`/admin/accounts`・`company_account_admin`・SoD）

**会社アカウント管理者**（`system_role=company_account_admin`）は、**自社（セッション会社）の全アカウント**のライフサイクルを管理する。パスは**セッション会社固定**（`company_id` を受けない＝クロステナント不可）。操作の実体は B.2 と同じ（発行/編集/disable/enable/password-reset＝outbox で会社DB へミラー・B.5）。**会社設定・プロビジョニング・`system_role` の付与は持たない**が、**per-group `admin`（QG管理者）の任命/剥奪は自社スコープで可能**（2026-08-02 改定・下記＋B.7.2）＝「system_admin が会社アカウント管理者を用意 → 会社アカウント管理者が QG管理者を任命 → QG管理者がメンバーを指定」という委譲運用に対応。

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /admin/accounts` | 自社アカウント一覧（B.2 の `GET .../accounts` と同形） | クエリ: `q`・`status`・`group_id`・`page`/`per_page` | `data`＝アカウント配列（氏名/`login_id`/`email`/`system_role`/`status`＋所属＋グループ内ロール）。`page_info.total` |
| `POST /admin/accounts` | アカウント発行（B.5 発行フロー） | ボディ: `display_name`,`login_id`,`email`,`memberships`（`[{group_id, role: member\|admin}]`） | 発行結果（`status=active`・`password_set=false`）。初回PW設定リンク送信 |
| `PATCH /admin/accounts/{account_id}` | アカウント編集 | ボディ（差分）: `display_name`/`login_id`/`email`/`memberships` | 更新後アカウント（identity は会社内一意） |
| `POST /admin/accounts/{account_id}/disable` ／ `/enable` | 無効化⇄再有効化 | — | 状態更新（B.2 と同挙動＝全セッション破棄＋信頼端末失効） |
| `POST /admin/accounts/{account_id}/password-reset` | 初回/再設定PWリンク再送 | — | 送信結果（A.7） |

- **認可条件（B.2.1 全エンドポイント・共通）**: B.0.1 の P1〜P6＋`session.system_role == "company_account_admin"`（`system_admin` も上位互換で可）。対象は**セッション会社のアカウントのみ**（他会社は経路上そもそも不可＝`company_id` を受けない）。
- **できる操作＝per-group `admin` の任命/剥奪（自社・2026-08-02 改定）**: `memberships` に **`role=admin` を含めてよい**（自社の任意アカウントを QG管理者にする/解除する）。**なぜ許すか**＝per-group `admin` は「特定グループの参加追加/除外だけ」の**下位権限**で、会社アカ管理者が既に持つ破壊系（発行/無効化/PW）より弱く、自社スコープに閉じるため**新たな越権にならない**（B.7.2）。付与/剥奪は `system_audit_logs` に記録。
- **不可操作（＝system_admin との差・403/422）**: **`system_role` の変更（`company_account_admin`/`system_admin` の付与・降格）は不可**（＝“同格/上位を増やす”真の権限昇格は system_admin に集約）。よって発行/編集で作れる/変更できるのは **`system_role=general` のアカウントのみ**（`admin` は per-group ロールなので `system_role` ではなく `memberships` 側＝可）。会社設定（`/settings`）・会社作成/プロビジョニング（B.1）も不可。
- **`last_system_admin` 等の不変条件**：会社アカ管理者は system_admin を作れない/降格できないため、この経路で最後の system_admin を失う操作は発生しない（disable 対象が system_admin の場合は §8-⑯ の趣旨により**拒否**＝会社アカ管理者は system_admin アカウントを disable できない・**422/403**）。
- **監査**：発行/編集/disable/PW は `system_audit_logs` に記録（B.6・操作者=会社アカウント管理者）。

## B.3 所属・グループ内ロール（system_admin 専用・SC-92）

- **認可条件（B.3・共通）**: **system_admin 専用**（B.0.1 P1〜P6＋`system_role==system_admin`）。この API（`/admin/companies/{company_id}/*`＝クロステナント）での所属/ロール一括設定は system_admin のみ。**per-group `admin`（QG管理者）の付与/剥奪自体は、自社スコープでは会社アカウント管理者も可**（B.2.1・2026-08-02 改定）＝ただし経路が違う（会社アカ管理者は `/admin/accounts`）。QG管理者はいずれの `admin` 付与もできない（使えるのは B.4 のみ・member 追加のみ）。


- `GET /admin/companies/{company_id}/quest-groups` … 割当候補（この会社のクエストグループ一覧・会社DB `quest_groups`）。
- アカウントの所属は **B.2 の `memberships`**（発行/編集の payload）で一括設定＝**会社DB `quest_group_members` を upsert/トゥームストーン**（差分適用）。
  - 追加＝行を作成（or `removed_at` を NULL に戻して再所属）。解除＝`removed_at` を設定（**論理削除・監査保持**・§5.5）。ロール変更＝`role` 更新。
  - **`admin` の付与/剥奪は system_admin＋会社アカウント管理者（自社・2026-08-02 改定）**（QG管理者は不可）。**部分ユニーク `UNIQUE(quest_group_id,user_id) WHERE removed_at IS NULL`** を尊重（重複所属不可）。
- 会社DB 書き込みのため対象会社の `get_tenant_session`（§1.5）で解決。**account 側（管理DB）更新とは別 DB のため単一 Tx にできない**＝発行時は B.5 の outbox に相乗、既存アカウントの所属変更は user ミラー存在済みのため会社DB へ直接適用（冪等）。

## B.4 QG管理者 API（`/admin/quest-groups`・`/admin/company-directory`・SC-90）＝参加選択専任（SoD）

**QG管理者は「参加管理（メンバーシップ）」専任**（§8-⑯）＝自社ディレクトリから既存アカウントを選び、**自分が `admin` のグループへ参加追加/除外**する。**アカウントの発行/無効化/identity 編集/PW 再設定は持たない**（会社アカウント管理者＝B.2.1 の領分）。`company_id` は**セッション会社固定**（受け取らない）。

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /admin/quest-groups` | 自分が `admin` のグループ一覧を取得（SC-90 グループ切替） | （セッション会社固定・パラメータなし） | `data`=グループの配列（メンバー数付き）。空なら SC-90 自体が **403** |
| `GET /admin/quest-groups/{group_id}/members` | そのグループの参加メンバー一覧を取得 | パス: `group_id`／クエリ: `q`・`status` | `data`=メンバーの配列（会社DB `quest_group_members`×`users`＝`removed_at IS NULL`） |
| `POST /admin/quest-groups/{group_id}/members` | **既存アカウントを自グループに参加追加** | パス: `group_id`／ボディ: `account_id`（ディレクトリで選択） | 追加された所属（`quest_group_members` に行作成 or `removed_at` を NULL に戻す・`role=member` 固定） |
| `DELETE /admin/quest-groups/{group_id}/members/{account_id}` | **自グループから除外**（per-group トゥームストーン） | パス: `group_id`,`account_id` | 204。`removed_at` を設定（**論理削除・監査保持**・§5.5）。**アカウント本体は無効化しない**（会社レベルに影響しない） |
| `GET /admin/company-directory` | **自社アカウント・ディレクトリを参照**（参加追加の候補選択） | クエリ: `q`（氏名/login_id の**ターゲット照会**）・`page`/`per_page` | `data`=最小射影（`account_id`/`display_name`/`avatar_url`）。**`email`/`system_role`/他グループ所属は返さない**。`status='active'` のみ |

- **認可条件（`/admin/quest-groups/*`）**: **QG管理者**＝B.0.1 の P1〜P6＋**`group_id` がセッション会社に属し・呼び出し元が当該グループに有効 `admin` 所属を持つ**。満たさなければ **404 `not_found`**（存在秘匿）。※判定は**所属ベース**＝`system_admin`・`company_account_admin` でも当該グループに `admin` 所属が無ければ 404（全社操作は B.1/B.2・アカ管理は B.2.1）。
- **認可条件（`/admin/company-directory`）**: **QG管理者**（少なくとも 1 グループで有効 `admin` 所属＝SC-90 に到達できる者）。**会社内アカウントの存在は開示してよい**という明示的な信頼判断（緩和・2026-08-01・データモデル §8-⑯／B.7.2）。ただし**最小射影**（PII・role・組織構造は出さない）。
- **参加追加/除外の作用範囲＝グループスコープに限定（SoD の肝）**: `POST/DELETE members` は**会社DB `quest_group_members` の per-group 行だけ**を操作＝**アカウント本体（`accounts.status`・identity）には一切触れない**。よって「任意垢を追加→無効化で会社全体を破壊」は**構造的に不可能**。除外は当該グループの所属を落とすだけ（他グループ所属・アカウント本体は不変・§5.5 の部分ユニークを尊重）。
- **参加追加が与えるもの＝eligibility のみ**: グループ参加は「そのグループのクエストのパーティーに入れる資格」を与えるだけで、**クエスト/アイデアの実閲覧はパーティー追加が必要**（ドメイン C／非パーティーは 404）。よって一方的追加でも業務コンテンツは露出しない（MVP は一方的追加で可・同意フローは B.7）。
- **`admin` 付与は不可**（QG管理者は member 追加のみ）＝`admin` 昇格は system_admin（§8-①）。
- **業務コンテンツ境界は独立**: 自グループ**外**のクエスト・アイデア等は引き続き一覧/検索**不可**（パーティー門番・ドメイン C/D）。ディレクトリ緩和は**アカウント参照のみ**に閉じ、クエスト/アイデアには波及しない。
- **監査**: 参加追加/除外は membership 変更＝`system_audit_logs` に記録（B.6）。

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
2. **最初の system_admin を seed**: `accounts` に運営テナント所属の system_admin（`role=system_admin`）を INSERT → 通常の outbox で会社DB `users` へミラー。初期パスワードの与え方は下記の 3 択（**メールは必須ではない**＝seed は DB 直アクセスのため）。
3. **初回ログイン**: 運営テナントの会社コードでログイン → （下記いずれかで設定済みの）PW でログイン → 以後 `/admin/companies/*`（B.1/B.2）で各社と各社アカウントを発行。

- **初期パスワードの与え方（2026-08-02 改定・メール依存を必須にしない）**: ブートストラップは seed が DB へ直接書けるため、一般アカウントの招待フロー（メールリンク）を**必須にはしない**。
  - **(a) 既定＝シークレットから直接投入**: seed が**安全に供給された初期パスワード**（環境変数 例 `BOOTSTRAP_ADMIN_PASSWORD`）を **Argon2id でハッシュして `password_set=true`** で INSERT ＝メール基盤不要。**初回ログイン時に強制変更**（運営者自身のPWにさせる＝ドメイン K の自己PW変更、または専用の初回強制変更フラグ）。
  - **(b) メールリンク（A.7 流用）**: メール基盤（dev=MailHog/prod=SMTP）が起動時に稼働している環境なら、`password_set=false` で seed し `otp_challenges` purpose=`password_setup`（72h）で設定してもよい。
  - **(c) out-of-band トークン**: `password_set=false` のまま、setup トークンを**メールでなく seed がコンソール/ログ等の運用チャネルに出力**して渡す（メール依存を外す）。
  - **禁止**: **デフォルト値／ハードコードされた既知パスワードは不可**（必ず供給された強い秘密を使う。B.7.1「取り消せない/既知の資格情報を作らない」の精神）。(a) を採る場合も定数を埋め込まない。
  - 補足: OPS テナントの `mfa_required` を ON にすると初回ログインで OTP メールも要る＝ブートストラップは (a)＋OPS の MFA を運用で調整（初回は OFF 等）すると外部依存ゼロで起動できる。

- **会社レス（`company_id` を持たない）アカウントは非採用**（案A）＝`accounts.company_id` は `NOT NULL` 維持。system_admin の認可は**所属ではなく role**（コントロールプレーン・B.0）なので、運営テナント所属でも全社を管理でき、かつ業務クエストに参加しなくてよい。
- **保護**: **運営テナント・最後の system_admin は削除/無効化不可**（ロックアウト防止・B.6）。
- **将来（案B）**: 監査で「運営者はテナントデータに構造的にアクセス不能」を保証する要件が出たら、コントロールプレーン専用の運用者アイデンティティ＋専用ログイン経路へ拡張（B.7）。

## B.6 セキュリティ対策マッピング（`doc/WEBアプリ開発時のセキュリティ対策一覧.md` 突合・§2認可/4入力/9API/15ログ/18業務）

- **認可（2）**: 全エンドポイントでサーバー強制。**IDOR 対策**＝`company_id`/`group_id`/`account_id` の書き換えで範囲外に触れないよう、system_admin=ロール＋対象会社、会社アカウント管理者=`system_role`＋セッション会社固定、QG管理者=対象グループの `admin` 所属を都度検証（範囲外は 404）。**クロステナント遮断**（会社アカ管理・QG API はセッション会社固定）。CRUD 個別権限（発行/編集/無効化/PW再設定）を分離。**退職・異動時の権限停止**＝disable＋所属トゥームストーン＋セッション破棄。
- **職務分離（SoD・2-⑱／§8-⑯）**: **アカウントのライフサイクル管理（会社アカウント管理者・B.2.1）**と**参加管理（QG管理者・B.4）**を分離＝QG管理者はアカウント破壊系（disable/identity/PW）を持たない。これにより「QG管理者が任意垢を自グループに追加→無効化/改変で会社全体を破壊/乗っ取り」という**権限昇格を構造的に遮断**（B.7.1 の不死垢とは別の、最小権限による防御）。**`system_role` の付与（`system_admin`/`company_account_admin`）は system_admin のみ**（真の昇格＝同格/上位を増やす操作を集約）。**per-group `admin`（QG管理者）の任命/剥奪は system_admin＋会社アカウント管理者（自社スコープ）**（2026-08-02 改定・B.2.1／B.7.2）＝下位権限の委譲で越権にならない。会社アカ管理者は system_admin を作成/降格/disable できない（`last_system_admin` 不変条件を迂回させない）。
- **権限変更履歴（2-⑬）**: `system_role` 変更・グループ内 `role` 変更・disable/enable・会社設定変更を**監査記録**（`system_audit_logs`＝データモデル §4.5・操作者/対象/前後/日時/IP・UA）。PW・トークン等の機密は非出力（§15・A.9-⑥）。
- **入力検証（4）**: enum 限定（`system_role`/`status`/`role`）、会社コード/コード形式、件数上限、想定外プロパティ拒否（**Mass Assignment 防止**・§9）。
- **API（9）**: 一覧は最大件数＋ページング必須（§1.8）。レスポンスに不要項目を含めない（`password_hash` 等は絶対に返さない）。DBモデル直返し禁止（Pydantic DTO・§3.2）。
- **業務ロジック（18）**: 発行の二重送信は `Idempotency-Key`（§1.9）。**最後の system_admin 剥奪/無効化を拒否＋運営テナント（予約会社）の削除/無効化を拒否**（ロックアウト防止・B.5.1）。会社 `suspended` 中の一般アクセス遮断。

## B.7 未確定（実装時に確定でも可）

- **DBプロビジョニングの自動化**（MVP 手動 compose／将来 Docker Engine API・k8s＋CloudNativePG）＝会社 `active` 化トリガの API 化（SC-91 §9）。
- **会社の停止/削除・データ保持/エクスポート**（テナント退会フロー・SC-92 §9）。
- **会社単位の追加設定**（XP日次上限・添付上限・機能フラグを会社別に持たせるか・SC-92 §9）。
- **監査ログ専用 UI**（記録は共通監査列＋`system_audit_logs`・表示 UI は後回し＝SC-90/92 §9）。
- **~~共有アカウントに対する QG管理者編集の作用範囲~~（解消・2026-08-01）**: 職務分離（§8-⑯）で **QG管理者から identity 編集・無効化を撤廃**（会社アカウント管理者 B.2.1 に移管・QG管理者は per-group 参加追加/除外のみ）。よって「共有アカウントへの会社全体作用」は QG管理者経路では発生しない＝**本 TBD は解消**。会社アカウント管理者は会社スコープで全アカウントを管理する前提（共有アカウントの帰属曖昧なし）。
- **参加追加の同意要否**（一方的追加のままでよいか・招待/同意フローを将来入れるか）＝MVP は一方的追加で可（グループ参加は eligibility のみで業務コンテンツ非露出・B.4）。厳密化するなら招待フロー（B.7.2）。
- **~~会社アカウント管理者の画面／QG管理者画面 SC-90 の参加ピッカー化~~（解消・2026-08-02・画面フェーズで確定）**: **会社アカウント管理者の画面＝新規 SC-93 を作成**（SC-92 委譲は不採用＝自社固定・ロール付与なしのスコープが system_admin の全社クロステナント前提〔`?company`・文脈バナー〕と相容れず出し分けが複雑化するため）。**SC-90＝参加ピッカー化**（発行/無効化/identity/PW を撤去し、`GET /admin/company-directory` から既存アカウントを選んで `POST/DELETE /admin/quest-groups/{group_id}/members` で参加追加/除外へ）。**SC-92＝system_role を 3 値表示**（一般/会社アカウント管理者/システム管理者）。反映＝`SC-90_クエストグループ管理.md`/`SC-93_会社アカウント管理.md`（新規）/`SC-92_会社詳細.md`＋各モック・`画面遷移図.md`・`SC-01`（管理導線）・`mocks/index.html`。
- **CSV 一括発行/無効化**は MVP 見送り（SC-90 §9）。
- **運営者アイデンティティの構造分離（案B・将来）**: MVP は運営テナント収容（B.5.1・案A）。厳密な職務分離（運営者はテナントデータに構造的にアクセス不能）が要件化されたら、コントロールプレーン専用の運用者テーブル＋専用ログイン経路（会社コード非依存）へ拡張するか。運営テナントの会社コード予約値・seed 投入方式（migration/初期化スクリプト）の実装細部も併せて確定。

### B.7.1 却下案（検討したが採用しない・理由付き）

- **【却下】「誰からも降格/無効化できない不死の system_admin（保護ルート垢）」（2026-08-01 検討・不採用）**: シードで 1 名だけ登録し、自己降格に加え**他ユーザーからの降格/無効化も一律拒否**する特別な system_admin を作る案。**却下理由＝「取り消せない資格情報（キルスイッチの無いアカウント）」を意図的に作ることになり危険**。
  - **(a) 侵害時に止められない**: 認証情報の漏洩・内部者の悪用が判明しても、システム機能では無効化も降格もできず、復旧が DB 直操作/再シード/再デプロイに限られる＝インシデント対応が破綻。
  - **(b) 単一侵害点の増幅**: 唯一の不死垢は最高価値の標的で、奪われると恒久的な支配を許す（通常垢なら他 admin が即 `disable` 可能）。
  - **(c) 目的（ロックアウト防止）は既存の動的不変条件で達成済み**: 「有効な system_admin を最低 1 名は常に残す（0 になる降格/無効化を 422 `last_system_admin` で拒否）」（B.2）で**特定垢を不死にせずに**ロックアウトを防げる。この動的ルールの方が、侵害された admin を（他に 1 名以上いる限り）**即 revoke できる**ぶん安全＝キルスイッチが常にある。不死垢を足しても得られる安全性は同じで、リスクだけが増える＝割に合わない。
  - **代替（採用方針）**: 復旧の錨が要るなら **(i) 動的不変条件のみ（現状・全垢 revocable）**、**(ii) ブレークグラス垢＝シードで用意するが通常は `disabled`/封印〔認証情報はオフライン保管〕・有効化/使用時に監査＋アラート・強力 MFA・使用後に無効化/ローテーション**（revocable のまま封印するだけ）、**(iii) インフラ再シード（B.5.1）を最終復旧路**（復旧路をログイン垢でなく“ホスト/DB 権限”という強い信頼境界に置く）。**原則＝ブレークグラスは「使いにくく・全監査」であって「無効化不能」ではない**。
  - ※「**自分自身の降格は常に不可**」（B.2）は残す＝他者が救済できるため危険性が無い UX ガード。

### B.7.2 採用した設計判断（理由付き・2026-08-01）

- **【採用】会社内アカウント・ディレクトリを QG管理者に開示（緩和）＋既存アカウントの参加追加を可**: 従来 QG管理者に会社ロスターを隠していた方針を、**「会社内ディレクトリは QG管理者に開示してよい」という明示的な信頼判断**へ変更（社内アドレス帳相当・多くの社内ツールで許容）。**なぜ**＝QG管理者が「既に登録済みの login_id を自 QG に参加させる」導線を持てるようにするため（従来は発行=409 で不可・他グループ垢は 404 で選べなかった）。**懸念への対処**＝(1) 射影を最小化（`account_id`/氏名/アバターのみ・`email`/`system_role`/他グループ所属は非開示＝PII・組織構造・system_admin 標的化を防ぐ）、(2) テナント跨ぎ不可（セッション会社固定）、(3) 監査記録。**業務コンテンツ（クエスト/アイデア）は緩和対象外**＝パーティー門番で独立に閉じたまま（ドメイン C/D）。
- **【採用】アカウント管理と参加管理の職務分離（会社アカウント管理者を新設）**: 上のディレクトリ緩和を安全に成立させる前提として、**QG管理者からアカウント破壊系（disable/identity/PW）を撤廃**し、会社スコープの**会社アカウント管理者**（`company_account_admin`）へ移管（§8-⑯・B.2.1/B.4）。**なぜ**＝緩和後に QG管理者が破壊系を持つと「任意垢を追加→無効化/改変で会社全体を破壊/乗っ取り」の権限昇格が生じるため。SoD＝最小権限でこれを構造的に遮断。会社スコープ役割は `system_role` に格納（B案の原則「スコープ↔保管場所を一致」・per-group には入れない）。
- **【採用・2026-08-02 改定】会社アカウント管理者に per-group `admin`（QG管理者）任命/剥奪を許可**: 当初は「ロール付与は全部 system_admin に集約」（§8-①の保守的な一括ルール）で company_account_admin にも `admin` 任命を禁じていたが、**委譲運用**（system_admin が会社アカウント管理者を用意〔QG無し〕→ **会社アカウント管理者が QG管理者を任命** → QG管理者がメンバー指定）を可能にするため解禁。**なぜ安全か**＝(1) per-group `admin` は「特定グループの参加追加/除外だけ」の**下位権限**で、会社アカ管理者が既に持つ破壊系（発行/無効化/PW）より弱い＝**越権にならない**、(2) **自社スコープに閉じる**（クロステナント不可）、(3) 付与/剥奪を監査記録。**境界は維持**＝「同格/上位を増やす」`system_role` 付与（`company_account_admin`/`system_admin`）は引き続き **system_admin のみ**（真の権限昇格は集約）。QG管理者は従来どおり **member 追加のみ**（`admin` 任命不可）。**画面反映**＝SC-93 の所属エディタに member/admin セグメントを追加。
