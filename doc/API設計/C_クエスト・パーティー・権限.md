# ドメイン C. クエスト・パーティー・権限（テナントプレーン）＝詳細確定（2026-07-29）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可〔クエスト内6権限〕・§1.8 一覧・§1.9 冪等）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)、会社/アカウント/所属は [`B_会社・アカウント・所属.md`](./B_会社・アカウント・所属.md)。本ファイルはドメイン C の分割レビュー成果。

対象画面＝**SC-10（クエスト一覧）/ SC-11（クエスト作成・編集モーダル）/ SC-12（クエスト詳細）**。すべて**テナントAPI**（会社DB＝`quests`/`quest_categories`/`quest_members`/`quest_member_permissions`/`quest_groups`/`quest_group_members`）。データモデル §5.4〜5.9・§3（`quest_status`/`permission_type`/`quest_group_role`）。コーディング規約 §1（認可はサーバー強制・フロントは表示/UX のみ）・§2.2（セキュリティ）準拠。

## C.0 アクター・認可スコープ（クエスト内6権限）

**アクセスの門番＝パーティー所属**。当該クエストの `quest_members`（`quest_id`×`user_id`）に行が無いユーザーは、クエスト詳細・アイデア・チャット・全文検索いずれも **404**（存在秘匿・§1.6・可視範囲＝パーティー内のみ）。さらに「所属グループ内」でしか作られないため、`quest_group_members`（`removed_at IS NULL`）に無いグループのクエストも当然 404。

| 権限（`permission_type`） | 代表アクション（本ドメイン） | 付与/剥奪できる者 |
| --- | --- | --- |
| `owner`（所有者） | クエストの全操作。**作成者は既定で所有者・剥奪不可** | **`owner` の他者付与は作成者（`quests.owner_id`）のみ**（README 6節） |
| `quest_admin`（クエスト管理） | クエスト編集（`PATCH`）・パーティー/権限変更・論理削除・状態遷移 | `owner`/`quest_admin` |
| `evaluator`（評価者） | 評価（ドメイン F）。付与対象は参加メンバー限定 | `owner`/`quest_admin` |
| `vote`（投票） | 投票（ドメイン D）。**新規参加の既定権限** | `owner`/`quest_admin` |
| `idea_create`（アイデア作成） | アイデア投稿（ドメイン D）。**新規参加の既定権限** | `owner`/`quest_admin` |
| `comment`（コメント） | チャット投稿（ドメイン E）。**新規参加の既定権限** | `owner`/`quest_admin` |

- **新規参加メンバーの既定権限＝`vote`＋`idea_create`＋`comment`**（サーバーが自動付与・データモデル §5.9）。`owner`/`quest_admin`/`evaluator` は手動付与。
- **作成者の特別扱い**: `quests.owner_id` のユーザーは常に `owner`（剥奪不可）・パーティーから外せない・全操作可。
- **クエスト管理者（QG管理者）とは別概念**: 本ドメインの 6 権限は**クエスト単位**。QG管理者（会社DB `quest_group_members.role=admin`）はアカウント管理（ドメイン B）の権限で、クエスト内の 6 権限とは独立（QG管理者でも非パーティーのクエストは 404）。
- 認可失敗＝**403 `forbidden`**／範囲外（非パーティー・他グループ・他テナント）は**404**／未認証は**401 `unauthenticated`**。

---

## C.1 クエストの取得（一覧・詳細・パーティー）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /quests` | 参加中クエスト一覧を取得（SC-10・FR-15） | クエリ: `q`（件名/テーマ/カテゴリ部分一致）・`status`（`recruiting\|in_progress\|evaluating\|completed`）・`group_id`（所属グループ絞り）・`sort`（`-created_at`〔新着〕/`deadline`〔締切近い〕/`-idea_count`/`-member_count`）・`limit`/`cursor`（カーソル・§1.8） | `data`=クエストカードの配列（`id`/`title`/`color`/`icon_image_path`/`categories[]`/`status`/`deadline`/`member_count`/`idea_count`/`owner`〔アバター〕/`quest_group`＋`my_state`〔未投稿/投稿済み等〕）。`page_info.{next_cursor,has_next}` |
| `GET /quests/{quest_id}` | クエスト詳細を取得（SC-12 ヘッダー/概要タブ） | パス: `quest_id` | クエスト詳細（上記＋`purpose`〔目的・テーマ全文〕/`created_at`）＋**`my_permissions`**（自分が持つ 6 権限の配列＝フロントの UX 出し分け用）＋集計 |
| `GET /quests/{quest_id}/members` | パーティー＋各メンバーの権限を取得（SC-12 パーティータブ） | パス: `quest_id` | `data`=メンバーの配列（`user`〔アバター/氏名〕＋`permissions[]`＋`joined_at`＋`is_creator`）。権限バッジ描画に使用 |

- **参照制限（サーバー強制・FR-15）**: `GET /quests` は「**所属グループ内**（`quest_group_members.removed_at IS NULL`）**× 自分がパーティー参加中**（`quest_members` に行あり）」かつ `deleted_at IS NULL` かつ `status != draft` のクエストのみ返す。パス/クエリで `company_id` は受け取らない（セッション由来・§1.5）。
- **下書き（`draft`）**: 一覧には出さない（作成者本人の下書きは**ダッシュボード**＝ドメイン I が集約）。`GET /quests/{id}` は `draft` の場合 `owner_id` 本人のみ 200・それ以外は 404。
- **`my_permissions`／`my_state`** はサーバーが算出して返す（フロントは権限判定を再実装しない・コーディング規約 §1）。UX 便宜であり、実アクションは各エンドポイントで再検証。
- **クエスト内 週間ランキング**（SC-12 右カラム）は**ドメイン G** で提供＝`GET /rankings?scope=quest:{quest_id}&period=this_week`（当該クエスト活動〔`activities.quest_id`〕の XP＋コイン合算・TOP3＋自分）。本ドメインでは定義しない。
- **クエスト内 全文検索**（SC-12 全文検索タブ）は**ドメイン J**＝`GET /quests/{quest_id}/search`（§1.11）。本ドメインでは定義しない。

## C.2 クエストの作成・編集・削除・公開（SC-11）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `POST /quests` | クエストを作成（SC-11・作成者＝所有者） | ボディ: `title`（必須）,`color`（必須・既定色可）,`categories`（`[string]` 1件以上・事前定義＋自由入力）,`deadline`,`purpose`,`quest_group_id`（必須）,`icon_image_path?`,`members`（`[{user_id, permissions?}]`）,`status`（`draft\|recruiting`）。`Idempotency-Key` 推奨（§1.9） | 作成されたクエスト（`draft` は本人のみ表示・`recruiting` は公開）。作成者を `owner_id`＋`owner` 権限で保存。`quest_group_id` に自分が有効所属していることをサーバー検証 |
| `PATCH /quests/{quest_id}` | クエストを編集（`owner`/`quest_admin`） | パス: `quest_id`／ボディ（差分）: `title`/`color`/`categories`/`deadline`/`purpose`/`icon_image_path` | 更新後のクエスト。`categories` は**置換セット**（送られた配列で `quest_categories` を全置換）。**`quest_group_id` は変更不可**（下記注記） |
| `DELETE /quests/{quest_id}` | クエストを論理削除（`owner`/`quest_admin`） | パス: `quest_id` | 204。`deleted_at`＋`deleted_by_id` を設定（トゥームストーン）。以後一覧/詳細/検索/集計から除外。子データ（カテゴリ/パーティー/アイデア/チャット/評価）は**物理削除せず監査保持**（§5.6・`ON DELETE RESTRICT`） |
| `POST /quests/{quest_id}/publish` | 下書きを公開（`draft` → `recruiting`） | パス: `quest_id` | 公開後のクエスト（`status=recruiting`）。パーティーへ**参加通知**を発火（ドメイン H）。`owner`（作成者）のみ |

- **必須充足**（サーバー検証・§2.2 入力検証）: `title`・`color`・`categories`（1件以上）・`quest_group_id`。未充足は **422 `validation_error`**（`errors[].field` で返却）。`deadline`/`purpose` は任意（データモデル §5.6 は NULL 可＝SC-11 の「必須」表示はフロント UX 上の推奨で、権威はサーバーのこの規約）。
- **カテゴリー**: 配列で受け取り `quest_categories` に展開。**アプリでトリム＋大小文字/全半角を正規化**し `UNIQUE(quest_id, label)` で重複排除（§5.7）。事前定義候補に一致しないラベルは `is_custom=true`。
- **クエストグループの不変性**: `quest_group_id` は**作成時に確定・以後不変**（`PATCH` で受けても無視＝パーティー候補/参照範囲/既存アイデアとの整合を壊さないため。SC-11 §9 の「原則作成時のみ」を本方針で確定）。グループを変えたい場合は作り直し（将来要件は C.7）。
- **クエスト公開に XP は付与しない（確定）**: 公canonical な XP 付与表（README §6）に**クエスト作成/公開の行は無い**（付与＝選定200/投稿50/評価30/ログイン10/投票5/チャット5 のみ）。よって `publish` は通知のみで XP を発生させない。※SC-11 本文の「作成 XP を付与」は画面ドキュメントの表現ゆらぎ＝**要修正**（C.7 に記録）。
- **`publish` の状態前提**: `draft` 以外に対する `publish` は **409 `conflict`**（`invalid_state`）。冪等化のため同一 `Idempotency-Key` 再送は最初の結果を返す。
- **アイコン画像**: `icon_image_path` は MinIO キー（§1.10・別途アップロード API で取得したキーを渡す）。物理名ハッシュ化はアップロード側の責務。

## C.3 パーティー・権限（SC-11 パーティー編集 / SC-12 パーティータブ）

パーティー編集は SC-11 モーダルで**まとめて保存**する UI。これに合わせ**一括差分適用**を主とし、増分操作の粒度エンドポイントも用意する（両立）。

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `PUT /quests/{quest_id}/party` | パーティー＋権限を一括更新（SC-11 モーダル保存） | パス: `quest_id`／ボディ: `members`（`[{user_id, permissions[]}]`＝**あるべき全体像**）。サーバーが現状と差分（追加/削除/権限変更）を算出して適用 | 更新後のパーティー（C.1 `GET .../members` と同形） |
| `POST /quests/{quest_id}/members` | メンバーを 1 名追加（増分 UI 用） | パス: `quest_id`／ボディ: `user_id`,`permissions?`（省略時は既定＝`vote`+`idea_create`+`comment`） | 追加されたメンバー行 |
| `DELETE /quests/{quest_id}/members/{user_id}` | メンバーをパーティーから外す（増分 UI 用） | パス: `quest_id`,`user_id` | 204。権限は失うが**アイデア/投票/評価/コメントは削除せず表示継続**（§5.8） |
| `PUT /quests/{quest_id}/members/{user_id}/permissions` | あるメンバーの権限セットを置換 | パス: `quest_id`,`user_id`／ボディ: `permissions[]`（6 権限の部分集合） | 更新後の権限配列 |

- **サーバー強制ルール**（全経路で再検証・コーディング規約 §1）:
  - **候補制限**: 追加できるのは**当該クエストの所属グループに有効所属**（`quest_group_members.removed_at IS NULL`）のユーザーのみ。範囲外は **422 `validation_error`**（`errors[].field=user_id`）。
  - **`owner` 付与は作成者のみ**: `permissions` に `owner` を含める操作は `quests.owner_id`＝リクエスト者本人のときのみ許可。他者による `owner` 付与は **403 `forbidden`**。
  - **作成者の保護**: 作成者行の `owner` 剥奪・作成者のパーティー除外は不可（**422 `last_owner`/`forbidden`**）。作成者は常に全権限。
  - **編集権限**: `POST/DELETE/PUT` いずれも `owner` または `quest_admin` が必要（`owner` 付与のみさらに作成者限定）。
  - **既定権限の自動付与**: `POST /members` で `permissions` 省略時は `vote`+`idea_create`+`comment` を付与（§5.9）。
  - **重複防止**: `quest_members` は `UNIQUE(quest_id, user_id)`、権限は `UNIQUE(quest_member_id, permission)`（§5.8/5.9）。再追加（過去に外した相手）は既存行を再利用/再作成。
- **`PUT /party` の原子性**: 差分適用は単一 UoW（トランザクション）で実行（コーディング規約 §3.1）。途中失敗は全ロールバック。`owner` を含む差分は作成者チェックを差分適用前に一括検証。
- **可視性の連動**: パーティー変更は**参照範囲**に直結（外れたユーザーは以後 404）。ただし**過去の入力は保持**（§5.8）。

## C.4 クエストグループ・パーティー候補（SC-11 グループ選択 / メンバー追加）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /quest-groups` | 自分が有効所属するグループ一覧（SC-10 フィルタ・SC-11 グループ選択） | クエリ: `q?`（名前部分一致） | `data`=グループの配列（`id`/`quest_group_code`/`name`）。`removed_at IS NULL` のみ |
| `GET /quest-groups/{group_id}/members` | パーティー候補（同一グループの有効メンバー）を取得（SC-11） | パス: `group_id`／クエリ: `q?`・`limit`/`cursor` | `data`=候補ユーザーの配列（`user_id`/氏名/アバター）。`quest_group_members.removed_at IS NULL`＋`users.status='active'` |

- **これはテナントAPI（一般ユーザー向け）**で、**ドメイン B の `/admin/quest-groups/*`（QG管理者のメンバー管理）とは別系統**。門番＝**リクエスト者自身がそのグループに有効所属**していること。非所属グループは **404**（存在秘匿）。
- `GET /quest-groups/{group_id}/members` は SC-11 の「候補から追加」用。大人数グループのための `q`/ページングを備える（SC-11 §9 の候補検索/ページングに対応）。
- グループそのものの作成/改称は運営操作（将来・データモデル §5.4）＝本ドメインは参照のみ。

## C.5 クエスト状態遷移（ライフサイクル）

`quest_status`（§3）＝ `draft` → `recruiting` → `in_progress` → `evaluating` → `completed`。`draft`→`recruiting` は `POST .../publish`（C.2）、以降の前進は状態遷移エンドポイントで表す。

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /quests/{quest_id}/transition` | ステータスを前進（`owner`/`quest_admin`） | ボディ: `to`（`recruiting\|in_progress\|evaluating\|completed`） | 更新後のクエスト |

- **許可遷移（前進のみ・サーバーで強制）**: `draft→recruiting`（＝publish と等価）／`recruiting→in_progress`／`in_progress→evaluating`／`evaluating→completed`。**逆行・飛び越えは 409 `invalid_state`**（MVP。運用戻しは C.7）。
- **`completed`（完了）で書き込み凍結**: 完了後はアイデア投稿/編集/削除・投票・チャット投稿/編集/削除/リアクション・評価を**サーバーが拒否**（読み取り専用・データモデル §8-⑪/各ドメインで再掲）。
- **表示ラベル「選定」について**: SC 画面が示す「選定」は独立した enum 値では**なく**、`evaluating`〜`completed` の過程で行われる「アイデア選定」（＝選定アイデア投稿者へ XP200・ドメイン F/G）の**表示上の呼称**。ステータス機械は §3 の 5 値に従う（C.7 に整理項目として記録）。
- **状態遷移 UI をどこに置くか**（SC-11 に持たせるか専用 UI か）は画面側 TBD（SC-11 §9）＝本 API はエンドポイントを提供し、UI 配置はフロント設計に委ねる。

## C.6 セキュリティ対策マッピング（`doc/WEBアプリ開発時のセキュリティ対策一覧.md` 突合・§2認可/4入力/9API/18業務）

- **認可（2）**: 全エンドポイントでサーバー強制。**IDOR 対策**＝`quest_id`/`user_id`/`group_id` を書き換えても、パーティー所属・グループ所属・6 権限を都度照合し範囲外は **404/403**。可視範囲＝パーティー内のみ（会社/グループ全体へ漏らさない）。**クロステナント遮断**＝`company_id` はセッション由来のみ（§1.5）。
- **入力検証（4）**: `status`/`permission_type` は enum 限定（想定外値は拒否）。`color` はプリセット hex 検証、`categories` は件数上限＋正規化、`title`/`purpose` は長さ上限。**Mass Assignment 防止**＝`owner_id`/`created_by_id`/`updated_by_id`/`*_program`/`deleted_*` はクライアント入力を受けずセッション/サーバーで設定（§1.4）。想定外プロパティは拒否（Pydantic strict）。
- **API（9）**: 一覧はページング必須＋最大 `limit`（§1.8）。DB モデル直返し禁止（Pydantic DTO・§3.2）＝内部列（`deleted_*` 等）を露出しない。
- **業務ロジック（18）**: `POST /quests` の二重送信は `Idempotency-Key`（§1.9）。**状態機械をサーバーで強制**（不正遷移・完了後の書き込みを拒否）。**`owner` 付与は作成者のみ・作成者 `owner` 剥奪不可**（権限昇格の悪用防止）。パーティー除外後も過去入力は保持（改ざん/消失防止・監査）。

## C.7 未確定（実装時に確定でも可）

- **ページング/無限スクロールの閾値**（一覧のカーソル既定 `limit`・超過時の UI・SC-10/12 §9）／フィルタ・ソート・タブ状態の **URL 保持**（`?tab=`・SC-12 §9）。
- **編集でのクエストグループ変更**を許すか（本設計は**作成時のみ・不変**で確定。将来「移設＝パーティー/アイデア再整合込み」を要件化するか・SC-11 §9）。
- **カテゴリーの正規化/重複防止・会社内マスタ昇格**（自由入力ラベルの一元管理・候補への昇格・SC-11 §9）。
- **下書きクエストのパーティー未確定の扱い**（`draft` で `members` 空を許容するか・FR-29/SC-11 §9）。
- **期限日変更**時の締切後アイデア/評価の扱い（ステータス連動・SC-11/12 §9・ドメイン D/F と共通）。
- **状態遷移の逆行/運用戻し**（MVP は前進のみ。誤操作リカバリを system_admin/owner に許すか）・**状態遷移 UI の配置**（SC-11 か専用か・SC-11 §9）。
- **【要ドキュメント修正】クエスト作成 XP の表現ゆらぎ**: SC-11「作成 XP を付与」は canonical な XP 付与表（README §6）に無い＝**SC-11 本文を「公開でパーティー通知（XP 付与なし）」に修正**する（本 API は付与しない・C.2 で確定）。
- **【要整理】「選定」ステータス表記**: SC 画面の「選定」は enum 値ではなく evaluating〜completed の選定行為の呼称。画面表記と `quest_status`（§3）の対応を画面ドキュメント側で注記整理（本 API は §3 の 5 値に従う・C.5）。
