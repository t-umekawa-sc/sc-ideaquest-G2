# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-16 JST（README 追随更新セッション）**
- ブランチ: **main**（受入/レビュー反映＝main 直コミット。`feature/game-feel` は今回未使用）
- 最新コミット: **5c5b539** `fix(chat,dashboard): E群受入指摘 DFT-E-006〜011＋SC-01 UI要望（回帰テスト同梱）`（origin と同期済み）。**E群受入対応（frontend＋doc/テスト md＋新規 `jump.ts`/`jump.test.ts`/e2e）はこのコミットで確定済み**（前 handoff の「未コミット」は当時の記述＝既に commit 済み）。
- 本セッションの変更＝**`impl/README.md` の受入状況追随＋本 handoff の stale 修正**（次コミット予定）。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションするマルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。現在は**ブラウザ受入フェーズ**＝全画面 backend 接続済み。群単位（D→E→G→F→H）に seed→受入→指摘修正を回している。

## 3. 今回やったこと（変更ファイルと理由）

本セッションは **E群（チャット SC-24）ブラウザ受入の指摘対応**が中心。受入で認定した不具合を **DFT-E-006〜011** として順次修正し、**すべて回帰テスト同梱（テスト規約 §5.3・red→green を旧コンテナ/再ビルドで実施）**。加えてダッシュボード（SC-01）の UI 要望を数件対応。**backend は未変更（frontend＋doc/テスト md のみ）**。

### A. チャット SC-24 の受入不具合（`impl/frontend/src/features/chat/`）
- **DFT-E-006 引用ジャンプ**（`components/IdeaChatView.tsx` `jumpToQuote`／新規 `jump.ts`＝`scrollTopForTarget`・`flashClassFor`／`chat.css` `.msg--flash`・`.msg--flash-static`・`.msg{scroll-margin-top}`）＝引用クリックで引用元がフローティング文脈バー（`.chat-context--float`）背後に潜り込み・どこへ飛んだか不明だった。バー下端＋余白へ手動スクロール＋一時ハイライト（reduce は静止ハイライト）。unit **E-TC-214**・e2e **E-TC-215**。
- **DFT-E-007 入力欄の右側が反応しない**（`chat.css` `.composer{z-index:9}`）＝`.composer`（sticky bottom）が z-index 未指定で、スクロールで重なったメッセージの z-index を持つ子（`.msg__author`/`.msg__caster`=2・魔法行 `.msg-row`=3）がクリックを奪っていた（左＝素の本文で奪われず＝左だけ効く症状）。上部バー(9)と対称に前面化。e2e **E-TC-216**。memory `chat-sticky-needs-zindex`。
- **DFT-E-008 最小化中の引用返信で無反応**（`IdeaChatView.tsx` 💬ボタンの onClick＝`setComposerMin(false)`＋focus）＝最小化中は `composer__full`（reply-ctx/textarea）が非表示で引用チップが見えなかった。引用追加時に展開する。e2e **E-TC-217**。
- **DFT-E-009 自分の投稿が再入室で未読**（`IdeaChatView.tsx` `effectiveFirstUnread`）＝「ここから未読」が自分の投稿の上に出た。表示側で自分の投稿の上には区切りを出さない（backend の first_unread が自分の投稿を指しても、そこから最初の「自分以外」まで送る）。e2e **E-TC-219**。
- **DFT-E-010 全件未読の初期スクロール**（`IdeaChatView.tsx` 初期スクロール effect）＝`sep.scrollIntoView({block:"start"})` で全件未読時に区切り＋先頭がバー背後に潜り込んだ。`scrollTopForTarget` でバー下へ着地。e2e **E-TC-220**。
- **DFT-E-011 既読判定を可視性ベースに一本化**（`IdeaChatView.tsx` `markReadUpToVisible`＋スクロール/visibilitychange リスナ）＝**ユーザー選択＝「実際に画面に見えたら既読」**。可読領域（バー下端〜ビューポート下端）に入ったメッセージまで既読前進（`markRead` は後退しない §5.31）。発火＝①初期スクロール後 ②スクロール（rAF スロットル）③リアルタイム反映後 ④タブ可視化。**背面タブ（`document.hidden`）では既読にしない**。**従来のアドホック既読を撤去**＝入室時の一律 `markRead(last)`・送信時 markRead・realtime 時 markRead を廃し `markReadUpToVisible` に統合。e2e **E-TC-221**（初期入室で見えた分だけ）・**E-TC-222**（2ユーザー realtime＝報告シナリオそのもの）。

### B. アクションメニューの改善（ユーザー要望・`IdeaChatView.tsx`・`chat.css`）
- ホバー操作メニュー各ボタンに機能説明 `title`（ツールチップ）＋**使用中のアクティブ表示**（`.msg__act.is-active`＋`aria-pressed`）＝リアクション済/ピン留め中/引用中/編集中。リアクションピッカー（`.rp__emoji.is-active`）でも既リアクションの絵文字をアクティブ表示。e2e **E-TC-218**。

### C. ダッシュボード SC-01（ユーザー要望・`impl/frontend/src/features/dashboard/`）
- **「最近の通知」に「既読にする」ボタン**（`components/DashboardView.tsx`＝未読のみ・遷移せず既読化＝既存 `markNotifRead`/`markNotificationRead` 再利用）。e2e **I-TC-144**。
- **下段 1:1**（`dashboard.css` `.dash-bottom` `1.4fr 1fr`→`1fr 1fr`）。
- **通知レイアウト**＝件名（body）の横に既読ボタン・メッセージ（context）はパネル全幅（`.notif-head`/`.notif-subject`/`.notif-ctx`）。
- **通知フォント不具合**＝SC-02 の**未スコープ `.notif-title`（`notifications.css`・font-pixel/text-2xl）**がグローバル CSS として全画面に効き、ダッシュボードで再利用した同名クラスと衝突しドット絵24pxになっていた。ダッシュボード側を **`.notif-subject` に改名**＋ビジネスフォント（既定 sans 継承）/業務パネル準拠サイズに。I-TC-144 にフォント回帰ガードを追加。
- **並び替え**（`DashboardView.tsx`・`flowMotion` 再採番）＝**新着の議論 → チームアクティビティ＋最近の通知 → 未投票のアイデア → フォロー中のアイデア → 下書き → 参加中クエスト →（ゲーム層：ヒーロー＋週間ランキング）**。並び順の正＝`DashboardView` 冒頭コメント。

## 4. 現在の状態
- **コンテナは停止中**（本セッションでは未起動＝`curl healthz/login` は 000）。e2e/backend/ブラウザ受入を再開するには §8 の `docker compose --profile workers up -d --build` が必要。frontend の docker なし検証（vitest/tsc）は下記のとおり再実行して green を確認済み。
- **テスト（実測・本セッション 2026-09-16 再実行）**:
  - frontend **vitest 26 files / 181 passed**（chat `jump.test.ts` 5 含む）／`tsc --noEmit` OK。**いずれも cwd=`impl/frontend` で実行**。`npm run build` は今回未実行（前セッションで OK・frontend ソース未変更）。
  - **TCトレーサビリティ ✅ code 520**（`python3 scripts/check_tc_traceability.py`・リポジトリ直下）。
  - **SC-24 e2e＝14 passed**／dashboard 通知 e2e（I-TC-144）green は**前セッション実測値**（今回はコンテナ停止のため未再実行）。
  - backend＝**未変更のため未実行（未確認）**。前回値は 548 passed。
- **受入の進捗**（正＝`impl/README.md`「ブラウザ受入状況」・**本セッションで追随更新済み**＝E群を「受入中」に・DFT-E-006〜011＋SC-01 UI要望を反映・G群は受入待ちのまま）:
  - **D群＝✅完了**（前セッション）。
  - **E群（チャット）＝受入中**。DFT-E-006〜011＋アクションメニュー改善を修正・全て green。**ユーザーの再確認が残**。
  - **G群＝seed 済み・受入待ち**（未着手のまま）。
  - **F群（評価）・H群（通知）・その他（メール ADR-0009）＝未着手**（seed_f/seed_h 未実装）。
- **受入補助**: 受入用 E チャット（idea `0aafc731-eaa9-4826-a910-6f2fb8e22e05` / chat_group `838d4429…`・9メッセージ）の **既読カーソルを全ユーザー分リセット済み**（未読状態で新挙動を確認可能）。**開くと見えた分は既読になる**ので、繰り返し未読で見たいなら再リセットが必要（§8 に SQL）。
- **壊れているもの**: 既知の失敗テストは無し。

## 5. 詰まっている点（試して失敗した経緯）
- **`.notif-title` クラス名衝突**＝Next App Router では CSS がグローバル。SC-02 の未スコープ `.notif-title`（ページ見出し・font-pixel/text-2xl）が全画面に漏れ、ダッシュボードで同名クラスを使ったらドット絵フォント24pxになった。**原因特定は Playwright の一時 spec で computed style＋`document.styleSheets` を走査**して matched rule を特定した（`.notif-title => font:var(--font-pixel) size:var(--text-2xl)`）。→ ダッシュボード側を改名して解消。
- **DFT-E-007 の再現が headless で困難**＝1280/1920 の単純クリックでは奪われず、`elementFromPoint`/`elementsFromPoint`/格子走査でも右側デッドを再現できなかった。ユーザーが「メッセージと入力欄が**重なる位置**でクリックしている」と補足→ z-index 欠落と判明（computed `z-index:auto` が決定的証拠）。**実機再現が難しい時は computed style を直接測る**のが有効。
- **vitest を repo ルートから実行すると誤検知**＝リポジトリ直下で `npx vitest run` すると e2e spec を拾って「43 files failed（Playwright test() 呼び出しエラー）」になる。**必ず cwd=`impl/frontend`**（`vitest.config.ts` がそこにある）。正しい cwd では 26 files/181 passed。
- **realtime の e2e は動く**＝当初フレーク/インフラ懸念で敬遠しかけたが、`browser.newContext()` で2ユーザー・A が API 投稿→B のページに realtime 反映（`.msg` 出現）を確認でき、E-TC-222 が成立した（`waitForTimeout` で購読確立と markRead 反映の猶予を取る）。
- **e2e フルラン（99本）full green は未達**（前回同様・hermeticity＝共有テナント直列＋負荷でフレーク）。本セッションは **sc-24 単体で確認**。§7 の別タスク。

## 6. 決定事項と根拠（本セッション）
- **既読＝「実際に画面に見えたら既読」**（ユーザー選択）。背面タブは既読にしない。**不採用**＝(a)タブ可視なら無条件既読（スクロール位置無視・上を読んでいる最中の未表示新着まで既読になる）／(b)到着時に下端付近の時だけ既読（"届いた後にスクロールして見た"を取りこぼす＝報告シナリオを満たさない）。
- **通知フォント衝突は改名で解決**＝根本は SC-02 の未スコープ CSS だが、最小影響でダッシュボード側を `notif-subject` に分離。**SC-02 の `.notif-title` スコープ化は将来タスク**（他にも未スコープが漏れている可能性）。
- **composer z-index=9**＝上部 `.chat-context--float`(9) と対称。メッセージ内容(≤3)より前・ポップアップ(reaction-picker 40/emoji 45/mention 46/lightbox 60)より後ろ。
- **並び順で 未投票 ＞ フォロー中**（ユーザー確認）＝締切のあるアクション（投票）を関心のウォッチ（フォロー）より上に。
- **受入不具合は必ず回帰テスト同梱**（§5.3）。red は「旧コンテナ（未再ビルド）」に対して先に実行して目視→修正→`up -d --build frontend`→green。証跡はコミットメッセージ。
- **DFT-E-009 は表示側（effectiveFirstUnread）で担保**＝自分の投稿の上には未読区切りを出さない。DFT-E-011 の可視ベース既読と二重に効く（堅牢）。

## 7. 次にやること（優先順・具体）
1. ~~本セッションのコミット＆プッシュ~~ **✅完了**（E群受入対応＝`5c5b539`／README追随＋本 handoff stale 修正＝本コミット）。
2. ~~`impl/README.md` の「ブラウザ受入状況」を追随更新~~ **✅完了**（E群を「受入中」・DFT-E-006〜011＋SC-01 UI要望を反映・G群は受入待ちのまま）。
3. **E群/G群のユーザー受入継続**＝今回の可視ベース既読・引用ジャンプ・入力欄z-index・最小化引用・ダッシュボード並び/通知フォント・アクションメニューを再確認。OK なら README を [x]。ゲーム層UIは owner のプロフィールで game_mode を ON（ピンは不要）。
4. **F群 seed（`seed_f`）を `impl/backend/scripts/seed_demo.py` に追加**＝提出済み評価（5観点＋総評＋公開範囲）を複数評価者で＋owner 選定。evaluator 権限付与（`seed_d` の party permissions 参考）。dispatch に `f`。
5. **H群 seed（`seed_h`）追加**＝2ユーザー発火（メンション/フォロー中コメント/評価/選定/更新）で SC-02 通知の通し。フォロー/パーティー関係を seed。dispatch に `h`。
6. **その他**＝メール確認 ADR-0009（SC-92/93 → MailHog `http://localhost:8025`）。
7. **【別タスク】e2e スイートの hermeticity 対応（full green 化）**＝専用テナント/自データ cleanup・timeout 引き上げ・累積データ定期クリーンアップ・シャーディング。現状は個別/ファイル単位 green・フルランはフレーク。
8. **【将来機能の実装】** コンセプト機能・情報インプット機能＝`doc/設計ドラフト/` を実体化（データモデル/API/画面 SC-xx・新規 FR 起票）。

## 8. 再開に必要な環境情報
- **起動**: `cd impl && docker compose --profile workers up -d --build`（db/redis/minio/mailhog/backend/frontend/worker/mail-worker）。**フロント変更後は必ず `docker compose up -d --build frontend`＋`curl localhost:3000/login` が 200 になるまで待つ（warmup）**。backend/worker/mail-worker は同一イメージ＝`... up -d --build backend worker mail-worker`。
- **ポート**: frontend 3000 / backend 8000(/healthz) / db 5432 / redis 6379 / minio 9000・9001 / mailhog 8025。
- **受入デモデータ**: リポジトリ直下から `python3 impl/backend/scripts/seed_demo.py [d|e|g|all]`（ホスト python3＋requests・稼働中 backend 必須・冪等）。dev ログイン＝`ACME-01`/`user@acme.example`/`Passw0rd!`（owner・game_mode OFF）／`user2@acme.example`（同PW・E-TC-222 の相手役）／system_admin＝`OPS`/`admin@ops.example`/`Passw0rd!`。
- **frontend 検証（必ず cwd=`impl/frontend`）**: `npx tsc --noEmit && npx vitest run && npm run build`。**vitest/e2e を repo ルートから叩かない**（e2e spec を拾って誤検知）。
- **e2e（cwd=`impl/frontend`・Playwright 導入済み）**: `npx playwright test e2e/xxx.spec.ts [-g "TC-ID"] --reporter=line`。**red は再ビルド前の旧コンテナに対して先に確認**。2ユーザー系は `browser.newContext()`＋`loginAs`。DB 直操作ヘルパ＝`psql()`/`psqlValue()`（`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme`・cwd=impl）。
- **backend テスト**: `cd impl && docker compose stop worker mail-worker` →（cwd=impl）`docker compose run --rm -T -v "$PWD/backend:/app" backend python -m pytest tests -q` → 済んだら worker 再開。
- **TCトレーサビリティ**: TC を `doc/テスト/<ドメイン>_*.md` に先に足す →**リポジトリ直下**で `python3 scripts/check_tc_traceability.py` ✅（backend py＋e2e spec＋vitest を走査）。
- **受入チャットの既読リセット**（未読状態で確認したい時）: `cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "DELETE FROM chat_reads WHERE chat_group_id=(SELECT id FROM chat_groups WHERE idea_id='<idea_id>');"`。**チャットを開くと見えた分は既読になる**（DFT-E-011）ので都度リセット。
- **規約の正本**: リポジトリ直下 `CLAUDE.md` から各規約。**commit/push はユーザー明示時のみ**。main 直コミット。
- **正本の所在**: 要件＝`doc/要件定義/README.md`／API＝`doc/API設計/{README,A..L}.md`／データモデル＝`doc/データモデル.md`／画面＝`doc/画面設計/screens/SC-xx_*.md`＋`mocks/*.html`／実装現況＝`impl/README.md`／実装順＝`doc/実装計画.md`／将来機能＝`doc/設計ドラフト/`。
- **本セッション追加 memory**: `chat-sticky-needs-zindex`（SC-24 の sticky/floating 要素は z-index 必須＝`.msg` の子が z-index 2-3 でクリックを奪う）。
