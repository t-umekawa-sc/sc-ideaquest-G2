# テストパターン N. 情報インプット（外部情報の知識レイヤ・SC-50）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/N_情報インプット.md`](../API設計/N_情報インプット.md)（N.1〜N.9）・[`../データモデル.md`](../データモデル.md) §5.33〜§5.37・§3（`info_*` enum）・[`../画面設計/screens/SC-50_情報インプット.md`](../画面設計/screens/SC-50_情報インプット.md)。エラー code の網羅は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン N（情報インプット）の縦スライス。repository（永続化・一覧クエリ）＋ application/router（API）を TC-ID（`N-TC-<連番>`）で結ぶ。
> **本 md は先行（テスト規約 §5.2）**＝Phase A（一覧サーバー委譲＋ワードクラウド）を先に記載し、実装済みテストと TC-ID を一致させる（`scripts/check_tc_traceability.py` で双方向照合）。Phase B（詳細）・C（登録/編集/続報）・D（仕上げ）は実装スライスごとに TC 行を追記する。
> 前提フィクスチャ＝seed 会社 ACME-01（会社DB あり）／一般ユーザー `user@acme.example`。repository テストは前提（ユーザー/情報/トークン）を ORM で直接 seed し teardown で物理削除。API テストは seed 一般ユーザーでログインし会社DB に直接 seed。
> 認可メモ＝情報プールは**会社内 active ユーザーなら閲覧可**（クエスト門番ではない・N.0）。一覧/ワードクラウドは読み取り＝`require_me` のみ。

## 1. repository（一覧クエリ・ワードクラウド集計・N.1/N.6・§5.33-5.36）

> 対象＝`app/tenant/info/repository.py`。既定の可視範囲（archived 除外）・status/分類フィルタ・全文検索（PGroonga `&@~`）・keyset カーソル・派生集計（`link_count`/`follow_up_count`）・ソートのホワイトリスト・ワードクラウド集計を検証。呼び出し側 Tx 相乗（自身では commit しない）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-001 | int | 一覧の既定＝archived 除外・新着降順 | raw/curated/archived を各1件＋created_at 差 | `list_info_items`（フィルタ無し） | archived を除外し raw/curated のみ・`created_at DESC` | N.1／§5.33 |
| N-TC-002 | int | status フィルタ（多値 OR・archived 明示は含む） | raw/curated/archived を seed | `list_info_items(status=["curated"])`／`["archived"]` | 指定 status のみ返す（archived 明示時のみ archived を含む） | N.1／§1.8.1② |
| N-TC-003 | int | 分類フィルタ（impact_class 多値 OR） | impact_class=opportunity/threat/None を seed | `list_info_items(impact_class=["threat"])` | threat のみ返す | N.1／§1.8.1② |
| N-TC-004 | int | 全文検索 `q`（title＋body_text・PGroonga `&@~`） | 本文にキーワードを含む/含まない情報 | `list_info_items(q="半導体")` | 該当語を含む行のみ（バインド変数・§2.2③） | N.1／§1.11 |
| N-TC-005 | int | 番号ページャ（offset/limit・`-created_at,id`） | 情報 raw/curated 5件（created_at 差） | `build_info_list_query` に offset/limit を適用 | 重複なく `created_at DESC` で続きを返す（DataTable サーバー委譲＝番号ページャ・§1.8.1） | N.1／§1.8.1 |
| N-TC-006 | int | 派生集計（`link_count`＝未棄却のみ・`follow_up_count`） | 情報に未棄却/棄却リンク＋続報2件 | `list_info_items` | `link_count`=未棄却リンク数・`follow_up_count`=続報数 | N.1／§5.35／§12-1 |
| N-TC-007 | int | ソートのホワイトリスト（`priority`／未知キー） | priority 差の情報 | `list_info_items(sort=[("priority",False)])`／未知キー | priority 昇順で返す／未知キーは呼び出し側で 422（下記 api） | N.1／§1.8.1① |
| N-TC-008 | int | ワードクラウド集計（token GROUP BY・count 降順・limit） | info_tokens に token/count を seed | `word_cloud(limit=3)` | count 降順の上位3 token を `{token,count,weight}` で返す | N.6／§5.36 |
| N-TC-009 | int | 続報を束ねる（roots_only＝根のみ） | 根＋続報を seed | `build_info_list_query(roots_only=True)` | `parent_info_id IS NULL` の根のみ返す（続報は除外） | N.1／§12-1 |
| N-TC-010 | int | 詳細集計（categories/links〔target_title 解決・rejected 含む〕/thread/tokens_top） | 情報＋カテゴリ＋リンク（実 idea/quest＋棄却）＋続報＋トークン | `get_info_item`／`links_for_item`／`resolve_link_titles`／`follow_up_items`／`tokens_top` | 各集計が正（棄却リンクは rejected=true・target_title は idea/quest から解決・続報は時系列） | N.1／§5.33-5.36 |
| N-TC-011 | int | 情報判定権限の判定（is_curator） | curator 付与／未付与／剥奪(revoked) | `is_curator(user_id)` | 付与=true・未付与/剥奪=false | N.0／§5.37 |
| N-TC-012 | int | 派生（サニタイズ／平文／トークン抽出） | script/on*/javascript: を含む body_html | `derive.sanitize_html`／`to_plain_text`／`extract_tokens` | script/on*/javascript: を除去・平文抽出・内容語トークン（頻度） | N.6／N.7／§12-2/12-4 |
| N-TC-013 | int | 低摩擦登録（create_info_item＋派生保存） | ユーザー seed | `create_info_item`（title＋body_html） | status=raw・created_by 正・body_text/summary 派生・info_tokens 保存 | N.2／§12-2/12-3 |
| N-TC-014 | int | 続報＝親リンクのスナップショット複製 | 親（未棄却/棄却リンク）＋続報登録 | `create_info_item(parent_info_id=…)` | 親の**未棄却**リンクを `origin=auto` で複製・棄却は複製しない | N.2／§12-1 |
| N-TC-015 | int | 版スナップショット／カテゴリ置換 | 情報1件 | `add_revision` ×2／`replace_categories` ×2 | revision が 1→2 の連番／categories は後の集合で全置換（重複なし） | N.2／§5.34／§12 |
| N-TC-016 | int | 手動リンク作成／重複検出 | 情報1件 | `create_link`／`find_link`（同一 (info,target,type)） | 作成＝origin=manual・既定 kind=related／同一組は既存を検出 | N.3／§5.35 |
| N-TC-017 | int | リンク候補のタイトル検索 | quest/idea を seed | `search_link_candidates(target_type,q)` | 該当成果物を `{target_type,target_id,title}` で返す／未実装ドメイン(concepts)は空 | N.3 |

## 2. 一覧・ワードクラウド API（SC-50・N.1）

> 対象＝`GET /info-items`・`GET /info-items/word-cloud`（`app/tenant/info/router.py`・`application.py`）。DTO 形状・全文検索・入力検証・認可・テナント分離を検証。DataTable 契約＝§1.8.1（sort ホワイトリスト・カーソル）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-101 | api | 一覧が card DTO 形状で返る | seed 会社に情報を seed | `GET /info-items` | `data[]` に id/title/summary/status/priority/impact_class/categories/source/source_url/due_date/created_by/created_at/link_count/parent_info_id/follow_up_count・`page_info` 正 | N.1／SC-50 |
| N-TC-102 | api | status enum の入力検証 | ログイン済 | `GET /info-items?status=bogus` | 422 `validation_error`・`errors[].field="status"` | N.1／§1.7 |
| N-TC-103 | api | 未知ソートキーは 422 | ログイン済 | `GET /info-items?sort=bogus` | 422 `validation_error`・`errors[].field="sort"` | §1.8.1（ホワイトリスト） |
| N-TC-104 | api | 未認証遮断 | セッション無し | `GET /info-items` | 401 `unauthenticated` | require_me（N.0） |
| N-TC-105 | api | 全文検索タブ（`q`）でヒット行のみ | 本文に語を含む/含まない情報 | `GET /info-items?q=<語>` | 該当語を含む情報のみ返る | N.1／§1.11 |
| N-TC-106 | api | ワードクラウドが tokens[] を返す | info_tokens を seed | `GET /info-items/word-cloud` | `tokens[]`＝`{token,count,weight}`（count 降順） | N.6／SC-50 |
| N-TC-107 | api | 状態 facet 件数（すべて/未判定/判定済） | raw/curated/archived を seed | `GET /info-items` | `facets.status`＝`{all,raw,curated}`（archived 除外・現行フィルタ反映・タブ件数バッジ用） | N.1／SC-50 |
| N-TC-108 | api | 詳細が DTO 形状（全属性＋links target_title＋thread＋tokens_top＋can） | 情報＋関連 seed | `GET /info-items/{id}` | 全属性・`links[].target_title`・`thread`（parent/follow_ups）・`tokens_top`・`can` を返す | N.1／SC-52 |
| N-TC-109 | api | can フラグ（作成者/curator/全員） | 作成者本人でログイン／curator 付与有無 | `GET /info-items/{id}` | `can.edit_content`＝作成者のみ true／`can.curate`＝curator のみ true／`can.add_link`＝常に true | N.0／SC-50 |
| N-TC-110 | api | 不在/他テナントは 404 | ログイン済 | `GET /info-items/<不在id>` | 404 `not_found`（存在秘匿） | N.0 |
| N-TC-111 | api | 未認証遮断 | セッション無し | `GET /info-items/{id}` | 401 `unauthenticated` | require_me（N.0） |
| N-TC-112 | api | 低摩擦登録（全員・201・派生） | ログイン済 | `POST /info-items`（title＋body_html） | 201・`status=raw`・body サニタイズ→body_text→tokens→summary・詳細 DTO を返す | N.2／§12 |
| N-TC-113 | api | 出典URL 検証（http/https のみ） | ログイン済 | `POST /info-items`（`source_url=javascript:...`） | 422 `validation_error`（`errors[].field="source_url"`） | N.7 |
| N-TC-114 | api | title 必須 | ログイン済 | `POST /info-items`（title 空） | 422 `validation_error`（`errors[].field="title"`） | N.2／§C.6 |
| N-TC-115 | api | 内容編集（作成者・再派生＋履歴） | 作成者本人でログイン | `PATCH /info-items/{id}`（body_html 変更） | body 再サニタイズ→body_text/summary/tokens 再生成・内容の版が1件増える | N.2／§12 |
| N-TC-116 | api | キュレーション（curator・raw→curated） | curator 付与＋raw 情報 | `PATCH /info-items/{id}`（priority/categories） | 属性/カテゴリ反映・`status` raw→curated | N.2 |
| N-TC-117 | api | 越権は 403 | 非作成者が内容／非curator が属性 | `PATCH /info-items/{id}` | 403 `forbidden`（内容=作成者のみ／属性=curator のみ） | N.0／§2.2 |
| N-TC-119 | api | 手動リンク追加（全員・related 既定） | ログイン済＋情報 | `POST /info-links` | 201・`origin=manual`・`kind=related`・`target_title` 解決 | N.3 |
| N-TC-120 | api | 重複リンクは 409 | 同一 (info,target,type) を2回 | `POST /info-links` ×2 | 2回目は 409 `conflict` | N.3 |
| N-TC-121 | api | 種別変更（関連↔裏付け↔反証） | 作成済リンク | `PATCH /info-links/{id}`（kind=refuting） | kind 更新 | N.3／§5.35 |
| N-TC-122 | api | 棄却／棄却解除 | 作成済リンク | `POST /info-links/{id}/reject`／`/unreject` | `rejected_at` セット→NULL（詳細で rejected 反映） | N.3 |
| N-TC-123 | api | enum 検証（target_type/kind） | ログイン済 | `POST /info-links`（不正 target_type）／`PATCH`（不正 kind） | 422 `validation_error` | N.3／§1.7 |
| N-TC-124 | api | リンク候補検索 | quest を seed | `GET /info-link-candidates?target_type=quests&q=…` | 該当候補を返す／不正 target_type は 422 | N.3 |
| N-TC-125 | api | 貼付画像の再ホスト（自社 MinIO・署名URL） | ログイン済＋PNG バイト | `POST /info-items/images`（multipart `file`） | 201・`{url}`＝自社ホスト署名URL（外部参照を持ち込まない） | N.2／§12-4／§N.7 |
| N-TC-126 | api | 画像検証（非画像/シグネチャ不一致は 422） | ログイン済＋非画像バイト | `POST /info-items/images`（`file`＝text） | 422 `validation_error`（`errors[].field="file"`） | §1.10／§N.7 |
| N-TC-127 | api | 参考資料の追加（作成者・201・詳細に反映） | 作成者本人でログイン＋PDF/画像 | `POST /info-items/{id}/attachments`（multipart `files`） | 201・追加後の一覧を返す・`GET /info-items/{id}` の `attachments[]` に署名 `url` 付きで現れる | N.2／§5.33 |
| N-TC-128 | api | 参考資料は作成者のみ（越権 403） | 非作成者でログイン | `POST /info-items/{id}/attachments` | 403 `forbidden`（内容群＝作成者のみ・curator も不可） | N.0／§5.33 |
| N-TC-129 | api | 参考資料の削除（作成者・204） | 作成者＋添付1件 | `DELETE /info-items/{id}/attachments/{aid}` | 204・詳細の `attachments[]` から消える／他情報の aid は 404 | N.2／§5.33 |
| N-TC-130 | api | 参考資料の検証（拡張子外/シグネチャ不一致は 422） | 作成者＋不正ファイル | `POST /info-items/{id}/attachments`（`.exe` 等） | 422 `validation_error`（`errors[].field="files"`）・部分保存しない | §1.10／§5.12 |
| N-TC-131 | api | アーカイブ（curator・論理削除） | curator 付与＋curated 情報 | `POST /info-items/{id}/archive` | `status=archived`・既定一覧（archived 除外）から消える・非 curator は 403 | N.2／§5.33 |
| N-TC-132 | api | アーカイブ解除（curator・curated/raw へ復帰） | curator＋archived 情報 | `POST /info-items/{id}/unarchive` | 属性があれば `curated`・無ければ `raw` に戻る・`status=archived` タブから消える | N.2 |
| N-TC-133 | api | 状態 facet に archived 件数／archived タブ取得 | archived を含む seed | `GET /info-items`（facets）／`?status=archived` | `facets.archived` を返す（all=raw+curated＝非archived）・`status=archived` で archived 行のみ返る | N.1／§5.33 |
| N-TC-134 | api | この情報からクエスト作成＝逆リンク自動生成 | ログイン済＋情報 | `POST /quests`（`from_info_id` 指定） | 201・当該情報の詳細 `links[]` に quests への関連リンク（`kind=related`・`origin=manual`・`target_title`=作成クエスト名）が現れる／不在 `from_info_id` は 422 | N.3／C.2／§FR-41 |
| N-TC-135 | api | 未判定の物理削除（本人・raw のみ） | raw 情報の登録者本人 | `DELETE /info-items/{id}` | 204・一覧/詳細から消える（従属行も削除）／非本人は 403／curated 済みは 409 `invalid_state`（archive 誘導） | N.2 |
| N-TC-136 | api | 続報がある情報は削除不可 | raw 情報＋続報あり | `DELETE /info-items/{id}` | 409 `conflict`（`has_follow_ups`）＝孤児化防止 | N.2／§12-1 |

## 3. frontend（一覧の結線・サーバー委譲・SC-50）

> 対象＝`features/info-input/api.ts`（クエリ組立）・`components/InfoListView.tsx`（DataTable server モード）。frontend の unit＝`*.test.ts`（vitest）／e2e＝`e2e/*.spec.ts`（Playwright・seed 会社 ACME-01）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-201 | unit | クエリ組立（roots_only/status/sort ホワイトリスト） | QueryState＋extra | `infoListParams(state,{status,rootsOnly})` | `roots_only=true`・`status`・ホワイトリスト sort/enum のみをクエリに載せる | §1.8.1／N.1 |
| N-TC-202 | e2e | 「続報を束ねる」で再クエリ（回帰） | seed（続報 i2 あり） | `/info-items` で 続報束ねをチェック | 状態タブ件数が減る（続報が除外・DataTable server 再クエリが発火）＝DFT 再発防止 | N.1／§12-1 |
| N-TC-203 | e2e | 一覧ヘッダーのフローティング（列見出し固定） | 低い viewport で `/info-items` | ページを下方向へスクロール | 列見出し行（thead）が画面上部（≈--header-h）に貼り付く＝デザイン標準 §4.5⑨-b | デザイン標準 §4.5⑨-b |
| N-TC-204 | unit | 貼付画像の再ホスト（multipart 送信） | 画像 File | `uploadInfoImageApi(file)` | `POST /info-items/images` に FormData を送り（Content-Type は自動）`url` を返す | N.2／§12-4 |
| N-TC-205 | unit | 参考資料の追加（multipart 複数ファイル） | 複数 File | `addAttachmentsApi(id, files)` | `POST /info-items/{id}/attachments` に同一キー `files` で複数を送り一覧を返す | N.2／§5.33 |
