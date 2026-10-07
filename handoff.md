# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-07（セッション末）。
- ブランチ: `main`（main 直 push が慣習）。
- 最新コミット: **本セッションのまとめコミット（①AIモデル選択UI＋UI標準刷新）を push 済み**。直前は `f7bcd2c2`（前回 handoff docs）。正確なハッシュは `git log --oneline -3` で確認。
- working tree: コミット後 **clean**・`origin/main` 同期済みの想定（再開時 `git status` で確認）。
- alembic heads（**本セッションで新規 migration なし**・ファイル基準）: control=`0020_signup_challenges`／company=`0056_info_curators_into_user_capabilities`。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝**ユーザー指摘txt の消化＋仕様確定済みの未実装機能**を順次処理（小不具合→⑤表示制御→全能力付与UI→**①AIモデル選択UI**まで消化済み）。

## 3. 今回やったこと（変更ファイルと理由）
> すべてテスト先行（TC-md→red→green）＋実画面スクショ目視で確認済み。検証用の使い捨て Playwright スクリプト・スクショ・検証用DBデータは掃除済み（残置なし）。コミット対象＝46ファイル。

### 3-1. ① AIモデルのクライアント選択UI（FR-45・設計§9.2・backend＋frontend）
- 理由＝AI処理のモデルをユーザーが選べる UI が無かった。backend はモデル選択を元々サポート（`POST /ai-jobs` の `model`・`GET /ai-models?task_type=`・registry 解決＋ガードレール）だが frontend にピッカーが皆無。scope はユーザー決定＝**経営資料 ISO 生成（SC-81・`iso_generate`）の1本のみ**（現状 live な唯一の LLM 起動導線。info_summarize はフロントがクライアント抽出型要約で LLM 未結線）。
- backend 変更:
  - `impl/backend/app/infra/llm/registry.py`＝`ModelSpec` に `label`/`description` 追加・`_catalog()` の2キーに設定（qwen3-light=「高速（軽量）」/swallow=「高品質（日本語）」）・`list_models()` 返却に両フィールド・`catalog_meta()` 新設（admin が表示名を付す DRY ヘルパ）。
  - `impl/backend/app/tenant/ai_jobs/schemas.py`＝`AiModelItem`・`AdminModelItem` に `label`/`description` 追加。`application.py: admin_list_models` が `catalog_meta()` 由来で載せる。
  - `impl/backend/app/tenant/strategy/schemas.py: GenerationEnqueueRequest{model?}` 新設／`router.py: generate_strategy_iso` が body 受理（`body: GenerationEnqueueRequest | None = None`＝**body 無し POST も後方互換**）／`application.py: generate_iso(..., requested_model=None)` を `ai_jobs.enqueue(requested_model=)` へ導通（不正/会社OFF は既存 422 ガードが効く）。
  - 理由＝表示名は設計§9.2・§7 が `GET /ai-models` に規定済みで実装が未反映だった（spec is source of truth）。frontend 二重定義を撤去して単一ソース化。
- frontend 変更:
  - `impl/frontend/src/features/ai-jobs/types.ts`＝`AiModelItem` 型＋`defaultModelKey()` 純関数。`.../api.ts: fetchAiModels(taskType)`。
  - `impl/frontend/src/features/strategy/api.ts: generateStrategyIso(id, model?)` を body 対応に。
  - `impl/frontend/src/features/ai-settings/types.ts`＝旧 `MODEL_META`(name/feature/use 二重定義)を撤去し `modelFeature()` のみ残す。`.../components/AiSettingsView.tsx` は backend 由来の `m.label`/`m.description` を使用（利用明細は `labelByKey`）。
  - backend 再ビルド後に `cd impl/frontend && npm run codegen`（`src/lib/api/schema.d.ts` 再生成）済み。

### 3-2. UI 標準刷新（①の目視中のユーザー追加要望・frontend のみ）
- (a) **通常の単一選択コンボをカスタム `.combobox` に標準化＋横展開**（ユーザー決定）。新規共通部品 `impl/frontend/src/components/ui/Combobox.tsx`（button＋role=listbox・↑↓/Enter/Esc・候補ホバー指ポインター・`style`/`className` 可）を ui index から export。**フォーム系の native `<select class="select">` を全置換（29箇所／14ファイル）**＝profile/accounts/announcements/projects(ProjectForm,TaskForm)/qgadmin(QuestGroupAdminView)/quests(QuestDetailView)/contests(ContestFormModal,ContestDetailView)/info-input(InfoFormPanel 9・InfoDetailView)/concepts(ConceptDetailView)/notifications(NotificationsView)/strategy(種別)。**DataTable の「表示件数」セレクタのみ native 維持（ユーザー決定＝後回し）**。デザイン標準 §4 を「既定＝カスタム `.combobox`」に改定。
- (b) **AI生成コントロール一体型（案A 分割ボタン）**（ユーザー要望）。`doc/画面設計/mocks/style-guide.html`「4e」に3案モック→**案A採用**。共通部品 `impl/frontend/src/features/ai-jobs/components/AiGenerateControl.tsx`（主ボタン「✨AIで生成する」＋右端▾で `GET /ai-models` 候補・選択中モデル＋用途を副文表示・候補1でも常設）。CSS `.aigen*`＝`src/styles/design-system.css`＋`doc/画面設計/mocks/shared.css`。`StrategyFormPanel.tsx` の生成セクションを本部品に差し替え（3-1 で入れた Combobox＋別ボタンを置換）。
- (c) **分割ボタンの崩れ修正**（ユーザー指摘）＝本番で主ボタン/▾ が両端角丸になり継ぎ目に隙間。原因＝**Next は CSS をチャンク分割するため同スコア `.btn{border-radius}` が後勝ち**（style-guide 単一ファイルでは正常だったため本番だけ再現）。修正＝`.aigen-split__main`/`__caret` を子孫結合子 `.aigen-split .aigen-split__main` に変えて特異度を1段上げ（design-system.css・shared.css 両方）。計算スタイルで左8/右0・左0/右8・gap0 を確認。memory `next-css-chunk-order-specificity` に記録。

### 3-3. テスト（TC-md 先行＝`doc/テスト/S_AIジョブ.md`・`R_経営資料.md`）
- backend: `S-TC-134`(api・GET /ai-models が label/description)・`S-TC-212`(unit・registry メタ)・`R-TC-124`(int・generate の model→requested_model 導通)・`R-TC-125`(api・不正 model 422)。
- frontend: `S-TC-213`(vitest・`defaultModelKey`＝`src/features/ai-jobs/aiModels.test.ts`)。
- UI コンポーネント（`Combobox`/`AiGenerateControl`）は vitest 無し（既存 `Multiselect` も無しに合わせた）。

### 3-4. ドキュメント更新
- `doc/API設計/S_AIジョブ・LLM連携.md`（admin/ai-models に label/description）／`doc/API設計/R_経営資料・整合.md`（generate の model パラメータ）／`doc/テスト/S_AIジョブ.md`・`R_経営資料.md`（TC 追加）／`doc/設計ドラフト/ローカルLLM連携_設計.md`§9.2（実装先＝SC-81・UI形態＝分割ボタン案A）／`doc/画面設計/デザイン標準.md`§4（既定＝カスタム.combobox）／`doc/画面設計/mocks/style-guide.html`「4e」＋`shared.css`／`impl/README.md`（①＋コンボ標準）。

## 4. 現在の状態（動作 / 壊れているもの / テスト）
- **frontend**＝`npm run build` ✅（Compiled successfully・警告は既存 DataTable 等のみ）／`npx vitest run` **252 passed / 39 files**。コンテナは `--build` で本セッション変更反映済み。
- **backend pytest**＝`tests/infra`+`tests/ai_jobs`+`tests/strategy` を `-v` マウント run で **28 passed**。**プロダクトコードは `up -d --build backend` 済み＝ベイク反映**。新規テスト（S-TC-134/212/213・R-TC-124/125）は**ベイク image には未反映**＝再実行は `up -d --build backend` 後 or `-v` マウント run（§8）。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅（code **1031** 件）。
- **コンテナ**＝backend/db/frontend/mailhog/minio/redis **稼働中**。**worker/mail-worker/llm-worker は停止中**。
- **壊れているもの＝無し**（確認範囲）。
- 目視で確認した事実＝SC-81 編集画面の生成が**一体型分割ボタン**（▾展開→高速/高品質・既定「高品質（日本語）」初期選択・選択で副文更新・継ぎ目隙間なし）／高速（軽量）を選んで生成→投入ジョブ `requested_model=qwen3-light` を DB で確認／プロフィール「言語」等フォームのカスタムコンボ展開／SC-94 の label/description 表示／style-guide 4e。
- **未確認**＝e2e（playwright）は本セッション未実行。他フォーム画面（contests/projects/concepts/info-input 等）のコンボは実機目視を全数はしておらず、profile とSC-81 を代表として確認（ビルド/型は通過）。

## 5. 詰まっている点（試して失敗したこと・なぜ）
- **分割ボタンが本番だけ崩れた**＝CSS 上書きを `.btn` と同スコア（class 1個）で design-system.css 内の後方に書いたが、**Next の CSS チャンク分割でロード順が変わり `.btn` が後勝ち**して両端角丸→隙間。style-guide（shared.css 単一ファイル）では記述順どおりで正常＝**本番でのみ再現**。→ **共有ユーティリティ（.btn/.input/.select 等）の上書きは同スコアに頼らず特異度を1段上げる**（子孫結合子）。UI変更は必ず新コンテナ起動後に実ブラウザ目視（memory `verify-ui-visually-before-done`・`next-css-chunk-order-specificity`）。計算スタイル（getComputedStyle）で数値を測ると切り分けが速い。
- **目視検証は必ず「新コンテナ起動後」**＝`docker compose up -d --build frontend` のビルド完了（`RunningFor`「数秒前」＋`curl -sf http://localhost:3000/login`）を待ってから（旧コンテナ誤判定を避ける）。
- **baked backend の pytest は未コミット/新規テストを反映しない**＝`-v` マウント run か `up -d --build backend`。

## 6. 決定事項と根拠（採用しなかった案も）
- **① scope＝経営資料 ISO 生成のみ**（ユーザー決定）。不採用＝SC-04 汎用投入フォーム追加／info_summarize を先に LLM 結線。理由＝live な LLM 起動導線が iso_generate 1本のみで最小工数・即効果。他機能は結線時に同じ部品（`fetchAiModels`/`AiGenerateControl`）で載せる。
- **表示名/説明＝backend `GET /ai-models` に追加（単一ソース・DRY）**（ユーザー決定）。不採用＝frontend で key→表示名マップ。理由＝設計§9.2・§7 が既に規定・二重管理回避。
- **通常コンボ＝カスタム `.combobox` を既定**（ユーザー決定）。ネイティブ `.select` は候補(option)の cursor/装飾を制御できず見た目が揃わないため。例外＝DataTable 表示件数（後回し）。
- **AI生成UI＝案A（分割ボタン）採用**。不採用＝案B（セグメント一体バー）／案C（ボタン＋インラインモデル）。style-guide 4e で3案を実レンダリング比較のうえ決定。
- **generate の body は任意（`| None`）**＝既存の body 無し POST（R-TC-120/121）を壊さない後方互換。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前にコードで現況裏取り（memory `handoff-notes-often-stale`）。
1. **（フォロー・小）DataTable「表示件数」セレクタのカスタム `.combobox` 化**＝今回唯一 native を残した箇所（`impl/frontend/src/components/ui/DataTable.tsx:1146` 付近）。ユーザー決定で後回し。共有部品＝全一覧画面に影響するので floatHead/横スクロール/コンパクト配置を実機目視で確認してから置換。
2. **（フォロー）`/info-curators` backend EP と N.5 テストの retire**＝未使用化済み（generic 能力 EP へ移行済み）。`impl/backend/app/tenant/info/router.py` の info-curators 3EP＋対応テストを削除/整理。削除前に `is_curator`/`list_curators`（info 内部判定で使用）以外に参照が無いことを grep。
3. **#13 アイデア作成者向け 評価詳細（コメント＋得点）閲覧画面**＝評価ドメイン(F)・SC-22/SC-25 周辺。既存の評価可視範囲（visibility=party/limited・F.1 集計）をコードで裏取りしてスコープ確定。
4. **② AI処理状況のリアルタイム反映 E2E**＝他ユーザのジョブ開始/待機数/自分の番がリロード無しで反映・進捗率更新を Playwright で確認（SC-04 ai-jobs・realtime L/WS）。共有DB非冪等注意（memory `e2e-full-not-idempotent-shared-db`）。
5. **④【討議】おすすめクエスト選出アルゴリズム**＝ユーザー案「参加可×経営資料整合率高×直近活発×管理者お勧めマーク、得点上位をパネル最大件数」への意見→合意後に実装。
6. **③【討議】アイデアのLLM自動評価＋RAG**＝評価パネルに「AI評価」ボタン→背景ジョブで LLM 採点＋コメント。大型＝FR採番→データモデル→API→画面から。**モデル選択UIは今回作った `features/ai-jobs/AiGenerateControl`（分割ボタン）を再利用できる**。

### 前セッションからの持ち越し（未着手）
- Turnstile `size:flexible` 幅の実ブラウザ目視（`impl/.env` の `#TURNSTILE_*` を外して `/signup` 確認・確認後 dev既定へ戻す）。
- SC-01 設計書 §3〜9 を5ゾーン再設計に整合（`doc/画面設計/screens/SC-01_ダッシュボード.md`）。
- アイデアコンテスト Phase2（妥当性解析・自動表彰スケジューラ＝LLM/スケジューラ基盤前提・MVP外）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`http://localhost:8000`・frontend=`http://localhost:3000`・openapi=`http://localhost:8000/openapi.json`・MailHog=`http://localhost:8025`。
- **workers（必ず `--build`）**：`cd impl && docker compose --profile workers up -d --build worker mail-worker`（LLM 実行を試すなら `--profile ai` + `llm-worker`）。確認後 `docker compose stop worker mail-worker llm-worker`。
- 反映（ソースベイク・volumes無）：`cd impl && docker compose up -d --build backend|frontend`。**ビルド完了を待ってから**（`RunningFor`「数秒前」＋`curl -sf http://localhost:3000/login`）検証。型再生成＝backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- テスト：
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- `.env`（`impl/.env`・gitignore 追跡外）現状＝dev 共有スタック既定（`IQ_DEFAULT_COMPANY_CODE=`空・`TURNSTILE_*` コメントアウト＝CAPTCHA無効）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社`OPS`）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`（public＋self_signup）。
- dev 会社id（control DB companies）：ACME-01=`debba8dc-7f32-4705-abd8-61f2d77e23c1`／OPS=`d249a8ea-5109-4974-ad46-e0da36a546e6`／DEMO=`a5e28360-043a-4b61-b659-664ab0107f2f`。
- ①の確認場所＝ログイン `kanri@acme.example`→「経営資料」(`/strategy-documents`) で資料を**編集**（0件なら1件作成）→最下部「🤖 AI で下書きを生成」の**分割ボタン**（主「✨AIで生成する」＋▾でモデル）。dev に検証用資料「私たちの働き方」(`490ac13b-06ab-45b0-b3fa-ea26bc49573f`) あり。管理の表示名ソース確認＝`/admin/ai-settings`（SC-94）。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`(Playwright chromium・`deviceScaleFactor` 上げて計測/スクショ)を作り**使い終わったら削除**。ログインは `#company_code`/`#login_id`/`#password` に fill→「ログイン」click。**必ず新コンテナ起動後に実行**（§5）。
