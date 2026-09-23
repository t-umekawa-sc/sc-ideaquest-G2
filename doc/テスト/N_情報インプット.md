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
| N-TC-137 | api | 情報判定権限の付与/剥奪（管理者のみ） | 会社アカウント管理者でログイン | `POST`/`GET`/`DELETE /info-curators` | 付与 201＋一覧に出現／二重付与 409／剥奪 204＋一覧から消える／未付与の剥奪は 404／**非管理者（一般）は 403** | N.5／§5.37 |
| N-TC-138 | api | 反証リンク作成で揺さぶり通知（作成者/評価者/クエスト管理者） | idea＋quest＋vote を seed | `POST /info-links`（`kind=refuting`・ideas 宛て） | idea 作成者・評価者（投票者）・クエスト所有者に `info_refuting_raised` 通知が届く（付けた本人は除外） | N.3／§N.6 |
| N-TC-139 | api | 種別変更 refuting への遷移で通知 | related リンク＋idea seed | `PATCH /info-links/{id}`（`kind=refuting`） | related→refuting の遷移で宛先に通知が届く（related のままなら通知しない） | N.3／§N.6 |
| N-TC-140 | api | 続報を開くと root 基準の続報スレッドを返す | 続報 fu1/fu2 を持つ根 a | `GET /info-items/{fu1}` | `thread.parent`=根 a・`thread.follow_ups`=根の全続報（fu1/fu2）＝続報からも 根→続報… を辿れる（SC-50 §80） | N.1／§12-1 |
| N-TC-141 | api | 候補に文脈メタを付けて返す（対象ピッカー） | idea(quest所属・起票者・status・time_limit)＋quest(deadline・status) を seed | `GET /info-link-candidates?types=ideas,quests&q=…` | 各候補に `quest_title`/`owner_name`/`status`/`due`（アイデア=time_limit・クエスト=deadline）を付けて返す＝同名でも識別できる | N.3／SC-50 §関連リンク |
| N-TC-142 | api | 候補をクエスト/状態/期限で絞込（対象ピッカー） | 複数 idea/quest を seed | `GET /info-link-candidates`（`quest_ids`/`statuses`/`due_from`/`due_to`） | 指定条件に合致する候補のみ返る（AND・期限未設定は範囲指定時に除外） | N.3／SC-50 §関連リンク |
| N-TC-143 | api | 候補のページング（cursor・対象ピッカー） | limit 超の候補を seed | `GET /info-link-candidates?limit=N` → `?cursor=…` | `next_cursor` を返し、`cursor` 指定で続きが重複なく取れる／最終ページは `next_cursor=null` | N.3／SC-50 §関連リンク |
| N-TC-144 | api | 内容編集で更新履歴を返す（🕘 更新履歴） | 作成者の情報を2回内容編集 | `PATCH /info-items/{id}`×2 → `GET /info-items/{id}` | `content_revisions[]` が版降順で返る（各＝revision/editor_name/created_at）＝編集回数ぶんの版 | N.1／SC-50 §85 |
| N-TC-145 | api | 登録時の属性付与は curator のみ | 一般ユーザー（非curator）／curator 付与 | `POST /info-items`（属性つき＝priority 等） | 非curator＝403 `forbidden`（属性は情報判定権限）／curator＝201・`status=curated` で属性反映。属性なしは全員 201・raw | N.2／SC-50 §85 |
| N-TC-146 | api | 現ユーザーの curator 判定（登録フォーム出し分け） | 一般／curator 付与 | `GET /info-capabilities` | `can_curate` を返す（非curator=false／付与後=true） | N.0／SC-50 §85 |
| N-TC-147 | api | 登録直後に初版（版1）を記録＝更新履歴が作成時から出る（内容編集を待たない） | 情報を登録 | `POST /info-items` | 応答 `content_revisions` が1件・`revision=1`（内容 title/body_html/source_url のスナップショット） | N.1／SC-50 §85 |
| N-TC-148 | api | 選別用要約は約150字で丸める（長文でも一目・末尾…） | 6文以上の長文 body で登録 | `POST /info-items` | `summary` が非空かつ `len<=151`（150字＋末尾…）・句点境界優先で丸め＝`summarize_text(max_chars=150)`。短い本文は無改変（…付けない） | N.6／§12-3／SC-50 |

## 3. frontend（一覧の結線・サーバー委譲・SC-50）

> 対象＝`features/info-input/api.ts`（クエリ組立）・`components/InfoListView.tsx`（DataTable server モード）。frontend の unit＝`*.test.ts`（vitest）／e2e＝`e2e/*.spec.ts`（Playwright・seed 会社 ACME-01）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-201 | unit | クエリ組立（roots_only/status/sort ホワイトリスト） | QueryState＋extra | `infoListParams(state,{status,rootsOnly})` | `roots_only=true`・`status`・ホワイトリスト sort/enum のみをクエリに載せる | §1.8.1／N.1 |
| N-TC-202 | e2e | 「続報を束ねる」で再クエリ（回帰） | seed（続報 i2 あり） | `/info-items` で 続報束ねをチェック | 状態タブ件数が減る（続報が除外・DataTable server 再クエリが発火）＝DFT 再発防止 | N.1／§12-1 |
| N-TC-203 | e2e | 一覧ヘッダーのフローティング（列見出し固定） | 低い viewport で `/info-items` | ページを下方向へスクロール | 列見出し行（thead）が画面上部（≈--header-h）に貼り付く＝デザイン標準 §4.5⑨-b | デザイン標準 §4.5⑨-b |
| N-TC-204 | unit | 貼付画像の再ホスト（multipart 送信） | 画像 File | `uploadInfoImageApi(file)` | `POST /info-items/images` に FormData を送り（Content-Type は自動）`url` を返す | N.2／§12-4 |
| N-TC-205 | unit | 参考資料の追加（multipart 複数ファイル） | 複数 File | `addAttachmentsApi(id, files)` | `POST /info-items/{id}/attachments` に同一キー `files` で複数を送り一覧を返す | N.2／§5.33 |

### 3.1 詳細ダイアログの閉じるガードと無変更保存（SC-52・SC-50 §78）

> 対象＝`components/InfoDetailView.tsx`（dirty 判定・footer「閉じる」）＋`components/InfoDetailModal.tsx`（破棄確認ガード）＋`components/ui/RouteModal.tsx`（`beforeClose`）。範囲＝(1) 未保存（dirty）で閉じる全経路（footer/背景/Esc/×）で破棄確認が出てキャンセルなら残り確定なら閉じる、(2) 無変更で「保存する」を押すと版を増やさず閉じて通知。非対象＝保存成功後の閉じ（ガードしない・§78）・属性/curator 経路（作成者の内容編集で dirty を代表検証）。前提＝seed 会社 ACME-01・`user@acme.example`（一般）が**自分で情報を新規登録**して作成者になる（seed 情報の作成者はデモ user のため編集不可＝自己完結フィクスチャ）。§5.4 に従い「dirty→破棄確認」と「無変更→通知して閉じる」を別トリガとして単独検証する。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-206 | e2e | 未保存で閉じる時の破棄確認（全経路ガード・黙って破棄しない） | 作成者が新規情報を開きタイトルを編集して dirty | footer「閉じる」→確認で「編集に戻る」→再度「閉じる」→「破棄して閉じる」 | 1回目は破棄確認（「編集を破棄しますか？」）が出て「編集に戻る」で詳細が残る／「破棄して閉じる」で閉じる＝dirty を黙って捨てない | SC-50 §78 |
| N-TC-207 | e2e | 無変更で保存＝版を増やさず閉じて通知（他フォームと統一） | 作成者が新規情報を開く（未編集） | フッター「保存する」を押す | ダイアログが閉じ、「変更はありません」トースト（info）が出る＝早期 return で開いたまま残さない | SC-50 §78 |

### 3.2 参考資料ファイル添付＝クリック選択でリストに載る（DFT-N-001）／変更で版が増える（DFT-N-002）

> 対象＝`components/InfoFormPanel.tsx`（登録ダイアログの参考資料）＋`components/InfoDetailView.tsx`（詳細インライン編集の参考資料ステージ）。不具合＝`<input type=file>` の onChange で `addFiles/stageFiles(e.target.files)` を呼んだ直後に `e.target.value = ""` で入力をクリアするが、state 更新関数の中で `Array.from(fl)` を**遅延**評価していたため、更新が走る頃には live な `FileList` が空になり**選んだファイルが 1 件もリストに載らない**（クリック選択経路が全滅・D&D は `value` 未リセットで偶然動作）。修正＝ハンドラ内で **`Array.from` を同期的に materialize** してから setState に渡す（貼付画像側 `insertImageFiles(Array.from(...))` と同作法）。前提＝ACME-01・`user@acme.example`（一般＝作成者）。テストは作成した情報を DELETE で後始末。
>
> **DFT-N-002（版が増えない）**＝詳細で参考資料だけ変更して保存しても版（`info_item_revisions`）が増えなかった。原因＝`InfoDetailView.save` が版を作る `updateInfoItemApi`（PATCH）を内容/属性変更時しか呼ばず、参考資料だけの変更は添付 API のみで PATCH が走らなかった。正＝参考資料は「内容」の一部（§17）で版管理対象・**保存単位で1版**（決定 2026-09-22）。修正＝save で `attachmentsDirty` の時も現内容をスナップショットする PATCH を1回だけ送り、参考資料変更でも版を1つ刻む（内容も同時変更なら合わせて1版）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-208 | e2e | 登録ダイアログで参考資料をファイル選択すると一覧に載る（DFT-N-001） | `user@acme.example` が `/info-items/new` を開く | 参考資料の file input にファイルを選択（onChange＋value リセット経路） | `.attach-list` にファイル名付きの行が 1 件出る＝選択が黙って捨てられない | N.2／§5.33 |
| N-TC-209 | e2e | 詳細インライン編集で参考資料をファイル選択すると一覧に載る（DFT-N-001） | 作成者が自分の情報詳細を開き編集する | 参考資料の file input にファイルを選択（onChange＋value リセット経路） | 追加候補（新規ステージ）にファイル名付きの行が 1 件出る | N.2／§5.33 |
| N-TC-210 | e2e | 参考資料だけ変更して保存すると版が1つ増える（保存単位で1版・DFT-N-002） | 作成者が自分の情報詳細を開く（更新履歴=版1） | 内容は触らず参考資料を1件添付→「保存する」 | 🕘 更新履歴が「1 版」→「2 版」＝参考資料は内容の一部（§17）として版管理され、保存単位で1版だけ増える | SC-50 §17／§79／§85 |

### 3.3 更新履歴で変更内容を見せる（アイデアSC-22相当・§85拡張）

> 対象＝backend `tenant/info/application.py`（`_content_snapshot`＝版スナップショットに参考資料の表示名一覧を追加／`_changed_fields`＝前版比の変更フィールド／`_diff_fields`＋`_text_diff_segments`＝差分算出／`get_info_revision_diff`）・`repository.get_revision`・`schemas`（`InfoRevisionDTO.changed_fields`／`InfoDiffField`／`InfoRevisionDiffResponse`）・`router`（`GET /info-items/{id}/revisions/{revision}/diff`）。frontend `components/InfoRevisionHistory.tsx`（変更フィールドのバッジ＋「差分を表示」で遅延取得）を `InfoDetailView` の 🕘 更新履歴に差し込む。追跡フィールド＝タイトル/本文（HTMLはプレーン化して差分）/出典URL/参考資料。アイデア D.4 の版差分機構と同型（`difflib` 文字差分）。前提＝ACME-01・`user@acme.example`（作成者）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-211 | api | 更新履歴に changed_fields（前版比の変更項目）を付与 | 作成者が既存情報を PATCH で本文更新 | `GET /info-items/{id}` の `content_revisions[]` | 新しい版の `changed_fields` に `body_html` が入る（初版は空）＝どの項目が変わったか分かる | SC-50 §85／N.1 |
| N-TC-212 | api | 版差分 EP＝テキスト差分＋参考資料 old→new | 作成者がタイトル/本文/参考資料を変更して版を積む | `GET /info-items/{id}/revisions/{rev}/diff` | 変わったフィールドのみ返し、title/body_html は `kind=text` の add/del/equal セグメント、attachments は `kind=scalar` の old→new（「・」連結） | SC-50 §85／N.1 |
| N-TC-213 | e2e | 更新履歴が変更内容を見せる（バッジ＋差分展開） | 作成者が自分の情報詳細でタイトルを編集して保存→再度開く | 🕘 更新履歴の最新版を確認し「差分を表示」を展開 | 最新版に変更フィールドのバッジ「タイトル」が付き、展開すると差分（`.diff-add`/`.diff-del`）が出る | SC-50 §85 |

### 3.4 全文検索＝一致箇所を必ず表示（match_snippet・DFT-N-003）

> 不具合＝全文検索は title＋本文（body_text）を対象に一致するのに、結果は要約（先頭抜粋）しか表示せず要約内でしかハイライトしなかった＝要約に出ない箇所（例＝『コメ』が本文の『コメント』にバイグラム一致）で一致すると「該当なしなのに表示」に見えた。修正＝backend `_match_snippet`（title＋本文からキーワード周辺を切り出し `match_snippet` として q あり時のみ返す・両端 …・literal 不在時は None）＋`InfoItemCardDTO.match_snippet`。frontend `InfoListView.highlightNodes`（窓切り出し無しで全一致を `<mark>`）＝検索結果はタイトルを強調し、`match_snippet` があればそれを優先表示（無ければ要約にフォールバック）。前提＝ACME-01・`user@acme.example`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-214 | api | 全文検索は一致箇所の抜粋 match_snippet を返す（要約外の一致も可視化） | 要約に出ない特徴語を本文末尾に持つ情報を作成 | `GET /info-items?q=<特徴語>` と q 無し `GET /info-items` | q あり＝ヒット行の `match_snippet` に特徴語が含まれる／q 無し＝`match_snippet` は null | §1.11 |
| N-TC-215 | e2e | 全文検索結果で一致箇所のハイライトが必ず出る（本文一致・DFT-N-003） | `user@acme.example` が要約外の語を含む情報を作成し全文検索タブでその語を検索 | 全文検索タブでキーワード入力 | ヒットカードの「一致」抜粋に `mark.keyword`（ハイライト）が出る＝該当箇所が見える | §1.11 |

### 3.5 内容・説明の入力欄＝縦に伸びる＋手動リサイズ（登録/詳細）

> 要望＝情報の登録ダイアログ・詳細ダイアログの「内容・説明」（リッチテキスト `.rt__area`）は、最低高さ（`min-height:140px`）は維持しつつ、`max-height`＋内部スクロールをやめて**内容に応じて縦に伸びる**。加えて**ユーザーが縦幅を手動でドラッグ変更できる**（`resize: vertical`＝右下グリップ）。`resize` は `overflow:visible` だと無効なため `overflow:auto` にする。ただし resize のドラッグは固定 `height` を設定するため、そのままだとリサイズ後に内容が超えるとスクロールになる（DFT-N-004）。当初は「ドラッグ高さを min-height に付け替える」方式にしたが、min-height が上方向にしか効かず**一度広げると縮められない**不具合（DFT-N-005）になった。現行方式＝`attachGrowableResize`（`growableResize.ts`・ResizeObserver＋MutationObserver）で **`fit()`＝はみ出す時だけ内容の高さまで伸ばす（縮小はユーザーのドラッグに委ね、内容/`min-height:140px` まで）**。overflow は `hidden`（はみ出しは fit で防ぐ＝スクロールバーを出さない）。対象＝`info-input.css .rt__area`＋`growableResize.ts`（両ダイアログ共通・`InfoFormPanel`/`InfoDetailView` で attach）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| N-TC-216 | e2e | 内容・説明は内部スクロールせず縦に伸びる（登録ダイアログ・最低高さは維持） | `user@acme.example` が `/info-items/new` を開く | 内容欄（`.rt__area`）に高さ 320px を超える長い内容を挿入 | `.rt__area` に内部スクロールが出ない（`scrollHeight ≈ clientHeight`）＝内容に応じて縦に伸びる／空時は最低高さ ≥140px を保つ | SC-50（内容欄の高さ挙動） |
| N-TC-217 | e2e | 内容・説明は手動で縦幅をドラッグ変更できる（登録ダイアログ） | `user@acme.example` が `/info-items/new` を開く | 内容欄（`.rt__area`）の計算スタイルを確認 | `resize: vertical`（縦方向リサイズ可＝右下グリップ）が有効＝ユーザーが縦幅を変更できる | SC-50（内容欄の高さ挙動） |
| N-TC-218 | e2e | 手動リサイズ後も内容で伸びてスクロールが出ない（DFT-N-004） | `user@acme.example` が `/info-items/new` を開く | 内容欄の inline `height` を拡大（＝グリップのドラッグ相当）→ その高さを超える長い内容を挿入 | 拡大値を超える内容でも `fit()` が内容の高さまで伸ばし内部スクロールが出ない（`scrollHeight ≈ clientHeight`・`clientHeight` が拡大値超に伸びる） | SC-50（内容欄の高さ挙動） |
| N-TC-219 | e2e | 拡大後に縮小できる／元サイズ(140px)より下げない（DFT-N-005） | `user@acme.example` が `/info-items/new` を開く | 内容欄を拡大(500px)→縮小(200px)→極小(40px) | 200px まで縮む（`min-height` を付け替えないので縮小可）／40px 指定でも元サイズ `min-height:140px` 付近で下げ止まる | SC-50（内容欄の高さ挙動） |
| N-TC-220 | e2e | 関連リンクの種別変更で**完了トーストが最前面に出る**（モーダル起動中も見える・z-index 回帰） | API で情報＋関連リンク1件（related）を用意→`/info-items/{id}` で「リンクを編集」 | 種別 related→supporting に変更 | `.snackbar`（「関連リンク…」）が表示され、`.snackbar-stack` の z-index がモーダル(80)より十分上（>100）＝背面に隠れない。作成情報は後始末で削除 | SC-52／デザイン標準 §14 |
| N-TC-221 | e2e | 関連リンクの種別変更で**並び順が変わらない**（種別依存の並び替えを起こさない） | API で情報＋関連リンク2件（related）を用意→「リンクを編集」 | 先頭リンクの種別を related→supporting に変更 | 変更前後で `.link-item__title` の並びが不変（フロントで元の表示順を維持・新規は末尾） | SC-52 |
| N-TC-222 | e2e | **棄却済みリンクも対象ピッカーで既存扱い＝結果から除外**（再追加 409 を防ぐ・復活は「戻す」） | API で情報＋リンク1件を作成→`reject` で棄却→「対象を選ぶ」を開く | ピッカーの「既に関連付け済み」を確認 | 棄却済み対象も `.pick-existing` に出て「棄却済み」バッジ付き・**絞り込み結果からは除外**（`find_link` は棄却行も 409 にするため） | SC-52／N.3／§5.35 |
