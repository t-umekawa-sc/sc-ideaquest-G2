# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-03 JST**（このセッション末）。
- 作業ブランチ＝**`feature/game-feel`**（`origin` と同期・作業ツリー clean）。**`main` ではない・未マージ**。
- 最新コミット＝**`bd3dc93`** `feat(mock): ドット絵の焚火デモを追加…`。
- 今セッションのコミット範囲＝**`91048e2..bd3dc93`（10コミット）**。内訳＝§17実寸サンプルの端切れ修正/発動ボタン、氷ヒビ2件（後述の理由で production は revert 済み）、炎演出の試行錯誤（火の玉/火花/永続を数世代）→**最終的に「ドット絵の焚火」へ路線変更**。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごと commit+push 自走（standing 承認）／`main` は受入後にユーザー承認でマージ。
- **重要な運用ルール（今セッションで確立・記憶 `game-feel-mock-first-then-port`）＝演出変更は「まず `doc/画面設計/mocks/style-guide.html`（モック）だけ」に反映し、ブラウザ受入後に production へ移植する。即 production 移植しない。**

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全横断ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝魔法発動演出をブラウザで受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）し反復。今は**炎スペルの見せ方**を模索中。

## 3. 今回やったこと（変更ファイルと理由）
> 正本＝進め方 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`／受入台帳 `doc/テスト/ゲーム感受入.md`。**すべてのコミット対象ファイル＝`doc/画面設計/mocks/style-guide.html`（＋ 氷2件だけ一時的に production も触ったが revert 済み）。**

### 3-A. §17 実寸サンプルの UX 修正（`ebdf0a6` / `6ad2d20`・モックのみ）
- **端切れ修正**＝`.fcast-stage--real` に `padding-inline:22px`。実寸(全幅)メッセージで両端のアバターバッジ(author=left:-12px / caster=right:-12px)が stage の `overflow:hidden` で12px切れていたのを解消。
- **「魔法を発動」ボタン**＝`.fcast-stage--real` 直下に btn-pixel を JS 生成（`wire()` 内）。押す度に発動→着弾→燃焼を再生。`wire()` の `reveal()` を **`castAnim()`（本体）／`reveal()`（可視で1回）／`replay()`（is-burning 解除+バースト残骸除去→castAnim）** に分離。

### 3-B. 氷ヒビ2件＝**モックのみ有効・production は revert 済み**（`7439529`→`61916fc`→`a033569`）
- 内容: (1) 割れる寸前の致命ヒビを **5→11本**（隅の第1節点 e0 を結ぶ破断ダイヤ4辺＋対角2）。(2) **割れた瞬間(80%)にヒビ線を即消滅**（全ヒビ keyframe 末尾 `80% op1→84% op0` を `79% op1→80% op0` に）。
- 私が受入前に production（`cast.ts`/`cast.test.ts`/`design-system.css`）まで即移植したが、ユーザー指示「まず style-guide.html だけに反映して」で **`a033569` にて production 3ファイルを `6ad2d20` 時点へ revert**。**氷2件は現在モック（style-guide.html §17 の氷実寸サンプル）にのみ存在**。→ 受入後に再ポート要（§7）。

### 3-C. 炎演出の試行錯誤（`692c85f`→`65971f6`→`452446a`→`c82cf34`→`bd3dc93`・**すべてモックのみ**）
炎の「発射／着弾／永続」をユーザー指摘で数世代作り替えた。**現在ライブな実装状態**は:
- **発射＝彗星型の火の玉（採用中）**（`65971f6`）＝`fcastMakeBall(fire)` が `FIREBALL_SVG`（頭=黄/尾=赤橙炎の局所座標）を生成。呼び出し側(play/wire)が進行方向 `atan2(ey-sy,ex-sx)` を `--angle` に設定し回転（頭を対象へ・尾は後方）。
- **着弾＝四方に飛び散る火花（採用中）**（`692c85f`）＝共有テンプレート `#fcastTpl` の embers を放射状（16粒・22.5°刻み）に。`buildBurst('fire')` と上部デモ両方に反映。
- **永続＝迷走中**。世代: (a) 枠が燃える border-lick（`692c85f`）→ (b) 2案 engulf/paper 比較（`452446a`）→ (c) **一つにつながった連続炎 SVG**（`c82cf34`＝`flameLayerPath`/`buildFlameStrip`/`buildFire`・CSS `flame-dance`）。**(a)(b)(c) はいずれもユーザーに「イマイチ・わくわくしない」で却下**。
- **→ 路線変更＝ドット絵の焚火（現在の最有力・`bd3dc93`）**（記憶 `fire-spell-pixel-campfire`）。**§17b「ドット絵の焚火」節を新規追加**（id `pixfireStage`）。`createPixelCampfire()`＝低解像度 canvas(48×64)を `image-rendering:pixelated` で拡大。**古典的ピクセル炎（下から熱伝播＋左右揺らぎ・11段火色パレット `spreadFire`/`step`）＋枯れ木スプライト（`drawWood`/`drawLog`）＋黒煙パーティクル（`updateSmoke`）**。発動シーケンス＝`start()`（枯れ木出現→火の玉ドット降下→着弾で `ignite()`→炎+黒煙）／`reduceStatic()`（静的焚火・抑制尊重）。IntersectionObserver で初回自動再生・btn `#pixfireBtn`。

## 4. 現在の状態（動く / 壊れ / テスト）
- **frontend ゲート（cwd=`impl/frontend`・本セッション末に実測）**＝`npx tsc --noEmit` **クリーン**／`npx vitest run` **109 passed（14 files）**／トレーサビリティ（repoルート `python3 scripts/check_tc_traceability.py`）**✅（code 413）**。`npm run build` は **今回未実行**（production 変更が無い＝a033569 以降 production 不変のため。前回 build green は e5b9860）。
- **production（`impl/frontend/src`）は `a033569`＝`6ad2d20` 時点のまま不変**。炎の全変更・氷2件はモック限定。∴ **production の氷永続＝致命ヒビ5本・80→84%フェード**、**production の炎永続＝下辺の火柱（firePillars）**（＝旧 Phase D 状態）。`cast.ts` の `iceCrackTree` は 5本、`SpellPersistFx.tsx` は変更なし。
- **モック（style-guide.html）の状態**＝§17 に **却下された SVG連続炎**（`buildFire`＝上下辺の帯＋engulf/paper比較サンプル）が残っている／§17b に **新方針のドット絵焚火** がある＝**2種が併存**（要整理・§7）。上部単体デモ `#fcastStage` は**さらに旧い水滴 lick のまま**（未更新）。
- **ドット絵焚火の検証（headless 数値・視覚は未確認）**＝発動で炎~800px/黒煙~35px 描画・フレーム間でピクセル変化=アニメ動作・reduce で静止・**console エラー0**。
- **壊れているもの＝コード/テスト上は無し**（tsc/vitest/traceability 緑）。
- **backend テスト＝今回未実施**（backend 変更なし）。full pytest 未実測。
- **GF-AC 受入状況**＝GF-AC-075/076 ✅。**GF-AC-091（炎ほか）は受入中で、炎の見せ方が「ドット絵の焚火」へ路線変更した直後＝未受入**。GF-AC-093（reduce-motion 全体）未確認。

## 5. 詰まっている点（試した/失敗と理由）
- **リアル志向の炎（CSS/SVG で炎の形を手描き）は全部却下された**＝border-lick（水滴が電飾の豆電球に見える）／連続炎 SVG（三角形の山に見える）等。理由＝手描き手続き的な炎は何度調整しても素人っぽさが抜けず「わくわくしない」（ユーザー評）。→ **教訓＝炎は"形を描く"のをやめ、ドット絵（記号的・意図が伝わる）に発想転換**（決定・§6）。
- **会話内の画像枚数が上限に到達**＝セッション後半、私（Claude）が headless スクリーンショットを **Read で表示できなくなった**（"max allowed size for many-image requests" エラーが蓄積画像で発生）。→ 炎の連続炎SVG・ドット絵焚火は**視覚未確認のまま**、`getImageData` のピクセル統計＋console エラー0 で数値検証して進めた。**次セッション（新しい会話）ではスクショ可能。着手前に §17b をブラウザ or headless スクショで必ず目視すること。**
- **cwd ドリフト**（既知）＝frontend 系は毎回 `cd impl/frontend`、traceability は repo ルートで実行。headless の使い捨て `.mjs` は `impl/frontend` 直下に置く（playwright の node_modules 解決）＋使用後削除。

## 6. 決定事項と根拠（不採用案も）
- **炎スペル＝ドット絵の焚火**（採用・ユーザー決定 2026-09-03／記憶 `fire-spell-pixel-campfire`）＝発動→パネル下部に枯れ木の束→火の玉着弾で着火→炎＋黒煙が立ち上る。不採用＝リアル炎の border-lick／2案(engulf全体炎/paper紙端)／連続炎SVG（いずれも却下）。
- **モック先行・受入後に production 移植**（採用・ユーザー指示／記憶 `game-feel-mock-first-then-port`）＝即 production 移植は却下（氷2件で revert する羽目に）。
- **火の玉＝彗星型SVG・進行方向で回転**（採用）＝発射弾を丸い球から頭黄/尾赤橙の彗星に。不採用＝対称な発光球（火の玉に見えない）。
- **着弾＝四方に放射する火花**（採用）＝上昇プルームを廃止。理由＝「火花が四方に飛び散る」指定。
- **氷2件（11本/80%消滅）はモックのみ・production 保留**（採用）＝受入前の即移植を避ける。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に **§17b をブラウザ/headless で目視**（前セッションは視覚未確認）。参照＝`doc/テスト/ゲーム感受入.md`。

1. **【最優先】ドット絵の焚火（§17b）をユーザーがブラウザ受入 → 指摘反映**。調整ポイントは `doc/画面設計/mocks/style-guide.html` の `createPixelCampfire()` 内パラメータ＝`W/H/scale`（サイズ・ドットの粗さ）、`seedX0/seedX1`（炎の幅）、`WOOD_TOP`、`PAL`（火色）、`drawWood`/`drawLog`（枯れ木の形）、`updateSmoke` の spawn 確率/速度（黒煙の量・黒さ）、配置は CSS `.pix-campfire`（`left/bottom/transform`）。位置＝現在「メッセージ下部中央に1つ・約144×192px」。ユーザーに要確認＝大きさ/位置（中央か幅いっぱいか複数か）/炎の高さ・色/煙の量/枯れ木の形。
2. **受入OKなら production へ移植**＝炎永続を `impl/frontend/src/components/ui/SpellPersistFx.tsx`（現在 firePillars）に **canvas+rAF のドット絵焚火**として実装。注意＝他スペルは CSS だが焚火は canvas＝ライフサイクル管理（表示時のみ rAF・非表示で停止）・reduce-motion（静的1枚）・メッセージ毎生成のコスト設計が必要。純ロジック分離＆テスト（`cast.ts`/`cast.test.ts`・G-TC 台帳 `doc/テスト/G_ゲーミフィケーション.md`）は test-first。
3. **モック整理**＝§17 に残る**却下版の炎**（`buildFire` の連続炎SVG＋engulf/paper比較サンプル＋`.flame-*`/`.fcast-fire__lick` CSS＋上部 `#fcastStage` の旧 lick）を、焚火方針が固まったら**削除/差し替え**（現在 §17 と §17b で2種併存し紛らわしい）。
4. **氷2件をモック→production 再ポート（受入後）**＝`cast.ts` `iceCrackTree`（致命ヒビ 5→11＝e0 の破断ダイヤ4+対角2）／`cast.test.ts`（致命ヒビ数 5→11・red-green）／`design-system.css`（`ice-crack-*` keyframe 末尾 `80% op1→84% op0` を `79%→80%` に＝割れた瞬間に消滅）。モック（style-guide.html）に実装済み・参照可。
5. **火の玉/火花（採用中）を production 移植**＝発射＝`SpellDeliveryFx.tsx`（彗星SVG＋進行方向回転）／着弾＝`SpellCastFx.tsx`（放射火花）。純ロジックは `cast.ts`。
6. **full backend pytest 実測（未実施）**＝§8 のコマンド。
7. **`feature/game-feel` → `main`**＝GF-AC 一通り受入後・ユーザー承認で。マージ時に `impl/README.md` と本 handoff を追随更新。

- **共通ルール**＝フロント検証は tsc/vitest に加え **`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。テストは md 先行・red-green。**push はユーザー承認不要（standing）だが `main` は承認後**。全アニメは reduce-motion 尊重（記憶 `animation-reduce-motion-standard`）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl`）。
- **モック確認（サーバー不要・炎/焚火はこれで十分）**＝`doc/画面設計/mocks/style-guide.html` をブラウザで `file://` 直開き。**§17b「ドット絵の焚火」**＝今の炎の本命／§17「17. 魔法発動エフェクト」＝旧炎（却下版が残存）。headless 検証は cwd=`impl/frontend` で `node`＋`playwright`（`import { chromium } from 'playwright'`・使い捨て `.mjs` を frontend 直下に置く→ `file://` を開く→使用後削除）。**canvas 演出は `getImageData` のピクセル統計で数値検証**（例＝非透明数/火色数/煙数、フレーム間シグネチャ差でアニメ判定）。**画像 Read は会話内枚数上限に注意**（多用で不可になる）。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（109）／`npm run build`。backend スキーマ変更後は `npm run codegen`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（✅ code 413）。cwd ドリフト注意＝frontend 系は `cd impl/frontend` 明示、traceability は repo ルートで。
- **QA スタック起動**（本番接続画面の確認時／記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・**push 反映は `docker compose build frontend && docker compose up -d frontend`**）／MailHog＝`localhost:8025`／backend＝`localhost:8000`。※炎/焚火の見た目確認だけならモック直開きで足り、QA スタックは不要。
- **ログイン（dev・MFA なし）**＝`/login` で company_code=`ACME-01`／login_id=`user@acme.example`／password=`Passw0rd!`。チャットは `/ideas/{ideaId}/chat`。メッセージのあるアイデア例＝`101d1648-25e8-4809-a9ec-d5c779a14920`。実寸メッセージ `.msg` は viewport 1280 で約 1056×102。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`。
- **記憶**（`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/`）に運用ルール多数。特に本フェーズ関連＝`fire-spell-pixel-campfire`（炎＝ドット絵焚火）／`game-feel-mock-first-then-port`（モック先行・即移植しない）／`game-feel-async-pipeline`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`design-spec-working-style`（UI仕様は選択肢提示より本人イメージから起こす）／`handoff-notes-often-stale`（着手前にコードで裏取り）。
