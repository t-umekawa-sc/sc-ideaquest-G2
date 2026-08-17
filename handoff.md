# 作業引き継ぎ (handoff)

> 次回セッション開始時に **このファイルだけ読めば作業を再開できる** ことを目的とした引き継ぎメモ。
> 読者は「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。詳細仕様は必ず `doc/要件定義/README.md`・`doc/API設計/`・`doc/ADR/`・`doc/データモデル.md`・`doc/テスト/`・`doc/規約/`・`doc/画面設計/` を正とすること（本 handoff は要約）。
> 毎回このファイルは全文を上書きする（履歴は git に任せる）。
>
> **現在地（2026-08-17）＝(A-2)(A-3) 一覧クエリ契約(§1.8.1)を会社→アカウントへ横展開し、後半は「Phase 1 完成画面のモック突き合わせ」と「共通UI不具合修正」「モーダルの URL 化(Parallel@modal＋Intercept)＋アニメ基盤」を実施。SC-91 会社作成を URL モーダルのリファレンスとして完成。次の主眼は (a) 他モーダル(SC-90/92/93)の URL 化 同型展開、(b) Phase 1 完成画面レビューの継続、(c) 未移植 12 画面のモック移植。**

---

## 1. 最終更新日時 / ブランチ / 最新コミット

- 最終更新: **2026-08-17（本セッション終了時）**。
- ブランチ: **main**。**origin/main と同期済み（0/0）＝本セッション分は全て push 済み**。次回 push 要否確認は不要。
- 最新コミット: **`1ec3010`**（feat(SC-91) 会社作成を URL 付きモーダルへ移行）。
- 本セッションの起点＝**`dc89e19`**（前セッション末の handoff コミット）。
- **本セッションのコミット（古い順・`git log dc89e19..HEAD`・全て push 済み）**:
  - `066f77e` フレーク修正：常駐ワーカを compose profile `workers` へ隔離（backend pytest との mail_outbox 競合解消）。§5。
  - `b7cb7a7` vitest 単体テスト基盤導入（frontend）。
  - `1945ce2`/`d42afa2`/`13baf0b` **(A-2)** DataTable サーバー駆動モード＋会社一覧(SC-91)接続＋§1.8.1 4項目 e2e。
  - `487a711` docs：e2e は `--profile workers` が要る旨（066f77e の記述訂正）。`9f7a059` chore：next-env.d.ts を gitignore。`70a3e5b` a11y：ピントグルに aria-label。
  - `15fa354`/`5fd5c94`/`a8645e6`/`d37c509` **(A-3)** 共通パーサ抽出＋アカウント一覧EPへ §1.8.1 横展開（複数ソート/enum多値/ピン/CSV）。
  - `056a581`/`aa9a024` **SC-00 ログイン**（状態A〜D）をモック整合。`0c70803` README に MailHog 追記。
  - `6ac6b20` **SC-90** クエストグループ管理をモック整合＋モックを設計へ更新。
  - `a5f56ab`/`0f7a19e` **共通UI修正**：行アクションメニューの空表示/チラつき修正＋▶選択カーソル移植。
  - `4990a26`/`1ec3010` **モーダル URL 化基盤**：framer-motion で enter/exit（CRT電源ON＝縦に開く）＋RouteModal＋scrollbar-gutter 固定／**SC-91 会社作成を URL モーダル化**（リファレンス）。
- コミットは 1変更=1コミット、末尾 `Co-Authored-By: Claude Opus 4.8`。remote: `https://github.com/t-umekawa-sc/sc-ideaquest-G2.git`。
- **作業ツリー＝クリーン**（未追跡なし。`next-env.d.ts`・`package-lock.json`・`*.tsbuildinfo`・`node_modules` は gitignore 済み）。

---

## 2. このプロジェクトのゴール

- **ideaquest**＝社内アイデア創出をゲーミフィケーション（XP/コイン/レベル/魔法/ランキング）で促す WEB アプリ（マルチテナント SaaS・管理DB1＋会社DB N の2プレーン）。
- スタック＝フロント Next.js(App Router)／バック FastAPI(4層)／PostgreSQL(会社DBのみ PGroonga)／Redis／MinIO／MailHog(dev)／Docker。
- 設計フェーズは全確定。フロントは「画面モック先行 → 画面群ごとに backend 接続」方針（フロントエンド実装フロー規約）。**Phase 1(全画面モック移植)は部分完了**＝下記 §4 参照。

---

## 3. 今回やったこと — 変更したファイルと理由

### (A-2) 会社一覧のサーバー駆動 DataTable（§1.8.1）
- `impl/frontend/src/components/ui/DataTable.tsx`＝opt-in の `server` プロップ（`query(state)=>{rows,total,pinned}`）で computeRows/ローカルページングをバイパス。seq+AbortController で stale レース排除・検索のみ 300ms デバウンス。client モードは全分岐 `hasServer` ガードで無改変。
- `impl/frontend/src/features/companies/api.ts`＝`companiesQueryParams`(純関数・unit)／`queryCompanies`／`companiesCsvUrl`。`components/CompanyList.tsx` を server モード接続＋列フラグを backend ホワイトリストに整合。
- vitest 導入（`vitest.config.ts`・`api.test.ts`＝B-TC-136 unit）。schema.d.ts 再生成で `CompanyListResponse.pinned` 反映。

### (A-3) アカウント一覧EPへ §1.8.1 backend 契約 横展開（両EP＝`GET /admin/companies/{id}/accounts` と `GET /admin/accounts` 共有）
- `impl/backend/app/control_plane/admin/list_query.py`（新規）＝EP 非依存の共通パーサ（`parse_sort`/`parse_enum`/`parse_pin_ids`/`parse_columns`/`to_csv_bytes`＋定数）。`company_application.py` を移行（DRY）。
- `impl/backend/app/control_plane/admin/application.py`＝`_account_query`／`_fetch_pinned_accounts`／`export_accounts_csv`。ソート可＝display_name/login_id/email/system_role/status/last_login_at/created_at、enum＝status/system_role、CSV 監査＝`account.export`。`schemas.py` に `AccountListResponse.pinned`。`router.py` の account 両EPに sort/system_role/pin_ids/format/columns を追加（status の pattern 撤去＝検証を application 一本化）。
- テスト＝`tests/admin/test_admin_accounts.py` に B-TC-141〜151。`doc/テスト/B_会社・アカウント.md §2.1` に TC 追記（設計書ファースト）。`tests/conftest.py` の `make_account` に display_name/system_role を追加。

### Phase 1 完成画面レビュー（モック突き合わせ・DoD=モック一致）
- **SC-00 ログイン**（`features/auth/components/{LoginForm,MfaForm,PasswordSetupForm,PasswordResetRequestForm}.tsx`＋`auth.css`）を状態A〜D でモック整合（type=text/placeholder/端末記憶/注記/フッター/CRT無関係の文言）。会社コードのプレースホルダは「例: systemcon」、ログインIDは「例: system.concierge」（ユーザー指定）。#2信頼文言/#3要件hint はモック側を実装に合わせて更新（`mocks/SC-00_ログイン.html`）。
- **SC-90** クエストグループ管理（`features/qgadmin/components/QuestGroupAdminView.tsx`＋新規 `qgadmin.css`）をモック整合。設計由来差（メンバー最小射影＝氏名+ロール／ディレクトリ最小射影）は `mocks/SC-90_…html` を設計へ更新。ディレクトリはライブ検索化。

### 共通UI不具合修正（`components/ui/RowMenu.tsx`＋`styles/design-system.css`）
- 行アクション ⋯ メニューが下行の sticky 操作セルに覆われ空表示になる不具合＝開いた行の `td.col-actions` に `rowmenu-open` を付与（z-index:1001・既存CSSルールを使用）。初回描画のチラつき＝開く前に座標を確定してから開く。▶選択カーソル演出（`.rowmenu__list`/`.usermenu__list` の ::before）を design-system.css へ移植。

### モーダルの URL 化（Parallel@modal＋Intercept）＋アニメ基盤
- `components/ui/Modal.tsx`＝framer-motion で enter/exit（**CRT電源ON＝scaleY≈0.04 の横線が発光してから縦に開く**・design-system.css `.modal__panel--crt-in`/`@keyframes modal-crt-flash`）。`onClosed`(exit完了) 追加。§105-107 挙動は維持。`prefers-reduced-motion` で静止。
- `components/ui/RouteModal.tsx`（新規）＝intercept ページ用ラッパ（閉じアニメ後に router.back・子に close を渡す render-prop）。
- `globals.css` の `html` に `scrollbar-gutter: stable`＝モーダル表示でスクロールバーが消えても背景幅不変（横チラつき解消）。
- **SC-91 会社作成**を URL モーダル化＝`features/companies/components/CompanyCreateForm.tsx`（新規・抽出）／`app/(app)/admin/companies/new/page.tsx`（フルページ）／`app/(app)/@modal/(.)admin/companies/new/page.tsx`（intercept）。トリガを Link 化。作成成功＝`COMPANIES_CHANGED_EVENT`（window イベント）を発火→`CompanyList` が購読して再取得（跨ルート疎結合ブリッジ）。e2e に B-TC-160。

---

## 4. 現在の状態 — 動いているもの / 壊れているもの / テスト

- **backend**＝`pytest tests/` は本セッション最終で **185 passed**（(A-3-4) 直後・ワーカ停止時に実測）。以後 backend コード変更なし。**⚠ 現在ワーカ稼働中のため、いま pytest を回すと mail 系がフレークし得る**（§5・§8 参照＝pytest 前に mail-worker を止めること）。
- **frontend 型**＝`tsc --noEmit`＝0（各変更後に実測）。
- **frontend e2e（Docker・実測）**：
  - **sc-91**（会社一覧・URLモーダル含む）＝**8 passed**（B-TC-110/111/112/137/138/139/140/160・最終アニメ後に実測）。
  - **sc-92b**（アカウント一覧・client-state Modal）＝**3 passed**（最終アニメ後に実測＝共有 Modal アニメ化の後方互換確認）。
  - **sc-00**（ログイン A〜D）＝5 passed／**sc-90**（QG管理）＝3 passed／**sc-92b2/sc-93**＝passed。ただし**これらはモーダル最終アニメ変更(4990a26)より前の実行**＝アニメ後は未再実行（低リスクだが要なら再確認）。
- **完成画面（実UIあり・接続済み）**＝認証群(login/pw-setup/pw-reset/email-change)・管理群(SC-90/91/92/93)・プロフィール。**Phase 1 は部分完了**。
- **未移植スタブ＝12 画面**（`ScreenStub` 使用・`grep -rln ScreenStub src/app`）：SC-01 ダッシュボード(ハブのみ)・SC-02 通知・SC-10 クエスト一覧・SC-11 クエスト作成モーダル(枠のみ)・SC-12 クエスト詳細・SC-22 アイデア詳細・SC-24 チャット・SC-25 評価・SC-30 ショップ・SC-31 アバター・SC-32 魔法・SC-40 実績・SC-41 ランキング。**SC-21 アイデア登録編集はルート自体なし**。
- **壊れているもの＝無し**（確認範囲）。migration head＝前回から不変（**本セッション DBスキーマ変更なし**。前 handoff 記載＝control 0010・company 0006）。
- **Docker＝フルスタック稼働中（`--profile workers` 込み）**。DB に e2e 残骸（多数の `E2E-*`/`DIAG*`/`QGA*` 会社・グループ）＝無害。必要なら `cd impl && docker compose down -v` で初期化。

---

## 5. 詰まっている点 — 失敗したアプローチと理由 / 要判断

- **フレーキーテスト（解決）**＝backend pytest と常駐 `mail-worker` が共有 control DB の `mail_outbox` を real sender で奪い合い、A-TC-040 等が間欠失敗。→ ワーカを compose profile `workers` に隔離（既定 `up` で起動しない）。**帰結＝e2e はワーカ依存（sc-00-mfa の OTP 配信・sc-90 のディレクトリミラー）なので `docker compose --profile workers up -d` が必要**。逆に **backend pytest はワーカ無しで回すこと**（両立しない・compose.yaml/README に明記）。
- **モーダル空表示（解決）**＝RowMenu が `rowmenu-open` クラス未付与で下行 sticky セルに覆われていた（§3）。DOM ダンプで確定してから修正。
- **モーダルの跨ルート一覧更新**＝intercept は背景を再マウントしないため、作成成功を `window` イベントで通知して一覧が再取得（`COMPANIES_CHANGED_EVENT`）。**将来はサーバーコンポーネント初期データ＋`router.refresh()` へ整理**（今回は疎結合ブリッジ・要改善点）。
- **アニメ検討経緯**＝走査線スイープ→ユーザー評価「いまいち」→**CRT電源ON（縦に開く）**へ作り直し（採用）。layoutId 共有要素拡大は未採用（実装増）。

---

## 6. 決定事項と根拠（採用しなかった案も）

### 本セッション
- **フレーク修正＝compose profiles**（不採用＝テスト手順固定化/ hermetic DB）＝安全側（ワーカ無し）を既定にできる。
- **(A-3) スコープ＝backend 契約まで**（frontend 接続は次パス）／**共通パーサは list_query.py へ抽出**（DRY §2.3・純関数で低リスク・既存174テストが回帰ガード）。
- **§7 モック↔設計 矛盾は設計を正**＝会社/アカウント一覧の非対応ソート・per-field text フィルタは列から外し、SC-90/91 のモック側を設計へ更新。`group_id` フィルタ・group_count・ログインID/参加日は最小射影(B.4)で非提供＝実装せず設計にも明記。
- **SC-00 ログインID `type=text`**（不採用＝email）＝login_id は email と別値可（B.2）。会社コードは大文字正規化＋localStorage 端末記憶。
- **モーダル URL 化＝リファレンス先行**（SC-91 のみ・他は次パス）。**アニメ＝CRT電源ON(縦に開く)**（不採用＝走査線スイープ/スプリングポップ/layoutId）。**scrollbar-gutter:stable**（不採用＝JS で padding 補償＝exit タイミング問題があるため CSS を採用）。

### 過去の確定（正は各設計文書。要約）
- 会社作成状態＝backend（作成=停止 `suspended`）を正。DataTable の挙動の正＝`mocks/shared.js` の `window.DataTable`＋`デザイン標準.md §4.5`。認証＝Cookie＋Redis 不透明セッション(ADR-0001)。2プレーン×縦スライス4層・管理ロール3階層(SoD)。

---

## 7. 次にやること — 優先順に、具体的に

### 【最有力】(モーダル URL 化) 他フォームモーダルを SC-91 と同型で展開
- 対象＝**SC-92 発行/編集/設定**（`features/accounts/components/AccountSection.tsx` の各 `<Modal>`）・**SC-93 自社発行/編集**（`AccountSelfSection.tsx`）・**SC-90 メンバー追加**（`features/qgadmin/components/QuestGroupAdminView.tsx` の追加モーダル）。
- 手順＝各モーダルのフォームを `*Form` コンポーネントに抽出→`app/(app)/…/new(や edit)/page.tsx`(フルページ)＋`app/(app)/@modal/(.)…/page.tsx`(intercept・`RouteModal` 使用)を追加→トリガを `<Link>` 化→成功時 window イベントで一覧再取得。**SC-91 の `CompanyCreateForm`＋`app/(app)/@modal/(.)admin/companies/new/page.tsx` が雛形**。e2e はトリガ role が button→link に変わるので該当セレクタを更新（§8 接続維持）。

### 【並行】Phase 1 完成画面レビューの継続（モック突き合わせ）
- 残り＝**SC-91 会社一覧**（`mocks/SC-91_システム管理.html`↔`CompanyList.tsx`。注：db識別子ソート/text絞込は §1.8.1 で縮退済み。モック側の整合が未実施なら §7 に沿って更新）・**SC-92 会社詳細**（`CompanyDetailView.tsx`）・**SC-93 自社アカウント**（`AccountSelfSection.tsx`）・**プロフィール**（`features/profile`）。SC-00/SC-90 は整合済み。

### 【別軸・大】Phase 1 未移植 12 画面のモック移植
- `ScreenStub` を実UIへ（規約推奨順＝ダッシュボード SC-01→クエスト SC-10/11/12→アイデア/チャット/評価 SC-21/22/24/25→ゲーム層 SC-30/31/32/40/41→通知 SC-02）。`shared.css`→`design-system.css`、URL モーダル標準、fixtures(型は schema.d.ts)。**SC-21 はルート新設が必要**。

### 【横展開の続き】(A-3) frontend 接続＋残り一覧EP
- アカウント一覧(`AccountSection`/`AccountSelfSection`)を server モード化（会社一覧の `queryCompanies` と同型で `accountsQueryParams` 等を追加）。schema 再生成で `AccountListResponse.pinned` を型へ反映。

---

## 8. 再開に必要な環境情報

- **フルスタック起動＋e2e/アプリ利用（ワーカ込み）**＝`cd impl && docker compose --profile workers up -d --build`。ポート＝frontend `:3000`／backend `:8000`（`/healthz`）／db `:5432`／redis `:6379`／mailhog SMTP `:1025`・UI **`:8025`**。**e2e は `--profile workers` が必須**（OTP 配信・ディレクトリミラー）。
- **backend テスト（Docker・cwd=`impl`）**＝**先に `docker compose stop worker mail-worker`**（mail 競合フレーク回避）→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（本セッション最終 **185 passed**）。backend はマウントで即反映（再ビルド不要）。TC 絞りは `-k "141 or 149"`。
- **frontend 型チェック（Docker不要）**＝`cd impl/frontend && npm install`（`npm ci` 不可＝lock 追跡外）→ `node_modules/.bin/tsc --noEmit`。**unit（vitest）**＝`npx vitest run`（`api.test.ts`）。
- **frontend e2e（Docker）**＝frontend はソース焼き込み（マウント無し）＝**コード変更後は再ビルド必須**：`docker compose up -d --build frontend`。再ビルドで chromium が消えるので毎回 `docker compose exec -u root -T frontend npx playwright install-deps chromium` → `… install chromium`。実行＝`docker compose exec -T -e LOGIN_RATE_LIMIT_MAX=50 frontend npx playwright test <spec> --workers=1`。**spec だけ変更**なら `docker compose cp frontend/e2e/xxx.spec.ts frontend:/app/e2e/xxx.spec.ts` で差替可（再ビルド不要）。管理系 spec＝`sc-90/91/92/92b/92b2/92c/93`・認証＝`sc-00-*`。
- **MailHog（送信メール確認）**＝`http://localhost:8025`（要ワーカ）。**dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。
- **正となる場所**＝クエリ契約＝`doc/API設計/README.md §1.8.1`。一覧UI標準＝`doc/画面設計/デザイン標準.md §4.5`。モーダル＝同 §112-114（Parallel@modal＋Intercept・framer-motion）。見た目の正＝`doc/画面設計/mocks/SC-xx_*.html`＋`shared.css`（impl は `design-system.css`）。テスト規約＝`doc/規約/テスト規約.md`（TC-ID・red-green §5.1・設計書ファースト §5.2）。フロント進め方＝`doc/規約/フロントエンド実装フロー規約.md`。
- **運用**＝`.gitignore` で `*.pdf`・`.env`・`node_modules`・`package-lock.json`・`*.tsbuildinfo`・`next-env.d.ts` 追跡外。末尾 Co-Authored-By。push は原則ユーザー依頼時。CLAUDE.md が各規約の入口。

---

### 自己チェック（このファイルだけで再開できるか）
- ✅ 本セッション＝(A-2)(A-3) §1.8.1 横展開＋Phase 1 レビュー(SC-00/SC-90)＋共通UI修正＋**モーダル URL 化基盤(SC-91 リファレンス)**。全 20 コミット push 済み（origin/main=`1ec3010`・0/0）。作業ツリー クリーン。
- ✅ 検証＝backend 185 passed（ワーカ停止時）／frontend tsc=0／sc-91 8 passed・sc-92b 3 passed（最終アニメ後）。他 e2e はアニメ後未再実行（§4）。
- ✅ 次の主眼＝§7＝他モーダル(SC-90/92/93)の URL 化 同型展開／Phase 1 レビュー継続／未移植 12 画面。
- ⚠ **環境＝ワーカ稼働中**。backend pytest を回すなら **先に `docker compose stop worker mail-worker`**（mail フレーク回避）。e2e はワーカ必須。
- ⚠ frontend はマウント無し＝コード変更後は `up -d --build frontend`＋chromium 再導入。Docker コマンドは cwd=`impl`。
- ⚠ モーダル跨ルート更新は window イベント(`COMPANIES_CHANGED_EVENT`)の暫定ブリッジ＝将来サーバーデータ流路へ（§5）。
