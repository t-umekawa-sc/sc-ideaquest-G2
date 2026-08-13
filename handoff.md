# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-13）＝(A) 管理系のモック整合（SC-91 完全準拠・SC-93 済）は保留し、ユーザー主導で「UI標準（`doc/画面設計/mocks/shared.css`・`shared.js`・`デザイン標準.md`）の整備＝(D)」を実施中。本セッションで「一覧の操作標準（DataTable）」を新設して `SC-91`・`style-guide.html` に適用し、ユーザー確認フィードバックを多数反映＋ヘッダー usermenu の UI/アニメ＋メニューのゲーム風選択カーソルを標準化。次＝D-2（各画面ラベル横断見直し）／D-3（DataTable を他一覧へ展開）／D-4（impl 反映）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-13 JST**（セッション終了時）。
- ブランチ: **main**。作業ツリー **クリーン**。**`origin/main` へ push 済み**（本 handoff コミット含む・ユーザー依頼で push）。
- 最新コミット: 本 handoff コミット。直前＝**`1b2a0cc`**（ゲーム風選択カーソル付きメニューを標準化）。
- 本セッションの起点＝**`45b8c1b`**（前セッション末の handoff）。ここから **27 コミット**を積んだ（全て本セッション・今回 push）。
- **本セッションの主なコミット（新しい順）**:
  - `1b2a0cc` **メニューのゲーム風選択カーソルを標準化**＝`.rowmenu__list`（アクションメニュー）・`.usermenu__list`（ユーザーメニュー）の `[role="menuitem"]` にホバー/フォーカスで ▶ 選択カーソル（`.btn-pixel` と同じ `pixel-cursor-blink`）を**既定表示**。任意メニューは `.menu-pixel`。`.is-danger` は ▶ も危険色・`prefers-reduced-motion` で静止。`デザイン標準.md`「メニューの選択カーソル ▶（標準）」新設。
  - `87865f2` **usermenu の区切りを細罫線に修正**＝`.usermenu__sep` が `li > *` に巻き込まれ太い青バー化 → 項目スタイルを `[role="menuitem"]` のみに限定。
  - `3729779` **style-guide にヘッダー usermenu 掲載**（＋通知ベル・`.app-bg`＋背景復元。節「11.」）。
  - `cd5dd40` **D-1 usermenu 開閉アニメ＋UI 磨き**（`shared.js` 不変・CSS のみ）＝フェード＋右上基点スライド・吹き出し矢印・開時トリガーにリング・reduced-motion 無効。`hidden` 時に `display:block`＋`opacity:0`+`visibility:hidden`+`pointer-events:none`（グローバル `[hidden]{display:none}` をこの要素だけ上書き）で閉じアニメと a11y を両立。
  - `d4cfb94` **DataTable ページ範囲外バグ修正**＝ピン増加で非固定件数が減りカレントページが範囲外→空表示で戻れない。`render()` のページ番号クランプを**行スライスの前**へ移動して解消。
  - `f54dc7c` **DataTable 下部ページングバー `.dt-footer`**＝件数(左)・番号ページャ(中央)・表示件数(右)を集約。上部ツールバー右は 密度/列設定/エクスポート のみ。
  - `1dc94eb` **行ピンのアイコン状態切替**＝未ピン `📍`(opacity .4)／ピン中 `📌`(不透明)。
  - `847dfb7` **一覧サンプルに ⋯ アクションメニュー（RowMenu）追加＋操作列標準化**（style-guide「9.」）。
  - `1efff4b` **D-0 第2弾**＝①**動的生成モーダルに最大化(⤢)/ドラッグ/a11y が効かない不具合を修正**（`shared.js` の `initMaximizable`/`watch` を冪等化し body の MutationObserver で後から追加された `.modal` も初期化）②「1ページの表示件数」セレクタ追加（`perPageOptions`・`localStorage` 保持）③style-guide「10. ダイアログ」サンプル。
  - `75c4842` **D-0 第1弾**＝①詳細絞込の区分(enum)を縦並び＋間隔（`.filter-checks`）②横断検索を短プレースホルダ＋対象項目名を下補足（`.dt-search__hint`・`searchFields`）③**行固定の背景色バグ修正**（区切り線を文字列 `replace` で入れ `class` 二重化→`classList` 付与＋段積み sticky `--dt-row-top`）。
  - `becc385` **一覧の操作標準（DataTable）新設＋SC-91 適用＋`デザイン標準.md` §4.5**（**mocks のみ**）＝`shared.js` に `window.DataTable`（`DataTable.init(root, config)`）。機能＝ソート(単一/詳細2ペインFLIP)・絞込(横断/詳細)・番号ページャ・列幅ドラッグ・列設定(表示/非表示/並べ替え/幅リセット)・CSV・表示密度・行固定。`shared.css` に `9y` 部品＋**グローバル `[hidden]{display:none!important}`**（`.btn`/`.pagination` の display が UA の `[hidden]` を上書きする不具合の修正）。
  - `1094df1` **モーダル本文スクロール修正（impl＋mocks）**＝body+footer を `<form>` で包む標準パターンで内容が高いとフッター画面外。`.modal__panel.sectioned > form` を flex 列に。`design-system.css`／`mocks/shared.css` 同期。full e2e 26 passed。
  - `effe878` **(A)SC-91 会社一覧をモック完全準拠へ再整合（impl）**＝`.backlink`/`.page-title`/`.admin-sub`/`.section-head`/`.role-note`・テーブル `.co`+`QuestIcon`/`.db-id`/状態バッジ・作成モーダルに会社カラー `.swatches`(新 `components/ui/Swatches.tsx`・backend `color` 接続)＋会社アイコン `.icon-field`(objectURL 仮実装)＋`.provision-note`。共有クラス8種を `design-system.css`＋`mocks/shared.css` へ昇格。e2e 追随＝**full 26 passed**。
- **コミットは 実装本体→handoff の2段**。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。**push は原則ユーザー依頼時のみ**。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。

---

## 3. 今回やったこと — 変更したファイルと理由

本セッションは大きく2部。**前半＝impl の SC-91 仕上げ（2コミット）／後半＝UI標準の mocks 整備（(D)・25コミット）**。

### 前半：impl（`impl/frontend`）の変更
- **`effe878` SC-91 会社一覧をモック完全準拠へ**＝`src/features/companies/components/CompanyList.tsx` を全面刷新（見出し/セクション/脚注/テーブルのクラスをモックへ整合）。新規 `src/components/ui/Swatches.tsx`（会社カラー・`SWATCH_PRESETS` 10色）を `components/ui` から公開。作成モーダルは会社カラーを backend `CompanyCreateRequest.color` へ送信、会社アイコンは **objectURL プレビューのみの仮実装**（MinIO 待ちで未送信）。共有クラス8種を `src/styles/design-system.css` と `doc/画面設計/mocks/shared.css` の**両方へ昇格・同期**。e2e `frontend/e2e/sc-91-companies.spec.ts`・`sc-92-company-detail.spec.ts` を見出し/ボタン名変更に追随。
- **`1094df1` モーダル本文スクロール修正**＝`.modal__panel.sectioned > form` を flex 列に（`design-system.css`＋`mocks/shared.css`）。入力モーダルは今後もこの form 規則が効く前提で作る。
- 以降 impl は**一切変更していない**（後半は全て `doc/画面設計` 配下）。

### 後半：UI標準の mocks 整備（(D)・`doc/画面設計/` のみ）
- **一覧の操作標準 DataTable を新設**（`becc385`〜）。`doc/画面設計/mocks/shared.js` の `window.DataTable`（末尾に IIFE で実装）＝**列(`columns`)とデータ(`data`)を宣言するだけで全機能付与**。`shared.css` の `9y` セクションに部品。`SC-91_システム管理.html` は手書き table を `DataTable.init` に置換、`style-guide.html`「9.」にデモ。`デザイン標準.md` §4.5「一覧の操作標準（DataTable）」新設（旧 F4「列ヘッダソート MVP 非採用」等を上書き）。
- **ユーザー確認フィードバックを反復反映**（`75c4842`/`1efff4b`/`847dfb7`/`1dc94eb`/`f54dc7c`/`d4cfb94`）＝§1 参照。バグ修正＝行固定の背景（class二重化）・動的モーダルの最大化/a11y・ページ範囲外クランプ順。
- **ヘッダー usermenu の UI/アニメ（D-1）**（`cd5dd40`）＋**style-guide 掲載**（`3729779`）＋**区切り罫線修正**（`87865f2`）。
- **メニューのゲーム風選択カーソル ▶ を標準化**（`1b2a0cc`）。
- **仕様の詰め方**＝ユーザーが具体イメージを口頭描写→こちらが仕様化（プレビュー付き選択肢での択一は不可。メモリ `design-spec-working-style` 参照）。

### 過去（前セッションまで・push 済み・要点）
- 方針転換（`b90eced`）＝「画面モック先行のクリッカブル移植 → 画面群ごとに backend 接続」（`doc/規約/フロントエンド実装フロー規約.md`・DoD＝モック一致）。Phase 0（デザインシステム移植/App シェル/全ルート雛形＋ハブ/URL モーダル基盤）完了。SC-91 初回整合（`ca2bbab`）・SC-93 整合（`c78aa2d`）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend（縦通し済み・本セッション無変更）**: ドメイン A（ログイン/MFA/初回・再設定PW/ロック/IP確定）・B（会社/アカウント/所属・`/admin/*`・SoD）・K.2/K.3（`/me`・パスワード・メール変更 double opt-in）・account_sync_outbox・mail_outbox・監査ログ。
- **frontend（impl）**: Phase 0 完了で**全画面クリッカブル**（未実装は `ScreenStub`）。管理系は **SC-91（モック完全準拠）・SC-93** が整合済（接続維持）。**SC-92・SC-90 は旧実装のまま（未整合・保留）**。
- **モック（`doc/画面設計/mocks`）**: `shared.js` の `DataTable` と一連の UI 標準を実装。`SC-91_システム管理.html`・`style-guide.html`（節 9〜12）で動作。**これは mocks 側のみ＝impl 未反映**。
- **テスト / 検証（本セッション実測）**:
  - **frontend full e2e = 26 passed**（前半 SC-91 再整合時に実測。以後 impl 無変更のため有効だが未再実行）。**tsc EXIT=0**（前半で実測）。
  - **DataTable ほか mocks の UI**＝**ヘッドレス Playwright（`file://` で mock を読込）で全機能の描画・JS エラー無しを確認**。`shared.js` は `node --check` で syntax OK。
  - **backend pytest = 前セッション 164 passed のまま（本セッション未再実行＝未確認扱い）**。
- **Docker**＝db/redis/mailhog/backend/frontend/worker/mail-worker の **7 サービス running**（本 handoff 時点）。frontend イメージは SC-91 再整合込み・backend は K.3 期。**後半の mocks 変更は impl イメージに無関係**（mock 検証は `/tmp` へ cp して file:// 読込）。
- **壊れているもの＝無し**。
- migration head＝**control 0010・company 0006**（versions ファイル数で確認）。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **本セッションのハマり（すべて解消済み）**:
  - **行固定の背景色が付かない**＝区切り線クラスを文字列 `replace('<tr ', '<tr class=...')` で挿入し `class` 属性が二重化→最後のピン行が `is-pinned` を喪失。**`classList.add` に変更**＋段積み sticky（`--dt-row-top` 累積）。
  - **ピン留めでページャ消失・戻れない**＝`render()` が行スライスを先に計算し、ページ番号クランプを後段 `renderPager()` で実施→古い `st.page` で空スライス。**クランプをスライス前へ移動**。
  - **動的生成モーダルに最大化/a11y が効かない**＝`shared.js` の最大化差し込み・`watch` が `DOMContentLoaded` 一回きり。**body の MutationObserver で後から追加された `.modal`/`.modal--maximizable` も初期化**（冪等化）。
  - **emoji の `filter:grayscale` が headless で不安定**＝ピン淡色化は `opacity` のみに。
  - **`.usermenu__sep` が太い青バー**＝`li > *` に巻き込まれ項目 padding/hover が付与。**項目スタイルを `[role="menuitem"]` に限定**。
  - **usermenu の閉じアニメが出せない**＝`hidden` は `display:none`。**`hidden` 時に `display:block`＋`opacity/visibility/pointer-events` でグローバル `[hidden]` を要素単位で上書き**して両方向アニメ＋a11y を両立。
  - **`hidden` 属性が効かない**（`.btn`/`.pagination` の `display` が UA の `[hidden]` を上書き）＝mocks `shared.css` に **グローバル `[hidden]{display:none!important}`** を追加。
  - **モーダル本文スクロール（`<form>` 包み）**＝`.modal__panel.sectioned > form` を flex 列に（前半 `1094df1`）。
- **検証の落とし穴**:
  - **`docker compose cp ../doc/画面設計/mocks frontend:/tmp/mocks` はネスト增殖する**＝実行前に必ず `docker compose exec -T frontend rm -rf /tmp/mocks`。
  - Playwright の `file://` は日本語ファイル名を **URL エンコード**（`SC-91_%E3%82...html`）。番号ページャは `data-dt-page="2"` が 3 ボタン（数字/›/»）に付くため `.pagination__page[data-dt-page]` で数字だけ選ぶ。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（(D) UI標準）
- **一覧操作を単一共通部品 `DataTable` に集約**（不採用＝画面ごと個別実装）＝列＋データ宣言だけで全機能。旧「列ヘッダソートは MVP 非採用／ソートは select 一本化」（`デザイン標準.md` F4）を**撤回**。
- **詳細ソートは左右2ペイン transfer＋FLIP・単一列ソートは昇順→降順→解除の3段**。詳細ソート中は単一列ソート無効化（バッジで明示・クリアで復帰）。
- **件数・表示件数は下部ページングバー `.dt-footer` に集約**（上部ツールバーから移動）。表示件数は `localStorage` 保持。
- **列幅/表示/順序/密度/ピンは `localStorage`（画面×列 `storageKey`）で永続**。ソート/絞込/ページはセッション内。
- **CSV／行固定のページ跨ぎは backend 依存**＝実装接続時に一覧APIへ「複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得」のクエリ契約を要求（モックは全件クライアント保持で再現）。
- **メニューのゲーム風選択カーソル ▶ を標準化**＝業務層メニューにゲーム層の“遊び”を差す**意図的クロスオーバー**（チャットの魔法エフェクトと同じ扱い）。`prefers-reduced-motion` で静止。
- **仕様検討＝ユーザーの口頭イメージから仕様化する**（プレビュー付き選択肢での択一は不可）。

### 過去の確定（正は各設計文書。要約）
- **フロントエンド先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css を単一デザインシステム**として採用・段階移行。**モックは URL 付きモーダル（Parallel `@modal`＋Intercept）**。**モック⇔設計の矛盾は設計を正**（会社 status は `active/suspended` の2値＝モックの `provisioning` 不採用／SC-90 のロール列は SoD で非表示）。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）ほか ADR-0002〜0008。2プレーン×縦スライス4層（`main.py`/`worker.py`/`mail_worker.py`）。

---

## 7. 次にやること — 優先順に、具体的に

> 最優先＝**(D) UI標準/モック精度**（doc/画面設計 で作業）。(A) 管理系整合・(B) 画面群移植の **impl 作業は保留**。

### (D) UI標準・モック精度（進行中）
- **D-2＝各画面のラベル横断見直し**（未着手・ユーザー要望）。`doc/画面設計/mocks/SC-*.html` 全体で用語統一・命名を点検。方針節を `デザイン標準.md` に設けるか検討。
- **D-3＝DataTable を他一覧へ展開**（未着手）。`mocks/SC-90_クエストグループ管理.html`・`SC-92_会社詳細.html`・`SC-93_会社アカウント管理.html`・`SC-10_クエスト一覧.html` 等の手書きテーブルを `DataTable.init(root, {columns, data})` へ置換（`SC-91` が参照実装）。操作列は `actions:true` で ⋯ RowMenu。
- **D-4＝impl 反映**（未着手・最後）。mocks の到達点を `impl/frontend` へ落とす：
  - `doc/画面設計/mocks/shared.css` の差分（`9y` DataTable 部品・グローバル `[hidden]`・usermenu アニメ・`.menu-pixel`・`.seg`・`.filter-checks`・`.dt-*` 等）を `impl/frontend/src/styles/design-system.css` へ同期。
  - `DataTable` を **Next.js/TS 版**として `impl/frontend/src/components`（例 `DataTable.tsx`）に実装し、一覧APIのクエリ契約（複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得）を backend に追加。
- **usermenu の追加磨き**（要望次第）＝速度感・配色・ユーザー名ヘッダー行の追加。現状 `shared.js` の `initUserMenu` は `hidden` トグルのみ（アニメは CSS）。

### 【保留】(A) 管理系モック整合（impl・UI標準が落ち着いたら再開）
- **(A-1) SC-92 会社詳細**＝`impl/frontend/src/features/companies/components/CompanyDetailView.tsx` の checkbox を `.switch`（新規 `components/ui/Switch.tsx`）へ／会社カラー `.swatches`（`Swatches` 再利用可）／文脈バナー `.ctx`／`features/accounts/components/AccountSection.tsx` を `.table`＋⋯`RowMenu`／`features/questgroups/components/QuestGroupSection.tsx` を `.table`＋リネームモーダル。e2e `sc-92*`。
- **(A-2) SC-90**＝`features/qgadmin/components/QuestGroupAdminView.tsx` の「グループ内ロール」列を**削除**（SoD）・除外文言・ディレクトリピッカー整備。
- **(A-3) 所属エディタ**＝`features/accounts/components/MembershipsEditor.tsx` の `<select>` を `.seg` へ。**`.seg` は mocks `shared.css` に有・impl `design-system.css` 未昇格**＝要同期。
- **backend 依存の残**＝`AccountListItem` に memberships／`MemberListItem` に `login_id`・`joined_at`＋`page_info`／`CompanyListItem`・`CompanyDetail` に `group_count`・`created_at`／session に会社表示名／画像アップロード EP（K.4・MinIO）。

### 【保留】(B) 画面群の新規移植→接続
- クエスト C（SC-10/12/11）→ アイデア D（SC-21/22）→ チャット E（SC-24）→ 評価 F（SC-25）→ ゲーム G（SC-30/31/32/40/41）→ 通知 H（SC-02）→ ダッシュボード I（SC-01 本実装）。G-core 台帳＋MinIO は接続時に前倒し。

---

## 8. 再開に必要な環境情報

- **フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog SMTP `:1025`・UI `:8025`／backend `:8000`／frontend `:3000`（`next dev`）。backend entrypoint が bootstrap（DB作成→alembic head〔control 0001-0010・company 0001-0006〕→seed）してから uvicorn。
- **dev ログイン（seed・パスワードは全て `Passw0rd!`）**:
  - system_admin＝会社コード `OPS`／`admin@ops.example`（dev 既定で供給済み）。
  - 一般＝`ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **frontend 型チェック（軽量）**＝`cd impl && docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。
- **frontend 実挙動/e2e**＝`docker compose up -d --build frontend`（src 焼き込み）→ **焼くたびに** `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`（**26 passed**）。**spec のみ**なら `docker compose cp frontend/e2e/<spec> frontend:/app/e2e/<spec>` で差し込み。
- **モック（doc/画面設計）の目視/自動検証**＝`docker compose exec -T frontend rm -rf /tmp/mocks` → `docker compose cp ../doc/画面設計/mocks frontend:/tmp/mocks`（**先に rm 必須・cp はネストする**）→ node スクリプトを `docker compose cp` して `docker compose exec -T frontend node <script>`（`@playwright/test` の `chromium`・`file:///tmp/mocks/<URLエンコード>.html`・`page.on('pageerror')` で JS エラー収集・`.screenshot()` で部分撮り）。`node --check /tmp/mocks/shared.js` で syntax。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・本セッション未再実行）。
- **OpenAPI 型生成**＝backend 起動後 `docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen`（`src/lib/api/schema.d.ts` 再生成）。
- **正となる場所**＝デザインシステム実体＝`doc/画面設計/mocks/shared.css`・`shared.js`（impl `src/styles/design-system.css` はその複製・**共通クラスは両方に同期**）。見た目＝`mocks/SC-xx_*.html`・機能＝`screens/SC-xx_*.md`・遷移＝`画面遷移図.md`・UI標準＝`デザイン標準.md`（最新§4.5「一覧の操作標準」）。
- **主要 env**＝`impl/.env.example`／実設定は `impl/compose.yaml` `&backend_env`。`LOGIN_RATE_LIMIT_MAX=50` で e2e の 429 回避。詰まったら `docker compose exec redis redis-cli flushall`。
- **運用**＝`.gitignore` で `*.pdf`・`.env` 追跡外。2段コミット・末尾 Co-Authored-By。TC-ID＝`<ドメイン>-TC-<3桁>`（既存最大 B-TC-125）。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(D) UI標準/モック精度**：**D-2 ラベル横断見直し** → **D-3 DataTable を他一覧へ展開** → **D-4 impl 反映**。(A) SC-92/90/所属エディタ・(B) 画面群移植は**保留**。
- ✅ 本セッション＝**前半 impl（SC-91 完全準拠・モーダル修正＝full e2e 26 passed）／後半 mocks の UI 標準（DataTable・usermenu アニメ・メニュー ▶ カーソル標準化）**。DataTable ほか mocks はヘッドレスで検証済・**impl 未反映**（D-4 で対応）。
- ✅ 状態＝作業ツリー クリーン・**origin へ push 済み**。migration head control 0010・company 0006。Docker 7 サービス稼働。backend pytest 164 は前セッション値（未再実行）。
- ✅ 再利用部品（impl）＝`components/ui/{Modal,Pager,RowMenu,Avatar,Button,Field,Card,Swatches}`・`components/layout/{AppHeader,QuestIcon,ScreenStub}`。DataTable は **mocks の `shared.js`（`window.DataTable`）のみ**。
- ⚠ **mocks↔impl の未同期**＝`shared.css` の `9y`/グローバル `[hidden]`/usermenu アニメ/`.menu-pixel`/`.seg`/`.dt-*`/`.filter-checks` は **impl `design-system.css` 未反映**。会社アイコン画像は MinIO 待ち。
- ⚠ 仕様の詰め方＝**ユーザーの口頭イメージから仕様化**（選択肢での択一は不可）。詳細の正は各 `doc/` 文書（本 handoff は要約）。会話ログは参照不可。
