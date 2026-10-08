# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-08（セッション末）。
- ブランチ: `main`（main 直 push が慣習）。
- **本セッションは4コミット push 済み**（⑥: ①設計+private可視範囲 ②idea_evaluate worker+自動起動+F.1分離 ③再生成EP ④frontend評価パネル〔AI block/代表タブ/#13/private radio〕）。正確なハッシュは `git log --oneline -5`。working tree clean 想定（`git status` で確認）。
- コンテナは起動済み（db/redis/minio/mailhog/backend/frontend・backend/frontend は本セッションで HEAD に再ビルド済み）＝`docker compose ps` で確認。
- alembic heads: control=`0020_signup_challenges`／company=**`0057_ai_evaluation`**（本セッションで新規・**適用済み**）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝**⑥ アイデア/コンセプトの LLM 自動評価（FR-50）の正式反映＋実装**。

## 3. 今回やったこと（⑥ 正式反映の設計明文化＋基盤実装・private 可視範囲）
> UI はユーザーとモックで反復確認して仕様確定 → 設計文書へ明文化 → 基盤スライスを red-green 実装、という流れ。

### 3-1. 設計・仕様の明文化（完了）
- **FR-50**（`doc/要件定義/README.md`）＝アイデア/コンセプト LLM 自動評価（AI は独立した正当な1評価者・集計/コイン算入・別枠表示）。
- **データモデル**（`doc/データモデル.md`）＝enum `evaluation_evaluator_kind`(human/ai) 追加／§5.21 evaluations に `evaluator_kind`/`ai_job_id`/`model` 追加・`evaluator_id` nullable・部分ユニーク `UNIQUE(idea_id) WHERE kind='ai'`・整合CHECK／§5.22b 版 `editor_id` nullable／§5.43 concept_evaluations も同型／**`evaluation_visibility` に `private` 追加**（投稿者＋その評価者のみ・owner/quest_admin 不可＝limited より1段狭い）。
- **API設計**＝`F_評価.md` に F.7（AI評価＝自動起動F.7.1/保存F.7.2/再生成EP F.7.3〔評価者権限のみ〕/表示F.7.4/セキュリティ）＋**F.1.1 代表コメント表示（タブ＝高評価/合意〔既定〕/懸念・観点ごと代表1件＋他N件）**＋**F.1.2 #13 評価詳細モーダル（閲覧者全員・可視範囲準拠）**＋private 可視ロジック。`P_コンセプト.md` に P.5a（コンセプトAI評価＝8観点＋Go/Pivot/Kill・**手動のみ**）＋代表表示。`S_AIジョブ・LLM連携.md` S.3 に `idea_evaluate`/`concept_evaluate`。
- **画面**＝SC-22/SC-61 に AI評価ブロック・代表コメント(タブ)・#13 導線・private を反映。SC-25 に public範囲 private 追記。
- **UIモック（実装レイアウト＝正に一致・shared.css/実装クラス踏襲）**＝`doc/画面設計/mocks/_AI評価パネル_検討.html`（AIブロック・アイデア5観点/コンセプト8観点+Go/Pivot/Kill）・`_評価パネル代表コメント_検討.html`（評価結果パネル＝ダッシュボード `.dash-tabs` と同じタブ・代表1件・仕切り線・「コメント」を card-title）・`_評価詳細モーダル_検討.html`（#13＝評価者ごとスコアカード・コメント字下げ・未入力は「コメントなし」で行高統一）。

### 3-2. 基盤実装（完了・red-green 済）
- **migration `0057_ai_evaluation`（company・適用済）**＝evaluations/concept_evaluations 拡張＋版 editor_id nullable（`impl/backend/migrations/company/versions/0057_ai_evaluation.py`）。`\d evaluations` で列/制約確認済。
- **ORM/schema**＝`evaluations/orm.py`・`concepts/orm.py`（新列・nullable）、`evaluations/schemas.py`・`concepts/schemas.py`（Visibility Literal に `private`）。
- **private 可視範囲**＝`evaluations/application.py` `_can_view_evaluation`／`concepts/application.py` `_can_view_eval` を `is_manager and visibility=='limited'` に（private は owner/quest_admin にも非表示・投稿者＋評価者のみ）。
- **テスト**＝**F-TC-213**（api・private は manager にも非表示・`tests/evaluations/test_api.py`・**旧実装で赤→新実装で緑を確認**）／**F-TC-214**（e2e・`e2e/sc-22-eval-visibility.spec.ts`・範囲外に非表示を psql seed で検証・緑）。

### 3-3. AI 評価ワーカー＋自動起動＋F.1 集計分離（完了・2回目の commit）
- **`idea_evaluate` ワーカー**＝`app/tenant/evaluations/ai_eval.py`（`build_messages(ts, idea_id)`＝アイデア＋クエスト文脈で5観点ルーブリック＋構造化JSON 要求／`apply_result(...)`＝JSON 検証→`repo.upsert_ai_evaluation` で kind='ai' 保存＋`replace_scores`＋版スナップ）。`repository.py` に `get_ai_evaluation`/`upsert_ai_evaluation` 追加。
- **ai_jobs 結線**＝`application.py` `_build_messages(job, ts)` に idea_evaluate 分岐（評価ドメインへ遅延 import 委譲）＋成功時フックで `apply_result`（検証失敗＝job failed `invalid_output`）。registry `_TASK_DEFAULTS` に `idea_evaluate`/`concept_evaluate`=qwen3-swallow。
- **自動起動**＝`ideas/application.py` `_enqueue_idea_ai_evaluation`（create_idea 公開・publish_idea の post-commit）。**デプロイ opt-in フラグ `llm_auto_evaluate_on_publish`（既定 OFF・`config.py`）で gate**＝LLM 基盤を伴わない dev/test では自動投入しない（共有DBジョブ汚染も回避）。prod は env `LLM_AUTO_EVALUATE_ON_PUBLISH=true` で ON。
- **F.1 集計分離**＝`evaluations/application.py` `_aggregate` を「数値集計(aspects/overall_avg)は AI 含む／`evaluators[]` は人間のみ・`evaluator_count` も人間のみ／AI は `ai_evaluation` 別枠」に。評価者個票に `submitted_at`/`visibility` 付与（代表コメント/#13 用・F.1.1）。コイン(F.4)は全 submitted で AI 算入（既存のまま）。
- **テスト**＝**F-TC-215/216/217**（int・`tests/evaluations/test_ai_eval.py`＝worker 成功で AI 評価生成／不正出力で failed＋AI評価0件／公開ヘルパーが queued ジョブ投入〔フラグON〕）。
- 回帰＝評価35・ideas/ai_jobs 併走147・strategy/concepts 105 passed・TCトレーサビリティ ✅(1036)。TC md＝`doc/テスト/F_評価.md`。

## 4. 現在の状態（動作 / テスト）
- **壊れているもの＝無し**。private 可視範囲は api+e2e で緑。
- backend は本セッションで `up -d --build` 済み（0057 適用のため）。frontend も up 済み。
- **AI 評価本体は未実装**（下記 §7）。現状は「人間評価＋private 可視範囲」まで。

## 5. 詰まっている点
- e2e の psql seed＝SQL は**単一行**で書く（`psql` ヘルパーが `JSON.stringify` するため改行が `\n` リテラル化して壊れる）。chat 中核は `chat_thread` へ刷新済み＝`chat_messages` に `chat_group_id` は無い／idea 削除前に `chat_groups`（詳細表示で生成される）を消す。
- backend ベイク＝新規/未コミットテストの反映は `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest ...`（§8）。ORM 変更を本体に効かせるには `up -d --build backend`。

## 6. 決定事項（⑥・すべて確定）
- AI＝独立した正当な1評価（参考値でない・集計/コイン算入）／evaluations 拡張（別テーブルにしない・DRY）。
- **再生成＝評価者権限（FR-27）保持者のみ**（owner/quest_admin でも評価者権限無ければ不可）。**再生成は版として残す**（§5.22b）。**バックフィル不要**（新規 published のみ・既存遡及なし）。
- **コンセプト AI 評価＝手動のみ（自動起動しない）**・8観点＋Go/Pivot/Kill 推奨も AI が出す。
- **SC-25 折り畳みなし（常時表示）**／**生成失敗通知＝評価者権限保持者＋owner/quest_admin**／**SC-04 表示**＝自動起動ジョブは system 所有(created_by=NULL)で個人SC-04に出さない・再生成は実行者のSC-04に出る。
- **公開範囲 `private`（新規・人間評価にも適用）**＝投稿者＋その評価者のみ・集計/コインは現行どおり（visibility 無視で全 submitted 算入）。
- **評価パネルのコメント＝観点ごと代表1件**（タブ＝高評価/合意〔既定〕/懸念・母集団=可視評価・同点は先の確定）＋**総評も代表1件**＋「他N件→#13」。**#13 評価詳細は投稿者に限らず閲覧者全員**（可視範囲準拠）。AIは別枠。
- 詳細根拠＝`doc/設計ドラフト/アイデアLLM自動評価_設計.md`（§7論点表・§11 コンセプト適用）。

## 7. 次にやること（優先順・⑥ AI 評価本体の実装）
> 設計は全確定・基盤(private/スキーマ)は実装済。残りは AI 評価パイプライン＋評価パネルUI。**TC md 先行→red-green**（テスト規約§5）。画面は**モック先行済→backend 結線**（§フロント実装フロー）。実装レイアウトを正（モックは一致済だが最終はコンポーネント）。

> **済（3-3）**＝idea_evaluate worker・自動起動(flag gate)・F.1 集計分離(ai_evaluation別枠＋evaluators人間のみ＋submitted_at/visibility)。**済（3-4・3回目commit）＝再生成EP** `POST /ideas/{id}/ai-evaluation/regenerate`（評価者権限のみ・202・`input.regenerated_by`＝版editor・完了409）＝`evaluations/application.py regenerate_ai_evaluation`＋router＋schemas(AiEvaluationJobResponse)。**EvaluationAggregateDTO に `ai_evaluation`(AiEvaluationDTO)＋evaluators に submitted_at/visibility を追加**（response_model が落とさないように）。TC=F-TC-218/219(api)。以下が残り。

2. **backend：コンセプト** `task_type=concept_evaluate`（8観点＋recommendation・**手動のみ** `POST /concepts/{id}/ai-evaluation/regenerate`・P.5a）＝ai_eval と同型の `concepts/ai_eval.py`（recommendation 必須・RAG に前提/検証 assumptions/validations 含む）＋concepts repo に upsert_ai_evaluation＋concepts `_aggregate` を AI 分離（recommendations も人間のみ数える等）。worker 分岐追加。
3. **backend：RAG 強化**（任意・品質）＝ai_eval.build_messages に関連情報(info_links top)＋経営資料(entity_embeddings cosine top-k・A-2)を足す（現状はアイデア＋クエストのみ）。
4. **backend：失敗通知の宛先**＝現状 `_notify_completion` は requester のみ。F.7/§6-5 の「評価者権限保持者＋owner/quest_admin」へ拡張（idea_evaluate 失敗時）。
5. **frontend：評価パネル**＝**アイデア側(SC-22)は実装済み(4回目commit)**＝`EvaluationComments`(代表1件タブ=高評価/合意/懸念・他N件→#13評価詳細モーダル・評価者ごとスコアカード)＋`IdeaDetailView` に AI評価カード(別枠・再生成ボタン=regenerateAiEvaluation)＋`EvaluationView`(SC-25)に private radio＋`api.ts regenerateAiEvaluation`/`ideas.css`。目視+e2e済。**残＝concept側**＝`ConceptDetailView`/SC-62 に同型適用（concept_evaluate backend〔残2〕の後）＋ConceptEvalModal(SC-62)に private radio。EvaluationComments は8観点/recommendation を受けられるよう要拡張（または concept 版を作る）。モック3枚が正。
6. 仕上げ＝型再生成(`npm run codegen`)・`npm run build`・vitest・targeted pytest・TCトレーサビリティ・**UI実ブラウザ目視**（verify-ui-visually-before-done）。自動起動を dev で試すなら `impl/.env` に `LLM_AUTO_EVALUATE_ON_PUBLISH=true`＋`--profile ai` llm-worker 起動。

### 前セッションからの持ち越し（未着手）
- ④【討議】おすすめクエスト選出アルゴリズム（ユーザー案への意見→合意後実装）。
- Turnstile `size:flexible` 幅の実ブラウザ目視。SC-01 設計書 §3〜9 を5ゾーン再設計に整合。アイデアコンテスト Phase2。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`:8000`・frontend=`:3000`・openapi=`:8000/openapi.json`・MailHog=`:8025`。
- workers（必ず `--build`）：`cd impl && docker compose --profile workers up -d --build worker mail-worker`（LLM 実行は `--profile ai` + `llm-worker`）。確認後 `docker compose stop worker mail-worker llm-worker`。
- 反映（ソースベイク）：`cd impl && docker compose up -d --build backend|frontend`（ビルド完了待ち＋`curl -sf :3000/login`）。型再生成＝`cd impl/frontend && npm run codegen`。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- テスト：
  - frontend `cd impl/frontend && npm run build`／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`(Playwright chromium)を作り**使い終わったら削除**（本セッションでモックを `file://` で撮って検証）。**必ず新コンテナ起動後に実行**。
