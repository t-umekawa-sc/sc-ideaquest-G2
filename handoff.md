# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-10（このセッション末）**。
- 作業ブランチ＝**`main`**（`origin/main` と同期・push 済み）。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝main へ増分ごと commit・**push は都度ユーザー確認**。本セッションは受入と並行して実装し、最後に「プッシュして」の明示指示で push。
- 検証分担＝機能（reduce・構造・データ整合）は私がテスト担保／見た目はユーザー目視（§6）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝正本 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`。受入台帳＝`doc/テスト/ゲーム感受入.md`（GF-AC-xxx）。

## 3. 今回やったこと（変更ファイルと理由）

### A. reduce AC の e2e 化（#21 オーラ／#22 星／#23 賛否バー）＝当初タスク
- **背景**＝これまで reduce AC の多くは「CSS 機構確認で確定扱い」だった（handoff 既定）。到達可能な3件を e2e で固めた。
- **追加テスト**（md 先行→**red 目視**→green・テスト規約 §5.1）：
  - **G-TC-175**（#21 オーラ脈動）＝`e2e/sc-01-dashboard.spec.ts`。ACME ゲームユーザーで `/`。`.dash-page .hero__avatar[data-tier]::after` の computed `animationName` が **no-preference で `aura-pulse`／reduce で `none`**（二方向ガード）。
  - **G-TC-176**（#22 星拡大・ポップ）＝`e2e/sc-25-eval.spec.ts`。reduce 下で採点し `.star` の `transitionDuration`=**`0s`**／採点しても `.stars[data-pop="true"]` が**出ない**（JS が `reduceMotion()` 真で data-pop を張らない）／星は即 `is-on`。
  - **G-TC-177**（#23 賛否バー）＝`e2e/sc-22-idea-detail.spec.ts`。`.vote-bar__agree` の `transitionDuration` が **no-preference で >0／reduce で `0s`**（0-0 は width:0 で不可視ゆえ `waitFor("attached")` で待つ）。
- md＝`doc/テスト/G_ゲーミフィケーション.md §5-T/§5-U/§5-V`。方式＝`page.emulateMedia({reducedMotion})`（設定の `test.use` は効かない・§5）。
- **副次で既存不具合を修正**＝`sc-01-dashboard.spec.ts`（OPS）と `sc-22-idea-detail.spec.ts`（ACME）の `login` ヘルパーが陳腐化した `getByText("ようこそ")` 待ちで 30s timeout していた（挨拶文が時間帯依存に変更され「ようこそ」は非存在＝`handoff-notes-often-stale` パターン）。sc-18/sc-25 と同じ堅牢パターン（`waitForURL`＋`.app-header`）へ是正＝これで D-TC-207・hero balance も復活。

### B. ゲーム感バッチ #24〜#33 の受入対応（視覚調整＝私が実装／台帳更新）
受入はユーザーが production（localhost:3000）で目視する live ループ。私宛の reduce 確認と、指摘の視覚調整を実施：
- **#26 GF-AC-261 称号チップ可読化**（視覚バグ）＝称号チップ（例「一人前」青/「熟練」紫）が**透過背景（15%）で暗い背景画像が透け低コントラスト**。`features/dashboard/dashboard.css` `.hero__title`／`features/profile/profile.css` `.prof-head__title` を**不透明ダーク背景 `rgba(15,23,42,.92)`＋白寄りティア色テキスト `color-mix(var(--aura) 60%, #fff)`＋太字**に。
- **#27 GF-AC-270 レアの輝きを「枠」→「文字」へ**（方針変更）＝当初 `.card.rarity-rare` の枠脈動。style-guide `§17N` にモック先行→受入（強度「しっかり」）→production 移植。**再指摘（パネル枠不要・文字周りの四角い箱が出る）**に対し、**box-shadow グロー・背後ハロー・カード枠脈動を全撤去**し、`.rarity-rare` ラベル（`.spell-card__rarity`/`.buy.rarity-rare .buy__rarity`/`.item__rarity`）に **text-shadow の文字グロー＋右上 ✦ きらめきのみ**（矩形の箱を出さない）。CSS＝`styles/design-system.css` の #27 ブロック（keyframes `rare-label-glow`/`rare-label-spark`）。
- **#28 GF-AC-280 ページ遷移フェード**＝当初 0.28s ease-out で「パッと出た」印象→**尺 0.5s・timing を `ease-in`（最初ゆっくり→最後速く＝ふわっと）**。`styles/design-system.css` `.page-transition`/`@keyframes page-enter`。制約＝**opacity のみ**（transform/filter は含みブロックを作り fixed オーバーレイの座標を壊す）。
- **#29 GF-AC-290 円環を太く**＝`styles/design-system.css` `.lvring` の見え幅 `padding` **2px→4px**。
- **私宛 reduce 確認（全て CSS/JS 機構で担保 OK）**＝242(#24 deadline-pulse)/251(#25 bar-grow)/262(#26 profile 登場は @media no-preference ゲート)/271(#27 label glow)/281(#28 page-transition)/291(#29 lvring-pulse)/301(#30 medal/is-me/jump)/332(#33 火花/XPフロートは親が reduceMotion() で非生成＋`.spark-burst`/`.xp-float` を display:none)。いずれも各セレクタに `@media prefers-reduced-motion` の停止＋`[data-anim-reduced]` グローバル killswitch。
- **受入台帳更新**＝`doc/テスト/ゲーム感受入.md` の #24〜#33 の状態を ✅ に更新（240/241/250/260/300/330/331＝ユーザー目視／reduce 群＝Claude 担保／261/270/280/290＝Claude 調整＋ユーザー再確認）。#31/#32 は前から ✅。

## 4. 現在の状態（動く / 壊れ / テスト）
- **フロントゲート（本セッション実測）**＝`npx tsc --noEmit` 緑／`npx vitest run` **160 passed**／`npm run build` 成功／`python3 scripts/check_tc_traceability.py` **✅ code 433**。
- **e2e（本セッション・実 docker スタック・実測）**＝新規3件 `G-TC-175/176/177` green（最終ビルド後に再走で 3 passed）／`sc-25-eval` 全 green（F-TC-201/202/203・G-TC-171/172・G-TC-176）／`sc-22-idea-detail` green（D-TC-207・G-TC-177）／`sc-01-dashboard` green（hero balance・G-TC-175）。**他 e2e は本セッション未実行（未確認）**。
- **backend pytest ＝本セッション未実行（未確認）**。前回既知＝513 相当。手順は §8。
- **QA スタック＝全起動中**（`docker compose --profile workers ps`＝backend/db/frontend/mail-worker/mailhog/minio/redis/worker running）。frontend は**最新の全 CSS 変更（261/270/280/290）を焼き込み済み**（本セッションで複数回 `build frontend && up -d frontend`）。※コード変更後は再ビルド必須（§8）。
- **壊れているもの＝把握範囲で無し**。既存不具合だった sc-01/sc-22 の login ヘルパーは是正済み。

## 5. 詰まっている点（試した/失敗と理由＝いずれも解決済み）
- **連続ログインのバースト → 一時ロックアウト**＝red 検証→green 全走を数秒内に多数ログインすると `login` が全滅する（ユーザー認証の試行制限に触れる）。時間をおけば回復。e2e の red/green を続けて回すときは間隔をあける。
- **reduce e2e の red 取り方**＝reduce 機構は既存ゆえ、二方向アサート（no-preference で animated／reduce で suppressed）にし、reduce 分岐を一時 no-preference に差し替えると suppression アサートが落ちる（received が `aura-pulse`/`0.6s`/`0.1s`＝機構が効いている証明）。
- **モックと production のラベル差**（#27）＝モックの `.spell-card__rarity` は badge（pill・bg あり）だが production の `.buy__rarity`/`.item__rarity` は**枠なしプレーンテキスト**。badge 前提の box-shadow/背後ハローは矩形の箱に見える→**text-shadow に統一**して全画面で破綻しないようにした（記憶 `mock-match-impl-layout` の逆＝モック側を production の多様な実体に合わせ直した）。
- **reduce のエミュ**＝`test.use({reducedMotion})` は効かない。各テストで `await page.emulateMedia({reducedMotion:"reduce"})`（または no-preference）を明示。

## 6. 決定事項と根拠（不採用案も）
- **#27 レアの輝き＝「レアの文字自体＋周辺（✦）」**（不採用＝カード枠脈動／文字周りの box-shadow・背後ハロー）。理由＝ユーザー要望（枠は不要・文字周りに四角い箱を出さない）。実装は text-shadow グロー＋✦のみ。
- **#26 称号チップ＝不透明ダーク背景＋白寄りテキスト**（不採用＝透過15%背景）。理由＝暗い背景画像が透けて低コントラスト。
- **#28 遷移フェード＝ease-in・0.5s・opacity のみ**（不採用＝ease-out=パッと出る／linear=均等／transform・filter=座標破壊）。理由＝「最初ゆっくり→最後速く」がふわっと見えるとのユーザー判断。
- **reduce AC は e2e 到達可の3件（#21/#22/#23）を e2e 化・他は CSS/JS 機構確認で確定**。理由＝全アニメは `@media prefers-reduced-motion` 個別停止＋`[data-anim-reduced]` グローバル killswitch の二重で categorically 無効化される機構を各セレクタで確認済み。

## 7. 次にやること（優先順・具体的に）
1. **#34（GF-AC-340〜343）の受入対応**＝ダッシュボードの登場/退場を opacity のみに統一（投票の繰り上がり非チラつき・フォロー解除退場・load 時のみ登場・reduce）。台帳では**未確認**。着手前にコードで裏取り（`handoff-notes-often-stale`）。343=reduce は機構確認、340〜342 はユーザー目視の見込み。
2. **（任意）reduce AC の e2e 拡張**＝#24-#33 の reduce（242/251/262/271/281/291/301/332）は現状 CSS/JS 機構確認のみ。到達可のものを e2e 化するなら次 TC は **G-TC-178〜**（現 e2e 最大 G-TC-177）。md（`doc/テスト/G_ゲーミフィケーション.md`）先行→red-green。
3. **（任意）backend pytest 再確認**＝§8 手順で 513 相当が緑か。
- **共通ゲート**＝`npx tsc --noEmit`＋`npx vitest run`＋**`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。**push は都度確認**。テストは md に TC 行(`根拠`列)→red-green→traceability ✅。backend の response_model 変更後は `cd impl/frontend && npm run codegen`。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `main` 確認**。compose＝`impl/compose.yaml`（cwd=`impl`・Postgres user/pass=`ideaquest`）。
- **QA スタック起動**（記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。frontend=`localhost:3000`／backend=`localhost:8000`（`/healthz`）／MailHog=`localhost:8025`。**コード反映は再ビルド**＝`docker compose build frontend && docker compose up -d frontend`（push だけでは running に反映されない）。
- **ログイン（dev・MFAなし）**＝`/login` company_code=`ACME-01`。主要ユーザー＝`user@acme.example`/`Passw0rd!`（owner・ゲーム層ダッシュボード）。残高 QA 用＝`user2@acme.example`/`Passw0rd!`（コイン1000/SP100）。※`sc-01-dashboard` の hero balance テストのみ OPS（`admin@ops.example`/`Passw0rd!`）。
- **フロントゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（現状 160）／`npm run build`／`npm run codegen`。
- **e2e**（cwd=`impl/frontend`・docker スタック起動中）＝`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test <spec> --workers=1`。**reduce テストは `page.emulateMedia({reducedMotion:"reduce"})`**（§5）。連続ログインのバーストはロックアウトに触れるので red/green を続けて回すときは間隔をあける。ゲーム感の e2e＝`sc-01-dashboard`(G-TC-175)／`sc-25-eval`(G-TC-176)／`sc-22-idea-detail`(G-TC-177)／`sc-18-loading`／`sc-30-32-balance-sync`／`sc-41-ranking`／`sc-02-notifications`／`sc-24-chat`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（現状 ✅ code 433）。走査対象＝`impl/backend/tests/**/*.py` と `impl/frontend/e2e/**/*.spec.ts` のみ（vitest 単体は domain md の TC 行で追跡）。
- **backend テスト**（cwd=`impl`）＝**pytest 前に `docker compose stop worker mail-worker`**（mail_outbox 競合）→ `docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q` → 終わったら `docker compose start worker mail-worker`。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` を `file://` 直開き→`Ctrl+F` で節番号（例「17N」＝レア文字グロー・「13.5」＝全画面ローディング）。
- **設計正本**＝`CLAUDE.md` から各規約/正本を参照。フェーズ運用＝`doc/フェーズ毎ルール/ゲーム感フェーズ.md`。GF-AC 受入台帳＝`doc/テスト/ゲーム感受入.md`。ゲーム感の TC 一覧＝`doc/テスト/G_ゲーミフィケーション.md`（§5-T/U/V＝G-TC-175/176/177）。
- **記憶**（要確認）＝`game-feel-async-pipeline`(push都度確認)／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`mock-match-impl-layout`／`animation-reduce-motion-standard`(reduce は私が担保)／`framer-reducemotion-null-flip`／`mount-effect-fires-during-loading`／`frontend-build-gate-eslint`／`handoff-notes-often-stale`(未確認は着手前にコードで裏取り)／`spec-is-source-of-truth`／`design-spec-working-style`／`document-design-rationale`.
