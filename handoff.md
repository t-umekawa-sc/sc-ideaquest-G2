# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-05 JST**（このセッション末）。
- 作業ブランチ＝**`feature/game-feel`**（`origin/feature/game-feel` と同期・作業ツリー clean）。**`main` ではない・未マージ**。
- 最新コミット＝**`9fcdbd9`** `feat(mock): キラキラライト版=着弾直後にUFOを1回即時起動(以降は通常頻度) GF-AC-091`。
- **本セッションのコミットは `7834030`〜`9fcdbd9` の 15 本。全て `doc/画面設計/mocks/style-guide.html` のみ変更（production は一切触っていない＝§4参照）。**
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごと commit+push 自走（standing 承認）／`main` は受入後にユーザー承認でマージ。
- **重要ルール（記憶 `game-feel-mock-first-then-port`）＝演出は「まず `doc/画面設計/mocks/style-guide.html`（モック）だけ」に反映し受入後に production 移植。即 production 移植しない。**

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝チャット（SC-24）の魔法発動演出をブラウザ受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）しながらモックで反復中。

## 3. 今回やったこと（変更ファイルと理由）
> 変更は **`doc/画面設計/mocks/style-guide.html` の 1 ファイルのみ**。対象は**「演出のライト版」＝§17L**（明色パネル向け＝production 実態の吹き出しに合わせた別バージョン。ダーク版 §17b〜h とは別物）。ライト版は現状**雷=§17L-d／氷=§17L-e／キラキラ=§17L-h の 3 種のみ実装**（炎/虹/オーラのライト版は未着手＝§7）。今回いじったのは **§17L-e（氷）と §17L-h（キラキラ）**。前セッションからの続きで、ユーザーのブラウザ目視フィードバックを一つずつ反映した。

### 氷ライト版 §17L-e（`createIceSpellLight`・stage id=`pixfrostLStage`・canvas+rAF エンジン）
- **氷柱を「戻る」→「パリンと割れる」に**（`7834030`）＝pillar の phase を `grow→hold→shatter` に変更（旧 `shrink`＝縮んで戻るを撤廃）。`spawnShatter(p)` を新設＝稜線に沿って角ばった氷片 `frags` を外へ飛散＋粉雪＋冷気粒。`drawFrags()` を新設。frags は update ループで重力＋フェード。`frags` は state 変数・`reset()` にも追加。
- **氷の塊をもっと大きく**（`7834030`/`4c451d7`）＝`buildFrost` のセル数を `PW*PH/600`→`/1050` に削減。
- **ピカッをランダム連鎖に**（`8b3384c`）＝`buildFrost` 末尾で**セル隣接マップ `cellAdj`** を生成（隣接ピクセルのセルID差で判定）。`startGlintChain()`＝ランダムセルから発光開始、`enqueueGlintHops()`＝隣接セルを1〜2方向へ分岐予約（遅延＋減衰）。`glintQueue` を update で処理。旧「独立セルが個別ランダム発光（§17e方式）」は撤廃。
- **氷柱もキラッと光る＝砕ける直前に1回だけ**（`78285c3`→`fea17d9`）＝pillar に `gl`、定数 `GL_DUR=10`。`drawPillar` に光の帯（根元→先端へ移動・帯中心ほど強い＋全体の淡い閃光）。発火は **hold 残りが GL_DUR になった時に1回のみ**（初期案の「生え切り時＋保持中ランダム」は撤回）。
- **割れる時の破片/粉雪を控えめに**（`8f4a091`）＝`spawnShatter` の frag 数減・小粒・初速/跳ね上がり弱め・early life、粉雪バーストと冷気粒も減。
- **生える方向を四方八方に**（`ab92362`）＝`spawnCluster` の `baseAng` を上向き中心→全方向ランダム、生成位置も下半分偏り→パネル全面ランダムに。
- **生成をパネル内側の一定範囲に**（`2294735`→`ad25dd8`）＝`spawnCluster` に外周マージン `inX=min(PW*0.4,10)/inY=min(PH*0.4,8)` を入れ、**根元が収まる小マージン**に調整（先端は四方八方へはみ出し可＝canvas 余白は従来どおり許容）。
- **アザラシ演出を完全削除**（`da674c8` で白い子アザラシに一新→`a84e99a` で全削除）＝`SEAL_ART/COL/W/H/PX`・`spawnSeal/updateSeal/drawSeal`・state 変数 `seal/sealTimer`・update/draw の呼び出し・説明文の一文をすべて除去。**現在アザラシは存在しない。**

### キラキラライト版 §17L-h（`createSparkleSpellLight`・stage id=`pixsparkLStage`）
- **UFOが通った軌跡に星（初期：ゆらゆら舞う）**（`5d5f5c2`）→**推進噴射に変更**（`fa8c4db`）＝`spawnTrailSparkle(x,y,dir)` を新設し `burst` 配列に載せる（後方 `-dir` ＋上下外側 `±` のベクトルで勢いよく飛び出す＝排気/推進のイメージ。参考＝ユーザー手描きの矢印スケッチ）。`updateUFO` から UFO 進行中に毎tick 1〜2粒散布。初版の twinkles＋sway 方式は撤回し `updateTwinkles` は元に戻した。
- **着弾直後にUFOを1回即時起動**（`9fcdbd9`）＝`frame()` の中央着弾ブランチ（`state='persist'` へ遷移する行）で `spawnUFO()` を1回呼ぶ。`spawnUFO` が次回 `ufoTimer` を通常値でセットするため**以降は従来頻度**。※この行は §17h（ダーク）にも同一文字列で存在するため、**Python の行番号指定で §17L-h 側だけ**を書き換えた（`grep -n "if (dist <= SPEED) { spawnBurst"` で 2 箇所ヒット：ダーク=前半・ライト=後半）。

## 4. 現在の状態（動く / 壊れ / テスト）
- **モック（style-guide.html）＝動作 OK**。各変更後に headless（playwright chromium で `file://` を開き §17L-e/§17L-h の「発動」ボタンをクリック）で **console error 0** を実測。氷結晶スプライト等はデータ整合も確認済み。
- **production（`impl/frontend/src`）は本セッションで一切変更なし・本セッションでは未確認**。※ `872010d`（**前セッション**）で sparkle の canvas ハーネス移植（Slice1）が production に入っている旨のコミットはあるが、本セッションでは中身を見ていない＝**実アプリの現況は未確認**。
- **frontend ゲート（tsc/vitest/build）・traceability・backend pytest は本セッション未実行**（production 非変更のため）。数値は前回 handoff 履歴を参照（当時 tsc EXIT0／vitest 109 passed／traceability ✅ code 413。**現時点では未再確認**）。
- **壊れているもの＝モック上は無し**（console error 0）。
- **既知の軽微な不整合**＝§17L-e の **h3 見出し（style-guide.html 3541 行）が旧仕様「…突然生えて一定時間で消える」のまま**（本文の説明と実装は「パリンと割れる」に更新済みだが見出しだけ未追随）。害はないが次パスで直す。

## 5. 詰まっている点（試した/失敗と理由）
- **Edit の一意置換が衝突**＝§17h（ダーク）と §17L-h（ライト）で「着弾→persist」の行が**完全一致**のため `Edit` が「2 箇所ヒット」で失敗。→ **`python3 -` のヒアドキュメントで行番号（0-based index）を指定し、事前に `assert lines[i]==old` で照合してから 1 行だけ置換**して回避（`9fcdbd9`）。次も同型の重複行は行番号指定で。
- **headless での時間依存演出の目視が不安定**（既知）＝canvas+rAF は `page.evaluate`/screenshot で位相がズレる。UFO・（削除前の）アザラシは**レア出現**（`ufoTimer` 初期 300+rnd300 tick ≒ 10〜20s）で、待たないと出ない。→ 検証は基本 **console error 0＋スプライト/配列のデータ整合**で担保。**着弾直後 UFO 化（`9fcdbd9`）以降は発動直後に UFO が出るので短時間でも軌跡演出を確認しやすい**。
- **画像 Read の会話内枚数上限**（既知）＝スクショ多用で不可になる。要点のみ Read。
- **cwd ドリフト**（既知）＝headless の使い捨て `.mjs` は `impl/frontend` 直下に置く（playwright の node_modules 解決）＋使用後削除。frontend ゲートは `cd impl/frontend`、traceability は repo ルート。

## 6. 決定事項と根拠（不採用案も）
- **本セッションの変更対象はライト版（§17L）のみ**。ダーク版 §17h/§17b-h は触らない＝production 実態は明色パネルで、ライト版が本命。ダーク版は別バージョンとして残置。
- **氷柱＝戻さずパリンと割れる**（`shrink` 撤廃）＝「生えた後に戻るのは不自然、割れてほしい」というユーザー指示。
- **氷柱のキラッは砕ける直前に1回だけ**＝初期の「生え切り時＋保持中ランダム」を撤回。「光るのは1回でよい・キラッと光ってから砕ける」順。
- **氷柱の生成＝四方八方＋根元だけ内側**＝「上偏りを直す」「根元がはみ出さなければ先端のはみ出しは OK」。全面クリップ（先端も枠内）は**不採用**。
- **アザラシは削除**＝白い子アザラシ（参考画像）ドット絵に一度作り直したが、最終的に「アザラシは無し」の指示で全撤去。
- **UFO 軌跡＝ゆらゆら舞う→推進噴射**＝手描きスケッチ（軌跡から後方＋上下へ飛ぶ黄色い矢印＝排気）に合わせ、`twinkles`（滞留）から `burst`（速度＋減速＋フェード）へ載せ替え。
- **発動直後に UFO を1回**＝UFO は本来レアで演出が見えにくいため、着弾直後に必ず1回見せる。頻度は以降通常に戻す（`spawnUFO` が `ufoTimer` を通常値で再設定）。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に §17L-e / §17L-h をブラウザ直開きで目視推奨。

1. **§17L-e の h3 見出し修正（軽微）**＝`doc/画面設計/mocks/style-guide.html` 3541 行付近の見出し文言「…一定時間で消える」を実装（パリンと割れる）に合わせて更新。style-guide.html のみ。
2. **炎/虹/オーラのライト版（§17L-b/f/g）を新設**＝ライト版は現状 雷/氷/キラキラの 3 種のみ。ダーク版 §17b(炎)/§17f(虹)/§17g(オーラ) を明色パネル向けに移植する（§17L の枠組みに追加）。**ユーザーに着手可否・順番を確認してから**。
3. **production 移植の段取り**（最有力の本命作業）＝受入済みライト版モックを React へ。移植先＝`impl/frontend/src/components/ui/SpellDeliveryFx.tsx`（発射）／`SpellCastFx.tsx`（着弾）／`SpellPersistFx.tsx`（永続）／純ロジックは `features/spells/cast.ts`。**注意＝各エンジンは canvas+rAF**（ライフサイクル管理・表示時のみ rAF・reduce-motion の静的1枚 `reduceStatic` 相当が要る）。**`872010d` で sparkle Slice1 が既に production に入っている**ので、まず**その現況をコードで確認**（記憶 `handoff-notes-often-stale`）してから続き。**test 規約遵守＝先に `doc/テスト/G_ゲーミフィケーション.md` に TC 行(`根拠`列)追記→red-green→`python3 scripts/check_tc_traceability.py` で✅**。**着手前にユーザーへ「どのスペルから/一括か」を確認**。
4. **旧モックの整理**＝ダーク版 §17（`.fcast*` 旧炎＋却下版）・§17c（ドット絵ギャラリー小サイズ）が残存＝紛らわしい。§17b-h＋§17L に一本化。style-guide.html のみ。
5. **frontend ゲート＋backend pytest の再実測**＝production を触る前後で `npx tsc --noEmit`／`npx vitest run`／`npm run build`／`python3 scripts/check_tc_traceability.py`／backend pytest（§8）。本セッションは未実行。
6. **`feature/game-feel` → `main`**＝GF-AC 一通り受入後・ユーザー承認で。マージ時に `impl/README.md` と本 handoff を追随更新。
- **共通ルール**＝フロント検証は tsc/vitest に加え **`npm run build`（ESLint込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。**push はユーザー承認不要(standing) だが `main` は承認後**。全アニメは reduce-motion 尊重（記憶 `animation-reduce-motion-standard`）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl`）。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` をブラウザで `file://` 直開き。**ライト版＝§17L-d(雷)/§17L-e(氷)/§17L-h(キラキラ)**（stage id＝`pixboltLStage`/`pixfrostLStage`/`pixsparkLStage`）。各節「魔法を発動」ボタン＋「動きを減らす」トグル。ダーク版＝§17b(炎)/§17d(雷)/§17e(氷)/§17f(虹)/§17g(オーラ)/§17h(キラキラ)。§17/§17c は旧版。
- **headless 検証**＝cwd=`impl/frontend` で `node`＋`playwright`（`import { chromium } from 'playwright'`）。使い捨て `.mjs` を `impl/frontend` 直下に作成→`file://` の style-guide.html を開く→対象 stage を `scrollIntoView`→`#…Btn` を click→`page.on('console'/'pageerror')` で **console error 0** を確認→**使用後に必ず削除**。**着弾直後 UFO 化済みなので §17L-h の軌跡演出は発動直後に確認可**。氷結晶/スプライト等はデータ整合（配列長・palette キー）も併せて確認。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`／`npm run build`。backend スキーマ変更後は `npm run codegen`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`。cwd ドリフト注意（frontend 系は `cd impl/frontend`、traceability は repo ルート）。
- **QA スタック起動**（本番接続画面の確認時／記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・push 反映は `docker compose build frontend && docker compose up -d frontend`）／MailHog＝`localhost:8025`／backend＝`localhost:8000`。※演出のモック確認だけなら QA スタック不要。
- **ログイン（dev・MFA なし）**＝`/login` で company_code=`ACME-01`／login_id=`user@acme.example`／password=`Passw0rd!`。チャットは `/ideas/{ideaId}/chat`。メッセージのあるアイデア例＝`101d1648-25e8-4809-a9ec-d5c779a14920`。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`。
- **記憶**（`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/`）に運用ルール多数。特に本フェーズ＝`game-feel-async-pipeline`／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`design-spec-working-style`（UI仕様は選択肢提示より本人イメージ/手描きから起こす）／`handoff-notes-often-stale`（着手前にコードで裏取り）／`framer-reducemotion-null-flip`。
