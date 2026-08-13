# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-13）＝(D) UI標準を実施中。本セッションは全て `doc/画面設計/mocks`＋`デザイン標準.md` で作業し、`impl` は一切触っていない。成果は大きく2つ: ①D-2 用語・ラベル標準の新設＋明確な揺れの統一（`デザイン標準.md §4.6`）／②「一覧の操作標準 DataTable」を大幅に育て、管理系4画面（SC-90/91/92/93）＋一般一覧 SC-10 に適用（D-3）。DataTable は横スクロール/縦スクロール/カード等を反復修正して安定化。次＝D-3 の残り（SC-12 アイデア一覧が候補）／D-4（mocks を impl へ反映）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-13 JST**（セッション終了時）。
- ブランチ: **main**。作業ツリー **クリーン**。**本 handoff コミットを push 予定**（ユーザー依頼）。直前まで origin は `6f65542` で、ローカルは `ahead 4`（`50546a5`/`b77d16b`/`82ded8f`/`1e6eddd`）だった。
- 最新コミット（handoff 前）: **`1e6eddd`**（SC-10 に DataTable 適用・専用カードモード新設）。
- 本セッションの起点＝**`b1ff285`**（前セッション末の handoff）。ここから **19 コミット**を積んだ（全て本セッション）。
- **本セッションの主なコミット（新しい順・抜粋）**:
  - `1e6eddd` **SC-10 クエスト一覧に DataTable 適用**＝`cardRaw(r)`（カード外側まで含む完全HTMLを画面が返す＝`.dt-card` ラッパもピンも被せない専用カードモード）＋`pins:false` を DataTable に新設。SC-10 のアクセント帯付きクエストカードの見た目を維持したまま、絞込/ソート/切替/CSV を標準化。
  - `82ded8f` **テーブル内側の縦スクロール廃止**＝`.dt-scroll` の `max-height(62vh)` を外し `overflow-x:auto; overflow-y:visible`。全行を縦に表示しきり、長い時はページ側がスクロール。固定ヘッダー（`thead` sticky）撤去、固定行は先頭に強調＋区切り線でまとめて表示。
  - `b77d16b` **狭い時は最小幅を保って横スクロール**＝テーブルに `min-width`（＝宣言幅合計の 80%）を課す。容器幅≥min-width はフィット（横スクロール無し）／未満は最小幅を保持し横スクロール（列を潰さない）。
  - `50546a5` **列幅を比率(%)方式へ（根本見直し）**＝px 固定でなく「宣言幅の比率(%)」で与え、`table-layout:fixed` のテーブルを常に容器幅にフィット。JS の測り合わせ（脆かった `refit`）を撤去。
  - `53f1382` **SC-92 会社詳細に2つの DataTable**（クエストグループ＋アカウント）。`ecec36d` **SC-93 sys_admin 行の操作列を 🔒 アイコン化**（あふれ解消）。`9542a01` **SC-93**・`458751a` **SC-90** に DataTable 適用。
  - `fb5b639`〜`b503263` **DataTable 磨き**＝ツールバー2カラムグリッド安定配置／クリア一本化／「すべてクリア」指カーソル／カード用並び替えのプレースホルダー化。
  - `7dba576`/`55f6f0c`/`d8a4263` **カード表示機能**＝テーブル/カード切替・カードに ⋯ アクション・切替を最右固定・提案1〜4（カード時単一ソート/cardLayout ヘルパ/カード密度/a11y）・詳細ソート省略名ツールチップ。
  - `9fe849d`/`d2e32e2` **D-2 用語・ラベル標準**（`デザイン標準.md §4.6`）＝明確な揺れを統一＋「使い分け」を明文化。
- **コミットは基本 1変更＝1コミット**（本セッションは handoff との2段は未実施＝随時 push した回のみ）。末尾 `Co-Authored-By: Claude Opus 4.8`。**push は原則ユーザー依頼時のみ**。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。現在はフロント＝「画面モック先行 → 画面群ごとに backend 接続」方針で mocks を作り込み中。

---

## 3. 今回やったこと — 変更したファイルと理由

**本セッションで変更したファイルは 11 個、全て `doc/画面設計/` 配下（`impl` は 0 変更）。**

### 共有部品（DataTable の本体）
- **`doc/画面設計/mocks/shared.js`**＝`window.DataTable`（`DataTable.init(root, cfg)`）を大幅拡張。本セッションで足した主な機能: テーブル/カード表示切替（`card`/`cardLayout`/`cardRaw` の3通り）・カードに ⋯ アクション自動表示・カード時の単一並び替えセレクト（プレースホルダー「並び替え」）・`rowClass(r)`（行/カードに状態クラス付与）・`emptyText`・`pins:false`（行固定無効化）・列幅の**比率(%)フィット＋`min-width`（宣言幅合計の80%）**・`render()` 後の `applyCellClips` 自動呼び出し・クリアボタン一本化。
- **`doc/画面設計/mocks/shared.css`**＝`.viewtoggle` を共通昇格・`.dt-cards`/`.dt-card`（カードグリッド・右上ツール・compact）・`.dt-cardsort`・ツールバー2カラムグリッド（`[data-dt-toolbar]`）・`.dt-scroll` を横スクロールのみ（`overflow-x:auto; overflow-y:visible`・`max-height` 撤去）・`.st-provisioning` 削除・`.dt-chip--clear` 指カーソル等。
- **`doc/画面設計/mocks/style-guide.html`**＝「9. 一覧の操作標準（DataTable）」デモを更新（`cardLayout`＋`onRowClick`＋アクション、説明文）。

### DataTable を適用した画面（D-3）
- **`SC-91_システム管理.html`**（会社一覧・前セッションで適用済／本セッションは共有部品の変更が波及）。
- **`SC-90_クエストグループ管理.html`**＝手書き table を `DataTable.init` に置換。氏名(アバター+名)/ログインID/参加日＋⋯除外。**管理グループ切替**は現グループのメンバーだけを live 配列 `viewData` に載せ替えて `dt.render()`。空文言は `emptyText`。
- **`SC-93_会社アカウント管理.html`**＝氏名/ログインID/メール/システムロール(区分)/所属QG(cell-tags 省略)/状態(区分)＋⋯編集/PW再設定/無効化⇄再有効化。**無効行は `rowClass` でミュート**、**システム管理者行は操作不可＝🔒 アイコン＋ツールチップ**（SC-92 で管理）。対象解決は index でなく **loginId**。
- **`SC-92_会社詳細.html`**＝**1画面に2つの DataTable**（クエストグループ＝名称/コード/メンバー数＋⋯リネーム/削除、code で解決／アカウント＝SC-93 と同型だが sys_admin も操作可）。`storageKey` を会社別に分けて共存。相互反映（グループrename/delete→アカウント再描画、アカウント所属編集→グループのメンバー数再計算）。
- **`SC-10_クエスト一覧.html`**（一般一覧）＝手書きの toolbar/card/table/pager を `DataTable.init` に置換。**カードの見た目は `cardRaw` で専用クエストカード（アクセント左帯＋アイコン）を維持**、`pins:false`。リストは7列。状態/カテゴリー/**グループ(hidden列でも絞込可)** は詳細絞込の区分、既定は新着順（order降順）。行/カードクリックで詳細（下書きは SC-11）。

### D-2（用語・ラベル標準）
- **`デザイン標準.md`**＝`§4.6 用語・ラベル標準` 新設。**明確な揺れを統一**＝カテゴリ→カテゴリー（`SC-10`/`SC-40`）・クエスト権限「管理」→「クエスト管理」/説明文「作成」→「アイデア作成」（`SC-11`、SC-12 に整合）・会社状態を設計どおり2値化（`SC-91`/`SC-92`/style-guide から「準備中/provisioning」除去）。**あえて統一しない使い分け**（並び替え≠並べ替え・所有≠獲得・パーティー≠参加メンバー・メッセージ≠コメント・期限日≠締切）を根拠付きで明記。§4.5 も DataTable の到達点（④列幅・⑨全行表示・⑩表示切替）に随時更新。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **DataTable（mocks 側）＝安定・全機能動作**。適用済＝**SC-91 / SC-90 / SC-93 / SC-92 / SC-10**。style-guide「9.」がリファレンス。
- **DataTable の主な仕様（次回自分が把握すべき点）**:
  - `cfg` 主キー: `storageKey, data, rowId, unit, perPage, perPageOptions, maxPins, searchPlaceholder, searchFields, exportName, onRowClick, emptyText, rowClass(r), pins, defaultView, columns[], card(r)/cardLayout(r)/cardRaw(r)`。
  - `columns[]` 各列: `key, label, locked, width, sortable, filter{type:text|enum|number|date, options}, sortVal, filterVal, searchVal, csvVal, cellClass, align:'num', hiddenDefault, actions:true, render(r)`。
  - **列幅**＝比率(%)で与え `table-layout:fixed` のテーブルを容器幅にフィット。テーブル `min-width=宣言幅合計×0.8`＝**広い時はフィット（横スクロール無し）／狭い時は最小幅を保って横スクロール**。JS で幅を測る処理は無い（`renderHead` 内で完結）。
  - **縦**＝`max-height` なし＝**全行を縦に表示しきる**（内側の縦スクロール・固定ヘッダーは無い）。行数は `perPage` で抑える設計。
  - **カード**＝`cardRaw`（画面完全制御・`.dt-card` 被せない）／`card`（本文HTML・`.dt-card` ラッパ＋右上ツール付与）／`cardLayout`（`{title,badges,meta,stats}` ヘルパ）。`pins:false` で行固定OFF。
- **backend（impl・本セッション無変更）**: 前セッションの状態のまま（ドメイン A/B/K.2/K.3 縦通し済み）。
- **frontend（impl・本セッション無変更）**: Phase 0 完了で全画面クリッカブル。管理系 SC-91（モック完全準拠）・SC-93 整合済（前セッション）。**本セッションの mocks の到達点は impl 未反映**（D-4 で対応）。
- **テスト / 検証（本セッション実測）**:
  - **mocks の UI＝ローカル chromium ヘッドレスで検証**（`chromium-browser`／`--headless` と実Chrome相当の `--headless=new` の両方・`dump-dom` で DOM 検証＋`--screenshot` で目視）。DataTable の横スクロール/縦表示/フィット/各画面の描画を確認済。**`node --check doc/画面設計/mocks/shared.js` = OK**。
  - **frontend full e2e / tsc / backend pytest＝本セッション未実行**（impl 無変更のため前セッション値が有効: e2e 26 passed・pytest 164 passed。いずれも**本セッション未再確認**）。
  - **Docker＝本セッションは起動していない**（`docker compose ps` は空だった＝停止中）。mocks 検証はローカル chromium で完結。
- **壊れているもの＝無し**（既知の範囲）。
- migration head＝**control 0010・company 0006**（本セッション冒頭に versions ファイルで確認済み・以後未変更）。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **横スクロール問題（DataTable）＝方式を3回変えて根治**（重要な学び）:
  1. 最初「宣言幅合計が容器を少し超える時だけ JS で比例縮小」→ **ヘッドレスでは0でも実Chromeで数px残る**（縦スクロールバーが後から出て容器幅が縮む・サブピクセル・測定タイミングに依存して脆い）。`refit`（rAF/resize で測り直し）でも不十分。
  2. **根本見直し＝列幅を比率(%)で与え `table-layout:fixed` を常に容器幅にフィット**（測定不要）→ 横スクロールは根絶したが、**狭い窓で全列が潰れて読めない**（横スクロールも出ない）。
  3. **最終＝(%)＋テーブル `min-width`（宣言幅合計×0.8）**＝広い時フィット・狭い時は最小幅を保って横スクロール。これで両立（`50546a5`→`b77d16b`）。**教訓: `table-layout:fixed` は幅の測り合わせをせず、% と min-width で CSS に任せるのが堅い**。
- **カードの専用デザイン vs 汎用 `.dt-card`**＝SC-10 のアクセント帯付きカードは `.dt-card` ラッパ（枠/余白/ピン）と衝突。→ **`cardRaw`（外側まで画面が返す専用カードモード）＋`pins:false` を新設**して解決（`1e6eddd`）。
- **会社状態「準備中」**＝モックに provisioning があったが設計は `active/suspended` の2値（`データモデル.md`）。**2値化して除去**（style-guide デモにも残っていたので合わせて除去）。
- **検証の落とし穴（次回も踏む）**:
  - **snap 版 chromium はスクリーンショットを sandbox 内に書く**＝`--screenshot` の出力先は `/tmp` でなく **`$HOME` 配下**（例: mocks ディレクトリ）にすること。`/tmp` だと「書いた」ログは出るがファイルが見えない。
  - **`--headless`（旧）はスクロールバーを描画しない**ので実Chromeと挙動が違う。横スクロール等は **`--headless=new`** で確認する。
  - **file:// で日本語パスを絶対指定するとサブリソース（shared.css/js）が読めない**。検証用の一時HTMLは **mocks ディレクトリ内に置いて相対参照**する（`SC-*.html` 自体は相対参照なので直接ロードでOK）。
  - iframe 越しの計測は file:// が cross-origin 扱いで `contentDocument` にアクセスできない → SC-* のコピーに計測スクリプトを差し込んで測る。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション（DataTable・D-2）
- **DataTable の列幅は「比率(%)＋min-width」**（不採用＝px 固定・JS 測り合わせ）。理由＝測定タイミング/スクロールバー/サブピクセルに依存せず堅い。§4.5 ④ 参照。
- **縦は内側スクロールを持たず全行表示**（不採用＝`max-height:62vh` の内側縦スクロール）＝ユーザー要望。行数は `perPage` で抑える。固定ヘッダー（sticky）は内側スクロール前提だったので撤去。§4.5 ⑨。
- **カードは3通り（`cardLayout`/`card`/`cardRaw`）**＝汎用と「見た目を画面が完全制御する専用カード」を両立。SC-10 は `cardRaw`＋`pins:false`。
- **クリアは常に1つ**（詳細ソート/絞込がある時はチップ行「すべてクリア」に一本化し `.filters` の標準クリアを隠す）。**ツールバーは2カラムグリッドで右側ツールが折り返さない**。
- **D-2 用語**＝カテゴリー/クエスト管理/アイデア作成/会社状態2値化 を統一。**並び替え≠並べ替え・所有≠獲得・パーティー≠参加メンバー・メッセージ≠コメント・期限日≠締切 は設計裏付けのある使い分けなので統一しない**（`デザイン標準.md §4.6`）。
- **一般一覧は個性を尊重**＝SC-10 はカード見た目維持で適用。**SC-02 通知（タイムライン）は DataTable 不向き**。適合は都度判断。

### 過去の確定（正は各設計文書。要約）
- **フロントエンド先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css/shared.js を単一デザインシステム**として採用。**モックは URL 付きモーダル（Parallel＋Intercept）**。**モック⇔設計の矛盾は設計を正**（会社 status は `active/suspended` の2値／SC-90 のロール列は SoD で非表示）。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）ほか。2プレーン×縦スライス4層。

---

## 7. 次にやること — 優先順に、具体的に

> 最優先＝**(D) UI標準/モック精度**（`doc/画面設計` で作業）。(A) 管理系 impl 整合・(B) 画面群移植は保留。

### (D) D-3 の残り（DataTable 展開）
- **候補＝`mocks/SC-12_クエスト詳細.html` のアイデア一覧**（件名/投稿者/賛成反対/💬/評価/あなた＝素直な表で DataTable が合う）。SC-12 はタブ構成（💡アイデア/👥パーティー/🔍全文検索）なので、**アイデアタブの table を `DataTable.init` に置換**する（`SC-93` が同型の参照実装）。パーティー一覧・全文検索タブは対象外の判断でよい。
- **`SC-02_通知一覧.html` は DataTable 化しない**（時系列グルーピングのタイムラインで不向き）。
- 適用時の型＝`SC-91`（単一リンク操作）/`SC-93`（⋯ RowMenu・rowClass・区分フィルタ）/`SC-90`（画面固有スコープを `viewData` で差し替え）/`SC-10`（`cardRaw` 専用カード＋`pins:false`）から近いものを流用。

### (D) D-2 の残り（優先度低）
- 軽微な用語点検（例＝`SC-91` の検索プレースホルダが汎用「検索…」、ナビ「実績/バッジ」とフィルタ「実績」の粒度差）。必要になったら `デザイン標準.md §4.6` を根拠に横断修正。

### (D) D-4＝impl 反映（最後・大物）
- **`doc/画面設計/mocks/shared.css` の差分**（DataTable 部品・`.viewtoggle`/`.dt-cards`/`.dt-card`/`.dt-cardsort`・`[data-dt-toolbar]` グリッド・`.dt-scroll` の横スクロールのみ化・カテゴリー/2値化 等）を **`impl/frontend/src/styles/design-system.css`** へ同期。
- **DataTable を Next.js/TS 版**として `impl/frontend/src/components`（例 `DataTable.tsx`）に実装。**一覧APIのクエリ契約**（複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得）を backend に追加（`impl/backend` 4層）。mocks の `shared.js` の `window.DataTable`（末尾 IIFE）が仕様の正。

### 【保留】(A) 管理系 impl 整合 / (B) 画面群移植
- (A) `impl/frontend/src/features/companies|accounts|questgroups` の SC-92/90/所属エディタ整合（前 handoff 参照）。(B) クエストC→アイデアD→チャットE→評価F→ゲームG→通知H→ダッシュボードI。いずれも本セッション未着手。

---

## 8. 再開に必要な環境情報

- **mocks の検証（本セッションの主戦場・Docker 不要）**:
  - 直接ロード＝`chromium-browser --headless=new --no-sandbox --disable-gpu --virtual-time-budget=2500 --dump-dom "file:///home/t-umekawa/sc-ideaquest-G2/doc/画面設計/mocks/SC-91_システム管理.html"`（`--headless=new` は実Chrome相当でスクロールバーを描画）。
  - スクショ＝`--screenshot="$PWD/_shot.png"`（**出力先は `$HOME` 配下＝mocks ディレクトリ等。`/tmp` は snap sandbox で見えない**）→ Read で目視。
  - 構文＝`node --check doc/画面設計/mocks/shared.js`。
  - 計測harness＝SC-*.html を mocks 内に `_copy.html` としてコピーし、最後の `</script>` 直前に計測スクリプトを差し込んで `--dump-dom`（`document.title` に出すと拾いやすい）。使い終わったら削除。
- **impl フル起動（今回は未使用）**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog `:1025`/`:8025`／backend `:8000`／frontend `:3000`。
- **frontend 型チェック**＝`cd impl && docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。
- **frontend e2e**＝`docker compose up -d --build frontend` → `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`（前セッション 26 passed・本セッション未再実行）。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・本セッション未再実行）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **正となる場所**＝デザインシステム実体＝`doc/画面設計/mocks/shared.css`・`shared.js`（impl `src/styles/design-system.css` はその複製）。UI標準＝`doc/画面設計/デザイン標準.md`（`§4.5` 一覧の操作標準＝DataTable、`§4.6` 用語・ラベル標準）。見た目＝`mocks/SC-xx_*.html`・機能＝`screens/SC-xx_*.md`・遷移＝`画面遷移図.md`。
- **運用**＝`.gitignore` で `*.pdf`・`.env` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時のみ。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**D-3 残り（SC-12 アイデア一覧が候補）→ D-4（mocks を impl へ反映）**。SC-02 は DataTable 化しない。(A)/(B) は保留。
- ✅ 本セッション＝**mocks のみ変更（impl 0変更）**。DataTable を管理系4画面＋SC-10 に適用し、横/縦スクロール・カード等を反復修正して安定化。D-2 用語標準を新設。
- ✅ 状態＝作業ツリー クリーン・**handoff コミットを push 予定**。migration head control 0010・company 0006。**e2e 26/pytest 164 は前セッション値＝本セッション未再実行**。Docker は停止中。
- ✅ DataTable の仕様は §4＋`shared.js` の `window.DataTable`（末尾 IIFE）＋`デザイン標準.md §4.5` が正。列幅＝比率%＋min-width、縦＝全行表示、カード＝cardRaw/card/cardLayout、pins:false。
- ⚠ **mocks↔impl 未同期**＝本セッションの DataTable/用語標準は **impl 未反映**（D-4）。
- ⚠ **検証は snap chromium の癖に注意**＝スクショは `$HOME` 配下・`--headless=new` を使う・file:// 日本語パスの絶対指定はサブリソース読めず（§5・§8）。
