# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-08 14:44 JST（セッション末）。
- ブランチ: `main`（main 直 push が慣習）。
- 最新コミット: **`ad6d7bf4`**（docs: handoff 更新）。本セッションは ⑥ 関連で **10 コミット push 済み**（`e333914d`→`ad6d7bf4`）。
- working tree: **clean**（`git status` 確認済み）。`origin/main` 同期済み。
- alembic heads: control=`0020_signup_challenges`／company=**`0058_ai_jobs_created_by`（適用済み・SC-04 起票主体フィルタ用の監査列）**。
- **本セッション追加作業（⑥ 磨き込み・2026-10-08）**＝(a) **RAG 経営資料 top-k 追補**（選択分優先＋意味的 top-k・アイデア=保存埋め込み/コンセプト=その場 embed・graceful）／(b) **SC-04 非表示を created_by_id で実装**（ai_jobs に監査列 `created_by_id`/`created_program` 追加＝migration 0058・自動評価は system 起票 NULL で個人一覧から除外・既存行はバックフィル）。いずれも red-green 済み・未コミット（working tree に変更あり）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘消化＋仕様確定済み未実装機能を順次処理。

## 3. 今回やったこと＝⑥ アイデア/コンセプト LLM 自動評価（FR-50）を設計〜実装まで**完了**
> AI を独立した正当な1評価者として5観点(アイデア)/8観点+Go/Pivot/Kill(コンセプト)で採点し、集計・コインに算入。UI はユーザーとモックで反復確定→設計明文化→red-green 実装→実ブラウザ目視、の順で進めた。

### 3-1. 設計・仕様（正式反映）
- FR-50（`doc/要件定義/README.md`）／データモデル（`doc/データモデル.md`＝enum `evaluation_evaluator_kind`・§5.21/§5.43 に `evaluator_kind`/`ai_job_id`/`model`・`evaluator_id` nullable・部分ユニーク・CHECK・版 editor_id nullable・`evaluation_visibility` に `private` 追加）。
- API: `doc/API設計/F_評価.md`（F.7 AI評価・F.1.1 代表コメント・F.1.2 #13）／`P_コンセプト.md`（P.5a・8観点+推奨・手動のみ）／`S_AIジョブ・LLM連携.md`（S.3 `idea_evaluate`/`concept_evaluate`）。画面 SC-22/25/61。
- 設計ドラフト `doc/設計ドラフト/アイデアLLM自動評価_設計.md`（§11 コンセプト適用含む・保留論点すべて解消）。
- UIモック（実装の正）: `doc/画面設計/mocks/_AI評価パネル_検討.html`・`_評価パネル代表コメント_検討.html`・`_評価詳細モーダル_検討.html`。

### 3-2. backend 実装
- **スキーマ**: migration `impl/backend/migrations/company/versions/0057_ai_evaluation.py`＋ORM（`evaluations/orm.py`・`concepts/orm.py`）＋schemas（`private` を `EvaluationVisibility`/`EvalVisibility` に追加）。
- **private 可視範囲**: `evaluations/application.py` `_can_view_evaluation`／`concepts/application.py` `_can_view_eval` を `is_manager and visibility=='limited'`（private は owner/quest_admin にも非表示＝投稿者＋評価者のみ）。
- **AI評価ワーカー**: `evaluations/ai_eval.py`（`build_messages`/`apply_result`）・`concepts/ai_eval.py`（8観点＋recommendation）。`repository.py` に `get_ai_evaluation`/`upsert_ai_evaluation`（両ドメイン）。`ai_jobs/application.py` の `_build_messages(job, ts)` に idea/concept 分岐＋成功時フック（検証失敗=job failed `invalid_output`）。`infra/llm/registry.py` に task_type 既定（qwen3-swallow）。
- **自動起動/手動**: アイデアは `ideas/application.py` `_enqueue_idea_ai_evaluation`（create_idea 公開・publish_idea の post-commit）＝**デプロイ opt-in フラグ `llm_auto_evaluate_on_publish`（`core/config.py`・既定 OFF）**で gate（共有DBジョブ汚染回避／prod は env ON）。コンセプトは**手動のみ**（再生成EP）。
- **再生成EP**: `POST /ideas/{id}/ai-evaluation/regenerate`（`evaluations`）・`POST /concepts/{id}/ai-evaluation/regenerate`（`concepts`）＝**評価者権限(FR-27)保持者のみ**（owner/quest_admin でも評価者権限無ければ403）・完了409・`input.regenerated_by`=版editor。
- **集計分離**: `evaluations/application.py` `_aggregate`／`concepts/application.py` `get_evaluation_aggregate`＝数値集計(aspects/overall_avg)は AI 含む／`evaluators[]`・`evaluator_count`・推奨分布は人間のみ／AI は `ai_evaluation` 別枠。evaluators に `submitted_at`/`visibility` 付与（代表コメント/#13 用）。DTO 拡張（`AiEvaluationDTO`/`ConceptAiEvaluationDTO`/`*JobResponse`）。
- **RAG強化**: `app/tenant/_shared/eval_rag.py`（`related_info_lines`=info_links FR-41・反証優先／`strategy_doc_lines`=クエスト選択の経営資料 FR-44）を両 `build_messages` が注入（graceful）。※経営資料は**クエスト選択分**を使用（embedding top-k は未実装＝将来最適化）。
- **失敗通知拡張**: `_notify_completion`（ai_jobs）が評価ジョブ失敗時に依頼者＋**評価者権限保持者**へ `ai_task_failed`（`evaluations/application.py eval_failure_recipient_ids`＝`_evaluator_user_ids` 再利用・graceful）。

### 3-3. frontend 実装
- **共通部品** `impl/frontend/src/features/evaluations/components/EvaluationComments.tsx`（**構造的型 RepEvaluator/RepAi に一般化**＝アイデア5観点/コンセプト8観点で再利用）＝代表コメントタブ（高評価/合意〔既定〕/懸念・`.eval-cmt-tabs`）＋総評代表＋観点別代表（観点バッジ行頭）＋「他N件→」#13 評価詳細モーダル（評価者ごとスコアカード・未入力は「コメントなし」で行高統一・AI も1枚）。
- `IdeaDetailView.tsx`／`ConceptDetailView.tsx`: 従来フラット表示を上記に置換＋AI評価カード別枠（アイデア5観点／コンセプト8観点＋Go/Pivot/Kill 推奨バッジ・再生成ボタン）＋仕切り線＋「コメント」card-title。
- `EvaluationView.tsx`（SC-25）に 🔕 非公開(private) ラジオ。`evaluations/api.ts`・`concepts/api.ts` に `regenerateAiEvaluation`＋AI型。CSS＝`features/ideas/ideas.css`（`ai-eval`/`eval-cmt-tabs`/`sc-card` 等・フォールバック色付き）。codegen 済み。

## 4. 現在の状態（動作 / テスト）
- **⑥ は backend〜frontend 完了・壊れているもの無し**。
- テスト（すべて green・本セッションで確認）: 評価 api（F-TC-213 private 他）／`tests/evaluations/test_ai_eval.py`（F-TC-215/216/217/220/221）／`tests/concepts/test_ai_eval.py`（P-TC-460/461）／concept 評価 api（P-TC-462/463）。**全回帰 230 passed**（evaluations/concepts/ai_jobs/ideas）＋strategy/concepts 105 passed。**TCトレーサビリティ ✅（1044 件）**。`npm run build` OK。e2e `sc-25-eval`/`sc-22-eval-visibility` 緑。
- 実ブラウザ目視: アイデア/コンセプトの評価パネル＋AIカード＋#13 モーダルをスクショ確認済み（使い捨て `_vis*.mjs` は削除済み）。
- **要注意（未確認）**: 稼働中の **backend コンテナは `8a25e2fa` 頃のビルド**＝最終2コミット（`4982a63b` RAG/失敗通知の backend ソース）が**ベイクされていない可能性**。RAG/失敗通知を「稼働アプリで」確認するには `cd impl && docker compose up -d --build backend` が要る（テストは `-v` マウントで検証済み＝ソースは正しい）。
- コンテナ: db/redis/minio/mailhog/backend/frontend すべて Up（`docker compose ps` 確認済み）。

## 5. 詰まっている点（試して失敗・回避策）
- **共有 dev DB のジョブ汚染**: 公開時 AI 自動 enqueue を無条件にすると ideas テストが idea_evaluate ジョブを残し、ai_jobs の process テストが拾って件数 assert が崩れた（併走で7 failed）。→ **opt-in フラグ `llm_auto_evaluate_on_publish`（既定 OFF）で gate**して解消。
- **e2e/目視の psql seed**: `psql` ヘルパーは `JSON.stringify` するので **SQL は単一行**（改行は `\n` リテラル化で壊れる）。chat 中核は `chat_thread` へ刷新済み＝`chat_messages` に `chat_group_id` 無し／idea 削除前に `chat_groups`（詳細表示で生成）を消す。
- **目視スクリプトの API**: raw chromium の `page.request` は baseURL 無し＝**絶対URL** 必須。**クエスト作成 API は `status:"evaluating"` を 422**（直接 evaluating 不可）＝`recruiting` で作成→`activate` 等。seed ユーザ id は共有 DB で揺れるので実行時に `users.login_id='user@acme.example'` 等で取得する。
- backend ベイク＝新規/未コミットテストの反映は `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest ...`。ORM/ロジックを稼働アプリに効かせるには `up -d --build backend`。

## 6. 決定事項と根拠（⑥・すべて確定）
- AI＝独立した正当な1評価（参考値でない・集計/コイン算入）／**`evaluations`・`concept_evaluations` を拡張**（別テーブルにしない＝F.1/F.4 無改修流用・DRY）。
- **再生成＝評価者権限(FR-27)保持者のみ**（owner/quest_admin でも評価者権限無ければ不可）。**再生成は版として残す**（§5.22b）。
- **アイデア＝published 自動起動**（ただしデプロイ opt-in フラグで gate）／**コンセプト＝手動のみ**（反復更新が多く途中採点はノイズ）。**バックフィル不要**。
- **コンセプトも Go/Pivot/Kill 推奨を AI が出す**（8観点＝中核5必須＋補助3任意）。
- **公開範囲 `private`（新規・人間評価にも適用）**＝投稿者＋その評価者のみ・集計/コインは visibility 無視で全 submitted 算入（現行どおり）。
- **パネルのコメント＝観点ごと代表1件**（タブ=高評価/合意〔既定〕/懸念・同点は先の確定・母集団=可視評価）＋総評も代表1件＋「他N件→#13」。**#13 評価詳細は閲覧者全員**（可視範囲準拠）。AI は別枠。
- **SC-25 折り畳みなし**／**失敗通知=評価者権限保持者＋owner/quest_admin**／**SC-04 表示**＝自動起動ジョブは system 所有(created_by=NULL)で個人SC-04非表示。
- **不採用**: 別テーブル分離（DRY違反）／擬似アカウント（accounts/XP汚染）／レベル2エージェント基盤の先行構築（YAGNI）。

## 7. 次にやること（優先順）
> ⑥ は実質クローズ。以下は「持ち越し討議」か「⑥ の任意の磨き込み」。着手前にコードで裏取り（memory `handoff-notes-often-stale`）。

1. **④【討議】おすすめクエスト選出アルゴリズム**（ユーザー案＝参加可×経営資料整合率高×直近活発×管理者お勧め→得点上位をパネル最大件数）＝意見→合意後に実装。**残る討議案件（次の着手対象）**。
2. ~~RAG に経営資料の embedding top-k~~ ＝**完了（2026-10-08）**。`eval_rag.strategy_doc_lines` を選択分優先＋top-k 追補化（config `eval_rag_strategy_topk/total/min_cosine`・`tokens/repository.py embeddings_by_type`・F-TC-222/P-TC-464）。
3. ~~SC-04 `created_by` 裏取り~~ ＝**完了（2026-10-08）**。裏取り結果＝`ai_jobs` に `created_by` 列は無かった（`requested_by_id` のみ）。**ai_jobs だけ監査列 `created_by_id`/`created_program` を追加**（migration 0058・自動評価は system 起票 NULL・SC-04 は created_by_id フィルタ・S-TC-214/F-TC-217）。
4. **（⑥ 磨き込み・任意）コンセプト #13 の recommendation 表示**＝EvaluationComments の #13 ScoreCard は recommendation を出さない（アイデア共通化のため）。コンセプトで各評価者の Go/Pivot/Kill を #13 に出すなら拡張。現状は SC-61 の推奨分布＋AIブロックで表示済み。
5. **【バックログ・要討議】データモデル §2.1 共通監査6カラムの広範な未準拠**＝規約は全テーブルに `created_at`/`created_by_id`/`created_program`＋更新3点を必須とするが、実装は**大多数のテーブルが監査列ゼロ**（ideas/evaluations/quests/concepts/notifications/chat_messages/entity_embeddings＝無し・info_items/strategy_documents＝created_by_id のみ・2026-10-08 DB実査）。今回 ai_jobs だけ created_by_id/created_program を追加。「全テーブルにバックフィル」か「§2.1 を実装実態に合わせて緩める」かを別途決める（memory `spec-is-source-of-truth`）。

### 前セッションからの持ち越し（未着手）
- Turnstile `size:flexible` 幅の実ブラウザ目視。SC-01 設計書 §3〜9 を5ゾーン再設計に整合。アイデアコンテスト Phase2。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`:8000`・frontend=`:3000`・openapi=`:8000/openapi.json`・MailHog=`:8025`。
- **反映（ソースベイク・volumes無）**：`cd impl && docker compose up -d --build backend|frontend`（ビルド完了待ち＋`curl -sf :3000/login`）。**本セッション末は backend に未ベイクのコミットがある可能性**（§4）＝RAG/失敗通知を稼働確認するならまず backend 再ビルド。型再生成＝`cd impl/frontend && npm run codegen`。
- workers（必ず `--build`）：`cd impl && docker compose --profile workers up -d --build worker mail-worker`。**AI 評価を実際に走らせる**なら `--profile ai` + `llm-worker`＋`impl/.env` に `LLM_AUTO_EVALUATE_ON_PUBLISH=true`（アイデア自動起動を試す場合）。確認後 `docker compose stop worker mail-worker llm-worker`。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- テスト：
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- `.env`（`impl/.env`・gitignore 追跡外）現状＝dev 共有スタック既定（`LLM_AUTO_EVALUATE_ON_PUBLISH` は未設定＝OFF）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社`OPS`）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium・form ログイン＋`page.request` は絶対URL＋psql は単一行）を作り**使い終わったら削除**。**必ず新コンテナ起動後に実行**。
