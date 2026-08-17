# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-17）＝(D) UI標準/モック精度の中の (D-d) mocks→impl 反映。本セッションで (D-d ③) DataTable を管理系実画面へ載せ替え＝5画面すべて DataTable 化を完了し、§5 の「会社作成状態」設計⇔backend 矛盾も解決した。①CSS同期・②DataTable.tsx・④用語/補足 impl 反映は前セッションで完了済み。したがって (D-d) の主要作業は一通り完了。次の主眼は「一覧APIのクエリ契約（backend §4.5）」または他ドメインの画面群移植（別セッション）。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-17（本セッション終了時）**。
- ブランチ: **main**。**origin/main と同期済み（0/0）＝本セッション分は push 済み**（`git rev-list --left-right --count origin/main...HEAD` ＝ `0 0`）。次回まず push 要否の確認は不要。
- 最新コミット: **`8a9ef5c`**（(D-d ③) QuestGroupAdminView(SC-90) を DataTable へ横展開＝§7 横展開 完了）。
- 本セッションの起点＝**`d0600bb`**（前セッション末の handoff コミット）。
- **本セッションのコミット（新しい順・`git log d0600bb..HEAD`・すべて push 済み）**:
  - `8a9ef5c` **(D-d ③) QuestGroupAdminView(SC-90)** を DataTable 化＝メンバー表。§4.5⑪ メンバー行はクリック割当なし（onRowClick 無し）。詳細 §3。
  - `5f39253` **(D-d ③) QuestGroupSection(SC-92)** を DataTable 化＋**DataTable セクション全幅化**（`.admin-create--table`）。詳細 §3。
  - `228af68` **(D-d ③) AccountSelfSection(SC-93)** を DataTable 化＋**旧一覧依存（`useAccountList`/`AccountsToolbar`）を削除**。sys_admin 行は 🔒（SoD）。詳細 §3。
  - `b2668fe` **(D-d ③) AccountSection(SC-92)** を DataTable 化＋共有フック `useAllAccounts` 新設。詳細 §3。
  - `a700e4b` **(D-d ③) CompanyList(SC-91)** を DataTable 化（横展開の1本目）。詳細 §3。
  - `61ac62c` **(D-d 申し送り) 会社作成状態の設計⇔backend 矛盾を解決**＝backend（作成=停止 `suspended`）を正とし、設計文書を訂正。詳細 §5。
- コミットは **1変更＝1コミット**、末尾 `Co-Authored-By: Claude Opus 4.8`。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **作業ツリーの未追跡ファイル**＝`impl/frontend/package-lock.json`・`impl/frontend/tsconfig.tsbuildinfo`（ローカル `npm install`／`tsc` の副産物。このリポは lock・tsbuildinfo 非追跡運用＝コミットしない）。`node_modules/` は gitignore 済み。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。現在はフロント＝「画面モック先行 → 画面群ごとに backend 接続」方針。**mocks は完成域**に達し、いまは **mocks→impl の反映（D-d）**フェーズで、うち **③ DataTable 統合＝完了**。

---

## 3. 今回やったこと — 変更したファイルと理由

**本セッションで変更したのは主に `impl/frontend` 配下＋設計文書（§5）。`impl/backend` は docstring のみ（挙動不変）。** 検証は各コミットで `impl/frontend` の `tsc --noEmit`＝0 を実測＋**Docker 起動で管理系 e2e 16件 全 green**＋目視スクショでモック一致を確認（§4）。

### ①（前セッション完了）CSS同期 / ②（前セッション完了）DataTable.tsx / ④（前セッション完了）用語 impl 反映
- 本セッションでは無変更（`impl/.../components/ui/DataTable.tsx`・`design-system.css §9y` は前セッションの成果を利用）。

### ③ DataTable を管理系5画面へ載せ替え（本セッションの主作業・§7 横展開）
すべて **client モード**＝一覧の操作標準（検索/絞込/複数ソート/列設定/CSV/ピン/カード切替・§4.5）を DataTable に委譲し、**データは全件クライアント保持**（管理系＝小規模）。仕様の正＝`doc/画面設計/mocks/*.html` の `window.DataTable.init` 設定（DoD＝モック一致）。

- **CompanyList(SC-91)**（`a700e4b`）＝`src/features/companies/components/CompanyList.tsx`。素の table＋toolbar＋Pager を `<DataTable>` に置換。全件取得＝`listCompanies` を `per_page=100` ループ。列＝会社名(QuestIcon)/コード/DB識別子/状態(enum 有効・停止)/アカウント(number)/グループ・作成日(—・`CompanyListItem` 未提供)/操作列(管理する →)。`onRowClick`＝会社詳細へ。
- **AccountSection(SC-92)**（`b2668fe`）＝`src/features/accounts/components/AccountSection.tsx`。**共有フック `src/features/accounts/useAllAccounts.ts` を新設**（`per_page=100` ループ・SC-92/93 共用）。列＝氏名(Avatar)/ログインID/メール/システムロール(enum)/所属グループ(—・list未提供)/状態(enum 有効・無効)/操作(RowMenu ⋯)。**操作可否は既存 impl を保持**（active＝所属・編集/PW再設定/無効化、disabled＝再有効化）＝UI枠の移植で backend 操作可否は変えない。`onRowClick`＝編集(active のみ・無効行は §4.5⑪ 割当なし)。
- **AccountSelfSection(SC-93)**（`228af68`）＝`src/features/accounts/components/AccountSelfSection.tsx`。`useAllAccounts(listOwnAccounts)` を再利用。**system_admin 行は操作不可＝🔒（`row-locked`）・クリック割当なし（`is-rowlocked`・SoD＝SC-92 で管理）**。両アカウント画面が DataTable 化されたので**未使用の `useAccountList.ts`／`AccountsToolbar.tsx` を削除**（DRY）。`companies.css` に `.is-rowlocked` を追加（sys_admin 行の指カーソル/ホバー抑止）。状態バッジ class は DS を正として `st-active`/`st-suspended`（SC-93 mock の `st-disabled` は DS 未定義のドリフト＝不採用）。
- **QuestGroupSection(SC-92)**（`5f39253`）＝`src/features/questgroups/components/QuestGroupSection.tsx`。`listQuestGroups` は全件返す。列＝グループ名/コード/メンバー数(N 名)/操作(RowMenu リネーム・削除)。`onRowClick`＝リネーム(§4.5⑪ 主アクション)。**レイアウト修正**＝`.admin-create` の `max-width:520px`（作成フォーム向け）が DataTable ツールバーを窮屈にしたため `.admin-create--table`(max-width:none) を `companies.css` に新設し **QuestGroup/Account セクションへ付与**＝全幅描画。
- **QuestGroupAdminView(SC-90)**（`8a9ef5c`）＝`src/features/qgadmin/components/QuestGroupAdminView.tsx`。メンバー表を `<DataTable>` に置換。列＝氏名(Avatar)/グループ内ロール(enum 管理者・メンバー)/操作(RowMenu 除外)。**`onRowClick` を渡さない**（§4.5⑪ SC-90 メンバー行はクリック割当なし）。backend `MemberListItem` は最小射影（氏名・ロールのみ／ログインID・参加日は非提供）＝mock の loginId/参加日でなく実データの role 列を表示。ディレクトリ・ピッカー（メンバー追加モーダル）は簡易テーブルのまま（mock 同様）。

### ⑤ 設計⇔backend 矛盾の解決（`61ac62c`・§5 の詳細参照）
- **会社作成時の状態**を **backend の実装（作成＝`suspended`=停止）を正**とし、設計文書側（SC-91 §4.2/§5/§6・データモデル §4.1 注記・デザイン標準 L236・API設計 B.1・テスト B-TC-111）を「作成時=停止→プロビジョニング完了後に運営が有効化」へ訂正。あわせて④で不採用の「準備中」語を「停止」へ揃えた。**この矛盾は解決済み**（次セッションでの再判断は不要）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **管理系5画面すべて DataTable 化・型健全（tsc 0）・ランタイム検証済み**（Docker 起動で目視＋e2e）。
- **DataTable client モードの使い方（横展開の要点・今後の別画面でも同様）**:
  - `import { DataTable } from "@/components/ui"`。`<DataTable<Row> storageKey="…" data={rows} columns={cols} …/>`。
  - 全件取得＝一覧APIを `per_page=100` でループ（会社は `listCompanies`、アカウントは共有フック `useAllAccounts`、グループ/メンバーは単一 EP が全件返す）。
  - **操作列**＝`columns` に `{ actions:true, render:(r)=><RowMenu items={…}/> }`。破壊的/条件付きアクションは RowMenu の items で出し分け。
  - **クリック標準§4.5⑪**＝主アクションがあれば `onRowClick` を渡す。無効行・SoD ロック行・SC-90 メンバー行は**割当なし**（`onRowClick` を渡さない or 内部で guard、`rowClass` で `is-suspended`/`is-rowlocked`）。
  - DataTable 内部の localStorage 復元エフェクトは依存 `[storageKey]` のみ＝**columns を毎レンダー生成しても状態は壊れない**（インライン定義で可）。
- **CSS**＝`design-system.css` は §9y 同期済み。`companies.css` に本セッションで `.is-rowlocked`（sys_admin 行クリック抑止）と `.admin-create--table`（DataTable セクション全幅）を追加。
- **テスト実測（本セッション・Docker 起動で実行）**＝**frontend `tsc --noEmit`＝エラー0**。**管理系 e2e 16件すべて passed**（`sc-90/91/92/92b/92b2/92c/93`）。**backend pytest は本セッション未実行**（backend は docstring のみ変更＝挙動不変。前セッション値 164 passed は未再確認）。
- **e2e の変更点（DataTable 化に伴い更新）**＝検索は DataTable のライブ検索（`getByRole("searchbox")`・「検索」ボタンなし）／件数は `list-count`「N 件」（旧「（N 件）」から変更）／絞込クリアは「すべてクリア」／行操作は RowMenu（⋯＝aria「操作」→menuitem）。発行/編集後の reload 再マウント競合は `expect(async()=>…).toPass()` で吸収。**RowMenu（`position:fixed`）の再配置ジッタ**でクリックが揺れる場合は「行を可視化→menuitem 可視アサート→`click({force:true})`」で安定（sc-92c で実証）。
- **壊れているもの＝無し**（確認範囲）。
- migration head＝**control 0010・company 0006**（前セッションから不変。backend 無変更）。
- **Docker は起動したまま**（本セッション末）。DB には e2e 由来の残骸（多数の `E2E-*` 会社・`ideaquest_e2e_*` 会社DB・発行アカウント）が蓄積している＝テスト用途で無害だが、必要なら `cd impl && docker compose down -v` でボリューム初期化可。

---

## 5. 詰まっている点 — 失敗したアプローチと理由 / 要判断

- **§5 会社作成状態の矛盾＝本セッションで解決済み（再判断不要）**。決定＝**backend を正（作成時=`suspended`=停止）**。理由＝MVP はDBプロビジョニングが手動で作成時点の会社DBが常に未整備＝active 始まりは運用上破綻（未整備DBへのログインが 503 で綺麗に弾けない）、かつ backend/テスト/frontend が既に suspended 側で「負ける側が最小＝設計文書の記述のみ」。データモデルのカラム既定 `active` は残置し、会社作成 API が明示的に `suspended` を渡す旨を注記（`61ac62c`）。
- **③統合のデータ供給方式＝(a) 全件クライアント処理を採用（決定済み）**。調査結論＝管理系（会社・アカウント・グループ・メンバー）は小規模で (a) が妥当。**アイデア一覧(SC-12)・クエスト一覧(SC-10)は (a) 不適**＝PGroonga 全文検索がサーバー専用・カーソルページング・件数無制限（`doc/API設計/J_全文検索.md`・`D.1`・`C.1`）。→ **これらは DataTable 統合の対象外で、既存のサーバー駆動コンポーネントのまま据え置き**。
- **DataTable のサーバー駆動モード＝将来拡張（未実装・gated）**。`computeRows()` を純関数境界として、`data:T[]` の代わりに `query(state)=>{rows,total}` を委譲する形へ差し替え可能に設計してある（列順/表示/密度/幅/ピンの表示状態は localStorage のまま）。**今は作らない**＝(1) 委譲先の backend §4.5 契約（複数ソート/項目別フィルタ/CSVエクスポートEP/ピンID）が未実装、(2) アイデア/クエストは対象外、(3) YAGNI。実装は「backend §4.5 セッション」とセットで別途。
- **ローカル tsc の回し方**＝`impl/frontend` に **package-lock.json が無い**ため `npm ci` は失敗。**`npm install`** で node_modules 生成 → `node_modules/.bin/tsc --noEmit`。単体 eslint は flat config 不在で未実行。
- **e2e の実行にはコンテナ再ビルドが必要**＝`impl/frontend` は src・e2e を**イメージに焼き込む（ボリュームマウント無し）**。src を変えたら `docker compose up -d --build frontend`。**再ビルドすると chromium が消える**ので毎回 `playwright install-deps chromium` ＋ `install chromium` が要る。**e2e spec だけの変更**なら再ビルド不要＝`docker compose cp frontend/e2e/xxx.spec.ts frontend:/app/e2e/xxx.spec.ts` でコピーして実行。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **会社作成状態は backend（作成=停止）を正**（不採用＝設計の「作成=有効」）。理由＝§5。handoff 一般原則「矛盾は設計を正」に逆行するが、運用実態・整合コスト・observable 挙動で backend が正当（ユーザー承認済み）。
- **③は (a) 全件クライアント処理**（不採用＝(b) サーバーページング維持／サーバーモードの今実装）。理由＝管理系は小規模で mock 一致、サーバーモードは委譲先未実装で YAGNI（§5）。**アイデア/クエストは対象外**と明確化。
- **操作可否セマンティクスは既存 impl を保持**（不採用＝mock のメニューをそのまま移植して disabled 行にも編集/PW を出す）。理由＝DataTable 化は UI 枠の移植であり backend 操作可否を変えるのはスコープ外。
- **状態バッジ class は DS（`st-active`/`st-suspended`）を正**（不採用＝SC-93 mock の `st-disabled`）。理由＝`st-disabled` は shared.css/design-system.css に未定義のドリフト。
- **`.admin-create--table` で DataTable セクションを全幅化**（不採用＝`.admin-create` の 520px を全画面で撤廃）。理由＝520px は作成フォーム向けで維持したい。
- **e2e の RowMenu 操作は force クリック＋可視化待機で安定化**（不採用＝待機だけ）。理由＝RowMenu の `position:fixed` 再配置がクリック時スクロールで stability 再判定を揺らすため。

### 過去の確定（正は各設計文書。要約）
- **DataTable の挙動の正＝`mocks/shared.js` の `window.DataTable`**＋`デザイン標準.md §4.5`（⑪＝クリック標準）。React 化差分＝`render` は ReactNode（HTML文字列でない）／`compute` 分離／Modal・RowMenu 再利用／CSV は `csvVal`・`sortVal`／localStorage は `ready` ゲート。
- **フロントエンド先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css/shared.js を単一デザインシステム**（impl `design-system.css`/コンポーネントはその移植）。**モック⇔設計の矛盾は設計を正**（ただし §5 は設計⇔backend の別軸で backend を正とした）。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）。2プレーン×縦スライス4層。管理ロール3階層（system_admin / company_account_admin / QG管理者＝SoD）。

---

## 7. 次にやること — 優先順に、具体的に

> (D-d) の主要作業（①〜⑤＋③横展開）は完了。以降は別軸の作業。

### 【最有力・別セッション】(A) 一覧APIのクエリ契約（backend・§4.5）＋ DataTable サーバーモード
- backend（4層）に **複数ソートキー・項目別フィルタ・CSVエクスポートEP・ピンID取得** を追加（`doc/API設計/§4.5` が将来要求）。test-first。
- そのうえで DataTable に**サーバー駆動モード**を実装（`computeRows()` 境界に `query(state)=>{rows,total}` 委譲・表示状態は localStorage 維持）。これでアイデア一覧(SC-12)・クエスト一覧(SC-10)にも一覧の操作標準を適用できる。**backend 契約なしに先行実装しない**（§5）。

### 【別軸】(B) 他ドメインの画面群移植（mocks→impl）
- ダッシュボード(SC-01)・クエスト(SC-10/11/12)・アイデア(SC-13〜)・チャット/魔法(SC-24)・評価・ゲーミフィケーション(SC-30/31/40)・ランキング等。フロントエンド実装フロー規約＝「画面モック先行→画面群ごとに backend 接続」。

### 【任意】(C) handoff の DB 残骸クリーンアップ
- e2e 蓄積の `E2E-*` 会社・`ideaquest_e2e_*` DB が気になるなら `cd impl && docker compose down -v` で初期化（seed から作り直し）。

### 【確認】backend pytest の再確認
- 本セッション backend 挙動は不変だが、pytest（前回 164 passed）は未再実行。気になれば §8 の手順で回す。

---

## 8. 再開に必要な環境情報

- **frontend の型チェック（Docker 不要）**＝`cd impl/frontend && npm install`（`npm ci` は不可）→ `node_modules/.bin/tsc --noEmit`。`node_modules/`・`package-lock.json`・`tsconfig.tsbuildinfo` は未追跡（コミットしない）。
- **impl フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog `:1025`/`:8025`／backend `:8000`／frontend `:3000`。backend ヘルスは `/healthz`（`/health` は 404）。
- **frontend e2e（Docker）**＝`docker compose up -d --build frontend` → `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `docker compose exec -T frontend npx playwright install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test <spec…> --workers=1`。**再ビルドで chromium は消える**ので install を毎回。**spec だけ変更**なら `docker compose cp frontend/e2e/xxx.spec.ts frontend:/app/e2e/xxx.spec.ts` で差し替え可（再ビルド不要）。本セッションの管理系 spec＝`sc-90/91/92/92b/92b2/92c/93`（計16件）。
- **目視スクショ（Docker・ヘッドレス）**＝コンテナ内に一時 spec を書いて `page.screenshot`→`docker compose cp frontend:/app/test-results/xxx.png <host>`。frontend はマウント無しなので screenshot は `/app/test-results/` 経由で取り出す。
- **backend テスト**＝`cd impl && docker compose up -d db redis && docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（前セッション 164 passed・本セッション未再実行）。
- **DB 直接確認**＝`docker compose exec -T db psql -U ideaquest -d ideaquest_control -c "…"`（管理DB。POSTGRES_USER=`ideaquest`・会社DBは `ideaquest_company_acme` 等）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **正となる場所**＝デザインシステム＝`doc/画面設計/mocks/shared.css`・`shared.js`（impl `src/styles/design-system.css`・`src/components/ui/*` はその移植）。DataTable の挙動の正＝`shared.js` の `window.DataTable`。UI標準＝`doc/画面設計/デザイン標準.md`（`§4.5` 一覧の操作標準〔⑪=クリック標準〕・`§4.6` 用語）。見た目＝`mocks/SC-xx_*.html`・機能/遷移＝`screens/SC-xx_*.md`・画面間遷移＝`画面遷移図.md`。
- **運用**＝`.gitignore` で `*.pdf`・`.env`・`node_modules` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時のみ。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ (D-d ③) DataTable 統合＝**管理系5画面すべて完了**（CompanyList/AccountSection/AccountSelfSection/QuestGroupSection/QuestGroupAdminView）。①②④は前セッション、⑤（§5 矛盾解決）は本セッション完了。
- ✅ 本セッション＝**6コミット・すべて push 済み**（origin/main = `8a9ef5c`・0/0）。作業ツリーは追跡分クリーン（未追跡＝`package-lock.json`・`tsconfig.tsbuildinfo` のみ・残置可）。
- ✅ 検証＝**frontend tsc=0／管理系 e2e 16件 全 passed（Docker 実測）**。backend pytest は未再実行（挙動不変）。**Docker は起動したまま**。
- ✅ 次の主眼＝§7＝**(A) backend §4.5 クエリ契約＋DataTable サーバーモード**（アイデア/クエスト一覧向け・別セッション）または **(B) 他ドメイン画面群移植**。
- ⚠ アイデア一覧(SC-12)・クエスト一覧(SC-10)は **DataTable 統合の対象外**＝サーバー駆動が必須（全文検索/カーソル/件数大）。サーバーモードは backend §4.5 契約後（§5）。
- ⚠ e2e は再ビルドで chromium が消える／RowMenu クリックは可視化＋force で安定化（§4・§5・§8）。
- ⚠ §5 会社作成状態＝**解決済み（backend=停止 が正）**。再判断不要。
