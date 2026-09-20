# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-20 JST**
- ブランチ: **main**。**本セッションの変更は未コミット**（ユーザー承認待ち）。`git status` に新規/変更多数（下記 §3）。`tmp_shots/` は `.gitignore` 追加済で追跡外。
- 最新コミット（push 済・本セッション着手前）: **`33b0a49`**（docs(handoff)）。
- **コミット方針**＝ユーザーが「コミットして」と言うまで**コミットしない**。まとめると1コミット＝「feat(info backend): Phase A 一覧サーバー委譲（4層＋migration 済ORM 結線）＋frontend 結線＋TC/seed」。gitignore は別コミット可。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションする Web アプリ「IDEAQUEST」。現行フェーズ＝**情報インプット機能（FR-41）**の実装。設計完備・frontend 移植完了。**backend は Phase A（一覧＝サーバー委譲）まで結線完了**。残＝詳細（B）→登録/編集/続報（C）→仕上げ（D）。

## 3. 今回やったこと（変更ファイルと理由）
### (a) 情報インプット backend Phase A＝一覧サーバー委譲（新規4層・`app/tenant/info/`）
- `schemas.py`＝`InfoItemCardDTO`（id/parent_info_id/title/summary/status/priority/source/classification/scope/impact_class/categories[]/source_url/due_date/`created_by`〔InfoCreatorDTO=user_id/display_name/avatar_image_url〕/created_at/`link_count`/`follow_up_count`）＋`InfoOffsetPageInfo{total,page,per_page}`＋`InfoStatusFacets{all,raw,curated}`＋`InfoListResponse{data,page_info,facets}`＋`WordCloud*`。enum ホワイトリスト定数も同居。
- `repository.py`＝`build_info_list_query`（archived 既定除外・status/priority/source/impact_class 多値 OR・`roots_only`＝根のみ・q は PGroonga `&@~`〔`_FTS_EXPR`＝`(title|| ' ' ||coalesce(body_text,'')) &@~ :q`・バインド変数〕・sort は `list_query.parse_sort` でホワイトリスト〔created_at/title/status/priority/due_date/link_count〕）＋`status_counts`（facet）＋`link_counts_for_items`（未棄却のみ）＋`follow_up_counts_for_items`＋`categories_for_items`＋`users_by_ids`＋`word_cloud`（info_tokens GROUP BY・count 降順・weight 正規化・archived 除外）。
- `application.py`＝`get_info_items`（quest-catalog パターン＝`_resolve_company`+`get_tenant_session`+`get_user_by_account`・enum/sort 検証で 422・番号ページャ・DTO 組立・facets 同梱）＋`get_word_cloud`。
- `router.py`＝`GET /info-items`（require_me・q/status/priority/source/impact_class/roots_only/sort/page/per_page）・`GET /info-items/word-cloud`（word-cloud は `/{id}` より前に定義＝将来の動的パス回避）。
- `app/main.py`＝`info_router` を include（search の後）。
- **migration 0028＋orm.py は前セッションで作成済**（`info_items` ほか5表＋PGroonga FTS 索引 `idx_info_items_fts`）。今回はそれに結線しただけ。

### (b) frontend 一覧をサーバー委譲へ（`features/info-input/`）
- `types.ts`＝`InfoCard`/`InfoCreator`/`InfoStatusFacets`/`InfoListResult`/`WordCloudToken` を追加（backend DTO と一致・手書き。将来 OpenAPI codegen）。
- `api.ts`＝`fetchInfoItems(state,extra,signal)`（`infoListParams`＝DataTable state→クエリ・sort/enum フィルタは backend ホワイトリスト一致・status タブと roots_only は `extra`）／`searchInfoItems(q)`（全文検索タブ）／`fetchWordCloud()`。既存 fixtures 関数（getInfoItem/createInfoItem 等）は**詳細/フォームがまだ fixtures なので残置**。
- `components/InfoListView.tsx`＝**全面改修**＝DataTable を `server={{query}}` に。状態タブ件数は facets、続報束ねは roots_only、ワードクラウドは API 取得（語クリックで全文検索タブへ）、全文検索タブは server `q`（title＋本文）。`created_by` はオブジェクト（display_name/avatar）。列 flags を backend 能力に一致（impact_class/source は filter のみ・created_by/due_date/created_at の client filter は撤去・横断検索＝q）。
- **注意（既知の割り切り）**＝一覧/詳細/登録/続報/内容編集/キュレーション/関連リンク/貼付画像再ホスト/参考資料は**backend 接続済（Phase A/B/C 完了）**。**まだ fixtures**＝「この情報からクエスト作成」（Phase D の `from_info_id`）・行メニューの archive/削除（EP 未実装＝Phase D）・InfoFormPanel の edit モード（詳細のインライン編集に移行済のため deprecated）。

### (c) テスト（テスト規約 §5・red→green 実施）
- `doc/テスト/N_情報インプット.md` 新規＝repository int（N-TC-001〜009）＋api（N-TC-101〜107）。`check_tc_traceability.py` ✅。
- `impl/backend/tests/info/`＝`conftest.py`（会社DB へ直接 seed・teardown 物理削除・author=seed user で hermetic 化）＋`test_repository.py`＋`test_api.py`。**red 目視**＝実装前イメージに tests だけ mount で api が 404（証跡）→ 実装後 **16 passed**。quests api も 12 passed（回帰なし）。
- **重要**＝bootstrap の `seed_demo_info`（下記 d）が ACME に info を常駐 seed するため、repository int テストは**フィクスチャ author に絞って**検証（`_own()`）。word_cloud テストは会社全体集計ゆえ構造（降順/正規化/archived 除外）で検証。

### (d) デモ seed（`scripts/bootstrap.py`）
- `seed_demo_info()`＝frontend fixtures i1〜i5 相当（続報 i2＝i1 の子・機会/脅威・カテゴリ・関連リンク〔未棄却/棄却〕・ワードクラウド用トークン）を DB 直挿し（**書き込み API が無い Phase A のため**）。冪等（i1 存在で skip）・非prod・`main()` で `seed_demo_discovery()` の後に呼ぶ。author 用デモ user（情報 花子/開発 太郎/営業 次郎）も作成。
- `seed_demo.py`（HTTP 版）は info 用 write API が無いため未変更。

### (e-2) 一覧ヘッダー（列見出し行）のフローティング標準化（横断・ユーザー要望）
- **タブの sticky を解除**（`info-input.css` の `.info-page .tabs`）＝フローティングは一覧ヘッダーに一本化。
- **共有 DataTable の列見出し行（thead）をページ縦スクロールで上部固定**＝`components/ui/DataTable.tsx` に JS 効果（`wrapRef`／`theadRef` を測って `thead` を `translateY`・`--dt-head-top` 既定 `--header-h`・最終行で clamp 解除・`.dt-head--floating` で z:9＋影）。`design-system.css` に `.dt-scroll thead` 標準を追加。**CSS `position:sticky` は不採用**＝`.table-wrap` の `overflow-x:auto` が縦スクロールコンテナ化（coercion）し page-sticky が壊れる／操作列 sticky も両立不可のため（メモリ `datatable-list-header-floating`）。
- デザイン標準 `§4.5⑨-b` を新設（旧⑨「固定ヘッダーは持たない」を上書き）。回帰＝e2e `N-TC-203`。
- **別途考慮**＝文脈バナー等がある画面は `--dt-head-top` を上書き。カード表示は対象外。

### (e) その他
- `.gitignore`＝`tmp_shots/`（先頭スラッシュ無し＝ルート・`impl/frontend/` 双方）を追加（ユーザー要望＝VSCode 変更件数対策）。
- `impl/README.md`＝情報インプットを「一覧＝backend 接続済（Phase A）」に更新。
- **仕様整理フェーズを追加**（下記 §7・ユーザー要望）＝「属性を編集」導線の画面制御・認可を Phase C 前に整理。

## 4. 現在の状態
### 動いているもの（確認済み）
- **backend 一覧 API**＝`docker compose run --rm backend pytest tests/info` で **16 passed**。live でも確認＝seed user ログイン→`GET /info-items`（total=5・link_count/follow_up_count/created_by 正）・`/word-cloud`（count 降順・weight）・`?q=競合`（該当1件）・`?status=bogus`/`?sort=bogus`（422）。
- **frontend 一覧**＝frontend コンテナ再ビルド後、Playwright アドホックで `/info-items` が実データ描画（状態タブ「5」＝facets・ワードクラウド12語・全文検索「競合」→1件・info 関連の JS エラー無し）。スクショ＝`impl/frontend/tmp_shots/info_list_server.png`・`info_search_server.png`（未追跡）。
- `npm run build`（tsc＋next lint＋build）＝通過。
- コンテナ＝backend/frontend/db running（他は未確認だが起動済のはず）。

### 未実装 / 未結線
- **Phase B＝完了（2026-09-21）**＝`GET /info-items/{id}`（全属性＋categories＋links〔target_title を ideas/quests から解決〕＋thread＋tokens_top＋`can`〔edit_content=作成者／curate=curator／add_link=全員〕）＋`InfoDetailView` 結線（読み取り）。`seed_demo_info` のリンクを実 idea/quest（発見デモ）へ。pytest tests/info=22 green。**注意**＝ログイン seed ユーザー（テスト太郎）はデモ情報の作成者でも curator でもないので `can` は edit_content/curate=false（＝閲覧のみ）。編集モードの実機確認には curator 付与か本人作成情報が要る。
- **Phase C**＝`POST`/`PATCH`/`archive`/`delete`＋`POST /info-links`＋画像（nh3 追加・janome トークン・要約 `summarize_text` 流用・自動リンク・親スナップショット）→ SC-51 フォーム結線。**着手前に §7 の仕様整理フェーズ必須**。
- **Phase D**＝`POST /quests {from_info_id}` 逆リンク・`kind=refuting` 再評価通知・`info-curators` 権限 EP。
- frontend の詳細/フォームは fixtures のまま。`nh3` は backend 依存未追加。

### テスト
- pytest 全体は本セッションで未実行（info＋quests api のみ green 確認）。frontend vitest/e2e は build のみ（info の e2e 未追加＝Playwright アドホックのみ）。

## 5. 詰まっている点
- **seed 常駐が int テストを汚染**＝`seed_demo_info` で ACME に info 5件が常駐→exact-match の repository テストが落ちた。→ フィクスチャ author 絞り（`_own`）＋word_cloud は構造検証で解決。以後 info の DB 依存テストは会社全体データ前提で書くこと。
- 大きな行き詰まりは他に無し。

## 6. 決定事項と根拠
- **一覧は最初からサーバー委譲**（採用・ユーザー選択）＝前 handoff §6 の「Phase A は client 割り切り」を**上書き**。DataTable server モードは**番号ページャ**（`page`/`per_page`/`total`・quest-catalog と同形。`GET /quests` のカーソルとは別）。メモリ `list-server-delegation-standard` に整合。
- **状態タブは維持＋件数はサーバー facet**（採用・ユーザー選択）＝`InfoListResponse.facets{all,raw,curated}`（archived 除外・status 以外の現行フィルタ反映）。
- **続報束ね（roots_only）は backend パラメータ**（採用・ユーザー選択）＝`parent_info_id IS NULL`。
- **横断検索（DataTable 検索ボックス）＝server `q`＝title＋body_text（全文）**（採用）。前 handoff の「標準検索＝表示項目のみ／全文は別」は backend が単一 `q` のため統合。全文検索タブは SC-12 体裁のスニペット表示を維持（本文未返却ゆえ要約でハイライト）。**将来 display 限定検索パラメータを足す余地あり＝要再検討**。
- **enum は sa.String**（既存踏襲）。**created_by は DTO オブジェクト**（quests owner と同方針・frontend も追随）。

## 7. 次にやること（優先順・具体）
> 方針＝backend を1画面ループで結線・各画面で受入ゲート（メモリ `backend-connection-per-screen-loop`）。テストは md 先行・red-green。

### 最優先: ユーザー受入（Phase A）
1. **`/info-items` をブラウザで受入**（一覧/状態タブ件数/続報束ね/ソート/列フィルタ/全文検索タブ/ワードクラウド語クリック）。不具合は再現テスト同梱で修正（メモリ `defect-regression-test-policy`）。

### 仕様整理フェーズ（Phase C 前ゲート）＝**完了（2026-09-21）**
2. **情報の編集権限・画面制御を確定**（正本反映済＝API N.0/N.1/N.2/N.3・SC-50 §2/§7/§8/§11-0・データモデル §5.33・メモリ `info-edit-control-spec-phase`）。要点＝**内容(タイトル/本文/URL/参考資料)=作成者のみ(status非依存)＋編集履歴／キュレーション(属性/triage/status/archive)=curator／関連リンク(情報側)=会社内 active 全員・採否は成果物側の管理権限者に委任(別スコープ)／管理者=curator 付与のみ**。画面=**詳細1枚＋能力フラグ(can.edit_content/curate/add_link)でセクション別出し分け(3画面は作らない)**。Phase C 実装項目＝参考資料(`info_attachments`)・内容 revisions(`info_item_revisions`)。

### Phase B＝詳細結線＝**完了**（上記）。
### Phase C＝登録/編集/続報の write 結線＝**完了（2026-09-21）**
3. 実装済＝`POST /info-items`（低摩擦登録/続報＝全員・nh3→`body_text`→`info_tokens`〔janome〕→`summary`〔`quests/summarize.py` 流用〕→auto `info_links`／`parent_info_id` で親リンクをスナップショット複製）／`PATCH /info-items/{id}`（内容=作成者〔status非依存〕・再派生＋版履歴 `info_item_revisions`＝migration `0029`／キュレーション=curator・raw→curated）／関連リンク `POST`/`PATCH`/reject/unreject `/info-links`＋候補検索 `GET /info-link-candidates`（情報側=全員）／**貼付画像の MinIO 再ホスト `POST /info-items/images`（paste ハンドラ・§12-4・Slice 4a）**／**参考資料 `POST`/`DELETE /info-items/{id}/attachments`＝作成者・`info_attachments`＝migration `0030`・§5.33・Slice 4b**。`nh3` は backend 依存へ追加済。frontend＝SC-51 フォーム＋SC-52 詳細のインライン編集（内容/属性/リンク/参考資料）を実 API へ結線・`can` で出し分け。テスト＝pytest `tests/info` 46 green＋front unit（api.test.ts 7）・TC トレーサビリティ✅。
### Phase D＝仕上げ（**アーカイブ＝完了 2026-09-21**）
- **アーカイブ/解除＝完了**＝`POST /info-items/{id}/archive`・`/unarchive`（curator のみ・論理削除〔監査保持〕・解除は curated〔属性あれば〕or raw へ復帰・`archived_at`）。facets に `archived` 追加／一覧に「アーカイブ」状態タブ／詳細フッター（curator）＋行メニューから操作。test N-TC-131〜133（pytest tests/info 49 green）。
- **続報登録UI＝完了（2026-09-21）**＝続報フォームは親を**実 API（fetchInfoDetail）でプレビュー**（fixtures 廃止）・`POST /info-items {parent_info_id}` で登録＝backend が親の未棄却リンクを origin=auto で自動複製（N-TC-014 済）。続報は**スレッドの根に紐づけ**（詳細の🧵続報スレッドに「＋続報を登録」・一覧行 ⋯ メニューも根 parent へ）。属性/リンクは create 非送信のため続報フォームでは事前投入しない（curator の PATCH 管轄・note で明示）。live smoke でリンク複製確認。
- **この情報からクエスト作成＝完了（2026-09-21）**＝`QuestCreateRequest.from_info_id`（`extra=forbid` なので schema 追加）＋`create_quest` が同 UoW で info_link（quests・related・manual）を自動生成（不在 from_info_id は 422）。frontend＝QuestFromInfoPanel を実 API 化（fixtures 廃止・親情報は fetchInfoDetail でプレビュー・下書きクエスト作成→`/quests/{id}` へ遷移＝参加部署/パーティー/権限/カラー/公開は SC-11 で仕上げ）。OpenAPI 型は `npm run codegen` 再生成済。test N-TC-134（pytest tests/info 50 green・quests 115 回帰なし）。live smoke で逆リンク確認。C.2 は from_info_id を既に spec 済（実装が仕様に追いついた）。
- **raw 物理削除＝完了（2026-09-21）**＝`DELETE /info-items/{id}`（登録者本人・raw のみ・curated は 409 invalid_state〔archive 誘導〕・続報ありは 409 has_follow_ups・従属行〔attachments/tokens/links/categories/revisions〕削除＋参考資料 MinIO 除去）。frontend 行 ⋯ メニューを実 API 化（fixtures deleteInfoItem 廃止・snackbar で成否）。test N-TC-135/136（pytest tests/info 52 green）。
- **残**＝`info-curators` 権限付与 EP（`GET/POST /info-curators`・`DELETE /info-curators/{user_id}`＝会社アカウント管理者/system_admin・N.5）＋管理UI（会社アカウント管理 SC-90 系に同居＝`/admin/accounts` 近辺）／`kind=refuting`→対象の作成者+評価者へ通知＋要再評価（per-link・§N.6・他ドメイン連携で重い）。**「属性を編集」行メニューは fixtures な /edit フォームへ飛ぶ＝詳細インライン編集に寄せる整理が別途必要**。

### Phase C/D は §4 の通り。

## 8. 再開に必要な環境情報
- 作業ルート＝`/home/t-umekawa/sc-ideaquest-G2`。実装＝`impl/`（`docker compose` はここ）。
- **起動/リビルド**（`cd impl`）: `docker compose up -d --build backend`／`... frontend`。**backend はソースをベイク（volumes 無）＝コード/migration/seed 変更は必ず --build**（メモリ `backend-no-source-mount`）。bootstrap（entrypoint）が全会社DB に migrate＋非prod seed（`seed_demo_discovery`/`seed_demo_info`）。
- **pytest**（`cd impl`）: `docker compose run --rm backend pytest tests/info`。**未コミット/編集中のテストを反映するには tests を mount**＝`docker compose run --rm -v "$(pwd)/backend/tests:/app/tests" backend pytest tests/info`（アプリ本体の編集は --build が要る）。red 目視も同手法（tests だけ mount＝旧イメージで 404）。
- **traceability**（ルート）: `python3 scripts/check_tc_traceability.py`（✅ 必須ゲート）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート）。Playwright アドホック＝`node tmp_shots/*.mjs`（`playwright` は frontend node_modules・ログインは `#company_code`/`#login_id`/`#password`＋「ログイン」ボタン）。
- **ポート**: frontend `http://localhost:3000`／backend `:8000`。
- **ログイン seed**: `ACME-01`／`user@acme.example`／`Passw0rd!`（テスト太郎）。管理者＝`kanri@acme`（会社管理者）・`admin@ops`（system_admin）＝`Passw0rd!`。
- **DB 確認**（`cd impl`）: `docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "select count(*) from info_items;"`（ロール＝ideaquest）。
- **参照の正本**: 現況＝`impl/README.md`／実装順＝`doc/実装計画.md`／API＝`doc/API設計/N_情報インプット.md`＋`README.md`§1.8.1／テスト＝`doc/テスト/N_情報インプット.md`／データモデル＝`doc/データモデル.md`§5.33-5.37／画面＝`doc/画面設計/screens/SC-50_情報インプット.md`＋モック `mocks/SC-50_情報インプット.html`（DoD＝モック一致）。
