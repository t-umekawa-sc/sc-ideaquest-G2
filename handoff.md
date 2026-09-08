# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-08（このセッション末）**。
- 作業ブランチ＝**`main`**（`origin/main` と**同期・作業ツリー clean**）。feature/game-feel は廃止済み・main で作業。
- 最新コミット＝**`f405f54`** `docs(handoff): #17 チャットの手触り＝受入完了`。本 handoff 更新を次コミットで push する。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝main へ増分ごと commit・**push は都度ユーザー確認**（本セッションは毎回確認のうえ push 済み）。QA 分担は §6 参照（機能＝私がテストで担保／見た目＝ユーザー目視）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝正本 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`（§1.1 検証分担）。GF-AC 受入台帳＝`doc/テスト/ゲーム感受入.md`。

## 3. 今回やったこと（変更ファイルと理由）

### A. #12 ショップ購入の演出＝モック §17M 受入 → production 移植（受入完了）
- モック `doc/画面設計/mocks/style-guide.html §17M` をユーザーと反復して受入。最終フロー＝**右上（財布）からコインが価格へ降りて吸い込まれ price→0**→**コインをサムネ左上バッジへ移し価格行「✓所有済み」・きせかえフット・金地/リボン/光沢**→**紙吹雪＋「〈名〉を手に入れた」**（購入前後でパネル高さ不変）。
- production 移植＝純ロジック `impl/frontend/src/features/shop/shopFx.ts`（`PAY_MS`/`PAY_STEPS`/`payValues`/`planBuyFx`）＋`shopFx.test.ts`（**G-TC-165** md 先行→red-green）／演出コンポーネント `features/shop/components/ItemGetFx.tsx`（`ShopPayFx`＝価格矩形に重ね price→0＋コイン落下／`ItemCelebrateFx`＝紙吹雪＋入手）／画面 `features/shop/components/ShopView.tsx`（`buy`→`ShopPayFx`→`handlePayDone`＝残高/所有反映・祝福お礼・`router.refresh`／`cardRaw`＝`.buy__coin`バッジ・`.buy__price.is-owned-status`・`.buy__ribbon`・`is-owned`/`reveal`/`is-paying`）／CSS `features/shop/shop.css`。受入＝GF-AC-120/121/122 ✅。

### B. #13 週間ランキングの演出＝既実装の確認＋表示不具合3件修正＋演出追加（受入完了）
- #13 演出は既に実装済み（`features/ranking/ranking.css`＝表彰台せり上がり `rank-podium-rise`・メダル `rank-medal-shine`・myrank グロー・自分の行 `rank-me-row`・`CountUp`）。
- **表示不具合3件を修正**＝(1) ダッシュボード週間ランキングの `<Avatar>` が `imageUrl` 未指定で設定画像が出なかった→`features/dashboard/components/DashboardView.tsx` の `cardRaw` 相当に `imageUrl={r.user.avatar}` 追加（`a81ea3e`）。(2) `/ranking` の期間タブ切替で表彰台 `.podium` が累積（`podium` と `rank-list` が兄弟で同じ `key={period}`＝**兄弟間キー重複**で reconciliation 破綻）→`RankingView.tsx` で `key` を `podium-`/`list-` に一意化（`8986f86`）。(3) 自分の行の登場ハイライト `rank-me-row` の終了色が明色不透明 `#EFF6FF`（`--color-primary-soft`）で暗パネル上の名前が白潰れ→`styles/design-system.css` の keyframe を半透明シアン `rgba(34,211,238,.14)` に。
- **演出調整（ユーザー要望）**＝表彰台せり上がりを 0.5s→0.9s・上昇量18→44px に減速／**自分のアバターが一定間隔でジャンプ**（`rank-me-jump`・keyframe は `design-system.css` で共用）を `/ranking`（myrank/自分の行/表彰台の自分）と**ダッシュのミニ週間ランキング**（`dashboard.css` の `.dash-page .rank-panel .rank-list li.is-me .avatar`）に適用（`306746c`）。
- 回帰 e2e＝**G-TC-167**（表彰台が累積しない）／**G-TC-168**（自分の行が near-white で終わらない）／**G-TC-169**（reduce で全演出 `animationName:none`）＝`e2e/sc-41-ranking.spec.ts`。受入＝GF-AC-130/131/132/133 ✅。

### C. ダッシュの「最近の通知」を realtime 追随（設計変更・ユーザー承認）
- ヘッダーのベル（`features/notifications/LiveAppHeader.tsx`＝未読数 live＋新着 pop）だけが realtime で、ダッシュの「最近の通知」は初回スナップショットのままで不整合だった。ユーザー判断「A（繋ぐ）」で `DashboardView.tsx` に `realtime.on("notification.created")` 購読を追加し `GET /dashboard` 再取得（`data` のみ差し替え＝`unvotedList` は触らず GF-AC-043 維持）。設計メモを `doc/画面設計/screens/SC-01_ダッシュボード.md §4.8` に追記（`ef370f8`）。**実機ライブ検証済み**＝redis に `notifications:{user@acme uid}` へ `notification.created` を publish → `/dashboard` 再取得（リクエスト 1→2）。

### D. #15 通知の新着 pop（受入完了）／#16 クエスト選定の祝福（受入完了）／#17 チャットの手触り（受入完了）
- いずれも**既に実装済み**（`handoff-notes-often-stale` どおり台帳「未確認」でも実装が進んでいた）。私は reduce を e2e で担保、見た目はユーザー目視。
- **#15**（ベル pop・`design-system.css` の `.bell[data-arrived]`）＝**G-TC-170**（reduce で pop/wiggle が `animationName:none`・`e2e/sc-02-notifications.spec.ts`）。GF-AC-150/151/152 ✅。
- **#16**（選定祝福・`features/ideas/components/IdeaDetailView.tsx` の `.select-celebrate`＝`awarded && !reduceMotion()` で発火・解除/再選定では出さない）＝**G-TC-171**（祝福が出る/クリックで閉じ/解除で出ない）／**G-TC-172**（reduce で `.select-celebrate` count 0）＝`e2e/sc-25-eval.spec.ts`。GF-AC-160/161/162 ✅。**選定は XP のみ付与**（`_XP_SELECTION=200`／コインはクエスト確定時に別途）なのに台帳/テストが「コイン・XP」と古かったのを「XP」に修正。
- **#17**（チャット・`features/chat/chat.css` の `.msg-row`=`msg-enter`／`.reaction`=`reaction-pop`・`key=id` で新着のみ）＝**G-TC-173**（reduce で `.msg-row`/`.reaction` の `animationName:none`）＝`e2e/sc-24-chat.spec.ts`。GF-AC-170/171/172 ✅。

### E. #14 アバター装備の演出＝仮OK（暫定）
- `features/avatar` の装備演出は実装済みだが、**肝心の 3D アバターがまだモック状態**（本実装待ち）＝ユーザー判断で **仮OK**。台帳 #14（GF-AC-140/141/142）に「仮OK（3Dアバター未実装のため暫定）」と明記。3D 実装後に演出の載せ替え/再受入が必要。

### F. e2e login ヘルパの共通不具合を修正
- 複数 spec の login ヘルパが実在しない「ようこそ」表示を待って赤だった（`greeting.ts` は時間帯で おはよう/こんにちは/こんばんは＝「ようこそ」無し）。**`sc-41-ranking`/`sc-02-notifications`/`sc-25-eval`/`sc-24-chat` を URL 遷移＋`.app-header` 可視判定に修正**（既存 F-TC-201/202/203・E-TC-201/202/203・H-TC-208・G-TC-206 も復活）。**他 spec（sc-01 等）にも残存の可能性**＝赤ければ同修正。

## 4. 現在の状態（動く / 壊れ / テスト）
- **フロントゲート（本セッション実測）**＝`npx tsc --noEmit` 緑／`npx vitest run` **160 passed**／`npm run build` 成功／`python3 scripts/check_tc_traceability.py` **✅ code 429**。
- **e2e（本セッション・実 docker スタック・実測）**＝`sc-30-32-balance-sync` 3 passed（G-TC-163/164/166）／`sc-41-ranking` 4 passed（G-TC-206/167/168/169）／`sc-02-notifications` 2 passed（H-TC-208/170）／`sc-25-eval` 3 passed（F-TC-203/G-TC-171/172、F-TC-201/202 は login 修正のみで未再走）／`sc-24-chat` 4 passed（E-TC-201/202/203/G-TC-173）。**他 e2e は本セッション未実行（未確認）**。
- **backend pytest ＝本セッション未実行（未確認）**。前回既知＝513 passed 相当。手順は §8。
- **QA スタック＝全起動中**（frontend:3000＝`/login`200／backend:8000＝`/healthz`200）。frontend は #13（自分アバターのジャンプ）＋ダッシュ realtime（`ef370f8`）まで再ビルド済み。**`ef370f8` 以降のフロント“アプリコード”変更は無い**（#14〜#17 は既実装の確認＋e2e/doc のみ・ダッシュ realtime が最後のアプリコード変更）ので **running=最新**。
- **壊れているもの＝把握範囲で無し**（ゲート緑＋主要 e2e 緑）。

## 5. 詰まっている点（試した/失敗と理由＝いずれも解決済み）
- **reduce の e2e エミュレーション**＝`test.use({ reducedMotion: "reduce" })` は本プロジェクトの Playwright 設定では**効かなかった**（`matchMedia("(prefers-reduced-motion: reduce)")` が false のまま）。**`await page.emulateMedia({ reducedMotion: "reduce" })`** を各 reduce テスト先頭で明示すれば true になる（G-TC-169/170/172/173 はこの方式）。※`sc-30-32` の G-TC-166 は `test.use` 版のままだが緑（要注意・将来赤なら emulateMedia へ）。
- **チャット e2e の composer fill が 30s timeout**＝入力欄が既定で最小化（`IdeaChatView.tsx` の `composerMin=useState(true)`・スリムバー `.composer__mini`）＝textarea `.composer__box` は DOM にあるが `is-collapsed` で非表示。**投稿前にスリムバーを click して展開**（ヘルパ `openComposer`＝box が見えていれば return／でなければ `.composer__mini` を click〔auto-wait〕）で解決。送信では再最小化しない（`setComposerMin(true)` は「⌄ 最小化」ボタンのみ）。
- **表彰台が縦に累積**＝原因は兄弟間キー重複（§3-B(2)）。DOM 数を Playwright `page.evaluate` で数えて 1→2→3 と増えるのを実測して特定。

## 6. 決定事項と根拠（不採用案も）
- **検証分担（ゲーム感フェーズ §1.1）**＝機能（reduce・残高/表示同期・構造）は私が TC 先行→red-green＋実機/e2e で担保／見た目・気持ちよさはユーザー目視。不採用＝「一次QA を全部ユーザー」（機能不具合まで押し付け手戻り）。
- **ダッシュの最近の通知を realtime 追随＝繋ぐ（案A）**（§3-C・2026-09-08）。不採用＝案B「ダッシュ＝ロード時スナップショットで統一・現状維持」。理由＝配管（realtime）が既存でベルとの体感不整合を安く解消できる。他のダッシュ集約パネル（下書き/未投票/フォロー中/クエスト/週間ランキング）はスナップショット維持＝本パネルのみ通知に追随。
- **#14 は仮OK**＝3D アバター未実装のため本受入は保留（§3-E）。
- **spec-is-source-of-truth**＝選定は XP のみ付与が正（backend `evaluations/application.py` `select_idea`＝`_XP_SELECTION=200` のみ・コインは `_finalize_idea_coin`）→台帳/テストの「コイン・XP」を修正。

## 7. 次にやること（優先順・具体的に）
1. **#18 取得中のゲーム化（ローディング表示）に着手**＝受入台帳 `doc/テスト/ゲーム感受入.md` の「## 増分 #18」を読む（GF-AC-18x）。**まず実装済みか裏取り**（#13/#15/#16/#17 と同様に既実装の可能性・記憶 `handoff-notes-often-stale`）＝ローディング/スケルトン系のコンポーネント（`components/ui` の `Spinner` 等・各 feature の skeleton）と CSS を grep。機能（reduce＝アニメ無効で即表示）は私が e2e で担保（**`page.emulateMedia({reducedMotion:"reduce"})`** で `animationName:none` 等）／見た目はユーザー目視。TC は空き番号（現在 e2e 最大 **G-TC-173**・次は **G-TC-174**〜）で md 先行→登録。
2. **積み残しの GF-AC バックログ**＝#18／#19 以降（`ゲーム感受入.md` に一覧）。ID 順に、機能は先に私がテスト＋実起動確認してから見た目をユーザーへ。
3. **（任意）他 e2e の login「ようこそ」残存チェック**＝`grep -rn 'ようこそ' impl/frontend/e2e` で残る spec を URL＋`.app-header` 判定へ統一（§3-F）。
4. **（任意）backend pytest 再確認**＝§8 手順で 513 相当が緑か。
- **共通ゲート**＝`npx tsc --noEmit`＋`npx vitest run`＋**`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。**push は都度確認**。テストは md に TC 行(`根拠`列)→red-green→traceability ✅。backend の response_model 変更後は `cd impl/frontend && npm run codegen`。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `main` 確認**。compose＝`impl/compose.yaml`（cwd=`impl`・Postgres user/pass=`ideaquest`）。
- **QA スタック起動**（記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。frontend=`localhost:3000`（本番ビルド焼込み）／backend=`localhost:8000`（`/healthz`）／MailHog=`localhost:8025`。**コード反映は再ビルド**＝`docker compose build frontend && docker compose up -d frontend`（push だけでは running に反映されない）。※**デモ等でスタックを触るなと言われたら再ビルド/再起動＋localhost への e2e 実行を止める**。
- **ログイン（dev・MFAなし）**＝`/login` company_code=`ACME-01`。主要ユーザー＝`user@acme.example`/`Passw0rd!`（owner 権限・クエスト/アイデア多数）。ショップ/魔法の残高 QA 用＝`user2@acme.example`/`Passw0rd!`（コイン1000/SP100・`sc-30-32` の teardown で baseline に戻す）。
- **フロントゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（現状 160）／`npm run build`／`npm run codegen`。
- **e2e**（cwd=`impl/frontend`・docker スタック起動中）＝`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test <spec> --workers=1`。**reduce テストは `page.emulateMedia({reducedMotion:"reduce"})` を使う**（§5）。ゲーム感の e2e＝`sc-30-32-balance-sync`／`sc-41-ranking`／`sc-02-notifications`／`sc-25-eval`／`sc-24-chat`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（現状 ✅ code 429）。走査対象＝`impl/backend/tests/**/*.py` と `impl/frontend/e2e/**/*.spec.ts` のみ＝frontend の vitest 単体（`src/**/*.test.ts`）は対象外＝domain md の TC 行で追跡（例 G-TC-165）。
- **backend テスト**（cwd=`impl`）＝**pytest 前に `docker compose stop worker mail-worker`**（mail_outbox 競合）→ `docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q` → 終わったら `docker compose start worker mail-worker`。
- **DB 直接確認（会社DB）**＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "<SQL>"`。会社メタ（company_id 等）は**別DB `ideaquest_control`** の `companies`（`company_code`）＝ACME-01 の id は `d8926d2a-82f1-4164-935b-0fee56e8953b`／user@acme の user_id は `d1496aa9-eac8-40db-b08b-a29eca26cd03`。DBは `ideaquest_control`/`ideaquest_ops`/`ideaquest_company_acme`/`ideaquest_company_acme2`。
- **realtime 手動発火**（診断用）＝`docker compose exec -T redis redis-cli PUBLISH "notifications:{user_id}" '{"topic":"notifications:{user_id}","type":"notification.created","data":{},"id":"x","company_id":"{company_id}"}'`（ハブが company_id でフィルタ＝正しい会社 id が必要・§3-C で使用）。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` を `file://` 直開き→`Ctrl+F` で節番号（例「17M」＝ショップ購入）。
- **設計正本**＝`CLAUDE.md` から各規約/正本を参照。フェーズ運用＝`doc/フェーズ毎ルール/ゲーム感フェーズ.md`（§1.1 検証分担）。GF-AC 受入台帳＝`doc/テスト/ゲーム感受入.md`。ゲーム感の TC 一覧＝`doc/テスト/G_ゲーミフィケーション.md`（§5-N〜5-R が本セッション追加）。
- **記憶**（要確認）＝`game-feel-async-pipeline`(push都度確認)／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`mock-match-impl-layout`／`animation-reduce-motion-standard`(reduce はユーザー目視外・私が担保)／`framer-reducemotion-null-flip`／`frontend-build-gate-eslint`／`handoff-notes-often-stale`(未確認は着手前にコードで裏取り＝実際 #13〜#17 は既実装だった)／`spec-is-source-of-truth`／`design-spec-working-style`(選択肢提示より本人イメージから仕様起こし)／`document-design-rationale`(なぜも併記)。
