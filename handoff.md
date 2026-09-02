# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-02 15:54 JST**（このセッション末）。
- **作業ブランチ＝`feature/game-feel`**（`origin` と同期・作業ツリー clean）。**`main` ではない・未マージ**。
- 最新コミット: **`e5b9860`** `feat(spells): 永続エフェクトを size-adaptive 化=実寸メッセージ(幅広・低い)で再調整 GF-AC-091`。
- 今セッションのコミット範囲＝`6b4141b..e5b9860`（**16コミット**）。内訳＝モック演出調整6＋production 移植A/B/C/D 8＋実寸サンプル(mock)1＋size-adaptive 再調整(mock+prod)1。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごとに commit+push 自走（standing 承認）／`main` は GF-AC 受入後にユーザー承認でマージ。QA は私が一次確認、視覚はユーザーがブラウザで GF-AC 受入。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript・`impl/frontend`）、バック＝FastAPI 4層（会社別DB動的ルーティング・`impl/backend`）。全画面・全横断ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝魔法発動演出をブラウザで受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）し、指摘を受けて実装する反復。

## 3. 今回やったこと（変更ファイルと理由）
> 正本＝進め方 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`／受入台帳 `doc/テスト/ゲーム感受入.md`／横断UI標準 `doc/画面設計/デザイン標準.md`。**このセッションで handoff §7-1 の「本命＝モックの魔法演出を production へ移植」が一通り完了**した。

### 3-A. モック演出の追加調整（`doc/画面設計/mocks/style-guide.html` §17・6コミット）
ユーザーのブラウザ指摘に応じて調整（`buildPersist`/`buildFire`/`wire` と各 `@keyframes`）:
- **オーラ永続**を「攻撃」から「**メッセージに活力を送るバフ**」に作り替え＝内側の呼吸発光(`.aura-breath`)＋外周の太陽フレア風コロナ(`.aura-flare`)＋輪郭の波動×3(`.aura-wave`)＋活力の粒。粒は最終的に「枠全体に散らして上へ浮上」（§3-C で実寸対応）。
- **氷永続**＝四隅からの**伝播ツリー**（`t1→t2→t3→t4`＋致命ヒビ `fatal/fa/fb/fc`＝既存節点を左→右になぞる折れ線）に。終盤で急加速（静穏→畳み掛け）・極細/薄色で本文可読性優先・角丸パネル内にクリップ・縁グローを段階(steps)化。

### 3-B. production 移植 A〜D（`impl/frontend`・8コミット・test-first）
純ロジックは `impl/frontend/src/features/spells/cast.ts`、テストは `cast.test.ts`（TC 台帳＝`doc/テスト/G_ゲーミフィケーション.md` の **G-TC-152/153/154**）。視覚は `impl/frontend/src/styles/design-system.css` と各コンポーネント。
- **Phase A**（`19d828f`）＝one-shot 発動演出 `components/ui/SpellCastFx.tsx` の属性別パレットトークン（`--flash`/`--spark`）を確立。
- **Phase B**（`c911b78`）＝**属性別デリバリー**（発射方式）。新 `components/ui/SpellDeliveryFx.tsx`＝発射元→対象へ火球/稲妻/氷礫/ビーム/三日月＋マズル。純ロジック `castDelivery`/`boltPoints`/`iceShards`/`crescentCount`。`IdeaChatView` の `castSpell`→`fireDelivery`（発動した魔法ボタン矩形を発射元に、着弾約420msで `fireCast`）。
- **Phase C**（`0920028`）＝**着弾バーストの属性別幾何**。`SpellCastFx` に雷=放射レイ/氷=結晶シャード/虹=多色リング/炎・オーラ・キラキラ=粒子を追加。純ロジック `castBurstKind`/`radialBurst`。
- **Phase D**（`8d07c63`/`0b37887`/`e5d7f21`/`f3541c3`/`cdf751b`）＝**属性別永続**。新 `components/ui/SpellPersistFx.tsx`＝炎(火柱)/雷(落ちる稲妻+スパーク)/虹(全幅アークclipワイプ)/オーラ(活力バフ)/氷(ガラス板+伝播ヒビツリー+割れ)。純ロジック `firePillars`/`thunderBolts`/`thunderSparks`/`rainbowArcBands`/`auraMotes`/`iceCrackTree`。`IdeaChatView` の魔法付きメッセージ枠に `<SpellPersistFx>` を重ねる。
- **炎の上端🔥emoji**（旧 `.spell-fx--fire::before`）は撤去し火柱に統一。魔法カタログ(SC-32)プレビューだけ `.spell-preview.spell-fx--fire::before` にスコープして従来の🔥を維持（退行防止）。

### 3-C. 実寸メッセージでの size-adaptive 再調整（`e8c8ac4`/`e5b9860`）
- **実測**＝本番チャットのメッセージ `.msg` は **約1056×102**（アスペクト ~10:1・viewport 1280）。モックの 340×150（縦長）とは別物で、パネル依存の永続がズレていた（氷=隅だけ・オーラ=中央固まり・炎=まばら）。
- **`SpellPersistFx`** に実測ラッパ `.spell-fx__layer`（`ResizeObserver` で枠を1回計測）を入れ、純ロジックに `w,h` を渡して寸法追従に:
  - `iceCrackTree(w,h)`＝**隅→中心の向き・長さは隅→中心距離に比例**（幅広でも中央までヒビが届く）。
  - `auraMotes(w,h)`＝中央発の放射→**枠全体に横分散して上へ浮上、数は幅に比例**。
  - `firePillars(w)`＝**火柱本数を枠幅に比例**（約44pxに1本・下限8）。
- **モック §17 に実寸サンプル**（`.fcast-stage--real`／`.demo-msg--real`・~1080×102）を追加し、`buildPersist(fx, msg)` が `msg` を実測して同ロジックで生成。実寸サンプルを headless で撮影し3効果の改善（氷=中央連結・オーラ=全幅分散・炎=密）を確認済み。

## 4. 現在の状態（動く / 壊れ / テスト）
- **frontend ゲート（cwd=`impl/frontend`・本セッション実測）**＝`npx tsc --noEmit` **クリーン**／`npx vitest run` **109 passed（14 files）**／`npm run build` **green**（いずれも `e5b9860` 直前コード＝以降は md/mock のみ変更）。
- **トレーサビリティ**＝repo ルート `python3 scripts/check_tc_traceability.py` → **✅（code 413）**。
- **純ロジック**＝`cast.ts` に**16関数**（うち今回 B/C/D で `castDelivery`/`boltPoints`/`iceShards`/`crescentCount`/`castBurstKind`/`radialBurst`/`firePillars`/`thunderBolts`/`thunderSparks`/`rainbowArcBands`/`auraMotes`/`iceCrackTree` を追加）。すべて決定的・vitest 担保。
- **モック演出**＝headless playwright（`file://` 直読み・`is-burning` 待ち・`getAnimations` を pause して currentTime シーク）で各属性を実測確認（console エラー0）。実寸サンプルも確認済み。
- **QA スタック**＝session 末に `docker compose --profile workers up -d --build` で起動中。**frontend は size-adaptive 版（`e5b9860`）で再ビルド済み**・`localhost:3000` 応答（`/login` 200）。backend/MailHog も稼働。
- **壊れているもの＝コード上は無し**。
- **GF-AC 受入状況**（`doc/テスト/ゲーム感受入.md`）＝**GF-AC-075/076 ✅**。**GF-AC-091（A〜D デリバリー/バースト/永続）はユーザーがブラウザ受入中＝「未確認」**（台帳の期待文は旧 `fbc0a91` 簡易版準拠のまま・豪華版移植後の更新が必要）。GF-AC-093（reduce-motion）も未確認。
- **backend テスト**＝**今回未実施**（backend 変更なし）。full pytest 未実測。

## 5. 詰まっている点（試した/失敗と理由）
- **モック調整値が実寸で崩れた**＝§17 のパネル依存演出（氷ツリー/オーラ放射粒/火柱本数）を 340×150 前提で固定パラメータ調整していたため、実寸 1056×102 では「氷=隅だけ・オーラ=中央固まり・炎=まばら」に。→ **枠実測（`ResizeObserver`）して純ロジックに w,h を渡す size-adaptive 化**で解決（§3-C）。教訓＝**パネル依存演出は最初から寸法追従で設計**する。
- **氷ヒビの直線が %位置＋px幅では枝が繋がらない**＝当初 iceCrackTree を固定基準px(300×110)で生成し座標を%変換していたが、実寸の異なるアスペクトでは枝先端が接続点からズレる。→ **実寸 w,h で直接生成**（隅→中心の atan2 方向・長さは隅→中心距離比）に変更して接続を保った。
- **Bash の cwd ドリフト**＝`( cd repo && python3 ... )` を非サブシェルで打つと以降の `npx tsc` が repo ルートで走り「This is not the tsc command」。→ frontend 系は毎回 `cd impl/frontend` を明示、traceability は `( cd repo && ... )` のサブシェルで。

## 6. 決定事項と根拠（不採用案も）
- **移植は属性単位の増分**（採用）＝Phase D は炎/雷/虹/オーラ/氷を個別 commit（各 green）。理由＝属性が独立で受入・切り戻しが容易。不採用＝一括大コミット（レビュー困難）。
- **氷は幅で「長さを比例拡大」・オーラは「幅方向に数を増やして散らす」**（ユーザー確定・AskUserQuestion）。不採用＝オーラ「半径を比例拡大」（中央発の放射のまま横長に伸ばす案・却下）。
- **炎の永続はチャットでは火柱のみ**（採用・モック準拠）＝上端🔥emoji を撤去。カタログ(SC-32)プレビューだけ emoji 維持（`.spell-preview` スコープ・退行防止）。
- **デリバリーの発射元＝発動した魔法ボタンの位置**（採用・当面）。理由＝アバター基盤（発動者/作成者）が無くても確実。不採用＝ヘッダーアバター発射（Phase E の受信4パターンで扱う）。
- **dead CSS を避ける**（採用）＝Phase A では属性別 `@keyframes` を移植せず、消費先 DOM と同時（B〜D）に入れた。
- **氷の段階グロー（ice-underglow）は production 未移植**（保留）＝production には mock の `burn-underglow`（下辺グロー機構）が無く、移植には新機構が要る。任意の繰り越し（§7-繰越）。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に `doc/テスト/ゲーム感受入.md` と `doc/フェーズ毎ルール/ゲーム感フェーズ.md` を確認。

1. **【最優先】GF-AC-091 のブラウザ受入完了**＝ユーザーが `localhost:3000` で A〜D（デリバリー/着弾バースト/属性別永続）を確認中。指摘があれば**モック §17「実寸メッセージ…」節（`.fcast-stage--real`）で調整→production の `cast.ts`/`design-system.css`/`SpellPersistFx.tsx` へ再ポート**。受入 OK なら `doc/テスト/ゲーム感受入.md` の GF-AC-091 を✅化し、**期待文を豪華版に更新**（現状は旧 `fbc0a91` 簡易版準拠）。
2. **Phase E＝受信/表示側4パターン**（handoff §7-2・**演出のみ先行**の決定済み）＝`IdeaChatView.tsx` のメッセージ描画で、作成者アバター（既存 `.avatar`）左＋**発動者バッジ右**（`magic.actor`・発動者≠作成者の時だけ）＋自作自演✦マーク。リビールは初回表示で1回（session の seen セット）。**realtime 受信・他人→自分のトースト＋通知both・backend 通知基盤接続は別タスクに分離**。
3. **Phase F＝A/B タイミング＋reduce-motion 全体**＝A: デリバリーを**文書座標アンカー**（現状 `fireDelivery` は `getBoundingClientRect()` のビューポート座標＝スクロールでズレうる）に。B: スクロール沈静(350ms)ゲート。全新規演出の reduce-motion を再確認（GF-AC-093）。参考実装＝モック §18（`fireAnchor`/`fcastWhenVisible`）。
4. **氷の段階グロー移植（任意）**＝production に永続の下辺グロー機構を足すか判断（§6 保留）。
5. **`feature/game-feel` → `main` マージ**＝GF-AC 一通り受入後・ユーザー承認で。マージ時に `impl/README.md` と本 handoff を追随更新。
6. **full backend pytest 実測（未実施）**＝§8 のコマンド（cwd=`impl`）。

- **共通ルール**＝backend 変更は再ビルドしないと反映されない。フロント検証は tsc/vitest に加え **`npm run build`（ESLint 込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。テストは md 先行・red-green（test-first は証跡をコミットメッセージに1行／後追い反転は `doc/テスト/red確認台帳.md`）。**push はユーザー承認不要（standing）だが `main` への push/マージは承認後**。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl` で `docker compose`）。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（109）／`npm run build`。backend スキーマ変更後は `npm run codegen`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（✅ code 413）。**cwd ドリフト注意**＝frontend 系は `cd impl/frontend` 明示、traceability は `( cd <repo> && python3 ... )` のサブシェルで。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` をブラウザで `file://` 直開き（§17＝魔法演出・§17内「実寸メッセージ…」節＝実寸サンプル・§18＝発動タイミング実験）。headless 検証は cwd=`impl/frontend` で `node`＋`playwright`（`import { chromium } from 'playwright'`・スクリプトは frontend 直下に置く＝node_modules 解決）→ `file://` を開く。**発火は `is-burning` 付与後**（`.fcast-stage.fcast-reveal .demo-msg.is-burning` を待つ／`el.getAnimations()` を pause し `currentTime` シークで各フェーズを撮る）。使い捨て `.mjs` は使用後に削除。
- **QA スタック起動**（本番接続画面の確認時／記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・**push 反映は `docker compose build frontend && docker compose up -d frontend`**）／MailHog＝`localhost:8025`／backend＝`localhost:8000`。反映確認＝`docker compose exec -T frontend sh -c "grep -rl '<一意文字列>' /app/.next"`（exit code を信じない）。
- **ログイン（dev・MFA なし）**＝`/login` で company_code=`ACME-01`／login_id=`user@acme.example`／password=`Passw0rd!` → ログイン（e2e ヘルパ `impl/frontend/e2e/sc-00-login.spec.ts` の `login()` と同じ）。チャットは `/ideas/{ideaId}/chat`。メッセージのあるアイデア例＝`101d1648-25e8-4809-a9ec-d5c779a14920`（実測に使用・5メッセージ）。
- **実寸計測の再現**＝上記でログイン→チャットへ→`.msg` の `getBoundingClientRect()`（viewport 1280 で 1056×102）。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`（ホストソースを走らせる・backend はイメージ焼き込みで `--reload` 無し）。
- **開発DB 手編集（コード外・seed 再構築で消える）**＝ACME-01 テナントDB `ideaquest_company_acme`／`user@acme.example`＝表示名「テスト 太郎」。テナントDB 参照＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（control DB＝`ideaquest_control`）。チャットは `chat_messages`（`idea_id` 列は無し・`chat_group_id`→`chat_groups.idea_id`）。
- 記憶（`~/.claude/.../memory/`）に運用ルール多数（`game-feel-async-pipeline`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`framer-reducemotion-null-flip`／`design-spec-working-style`＝UI仕様は選択肢提示より本人イメージからの仕様起こしを好む／`spec-is-source-of-truth`／`handoff-notes-often-stale` 等）。
