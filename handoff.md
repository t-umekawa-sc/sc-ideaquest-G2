# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-20 00:12 JST**
- ブランチ: **main**（受入/レビュー反映＝main 直コミット可）。**working tree はほぼ clean**（未追跡は `impl/frontend/tmp_shots/` と `tmp_shots/`＝スクショ作業ディレクトリのみ・コミット不要）。`origin/main` と同期済み。
- 最新コミット: **`03e73d8`**（push 済み）
- 本セッションのコミット（新しい順・全て push 済み）:
  - `03e73d8` fix(ui) ブロック活性要素の残留フォーカス枠を横断解消（グローバル機構＋ft-result）
  - `0c5dcbf` feat(info backend) Phase A 基盤＝tenant migration 0028＋ORM（info_items ほか §5.33-5.37）
  - `46521e2` fix(quest-detail) 参加リクエスト行クリック後の青枠残りを解消
  - `4661e14` fix(datatable) 行/カードのクリック起動後に blur＝クリック行のグレー背景の居座り解消
  - `732ddd1` fix(datatable) クリック可能行のフォーカス枠を撤廃・キーボードは淡い背景
  - `819c6f5` fix(datatable) クリック可能行フォーカスを :focus-visible 限定（黒枠解消）※後続で置換
  - `48d9dcb` fix(info-input) 戻るピルとタブの重なり解消（タブ sticky top +46px）
  - `04f0fd9` fix(info-input) 登録ダイアログ本文スクロール復活＋画面名/戻る導線をクエスト一覧に統一
  - `cc7d04a` feat(info-input) 「よく出る語」ワードクラウドをタブの外（常時表示）へ
  - `a894185` docs(info-input) 全文検索のタブ化をモック・設計docへ反映
  - `33bbba3` feat(info-input) 全文検索をタブ化＝クエスト SC-12 と同じ体裁（一覧／全文検索）
  - `d56ba28` feat(info-input) 全文検索（タイトル＋本文＋要約）を一覧の標準絞込と分離
  - `81d9686` docs(info-input) 全文検索と標準絞込の分離をモック・設計docへ反映
  - `862d5cd` feat(info-input) 一覧検索を「タイトル・本文を全文検索」と明示（後に分離）
  - `bb08781` docs(readme) 情報インプットの現況を「Next.js 移植済（backend未接続）」に更新
  - `15783a8` feat(info-input) 移植 増分2c＝この情報からクエスト作成（軽量デモ動線）
  - `d3cd597` feat(info-input) 移植 増分2b＝登録/編集/続報フォーム
  - `32ca376` feat(info-input) 移植 増分2a＝情報詳細（SC-52）

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションする Web アプリ「IDEAQUEST」。現行フェーズ＝**情報インプット機能（FR-41・外部WEB情報を手動貼付→属性→アイデア/コンセプト/クエストへ動的リンク＝差別化の核）**の実装。設計は完備、frontend 移植は完了、**backend の実装＋結線が残**。

## 3. 今回やったこと（変更ファイルと理由）
### (a) 情報インプット frontend 移植の完了（`impl/frontend/src/features/info-input/`）
- `components/InfoDetailView.tsx`・`InfoDetailModal.tsx`＝SC-52 詳細（要約・サニタイズ済リッチ本文・属性・関連リンク種別・続報スレッド・「この情報からクエスト作成」CTA）。理由＝増分2a。
- `components/InfoFormPanel.tsx`・`InfoFormModal.tsx`＝SC-51 登録/編集/続報（リッチエディタ contenteditable・キーワード抽出/要約生成の遮蔽オーバーレイ・参考資料 dropzone・関連リンク管理〔オートコンプリート＋自動リンク棄却〕・属性 disclosure・続報は親引き継ぎ）。理由＝増分2b。**本文スクロール不具合を修正**（余分な `<div>` ラッパ→Fragment・`04f0fd9`）。
- `components/QuestFromInfoPanel.tsx`・`QuestFromInfoModal.tsx`＝SC-50「この情報からクエスト作成」軽量デモ動線。理由＝増分2c。
- `components/InfoListView.tsx`＝**タブ構成（🧭情報インプット＝一覧／🔍全文検索）に再構成**。全文検索を一覧の標準絞込と分離し、クエスト詳細 SC-12 と同じ結果表示（対象セレクト・件数・ハイライトスニペット）。ワードクラウドはタブの外（常時表示）。画面名フォントをクエスト一覧に合わせ（pixel→既定 `.page-head h1`）、戻る導線を `backlink--float`（角丸ピル）に。タブ sticky top を `+46px` にして戻るピルとの重なり解消。
- `info-input.css`＝上記の CSS（タブ・ft-result・フォーム・ドロップゾーン等）。
- ルート追加＝`impl/frontend/src/app/(app)/info-items/` 配下（`page.tsx`＝一覧、`[infoId]/page.tsx`＝詳細フルページ、`new/page.tsx`・`[infoId]/edit/page.tsx`・`[infoId]/new-quest/page.tsx`）＋ `@modal/(.)info-items/...`（intercept モーダル）。

### (b) クリック要素の残留フォーカス枠の横断修正
- `impl/frontend/src/components/util/BlurBlockActivatorOnPointer.tsx`（新規）＝**グローバル機構**。`(app)/layout.tsx` に常設。マウス/タッチのクリックで「ブロック活性要素」（`.dt-row--link/.dt-card--link/.ft-result/.join-req-row/.quest-card/.draft-card/[data-block-activator]`）の残留フォーカスを外す。キーボード発火（`click.detail===0`）は除外＝a11y 維持。理由＝黒枠→青枠→グレー背景→参加リクエスト青枠…と個別対処が漏れたため横展開。
- `impl/frontend/src/components/ui/DataTable.tsx`＝`onRowActivate` でマウスクリック後に blur（行/カード共通）。
- `impl/frontend/src/styles/design-system.css`＝`.dt-row--link:focus{outline:none}`＋`:focus-visible` は淡い背景。
- `impl/frontend/src/features/quests/components/QuestDetailView.tsx`＝参加リクエスト行（承認待ち/却下済み）の onClick で blur。
- `impl/frontend/src/features/quests/quests.css`・`info-input.css`＝`.ft-result` の `:focus`/`:focus-visible` を統一（UA 黒/青枠を出さない）。

### (c) 情報インプット backend Phase A 基盤（`0c5dcbf`）
- `impl/backend/migrations/company/versions/0028_info_input.py`（新規）＝会社DB migration。`info_items`/`info_item_categories`/`info_links`/`info_tokens`/`info_curators` の5テーブル＋各索引＋PGroonga FTS 索引 `idx_info_items_fts`（`title || ' ' || coalesce(body_text,'')`）。enum は String 列（§5.3 house style）。
- `impl/backend/app/tenant/info/orm.py`（新規）＝上記5テーブルの `CompanyBase` モデル。`__init__.py` は空。

### (d) 設計docへの追随
- `doc/画面設計/mocks/SC-50_情報インプット.html`（DoD 正本）＝タブ化・全文検索・ワードクラウド位置・画面名フォントを port と一致させた。
- `doc/画面設計/screens/SC-50_情報インプット.md` §3／`doc/API設計/N_情報インプット.md`（GET /info-items の `q`）＝全文検索タブの体裁を明記。
- `impl/README.md`＝情報インプットを「Next.js 移植済（backend未接続・fixtures seam）」に更新。

## 4. 現在の状態
### 動いているもの（確認済み）
- **情報インプット frontend（一覧/詳細/登録・編集・続報/この情報からクエスト作成/全文検索タブ）**＝ローカル実機（`localhost:3000/info-items`）で描画・操作・エラー無しを Playwright アドホックで確認。データ源は `impl/frontend/src/features/info-input/api.ts`＝**`INFO_FIXTURES` の in-memory ストア（backend 未結線）**。一覧 DataTable は**クライアントモード**（`data={rows}`）。
- **フォーカス枠の横断修正**＝情報インプット全文検索の ft-result をクリック→Escape→マウス退避で `focusRing=0`・`active=BODY` を確認。DataTable 行/カード・参加リクエスト行も解消確認。
- **backend migration 0028**＝会社DB `ideaquest_company_acme` に適用済みを psql で確認（`alembic_version=0028_info_input`／`info_*` 5テーブル／`idx_info_items_fts` 生成）。他の会社DB（acme2・e2e_*）は bootstrap が全DBに適用する想定だが**個別未確認**。
- `npm run build`（tsc＋next lint＋build）＝本セッション中に複数回通過。
- コンテナ＝`backend/db/frontend/mailhog/mail-worker/minio/redis/worker` すべて running（`docker compose ps`）。

### 未実装 / 未結線
- **info backend の API 層が未着手**＝`app/tenant/info/` に `schemas.py`/`repository.py`/`application.py`/`router.py` が**無い**（`orm.py` と `__init__.py` のみ）。`app/main.py` に info router の include は**無い**（grep=0）。
- frontend `api.ts` は fixtures のまま（実 API 未接続）。
- backend seed に info_items は**未投入**（`impl/backend/scripts/seed_demo.py` 未編集）。
- `nh3`（HTML サニタイズ・Phase C 用）は backend 依存に**未追加**。

### テスト
- **pytest は本セッションで未実行＝通過状況 未確認**。
- 情報インプット backend の TC md（`doc/テスト/情報インプット_*.md`）は**未作成**（着手時に先行作成が必要＝テスト規約 §5）。
- frontend の vitest/e2e は本セッションで個別未実行（build のみ）。

## 5. 詰まっている点（試して失敗した点）
- **フォーカス残り修正の試行錯誤**＝(1) `:focus-visible` に primary リング→モーダル閉時に**青枠が残る**（Escape=キーボード扱いで focus-visible 成立）。(2) `:focus-visible` を淡い背景に→クリック行の**グレーが居座る**（他行ホバーで2行グレー）。(3) 参加リクエストは `onClosed` で blur→**Modal のフォーカス復帰より前に走り無効**だった。→ **最終解＝クリック時（マウス）に開き元を blur**（Modal の `restoreRef` 捕捉前に body へ移す）＋**グローバル機構**で横断化。同種は個別 CSS でなく blur 機構で対処すること。
- 大きな失敗・行き詰まりは他に無し。

## 6. 決定事項と根拠
- **backend enum は PG enum 型でなく `sa.String` 列**（採用）。根拠＝既存 §5.3 house style（quests/ideas も String）。DB enum 型は不採用（マイグレーション追従が重い）。
- **情報一覧 frontend はクライアントモード（`data={rows}`）を当面維持**。API N は本来サーバー委譲（§1.8.1）。メモリ `list-server-delegation-standard` とは緊張関係があるが、移植済み画面の作り直しを避けるため Phase A では**backend が全件返し→frontend で client 絞込**の割り切りを採用（将来サーバー委譲に refine 可）。次回見直し対象。
- **全文検索はタブで分離**（採用）。標準の一覧検索＝表示項目（title/summary/created_by）／全文検索タブ＝title＋body_text＋summary（本番 `?q=` PGroonga）。クエスト SC-12 と同体裁。ユーザー要望。単一検索ボックスへの本文混在は不採用（標準絞込と混同するため）。
- **フォーカス枠はグローバル blur 機構で横断解消**（採用）。個別 CSS の focus-visible 抑制は a11y と両立せず漏れるため不採用。キーボード（detail===0）は blur せず可視維持。
- **クエスト作成動線（SC-50）は info-input 内の軽量デモダイアログ**（採用・モック一致）。SC-11 本フォーム流用は将来（backend の `from_info_id` で info_link 作成）。

## 7. 次にやること（優先順・具体）
> 方針＝**backend を1画面ループで結線・各画面で受入ゲート**（メモリ `backend-connection-per-screen-loop`）。テストは md 先行・red-green（テスト規約 §5）。フェーズ＝A基盤＋一覧（進行中）→B詳細→C登録/編集/続報→D仕上げ。

### 最優先: Phase A 残り＝一覧エンドポイント＋結線
1. **`doc/テスト/情報インプット_*.md` を新規作成**し、`GET /info-items`・`GET /info-items/word-cloud` の TC 行（`根拠` 列付き・TC-ID）を先に書く。`python3 scripts/check_tc_traceability.py` で ✅ にする。
2. **`impl/backend/app/tenant/info/schemas.py`** 作成＝`InfoItemCardDTO`（id/title/summary/status/priority/impact_class/categories[]/source/source_url/due_date/created_by/created_at/link_count/parent_info_id/follow_up_count）＋`InfoListResponse{data,page_info}`。frontend `types.ts` の `InfoItem` と項目名を一致させる（backend 命名が正）。
3. **`impl/backend/app/tenant/info/repository.py`** 作成＝一覧クエリ（`archived_at IS NULL` 既定・status/分類フィルタ・`q` は PGroonga `&@~`〔`app/tenant/search/repository.py` の書式に倣う〕・cursor か offset ページング）＋word-cloud 集計（`info_tokens` を token で GROUP BY）。
4. **`impl/backend/app/tenant/info/application.py`** 作成＝`app/tenant/quests/application.py` の `get_quests` パターンに倣う（`_resolve_company`＝control_session+`Company`、`get_tenant_session(company.db_identifier)`、`profile_repo.get_user_by_account`、DTO 組立、`{data, page_info}` 返却）。
5. **`impl/backend/app/tenant/info/router.py`** 作成＝`APIRouter(prefix="/api/v1", tags=["info"])`、`GET /info-items`（`Depends(require_me)`）・`GET /info-items/word-cloud`。`app/tenant/quests/router.py` の list_quests に倣う。
6. **`impl/backend/app/main.py`** に `from app.tenant.info.router import router as info_router` ＋ `app.include_router(info_router)` を追加。
7. **`impl/backend/scripts/seed_demo.py`** に info_items のデモseed（frontend `fixtures.ts` の i1〜i5 相当＝続報 i2、機会/脅威、関連リンク）を追加。冪等に。
8. **backend をリビルド**（`docker compose up -d --build backend`＝ソースをベイクするため必須）→ bootstrap で migrate/seed。`GET /info-items` を実データで確認。
9. **frontend 結線**＝`impl/frontend/src/features/info-input/api.ts` の `listInfoItems()` を `GET /info-items` の fetch に差し替え（当面 client 絞込は維持）。word-cloud も `GET /info-items/word-cloud` に。一覧/全文検索タブをブラウザで受入。
10. **api テスト**（`impl/backend/tests` 配下・quests の api テストに倣う）を red-green で追加。

### 以降
- Phase B＝`GET /info-items/{id}`（全属性＋categories＋links＋thread＋tokens_top＋can）→ 詳細モーダル結線。
- Phase C＝`POST`/`PATCH`（**nh3 追加**＝サニタイズ→`body_text`→`info_tokens`（janome 流用）→`summary`（`app/tenant/quests/summarize.py` 流用）→自動リンク／親スナップショット／URL http/https 検証）→ フォーム結線。
- Phase D＝`POST /quests {from_info_id}` 逆リンク・`kind=refuting` の再評価通知・`POST /info-items/images`（MinIO 再ホスト）。
- `impl/README.md` を各スライスで追随更新（進捗の正本）。

## 8. 再開に必要な環境情報
- 作業ルート＝`/home/t-umekawa/sc-ideaquest-G2`。実装＝`impl/`（`docker compose` はここで実行）。
- **起動/リビルド**（`cd impl`）: `docker compose up -d --build frontend`／`docker compose up -d --build backend`。**backend はソースをベイク（volumes 無）＝コード/migration 変更は必ず --build で反映**（メモリ `backend-no-source-mount`）。migration は backend 起動時 `python -m scripts.bootstrap`（`backend/entrypoint.sh`）が全会社DBに `alembic upgrade` する。
- **ポート**: frontend `http://localhost:3000`／backend `:8000`（uvicorn）。
- **ログイン seed**: 会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`（テスト太郎）。管理者 seed＝`kanri@acme`（company_account_admin）・`admin@ops`（system_admin）＝共に `Passw0rd!`（メモリ `admin-seed-accounts-exist`）。
- **DB 確認**（`cd impl`）: `docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "\dt info_*"`（ロールは **ideaquest**・`postgres` ではない）。
- **frontend 検証**: `cd impl/frontend && npm run build`（tsc＋next lint＋build＝内部遷移 `<Link>` 等も検出。必須ゲート）。
- **pytest**（未確認・慣例）: `cd impl && docker compose run --rm backend pytest`。未コミット編集を反映するには `-v` でソースマウントが要る（メモリ `backend-no-source-mount`）。cwd=impl。
- **参照の正本**: 実装現況＝`impl/README.md`／実装順＝`doc/実装計画.md`／API 横断＝`doc/API設計/README.md`＋ドメイン `doc/API設計/N_情報インプット.md`／データモデル＝`doc/データモデル.md` §5.33-5.37・§3（`info_*` enum）／画面＝`doc/画面設計/screens/SC-50_情報インプット.md`＋モック `doc/画面設計/mocks/SC-50_情報インプット.html`（DoD＝モック一致）。
- Playwright アドホック検証は `impl/frontend/node_modules/playwright` を用い、スクショは `impl/frontend/tmp_shots/`（未追跡）。
