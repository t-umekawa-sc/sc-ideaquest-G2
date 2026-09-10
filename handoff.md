# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-10（このセッション末）**。
- 作業ブランチ＝**`main`**（`origin/main` と同期・本 handoff 更新を含め push 済み）。
- 最新コミット＝**`d496d18`** `feat(shell): レビュー#1 グローバルナビ…`（その後に本 handoff 更新コミット）。
- 運用＝**非同期パイプライン**＝main へ増分ごと commit・**push は都度ユーザー確認**。検証分担＝機能（reduce・構造・データ整合）は私がテスト担保／見た目はユーザー目視。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。全画面・全ドメイン接続済み。**このセッションで「ゲーム感向上フェーズ」を完了し、「社内レビュー反映フェーズ」に移行**。

## 3. 今回やったこと（変更ファイルと理由）

### A. ゲーム感フェーズ 完了（reduce e2e 化＋バッチ #24〜#34 受入・すべて push 済み）
- **reduce AC の e2e 化**＝#21 オーラ/#22 星/#23 賛否バーを **G-TC-175/176/177** で担保（`e2e/sc-01-dashboard.spec.ts`／`sc-25-eval.spec.ts`／`sc-22-idea-detail.spec.ts`）。方式＝`page.emulateMedia({reducedMotion})`（`test.use` は効かない）。md＝`doc/テスト/G_ゲーミフィケーション.md §5-T/U/V`。副次で既存 login ヘルパー陳腐化（`getByText("ようこそ")` timeout）を `waitForURL`＋`.app-header` に是正（sc-01/sc-22）。
- **ゲーム感バッチ #24〜#34 の受入対応**（視覚調整＝私が実装／reduce 確認＝機構担保）：
  - #26 GF-AC-261＝称号チップ可読化（`features/dashboard/dashboard.css` `.hero__title`／`features/profile/profile.css` `.prof-head__title` を不透明ダーク背景＋白寄りティア色テキストに）。
  - #27 GF-AC-270＝レアの輝きをカード枠→**レアのラベル文字自体**（`styles/design-system.css` `.rarity-rare` に text-shadow グロー＋✦。box-shadow/背後ハロー/枠脈動は「四角い箱が出る」ため撤去）。モック＝`style-guide.html §17N`。
  - #28 GF-AC-280＝ページ遷移フェードを `.page-transition` で **0.5s ease-in**（最初ゆっくり→最後速く・opacity のみ）。
  - #29 GF-AC-290＝ヘッダー円環 `.lvring` の見え幅 2px→4px。
  - #34 GF-AC-341＝`DashboardView.tsx` の「フォロー中のアイデア」の退場/繰り上がりを **`AnimatePresence mode="popLayout"`＋カードに `layout="position"`** へ（旧＝既定 sync＋layout 無しで退場中もスペースを保持し「単純再表示」に見えていた）。
  - reduce 確認（242/251/262/271/281/291/301/332/343）＝各セレクタの `@media prefers-reduced-motion` 停止＋`[data-anim-reduced]` killswitch を機構確認。受入台帳 `doc/テスト/ゲーム感受入.md` は #24〜#34 を ✅ 済み。

### B. 社内レビュー反映フェーズ（新規・進行中）
- **進め方を合意**＝**洗練フロー**（各項目＝①要件を1〜2問で確定→②設計書反映＋（見た目物は）style-guide にモック→**〈一次確認〉**→③テストパターン(TC)見直し→④実装→**〈実物で二次確認〉**）／順序＝**方針先決め→UI構築**。
- **7指摘の影響マップ**を作成（下記 §7 に要約）。**#2 と #7 は方針を先に確定**：
  - **#2 ゲームモード ON/OFF 方針（確定・§6 参照）**＝ゲーム層UIを丸ごと非表示（演出/チャット魔法含む）・アバター画像は残し導線だけ隠す・ゲーム系通知は非表示・backend はロジック据え置きで**フラグ保存のみ追加**・**会社既定＋個人上書き**。
  - **#7 最終アウトプット方針（確定）**＝案A（選定結果サマリ＋総括コメント）を **ISO 56001/56007 のイノベーション創出フロー**に沿って構造化（①機会と意図＝quest purpose ②創出＝ideas ③評価検証＝評価5観点 ④選定＝`is_selected` ⑤総括・次アクション＝`quests` に総括テキスト列を新設）。実装は #7 フェーズ（UI項目の後）。
- **#1 グローバルナビ 実装完了（commit `d496d18`・二次確認 OK・push 済み）**＝☰→左ドロワー／📌ピン留めで常設サイドバー。
  - 新規 `impl/frontend/src/components/layout/AppNav.tsx`（client・ポータル描画・open/pinned/localStorage `iq_nav_pinned`/matchMedia ≥1024/フォーカストラップ/Esc/スクロールロック/`usePathname` で active。**`gameEnabled` prop（既定 true）＝#2 でゲーム群の表示を実効ゲームモードに接続する差込口**）。
  - `AppHeader.tsx` 左端に `<AppNav/>` を `.header-left` で統合。CSS＝`design-system.css .appnav*`。
  - **ピン時の本文シフトは `html.iq-nav-pinned body { padding-left }`＋全高サイドバー方式**（`main` 幅を上書きする方式は各ページの中央寄せが再センタリングして「右に寄る」不具合＝アイデア詳細/チャットで発生したため不採用）。窓は横スクロールしない（`overflow-x:hidden` 併用）。
  - **分散導線を撤去**＝`DashboardView.tsx` の TILES／`ShopView`・`AvatarView`・`SpellsView` の `GameNav`（`components/ui/GameNav.tsx` はコンポーネント/export ごと削除）。
  - 設計書＝デザイン標準 §4.1「グローバルナビ」・画面遷移図 §4「集約 2026-09-10」／モック `style-guide.html §11b`。
  - テスト＝`doc/テスト/M_共通シェル・ナビ.md`（**新設ドメイン M**・M-TC-001〜004）＋`e2e/sc-99-appnav.spec.ts`（旧ビルドに対し **red 目視** → 再ビルドで **green 4 passed**・M-TC-003 に「ピン時 窓横スクロール無し」ガード込み）。

## 4. 現在の状態（動く / 壊れ / テスト）
- **フロントゲート（本セッション実測）**＝`npx tsc --noEmit` 緑／`npx vitest run` **160 passed**／`npm run build` 成功（docker build も exit0）／`python3 scripts/check_tc_traceability.py` **✅ code 437**。
- **e2e（本セッション・実 docker・実測 green）**＝`sc-99-appnav`(M-TC-001〜004)／`sc-01-dashboard`(G-TC-175＋hero balance)／`sc-25-eval`(F-TC-201/202/203・G-TC-171/172/176)／`sc-22-idea-detail`(D-TC-207・G-TC-177)。**他 e2e は本セッション未実行（未確認）**。
- **backend pytest ＝本セッション未実行（未確認）**。前回既知＝513 相当。
- **QA スタック＝全起動中**。frontend は **`d496d18`（#1 込み・ピン修正込み）を焼き込み済み**（本セッションで複数回 `build frontend && up -d frontend`）。※コード変更後は再ビルド必須。
- **壊れているもの＝把握範囲で無し**。

## 5. 詰まっている点（試して失敗・いずれも解決済み）
- **ピン時の本文レイアウト**＝当初 `html.iq-nav-pinned main.container { margin-left; width:calc(100%-サイドバー) }` にしたが、①窓ごと横スクロール（ヘッダー右に余白）②アイデア詳細/チャットは独自の中央寄せを持つため拡幅 main 内で再センタリングして「右に寄る」。**解決＝`body` の `padding-left` で本文全体（ヘッダー＋main）を右シフト＋サイドバー全高**（各ページの中央寄せをそのまま活かす・窓は横スクロールしない）。
- **e2e 背面クリック**＝`.appnav-backdrop` を座標(5,5)でクリックするとドロワー（左端）に当たり actionability 失敗。**ドロワー外（右側 x:900）をクリック**で解決。
- **連続ログインのバースト → 一時ロックアウト**（前セッションからの注意）＝red/green を続けて多数ログインすると login 全滅。間隔をあければ回復。

## 6. 決定事項と根拠（不採用案も）
- **#1 グローバルナビ＝☰→ドロワー＋📌ピンで常設サイドバー**（不採用＝左サイドバー常設のみ／ヘッダー展開ナビ）。ピン保存＝**localStorage（端末）**（不採用＝account 設定同期。理由＝レイアウト好みは端末別が自然・backend 追加不要）。ピン時レイアウト＝**body padding＋全高サイドバー**（不採用＝main 幅上書き。理由＝§5）。導線は**集約**（TILES/GameNav 撤去）。
- **#2 ゲームモード OFF＝ゲーム層UIを丸ごと非表示**（不採用＝演出のみ OFF＝既存 reduce_motion と重複）。**アバター画像は残す**（業務画面の本人識別に使うため）。**適用＝会社既定＋個人上書き**（不採用＝個人のみ。会社統制ニーズ）。**backend はフラグ保存のみ**（ゲームロジックは据え置き）。**チャット魔法は使用無効＋既存エフェクトもベストエフォート非表示（本文は残す）**。
- **#7 出力＝案A を ISO 56001/56007 フローで構造化**（不採用＝B 成果レポート／C 表示強化のみ）。理由＝成果が一箇所で見える最短形＋標準準拠、後から拡張可。
- **テストの新ドメイン M（共通シェル・ナビ）を新設**＝TC-ID は単一大文字プレフィックスで `doc/テスト/*.md` を横断走査（`scripts/check_tc_traceability.py`）ゆえ文字とファイル名の対応は任意。共通シェルは既存 A〜L に無いため M を採番。

## 7. 次にやること（優先順・具体的に）
> レビュー反映は**洗練フロー**で1項目ずつ・各項目で〈設計/モックの一次確認〉→〈実物の二次確認〉。順序＝#2→#3/#5→#4→#6→#7。**未確認は着手前にコードで裏取り**（`handoff-notes-often-stale`）。

1. **#2 ゲームモード ON/OFF（着手中・方針確定済み §6）**。次の具体作業：
   - **設計書反映**＝データモデル `doc/データモデル.md`（`accounts` に個人上書き列・`companies` に既定列。null 上書きは会社既定を継承＝実効値）／API `doc/API設計/K_プロフィール・背景画像.md`（`GET /me` で実効ゲームモード返却・`PATCH /me` で個人設定）＋会社設定は `doc/API設計/B_会社・アカウント.md` 系（会社既定の更新）／要件 `doc/要件定義/README.md`（新 FR）／デザイン標準（game-mode gating の横断規約）／画面 `SC-03_プロフィール.md`（個人トグル）・`SC-91`（会社既定）。
   - **モック**＝トグルUI（個人＝`SC-03` の `ProfileForm.tsx` に reduce_motion と同型で追加／会社既定＝会社設定 `.switch`）。
   - **実装（フロント表示制御）**＝`(app)/layout.tsx` で `me` から実効ゲームモードを算出し、`AppNav` の **既設 `gameEnabled` prop** へ渡す（ゲーム群の出し分け）／`AppHeader.tsx`（Lv/コイン/SP/`lvring` 非表示）／`DashboardView.tsx`（ヒーロー/週間ランキング）／通知（ゲーム系の間引き）／`features/chat`（魔法キャストUIの無効化・既存 `.spell-fx` レンダリング抑止）。backend＝フラグ保存列＋`GET /me` 返却のみ追加。
   - テスト＝`doc/テスト/M_共通シェル・ナビ.md` にゲームモード gating の TC（**次は M-TC-005〜**）＋backend は該当ドメイン md。
2. **#3 クエスト概要を右上**＝`features/quests/components/QuestDetailView.tsx`（`quest.purpose` は現在 `.quest-head`〔左カラム〕。`quests.css` の `.quest-top` は2カラム〔左1.7fr head／右1fr KPI〕。概要を右カラムへ）。設計＝`SC-12`。
3. **#5 改行表示**＝`white-space:pre-wrap` 欠落2箇所＝`IdeaDetailView.tsx` のチャットプレビュー `.chat-msg__text`（`ideas.css`）・クエスト概要 `.quest-head__theme`（`quests.css`）。書式ルールを要件/データモデルに注記。
4. **#4 参加メンバー一括選択**＝`features/quests/components/QuestForm.tsx` の候補（現在 `.candlist` で1人ずつ追加）を**絞込＋複数選択**へ。候補 API＝`features/quests/api.ts` `listGroupMemberCandidates()`。設計＝`SC-11`・デザイン標準 `.multiselect`・API C。
5. **#6 評価ダイアログにクエスト内容**＝`features/evaluations/components/EvaluationView.tsx` の `.eval-context`（現在タイトル＋カテゴリ＋アイデア名）に**クエスト概要 purpose を追加**（`idea.quest` に取得済み＝**API 追加不要**）。設計＝`SC-25`。
6. **#7 最終アウトプット**＝§6 の方針で実装（`quests` に総括テキスト列＋完了クエストの「成果」セクション/タブ＝選定アイデア一覧＋評価スコア＋総括）。要件/データモデル/`SC-12`/API C・F に反映。
- **共通ゲート**＝`npx tsc --noEmit`＋`npx vitest run`＋**`npm run build`（ESLint 込み）必須**。テストは md に TC 行(`根拠`列)→red-green→traceability ✅。backend の response_model 変更後は `cd impl/frontend && npm run codegen`。**push は都度確認**。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch --show-current` で `main` 確認**。compose＝`impl/compose.yaml`（cwd=`impl`・Postgres user/pass=`ideaquest`）。
- **QA スタック起動**＝`cd impl && docker compose --profile workers up -d --build`。frontend=`localhost:3000`／backend=`localhost:8000`（`/healthz`）／MailHog=`localhost:8025`。**コード反映は再ビルド**＝`docker compose build frontend && docker compose up -d frontend`（push だけでは反映されない）。
- **ログイン（dev・MFAなし）**＝`/login` company_code=`ACME-01`。主要＝`user@acme.example`/`Passw0rd!`（owner・ゲーム層ダッシュボード）。残高QA＝`user2@acme.example`/`Passw0rd!`。※`sc-01-dashboard` の hero balance のみ OPS（`admin@ops.example`/`Passw0rd!`）。
- **フロントゲート**（cwd=`impl/frontend`）＝`npx tsc --noEmit`／`npx vitest run`（現状 160）／`npm run build`／`npm run codegen`。
- **e2e**（cwd=`impl/frontend`・docker 起動中）＝`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test <spec> --workers=1`。**reduce テストは `page.emulateMedia({reducedMotion:"reduce"})`**。連続ログインのバーストはロックアウトに触れるので間隔をあける。ゲーム感/シェルの e2e＝`sc-99-appnav`／`sc-01-dashboard`／`sc-25-eval`／`sc-22-idea-detail`／`sc-18-loading`／`sc-30-32-balance-sync`／`sc-41-ranking`／`sc-02-notifications`／`sc-24-chat`。
- **トレーサビリティ**（repo ルート）＝`python3 scripts/check_tc_traceability.py`（現状 ✅ code 437）。走査＝`impl/backend/tests/**/*.py` と `impl/frontend/e2e/**/*.spec.ts` のみ。
- **backend テスト**（cwd=`impl`）＝**pytest 前に `docker compose stop worker mail-worker`**→ `docker compose run --rm -v "$(pwd)/backend:/app" --entrypoint python backend -m pytest <path> -q` → 終わったら `docker compose start worker mail-worker`。
- **モック確認（サーバー不要）**＝`doc/画面設計/mocks/style-guide.html` を `file://` 直開き→`Ctrl+F` で節番号（「11b」＝グローバルナビ・「17N」＝レア文字グロー）。
- **設計正本**＝`CLAUDE.md` から各規約/正本を参照。GF-AC 受入台帳＝`doc/テスト/ゲーム感受入.md`。共通シェル TC＝`doc/テスト/M_共通シェル・ナビ.md`。
- **記憶（要確認）**＝`design-spec-working-style`(仕様は本人イメージから起こす)／`backend-connection-per-screen-loop`(1画面単位＋受入ゲート)／`cross-cutting-standard-first`(横断標準を先に)／`game-feel-mock-first-then-port`(演出はstyle-guide先行)／`mock-match-impl-layout`(モックは実装レイアウトに一致・#27 は逆に production の多様な実体にモックを合わせた)／`animation-reduce-motion-standard`(reduce は私が担保)／`frontend-build-gate-eslint`／`handoff-notes-often-stale`(未確認は着手前にコードで裏取り)／`spec-is-source-of-truth`／`progress-tracking-single-source`(現況＝impl/README.md)／`game-feel-async-pipeline`(push都度確認)／`document-design-rationale`(なぜも併記).
