# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-08（このセッション途中）**。
- 作業ブランチ＝**`main`**（`origin/main` と同期）。feature/game-feel は廃止済み・main で作業。
- 最新コミット＝**`8986f86`**（SC-41 ランキング表示修正）。本セッションのコミット＝`72c26ba`/`41b9fa9`/`d957bc6`（#12 演出・**push 済み**）＋`a81ea3e`（ダッシュボード週間ランキングのアバター imageUrl 修正）＋`8986f86`（ランキング表彰台の累積＋自分の行の白潰れ修正）。**`a81ea3e`・`8986f86` の 2 コミットは未 push**（`origin/main` より ahead 2・都度確認）。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝main へ増分ごと commit・**push は都度ユーザー確認**。QA は §1.1 参照（機能＝私がテスト＋実起動確認／見た目＝ユーザー目視）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝正本 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`。GF-AC 台帳＝`doc/テスト/ゲーム感受入.md`。

## 2.1 検証分担の重要ルール（今回確立・必読）
- **`doc/フェーズ毎ルール/ゲーム感フェーズ.md §1.1`（2026-09-07 追加）**＝**演出の見た目/気持ちよさ＝ユーザーが目視**／**機能の正しさ（データ整合・複数表示の一致・reduce-motion 等）＝私がテスト規約どおり TC 先行→実装→red-green＋実アプリ起動で確認してから渡す**。機能不具合を GF-AC のユーザー目視に委ねない。
- **reduce-motion（「視差効果を減らす」）はユーザーの目視チェック項目から外す**（同 §1.1・記憶 `animation-reduce-motion-standard`）。単一 seam（`lib/motion.ts` `reduceMotion()`＝OS OR `accounts.reduce_motion`／CSS `[data-anim-reduced]`）＋各演出のゲート純関数のユニットテストで私が担保。
- **`doc/規約/フロントエンド実装フロー規約.md §2.2`（今回追加）**＝実装済み画面の演出をモックで検討する時は、**モックの土台を実装レイアウト（構造/クラス/アイコン寸法/座標系）に一致**させる（記憶 `mock-match-impl-layout`）。DoD モック一致の逆向き保証。

## 3. 今回やったこと（変更ファイルと理由）

### A. #11 魔法解放の共通「習得」演出＝受入完了（GF-AC-110/111/112 ✅ OK）
- 演出＝全魔法共通（属性非依存）＝**説明パネル（カード）暗転→❓がパネル中央へ移動→床の魔法陣→円周の金の実線を一筆書き→光の円柱に包まれた❓がぐらぐら揺れ→溜め→解放でアイコン開封→取得アイコンが元位置（ヘッダー）へ戻りパネル明転→「✓ 解放済み」**。未習得カードのアイコンは **❓**、習得後は本来のアイコン。
- モック＝`doc/画面設計/mocks/style-guide.html §17L-i`。**production の spell-card と一致する土台**に作り直し済み（規約 §2.2）＝ `.card.spell-card`・アイコン26px・spells.css 相当を写す。ギャラリー（seed 20個生成→選択）で魔法陣を選定、採用 seed 10個は `LEARN_SEEDS`。
- production 移植＝純ロジック `impl/frontend/src/features/spells/learnFx.ts`（`mulberry32`/`genPath`/`LEARN_SEEDS`/`pickLearnSeed`/`planLearn`）＋テスト `learnFx.test.ts`（**G-TC-162**・md 先行→red-green）。canvas 本体＝`impl/frontend/src/components/ui/SpellLearnFx.tsx`（move-in→ritual→move-out の3段＝`draw()`・内部3800ms/`DUR=5200`）。画面＝`features/spells/components/SpellsView.tsx`（未習得❓・解放で `SpellLearnFx` を出す `startLearn`）。
- **SP バグ修正2件（GF-AC-111）**＝(1) SP 減算を演出の「開封」に同期（`SpellLearnFx` の `onReveal`＝rt=2050 で発火→`SpellsView` が `setSp`。それまで `load({keepSp:true})` で据え置き）。(2) **ヘッダー右上の SP チップが更新されない**問題＝ヘッダーはサーバー `app/(app)/layout.tsx` の `getServerMe()` 由来なので、`SpellsView` の `unlock()` で `router.refresh()` を onReveal 時に呼ぶよう修正＋`AppHeader.tsx` の SP を `CountUp` 化（コイン GF-AC-061 と同様）。

### B. 検証分担の回帰ガード e2e（今回の再発防止）
- `impl/frontend/e2e/sc-30-32-balance-sync.spec.ts`（**G-TC-163/164**）＝**解放(SP)・購入(コイン)後にヒーローとヘッダー右上の両方が同期して減る**ことを実ブラウザ検証。台帳＝`doc/テスト/G_ゲーミフィケーション.md §5-M`。テスト用 `user2@acme.example` を DB で baseline（SP100/コイン1000・未所有・台帳クリア）にリセットして実行し後始末で再リセット（docker QA 前提）。**実スタックで 2 passed 確認済み**。

### C. #12 ショップ購入の演出＝モック §17M 受入 OK → production 移植完了 → GF-AC-120/121/122 受入 OK（本セッション・コミット `72c26ba`/`41b9fa9`）
- **モック `style-guide.html §17M` をユーザー受入 OK（2026-09-08）**。最終フロー＝**①支払い**＝右上（財布）から ◆ コインが**価格の位置へ降りて吸い込まれ**、価格が **price→0** と減る／**②支払い完了後**＝コイン数を**サムネ左上のバッジ**（枠にまたがる小バッジ）へ移し、価格行を「**✓ 所有済み**」・フットを「▶ きせかえで装備」に（**購入前後でパネル高さ不変**＝所有後フット高は購入前フット実測にコピー・行数を揃える）／金地＋金枠グロー・サムネ金縁・右上コーナーリボン「所有済み」（`z-index:3` で前面）・光沢スイープ／**紙吹雪＋金地ピル「〈名〉を手に入れた」**（祝福＋お礼）。中央大アイコンは廃止。
- **production 移植（受入後）**＝純ロジック `impl/frontend/src/features/shop/shopFx.ts`（`PAY_MS`/`PAY_STEPS`/`payValues`/`planBuyFx`）＋テスト `shopFx.test.ts`（**G-TC-165**・md 先行→red-green）。演出コンポーネント `features/shop/components/ItemGetFx.tsx`＝**`ShopPayFx`**（価格矩形に重ね price→0＋コイン落下・`onDone`）／**`ItemCelebrateFx`**（紙吹雪＋「〈名〉を手に入れた」）。画面 `features/shop/components/ShopView.tsx`＝`buy()`（reduce/リスト表示は即所有・それ以外は `setPay`→`ShopPayFx`）＋`handlePayDone`（0到達で `setCoins`/owned反映/`setRevealId`/celebrate/snack/`router.refresh`）＋`cardRaw`（owned は `.buy__coin`バッジ・`.buy__price.is-owned-status`「✓所有済み」・`.buy__ribbon`・`is-owned`/`reveal`/`is-paying` クラス）。CSS `features/shop/shop.css`（`.buy__coin`/`.buy.is-owned`/`.buy__ribbon`/`.reveal` 入場アニメ/`.item-get__rain`/`__pay`/`__confetti`/`__thanks`・旧 `__icon`/`__ring`/`__cost`/`__flash` は削除）。
- **検証分担（§1.1）**＝reduce は `planBuyFx`（G-TC-165）＋CSS `prefers-reduced-motion` で私が担保／残高同期は e2e G-TC-164（**要再実行＝購入フローのタイミングを変更＝支払い後に残高反映・約1.2秒**／8s poll のため通る見込みだが実測要）／**見た目/気持ちよさ＝GF-AC-120 ユーザー目視（実アプリ）**。

### D. 台帳・規約・記憶の更新
- 台帳 `doc/テスト/ゲーム感受入.md`＝GF-AC-110/111/112 を ✅ OK（2026-09-07）。
- 規約＝フロントエンド実装フロー規約 §2.2／ゲーム感フェーズ §1.1（上記 §2.1）。
- 記憶（`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/`）＝新規 `mock-match-impl-layout`・`spell-unlock-dev-reset`／更新 `animation-reduce-motion-standard`。

### F. #13 ランキング＝実装済み確認＋表示不具合3件を修正（本セッション・未 push `a81ea3e`/`8986f86`）
- **#13 演出は既に実装済み**＝`ranking.css`（表彰台せり上がり `rank-podium-rise`・メダルきらめき `rank-medal-shine`・myrank グロー `rank-myrank-in`・自分の行 `rank-me-row`・`jumpToMe`・`CountUp`）／reduce は OS `@media`＋グローバル `[data-anim-reduced]` キルスイッチ（design-system.css §4.9）で両対応。機能は担保済み・残りは GF-AC-130/131/132 の見た目目視。
- **修正1（`a81ea3e`）**＝ダッシュボード週間ランキングの `<Avatar>` が `imageUrl` 未指定で生成デフォルトにフォールバック→設定画像が出なかった。`DashboardView.tsx` で `imageUrl={r.user.avatar}` 追加（backend は返している）。
- **修正2（`8986f86`）**＝`/ranking` の(1)期間タブ切替で表彰台 `.podium` が累積（`podium`/`rank-list` 兄弟の `key={period}` 重複で reconciliation 破綻→`RankingView.tsx` で `podium-`/`list-` に一意化）(2)自分の行の `rank-me-row` 終了色が明色 `#EFF6FF` で暗パネル上の名前が白潰れ→`design-system.css` で半透明シアンへ。回帰 e2e＝G-TC-167/168（`sc-41-ranking.spec.ts`）。同 spec の login ヘルパが実在しない「ようこそ」待ちで赤だった（G-TC-206）のも URL＋`.app-header` 判定に修正。
- **診断手法メモ**＝Playwright で `page.evaluate` して `.podium` 要素数を数え、タブ切替で 1→2→3 と累積するのを確認（一時 spec は削除済み）。

### E. dev データ（QA 準備・コード変更ではない）
- `user2@acme.example`＝**SP100 / コイン1000 / 解放0 / 所有0**（e2e teardown 後の baseline・全カード ❓）。#11/#12 の受入・魔法習得アニメ確認はこのユーザーで行う。
- `user@acme.example`＝**このセッションでは未変更**（旧 handoff では6種解放済み＝未習得カードが無い）。習得アニメ（❓→開封）を見るなら user2 を使う。

## 4. 現在の状態（動く / 壊れ / テスト）
- **フロントゲート（本セッション実測）**＝`npx tsc --noEmit` 緑／`npx vitest run` **160 passed**／`npm run build` 成功／`python3 scripts/check_tc_traceability.py` **✅ code 424**（#12 の G-TC-166・#13 の G-TC-167/168 追加後）。
- **e2e（本セッション実測・実 docker スタック）**＝`sc-30-32-balance-sync` 3 passed（G-TC-163/164/166）／`sc-41-ranking` 3 passed（G-TC-206/167/168）。他 e2e は未実行。
- **e2e＝`sc-30-32-balance-sync`（G-TC-163/164/166）3 passed**（本セッション・実 docker スタック・#12 移植後）。164＝購入で両残高同期（タイミング変更後も実測 OK＝GF-AC-121）／**166＝reduce で `.item-get` 演出なし・残高即反映・即所有（GF-AC-122）**。実ブラウザで購入がフルアニメ経路（`ShopPayFx`→`handlePayDone`）を例外なく完走。traceability ✅ code **422**。
- **backend pytest ＝本セッション未実行（未確認）**。前回既知＝513 passed 相当。必要なら §8。
- **QA スタック＝全起動中**（`cd impl && docker compose --profile workers up -d --build` 済み・frontend:3000＝`/login`200／backend:8000＝`/healthz`200・#12 移植コードで再ビルド済み＝running=最新）。
- **壊れているもの＝把握範囲で無し**（ゲート緑＋e2e 6 passed）。**#12 は GF-AC-120/121/122 すべて ✅ OK（2026-09-08）**＝受入完了。#13 は演出実装済み＋表示不具合3件修正済み（§3-F）＝残りは GF-AC-130/131/132 の見た目目視。e2e teardown で user2 は baseline（coin1000・未所有）に戻り済み。

## 5. 詰まっている点（試した/失敗と理由＝いずれも解決済み）
- **GF-AC-111「SP が動かない」**＝2段階の原因。(1) 演出開始の一瞬に SP を変えていて 5.2 秒の演出中に見逃されていた→開封に同期（onReveal）。(2) ヘッダー SP はサーバー `/me` 由来で `router.refresh()` していなかった→ヒーローだけ更新・ヘッダー据え置き。**両方修正済み（§3-A）**。教訓＝残高チップは2箇所（ヒーロー＋ヘッダー）・ヘッダーはサーバー再取得が要る→e2e G-TC-163/164 でガード。
- **dev リセットで SP が引かれない**＝`user_spells` だけ削除して **SP消費台帳（`activities` の `sp_spend/spell_unlock`）を残す**と、backend の自己修復ガード（`unlock_spell`＝`grant_exists_by_ref`）が「課金済み」と判定し SP を引かない。**正しいリセットは台帳も削除**（記憶 `spell-unlock-dev-reset`・§8 参照）。ショップ購入は自己修復ガード無し。

## 6. 決定事項と根拠（不採用案も）
- **検証分担＝機能はテストで私が担保／見た目はユーザー目視**（§2.1・ユーザー決定 2026-09-07）。不採用＝「一次QA を全部ユーザー」（機能不具合まで押し付け手戻り）。
- **reduce-motion はユーザーの目視から外す**（§2.1）＝単一 seam＋ユニットゲートで私が担保。
- **実装→モックはモックの土台を実装に一致**（規約 §2.2）＝以前 §17L-i のモックが icon44px/独自レイアウトで、移植後にズレた反省。
- **#12 所有済みデザイン＝金地＋コーナーリボン＋光沢スイープで遷移**（提案・レビュー中）。不採用検討＝サムネ中央の✓スタンプ（アイコンを覆うので不採用）。リボン＋金枠で所有を明示。

## 7. 次にやること（優先順・具体的に）
1. **push 状態の確認**＝本セッションの 3 コミット（`72c26ba`/`41b9fa9`／本 handoff）は **push 済み**（ユーザー承認のうえ 2026-09-08 に main へ push）。`git status` が clean・`origin/main` と同期していることを再開時に確認。
2. **積み残しの GF-AC バックログ**＝#13 ランキング(130..133)／#14 アバター装備(140..)／…ほぼ「未確認」。ID 順に、**機能は先に私がテスト＋実起動確認**してから見た目をユーザーへ。
3. **backend pytest の再確認**（任意）＝§8 手順で 513 相当が緑か。
- **共通ゲート**＝`npx tsc --noEmit`＋`npx vitest run`＋**`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。**push は都度確認**。テストは md に TC 行(`根拠`列)→red-green→traceability ✅。backend の response_model 変更後は `cd impl/frontend && npm run codegen`。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `main` 確認**。compose＝`impl/compose.yaml`（cwd=`impl`・Postgres user/pass=`ideaquest`）。
- **QA スタック起動**（記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。frontend=`localhost:3000`（本番ビルド焼込み）／backend=`localhost:8000`（`/healthz`）／MailHog=`localhost:8025`。**コード反映は再ビルド**＝`docker compose build frontend backend && docker compose up -d frontend backend`（push だけでは running に反映されない）。
- **ログイン（dev・MFAなし）**＝`/login` company_code=`ACME-01`。習得/購入 QA は login_id=`user2@acme.example`／password=`Passw0rd!`（未習得・SP100・コイン1000）。魔法解放=`/spells`（SC-32）／ショップ=`/shop`（SC-30）。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` を `file://` 直開き→`Ctrl+F`「17L-i」（魔法解放・受入済）／「17M」（ショップ購入・レビュー中）。
- **フロントゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（現状 157）／`npm run build`／`npm run codegen`。
- **e2e**（cwd=`impl/frontend`・docker スタック起動中）＝`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test <spec> --workers=1`。残高同期＝`sc-30-32-balance-sync`（teardown で user2 を baseline に戻す）。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（現状 ✅ code 421）。走査対象＝`impl/backend/tests/**/*.py` と `impl/frontend/e2e/**/*.spec.ts` のみ＝frontend の vitest 単体（`src/**/*.test.ts`）は対象外＝domain md の TC 行で追跡。
- **backend テスト**（cwd=`impl`）＝**pytest 前に `docker compose stop worker mail-worker`**（mail_outbox 競合）→ `docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q` → 終わったら `docker compose start worker mail-worker`。
- **DB 直接確認/操作（会社DB）**＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "<SQL>"`。魔法解放を dev リセット（記憶 `spell-unlock-dev-reset`）＝`activities`（kind=`sp_spend` reason=`spell_unlock` ／購入は `coin_spend`/`shop_purchase`）と `user_spells`/`user_items` を削除し `users.skill_point_balance`/`coin_balance` を明示 UPDATE（台帳を残すと自己修復ガードで課金されない）。
- **production の要所**（`impl/frontend/src`）＝魔法解放＝`features/spells/learnFx.ts`＋`learnFx.test.ts`（G-TC-162）／`components/ui/SpellLearnFx.tsx`（`draw()`＝move-in/ritual/move-out・`onReveal`）／`features/spells/components/SpellsView.tsx`（`unlock`/`startLearn`/`load({keepSp})`）。ヘッダー残高＝`components/layout/AppHeader.tsx`（SP/コインは `CountUp`）＋`app/(app)/layout.tsx`（`getServerMe`）＝**残高変化後は `router.refresh()` でヘッダー再取得**。ショップ＝`features/shop/components/ShopView.tsx`（`buy`/`cardRaw`）／`components/ui`… ではなく `features/shop/components/ItemGetFx.tsx`／`features/shop/shop.css`。魔法発動（チャット）＝`features/spells/engines/*`・`useSpellEngine.ts`・`components/ui/SpellCanvasFx.tsx`。
- **設計正本**＝`CLAUDE.md` から各規約/正本を参照。フェーズ運用＝`doc/フェーズ毎ルール/ゲーム感フェーズ.md`（§1.1 検証分担）。GF-AC 台帳＝`doc/テスト/ゲーム感受入.md`。魔法解放画面=`doc/画面設計/screens/SC-32_*.md`／ショップ=SC-30。
- **記憶**（要確認）＝`game-feel-async-pipeline`(push都度確認)／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`mock-match-impl-layout`(実装→モックの土台一致)／`spell-unlock-dev-reset`(dev リセットは台帳も消す)／`animation-reduce-motion-standard`(reduce はユーザー目視外)／`frontend-build-gate-eslint`／`handoff-notes-often-stale`(未確認は着手前にコードで裏取り)／`spec-is-source-of-truth`／`design-spec-working-style`。
