# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`（唯一の要件定義書）・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-17）＝(D-d) mocks→impl 反映は前セッションで一段落し、本セッションで (A) 一覧APIのクエリ契約（backend §4.5）に着手・前進した。具体的には (1) DataTable が要求するクエリ契約を `API設計/README.md §1.8.1` に「設計として」確定し、(2) それを test-first で backend の会社一覧 EP に「実証台」として全4項目（複数ソート/項目別フィルタ/CSV/ピン）実装した。次の主眼は「DataTable フロントのサーバー駆動モード実装＝この会社EPへ接続」または「他一覧EPへの契約横展開」。本命の SC-10/12（クエスト/アイデア一覧）は別ドメイン新規構築＋PGroonga が前提で未着手。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-17（本セッション終了時）**。
- ブランチ: **main**。**origin/main と同期済み（0/0）＝本セッション分は push 済み**。次回まず push 要否の確認は不要。
- 最新コミット: **`8601ee6`**（(A) 会社一覧に固定行（ピン）契約 §1.8.1④ を実装＝DataTable 契約 完了）。
- 本セッションの起点＝**`fcd6e89`**（前セッション末の handoff コミット）。
- **本セッションのコミット（新しい順・`git log fcd6e89..HEAD`・すべて push 済み）**:
  - `8601ee6` **(A) ④ピン `?pin_ids=`**＝会社一覧に固定行のページ跨ぎ解決を実装。§3。
  - `304d51e` **(A) ③CSV `?format=csv`**＝同条件全件・UTF-8 BOM・監査対象。§3。
  - `05650fd` **(A) ②項目別フィルタ**＝enum 多値(`status=a,b`)・number 範囲(`account_count_min/max`)。§3。
  - `327feeb` **(A) ①複数ソート `?sort=a,-b`**＝ホワイトリスト検証・未知キー422・SQL ソート。§3。
  - `b6e8be0` **chore: gitignore**＝`package-lock.json`・`*.tsbuildinfo`（ローカル型チェックの副産物）を追跡外に。§5。
  - `dae6c25` **(A) §4.5 DataTable クエリ契約を設計に規定**＝`API設計/README.md §1.8.1` 新設＋B/C/D 各一覧EP行＋デザイン標準 §4.5 相互リンク。§3。
- コミットは **1変更＝1コミット**、末尾 `Co-Authored-By: Claude Opus 4.8`。
- remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **作業ツリー＝クリーン**（未追跡ファイル無し。`package-lock.json`・`tsconfig.tsbuildinfo` は `b6e8be0` で `.gitignore` 済み＝以後 untracked に出ない。`node_modules/` も gitignore 済み）。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・**管理DB1＋会社DB N** の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは **API設計 A〜L・画面設計 SC-00〜93・データモデル 全確定**。フロントは「画面モック先行 → 画面群ごとに backend 接続」方針で mocks は完成域。現在は **(A) 一覧の操作標準（DataTable）を実データへ載せるための backend クエリ契約** を進めている段階。

---

## 3. 今回やったこと — 変更したファイルと理由

**本セッションのテーマ＝(A) 一覧APIのクエリ契約（§4.5 → §1.8.1）。設計を確定してから backend を test-first で実装（会社一覧を実証台に）。frontend は無変更。** 検証は Docker で backend pytest（最終 **174 passed**）。

### ⓪ 設計契約の確定（`dae6c25`）
- **`API設計/README.md §1.8.1`「DataTable クエリ契約」を新設**（正本）。DataTable(`impl/.../components/ui/DataTable.tsx` の `computeRows` パイプライン)を無改造でサーバー委譲できる形を規定：
  - **①複数ソート** `?sort=-created_at,name`（カンマ区切り・左優先・`-`降順・EPごとホワイトリスト・未知キー422・カーソルはソートタプル内包）
  - **②項目別フィルタ**（横断 `?q=` と AND）＝ text `?<f>_contains=`／enum `?<f>=a,b`（多値）／number `?<f>_min=`/`_max=`／date `?<f>_from=`/`_to=`。フィールドもホワイトリスト。
  - **③CSV** ＝同一EPの `?format=csv`＋`?columns=`（表示列・列順）・UTF-8 BOM・管理系は監査対象。
  - **④ピン** ＝`?pin_ids=`（絞込/ページで落ちても必ず解決・保持は当面クライアント localStorage・上限 maxPins=5）。
  - **⑤ページ方式** ＝番号ページャ=offset（`page`/`per_page`＋`total`）／もっと見る=cursor。表示状態（列順/幅/密度/ビュー）はサーバーに送らない。
- **B/C/D の該当一覧EP行**にホワイトリスト（ソート可能キー・フィルタ可能フィールド・CSV/pin 可否・ページ方式）を明記。会社=offset、SC-10 クエスト・SC-12 アイデア=cursor。
- **デザイン標準 §4.5** から §1.8.1 への相互リンクを追加（ドキュメント作成規約準拠）。

### ① 会社一覧 EP に契約を実装（実証台・`327feeb`/`05650fd`/`304d51e`/`8601ee6`）
- 対象＝`impl/backend/app/control_plane/admin/`（`company_application.py`＝業務／`router.py`＝shell／`schemas.py`）。**すべて test-first（各コミットに red 証跡・§5.1）**。
- **①複数ソート**（`327feeb`）: `_SORT_COLUMNS` ホワイトリスト＋`_parse_sort`。`account_count` をソート可能にするため集計を **subquery 化して outerjoin**（旧 Python 側 dict 集計 `_account_counts` は撤去＝DRY）。未指定は従来の `created_at,id` 決定順。未知キーは `422 validation_error(field="sort")`。
- **②項目別フィルタ**（`05650fd`）: `_parse_enum`（多値・ホワイトリスト）。`status` 多値 → `IN`／`account_count_min/max` → 集計への WHERE。**range は集計依存なので total も同じ join+conds で数える**。router の旧 `status` pattern は撤去し検証を application に一本化。未知 enum 値は `422(field="status")`。
- **③CSV**（`304d51e`）: 一覧/CSV 共通のクエリビルダ `_company_query` に抽出。`export_companies_csv`＝同条件の**全件**（ページング無視）を UTF-8 BOM で。`?columns=` はホワイトリスト（未知は `422(field="columns")`）。**`system_audit_logs` に `company.export` を記録**（監査・`current_audit_context()` から actor/ip 自動）。router は `format=csv` を `Response(text/csv; charset=utf-8 + Content-Disposition: attachment)` で返す。
- **④ピン**（`8601ee6`）: 集計式を `_account_count_expr` に DRY 抽出。`_parse_pin_ids`（上限5切り詰め・不正形式 `422(field="pin_ids")`）・`_fetch_pinned`（pin 順保持・絞込非依存で解決）。`_company_query(exclude_ids=)` で固定行を非固定母集合から除外。`CompanyListResponse.pinned: list[CompanyListItem]=[]` を追加。
- **追加 TC**（`doc/テスト/B_会社・アカウント.md §3`・`tests/admin/test_admin_companies.py`）＝**B-TC-126〜135**（複数ソート/ホワイトリスト/enum多値/enum検証/number範囲/CSV/CSV監査/CSV列検証/ピン解決/pin形式）。

### gitignore 整理（`b6e8be0`）
- `package-lock.json`・`*.tsbuildinfo` を `.gitignore` へ（ローカル型チェックの副産物・**Docker ビルドは参照しない**＝再現性は Docker に寄せる方針）。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **会社一覧 EP が §1.8.1 の DataTable 契約4項目すべてを満たす**（複数ソート/項目別フィルタ/CSV/ピン）＝**DataTable サーバーモードの委譲先が1つ完成**。他の一覧EP（アカウント等）は未対応（横展開の対象）。
- **テスト実測（本セッション・Docker）**＝**backend `pytest tests/` 全体 174 passed**（開始時 164＋新規10＝B-TC-126〜135・回帰ゼロ）。各増分で red→green を目視（証跡はコミットメッセージ）。
- **frontend**＝本セッション無変更。`tsc --noEmit`＝0（セッション開始時に実測・以後 frontend 変更なし）。**e2e は本セッション未実行**（frontend 未変更のため。前回=管理系16件 passed）。
- **契約実装の要点（横展開の型・今後 別一覧EPでも同様）**:
  - 業務層に **共通クエリビルダ**（検索/フィルタ/複数ソートを1関数に集約・一覧とCSVで共有）＋ **集計は subquery+outerjoin**（ソート/範囲フィルタ可能に）。
  - ソートキー・フィルタフィールド・CSV列は **すべてEPごとホワイトリスト**＝未知は `422 validation_error(field=…)`（列挙/注入耐性・§2.2）。エラー封筒は `AppError(422,"validation_error",extra={"errors":[{"field":…}]})`。
  - CSV は同一EPの `?format=csv`＝router で `Response` 分岐（`response_model` は JSON 経路のみ有効・Response 返却で bypass）。管理系は **監査記録必須**（`audit.record(action, detail, session=session)` → `session.commit()`。actor/ip は `current_audit_context()` が供給）。
  - ピンは `pinned` 配列を応答に足し、`data`/`total` は非固定母集合（`exclude_ids`）。ピン行は絞込非依存で別途解決。
- **壊れているもの＝無し**（確認範囲）。
- migration head＝**control 0010・company 0006**（本セッション DBスキーマ変更なし・不変）。
- **Docker は起動したまま**（本セッション末）。DB には e2e 由来の残骸（多数の `E2E-*` 会社・`ideaquest_e2e_*` 会社DB）が蓄積＝テスト用途で無害。必要なら `docker compose down -v` で初期化可（cwd は `impl`）。

---

## 5. 詰まっている点 — 失敗したアプローチと理由 / 要判断

- **本セッションで詰まりは無し**。設計→test-first→green を素直に通した。
- **要判断だった点（解決済み）**:
  - **(A) の成果物スコープ**＝「まず設計契約を確定」をユーザーが選択（本命 SC-10/12 の backend EP は未実装・PGroonga 未デプロイのため 1セッションでの本適用は非現実的）。→ §1.8.1 を確定し、**既存の会社一覧を実証台**に契約を test-first 実装した。SC-10/12 本適用は別途（ドメイン新規構築が前提）。
  - **`group_count` の扱い**＝会社一覧の応答に `group_count` は未実装（会社DB `quest_groups` 依存＝ドメインC後）。設計を過剰主張しないよう B.1 行と CompanyListItem に「ドメインC後」と明記し、ソート/フィルタのホワイトリストから外した（設計↔実装ドリフト回避）。
- **DataTable のサーバー駆動モード＝フロント未実装（次の主眼）**。`computeRows()` を純関数境界として `data:T[]` の代わりに `query(state)=>{rows,total,pinned}` を委譲する形へ差し替え可能に設計済み（表示状態は localStorage のまま）。**委譲先の契約（§1.8.1）と会社EPが揃った**ので、次はここを実装して会社一覧を server モードで接続できる。
- **管理系一覧は client モードのまま据え置き**（handoff 既定・小規模）。サーバーモード化は**任意**（会社EPで実証はできるが、UI置換は必須でない）。**アイデア/クエスト(SC-10/12)はサーバーモード必須**（全文検索/カーソル/件数大）だが backend ドメイン未実装。
- **ローカル tsc**＝`impl/frontend` に **package-lock.json が無い**（追跡外）ため `npm ci` 不可。`npm install` → `node_modules/.bin/tsc --noEmit`。
- **backend テストの cwd 注意**＝Docker コマンドは **`impl` ディレクトリから**実行（`compose.yml` が impl 配下）。git はリポジトリルート基準。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **(A) はまず設計契約を確定**（不採用＝いきなり SC-10/12 実装／クエスト・ドメイン新規構築）。理由＝§5（本命EP未実装・PGroonga未デプロイ・設計書ファースト）。
- **クエリ契約の記法**（§1.8.1・すべてユーザー承認済み）:
  - **CSV は同一EPの `?format=csv`**（不採用＝別EP `/export`）＝「同一条件の全件」を一箇所で表現。
  - **フィルタはフラット命名 `<f>_contains/_min/_max/_from/_to`＋enum `=a,b`**（不採用＝`filter[x][op]=` ブラケット式）＝既存 `status=`/`group_id=` と地続き。
  - **ピン ID の保持は当面クライアント（localStorage）**（不採用＝サーバー永続化）＝§4.5⑨「将来ユーザー設定へ」に整合・YAGNI。
- **実証台＝既存の会社一覧EP**（不採用＝(a) 管理系を全部サーバーモード化／(b) クエスト新規）＝offset型でテスト資産があり、契約を端から端まで通せる。UI は opt-in（client モードは残す）。
- **集計 `account_count` は subquery+outerjoin で SQL ソート/範囲可能に**（不採用＝Python 側 dict 集計のまま）＝サーバー側で並び・件数・範囲を確定する契約に必須。
- **ホワイトリスト＋422 を全パラメータに**（sort/enum/columns/pin_ids）＝列挙耐性・任意列ソート/注入の遮断（§2.2）。
- **gitignore で lock/tsbuildinfo を追跡外**（不採用＝lock を追跡して `npm ci` 化）＝再現性は Docker に寄せる方針（Dockerfile は `package.json`＋`npm install` のみ参照）。※ Docker の依存固定を厳密化したいなら別途「lock 追跡＋Dockerfile `npm ci`」を検討（今回はスコープ外）。

### 過去の確定（正は各設計文書。要約）
- **会社作成状態は backend（作成=停止 `suspended`）を正**（前セッション解決済み・再判断不要）。
- **DataTable の挙動の正＝`mocks/shared.js` の `window.DataTable`**＋`デザイン標準.md §4.5`（⑪＝クリック標準）。管理系5画面（CompanyList/AccountSection/AccountSelfSection/QuestGroupSection/QuestGroupAdminView）は **client モードで DataTable 化済み**（前セッション完了）。
- **フロント先行プロトタイプ**（画面群ごとに移植→接続）。**shared.css/shared.js を単一デザインシステム**（impl は移植）。**モック⇔設計の矛盾は設計を正**（§5 の設計⇔backend は別軸で backend を正とした）。
- 認証＝Cookie＋Redis 不透明セッション（ADR-0001）。2プレーン×縦スライス4層。管理ロール3階層（system_admin / company_account_admin / QG管理者＝SoD）。

---

## 7. 次にやること — 優先順に、具体的に

### 【最有力】(A-2) DataTable フロントのサーバー駆動モード実装＋会社一覧を接続
- `impl/.../components/ui/DataTable.tsx` の `computeRows()` 純関数境界を残しつつ、`data:T[]` の代わりに **`query(state)=>{rows,total,pinned}` を委譲**するモードを追加（表示状態＝列順/幅/密度/ビュー/ピンID は localStorage 維持）。`state` は検索/複数ソート/項目別フィルタ/ページ/pin_ids。
- **委譲先は本セッションで完成した会社一覧EP**（`GET /admin/companies` が §1.8.1①〜④を実装済み）。まず会社一覧を server モードで接続して end-to-end 検証（e2e）。CSV は `?format=csv` を新規タブ/ダウンロードで。
- backend 契約は §1.8.1・会社EPは `impl/backend/app/control_plane/admin/company_application.py` を参照。

### 【横展開】(A-3) 他の一覧EPへ契約を横展開（test-first・§3 の型）
- アカウント一覧（`GET /admin/companies/{id}/accounts`・`GET /admin/accounts`）等。B.2 行の契約（ソート/フィルタ/CSV/pin）に沿って会社EPと同じ骨格で実装。QG/メンバー一覧は小規模で任意。

### 【別軸・大】(B) 本命 SC-10/12 と他ドメイン画面群
- **SC-10 クエスト一覧・SC-12 アイデア一覧**にサーバーモードを適用するには、**クエスト(C.1)・アイデア(D.1) のドメインを backend 新規構築**（ORM/権限/カーソル）＋**PGroonga デプロイ**（§1.11・J）が前提＝大きい別作業。契約（§1.8.1・C.1/D.1 行）は cursor 型で規定済み。
- その他の画面群移植（ダッシュボード/チャット/評価/ゲーミフィケーション等）は「画面モック先行→接続」で順次。

### 【任意】(C) DB 残骸クリーンアップ
- e2e 蓄積の `E2E-*` 会社が気になれば `cd impl && docker compose down -v` で初期化（seed から作り直し）。

---

## 8. 再開に必要な環境情報

- **backend テスト（Docker・cwd=`impl`）**＝`cd impl && docker compose up -d db redis` → `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（本セッション実測 **174 passed**）。**backend をボリュームマウントするのでコード変更が即反映**＝再ビルド不要。特定ファイルは `pytest tests/admin/test_admin_companies.py -q`、TC 絞りは `-k "126 or 127"`。
- **frontend の型チェック（Docker 不要）**＝`cd impl/frontend && npm install`（`npm ci` は不可＝lock 追跡外）→ `node_modules/.bin/tsc --noEmit`。生成物（`node_modules`/`package-lock.json`/`tsconfig.tsbuildinfo`）は追跡外。
- **impl フル起動**＝`cd impl && docker compose up -d --build`。ポート＝db `:5432`／redis `:6379`／mailhog `:1025`/`:8025`／backend `:8000`／frontend `:3000`。backend ヘルスは `/healthz`（`/health` は 404）。
- **frontend e2e（Docker）**＝`docker compose up -d --build frontend` → `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `docker compose exec -T frontend npx playwright install chromium` → `docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test <spec…> --workers=1`。**再ビルドで chromium は消える**ので install を毎回。**spec だけ変更**なら `docker compose cp frontend/e2e/xxx.spec.ts frontend:/app/e2e/xxx.spec.ts` で差し替え可（再ビルド不要）。管理系 spec＝`sc-90/91/92/92b/92b2/92c/93`。
- **DB 直接確認**＝`docker compose exec -T db psql -U ideaquest -d ideaquest_control -c "…"`（管理DB。会社DBは `ideaquest_company_acme` 等）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。
- **正となる場所**＝クエリ契約＝`doc/API設計/README.md §1.8.1`。一覧の操作標準（UI）＝`doc/画面設計/デザイン標準.md §4.5`（⑪=クリック標準・⑦=CSV・⑨=ピン）。DataTable の挙動の正＝`doc/画面設計/mocks/shared.js` の `window.DataTable`（impl `src/components/ui/DataTable.tsx` はその移植・`computeRows` が委譲境界）。デザインシステム＝`mocks/shared.css`（impl `src/styles/design-system.css`）。見た目＝`mocks/SC-xx_*.html`・機能/遷移＝`screens/SC-xx_*.md`・画面間＝`画面遷移図.md`。テスト規約＝`doc/規約/テスト規約.md`（TC-ID・red-green §5.1・設計書ファースト §5.2）。
- **運用**＝`.gitignore` で `*.pdf`・`.env`・`node_modules`・`package-lock.json`・`*.tsbuildinfo` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時のみ。CLAUDE.md が各規約への入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 本セッション＝(A) 一覧APIのクエリ契約に着手。**§1.8.1 を設計として確定**＋**会社一覧EPへ契約4項目（複数ソート/項目別フィルタ/CSV/ピン）を test-first 実装**（実証台）。
- ✅ 本セッション＝**6コミット・すべて push 済み**（origin/main = `8601ee6`・0/0）。作業ツリー クリーン（未追跡なし）。
- ✅ 検証＝**backend pytest 全体 174 passed（Docker 実測・回帰ゼロ）**。frontend は無変更（tsc=0 は開始時に確認・e2e 未再実行）。**Docker は起動したまま**。
- ✅ 次の主眼＝§7＝**(A-2) DataTable フロントのサーバー駆動モード実装＋会社一覧EPへ接続**（委譲先は完成済み）。次いで (A-3) 他一覧EPへ横展開。
- ⚠ 本命 SC-10/12 は **クエスト/アイデア・ドメインの backend 新規構築＋PGroonga デプロイが前提**＝大きい別作業（契約は cursor 型で §1.8.1・C.1/D.1 に規定済み）。
- ⚠ Docker コマンドは cwd=`impl` から。backend はマウントで即反映（再ビルド不要）。git はルート基準。
- ⚠ `group_count` は会社一覧に未実装（ドメインC後）＝ソート/フィルタ/集計の対象外（設計にも明記済み）。
