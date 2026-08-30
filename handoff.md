# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-30 16:33 JST**。
- **作業ブランチ＝`feature/game-feel`**（`origin` と同期・**作業ツリーはクリーン**）。**`main` ではない**。
- 最新コミット: **`ef2cca0`** `feat(ui): 戻るリンクのフローティングを9画面に展開`。
- **`feature/game-feel` は `main` に未マージ**（ゲーム感フェーズの全増分がこのブランチに積まれている）。マージはユーザーが GF-AC 受入を一通り終えてから（§7-5）。
- 運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝`feature/game-feel` へ増分ごとに commit+push を自走（standing 承認）／`main` は承認後マージ。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript）、バック＝FastAPI 4層（会社別DB動的ルーティング）。全画面・全横断ドメインは接続済み。**現在は「ゲーム感（juiciness）向上」フェーズ**＝ユーザーがブラウザで受入（`doc/テスト/ゲーム感受入.md` の `GF-AC-NNN`）し、指摘を受けて私が実装する反復。

## 3. 今回やったこと（変更ファイルと理由）
> 本セッションは長く、ゲーム感の増分実装＋ユーザー指摘の多数修正＋認証バグ修正。**正本＝** 進め方 `doc/フェーズ毎ルール/ゲーム感フェーズ.md`／受入台帳 `doc/テスト/ゲーム感受入.md`／横断UI標準 `doc/画面設計/デザイン標準.md`。以下は主な変更（コミットは `git log` 参照）。

### 3-A. 投票カードのアニメ（GF-AC-040/042・難航の末に決着）
- 最終方式＝**手組み FLIP（First-Last-Invert-Play）**。`impl/frontend/src/features/dashboard/components/DashboardView.tsx`：`useIsoLayoutEffect`（module 定数）で各投票カードの `offsetTop/Left`（スクロール非依存）の First/Last を測り WAAPI `el.animate` で旧→新位置へスライド。`voteCardEls`/`voteRects` ref。**framer の `layout` は不採用**（グリッドで残留 transform が蓄積しカードが下へドリフト）。
- 投票は **即時に配列から除外**（`unvotedList` state を filter）＝退場カードを `position:absolute` にしない（absolute 化がビューポート上部の DOM を変え、ブラウザのスクロール補正で下ずれを誘発したため）。`impl/frontend/src/features/dashboard/dashboard.css` に `.dash-page { overflow-anchor: none; }`・`.vote-grid { position: relative }`。
- 火花/XPフロートは `impl/frontend/src/features/dashboard/components/DashboardFx.tsx`（imperative handle `burst`/`xpFloat`）に**隔離**＝時間差消去の setState で DashboardView を再描画させない（繰り上がり後の再ゆれ防止）。`SparkBurst`/`XpFloat` は `impl/frontend/src/components/ui/` へ移設（CSS は `design-system.css`）。

### 3-B. 継続投票（GF-AC-043）
- `DashboardView`：未投票は `unvotedList` ローカル state（`data` 派生をやめた）。`quickVote` 成功後に `getDashboard` を再取得し、まだ表示していない未投票を**末尾に1件追記**（6→5で6個目補充・リロード不要）。

### 3-C. アイデア詳細（SC-22）
- `impl/frontend/src/features/ideas/components/IdeaDetailView.tsx`：投票成功で更新系と同じ成功トースト＋ダッシュボード共通演出（`SparkBurst`/`XpFloat`＋`router.refresh`）＝#33。賛否バーは **0-0 でも空バー常時表示**＋賛成=左アンカー/反対=右アンカー（`ideas.css .vote-bar__agree/__disagree` を絶対配置・解除は逆方向に引っ込む）。「← {クエスト名}へ戻る」に `#quest-tabs`＋フローティング。

### 3-D. クエスト画面
- `impl/frontend/src/features/quests/components/QuestDetailView.tsx`：上部を**2行**（1行目=概要｜新規**クエストKPIパネル** `.quest-kpi`＝アイデア/パーティー/締切まで/評価済み、2行目=ランキング｜アクティビティ）。「＋ アイデアを追加」をヘッダーから**アイデアタブの一覧上部**へ。アイデア詳細から戻った時に**タブを画面上部へスクロール**（`useRef alignedRef`＋`ResizeObserver` で上部パネル遅延ロード後も再整列）。戻るリンク float。`quests.css` に `.quest-kpi*`・`#quest-tabs { scroll-margin-top }`・`.ideas-tab-toolbar`。

### 3-E. アイデアチャット（SC-24）
- `impl/frontend/src/features/chat/components/IdeaChatView.tsx`：**コンポーザーをモック準拠に**（`insertFmt`/`insertMentionAt`/`insertEmoji`＝📎 @ 😀 B `</>` 🔗＋「ⓘ 使い方」「⌄ 最小化」）。本文描画 `renderTextHtml` は元から `**太字**`/`` `コード` ``/`[](url)`/`@mention` 対応済み＝CSS も移植済みで JSX の実装漏れだった。上部**文脈パネルを折りたたみ可**（`ctxOpen`・たたむと右に戻るリンク）＋パネル自体をフローティング（`.chat-context--float`）。

### 3-F. 評価ダイアログ（SC-25）
- `impl/frontend/src/features/evaluations/components/EvaluationView.tsx`：本文を `.modal__body` で包み**スクロール可**に（従来パネル直下で切れて確定ボタン到達不可）。**枠を module レベル `EvalFrame` に切り出し**（★ホバー等の再描画で本文 DOM が作り直され先頭へ自動スクロールする不具合＝コンポーネント内 `Frame` 定義が原因）。「アイデア詳細を見る」は `onClose`（intercept モーダルを正しく閉じる）。

### 3-G. 横断・その他
- **戻るリンクのフローティング共通UI**＝`design-system.css .backlink--float`（sticky ヘッダー直下・surface ピル）。`doc/画面設計/デザイン標準.md` §4.10 に明文化。適用＝クエスト一覧/クエスト詳細/アイデア詳細/チャット、および ランキング/ショップ/きせかえ/魔法/通知/実績/**admin 3画面**（`CompanyList`/`AccountSelfSection`/`QuestGroupAdminView`）。**注意＝sticky は親の高さ内でのみ効く＝`<p>` 等1行要素で包まず tall コンテナ直下に置く**。
- **ヘッダーのコイン数値ロール**＝`impl/frontend/src/components/layout/AppHeader.tsx` に `CountUp`（GF-AC-061）。ショップ購入後 `router.refresh()` でヘッダー残高更新（`ShopView.buy`）。
- **プロフィール保存の通知統一**＝`ProfileForm.tsx`（`useSnackbar` に統一）＝#32。`.checkbox` の縦位置を em 補正（`design-system.css`）。
- **時間帯の挨拶**＝`impl/frontend/src/lib/greeting.ts`（`greetingFor(hour)`・I-TC-154）＝#31。
- **マスコット追従の暫定版**＝`impl/frontend/src/features/avatar/components/MascotFollower.tsx`＝アバターアイコンが追従（3D VRM 未整備の代替・#20・GF-AC-200..202）。
- **クエスト内アクティビティ日時の視認性**＝`feed.css` で `.pixel-panel .feed__time` 等を明色に（暗背景で低コントラストだった）。

### 3-H. 信頼端末（MFA）の複数ユーザー対応（backend・`5a891fa`）
- 症状＝同一ブラウザで別ユーザーがログイン/信頼すると `iq_trust`（単一クッキー）が上書きされ、前ユーザーに戻ると DB の信頼端末は有効なのに再び MFA 要求（`t-umekawa → scdev01 → t-umekawa` で再現）。
- 対応＝`impl/backend/app/control_plane/auth/router.py`：`_parse_trust`／`_set_trust_cookie` を**追記式**（カンマ区切り複数トークン・上限10）／logout-all は **`iq_trust` を削除しない**（DB revoke で当該アカウントは不一致→MFA、他ユーザー分は温存）。`application.py`：`login` の引数を `trust_tokens: list[str]`、`_match_trusted` で各トークンを突合。ADR-0004 §2.3.1 追補、`doc/テスト/A_認証.md` A-TC-071/072、テスト `impl/backend/tests/auth/test_auth_mfa.py`。

## 4. 現在の状態（動く / 壊れ / テスト）
- **frontend（本セッションで実測・repo ルート基準は `impl/frontend`）**＝`npx tsc --noEmit` **クリーン**／`npx vitest run` **74 passed**／`npm run build` **green**。
- **backend トレーサビリティ**＝repo ルートで `python3 scripts/check_tc_traceability.py` → **✅（code 412）**。※ `GF-AC-` と `src/**/*.test.ts` は走査対象外（`impl/backend/tests/**`＋`impl/frontend/e2e/**` のみ）。frontend 単体は md（I-TC-15x）で追跡。
- **backend MFA/信頼端末テスト**＝**13 passed**（A-TC-071/072 含む）。ただし**ホストのソースをマウントして実行**した結果（下記 §5・§8）。
- **GF-AC 受入**＝`doc/テスト/ゲーム感受入.md` で **✅ OK 行 31 件**。直近で実装した以下は**ブラウザ受入 未確認**：GF-AC-043（継続投票）・330/331/332（SC-22 投票演出）・340..343（#34 opacity/繰り上がり）・評価モーダルのスクロール/★ホバー修正・9画面のフローティング戻るリンク・信頼端末（要 backend 再ビルド）。
- **壊れているもの＝コード上は無し**（build/tsc/vitest green）。**ただし実行中 backend には信頼端末フィックスが未反映**（§5）。

## 5. 詰まっている点（試した/失敗と理由）
- **backend はイメージ焼き込み**＝`impl/compose.yaml` の backend/worker/mail-worker は**ソースを volume マウントせず `uvicorn` は `--reload` なし**。よって**ホストのコード編集は実行中コンテナに反映されない**。
  - 影響1＝信頼端末フィックス（`5a891fa`）は commit 済みだが**実行中 backend は旧コードのまま**。ブラウザ検証には **`docker compose up -d --build backend worker mail-worker`（cwd=`impl`）で再ビルド**が必要。
  - 影響2＝`docker compose exec backend pytest` は**コンテナ内の旧テストコード**を走らせる（新テストが動かず「passed」に見えて誤認しかけた）。新コード/新テストは **`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest ...`（cwd=`impl`）** で実行する。
- **framer-motion `layout` はグリッドで使うと残留 transform で下へドリフト**＝#34 で採用→ドリフト→`overflow-anchor` でも直らず→最終的に**手組み FLIP＋absolute 廃止**で解消（§3-A）。
- **`Frame` をコンポーネント内で定義するとホバー再描画で本文が先頭スクロール**（§3-F）＝module レベルに出して解消。記憶 `framer-reducemotion-null-flip` と同系統の「再描画でのリセット」注意。

### 開発DB を手で改変済み（コード・git ではない。次回の自分へ注意）
> GF-AC-073（満杯付近でクランプ）検証用に ACME-01 テナントDB `ideaquest_company_acme` を直接編集した。**seed からの再構築で消える一時状態**。
- テスト太郎（display_name=`テスト 太郎`）の `users.xp` を **93845→94488**（Lv.60・次まで12）に変更。戻す＝`UPDATE users SET xp=93845 WHERE display_name='テスト 太郎';`。
- テスト太郎の**下書きを全削除**（ideas 11・quests 2・evaluations 2＋子テーブル）。
- 「New Quest」(`cef6643d-e5fe-41e1-970b-727a7ce128c8`) に**投票用の公開アイデア5件**を追加（title `GF073投票用_%`・author=E2E 発行太郎）。消す＝`DELETE FROM ideas WHERE title LIKE 'GF073投票用_%';`（子＝idea_revisions は CASCADE でなければ手動）。

## 6. 決定事項と根拠（不採用案も）
- **投票カードのアニメは手組み FLIP＋WAAPI**（採用）。不採用＝framer `layout`（グリッドでドリフト）／`popLayout`（穴は消えるがドリフト）／absolute 退場（スクロール補正で下ずれ）。WAAPI は終了後 transform を残さない＝ドリフト無し。
- **`iq_trust` は複数トークン保持（追記式）**（採用・ADR-0004 §2.3.1）。不採用＝単一トークン（別ユーザーのログインで上書き＝再 MFA）。logout-all はクッキー削除せず DB revoke に委ねる（他ユーザーの信頼を巻き添えにしない）。
- **戻るリンクは sticky ピルで最上部1本のみ**（採用・§4.10）。不採用＝FAB 風丸ボタン（未提案）。sticky の親高さ制約に注意。
- **GF-AC-073 検証は開発DB直編集で状況を作る**（採用）。バックエンドに XP 付与テストAPIは作らない（過剰）。
- **枠コンポーネントは module レベルで定義**（採用・再描画リセット回避）。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に `doc/テスト/ゲーム感受入.md` の 未確認/要修正 と `doc/フェーズ毎ルール/ゲーム感フェーズ.md` を確認。

1. **backend を再ビルドして信頼端末フィックスをブラウザ検証**＝`cd impl && docker compose up -d --build backend worker mail-worker`。その後 `t-umekawa → scdev01 → t-umekawa`（SYSCON・MFA ON）で**再ログイン時にコードが出ない**ことを確認（A-TC-071/072 の実挙動）。ユーザー報告バグの実機確認。
2. **直近実装のブラウザ受入をユーザーに促し、`doc/テスト/ゲーム感受入.md` を ✅ OK に更新**＝GF-AC-043（継続投票 1件補充）／330/331/332（SC-22 投票演出）／340..343（#34）／評価モーダルのスクロール・★ホバー・9画面のフローティング戻るリンク。
3. **GF-AC-073 の受入**＝§5 のDB編集で満杯付近＋投票用アイデア5件は用意済み。投票して**楽観バーが100%を超えない**（レベルアップ詐称なし）を確認→✅化。日次上限は5票/日（`ideas/application.py _VOTE_XP_DAILY_CAP`）。
4. **ゲーム感の次増分**＝カテゴリE（時間・環境）の続き（動的背景/季節アクセント）や、ユーザーからの新規指摘。純ロジックは md 先行＋vitest red-green、視覚は GF-AC。
5. **`feature/game-feel` → `main` マージ**＝GF-AC を一通り受入後にバッチで。マージ時に本 handoff と `impl/README.md` を追随更新。

- **共通ルール**＝backend 変更は再ビルドしないと実行に反映されない（§5）。テストは md 先行・red-green（`doc/テスト/red確認台帳.md`）。`main` への push はユーザー承認後。非自明な認証/セキュリティ挙動変更は ADR 追補＋ユーザー承認。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `feature/game-feel` を確認**。compose＝`impl/compose.yaml`（cwd=`impl` で `docker compose` 実行）。
- **QA スタック起動**（記憶 `game-feel-qa-parallel-ops`）＝`cd impl && docker compose --profile workers up -d --build`。frontend は**本番ビルド**（F5でスタイル落ちを避ける）＝push後に反映させるには `--build` 再ビルド必須。backend も同様にイメージ焼き込み（§5）。フロント＝`localhost:3000`／MailHog＝`localhost:8025`（MFAコード確認）。
- **frontend ゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（74）／`npm run build`。
- **backend テスト**（cwd=`impl`・ホストソースで新コードを走らせる）＝`docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest tests/auth/test_auth_mfa.py -q`。※`worker`/`mail-worker` 起動中でも本コマンドは throwaway DB で完結（信頼端末系は 13 passed 実測）。full pytest は未実測。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`。
- **テナントDB 直参照例**＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "..."`（ACME-01。会社→DB名は control DB `companies.db_identifier`）。
- 記憶（`~/.claude/.../memory/`）に運用ルール多数（`game-feel-async-pipeline`／`game-feel-qa-parallel-ops`／`animation-reduce-motion-standard`／`framer-reducemotion-null-flip`／`spec-is-source-of-truth` 等）。
