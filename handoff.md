# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-09（このセッション末）**。
- 作業ブランチ＝**`main`**（`origin/main` と同期・作業ツリー clean。本 handoff 更新を次コミットで push する）。
- 最新コミット＝**`0236452`** `test(eval): #22 星採点の radiogroup/radio 化にテストを追随（F-TC-201/202 復活）`。その前が **`bee9216`** `feat(game-feel): #18 取得中ローディングを全画面オーバーレイに統一＋#23 賛否バー初回0→比率を修正`。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝main へ増分ごと commit・**push は都度ユーザー確認**（本セッションは確認のうえ 2 本 push 済み）。検証分担＝機能（reduce・構造・データ整合）は私がテスト担保／見た目はユーザー目視（§6）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝正本 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`。受入台帳＝`doc/テスト/ゲーム感受入.md`（GF-AC-xxx）。

## 3. 今回やったこと（変更ファイルと理由）

### A. #18 取得中のローディングを「全画面オーバーレイ」に統一（受入完了・push `bee9216`）
- **背景**＝#18 の当初実装は各画面インラインの `<Spinner label="読み込み中…" />`（◆コインが回る `.iq-spinner`）。ユーザー要望で「**ダイアログ背面と同じ薄暗い全画面背景＋中央にスピナー**」へ変更。
- **モック先行**（`game-feel-mock-first-then-port`）＝`doc/画面設計/mocks/style-guide.html §13.5` に2変種を追加しユーザー受入（**ゲーム層＝◆コインスピナー**／**業務層＝コイン無しの中立スピナー `.iq-dot-spin`**・いずれも `rgba(15,23,42,.45)` の全画面背景＝ダイアログ背面と同一・reduce で回転停止）。
- **production 移植**＝共通部品 `impl/frontend/src/components/ui/Progress.tsx` に **`LoadingOverlay({label, variant})`** を新設（`variant="game"`＝コイン／`"clean"`＝中立）・`components/ui/index.ts` で export。CSS＝`impl/frontend/src/styles/design-system.css` に `.iq-loading-overlay`／`.iq-loading-clean`（`position:fixed inset:0`・z-index:90）を昇格＋reduce（`@media prefers-reduced-motion` に `.iq-loading-overlay{transition:none}`／既存 `.iq-spinner__coin`・`.iq-dot-spin` は `animation:none`。ユーザー設定は `[data-anim-reduced]` グローバル killswitch）。
- **適用画面**＝ゲーム層8画面（`features/{shop,spells,avatar,achievements,ranking,ideas(IdeaDetailView),chat(IdeaChatView),evaluations}` の各 View の `if(loading)`/`{loading&&}` 箇所を `<Spinner…>`→`<LoadingOverlay />`）＋業務層2画面（`features/companies/components/CompanyDetailView.tsx` の `if(!company)return` と `features/quests/components/QuestDetailView.tsx` の `if(!quest)return` を `<LoadingOverlay variant="clean" />`）。**業務層の list系/セクション/タブ部分ロード（QuestListView・AccountSection・QuestGroupSection・QuestDetailView のアイデアタブ 等）は現行のインライン「読み込み中…」のまま**（§13.4 局所ロードの考え方・§6 決定）。
- テスト＝**G-TC-174**（md 先行→red-green・`e2e/sc-18-loading.spec.ts`＝reduce で `.iq-spinner__coin` の `animationName:none`・rankings API を遅延させ取得中スピナーを可視化して観測）。md＝`doc/テスト/G_ゲーミフィケーション.md §5-S`。受入＝**GF-AC-180 ✅(目視)／181 ✅(e2e G-TC-174)**。

### B. #23 賛否バーの初回 0→比率が再生されない不具合を修正（GF-AC-230・push `bee9216`）
- **症状**（ユーザー報告 GF-AC-230 NG「アニメーションされない」／231・233 は OK）＝アイデア詳細を開いた初回だけ賛否バーが 0→比率に伸びない（投票/解除での伸縮は動く）。
- **原因**＝`features/ideas/components/IdeaDetailView.tsx` の `voteBarReady` を `useEffect(()=>setVoteBarReady(true),[])` で**マウント直後**に true 化していた。だが同 View は `if(loading) return <LoadingOverlay/>`（バー未描画）でマウント初回はローディング画面ゆえ、**バーが実際に描画される前に voteBarReady が true**→バーは最初から比率幅で出て 0→比率の transition が再生されない。
- **修正**＝`useEffect(()=>{ if(loading)return; 二重 requestAnimationFrame で setVoteBarReady(true); },[loading])` に変更＝loading 完了後にバーを `width:0` で描画→次フレームで比率へ伸ばす（transition 再生）。reduce 時は CSS `transition:none`（`features/ideas/ideas.css` の `.vote-bar__agree/__disagree`）で即時。受入＝**GF-AC-230 ✅(ユーザー再確認)**。

### C. 既存不具合 sc-25-eval F-TC-201/202 の解決＝テストの陳腐化を修正（push `0236452`）
- **発見**＝#18 の回帰確認で `e2e/sc-25-eval.spec.ts` の **F-TC-201/202 が 30s timeout**。stash して私の変更前（main HEAD）コードでもビルドし直して再走→**同じく失敗**＝**私の #18/#23 変更とは無関係の既存不具合**と確定（handoff が「未再走」と警告していた箇所）。
- **原因**＝評価画面の星採点は `EvaluationView.tsx` で `<button role="radio" aria-checked>`（radiogroup/roving tabindex＝**正しい単一選択 ARIA**・#22 で整備）。だがテスト helper `rateAll`（と下書き検証）が**古い `getByRole("button",{name:"N点"})`＋`aria-pressed`** のままでマッチせず、星を採点できず timeout していた（失敗時スクショで「星が未採点☆のまま評価画面停止」を確認＝red）。**製品は正・テストが未追随**。
- **修正**＝`e2e/sc-25-eval.spec.ts` の3箇所を `getByRole("radio",…)`／assert を `aria-checked` に修正→**sc-25-eval 5 passed**（F-TC-201/202/203・G-TC-171/172、green）。

### D. 受入台帳の更新（`doc/テスト/ゲーム感受入.md`）
- #18〜#23 の受入を記録。**視覚 AC はユーザー目視 OK**（GF-AC-180/190/200/201/210/211/220/221/230/231/233）。**reduce AC は私が担保**（181=e2e G-TC-174／191/202/212/222/232=**CSS 機構確認**〔各セレクタに `@media prefers-reduced-motion` の停止＋`[data-anim-reduced]` グローバル killswitch〕）。#14 は前セッションどおり仮OK（3Dアバター未実装）。

## 4. 現在の状態（動く / 壊れ / テスト）
- **フロントゲート（本セッション実測）**＝`npx tsc --noEmit` 緑／`npx vitest run` **160 passed**／`npm run build` 成功／`python3 scripts/check_tc_traceability.py` **✅ code 430**。
- **e2e（本セッション・実 docker スタック・実測）**＝`sc-18-loading` 1 passed（G-TC-174）／`sc-25-eval` 5 passed（F-TC-201/202/203・G-TC-171/172）／`sc-41-ranking`・`sc-30-32-balance-sync`・`sc-24-chat` は #18 回帰で green（前セッションの G-TC 群）。**他 e2e は本セッション未実行（未確認）**。
- **backend pytest ＝本セッション未実行（未確認）**。前回既知＝513 passed 相当。手順は §8。
- **QA スタック＝全起動中**（`docker compose ps`＝backend/db/frontend/mail-worker/mailhog/minio/redis/worker いずれも running）。frontend は **`0236452` までの全変更を焼き込み済み**（#18＋#23 を含めて最後に再ビルド済み）。※コード変更後は再ビルド必須（§8）。
- **壊れているもの＝把握範囲で無し**（ゲート緑＋主要 e2e 緑）。既存不具合だった sc-25-eval は解決済み。

## 5. 詰まっている点（試した/失敗と理由＝いずれも解決済み）
- **初回アニメを mount effect で仕込むと再生されない**（#23）＝`useEffect(…,[])` は `if(loading) return` の**ローディング画面表示中**に発火し、本体（バー）描画前に状態が確定してしまう。**loading 完了を依存に入れ、描画後に rAF で仕込む**のが定石（記憶 `mount-effect-fires-during-loading`）。
- **role 変更にテストが未追随で 30s timeout**（sc-25-eval）＝`role="button"→"radio"`／`aria-pressed→aria-checked` の齟齬。**症状が「timeout」だけで原因が分かりにくい**→`playwright.config.ts` に一時的に `screenshot:"only-on-failure"` を足し、`test-results/**/test-failed-1.png` を Read して停止状態を直接確認すると早い（確認後は config を戻す）。
- **reduce の e2e エミュレーション**（前セッションからの継続注意）＝`test.use({reducedMotion:"reduce"})` は本 Playwright 設定では効かない。各 reduce テスト先頭で **`await page.emulateMedia({reducedMotion:"reduce"})`** を明示する（G-TC-174 もこの方式）。

## 6. 決定事項と根拠（不採用案も）
- **#18 ローディング＝全画面オーバーレイ**（薄暗い全画面背景＋中央スピナー）。不採用＝インライン `.iq-spinner`（当初実装）。理由＝ユーザー要望（ダイアログ背面と同じ見え方で統一感）。
- **オーバーレイの覆う範囲＝ビューポート全体**（`position:fixed inset:0`・ヘッダー/ナビも覆う）。不採用＝コンテンツ領域のみ。ユーザー選択。
- **業務系にもクリーン版オーバーレイを新設**（コイン無しの中立スピナー）。不採用＝業務系は素のテキストのまま据え置き。理由＝ユーザー選択（全画面読み込みの体験を統一）。ただし**適用は全画面 early-return の初期ロードのみ**（会社詳細・クエスト詳細）＝list系/セクション/タブ部分ロードは §13.4 局所表示の思想で現行維持（コイン/CRT はデザイン標準 §0/§13「業務層クリーン」に従い業務系に載せない）。
- **sc-25-eval は製品ではなくテストを直す**＝星は radiogroup/radio/aria-checked が正しい ARIA（`spec-is-source-of-truth` の逆＝この件は設計/実装が正でテストが誤り）。
- **reduce AC（191/202/212/222/232）は CSS 機構確認で確定扱い**（e2e は #18 のみ）。理由＝全アニメは `@media prefers-reduced-motion` の個別停止＋`[data-anim-reduced]` グローバル killswitch の二重で categorically 無効化される機構を各セレクタで確認済み。**e2e 追加は §7-1 の残タスク**。

## 7. 次にやること（優先順・具体的に）
1. **（任意）reduce AC の e2e 化**＝現状 CSS 確認のみの **191/202/212/222/232** を e2e で固める。到達可＝**#21 オーラ**（`/`＝`.dash-page .hero__avatar[data-tier]::after` の `getComputedStyle(el,'::after').animationName==="none"`）／**#22 星**（`/ideas/{id}/eval`＝`.star` の `transition`／`.stars[data-pop] .star.is-on` の `animationName` none）／**#23 賛否バー**（`/ideas/{id}`＝`.vote-bar__agree` の `transitionDuration` 実質0）。到達が不安定＝**#19 空状態**（EmptyState を空にする導線が要工夫）・**#20 マスコット追従**（hover＋設定 ON 前提）。方式＝`page.emulateMedia({reducedMotion:"reduce"})`。TC は空き番号（現在 e2e 最大 **G-TC-174**・次は **G-TC-175**〜）で md（`doc/テスト/G_ゲーミフィケーション.md`）先行→red-green。
2. **積み残しの GF-AC バックログ**＝受入台帳 `doc/テスト/ゲーム感受入.md` に **#24〜#34** が定義済み（多くは「未確認」＝`handoff-notes-often-stale` どおり既実装の可能性大→着手前にコードで裏取り）。ID 順に、機能（reduce 等）は私がテスト＋実起動確認→見た目はユーザー目視。
3. **（任意）backend pytest 再確認**＝§8 手順で 513 相当が緑か。
- **共通ゲート**＝`npx tsc --noEmit`＋`npx vitest run`＋**`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。**push は都度確認**。テストは md に TC 行(`根拠`列)→red-green→traceability ✅。backend の response_model 変更後は `cd impl/frontend && npm run codegen`。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `main` 確認**。compose＝`impl/compose.yaml`（cwd=`impl`・Postgres user/pass=`ideaquest`）。
- **QA スタック起動**（記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。frontend=`localhost:3000`／backend=`localhost:8000`（`/healthz`）／MailHog=`localhost:8025`。**コード反映は再ビルド**＝`docker compose build frontend && docker compose up -d frontend`（push だけでは running に反映されない）。※デモ等で「スタックを触るな」と言われたら再ビルド/再起動＋localhost への e2e を止める。
- **ログイン（dev・MFAなし）**＝`/login` company_code=`ACME-01`。主要ユーザー＝`user@acme.example`/`Passw0rd!`（owner・クエスト/アイデア多数）。残高 QA 用＝`user2@acme.example`/`Passw0rd!`（コイン1000/SP100・`sc-30-32` の teardown で baseline に戻す）。
- **フロントゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（現状 160）／`npm run build`／`npm run codegen`。
- **e2e**（cwd=`impl/frontend`・docker スタック起動中）＝`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test <spec> --workers=1`。**reduce テストは `page.emulateMedia({reducedMotion:"reduce"})`**（§5）。失敗デバッグは `playwright.config.ts` に一時的に `screenshot:"only-on-failure"` を足し `test-results/**/test-failed-1.png` を確認（済んだら戻す）。ゲーム感の e2e＝`sc-18-loading`／`sc-30-32-balance-sync`／`sc-41-ranking`／`sc-02-notifications`／`sc-25-eval`／`sc-24-chat`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（現状 ✅ code 430）。走査対象＝`impl/backend/tests/**/*.py` と `impl/frontend/e2e/**/*.spec.ts` のみ（frontend の vitest 単体 `src/**/*.test.ts` は対象外＝domain md の TC 行で追跡）。
- **backend テスト**（cwd=`impl`）＝**pytest 前に `docker compose stop worker mail-worker`**（mail_outbox 競合）→ `docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q` → 終わったら `docker compose start worker mail-worker`。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` を `file://` 直開き→`Ctrl+F` で節番号（例「13.5」＝全画面ローディングオーバーレイ・「17M」＝ショップ購入）。
- **設計正本**＝`CLAUDE.md` から各規約/正本を参照。フェーズ運用＝`doc/フェーズ毎ルール/ゲーム感フェーズ.md`。GF-AC 受入台帳＝`doc/テスト/ゲーム感受入.md`。ゲーム感の TC 一覧＝`doc/テスト/G_ゲーミフィケーション.md`（§5-S＝#18 の G-TC-174）。
- **記憶**（要確認）＝`game-feel-async-pipeline`(push都度確認)／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`mock-match-impl-layout`／`animation-reduce-motion-standard`(reduce は私が担保)／`framer-reducemotion-null-flip`／`mount-effect-fires-during-loading`(#23 の教訓)／`frontend-build-gate-eslint`／`handoff-notes-often-stale`(未確認は着手前にコードで裏取り)／`spec-is-source-of-truth`／`design-spec-working-style`／`document-design-rationale`。
