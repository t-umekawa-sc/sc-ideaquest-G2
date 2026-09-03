# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-03 JST**（このセッション末）。
- 作業ブランチ＝**`feature/game-feel`**（`origin` と同期・作業ツリー clean）。**`main` ではない・未マージ**。
- 最新コミット＝**`a1ccaca`** `feat(mock): キラキラの星空にたまに横切るUFO(10パターン・低頻度)を追加`。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごと commit+push 自走（standing 承認）／`main` は受入後にユーザー承認でマージ。
- **重要ルール（記憶 `game-feel-mock-first-then-port`）＝演出は「まず `doc/画面設計/mocks/style-guide.html`（モック）だけ」に反映し受入後に production 移植。即 production 移植しない。**

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝チャット（SC-24）の魔法発動演出をブラウザ受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）しながら反復中。

## 3. 今回やったこと（変更ファイルと理由）
> 正本＝進め方 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`／受入台帳 `doc/テスト/ゲーム感受入.md`。**今セッションのコミット対象ファイルは `doc/画面設計/mocks/style-guide.html` のみ**（production は一切触っていない＝§4参照）。

**6スペル全ての「実寸チャットパネル」演出モックをユーザー指示で一つずつ作り込んだ**（`91048e2`〜`a1ccaca` の一連）。各節（§17x）は独立の自己完結 vanilla JS エンジン（`createXxxSpell()`）＋その節専用の `<style>`。共通作法＝**アバタールール §17 準拠**（作成者=左上・青／術者=右上・スペル色バッジ `.msg-avatar`）＋発動で術者アバターが反動（`.fcast-caster`）＋caster 座標から発射→中央着弾→永続。全アニメ `prefers-reduced-motion`／各節トグルで静止（記憶 `animation-reduce-motion-standard`）。

- **§17b 炎**（`createPixelFireLine`・ドット絵）＝casterから火の玉が**中央下部**へ等速直線→着弾で破裂(火花)→着火点から**左右両方向へ延焼**(`frontL`/`frontR`)→下辺全体で持続。先端が透過(`FADE_*`)＝文字可読。
- **§17c 他スペルのドット絵ギャラリー**（`createPixSpell`・小サイズ5種）＝**旧・別バージョン**。実寸版(§17d-h)ができた今は重複（§7の整理対象）。
- **§17d 雷**（`createPixelThunder`・ドット絵）＝caster電気の玉→中央着弾→電気が上線へ上昇(`drawRise`)→**上線に着いたら少量の雲→粒が着くほどモクモク成長**(`growing`相・`growL/growR`が`target`へ素早くease＋ランダム休止`puffL/puffR`)→**最後は必ず全幅**(`CLOUD_HALF`)→数回チカチカ(`charging`)→雲底から間欠落雷(`live`)。雲描画=`drawCloud`。
- **§17e 氷**（`createIceSpell`・**非ドット絵/フル解像度**）＝caster から**複数の尖った氷シャード**発射→中央着弾→パネルを**不規則な塊(チャンク)に分割**(`genChunks`)し**中央→外へ塊ごとに瞬間スナップで凍結**(`frozenCount`/`snapFlash`/クリップ和集合)→全凍結後は**低頻度でランダムな塊がピカッ**(`glowIdx`/`glowVal`/`glowTimer`)＋雪(`snow`)。霜=`frostGrad`＋羽毛シダ(`ferns`)で文字可読。
- **§17f 虹**（`createRainbowSpell`・非ドット絵）＝caster から**虹色ビームの先端が伸び**中央到達で虹粒子バースト＋閃光→**光の球がパネル外周を一周しながら一周つながった1本の虹を描いて残す**(`loopPts`/`loopNorm`＝4辺ベジェ連結・`drawRainbowLoop`/`drawSphere`)→以後**球が定期的に再周回**。
- **§17g オーラ**（`createAuraSpell`・**ドット絵/上昇炎方式**）＝caster から**ドット絵の波動(声援)＋前向き記号**(♪音符/↑矢印/ハート/星/プラス＝`GLY`/`SYMS`)が中央へ飛来→パネルが強化され**縁から上へ立ち上るドット絵オーラ**(低解像度ヒート上昇伝播 `stepAura`/`spreadFire`／重み付き seed `buildSeeds`＝**上辺強・左右は上ほど強・下辺控えめ**／上辺高さは`sin`合成で**ムラ**／下辺は`botFade`で透過)＋色が**紫→金→青を巡回**(`PALS`/`drawPixelAura`)。canvas はパネル外へ拡張(MT=88/MS/MB)。
- **§17h キラキラ**（`createSparkleSpell`・非ドット絵）＝caster から**流れ星**(尾つき head glint)→中央着弾で**キラキラが四方へ弾け**(`spawnBurst`)→永続＝**まばらな瞬き**(`twinkles`)＋背景に**天の川**(斜め微星帯`mwStars`＋もや `drawMilkyWay`)＋**オーロラ**(波打つ色カーテン `drawAurora`/`auroraCol`)＋**たまに横切るUFO**(`spawnUFO`/`computeUFO`/`updateUFO`/`drawUFO`＝動き**10パターン**をランダム・**出現少なめ**・reduceでは非表示)。

## 4. 現在の状態（動く / 壊れ / テスト）
- **frontend ゲート（cwd=`impl/frontend`・本セッション末に実測）**＝`npx tsc --noEmit` **クリーン(EXIT0)**／`npx vitest run` **109 passed(14 files)**／トレーサビリティ（repoルート `python3 scripts/check_tc_traceability.py`）**✅(code 413)**。`npm run build` は**今回未実行**（production 変更ゼロのため）。
- **production（`impl/frontend/src`）は本セッションで一切変更なし**。`SpellDeliveryFx.tsx`/`SpellCastFx.tsx`/`SpellPersistFx.tsx`/`features/spells/cast.ts` の最終変更は **`a033569`（前セッションの revert）**。∴ **実アプリの魔法演出は旧実装のまま**（モックの新演出は未反映）。
- **モック（style-guide.html）＝6スペル全ての実寸サンプルが揃った**（炎§17b・雷§17d・氷§17e・虹§17f・オーラ§17g・キラキラ§17h）。全て headless で動作＋`console error 0`＋`prefers-reduced-motion` 静止を実測確認済み。
- **併存する旧モック**＝§17（炎の旧提案＝`.fcast*` の実寸サンプル＋却下版）／§17c（ドット絵ギャラリー小サイズ）が残存＝**重複・紛らわしい**（§7の整理対象）。
- **壊れているもの＝コード/テスト上は無し**（tsc/vitest/traceability 緑・console error 0）。
- **backend＝今回未変更・pytest 未実行（未確認）**。

## 5. 詰まっている点（試した/失敗と理由）
- **headless での「時間依存フェーズ」検証が不安定**＝`page.evaluate`/`screenshot` が rAF を止め、`while(acc>=33)` の catch-up で複数tickが一気に進むため、実時間とアニメ位相がズレる。対策＝(1)`reduceStatic()`（rAF不要の静的1枚）で描画ロジックだけ確認、(2)一時デバッグゲッター(`_dbg`)を仕込みフェーズ遷移をポーリング→**確認後に必ず除去**、(3)`getImageData` のピクセル統計で状態判定（凍結幅%・雲幅%・非透明数）。→ **次回も同手法で。デバッグ用の一時コードは commit 前に必ず消す**。
- **sed でのテスト用書き換えは危険**（一度 `reset()` の閉じ括弧までコメント化してスクリプトを壊した）。→ **テスト用の値変更は `cp` でバックアップ→sed→`cp` で復元**、または Edit で厳密一致置換。
- **画像 Read の会話内枚数上限**（履歴的に多用で不可になる）＝スクショは要点のみ Read。
- **cwd ドリフト**（既知）＝frontend 系は毎回 `cd impl/frontend`、traceability は repo ルート。headless の使い捨て `.mjs` は `impl/frontend` 直下に置く（playwright の node_modules 解決）＋使用後削除。

## 6. 決定事項と根拠（不採用案も）
- **モック先行・受入後 production 移植**（記憶 `game-feel-mock-first-then-port`）。即移植は却下。
- **各スペルの表現方式＝ドット絵/非ドット絵を混在**（ユーザー都度決定）＝炎・雷・オーラ＝**ドット絵**（低解像度／chunkな四角）／氷・虹・キラキラ＝**非ドット絵**（フル解像度で滑らか）。理由＝きらめき/氷/虹は滑らかが映える・炎/雷/オーラはドット絵が良いとのユーザー評。
- **オーラは「一様に覆う」→「上へ立ち上る重み付き」に決定**（下控えめ/左右は上ほど強/上強）＝滑らか縁グロー版は「いまいち」で却下、ドット絵の上昇炎方式を採用。
- **虹の外周は一周つながった1本＋光の球が描いて残し定期再周回**＝4分割クロスフェード（消える）版から変更（消えなくて良い＋球は「かかる時の球」の要望）。
- **雷雲は最後必ず全幅**（左右到達幅のランダム版は撤回）＝成長は「モクモク（増える→止まる→また増える）」のランダム性で表現。
- **UFO は10パターン・低頻度・reduceで非表示**＝動きのある装飾のため。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に §17b〜§17h をブラウザ/headless で目視推奨。

1. **【最有力】production 移植の段取り**＝受入済みモック(§17b-h)を React へ。移植先＝`impl/frontend/src/components/ui/SpellDeliveryFx.tsx`（発射）／`SpellCastFx.tsx`（着弾）／`SpellPersistFx.tsx`（永続）／純ロジックは `features/spells/cast.ts`。**注意＝各エンジンは canvas+rAF**（他は CSS）＝ライフサイクル管理（表示時のみ rAF・非表示で停止・メッセージ毎生成コスト）・`reduce-motion`（各エンジンの静的1枚 `reduceStatic` 相当）が要る。**test 規約遵守＝先に `doc/テスト/<ドメイン>_*.md` に TC 行(`根拠`列)追記→red-green→`python3 scripts/check_tc_traceability.py` で✅**（G-TC 台帳 `doc/テスト/G_ゲーミフィケーション.md`）。**着手前にユーザーへ「どのスペルから/6種一括か」を確認**。
2. **モック整理**＝§17（`.fcast*` 旧炎＋却下版）と §17c（ドット絵ギャラリー）を削除/整理し §17b-h に一本化（現状 紛らわしい）。style-guide.html のみ。
3. **旧「氷ヒビ2件」の扱いを確認**＝過去handoffに「`cast.ts iceCrackTree` 5→11本・`design-system.css` フェード変更をモック→production 再ポート」が残っていたが、**氷は §17e で全面再設計済み**のため陳腐化の可能性。production の氷演出方針を §17e に合わせるか要判断（未確認）。
4. **full backend pytest 実測（未実施）**＝§8 のコマンド。
5. **`feature/game-feel` → `main`**＝GF-AC 一通り受入後・ユーザー承認で。マージ時に `impl/README.md` と本 handoff を追随更新。
- **共通ルール**＝フロント検証は tsc/vitest に加え **`npm run build`（ESLint込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。**push はユーザー承認不要(standing) だが `main` は承認後**。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl`）。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` をブラウザで `file://` 直開き。魔法演出＝**§17b(炎)/§17d(雷)/§17e(氷)/§17f(虹)/§17g(オーラ)/§17h(キラキラ)**。各節「魔法を発動」ボタン＋「動きを減らす」トグル。§17/§17c は旧版。
- **headless 検証**＝cwd=`impl/frontend` で `node`＋`playwright`（`import { chromium } from 'playwright'`・使い捨て `.mjs` を frontend 直下→ `file://` を開く→使用後削除）。**canvas 演出は時間位相がズレるので `reduceStatic`＋`getImageData` ピクセル統計で確認**。`reducedMotion:'reduce'` で静止（2フレーム一致）を検証。**一時デバッグは commit 前に必ず除去**。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（109）／`npm run build`。backend スキーマ変更後は `npm run codegen`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（✅ code 413）。cwd ドリフト注意（frontend 系は `cd impl/frontend`、traceability は repo ルート）。
- **QA スタック起動**（本番接続画面の確認時／記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・push 反映は `docker compose build frontend && docker compose up -d frontend`）／MailHog＝`localhost:8025`／backend＝`localhost:8000`。※演出の見た目確認だけならモック直開きで足り QA スタック不要。
- **ログイン（dev・MFA なし）**＝`/login` で company_code=`ACME-01`／login_id=`user@acme.example`／password=`Passw0rd!`。チャットは `/ideas/{ideaId}/chat`。メッセージのあるアイデア例＝`101d1648-25e8-4809-a9ec-d5c779a14920`。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`。
- **記憶**（`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/`）に運用ルール多数。特に本フェーズ＝`game-feel-async-pipeline`／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`design-spec-working-style`（UI仕様は選択肢提示より本人イメージから起こす＝各スペルはこの流儀で作った）／`handoff-notes-often-stale`（着手前にコードで裏取り）。
