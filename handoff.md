# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-17）＝(D) UI標準/モック精度の中の (D-d) mocks→impl 反映を実施中。本セッションは前セッションまでと異なり `impl/frontend` を変更した（`doc/画面設計` の作り込みは完了扱い）。本セッションの主題＝(D-d) を4スライスに分割し ①CSS同期 ②DataTable.tsx（React/TS 版・全機能）④用語/補足の impl 反映 を完了。残りは ③統合（DataTable を実画面に載せ替え・唯一の大物・Docker 検証が必要）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-17（本セッション終了時）**。
- ブランチ: **main**。**origin/main より 4 コミット ahead＝本セッション分は未 push**（`git rev-list --left-right --count origin/main...HEAD` ＝ `0  4`）。**push はユーザー依頼時のみ**の運用のため本セッションは push していない。次回まず push 要否を確認。
- 最新コミット: **`e15f51e`**（(D-d ④) 用語/補足の impl 反映）。
- 本セッションの起点＝**`c5cf660`**（前セッション末の handoff コミット）。
- **本セッションのコミット（新しい順・`git log c5cf660..HEAD`）**:
  - `e15f51e` **(D-d ④) 用語/補足の impl 反映**＝会社状態2値化（準備中→有効/停止）・可視画面ID除去・`.st-provisioning` 撤去。詳細 §3-④。
  - `2896500` **(D-d ②b–②d) DataTable 全機能**＝適用中チップ/絞込ダイアログ/複数キー並び替え/列設定/リサイズ/CSV/localStorage永続/ピン/カード切替/クリック標準。詳細 §3-②。
  - `d0fc2dc` **(D-d ②a) DataTable.tsx 中核**＝型/compute/描画/単一ソート/ページャ/密度。詳細 §3-②。
  - `4fa1807` **(D-d) CSS同期**＝`impl/.../design-system.css` に `mocks/shared.css` の §9y（DataTable標準・195行）を移植。詳細 §3-①。
- コミットは **1変更＝1コミット**、末尾 `Co-Authored-By: Claude Opus 4.8`。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **作業ツリーの未追跡ファイル**＝`impl/frontend/package-lock.json`（ローカル `npm install` の副産物。このリポは lock 非追跡運用＝コミットしない）。`node_modules/` は gitignore 済み。tsc を回すために残置してよい。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。現在はフロント＝「画面モック先行 → 画面群ごとに backend 接続」方針。**mocks は完成域**に達し、いまは **mocks→impl の反映（D-d）**フェーズ。

---

## 3. 今回やったこと — 変更したファイルと理由

**本セッションで変更したのは全て `impl/frontend` 配下（`doc/` は無変更・`impl/backend` も無変更）。** 検証は `impl/frontend` で `npm install`（lock 無しのため `npm ci` 不可）→ `node_modules/.bin/tsc --noEmit`＝各段階でエラー0を実測。

### ① CSS同期（`4fa1807`）
- **背景**＝`impl/.../styles/design-system.css`（1057行）は `mocks/shared.css`（1299行）の**古い部分集合**で、DataTable 用の **`9y. 一覧の操作標準（DataTable）` セクション（約195行）が丸ごと欠落**していた（全差分を突合し確認）。
- **やったこと**＝shared.css の 9y セクション（1097–1291行）を design-system.css の `10. レスポンシブ` 直前へ**忠実に splice**（195行完全一致・ブレース収支0を実測）。`--dt-ctl-h`・`.dt-search__ic`・適用中チップ集約・`.dt-chip--clear`・カード切替・`.dt-pin-float`・`.dt-cardraw`・`.dt-row--link`・列設定/並び替えビルダー/絞込/密度/番号ページャを含む。**純追加のみ＝既存画面ゼロ影響**（当時 DataTable.tsx 未実装で未使用）。
- **見送った差分（意図的）**＝DataTable 無関係の design-system ドリフト（グローバル `[hidden]`・usermenu 開閉アニメ・▶ピクセルカーソルメニュー）は出荷済み header/auth に触れるため本 slice に含めず。`.st-provisioning`（会社状態「準備中」）は当時 impl が現用中だったため残置し、**④で撤去**。

### ② DataTable.tsx（`d0fc2dc` ②a ＋ `2896500` ②b–②d）
- **`impl/frontend/src/components/ui/DataTable.tsx`（新規・約1229行）**＝`mocks/shared.js` の `window.DataTable`（挙動の正・491–1004行）を **Next.js/TS の generic `<T>` client component** へ移植。`index.ts` からエクスポート。
- **意図的な React 化差分（重要）**:
  - 列/カードの `render`/`card`/`cardRaw` は **HTML 文字列でなく `ReactNode` を返す**（`innerHTML` 不使用＝XSS 安全）。→ **操作列（`actions`）は消費側が `render` で `<RowMenu>` 等を渡す**（DataTable は RowMenu に非依存）。
  - パイプライン（検索→絞込→ソート→ピン分離）は**純関数 `computeRows()` に分離**＝将来 backend 委譲へ差し替え可能。ページ分割は呼び出し側。
  - ソート/絞込ダイアログは mock の自作 `dialog()` でなく**既存 `Modal`（`ModalBody`/`ModalFooter`）を再利用**。並び替えビルダーの **FLIP アニメは意図的に省略**。
  - **CSV セルは `csvVal`／`sortVal` から生成**（`render` の ReactNode は文字化できない＝render のみの列は `csvVal` を渡す）。CSV は `filtered`（ピン除外）＝mock と一致。
- **②a 中核**＝型（`DataTableColumn/DataTableProps/SortKey/FilterCond/ColumnFilter/CardLayout` を全 slice 分先出し）・`computeRows()`・テーブル描画・見出しクリック単一ソート（`aria-sort`）・番号ページャ・件数/空表示・密度・検索。
- **②b–②d 全機能**＝適用中チップ（検索・並び替え・絞込を全てチップ化＋右端「すべてクリア」）・件数バッジ・絞込ダイアログ（項目別 text/enum/number/date）・複数キー並び替え（2ペイン）／列設定ポップオーバー（表示/並べ替え/幅リセット/既定に戻す）・列幅リサイズ（ドラッグ・ダブルクリックで解除）・CSV・**localStorage 永続**（接頭辞 `ideaquest_dt_`・order/hidden/widths/density/pins/perPage/view。復元は `ready` ゲートで既定上書きを防止・検索/ソート/絞込/ページはセッション非永続）／ピン（最大件数＋段積み sticky `--dt-row-top` を `useLayoutEffect` で算出）・カード/リスト切替（card/cardLayout/cardRaw）・クリック標準§4.5⑪（`a,button,input,select,label` 上は主アクション無効・ピンは stopPropagation・カードは Enter/Space）。
- **敵対的レビュー**（shared.js と全挙動を突合）で検出2件を修正済み: ①番号ページャの `«`先頭/`»`末尾ボタン欠落→復元 ②検索チップのトリム（入力欄は生値のまま＝内部空白を打てる・チップ判定/表示のみトリム）。**その他はパイプライン/クランプ/ソート/絞込/列/永続/ピン/クリック標準まで shared.js と一致を確認**。

### ③（未着手）— §7 参照。

### ④ 用語/補足の impl 反映（`e15f51e`）
- **根拠**＝mocks/screens で確定済みの D-c 用語点検（会社状態2値）・補足文ユーザー向け化。今回それを impl の**可視サーフェス**へ反映。
- **会社状態を2値（active=有効/suspended=停止）**に統一＝「準備中」を全除去。`CompanyList.tsx`（状態バッジ `st-provisioning 準備中`→`st-suspended 停止`・状態フィルタ `準備中`→`停止`）、`CompanyDetailView.tsx`（active 以外→停止）。
- **会社作成注記をユーザー向けに刷新**＝dev ジャーゴン（プロビジョニング/compose/up/.env/物理分離）を除去。**⚠作成時状態は backend 実態に整合させた**（§5 の矛盾参照）。
- **可視 SC-id を除去**＝`CompanyList`（補足×2）・`AccountSelfSection`（行注記「SC-92」）・`@modal/(.)quests/new/page.tsx`（モーダル見出し「（SC-11）」＋ Parallel/Intercept ジャーゴン注記）。残る SC-id は**非可視のコード注記（`//`・`{/* */}`）のみ**。
- **`design-system.css` から `.st-provisioning` を撤去**（impl 未使用化に伴い・①で残置した用語ドリフトを解消。コメントも「有効/停止＝2値」へ）＝shared.css と一致。
- 実測＝可視 SC-id/準備中/st-provisioning の残存ゼロ・tsc エラー0。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **DataTable.tsx＝実装完了・型健全（tsc 0）だが未統合・ランタイム未検証**。実画面にまだ載っていない（③）。単体テスト基盤は無い（frontend のテストは Playwright e2e のみ）ので、**型チェック＋shared.js との突合レビュー**が現状の検証。目視/ランタイム/e2e は③で Docker 起動時にまとめて。
- **DataTable の使い方（③で必要・要点）**:
  - `import { DataTable } from "@/components/ui"`。`<DataTable<Row> storageKey="…" data={rows} columns={cols} …/>`。
  - `columns`＝`{ key,label,locked?,width?,sortable?,align?:'num',hiddenDefault?,actions?,cellClass?,filter?:{type,options?},render?:(r)=>ReactNode,sortVal?,searchVal?,filterVal?,csvVal? }`。
  - props＝`storageKey,data,columns,rowId?,unit?,perPage?,perPageOptions?,maxPins?,searchFields?,searchPlaceholder?,exportName?,onRowClick?,emptyText?,rowClass?,pins?,defaultView?,card?/cardLayout?/cardRaw?`。
  - **操作列**は `columns` に `{actions:true, render:(r)=><RowMenu items={…}/>}` を1本入れる。
  - **クリック標準**＝`onRowClick` を渡すと行/カードが `.dt-row--link`/`.dt-card--link`。`a,button,input,select,label` 上のクリックは主アクション化しない。
- **CSS**＝design-system.css は §9y 同期済み＋会社状態バッジ2値化済み（shared.css と一致）。
- **impl backend／その他 frontend 画面＝本セッション無変更**。
- **テスト実測**＝**frontend `tsc --noEmit`＝エラー0（本セッション・全プロジェクト）**。**e2e / backend pytest は本セッション未実行**（impl backend 無変更・frontend は tsc のみ。前セッション値 e2e 26 passed・pytest 164 passed は**未再確認**）。**Docker 起動せず**。
- **壊れているもの＝無し**（確認した範囲。DataTable は未統合ゆえ既存画面に影響しない）。
- migration head＝前セッション記載のまま（control **0010**・company **0006**）。impl backend 無変更のため不変。

---

## 5. 詰まっている点 — 失敗したアプローチと理由 / 要判断

- **⚠最重要の申し送り＝会社作成時の状態が「設計⇔backend 実装」で矛盾**:
  - **設計（正）**＝`mocks/SC-91` の provision-note・`screens/SC-91` §5・`データモデル.md`（`companies.status default active`）＝**作成時＝有効（active）**、会社DB未整備の間は「停止」（メンテ）へ切替。
  - **backend 実装**＝`impl/backend/.../admin/company_application.py`・`router.py:71`・`features/companies/api.ts:26`＝会社作成は **`status=suspended`（＝停止）で行を作るのみ**（DBプロビジョニングは手動MVP）。frontend は作成時に status を送らない。→ **新規作成した会社は observably「停止」で現れる**。
  - **本セッションの対応**＝フロントのみのため、注記は **backend 実態（作成直後=停止→準備後に有効）**に合わせた（ユーザー選択）。**設計/backend いずれを正とするかの整合は未決＝次セッションで要判断**（「設計を正」なら backend を active 作成へ／backend を正とするなら設計注記を停止始まりへ更新）。
- **ローカル tsc の回し方**＝`impl/frontend` に **package-lock.json が無い**ため `npm ci` は EUSAGE で失敗。**`npm install`** で node_modules を生成（Node 22/npm 10 ローカル可）→ `node_modules/.bin/tsc --noEmit`。`tsc` は devDependency だが lock 無しだと未導入になるので install 必須。単体 `eslint` は本プロジェクトが `next lint`（旧 .eslintrc）構成のため flat config 不在で起動不可＝未実行。
- **DataTable の React 化で外せない点**＝`render` は ReactNode（HTML文字列でない）。CSV は `csvVal`/`sortVal` から（render から文字を抜けない）。localStorage 復元は `ready` ゲートで「復元前の既定上書き」を防ぐ（この順序を崩すと保存が既定で潰れる）。
- **③統合の設計フォーク（未決・③着手時に判断）**＝既存の実画面（`CompanyList`/`AccountSection`）は **backend 駆動（`listCompanies` 等でサーバーページング・page_info）**。DataTable は **全件クライアント保持**（mock と同じ）。統合方針は2択＝(a) 一覧APIから**全件取得**して DataTable にクライアント処理させる（mock 一致・管理系は件数小で妥当）／(b) サーバーページングを維持し DataTable を表示のみに使う（ただし DataTable の compute/ページャ前提と食い違う）。**mock は全件クライアント保持なので原則 (a)**。backend の一覧クエリ契約（複数ソート/項目別フィルタ/CSV/ピンID）は §4.5 が将来要求するが**別セッション**（今回フロントのみ）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **CSS同期は DataTable の §9y のみ移植**（不採用＝shared.css 全面ミラー）。理由＝handoff の同期対象は §9y の DataTable クラス群で、usermenu/pixel/`[hidden]` は無関係ドリフト＝出荷済みコンポーネントに触れ回帰リスク。
- **DataTable は忠実クライアント側ポート＋`compute` 分離**（不採用＝最初からサーバー駆動の controlled component）。理由＝backend が今回スコープ外＝controlled では動かせない・handoff が `window.DataTable` を仕様の正と明記・mock も対象画面を全件クライアント保持・DoD＝モック一致。`compute` を純関数化して将来の backend 委譲を安価にした。
- **ダイアログは既存 Modal 再利用・操作列は消費側が RowMenu を渡す**（不採用＝mock の自作 dialog を移植）。理由＝impl 流儀に寄せ二重実装を避ける。
- **会社作成注記は backend 実態（作成=停止）に整合**（不採用＝設計の「作成=有効」）。理由＝ユーザー選択＋今回フロントのみで observable 挙動と一致させる。設計/backend の恒久整合は §5 の申し送り。
- **③統合は本セッション未着手で区切り**（Docker 検証が必要な大物のため次セッションへ）。

### 過去の確定（正は各設計文書。要約）
- **DataTable ツールバー（刷新）**＝2段固定・クリアは「すべてクリア」1つ・適用中は全条件チップ化・段1同一高さ・list/card 共通「↕ 並び替え」（`デザイン標準.md §4.5`）。
- **クリックの標準挙動＝§4.5 ⑪**（行/カードは常にクリック可・破壊的単一/無効行は割当なし）。**SC-90 メンバー行はクリック割当なし**。
- **フロントエンド先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css/shared.js を単一デザインシステム**（impl `design-system.css`/コンポーネントはその移植）。**モック⇔設計の矛盾は設計を正**。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）ほか。2プレーン×縦スライス4層。

---

## 7. 次にやること — 優先順に、具体的に

> 最優先＝**(D-d ③) DataTable を実画面に統合**（唯一の残り・大物）。①②④は本セッションで完了。

### (D-d ③) DataTable を impl 実画面へ載せ替え（大物・Docker 検証あり）
1. **まず push 要否をユーザーに確認**（本セッションの4コミットは未 push）。
2. **1画面から**着手を推奨＝`impl/frontend/src/features/companies/components/CompanyList.tsx`（現状は素の `<table>`＋別 toolbar＋`Pager`）。`<DataTable>` に載せ替え:
   - `columns`＝会社名（`render` で `<QuestIcon>`＋名称）/会社コード/DB識別子/状態（`render` で `st-active|st-suspended` バッジ・`filter:enum [['active','有効'],['suspended','停止']]`）/アカウント/グループ/作成日/操作列（`actions:true`・`render:(r)=><Link>管理する →</Link>` 相当）。`onRowClick`＝会社詳細へ遷移（§4.5⑪）。
   - **§5 の設計フォークを先に決める**＝(a) 全件取得してクライアント処理（mock 一致・推奨）か (b) サーバーページング維持か。(a) なら `listCompanies` を per_page 大 or 全件で取得し `data` に流す。
3. **検証**＝ここで初めて Docker 起動（`cd impl && docker compose up -d --build`）→ frontend で目視（ツールバー・ソート・絞込・ページャ・列設定・ピン・カード）＋ **e2e 再実行**（既存の会社一覧 e2e が DataTable 化で壊れないか）＋ **tsc**。
4. 他の一覧画面（`AccountSection`/`AccountSelfSection`/`QuestGroupSection`/`QuestGroupAdminView`）へ横展開。

### 【申し送り・要判断】設計⇔backend の会社作成状態（§5）
- 「作成時=有効（設計）」か「作成時=停止（backend）」かを確定し、負けた側を修正（backend か設計注記か）。

### 【別セッション】一覧APIのクエリ契約（backend・§4.5）
- 複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得を `impl/backend`（4層）に追加。§4.5 が要求。③で (a) を採ればしばらくクライアント処理で足りる。

### 【保留】(A) 管理系 impl 整合 / (B) 画面群移植
- いずれも本セッション未着手。

---

## 8. 再開に必要な環境情報

- **frontend の型チェック（本セッションの主検証・Docker 不要）**＝`cd impl/frontend && npm install`（**lock 無しのため `npm ci` は不可**）→ `node_modules/.bin/tsc --noEmit`。`node_modules/`・`package-lock.json` は未追跡（コミットしない）。
- **impl フル起動（③で必要）**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog `:1025`/`:8025`／backend `:8000`／frontend `:3000`。
- **frontend 型チェック（Docker 版）**＝`cd impl && docker compose run --rm --no-deps -T -v "$PWD/frontend/src:/app/src" frontend node_modules/.bin/tsc --noEmit`。
- **frontend e2e**＝`docker compose up -d --build frontend` → `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test --workers=1`（前セッション 26 passed・**本セッション未再実行**）。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・**本セッション未再実行**）。
- **mocks の検証（chromium ヘッドレス・Docker 不要）**＝`chromium-browser --headless=new --no-sandbox --disable-gpu --dump-dom "file://…/mocks/SC-91_システム管理.html"`。スクショ出力先は `$HOME` 配下（`/tmp` は snap sandbox 不可視）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **正となる場所**＝デザインシステム＝`doc/画面設計/mocks/shared.css`・`shared.js`（impl `src/styles/design-system.css`・`src/components/ui/*` はその移植）。DataTable の挙動の正＝`shared.js` の `window.DataTable`（末尾 IIFE）。UI標準＝`doc/画面設計/デザイン標準.md`（`§4.5` 一覧の操作標準〔⑪=クリック標準〕・`§4.6` 用語）。見た目＝`mocks/SC-xx_*.html`・機能/遷移＝`screens/SC-xx_*.md`・画面間遷移＝`画面遷移図.md`。
- **運用**＝`.gitignore` で `*.pdf`・`.env`・`node_modules` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時のみ。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 再開点＝§7＝**(D-d ③) DataTable を実画面へ統合**（まず push 確認→CompanyList から→§5の設計フォーク決定→Docker で目視/e2e）。①CSS同期・②DataTable.tsx・④用語/補足 impl 反映は本セッション完了。
- ✅ 本セッション＝**`impl/frontend` を変更**（前セッションまでの mocks/screens 中心から局面転換）。4コミット・**未 push**（origin/main より 4 ahead）。
- ✅ 状態＝HEAD `e15f51e`・作業ツリーは追跡分クリーン（未追跡＝`package-lock.json` のみ・残置可）。**frontend tsc=0（実測）**。e2e/pytest は前セッション値＝**本セッション未再実行**。Docker 停止中。
- ⚠ **DataTable.tsx は完成・型健全だが未統合＝ランタイム/目視/e2e 未検証**（③で Docker 起動時に）。仕様の正は `shared.js` の `window.DataTable`＋`デザイン標準.md §4.5`。React 化差分（render=ReactNode／compute 分離／Modal・RowMenu 再利用／CSV は csvVal・sortVal／localStorage `ready` ゲート）は §3-②・§5。
- ⚠ **会社作成状態が設計⇔backend で矛盾**（§5）。本セッションは注記を backend 実態に合わせただけ＝恒久整合は次セッションで要判断。
- ⚠ **ローカル tsc は `npm install`（`npm ci` 不可）**。package-lock は非追跡。
