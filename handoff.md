# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-31 JST**（このセッション末）。
- **作業ブランチ＝`feature/game-feel`**（`origin` と同期・本 handoff コミットで作業ツリーはクリーンになる想定）。**`main` ではない**。
- 直前の実装コミット: **`7b14a82`** `fix(avatar): 3Dアバターの sticky パネルがヘッダーに被るのを解消`。本 handoff＋受入台帳の✅は次のコミットで積む。
- **`feature/game-feel` は `main` に未マージ**。マージはユーザーが GF-AC 受入を一通り終えてから（§7）。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごとに commit+push を自走（standing 承認）／`main` は承認後マージ。QA は私がフル起動して一次確認、視覚はユーザーがブラウザで GF-AC 受入。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript・`impl/frontend`）、バック＝FastAPI 4層（会社別DB動的ルーティング・`impl/backend`）。全画面・全横断ドメインは接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝ユーザーがブラウザで受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）し、指摘を受けて私が実装する反復。

## 3. 今回やったこと（変更ファイルと理由）
> 正本＝進め方 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`／受入台帳 `doc/テスト/ゲーム感受入.md`／横断UI標準 `doc/画面設計/デザイン標準.md`。以下は本セッションの主な変更（コミットは `git log` 参照）。

### 3-A. 戻り導線の標準化＋動的ラベル（`81e7c3e`/`8b786e5`/`bec5f81` ほか）
- **共通ヘルパ `impl/frontend/src/lib/nav.ts`**＝`backToListOr(router, fallback)`（履歴あれば `router.back()`／直アクセスは fallback へ）。さらに**ワンショット来歴（sessionStorage・消費即クリア）**＝`markIdeaFromQuest`/`consumeIdeaFromQuest`・`markEvalFromIdea`/`consumeEvalFromIdea`・`markQuestFromList`/`consumeQuestFromList`。
- **アイデア詳細の戻る**＝`IdeaDetailView.tsx`：`backToListOr(router, /quests/{questId})` で来た画面へ戻り一覧の絞込/スクロール復元。ラベルは動的＝クエスト一覧から来た時（or 直アクセス）だけ「← {クエスト名}へ戻る」、それ以外（ダッシュボードの評価下書き経由・チャット）は「← 戻る」。判定は `consumeIdeaFromQuest()`＋`window.history.length<=1`。
- **クエスト詳細の戻る**＝`QuestDetailView.tsx`：同方式。`QuestListView.tsx` の行/カードクリックで `markQuestFromList()`（**非下書きのみ**）を打ち、詳細で `consumeQuestFromList()`。ダッシュボード起点は「← 戻る」。
- **内部遷移は `<Link>` 必須**（`<a href>` は ESLint `@next/next/no-html-link-for-pages` で `next build` が落ちる。tsc/vitest は通るので要注意）。onClick で intercept したい時も `<Link href onClick={e=>{e.preventDefault(); …}}>`。

### 3-B. スクロール位置復元（`bec5f81`）
- **クエスト詳細→アイデア詳細→戻る でスクロール未復元**。Next の自動復元は戻り時に本画面が再取得＝一覧が高さ0の間にクランプされ効かない（playwright で before 900→戻り後 0 を実測）。
- `QuestDetailView.tsx`：module 定数 `QSCROLL_KEY`。行クリックで `sessionStorage[QSCROLL_KEY+questId]=window.scrollY` を保存し、`ideas` ロード後の useEffect で **rAF で「目標に届くまで」再試行復元**（`scrollRestored` ref・消費即クリア＝ドリルイン→戻る の1回だけ）。playwright で戻り後 900 復元を実測。

### 3-C. 評価まわり（`81e7c3e`/`b571798`/`6283bbc`）
- `EvaluationView.tsx`：①**フッターを標準 `.modal__footer`**（本文外・下端固定・右寄せ・区切り線）へ（存在しない `.modal__foot`＋左寄せだった）。②「**アイデア詳細を見る**」＝`window.location.replace(/ideas/{id})`（ソフト遷移だと intercept の @modal スロットが残る既知挙動＋replace で評価URLを履歴から除去→詳細⇄評価のループ解消）。③**アイデア詳細から開いた評価モーダルでは同リンクを非表示**（`consumeEvalFromIdea()`＝IdeaDetailView の「評価する/編集」で `markEvalFromIdea()`）。④確定成功で **`EVALUATIONS_CHANGED_EVENT`（`features/evaluations/api.ts`）を発火**。
- **評価確定の即時反映**＝`IdeaDetailView.tsx`（`load()` 再取得）と `DashboardView.tsx`（`getDashboard` 再取得で下書き消去・`data` のみ差し替えで継続投票 state は保持）が `EVALUATIONS_CHANGED_EVENT` を購読。intercept モーダル背後は再マウントされない自前 state のためイベントで更新。
- **選定の祝福を新規付与時のみに**＝backend `evaluations/application.py select_idea` が応答に **`xp_awarded`**（この呼び出しで新規付与したか・初回のみ true・冪等）を返す（`schemas.py IdeaSelectResponse`）。`IdeaDetailView.tsx handleSelect` は `xp_awarded` の時だけ祝福＋付与メッセージ（ON/OFF 反復で毎回演出しない）。テスト F-TC-113/115。

### 3-D. マスコット追従 ON/OFF 設定（`0eb8149`・backend＋frontend）
- 目立つ追従アニメを個別に切れる設定をプロフィール編集に追加。「動きを減らす」ON で自動 OFF（disabled・保存値は保持＝抑制解除で復帰）。
- backend＝`accounts.mascot_follow`（bool・既定 true）＝`control_plane/auth/orm.py`＋**migration `0014_accounts_mascot_follow.py`**＋`me/schemas.py`（MeAccountDTO/MeUpdateRequest）＋`me/application.py`（`_EDITABLE_FIELDS`＋応答）。account-only（users へミラーしない）。K-TC-022。
- frontend＝純ロジック `features/avatar/follow.ts mascotFollowEffective(reduced,follow)=follow&&!reduced`（K-TC-023 red-green）。`MascotFollower.tsx` に `follow` prop・`app/(app)/page.tsx` で `me.account.mascot_follow` を渡す。`ProfileForm.tsx` にチェックボックス。**schema.d.ts は openapi から `npm run codegen` で再生成**。

### 3-E. チャットの重大バグ2件（`073afe3`/`7f44f97`）
- **@ メンションでページごとクラッシュ（"エラー画面"）**＝`chat/api.ts getPartyMembers` の型がフラット `{user_id,display_name}` 想定だったが実応答は `{ data: [{ user: {user_id, display_name}, … }] }`（ネスト）。`IdeaChatView.tsx` の map が `m.display_name`（undefined）を読み `name` 未定義→候補描画の `charAt` が throw。ネスト読みに修正＋描画も防御（`(n.name||"?").charAt(0)`）。**パーティーメンバー（＝常に owner）がいる全チャットで @ が落ちていた**。playwright で確認。
- **ファイル添付が積まれない**＝`IdeaChatView.tsx` の file input onChange が `setPendingFiles((a)=>[...a, ...Array.from(e.target.files)])` の updater 内で files を**遅延参照**する一方、その前に `e.target.value=""` でクリアするため updater 実行時に空。ファイルを先に取り出してからクリアに修正（filechooser 経由で再現・修正確認）。

### 3-F. UI 崩れ・体裁（`6f08b57`/`1bd31dd`/`073afe3`/`7f44f97`/`38cd303`/`7b14a82`/`ebae3d4`）
- **チェックボックスのずれ根治**＝`.field > label`（display:block・太字・下余白, specificity 0,1,1）が `.checkbox`（0,1,0）の inline-flex を上書きしていた。`design-system.css` に `.field > label.checkbox { display:inline-flex; font-weight:400; margin-bottom:0 }`（mock の `shared.css` にも同期）。併せて ProfileForm を素テキスト構造に・`.checkbox>input` margin を mock と一致（`0.2em→1px`）。
- **ショップ/魔法のピクセルボタン幅**＝`.btn-pixel--sm`（`shop.css`/`spells.css`）の `padding:6px 12px` が基底の ▶ 用 `padding-left` を打ち消し、ホバーの▶がラベルに重なっていた。`padding-left: calc(12px+1.1em)` 維持＋`.btn-pixel` に `white-space:nowrap`。
- **ダッシュボードのフォロー中カード**＝カード全体を `<Link className="card">`（詳細へ）にして `a.card:hover` の hover リフトを効かせる。★解除は Link の外の兄弟＋`preventDefault/stopPropagation`。退場アニメは外側 `.follow-card-wrap`（framer）へ分離。GF-AC-080 を改定。
- **きせかえ画面**＝ショップ/魔法にある上部概要パネル（`.pixel-panel > .wallet`）を `AvatarView.tsx` に追加（COIN CountUp＋概要＋`▶ ショップへ` を `.btn-pixel` で統一）。`.wallet*` を `shop.css → design-system.css` へ移動（共有・直アクセスでも CSS が載る）。パネルと本体の余白＝`avatar.css .dressup { margin-top }`。3Dアバター sticky がヘッダーに被る→`.viewer` の `top: calc(var(--header-h)+var(--space-4))`。

### 3-G. 規約の昇格（`2480fb2`/`30b9961`）
- 個人メモにのみあった横断知見を規約へ。`コーディング規約.md §4`＝内部遷移は `<Link>`／フロント検証に `npm run build` 必須（ESLint 込み）／reduce-motion 抑制で `animate` を丸ごと外さない。`§5`＝設計書が正・食い違いは誤っている側を直す。`ドキュメント作成規約.md §2`＝設計判断は「なぜ」併記。

### 3-H. GF-073 検証と受入
- backend 再ビルドで信頼端末フィックス（前セッションの `5a891fa`）を反映しブラウザ検証（MFA/信頼端末 pytest 13 passed）。GF-073 の XP を再調整（§5 の開発DB編集）。

## 4. 現在の状態（動く / 壊れ / テスト）
- **frontend ゲート（cwd=`impl/frontend`・本セッション実測）**＝`npx tsc --noEmit` **クリーン**／`npx vitest run` **77 passed（13 files）**／`npm run build` **green（✓ Compiled successfully）**。
- **backend テスト（cwd=`impl`・ホストソースで実行）**＝`tests/me/test_me.py` **13 passed**（K-TC-022 含む）・`tests/evaluations/test_api.py -k select系` **5 passed**（F-TC-113/115 含む）。**full pytest は未実測**。
- **トレーサビリティ**＝repo ルートで `python3 scripts/check_tc_traceability.py` → **✅（code 413）**。
- **コンテナ**＝全て Up。`frontend=307`（正常リダイレクト）・`backend=200`。配信バンドルで各修正の反映を確認済み（build exit code でなく `docker compose exec frontend grep /app/.next` で確認する運用）。
- **壊れているもの＝コード上は無し**。**受入台帳の GF-AC-090/092 の✅マークが未コミット**（本 handoff コミットに含める）。
- **GF-AC 受入状況**（`doc/テスト/ゲーム感受入.md`）＝本セッションで ✅ 化＝**043・073・077・080（改定後）・081・082・090・092**。**GF-AC-091 は未実装**（§7-1）。

## 5. 詰まっている点（試した/失敗と理由）
- **Next の自動スクロール復元が効かない**＝戻り時に画面が再取得され高さ0でクランプ。→ 手動保存＋rAF 再試行復元で解消（§3-B）。
- **playwright の `setInputFiles` が React onChange を発火しても、当該 onChange の `value=""` で files が消える**＝これは実バグ（テスト由来でない）と判明。filechooser 経由でも再現し修正で解消（§3-E）。
- **backend はイメージ焼き込み**＝`impl/compose.yaml` の backend/worker/mail-worker は volume マウント無し・`--reload` 無し。ホスト編集は**再ビルドしないと実行に反映されない**。pytest は `docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest …`（cwd=`impl`）でホストソースを走らせる。migration（0014）は entrypoint bootstrap で適用＝backend 再ビルドで反映。
- **`docker compose up -d --build` は build 失敗時でも旧コンテナが残り exit を誤認しやすい**＝**配信バンドル（`/app/.next`）を grep して反映を確認**する運用に統一（記憶 `frontend-build-gate-eslint`）。

### 開発DB を手で改変済み（コード・git ではない。次回の自分へ注意）
> ACME-01 テナントDB＝`ideaquest_company_acme`。`user@acme.example`＝表示名「テスト 太郎」・control DB の account_id＝`35c2e02f-9072-4555-95b5-ff0caf742f66`。**seed 再構築で消える一時状態**。
- **GF-073 用**：テスト太郎の `users.xp` を **97588**（Lv61・次まで12）に変更（戻す＝`UPDATE users SET xp=93845 WHERE display_name='テスト 太郎';`）。投票用公開アイデア5件 `title LIKE 'GF073投票用_%'`（author=E2E 発行太郎・"New Quest"）。
- **GF-077 用**：テスト太郎の votes＋vote-XP activities を上記5件でリセット（未投票化）＋雛形複製で `title LIKE 'GF077投票用_%'` を3件追加（published・他者作）。結果＝**テスト太郎の未投票公開アイデア8件・本日 vote XP 0**。ダッシュボードのクイック投票で「+5 XP（初回5票）／6票目以降は上限超過で出ない」を検証可能。消す＝`DELETE FROM ideas WHERE title LIKE 'GF077投票用_%';`（子 idea_revisions も）。

## 6. 決定事項と根拠（不採用案も）
- **戻り動作は常に `router.back()`＋ラベルは動的**（採用）。不採用＝常にクエストへ push（一覧の絞込/スクロール復元が壊れる・ユーザー要望のダッシュボード復帰にならない）／ラベルを常に「クエスト名へ戻る」（動作と不一致）。判定は sessionStorage のワンショット来歴（referrer は SPA ソフト遷移で更新されず不可）。
- **スクロール復元は手動保存＋rAF 復元**（採用）。不採用＝Next の自動復元頼み（再取得でクランプし効かない）。
- **選定の祝福は backend `xp_awarded` で判定**（採用）。不採用＝フロントの `is_selected` だけ（再選定でも毎回演出＝ユーザー指摘）。
- **`.checkbox` は `.field>label.checkbox` の明示リセットで根治**（採用・design-system.css と mock を同期）。不採用＝margin/span だけの調整（真因の display:block 上書きが残り直らなかった）。
- **`.wallet*` は design-system.css へ移動**（採用・ショップ/きせかえ共有＋直アクセスで CSS が載る）。不採用＝shop.css のまま（/avatar 直アクセスで未ロード）。
- **評価「アイデア詳細を見る」はハードナビ replace**（採用）。不採用＝ソフト遷移（intercept @modal スロットが残る）／assign（評価URLが履歴に残りループ）。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に `doc/テスト/ゲーム感受入.md` の未確認/要修正 と `doc/フェーズ毎ルール/ゲーム感フェーズ.md` を確認。

1. **GF-AC-091 の実装（ユーザー依頼・未着手）**＝魔法発動の「中央に魔法アイコンが表示され外側に広がる」演出を**種別ごとに変え、ランク（レアリティ）が高いほど派手に**する。着手＝発動演出の実体 `impl/frontend/src/components/ui/` の **SpellCastFx**（`CastRect` を受ける・`IdeaChatView.tsx`/`SpellsView.tsx` の `fireCast(...)` で発火）＋`design-system.css` の spell 系キーフレーム/`.spell-fx`。魔法の種別＝`getSpells` DTO の `effect`、ランク＝`rarity`（common/standard/rare）。**現状は種別ごとに色/動きは変わる（GF-AC-091 の一部は✅相当）が、中央アイコンの拡散とランク差は未対応**。純ロジックがあれば vitest red-green、視覚は GF-AC。reduce-motion 抑制ケース必須（テスト規約）。
2. **GF-AC の受入継続**＝ユーザーがブラウザで確認→私が `doc/テスト/ゲーム感受入.md` を✅化。直近実装（@メンション/ファイル添付/きせかえパネル/スクロール復元/評価反映 等）は**ブラウザ最終確認 未取得**のものがある。
3. **`feature/game-feel` → `main` マージ**＝GF-AC を一通り受入後にバッチで。マージ時に本 handoff と `impl/README.md` を追随更新。
4. **full backend pytest の実測**（未実施）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest -q`（cwd=`impl`・worker 停止不要＝throwaway DB）。

- **共通ルール**＝backend 変更は再ビルドしないと実行に反映されない（§5）。フロント検証は tsc/vitest に加え **`npm run build`（ESLint 込み）必須**。テストは md 先行・red-green（`doc/テスト/red確認台帳.md`）。`main` への push はユーザー承認後。非自明な認証/セキュリティ変更は ADR 追補＋ユーザー承認。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl` で `docker compose` 実行）。
- **QA スタック起動**（記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。フロント＝`localhost:3000`（本番ビルド焼き込み・push 反映は `--build` 再ビルド必須）／MailHog＝`localhost:8025`（MFAコード）／backend＝`localhost:8000`。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（77）／`npm run build`。backend スキーマ変更後は `npm run codegen`（openapi→`src/lib/api/schema.d.ts` 再生成・backend 起動が前提）。
- **反映確認**＝`docker compose exec -T frontend sh -c "grep -rl '<一意文字列>' /app/.next"`（exit code を信じない）。
- **backend テスト**（cwd=`impl`）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q`。
- **e2e（playwright・再現/検証に有用）**＝cwd=`impl/frontend` で `npx playwright test <spec>`（baseURL 既定 `localhost:3000`・ログイン helper は `e2e/sc-24-chat.spec.ts` 等を参照。**ログイン成功待ちは `waitForURL("http://localhost:3000/")`**＝greeting 文言は時間帯で変わり "ようこそ" 固定待ちは不可）。使い捨て spec は使用後に削除する。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`。
- **テナントDB 直参照例**＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（control DB＝`ideaquest_control`）。
- 記憶（`~/.claude/.../memory/`）に運用ルール多数（`game-feel-async-pipeline`／`game-feel-qa-parallel-ops`／`frontend-build-gate-eslint`／`animation-reduce-motion-standard`／`framer-reducemotion-null-flip`／`spec-is-source-of-truth` 等）。
