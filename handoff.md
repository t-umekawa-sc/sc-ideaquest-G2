# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-05 21:26 JST**（このセッション末）。
- 作業ブランチ＝**`feature/game-feel`**（`origin/feature/game-feel` と同期・作業ツリー clean）。**`main` ではない・未マージ**。
- 最新コミット＝**`4f45229`** `fix(chat): 発動者バッジとホバー操作メニューの右上での重なりを回避`。
- 本セッションのコミットは **`fd0eb12`〜`4f45229`**（`git log --oneline` 参照）。**前半＝モック(style-guide.html)の作り込み／後半＝production への炎移植＋チャット魔法UXの整備**。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごと commit+push 自走（standing 承認）／`main` は受入後にユーザー承認でマージ。
- **モック→production の順**（記憶 `game-feel-mock-first-then-port`）＝演出はまず `doc/画面設計/mocks/style-guide.html` で受入→production 移植。**モックはユーザー受入済み（"style-guide.html ok"）**。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝SC-24 チャットの魔法発動演出を、受入済みモック（`style-guide.html §17L`＝明色パネル向けライト版）から **production の canvas エンジンへ1スペルずつ移植**中。

## 3. 今回やったこと（変更ファイルと理由）

### A. モック `doc/画面設計/mocks/style-guide.html`（前半・受入済み）
- **§17L-f2（虹・放浪バリエーション）を反復調整**（`fd0eb12`〜`8fd425e`）＝`createRainbowScatterSpellLight`。虹ビーム中央着弾→虹粒子が満遍なく飛散→**飛散粒子の1つの位置へ**ゆらゆら＋開始ディレイのむらで**ゆっくり集結**→全集結後に溜め→中央へ再ビーム、を繰り返す。ビームは毎回**パネル中央**狙い。
- **§17L-g（オーラ・ライト版）を新設**（`40b0a6d`）＝`createAuraSpellLight`。ダーク §17g の明色移植（波動＋応援記号→縁からドット絵オーラ上昇・紫↔金↔青巡回）。
- **§17 整理**（`b1332ed`）＝旧CSSギャラリー(§17 の却下版)＋§17c(小ギャラリー)を削除。§17＝「受信/表示側の4パターン(発動者→作成者)」だけ残し、最新のライト版ピクセル炎(`createPixelFireLineLight`)で再構築。共有CSS(`.msg-avatar*`/`.fcast-caster`+`caster-kick`)は保持。
- **全魔法アニメに B(演出の間引き)を導入**（`45a41ca`）＝グローバル関数 `whenSettledVisible(el,cb)`＝可視かつスクロール静止約180ms後に1回だけ発火／高速スクロール中は間引き。全14トリガを置換。A(着弾ずれ)は canvas を対象内に描く現行設計で担保（＝モック内の話。production では別途）。
- **§17L-f(囲む虹)を削除**（`f5b2cf9`）＝放浪版 §17L-f2 のみ残す（ユーザー指示）。
- 結果、ライト版ラインナップ＝炎(§17L-b)/雷(§17L-d)/氷(§17L-e)/**虹＝放浪 §17L-f2 のみ**/オーラ(§17L-g)/キラキラ(§17L-h)。

### B. production 移植・チャット魔法UX（後半）
> 移植方針＝**1スペルずつ・炎→雷→氷→虹→オーラ**（ユーザー選択）。**炎のみ完了**。参照実装＝`impl/frontend/src/features/spells/engines/sparkle.ts`。
- **炎を canvas エンジンへ移植**（`afe9461`）＝新規 `impl/frontend/src/features/spells/engines/fire.ts` の `createFireEngine`（`SpellEngine` 契約: start/startPersist/resume/reduceStatic/stop）。モック §17L-b の延焼を TS 移植（低解像度ドット絵 pixelated＋暖色ハロー）。`engines/index.ts` の `ENGINES` に `fire` 登録＝`isCanvasEffect("fire")=true`。決定的部分 `fireGrid`/`fireFade` を分離し **G-TC-156**（`engines/fire.test.ts`／`doc/テスト/G_ゲーミフィケーション.md` 5-F）。
- **リアクションを演出canvasの前面に**（`c59174c`）＝`.spell-fx__layer` に z-index:0、`.reaction-bar` を z-index:1（`styles/design-system.css`）。
- **魔法発動の起点ポリシーを整理・実装**（`bd5220a`〜`6b37ce7`／正本＝`doc/画面設計/screens/SC-24_アイデアチャット.md` の 4.3b「魔法発動アニメの起点ポリシー」）。最終形＝**①②とも「メッセージ内の発動者アバターバッジ」起点で canvas 枠内完結**（ヘッダー起点は画面横断ゆえ発射レイヤが要り重いため**不採用**）:
  - `IdeaChatView.tsx` に**発動者アバターバッジ `.msg__caster`**（右上・`actor` イニシャル＋hover）を新設。**自作自演**（`mine?is_mine:actor===author.name`）は右上バッジ無し＋**作成者アバター `.msg__author` に✦**。
  - `SpellCanvasFx.tsx` は `originSelector`（非自作＝`.msg__caster`／自作＝`.msg__author`）を発射元に。`useSpellEngine.ts` は**初回表示で1回だけ**バッジ起点で発射→着弾→永続（再生成は `startPersist()`）。`justCast`/`castFrom`/`canvasCast`/`headerAvatarPoint`/`fireCanvasDelivery` は撤去済み。
  - **① 新規発動**＝バッジ(自作は✦)を `is-summoning` で「唱える」ように出現（`chat.css` の `badge-summon`）→出現しきってから（`SUMMON_MS≈450ms`）着火。実装＝`IdeaChatView.summonThenCast(msgId)`＋`pendingCanvas` で出現前の着火を抑止。
  - **canvas 魔法全種に適用**（sparkle 等も表示時に発射を再生）＝旧「リロード非再生」方針を本ポリシーで更新。
- **四角枠バグ修正**（`246898e`）＝リングを丸い `.avatar__img` に付与（`.avatar` ラッパは四角）。
- **SC-32 前提未達カードのフッター崩れ修正**（`51bfa4c`）＝`spells.css` で `.spell-cost` を nowrap・`.spell-card__foot` を flex-wrap・`.btn-pixel` を折返し可。
- **発動者バッジとホバー操作メニューの重なり修正**（`4f45229`）＝`chat.css` の `.msg:has(.msg__caster) .msg__actions` を right:48px へ。

## 4. 現在の状態（動く / 壊れ / テスト）
- **モック（style-guide.html）＝ユーザー受入済み・動作OK**（各変更で headless console error 0 実測）。
- **production 炎移植＝コード完了・全ゲート緑**（最後に実測: `npx tsc --noEmit` EXIT0／`npx vitest run` **124 passed**／`npm run build` 成功／traceability `python3 scripts/check_tc_traceability.py` **✅ code413**）。**実ブラウザ受入はユーザー確認中**（未完了）。※`51bfa4c`/`4f45229` は CSS のみで build 成功のみ確認、tsc/vitest は前回(`6b37ce7`)の緑が有効。
- **炎エンジン単体は実ブラウザで描画確認済み**（esbuild でバンドル→playwright で `createFireEngine` を start/reduceStatic/startPersist＝いずれも炎ピクセル描画・error 0）。**バッジ起点の発射**も headless で「火の玉が右上バッジ→中央下部へ飛来」を実測。
- **雷/氷/虹/オーラ＝production は未移植（CSS のまま）**。canvas は sparkle+fire のみ（`engines/index.ts` の `ENGINES`）。
- **壊れているもの＝把握している範囲では無し**。ユーザー報告のUI不具合（リアクション背面・四角枠・フッター崩れ・バッジ重なり）は本セッションで各々修正済み。
- **backend pytest は本セッション未実行**（frontend/mock のみの変更のため）。

## 5. 詰まっている点（試した/失敗と理由）
- **ヘッダーのユーザーアバター起点（①）は不採用**＝canvas はメッセージ枠内に限定され、ヘッダー→メッセージの飛行の大半が枠外で見えない。CSS 発射レイヤ(`SpellDeliveryFx`)再利用で画面横断させる案も一度実装(`5ca4391`)したが、ユーザー要望で「処理的に無理のない枠内起点」に方針転換＝**発動者バッジ起点に統一**（`6b37ce7` で CSS 発射レイヤ経路は撤去）。
- **発動者アバターの画像は出せない**＝魔法リアクションDTO（`components["schemas"]["ChatMessageDTO"].reactions` の magic）は `{spell_id,effect,icon,actor(表示名),mine}` のみで **actor のアバターURL/IDが無い**。バッジは**イニシャル表示**が現状の限界（画像化は backend 拡張が要る＝未対応）。
- **headless での time依存演出の目視は不安定**（既知）＝canvas+rAF。検証は基本 console error 0＋ピクセル/配列のデータ整合＋短時間サンプルで担保。使い捨て `.mjs` は `impl/frontend` 直下に作り**使用後削除**（playwright の node_modules 解決）。

## 6. 決定事項と根拠（不採用案も）
- **魔法発動起点＝①②とも発動者アバターバッジ（自作自演は作成者アバター）**。ヘッダー起点・画面横断案は「構造的に重い」ため不採用。バッジ起点は canvas 枠内で完結し全飛行が見える・モック §17「4パターン(発動者→作成者)」に完全準拠。正本＝`SC-24_アイデアチャット.md` 4.3b。
- **① 新規発動＝バッジを summon 表示→出現後に着火**（ユーザー要望「唱えている感じ」）。
- **canvas 魔法は表示(リロード)時も発射を再生**＝旧 sparkle の「リロード非再生」方針を上書き（4パターン完全再現のため）。
- **虹ライト版＝放浪 §17L-f2 のみ**（囲む §17L-f は削除）。
- **炎移植＝モック §17L-b を忠実 TS 化**（延焼CAは rng 注入で非決定・GF-AC 受入／決定的な `fireGrid`(解像度)・`fireFade`(可読性フェード)のみ G-TC-156 で unit 担保）。sparkle と同じ contract。
- **リアクション/バッジ/✦ は演出canvasの前面**（z-index）＝操作可能・可読性優先。ホバー操作メニューはバッジ右上と衝突するため `:has` で左へ退避。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。移植は**1スペルずつ・炎→雷→氷→虹→オーラ**。

1. **炎の実アプリ受入待ち**＝ユーザーがチャットで【炎】を発動して確認中。もし追加調整が出たら `engines/fire.ts`／`chat.css`／`IdeaChatView.tsx` で対応。
2. **②雷（§17L-d）を production 移植**＝新規 `impl/frontend/src/features/spells/engines/thunder.ts` に、モック `createPixelThunderLight`（style-guide.html §17L-d）を `SpellEngine` 契約(start/startPersist/resume/reduceStatic/stop・rng 注入・origin は size.w 単位→内部座標へ変換)で移植。`engines/index.ts` の `ENGINES` に `thunder` 追加。決定的部分があれば分離して `doc/テスト/G_ゲーミフィケーション.md` に **G-TC-157** を追記→**red-green**→`python3 scripts/check_tc_traceability.py` ✅。フロントゲート(tsc/vitest/build)。**炎移植(`afe9461`)を雛形にする**。
3. **③氷 §17L-e → ④虹 §17L-f2 → ⑤オーラ §17L-g** を同様に移植（`createIceSpellLight`/`createRainbowScatterSpellLight`/`createAuraSpellLight`）。虹はライト版が放浪 §17L-f2 のみな点に注意。
4. **発動者バッジのアバター画像化（任意・要backend）**＝魔法リアクションに actor のアバターURLを載せれば `.msg__caster` を画像バッジにできる。現状イニシャル。
5. **GF-AC 受入台帳の追随**＝`doc/テスト/ゲーム感受入.md`（`GF-AC-NNN`）に本セッションの production 移植分の受入行が要るか未確認。要すれば追記。
6. **`feature/game-feel` → `main`**＝GF-AC 一通り受入後・ユーザー承認で。マージ時に `impl/README.md` と本 handoff を追随更新。
- **共通ルール**＝フロント検証は `npx tsc --noEmit`＋`npx vitest run`＋**`npm run build`（ESLint込み）必須**（記憶 `frontend-build-gate-eslint`）。内部遷移は `<Link>`。push は standing 承認・`main` は承認後。全アニメは reduce-motion 尊重（記憶 `animation-reduce-motion-standard`／ハーネスが `reduceStatic()` を呼ぶ）。テストは**先に md に TC 行(`根拠`列)→red-green→traceability ✅**（記憶／テスト規約 §5.1）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl`）。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` をブラウザ `file://` 直開き。ライト版＝§17L-b(炎)/§17L-d(雷)/§17L-e(氷)/§17L-f2(虹・放浪)/§17L-g(オーラ)/§17L-h(キラキラ)。§17＝受信/表示4パターン。
- **production 魔法FXの要所**（`impl/frontend/src`）＝`features/spells/engines/index.ts`(レジストリ`ENGINES`＋`SpellEngine`型)／`engines/sparkle.ts`(参照実装)・`engines/fire.ts`(移植済)／`features/spells/useSpellEngine.ts`(ライフサイクル・origin は originSelector→バッジ)／`components/ui/SpellCanvasFx.tsx`(薄ラッパ・props＝effect/originSelector)／`features/chat/components/IdeaChatView.tsx`(castSpell/summonThenCast/発動者バッジ/自作自演判定)／`features/chat/chat.css`(バッジ/✦/summon/操作メニュー退避)／`styles/design-system.css`(spell-fx*/spell-cast*/spell-deliver*)。CSS未canvas化＝thunder/ice/rainbow/aura は `SpellPersistFx.tsx`＋`design-system.css` の CSS。
- **フロントゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（現状 124）／`npm run build`。backend スキーマ変更後は `npm run codegen`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（現状 ✅ code413）。cwd ドリフト注意（frontend 系は `cd impl/frontend`、traceability は repo ルート）。
- **エンジン単体の実ブラウザ検証**＝`cd impl/frontend && npx esbuild src/features/spells/engines/<eff>.ts --bundle --format=esm --outfile=/tmp/x.mjs` → playwright で `data:` import → `create<Eff>Engine({w,h,dpr:1})` を append→start。型のみ import なので単体バンドル可。使い捨て `.mjs` は削除。
- **QA スタック起動**（実アプリ確認時／記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・push 反映は `docker compose build frontend && docker compose up -d frontend`）／MailHog＝`localhost:8025`／backend＝`localhost:8000`。
- **ログイン（dev・MFAなし）**＝`/login` company_code=`ACME-01`／login_id=`user@acme.example`／password=`Passw0rd!`。チャット＝`/ideas/{ideaId}/chat`（例のアイデアIDは会話ごとに異なる・アイデア一覧から辿る）。魔法解放＝`/spells`（SC-32）。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`。
- **記憶**（`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/`）＝特に本フェーズ＝`game-feel-async-pipeline`／`game-feel-mock-first-then-port`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`handoff-notes-often-stale`（着手前にコードで裏取り）／`spec-is-source-of-truth`。
