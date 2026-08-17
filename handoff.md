# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-17）＝(D) UI標準/モック精度を実施中。本セッションも全て `doc/画面設計/`（`mocks`＋`デザイン標準.md`＋`screens/`）で作業し、`impl` は一切触っていない（`git diff a4323eb..HEAD -- impl` は空＝確認済み）。本セッションの主題＝①DataTable ツールバーの 0 ベース刷新（クリア一本化・「適用中」網羅・段1同一高さ・list/card 共通の並び替え）②SC-12 アイデア一覧を DataTable 化（D-b＝D-3 本流）③用語点検（D-c＝会社状態2値化・カテゴリー統一・検索粒度統一）④各画面の補足文をユーザー向けに刷新（画面ID・仕様メモを全可視サーフェスから除去）。次＝(D-d) mocks→impl 反映（大物）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-17 11:00 JST**（セッション終了時・実測）。
- ブランチ: **main**。作業ツリー **クリーン**。**origin/main と同期済み**（`## main...origin/main`・ahead/behind なし＝確認済み。本セッションは都度 push 済み）。
- 最新コミット: **`202b568`**（モーダル総点検＝タブ見出し/リンク文言/属性の画面IDを一掃）。
- 本セッションの起点＝**`a4323eb`**（前セッション末の handoff コミット）。ここから **6 コミット**を積んだ（全て本セッション・全て push 済み）。
- **本セッションのコミット（新しい順・実測 `git log a4323eb..HEAD`）**:
  - `202b568` **モーダル総点検**＝主要モーダルを実際に開いて目視＋全可視テキスト再スキャン。href 行に埋もれて見落としていた画面IDを一掃＝全19画面の `<title>`（タブ見出し）から「SC-xx」除去・`document.title`（SC-92）・画面内リンク/ボタン文言（SC-25/24/22/32/30/01）・未使用 `data-edit` 属性（SC-01）。
  - `9cd2275` **ダイアログ/検索結果の追補**＝SC-93/92 発行モーダルの「所属クエストグループ」ヒントから SC-90/日付/技術語を除去。SC-12 全文検索の結果リンク（→ アイデア詳細 (SC-22) 等）から画面ID除去（判定を表示ラベル基準に変更）。「一般（general）」→「一般」等の内部コード除去。
  - `e00b6f8` **各画面の補足文をユーザー向けに刷新**（全19画面）＝純粋な仕様メモ（本番/Intercept/Parallel/PGroonga/three-vrm/framer-motion/.env/docker compose/MinIO/UserItem 等）を削除。混在は user-facing 文だけを平易に残す。可視の画面ID（ヘッダーメニュー「アバター/着せ替え（SC-31）」等）を除去。
  - `6665126` **(D-c) 用語点検**＝会社状態を 2 値（active=有効/suspended=停止）に screens も統一＝SC-91/92 の「準備中」除去（作成時=有効〔`company_status` default `active`〕・会社DB未整備は停止/メンテへ）。「カテゴリー」統一（SC-10/21/22/24/25/40・index）。SC-91 検索プレースホルダを `searchFields` 由来に統一。デザイン標準.md §4.6 に反映。
  - `34fcfb9` **(D-3/D-b) SC-12 アイデア一覧を DataTable 化**＝「💡アイデア」タブの table を `window.DataTable.init` に置換（旧 applyList 一式撤去）。詳細は §3-②。
  - `7abfe8c` **(D-3) DataTable ツールバー刷新**＝クリア一本化・「適用中」網羅・段1同一高さ・list/card 共通の並び替え。詳細は §3-①。
- コミットは **1変更＝1コミット**、末尾 `Co-Authored-By: Claude Opus 4.8`。**push は原則ユーザー依頼時のみ**（本セッションは毎回依頼あり＝全て push 済み）。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。現在はフロント＝「画面モック先行 → 画面群ごとに backend 接続」方針で mocks を作り込み中。

---

## 3. 今回やったこと — 変更したファイルと理由

**本セッションで変更したファイルは全て `doc/画面設計/` 配下（`impl` は 0 変更・確認済み）。**

### ① DataTable ツールバーを 0 ベース刷新（`7abfe8c`）
- **背景（ユーザー指摘）**＝現行ツールバーの「凸凹感／クリアの二重化／『適用中』の抜け」。style-guide.html に静的サンプルを作って方向性を固めてから本体へ移植。
- **`mocks/shared.js`＋`mocks/shared.css`**＝以下を実装:
  - **クリア一本化**＝旧 `[data-dt-clear]`（「絞り込み・並び替えをクリア」）を**廃止**。クリアは「適用中」行末の**「すべてクリア」1つ**（`.dt-chip--clear`・`margin-left:auto` で右寄せ）。
  - **「適用中」を網羅**＝`renderChips()` で **検索（`🔍 "…"`）・並び替え（単一/複数キー・list/card 問わず＝`activeSort()` 基準）・絞込（項目別）** を全てチップ化。各チップ ✕ で個別解除（検索チップ→検索クリア／並び替えチップ→単一・詳細とも解除）。
  - **段1 同一高さ**＝`[data-dt-toolbar] { --dt-ctl-h:34px }` で検索・ボタン・seg・viewtoggle を同一高さに。検索は🔍アイコン内包の単一行（対象項目名は placeholder に内包＝下段ヒント `.dt-search__hint` 廃止）。
  - **並び替えを list/card 共通の 1 ボタンに統一**＝カード専用の `.dt-cardsort` セレクトを**廃止**。「↕ 並び替え」ボタン（複数キーダイアログ）が list/card 共通の入口。単一列ソートは list 見出しクリックで設定した状態がカードにも引き継がれる。
  - **右ツール順**＝`列設定 → エクスポート → 表示密度 → 表示切替`（密度を表示切替の直左に隣接）。
  - **ダイアログ見出しをボタン名に整合**＝「詳細ソート（複数項目）」→「並び替え（複数項目）」／「詳細絞込」→「絞り込み」。未使用の `sortableCols` も削除。
- **`mocks/style-guide.html`**＝「9.」の説明文を新レイアウトに更新（提案用の「9-b」静的サンプルは実装済みのため撤去）。
- **`デザイン標準.md §4.5`**（DataTable 標準の正）＝可視化ルール（適用中チップに集約・すべてクリア1つ）・安定配置（段1同一高さ・密度は表示切替の直左）・カード時の並び替え（専用セレクト廃止・共通ボタン）・ダイアログ名を実装に整合。

### ② SC-12 アイデア一覧を DataTable 化（`34fcfb9`・D-b＝D-3 本流）
- **`mocks/SC-12_クエスト詳細.html`**＝「💡アイデア」タブの旧 table＋applyList 一式（検索/フィルタ/ソートUI・行クリックハンドラ）を `window.DataTable.init`（`storageKey: 'sc12-ideas'`）へ置換。
  - **可視6列**＝件名/投稿者/賛成・反対/💬/評価/あなた（＝`screens/SC-12 §4.2` に一致）。
  - **検索**＝件名・投稿者／**絞込**＝評価（評価待ち/評価済）・あなた（未投票/投票済/自分の投稿/下書き）を項目別（enum）で／**並び替え**＝見出しクリック＋「↕ 並び替え」。
  - **「新着順」**＝**投稿日列（`hiddenDefault: true`・列設定で表示可）の降順**で実現（可視列は6のまま §4.2 と両立）。既定順＝投票が多い順（配列を agree desc で保持）。
  - **クリック標準（§4.5 ⑪ ナビ型）**＝公開済み→SC-22 詳細／自分の下書き→SC-21 編集（`onRowClick: (r)=>location.href=r.href`）。
  - **カード/リスト切替**＝`cardLayout` を付与。対象は**アイデアタブのみ**（パーティー/全文検索/概要は対象外）。
- **`screens/SC-12_クエスト詳細.md`**（§4.2/§5）＝DataTable 移行ノート・§4.5⑪ 参照・行クリックの下書き分岐を追記。

### ③ (D-c) 用語点検（`6665126`）
- **根拠＝`デザイン標準.md §4.6`（用語・ラベル標準）**。会社状態＝2値（active=有効/suspended=停止）・「準備中」は設計外＝不採用。
- **`screens/SC-91`・`SC-92`**＝「準備中」を全除去。**作成時=有効**（データモデル.md `companies.status default active`＝正）・会社DB未整備は「停止（メンテナンス）」へ切替、と実態に整合。
- **「カテゴリー」統一**＝`screens/SC-10/21/22/24/25/40`・`mocks/index.html`。`SC-02`「type→カテゴリ」は通知の**種別**＝別概念で据え置き。
- **`mocks/SC-91`**＝検索プレースホルダ上書き（`searchPlaceholder:'検索…'`）を撤去し `searchFields` 由来（「会社名・会社コード・DB識別子 を検索…」）に統一。
- **`デザイン標準.md §4.6` 適用状況**に screens 正規化（2026-08-17・D-c）を追記。

### ④ 各画面の補足文をユーザー向けに刷新（`e00b6f8`＋`9cd2275`＋`202b568`）
- **ユーザー要望**＝「補足文はユーザー向けに。画面ID(SC-xx)はユーザーが認識しないので避ける。仕様メモは削除」。
- **方針**＝①純粋な仕様メモ（本番/Intercept/Parallel/PGroonga/three-vrm/framer-motion/.env/docker compose/MinIO/UserItem/データモデル/§/B.x 等の実装・インフラ・設計参照）を**削除** ②ユーザー情報＋メモの混在は user-facing 文だけを平易に残す（下書きの見え方・投票/評価/コメントのルール・XP/コイン・権限説明・通知の種別・検索対象など） ③**画面ID・内部enumコード（general/admin 等）を全可視サーフェスから除去**。
- **対象＝全19画面**。是正した可視サーフェス＝本文の `.hint`/`.muted`/`.role-note`/`.provision-note`/dropzone ヒット・**モーダル内のフォーム項目ヒット**・**`<title>`（タブ見出し）**・`document.title`・**画面内リンク/ボタン文言**・`title=`/`placeholder=` 属性・`data-edit` 属性。
- **残存する SC-id/内部コードは全て非可視のコード/HTMLコメント（`/* */`・`<!-- -->`・`//`）のみ**（据え置き＝画面には出ない）。
- **注意（次回も要点検）**＝**モーダルは JS で開くため目視漏れが起きやすい**。可視テキストのスキャンは「タグ間テキスト `>[^<]*…[^<]<`」で行うと href 行に埋もれたラベルも拾える（`href="…"` 行を単純除外すると見落とす＝今回それで一度取りこぼした）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **DataTable（mocks 側）＝安定・全機能動作**。適用済＝**SC-91 / SC-90 / SC-93 / SC-92 / SC-10 / SC-12（今回追加）**。ツールバー刷新（段1同一高さ・適用中チップ集約・すべてクリア1つ・list/card 共通「↕ 並び替え」）は shared.js/css なので**全 DataTable 画面に自動反映**。style-guide「9.」がリファレンス。
- **DataTable の主な仕様（次回自分が把握すべき点・今回変更分を反映）**:
  - `cfg` 主キー: `storageKey, data, rowId, unit, perPage, perPageOptions, maxPins, searchFields, exportName, onRowClick, emptyText, rowClass(r), pins, defaultView, columns[], card(r)/cardLayout(r)/cardRaw(r)`。列は `{key,label,locked,width,sortable,filter:{type:'text'|'enum'|'number'|'date',options:[[value,label],…]},sortVal,searchVal,filterVal,csvVal,render,align:'num',cellClass,actions:true,hiddenDefault:true}`。
  - **ツールバー（刷新後）**＝段1: 🔍検索（placeholder は `searchFields` 由来）/ ↕並び替え（複数キーダイアログ・list/card 共通・件数バッジ）/ ⧩絞り込み（項目別ダイアログ・件数バッジ）｜右: 列設定→エクスポート→密度→表示切替。段2: 「適用中」チップ（検索・並び替え・絞込を全て）＋右端「すべてクリア」。`--dt-ctl-h:34px` で段1同一高さ。
  - **クリック（§4.5 ⑪）**＝`onRowClick(r)` で行に `.dt-row--link`・カードに `.dt-card--link`。委譲は `a,button,input,select,label` 上のクリックを主アクション化しない。行単位で無効化は `onRowClick` 内 early return＋`rowClass` マーカー＋ローカルCSS（SC-93 の `is-rowlocked` が手本）。
  - **ソート**＝見出しクリック=単一（`simpleSort`）／「↕ 並び替え」=複数キー（`advSort`・`.sort-builder` 2ペイン）。可視しない列でも `sortable:true` なら並び替えダイアログに出る（例＝SC-12 の投稿日 `hiddenDefault`＝「新着順」）。
  - **ピン**＝`cardRaw` は `rawCardHtml` が外側にフロートピン／`card`/`cardLayout` は `cardHtml` が左上フロート。保存キーは `ideaquest_dt_<storageKey>`。`pins:false` で無効化。
- **backend（impl・本セッション無変更）**: 前セッションのまま（ドメイン A/B/K.2/K.3 縦通し済み）。
- **frontend（impl・本セッション無変更）**: Phase 0 完了で全画面クリッカブル。**本セッションの mocks の到達点（ツールバー刷新・SC-12 DataTable化・用語/補足の是正）は impl 未反映**（D-d で対応）。
- **テスト / 検証（本セッション実測）**:
  - **mocks の UI＝ローカル chromium ヘッドレスで検証**（`chromium-browser --headless=new`）。`--screenshot` で目視（新ツールバー list/card・SC-12 の DataTable・SC-93/92/90 の各モーダル）＋`--dump-dom` で DOM 検証（行数・可視テキストの画面ID/メモ残存チェック）。**`node --check doc/画面設計/mocks/shared.js` = OK（実測）**。
  - **frontend full e2e / tsc / backend pytest＝本セッション未実行（未確認）**。impl 無変更のため前セッション値が有効（e2e 26 passed・pytest 164 passed）だが、**本セッションでは再確認していない**。
  - **Docker＝本セッション起動せず**（mocks 検証はローカル chromium で完結）。
- **壊れているもの＝無し**（既知の範囲・確認した限り）。
- migration head＝**control 0010（`0010_accounts_pending_email.py`）・company 0006（`0006_company_quest_groups_soft_delete.py`）**＝本セッションで versions ディレクトリを実測（以後 impl 未変更）。

---

## 5. 詰まっている点 — 失敗したアプローチと理由

- **ブロッカーは無い**。
- **補足文の画面ID取りこぼし（重要・次回も踏む）**＝当初 `<p class="hint">` 等の本文ノートだけを見ていて、**モーダル内のフォーム項目ヒット・`<title>`（タブ見出し）・リンク/ボタン文言**を取りこぼした。特に `grep` で `href="…SC-…"` 行を除外したため、**同一行に href とラベルが同居するリンク文言（例「アイデア詳細を見る（SC-22）」）を見落とした**。→ 最終的に「タグ間テキスト（`>[^<]*SC-\d\d[^<]*<`）」抽出＋`title=`/`placeholder=` 属性走査＋主要モーダルの実オープン目視で潰した。次回も可視テキスト点検はこの方法で。
- **DataTable のデフォルトソート**＝engine に「初期ソート」の config は無い。SC-12 は DATA 配列を投票降順で保持して初期表示を「投票が多い順」に見せている（並べ替えは header/ダイアログで上書き）。
- **cardLayout の形式**＝`badges:[{label,cls}]`（オブジェクト）／`meta:[文字列]`／`stats:[文字列]`。stats にオブジェクトを渡すと `[object Object]` になる（esc される＝HTML/色は不可・プレーン文字列で）。
- **localStorage 検証の落とし穴**＝DataTable の保存キーは **`ideaquest_dt_<storageKey>`**（`shared.js` の `const LS='ideaquest_dt_'`）。検証ハーネスで `storageKey` 直書きは効かない。
- **検証 chromium の癖（継続・重要）**＝`--screenshot` の出力先は **`$HOME` 配下**（`/tmp` は snap sandbox で見えない）。スクロールバー等は **`--headless=new`**。file:// 越しの `fetch` は CORS で不可＝計測は SC-*.html を mocks 内に一時コピー（`_*.html`）してスクリプトを差し込み `--dump-dom`／使用後に削除。JS で開くモーダルは `window.addEventListener('load', …)` の中でトリガーボタンを `click()` してから screenshot。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **DataTable ツールバー＝2段固定・クリアは1つ・適用中は全条件チップ化・段1同一高さ**（不採用＝クリア2種併存／検索・カードソートを適用中に出さない／小ボタンの後にフル高コンボ）。理由＝ユーザー指摘の凸凹感・二重クリア・「適用中」の抜けを解消。
- **並び替えは list/card 共通の 1 ボタン**（不採用＝カード専用セレクト `.dt-cardsort`）。理由＝list/card で操作を一本化し高さ違いの凸凹を解消。
- **SC-12「新着順」は投稿日列 `hiddenDefault`**（不採用＝可視列に投稿日を追加／engine に defaultSort を足す）。理由＝§4.2 の可視6列を保ちつつ並び替えの選択肢に出せる（最小変更・engine 非改変）。
- **会社状態は 2 値（有効/停止）**＝作成時=有効・会社DB未整備は停止(メンテ)（不採用＝「準備中」3値目）。理由＝データモデル.md `default active` が正・§4.6 で不採用と明記。
- **補足文はユーザー向けのみ・画面ID/仕様メモは全可視サーフェスから除去**（不採用＝dev 向けメモを残す）。理由＝ユーザー要望。コード/HTMLコメントは非可視ゆえ据え置き。

### 過去の確定（正は各設計文書。要約）
- **クリックの標準挙動＝§4.5 ⑪**（行/カードは常にクリック可・主アクション＝既定=編集／単一操作はそのショートカット／ナビ型は遷移／破壊的単一・無効行は割当なし）。**SC-90 メンバー行はクリック割当なし**（除外が破壊的なため・2026-08-17 ユーザー確認で確定）。
- **フロントエンド先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css/shared.js を単一デザインシステム**。**モックは URL 付きモーダル（Parallel＋Intercept）**。**モック⇔設計の矛盾は設計を正**。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）ほか。2プレーン×縦スライス4層。

---

## 7. 次にやること — 優先順に、具体的に

> 最優先＝**(D) UI標準/モック精度**（`doc/画面設計` で作業）。(A) 管理系 impl 整合・(B) 画面群移植は保留。
> **D-a（SC-90 クリック方針）・D-b（SC-12 DataTable化）・D-c（用語点検）は本セッションで完了。補足文のユーザー向け化も完了。残りは D-d。**

### (D-d) mocks→impl 反映（最後・大物・本流）
- **`mocks/shared.css` の差分**（`--dt-ctl-h` 段1同一高さ・`.dt-search__ic`・適用中チップ集約・`.dt-chip--clear` 右寄せ・カード切替・`.dt-pin-float`・`.dt-cardraw`・`.dt-row--link` 等）を **`impl/frontend/src/styles/design-system.css`** へ同期（現状は shared.css の複製）。
- **DataTable を Next.js/TS 版**として `impl/frontend/src/components`（例 `DataTable.tsx`）に実装。**mocks の `shared.js` の `window.DataTable`（末尾 IIFE）が仕様の正**。クリック標準（§4.5⑪）・ピン・カード切替・刷新ツールバー（適用中チップ・並び替え/絞り込みダイアログ・段1同一高さ・list/card 共通並び替え・投稿日のような `hiddenDefault` ソート列）も移植。
- **一覧APIのクエリ契約**（複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得）を backend（`impl/backend` 4層）に追加。§4.5 が要求。
- **補足文のユーザー向け化・用語（会社状態2値/カテゴリー）も impl の対応画面へ反映**（今回 mocks/screens のみ是正）。

### 【任意・軽】補足文/用語のさらなる点検
- 今回 mocks/screens の可視テキストは画面ID/仕様メモを一掃したが、`screens/*.md`（設計書）側にはまだ画面ID参照・仕様メモが多数残る（設計書は dev 向けなので**基本は許容**）。ユーザー向け文言との齟齬が出た画面があれば都度是正。

### 【保留】(A) 管理系 impl 整合 / (B) 画面群移植
- (A) `impl/frontend/src/features/companies|accounts|questgroups` の SC-92/90/所属エディタ整合。(B) クエストC→アイデアD→チャットE→評価F→ゲームG→通知H→ダッシュボードI。いずれも本セッション未着手。

---

## 8. 再開に必要な環境情報

- **mocks の検証（本セッションの主戦場・Docker 不要）**:
  - 直接ロード＝`chromium-browser --headless=new --no-sandbox --disable-gpu --virtual-time-budget=2500 --dump-dom "file:///home/t-umekawa/sc-ideaquest-G2/doc/画面設計/mocks/SC-91_システム管理.html"`。
  - スクショ＝`--screenshot="$HOME/_shot.png"`（**出力先は `$HOME` 配下**。`/tmp` は snap sandbox で見えない）→ Read で目視。ウィンドウ＝`--window-size=1000,1000` 等。
  - 構文＝`node --check doc/画面設計/mocks/shared.js`。
  - **モーダルを開いて撮る**＝SC-*.html を一時コピーし `<body>` 直前に `window.addEventListener('load',()=>setTimeout(()=>{ /* トリガーボタンを click() */ }, 500))` を差し込み screenshot／使用後削除。
  - **可視テキストの画面ID/メモ点検**＝タグ間テキスト抽出 `grep -rInoE '>[^<]*SC-[0-9]{2}[^<]*<' SC-*.html`＋属性 `grep -rInoE '(title|placeholder)="[^"]*SC-[0-9]{2}[^"]*"'`。残るのはコード/HTMLコメントのみが正。
- **impl フル起動（今回未使用）**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog `:1025`/`:8025`／backend `:8000`／frontend `:3000`。
- **frontend 型チェック**＝`cd impl && docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。
- **frontend e2e**＝`docker compose up -d --build frontend` → `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`（前セッション 26 passed・**本セッション未再実行＝未確認**）。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・**本セッション未再実行＝未確認**）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **正となる場所**＝デザインシステム実体＝`doc/画面設計/mocks/shared.css`・`shared.js`（impl `src/styles/design-system.css` はその複製）。UI標準＝`doc/画面設計/デザイン標準.md`（`§4.5` 一覧の操作標準＝DataTable〔①〜⑪。⑪＝クリック標準〕、`§4.6` 用語・ラベル標準）。見た目＝`mocks/SC-xx_*.html`・機能/遷移＝`screens/SC-xx_*.md` の §5・画面間遷移＝`画面遷移図.md`。
- **運用**＝`.gitignore` で `*.pdf`・`.env` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時のみ。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(D-d) mocks→impl 反映**（shared.css→design-system.css 同期・DataTable の TS 版実装・一覧APIのクエリ契約・補足/用語の impl 反映）。D-a/D-b/D-c と補足文ユーザー向け化は本セッションで完了。(A)/(B) は保留。
- ✅ 本セッション＝**mocks/デザイン標準/screens のみ変更（impl 0変更・確認済み）**。6コミット＝ツールバー刷新／SC-12 DataTable化／用語点検／補足文ユーザー向け化（3コミット）。全て push 済み。
- ✅ 状態＝作業ツリー クリーン・origin/main と同期・HEAD `202b568`。migration head control 0010・company 0006。**e2e 26/pytest 164 は前セッション値＝本セッション未再実行（未確認）**。Docker 停止中。
- ✅ DataTable の仕様は §4＋`shared.js` の `window.DataTable`（末尾 IIFE）＋`デザイン標準.md §4.5`（刷新ツールバー・⑪ クリック標準を含む）が正。SC-12 は `storageKey:'sc12-ideas'`・投稿日 `hiddenDefault` で「新着順」。
- ⚠ **mocks↔impl 未同期**＝本セッションの成果（ツールバー刷新・SC-12 DataTable化・用語/補足是正）は **impl 未反映**（D-d）。
- ⚠ **補足文の点検はモーダル/タブ見出し/リンク文言まで**＝可視テキストのみ是正済み（残る画面IDは非可視コメントのみ）。次回モックを触る時は「タグ間テキスト抽出」で再点検（§5・§8）。
- ⚠ **検証は snap chromium の癖に注意**＝スクショは `$HOME` 配下・`--headless=new`・localStorage キーは `ideaquest_dt_` プレフィックス・モーダルは load 後に click() して撮る（§5・§8）。
