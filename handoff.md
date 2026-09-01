# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-01 JST**（このセッション末）。
- **作業ブランチ＝`feature/game-feel`**（`origin` と同期・作業ツリー clean）。**`main` ではない・未マージ**。
- 最新コミット: **`a8124c8`** `fix(mock): 氷の四隅ヒビを割れる寸前に中央側へ伸長(2段階成長) GF-AC-091`。
- 今セッションのコミット範囲＝`bd7e0b0..a8124c8`（**38コミット**）。冒頭2つ（`fbc0a91`/`a0d8912`）以外の**36コミットは全て `(mock)` ＝ `doc/画面設計/mocks/style-guide.html` の魔法演出プロトタイプ**。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごとに commit+push 自走（standing 承認）／`main` は GF-AC 受入後にユーザー承認でマージ。QA は私が一次確認、視覚はユーザーがブラウザで GF-AC 受入。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript・`impl/frontend`）、バック＝FastAPI 4層（会社別DB動的ルーティング・`impl/backend`）。全画面・全横断ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝ユーザーがブラウザで受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）し、指摘を受けて私が実装する反復。

## 3. 今回やったこと（変更ファイルと理由）
> 正本＝進め方 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`／受入台帳 `doc/テスト/ゲーム感受入.md`／横断UI標準 `doc/画面設計/デザイン標準.md`。

### 3-A. GF-AC-091 の本番実装（初手・`fbc0a91`）＋受入反映（`a0d8912`）
- **本番 `impl/frontend/src/components/ui/SpellCastFx.tsx`＋`impl/frontend/src/features/spells/cast.ts`**＝魔法発動演出を「中央アイコン拡散＋レアリティ差」に。純ロジック `cast.ts`＝`castEffect`/`castTier`/`castParticleCount`/`castParticles`（放射粒子・rarity で数/半径可変）。テスト `impl/frontend/src/features/spells/cast.test.ts`（**G-TC-151**・red-green 済／`doc/テスト/G_ゲーミフィケーション.md §5` に TC 行）。呼び出し側 `IdeaChatView.tsx`/`SpellsView.tsx` は `spell.rarity` を伝搬。
- **`doc/テスト/ゲーム感受入.md`**＝GF-AC-075/076 を ✅ OK（2026-09-01）化（前セッション実装分のブラウザ受入）。
- **重要**: この `fbc0a91` の本番演出が **現在の production の実体**。以降のリッチな演出は **すべてモック（style-guide.html）に留まり、production には未反映**（§7-1 が本命タスク）。

### 3-B. 魔法発動演出のモック・プロトタイプ（36コミット・すべて `doc/画面設計/mocks/style-guide.html`）
> なぜモック先行か＝§6 参照（再ビルド不要で反復が速い／`shared.css`↔`design-system.css` 単一デザインシステムで後で本番へ移植）。style-guide.html は **file:// で直接開く静的ファイル**（サーバー不要）。CSS/JS はすべて同ファイル内にインライン（`<style>`/`<script>`）。

- **§17「魔法発動エフェクト」**（h2 で検索）＝発動→着弾→永続の一連を属性別に作り込み：
  - **発射方式（属性別・飛び方が違う）**：炎＝丸い火球（`fcastMakeBall`・外殻グロー＋`.ball-core`）／雷＝伸びるギザギザ稲妻（`fcastLightning`・チカチカ＋途切れ＋枝分かれ＋着弾フラッシュ同期）／氷＝大小4つの尖った氷礫（`fcastIceShards`）／虹＝ビーム（`fcastBeam`）／オーラ＝三日月の隊列（`fcastCrescents`・円形側が進行方向・近づくと本数増）。
  - **アバター発射リアクション**＝ヘッダーのユーザアバターから発射（`.fcast-caster` 反動＋`.fcast-muzzle` マズル閃光・属性で形/色可変）。
  - **着弾バースト（属性別の幾何）**＝`buildBurst(fx)`：炎（従来テンプレ `#fcastTpl`）／雷=放射レイ／氷=結晶シャード／虹=多色リング＋紙吹雪／オーラ=同心リング＋粒子。
  - **永続エフェクト**＝`buildPersist(fx)`：炎=下辺の火柱が左右にゆれる（`buildFire`）／雷=電気ストロボ＋落ちる稲妻＋スパーク／氷=**薄いガラス板が固まる→ヒビ→割れて飛散→再凍結ループ**（`.ice-panel`/`.ice-crackseg`/`.ice-shard-piece`・約5.5s・`--iced`）／虹=流れる縁取り＋**枠の外(上辺の上)を右上端(発動者)→左上端(対象)へ架かる全幅の虹**（`.rainbow-arc`・SVG・clip ワイプ）／オーラ=脈動リング＋広がるリング＋昇るモート。溶岩（`.fcast-lava`）は炎の「横流れ版」を別スペル用に保存。
  - **受信/表示側の4パターン**（h3「受信/表示側の4パターン」）＝発動者→作成者の 自分↔他人 全4組。左上=作成者アバター(`.msg-avatar.author`)／右上=発動者バッジ(`.msg-avatar.caster`・**発動者≠作成者の時だけ**)／自作自演は✦自己発動マーク(`.is-selfcast::before`)。画面表示時に1回だけ発動→枠が永続。ロジックは `.fcast-reveal` を `wire()`→`reveal()` で駆動。
- **§18「発動タイミングの実験」**（h2）＝A/B の単体デモ：A=着弾ずれ対策（`#fireAnchor`＝弾をスクロール内容座標に置く vs `#fireFixed`＝枠固定でズレる）／B=スクロール沈静で発火（`#bscroll`・350ms idle）。
- **§17 にも A/B を反映済み**（`4bc4ba0`）＝A: 弾を `position:absolute`＋文書座標（`pageXOffset/Offset` 加算）でスクロール追従／B: `fcastWhenVisible` にスクロール沈静(350ms)ゲート。

## 4. 現在の状態（動く / 壊れ / テスト）
- **frontend ゲート（cwd=`impl/frontend`・本セッション実測）**＝`npx tsc --noEmit` **クリーン(exit 0)**／`npx vitest run` **88 passed（14 files）**／`npm run build` **green**。
- **トレーサビリティ**＝repo ルート `python3 scripts/check_tc_traceability.py` → **✅（code 413）**。
- **backend テスト**＝**今回未実施**（backend 変更なし）。full pytest も未実測のまま。
- **モック演出**＝headless playwright（file:// 直読み）で各属性の発射/着弾/永続、受信4パターン、A/B、氷ガラス3フェーズ、虹の全幅到達などを実測確認（console エラー0）。**ブラウザ最終確認はユーザーが実施中**（虹・氷は複数回のフィードバックで調整済み）。
- **コンテナ**＝session 序盤に QA スタックを起動したが、session 末の稼働状態は**未確認**（モック作業はサーバー不要のため）。
- **壊れているもの＝コード上は無し**。
- **GF-AC 受入状況**（`doc/テスト/ゲーム感受入.md`）＝**GF-AC-075/076 ✅**。**GF-AC-091 は「未確認」**（＝production の `fbc0a91` 版が正で未受入。モックの豪華版は未反映）。GF-AC-093（reduce-motion）も未確認。

## 5. 詰まっている点（試した/失敗と理由）
- **虹の draw-on が実ブラウザで途中で止まった**＝`stroke-dasharray`＋`pathLength`＋`vector-effect:non-scaling-stroke`＋`preserveAspectRatio="none"`（非均等スケール）の組合せが破綻し半分しか描画されず、次ループ開始で左が別に出た（私の headless では再現せず＝**ブラウザ差に注意**）。→ dash を廃し **clip ワイプ**（`.rainbow-arc` の `clip-path: inset(...)` を右→左にアニメ）で解決（`5033744`）。
- **虹が「中央止まり」に見えた**＝同心配置で内側の色ほど足が中央に収束し外側の赤だけが端に届いていた。→ **平行バンド**（上方向へ等間隔にずらした同形の弧・全バンド同じ x 範囲）で全色が両端到達（`3b641a2`）。
- **氷のヒビが headless で「見えない」と誤検知**＝テストが `is-burning` 付与前の状態（`.fcast-burn` opacity 0）を撮っていただけで描画は正常だった。→ **検証は必ず `is-burning` を待つ**。
- **SVG が入れ子で描画されない疑い**も上記と同じ誤検知。**入れ子 SVG は可視(`is-burning`)なら普通に描画される**。ただし氷ヒビは最終的に CSS の線分（`.ice-crackseg` の scaleX）で実装（虹は SVG のまま）。
- **自己発動マークのツールチップ不具合**＝マーク(`.is-selfcast::after`)と `.has-tip` ツールチップ(`::after`)が同じ `::after` を奪い合いマークが左下へずれた。→ マークを `::before` に移動（`b977277`）。

## 6. 決定事項と根拠（不採用案も）
- **魔法演出は先にモックで作り込む→視覚確定後に本番移植**（採用・記憶 `frontend実装フロー`）。理由＝再ビルド不要で反復が速い／単一デザインシステムで移植容易。不採用＝いきなり本番実装（毎回 docker `--build` で遅い）。
- **虹の描画は clip ワイプ**（採用）。不採用＝stroke-dash 描画（実ブラウザで途中停止）。
- **虹は平行バンド**（採用）。不採用＝同心（端で色が収束し中央止まりに見える）。
- **氷ヒビは CSS 線分＋段階キーフレーム(g1..g5)で加速表現＋2段階成長（四隅→割れる寸前に中央へ伸長）**（採用）。`animation-delay` は使わず同一ループで割れを一斉同期（delay は消滅がずれるため不採用）。
- **弾の着弾ずれ対策＝スクロール座標系アンカー（本命）／演出間引き＝スクロール沈静**（採用・§18 で実演し §17 に反映）。不採用＝毎フレーム rAF 再ターゲット（アンカーで足りる／ヘッダー発射の混在時のみ検討）。
- **受信4パターン仕様（ユーザー確定）**＝発動者バッジは発動者≠作成者の時だけ／自作自演は✦マーク・バッジ無し／リビールは**初回表示で常に1回**（履歴の既視抑止 localStorage はしない）／他人→自分は**トースト＋通知both**／自分のライブ発動のみヘッダーアバター発射・他者視点/履歴は発動者バッジ(自作は作成者アバター)発射。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に `doc/テスト/ゲーム感受入.md` と `doc/フェーズ毎ルール/ゲーム感フェーズ.md` を確認。

1. **【本命】モックの魔法演出を production へ移植**＝`doc/画面設計/mocks/style-guide.html` §17 の設計を `impl/frontend/src/components/ui/SpellCastFx.tsx`＋`impl/frontend/src/styles/design-system.css` に反映する。現状 production は `fbc0a91` の簡易版（色＋rarity＋`castParticles`）のみ。移植内容＝属性別デリバリー（火球/稲妻/氷礫/ビーム/三日月）・着弾バースト幾何・属性別永続（火柱/氷ガラスループ/虹clipワイプ/オーラ/雷）・アバター発射リアクション＋マズル・受信側アバター（作成者左/発動者バッジ右・自作✦は `::before`）・A(文書座標アンカー)＋B(スクロール沈静)。純ロジックは `impl/frontend/src/features/spells/cast.ts` を拡張（effect→デリバリー種別・粒子/線分レイアウト）し vitest（`cast.test.ts` 追記・`doc/テスト/G_ゲーミフィケーション.md` に TC 行）。**移植時 CSS は `shared.css` と `design-system.css` を同期**（デザイン標準）。reduce-motion 抑制ケース必須（GF-AC-093・記憶 `animation-reduce-motion-standard`）。
2. **realtime 受信 vs 履歴表示の分岐実装**＝閲覧中に他人が自分のメッセージにかけた時（realtime）＝発動者アバターから飛来＋通知/トースト／履歴を開いた時＝控えめな1回リビール。受信は seen セット（session）で1回。他人→自分は既存通知基盤へ接続。
3. **GF-AC-091/093 のブラウザ受入**＝ユーザー確認→`doc/テスト/ゲーム感受入.md` を✅化。台帳の GF-AC-091 期待文は現状 `fbc0a91` 版準拠なので、豪華版移植後に期待文を更新すること。
4. **`feature/game-feel` → `main` マージ**＝GF-AC 一通り受入後。マージ時に `impl/README.md` と本 handoff を追随更新。
5. **full backend pytest 実測（未実施）**＝§8 のコマンド（cwd=`impl`）。

- **共通ルール**＝backend 変更は再ビルドしないと実行に反映されない（§8）。フロント検証は tsc/vitest に加え **`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。テストは md 先行・red-green（`doc/テスト/red確認台帳.md`）。`main` への push はユーザー承認後。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl` で `docker compose`）。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` をブラウザで file:// 直開き（§17/§18 が魔法演出）。headless 検証は cwd=`impl/frontend` で `node`＋`playwright`（`import { chromium } from 'playwright'`）→ `file://` を開く。**演出の発火は `is-burning` 付与後に確認**（`.fcast-stage.fcast-reveal .demo-msg.is-burning` を待つ／アニメは `el.getAnimations()` を pause して `currentTime` シークで各フェーズを撮る）。使い捨て `.mjs` は使用後に削除。
- **QA スタック起動**（本番接続画面の確認時／記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・push 反映は `--build` 再ビルド必須）／MailHog＝`localhost:8025`／backend＝`localhost:8000`。反映確認＝`docker compose exec -T frontend sh -c "grep -rl '<一意文字列>' /app/.next"`（exit code を信じない）。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（88）／`npm run build`。backend スキーマ変更後は `npm run codegen`。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`（ホストソースを走らせる・backend はイメージ焼き込みで `--reload` 無し）。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（✅ code 413）。
- **開発DB 手編集（コード外・seed 再構築で消える）**＝ACME-01 テナントDB `ideaquest_company_acme`／`user@acme.example`＝表示名「テスト 太郎」。GF-073 用に `users.xp=97588`（戻す＝`UPDATE users SET xp=93845 WHERE display_name='テスト 太郎';`）。`title LIKE 'GF073投票用_%'`／`'GF077投票用_%'` の投票用アイデア。テナントDB 参照＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（control DB＝`ideaquest_control`）。
- 記憶（`~/.claude/.../memory/`）に運用ルール多数（`game-feel-async-pipeline`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`framer-reducemotion-null-flip`／`spec-is-source-of-truth`／`handoff-notes-often-stale` 等）。
