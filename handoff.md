# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-13）＝(D) UI標準を実施中。本セッションは全て `doc/画面設計/`（`mocks`＋`デザイン標準.md`＋`screens/`）で作業し、`impl` は一切触っていない（`git diff 390eef1..HEAD -- impl` は空＝確認済み）。本セッションの主題＝「一覧（DataTable）のクリック標準挙動と行固定・表示切替の作り込み」。①SC-10 に行のピン止めを有効化（cardRaw でもピン可・左上フロート）②SC-91 会社一覧にカード/リスト切替を追加 ③クリックの標準挙動を新設（§4.5 ⑪）＋テーブル行の指カーソル標準化 ④管理系（SC-93/92/90）の行/カードクリックを編集ダイアログへ配線。次＝(D) D-3 残り（SC-12 アイデア一覧に DataTable）／SC-90 のクリック方針の最終確認／D-4（mocks を impl へ反映）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-13 21:30 JST**（セッション終了時・実測）。
- ブランチ: **main**。作業ツリー **クリーン**。**origin/main と同期済み**（`## main...origin/main`・ahead/behind なし＝確認済み。本セッションは都度 push 済み）。
- 最新コミット: **`c3f0a9a`**（管理系の行/カードクリックを編集ダイアログへ配線）。
- 本セッションの起点＝**`390eef1`**（前セッション末の handoff コミット）。ここから **4 コミット**を積んだ（全て本セッション・全て push 済み）。
- **本セッションのコミット（新しい順・実測 `git log 390eef1..HEAD`）**:
  - `c3f0a9a` **管理系の行/カードクリック配線**＝SC-93 アカウント・SC-92 アカウント/グループの行/カードクリックで編集(リネーム)モーダルを開く。SC-93 の `system_admin` 行は no-op＋指カーソルも出さない。SC-90 は破壊的操作のみ（除外）のためクリック割当なし。
  - `4361797` **クリックの標準挙動を新設**＝`デザイン標準.md §4.5 ⑪` を追加。テーブル行にも指カーソルを標準化（`shared.js` が `onRowClick` 定義時に `.dt-row--link` を付与・`shared.css` に `cursor:pointer`＋ホバー背景）。
  - `03d94ec` **SC-91 にカード/リスト切替**＝`card(r)` を追加＝🔲カード/☰リスト トグルが出現（既定はリスト）。
  - `b0cfb63` **SC-10 に行のピン止め**＝`cardRaw` でもピンを重ねる仕組み（`shared.js` の `rawCardHtml`）＋左上フロートのピン（`.dt-pin-float`）。`pins:false` 撤去。
- コミットは **1変更＝1コミット**、末尾 `Co-Authored-By: Claude Opus 4.8`。**push は原則ユーザー依頼時のみ**（本セッションは毎回依頼あり）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。現在はフロント＝「画面モック先行 → 画面群ごとに backend 接続」方針で mocks を作り込み中。

---

## 3. 今回やったこと — 変更したファイルと理由

**本セッションで変更したファイルは全て `doc/画面設計/` 配下（`impl` は 0 変更）。** 4 コミットの内訳:

### ① SC-10 に行のピン止め（`b0cfb63`）
- **`mocks/shared.js`**＝カードビューの `cardRaw` でもピンを使えるよう **`rawCardHtml(r, pinned)`** を追加（`cfg.cardRaw(r)` の本体HTMLは書き換えず、外側に `.dt-cardraw` ラッパ＋フローティングのピンボタンだけを重ねる＝ピンは本体 `<a>` の外なので押しても遷移しない）。標準カード `cardHtml` もピンを ⋯ツール（`.dt-card__tools`）から**分離**して独立描画に。
- **`mocks/shared.css`**＝`.dt-pin-float`（左上角に半分はみ出す小円ピン。標準カード `.dt-card`・専用カード `cardRaw` 共通）。**非固定＝白背景ほぼ不透明(opacity .9)／固定＝青塗り＋光輪＋カードに太い青リング**で見分けやすく。はみ出しが切れないよう `.dt-cards:has(.dt-pin-float)` に左上余白。
- **`mocks/SC-10_クエスト一覧.html`**＝`pins:false` を撤去し `maxPins:5`。list/card でピンを共有（`localStorage` 永続）。ローカルの `cursor:pointer` は後で標準へ一本化。
- **理由**＝ユーザー要望「SC-10 でも行のピン止めを使いたい」。前セッションで cardRaw とピンUIの衝突を理由に `pins:false` にしていたが、「本体を書き換えず外側に重ねる」方式で解消して反転。

### ② SC-91 にカード/リスト切替（`03d94ec`）
- **`mocks/SC-91_システム管理.html`**＝DataTable に **`card(r)`** を追加（会社アイコン＋名称／状態バッジ・会社コード・DB識別子／👥アカウント・🗂️グループ・作成日）。これで標準どおり 🔲カード/☰リスト トグルが出現。**既定はリスト**（管理系はテーブル優先＝`defaultView` 未指定）。
- **理由**＝ユーザー指摘「SC-91 の一覧にカード or リストの選択機能がない」。表示切替は `card`/`cardLayout`/`cardRaw` を与えた時だけ出る仕様のため、`card(r)` を足すだけで解決。

### ③ クリックの標準挙動を新設＋指カーソル標準化（`4361797`）
- **`デザイン標準.md`**＝`§4.5 ⑪ クリックの標準挙動（行/カード）` を新設。要点＝**行/カードは常にクリック可（ホバーで指カーソル）／主アクションの選び方＝①既定=編集ダイアログ ②操作が1つだけならそのショートカット ③ナビ型は遷移(状態で分岐可)／例外=破壊的操作のみの行・無効/ロック行はクリック割当なし**。「振る舞いの正＝§4.5／飛び先の正＝screens §5／画面間遷移の正＝画面遷移図」も明記（二重定義しない）。
- **`mocks/shared.js`**＝`rowHtml` で `onRowClick` 定義時にテーブル行へ **`.dt-row--link`** を付与。
- **`mocks/shared.css`**＝`.table tr.dt-row--link { cursor:pointer }`＋ホバー背景（固定行は自前背景優先）。カードは既存 `.dt-card--link` で対応済。
- **`mocks/SC-10_クエスト一覧.html`**＝ローカルの `cursor:pointer` を撤去し標準に一本化（DRY）。
- **`screens/SC-10_クエスト一覧.md`／`SC-91_システム管理.md`**＝各 §5 に §4.5 ⑪ への参照ノートを追記（相対リンク＋文書名接頭辞＝ドキュメント作成規約準拠）。
- **理由**＝ユーザー要望「一覧のカードはクリックで何らかのアクションを紐づけたい／ホバーで指カーソル／既定は編集・単一操作ならそのショートカット／クエストは詳細へ・下書きは編集／どこに定義すべきか検討」。3層構成（§4.5＝規約・screens §5＝飛び先・画面遷移図＝画面間）に役割分担して回答。

### ④ 管理系の行/カードクリックを編集へ配線（`c3f0a9a`）
- **`mocks/SC-93_会社アカウント管理.html`**＝`onRowClick` を追加＝`openAccount('edit', r)`。ただし `r.system_role === 'sys_admin'` は no-op。`rowClass` に `is-rowlocked` を足し、ローカルCSS `#accountTable tr.is-rowlocked / .dt-card.is-rowlocked { cursor:default }`＋ホバー背景抑止で**ロック行は指カーソルを出さない**。
- **`mocks/SC-92_会社詳細.html`**＝アカウント表 `onRowClick=openAccount('edit', r)`（全アカウント操作可＝ロックなし）。グループ表 `onRowClick=openGroup('edit', g)`（リネーム。削除は ⋯ から）。
- **`mocks/SC-90_クエストグループ管理.html`**＝**変更なし**（唯一の操作が破壊的な「除外」のため、クリック主アクションは割り当てない方針）。
- **`デザイン標準.md §4.5 ⑪`**＝「破壊的操作のみの行は例外」「無効/ロック行はクリック不可」を追記。
- **`screens/SC-93・SC-92・SC-90 .md` の §5**＝各クリック挙動と §4.5 ⑪ 参照を追記。
- **理由**＝ユーザー選択「①管理系に編集クリックを配線」。SC-90 は破壊的単一操作なので誤操作防止で例外扱い（最終確認は次回・§7 参照）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **DataTable（mocks 側）＝安定・全機能動作**。適用済＝**SC-91 / SC-90 / SC-93 / SC-92 / SC-10**。カード/リスト切替は SC-10（cardRaw）・SC-91（card）・SC-90（cardLayout）・SC-93（cardLayout）・SC-92（accounts=cardLayout / groups=cardLayout）。style-guide「9.」がリファレンス。
- **DataTable の主な仕様（次回自分が把握すべき点）**:
  - `cfg` 主キー: `storageKey, data, rowId, unit, perPage, perPageOptions, maxPins, searchPlaceholder, searchFields, exportName, onRowClick, emptyText, rowClass(r), pins, defaultView, columns[], card(r)/cardLayout(r)/cardRaw(r)`。
  - **クリック（§4.5 ⑪ の実装）**: `onRowClick(r)` を与えると**テーブル行に `.dt-row--link`（指カーソル＋ホバー背景）・カードに `.dt-card--link`** が付く。委譲は `shared.js` の `onListClick`（`a,button,input,select,label` 上のクリックは主アクションを発火しない＝ボタンは各自動作）。行/カードごとにクリック不可にしたい時は `onRowClick` 内で早期 return し、`rowClass` でマーカー（例 `is-rowlocked`）を付けてローカルCSSで `cursor:default` に戻す（SC-93 の実装が手本）。
  - **ピン**: `cardRaw` は `rawCardHtml` が外側にフロートピンを重ねる／`card`/`cardLayout` は `cardHtml` がピンを左上フロートに分離。`.dt-pin-float` は標準/専用共通。固定は list/card で共有（`st.pins`・`localStorage` の `ideaquest_dt_<storageKey>`）。
  - 列幅＝比率(%)＋`min-width`（宣言幅合計×0.8）／縦＝全行表示（内側縦スクロールなし）／カード＝cardRaw/card/cardLayout の3通り／`pins:false` で行固定OFF。
- **backend（impl・本セッション無変更）**: 前セッションのまま（ドメイン A/B/K.2/K.3 縦通し済み）。
- **frontend（impl・本セッション無変更）**: Phase 0 完了で全画面クリッカブル。**本セッションの mocks の到達点（ピン/カード切替/クリック標準）は impl 未反映**（D-4 で対応）。
- **テスト / 検証（本セッション実測）**:
  - **mocks の UI＝ローカル chromium ヘッドレスで検証**（`chromium-browser --headless=new`）。**`--screenshot` で目視**（SC-10 ピン・SC-91 カード・SC-93 行クリックで編集モーダル）＋**`--dump-dom` で DOM 検証**（`onRowClick` 発火→モーダル open、`sys_admin` 行 no-op、`.dt-row--link` 付与、3画面が JSエラーなく描画 ROWS=5/2/10 を確認）。**`node --check doc/画面設計/mocks/shared.js` = OK（実測）**。
  - **frontend full e2e / tsc / backend pytest＝本セッション未実行（未確認）**。impl 無変更のため前セッション値が有効（e2e 26 passed・pytest 164 passed）だが、**本セッションでは再確認していない**。
  - **Docker＝本セッション起動せず**（mocks 検証はローカル chromium で完結）。
- **壊れているもの＝無し**（既知の範囲・確認した限り）。
- migration head＝**control 0010（`0010_accounts_pending_email.py`）・company 0006（`0006_company_quest_groups_soft_delete.py`）**＝本セッションで versions ディレクトリを実測（以後 impl 未変更）。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **cardRaw のピン配置**＝当初「右上角に半分はみ出し」で実装したが、SC-10 の専用カードは右上にステータスバッジがあり、ユーザー要望で**左上角へ移動**（`.dt-pin-float` を `right:-8px`→`left:-8px`）。標準カードのピンも同時に左上へ統一（`cardHtml` で ⋯ツールから分離）。
- **非固定ピンが薄すぎた**＝当初 `opacity:.65` で「背景が透けて見づらい」との指摘。**`.9` に上げて**白背景をほぼ不透明に。
- **ロック行の指カーソル**＝`.dt-row--link` は `onRowClick` 定義時に**全行**へ付くため、SC-93 の `sys_admin` 行（クリック不可）も指カーソルになる問題。→ `rowClass` に `is-rowlocked` を足し、ローカルCSSで `cursor:default`＋ホバー背景抑止に**戻す**方式で解決（エンジンは行単位のクリック可否を持たないため画面側で対処）。
- **localStorage 検証の落とし穴（次回も踏む）**＝DataTable の保存キーは **`ideaquest_dt_<storageKey>`**（`shared.js` の `const LS='ideaquest_dt_'`）。検証ハーネスで `storageKey` 直書きすると効かない。プレフィックス込みで set すること。
- **検証 chromium の癖（前セッションから継続・重要）**: `--screenshot` の出力先は **`$HOME` 配下（mocks ディレクトリ等）**にする（`/tmp` は snap sandbox で見えない）。スクロールバー等は **`--headless=new`** で確認（旧 `--headless` は挙動が違う）。iframe/file:// 越しの計測は cross-origin で不可＝SC-*.html を mocks 内に一時コピー（`_*.html`）して計測スクリプトを差し込み `--dump-dom`／使用後に削除。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **クリックの標準挙動＝§4.5 ⑪ に集約**（振る舞いの規約）。**飛び先は各画面 screens §5 が正／画面間遷移は画面遷移図が正**。理由＝役割分担が既に確立しており、二重定義を避けて正を1箇所に（DRY）。
- **主アクションの選び方**＝①既定=編集ダイアログ ②単一操作ならそのショートカット ③ナビ型は遷移（状態で分岐可）。**例外＝破壊的操作のみの行・無効/ロック行はクリック割当なし**（誤操作防止）。
- **SC-90 メンバー一覧はクリック割当なし**（不採用＝クリック＝除外のショートカット）。理由＝唯一の操作「除外」が破壊的で、行/カード全体クリックでの誤除外リスクが高い。**ただし「除外に確認があるのでクリック＝除外でよい」という判断もあり得る＝次回ユーザーに最終確認**（§7）。
- **SC-91 のカードは既定リスト**（不採用＝既定カード）。理由＝管理系はテーブル優先。
- **cardRaw のピンは本体HTML非改変＋外側フロート**（不採用＝本体HTMLにピンを埋め込む）。理由＝「画面が見た目を完全制御する専用カードモード」を維持しつつピンを載せるため。
- **ピンは左上フロート・固定は青塗り＋青リング**（不採用＝右上／薄い表示）。理由＝ユーザー要望（右上はステータスバッジと競合・薄いと見分けづらい）。

### 過去の確定（正は各設計文書。要約）
- **フロントエンド先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css/shared.js を単一デザインシステム**として採用。**モックは URL 付きモーダル（Parallel＋Intercept）**。**モック⇔設計の矛盾は設計を正**（会社 status は `active/suspended` の2値／SC-90 のロール列は SoD で非表示）。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）ほか。2プレーン×縦スライス4層。

---

## 7. 次にやること — 優先順に、具体的に

> 最優先＝**(D) UI標準/モック精度**（`doc/画面設計` で作業）。(A) 管理系 impl 整合・(B) 画面群移植は保留。

### (D-a) SC-90 クリック方針の最終確認（軽・最優先で潰す）
- ユーザーに「SC-90 のメンバー行クリック＝除外（confirm 付き）にするか、現状どおり割当なしか」を確認。**除外にする場合**＝`mocks/SC-90_クエストグループ管理.html` の DataTable 設定に `onRowClick: (r) => { /* 既存の除外ハンドラと同じ confirm→MEMBERS.filter→refresh */ }` を追加し、`screens/SC-90 §5` と `デザイン標準.md §4.5 ⑪` の例外記述を更新。

### (D-b) D-3 の残り＝SC-12 アイデア一覧に DataTable（本流・大物）
- **対象＝`mocks/SC-12_クエスト詳細.html` の「💡アイデア」タブの table**（件名/投稿者/賛成反対/💬/評価/あなた）。`window.DataTable.init` に置換。**参照実装＝SC-93**（⋯ RowMenu・rowClass・区分フィルタ）。SC-12 はタブ構成（💡アイデア/👥パーティー/🔍全文検索）で、**アイデアタブの table だけ**が対象（パーティー・全文検索タブは対象外の判断でよい）。
- クリック標準（§4.5 ⑪）に従い `onRowClick` を配線（アイデア詳細 SC-22 へ遷移するナビ型が自然＝ただし SC-22 はモーダル〔Intercept〕。飛び先は `screens/SC-12 §5` を正として確認）。
- **`mocks/SC-02_通知一覧.html` は DataTable 化しない**（時系列タイムラインで不向き＝前セッション決定）。

### (D-c) D-2 の残り（用語点検・優先度低）
- 既知の揺れ＝`screens/SC-91_システム管理.md §5` にまだ「状態=準備中」の記述が残る（設計は `active/suspended` の2値）。`デザイン標準.md §4.6` を根拠に横断修正。検索プレースホルダ等の粒度差も点検。

### (D-d) D-4＝impl 反映（最後・大物）
- **`mocks/shared.css` の差分**（`.dt-pin-float`/`.dt-cardraw`/`.dt-row--link`・カード切替・カテゴリー/2値化 等）を **`impl/frontend/src/styles/design-system.css`** へ同期。
- **DataTable を Next.js/TS 版**として `impl/frontend/src/components`（例 `DataTable.tsx`）に実装。**一覧APIのクエリ契約**（複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得）を backend に追加（`impl/backend` 4層）。mocks の `shared.js` の `window.DataTable`（末尾 IIFE）が仕様の正。クリック標準（§4.5 ⑪）・ピン・カード切替も移植。

### 【保留】(A) 管理系 impl 整合 / (B) 画面群移植
- (A) `impl/frontend/src/features/companies|accounts|questgroups` の SC-92/90/所属エディタ整合（前 handoff 参照）。(B) クエストC→アイデアD→チャットE→評価F→ゲームG→通知H→ダッシュボードI。いずれも本セッション未着手。

---

## 8. 再開に必要な環境情報

- **mocks の検証（本セッションの主戦場・Docker 不要）**:
  - 直接ロード＝`chromium-browser --headless=new --no-sandbox --disable-gpu --virtual-time-budget=2500 --dump-dom "file:///home/t-umekawa/sc-ideaquest-G2/doc/画面設計/mocks/SC-91_システム管理.html"`（`--headless=new` は実Chrome相当）。
  - スクショ＝`--screenshot="$PWD/_shot.png"`（**出力先は `$HOME` 配下＝mocks ディレクトリ等。`/tmp` は snap sandbox で見えない**）→ Read で目視。
  - 構文＝`node --check doc/画面設計/mocks/shared.js`。
  - 挙動計測harness＝SC-*.html を mocks 内に `_*.html` としてコピーし、`<body>` 直後に localStorage 事前設定（**キーは `ideaquest_dt_<storageKey>`**）や `window.addEventListener('load', …)` の計測を差し込み、`document.title` に結果を出して `--dump-dom | grep`。使い終わったら削除。
- **impl フル起動（今回未使用）**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog `:1025`/`:8025`／backend `:8000`／frontend `:3000`。
- **frontend 型チェック**＝`cd impl && docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。
- **frontend e2e**＝`docker compose up -d --build frontend` → `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`（前セッション 26 passed・**本セッション未再実行＝未確認**）。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・**本セッション未再実行＝未確認**）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **正となる場所**＝デザインシステム実体＝`doc/画面設計/mocks/shared.css`・`shared.js`（impl `src/styles/design-system.css` はその複製）。UI標準＝`doc/画面設計/デザイン標準.md`（`§4.5` 一覧の操作標準＝DataTable〔①〜⑪。**⑪＝クリックの標準挙動**〕、`§4.6` 用語・ラベル標準）。見た目＝`mocks/SC-xx_*.html`・機能/遷移＝`screens/SC-xx_*.md` の §5・画面間遷移＝`画面遷移図.md`。
- **運用**＝`.gitignore` で `*.pdf`・`.env` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時のみ。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(D-a) SC-90 クリック方針の確認 → (D-b) SC-12 アイデア一覧に DataTable → (D-c) D-2 用語点検 → (D-d) impl 反映**。SC-02 は DataTable 化しない。(A)/(B) は保留。
- ✅ 本セッション＝**mocks/デザイン標準/screens のみ変更（impl 0変更・確認済み）**。4コミット＝ピン止め/カード切替/クリック標準+指カーソル/管理系クリック配線。全て push 済み。
- ✅ 状態＝作業ツリー クリーン・origin/main と同期・HEAD `c3f0a9a`。migration head control 0010・company 0006。**e2e 26/pytest 164 は前セッション値＝本セッション未再実行（未確認）**。Docker 停止中。
- ✅ DataTable の仕様は §4＋`shared.js` の `window.DataTable`（末尾 IIFE）＋`デザイン標準.md §4.5`（⑪ クリック標準を含む）が正。クリックは `onRowClick`＋`.dt-row--link`/`.dt-card--link`、ピンは `rawCardHtml`/`cardHtml`＋`.dt-pin-float`、保存キーは `ideaquest_dt_<storageKey>`。
- ⚠ **mocks↔impl 未同期**＝本セッションの成果（ピン/カード切替/クリック標準）は **impl 未反映**（D-4）。
- ⚠ **SC-90 のクリックは未確定**＝現状「割当なし」。次回ユーザーに「クリック＝除外(confirm付き)にするか」を確認してから確定（§7 D-a）。
- ⚠ **検証は snap chromium の癖に注意**＝スクショは `$HOME` 配下・`--headless=new`・localStorage キーは `ideaquest_dt_` プレフィックス（§5・§8）。
