# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況スナップショット）／`doc/設計ドラフト/ローカルLLM連携_設計.md`（FR-45 の設計正本）／`doc/API設計/S_AIジョブ・LLM連携.md`（S ドメイン API）／`doc/テスト/S_AIジョブ.md`（S-TC 台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-30（セッション末）
- ブランチ: `main`（作業ツリー clean）。**未 push あり**＝`1ee23b56`・`fa5593d9`＋本 handoff コミット（push 済は `89940d69` まで）。
- 本セッションのコミット（新しい順）:
  - `fa5593d9` feat(ai-jobs): SC-04 アクションメニューに「詳細を開く」＋詳細モーダル（読み取り専用）【未push】
  - `1ee23b56` feat(ai-jobs): 待ちジョブの順番待ち位置＋概算ETA（SC-04）【未push】
  - `89940d69` feat(ai-jobs): SC-04 AI処理状況（フロント・自分のジョブ一覧）【push済】
  - `5bfe7a8d` docs(handoff)【push済】
  - `495b53c8` feat(ai_jobs): S.5 管理EP（会社モデル ON/OFF・予算・利用量メータリング）【push済】
  - `1ec2edd5` feat(ai_jobs): llm_worker＋完了通知（ai_task_done/failed・compose workers）【push済】
  - `fdd07073` feat(ai_jobs): AIジョブ API（router S.1/S.2・依頼者スコープ）【push済】
  - `7f43d09f` feat(ai_jobs): AIジョブ基盤データ層＋状態機械（migration 0048）【push済】
  - `7b6c7ec9` fix(seed): bootstrap の chat シードを thread_id へ【push済】
  - `6159e68f` feat(llm): LLMゲートウェイ層（infra/llm）【push済】
  - `9611e6bf` feat(design): FR-45 LLM連携基盤の正式反映（要件/データモデル/API/画面/テスト）【push済】
  - `e93ac5ee` test(e2e): 陳腐化した e2e を現行スキーマ/データに追随【push済】

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。本セッションの本命＝**FR-45 LLM連携基盤（横断インフラ＝LLMゲートウェイ×AIジョブ基盤×会社モデル設定/課金）の設計正式反映＋Phase1 実装**。

## 3. 今回やったこと（変更したファイルと理由）

### (A) 引き継ぎ検証＋e2e 回帰の締め（コミット e93ac5ee）
- 前セッション状態は全 green を確認（backend 879／vitest 218／トレーサビリティ）。**e2e 並列フルで決定的に落ちる3本を修正**（すべてテスト側の陳腐化・アプリのデグレ無し）＝`impl/frontend/e2e/sc-24-chat.spec.ts`（chat_thread 刷新で廃止列 `chat_group_id`→`thread_id` に統一）／`impl/frontend/e2e/sc-50-info-list.spec.ts`（特定 seed タイトル依存→行数待ちに）。

### (B) FR-45 設計の正式反映（コミット 9611e6bf）
- 設計ドラフト `doc/設計ドラフト/ローカルLLM連携_設計.md`（2026-09-29 主要8論点合意済）を各正本へ転記。**採番＝FR-45／API ドメイン S／SC-04（AI処理状況・一般）・SC-94（会社のLLM設定・company_account_admin）**。
- `doc/要件定義/README.md`（FR-45 行）／`doc/データモデル.md`（§5.57 ai_jobs・§5.58 company_ai_model_settings・§5.59 ai_usage_events＋通知 type ai_task_done/failed）／`doc/API設計/README.md`（S 行＋R 行の更新漏れ是正）＋新規 `doc/API設計/S_AIジョブ・LLM連携.md`／新規 `doc/画面設計/screens/SC-04_AI処理状況.md`・`SC-94_会社のLLM設定.md`＋`doc/画面設計/画面遷移図.md`／新規 `doc/テスト/S_AIジョブ.md`（S-TC 先出し）。

### (C) FR-45 Phase1 backend 実装（コミット 6159e68f→7b6c7ec9→7f43d09f→fdd07073→1ec2edd5→495b53c8→1ee23b56 の backend 分）
縦1本＝`info_summarize`（enqueue→worker→gateway→result→usage→通知）を end-to-end に通した。
- **ゲートウェイ**＝`impl/backend/app/infra/llm/gateway.py`（`LLMResult`／`ChatClient` Protocol／`OpenAICompatibleChat`／`FakeChat`／`set_/get_chat_client`／`complete(task_type, messages, model=None)`）＋`registry.py`（論理キー→物理・`qwen3-light`/`qwen3-swallow`・`resolve_key` 優先順位・`list_models`・`catalog_billing`）。embeddings.py と同流儀（物理は基盤側・Fake 注入）。config＝`app/core/config.py` に `llm_*`（base_url/api_key/timeout/model_light/model_swallow/worker_concurrency/poll/max_attempts/reclaim）。
- **ジョブ基盤**＝`app/tenant/ai_jobs/orm.py`（3表）＋`migrations/company/versions/0048_ai_jobs.py`＋`migrations/company/env.py`（ai_jobs/info orm 登録）＋`repository.py`（`create_job`／`claim_queued`＝FOR UPDATE SKIP LOCKED／`reclaim_stuck_running`／`record_usage`／`queue_info`＝順番待ち位置＋ETA／管理系 `upsert_model_setting`/`month_cost`/`usage_aggregate`）＋`application.py`（`enqueue`/`process_ai_jobs_once`＝孤児回収→キャンセル反映→N件確保→実行／`process_all_companies_once`＝全会社巡回／API 向け `list_jobs`/`summary`/`get_job`/`cancel_job`/`list_models`／管理 `admin_list_models`/`admin_patch_model`/`admin_usage`／`_notify_completion`）。
- **router**＝`app/tenant/ai_jobs/router.py`（S.1 `POST /ai-jobs`・`GET /ai-jobs`・`/summary`・`/{id}`・`/{id}/cancel`／S.2 `GET /ai-models`／S.5 管理 `GET/PATCH /admin/ai-models`・`GET /admin/ai-usage`）＋`schemas.py`。`app/main.py` に `ai_jobs_router` 登録。
- **ワーカー**＝`app/llm_worker.py`（mail_worker 型・`process_all_companies_once` をループ）＋`impl/compose.yaml` に `llm-worker` サービス（profile workers）。
- **通知**＝`app/tenant/notifications/service.py`（TYPE_PRIORITY に ai_task_done/failed）・`catalog.py`（ICON・task ラベル・render 分岐 JA/EN）。
- **seed 修正（7b6c7ec9）**＝`scripts/bootstrap.py` の発見デモ chat シードが旧列 `chat_group_id` を使い**新規DB作成で必ず失敗**していた潜在バグを `ensure_chat_thread`＋`thread_id` に修正。

### (D) FR-45 Phase1 frontend（コミット 89940d69→1ee23b56→fa5593d9 の front 分）
- **SC-04 AI処理状況**＝`impl/frontend/src/features/ai-jobs/`（types/api/`AiJobsListView`/index/css）＋route `src/app/(app)/ai-jobs/page.tsx`。踏襲＝SC-02＋共有 DataTable（サーバー委譲）。一覧＋summary バッジ＋cancel。
- **順番待ち位置＋ETA（1ee23b56）**＝進捗列（見出し「進捗・待ち」）で queued を「N番目・約M分後」表示。backend `queue_info`＋schemas 2フィールド。
- **詳細＋メニュー（fa5593d9）**＝アクションメニューに「詳細を開く」追加（順＝詳細を開く→内容を参照する→キャンセル）。詳細は URL 付きモーダル（`src/app/(app)/ai-jobs/[jobId]/page.tsx`＋`@modal/(.)ai-jobs/[jobId]/page.tsx`＋`AiJobDetailModal`/`AiJobDetailPanel`）。

## 4. 現在の状態
- **動いている（本セッションで確認済み）**:
  - FR-45 Phase1 backend＝完成・green。縦1本 `info_summarize` が enqueue→worker（全会社DB巡回）→gateway→result→usage→ai_task_done 通知 で end-to-end。
  - SC-04 フロント＝一覧・順番待ち位置/ETA・詳細モーダル・アクションメニュー。`npm run build` green。**スクショ目視検証済み**（待ち「N番目・約M分後」／メニュー順「詳細を開く→キャンセル」／詳細モーダルの結果・実行情報）。
  - backend テスト＝`tests/ai_jobs` 22 passed／`tests/infra` 6 passed（gateway）。トレーサビリティ ✅（直近 926 件）。
  - **クリーンDBフル pytest＝907 passed**（セッション末に acme/acme2 を drop→bootstrap 再作成して実行・2026-09-30）。
- **壊れているもの**＝確認範囲では無し。
- **未確認**＝(a) frontend `vitest` 全域・Playwright e2e フルは本セッション末では未再実行（SC-04 追加後）／(b) 実 LLM（Ollama）での生成は未実施＝テストは FakeChat 固定・実機縦1本は未通し。
- **e2e/backend とも共有dev DB 蓄積で一部テストが汚染で落ちることがある**＝実バグ判定は必ず**直列 --workers=1（e2e）／クリーンDB（backend＝acme drop→bootstrap）**で切り分ける（§5）。

## 5. 詰まっている点（試して失敗した / なぜ失敗したか）
- **Playwright をパイプに繋ぐと exit code がマスクされる**（`npx playwright ... | tail` は tail の 0 を返す）＝失敗を見逃す。本体 exit code か "N failed" 行で確認。
- **backend 共有dev DB の蓄積汚染**＝`I-TC-161 recent_chats`・`A-TC-064`・`H-TC-151` などがフル実行時のみ落ちるが**単体/クリーンDBでは green**＝コード起因でない。判別＝acme/acme2 を drop→bootstrap 再作成してフル実行。
- **process_ai_jobs_once は会社全体の queued を N件（既定1）claim する**＝**確認用に手動投入したデモ ai_jobs が pytest の対象ジョブを横取り**して S-TC-103/105 が落ちた。**デモジョブは確認後に必ず削除**（`DELETE FROM ai_jobs WHERE input->>'demo'='true'`）。
- **通知の ref_* は idea/quest/idea_revision/achievement/chat_message のみ**（notifications ORM に info_item/strategy_document/ai_job の ref 列は無い）＝AI 完了通知は job の ref_idea/quest があれば載せ、無ければ ref 無し（frontend が ai_task_* を SC-04 へ誘導する想定）。
- **frontend/backend はイメージにベイク**＝変更は `docker compose up -d --build frontend|backend` で反映。新 DTO は backend 再ビルド→`npm run codegen`→frontend ビルドの順。

## 6. 決定事項と根拠（採用しなかった案も）
- **SC-94 は company_account_admin**（設計 §4.2）＝既存の会社フラグ設定（SC-92＝system_admin のみ）とは**別カテゴリ**（運営の技術設定 vs 会社の課金判断）。不採用＝SC-92 に相乗り（運営スコープと課金判断が混ざる）。
- **課金方式 A（内部メータリングのみ・実請求なし）採用・B/C 算出根拠（`ai_usage_events`）は今から恒久保持**（単価スナップショット付き・論理削除しない）＝後から遡及計算可。不採用＝B/C を今実装（契約/経理要件が絡み範囲大）。
- **待ちジョブ表示＝位置＋概算ETA**（ユーザー選択）＝位置は決定的（会社全体の rn）・ETA は直近平均処理時間からの概算（履歴無しは位置のみ）。不採用＝残件数のみ／位置のみ。
- **アクションメニュー順＝詳細を開く→内容を参照する→キャンセル**（デザイン標準§4.5＝主要/参照→…→破壊的は最後）。
- **詳細は URL 付きモーダル**（RouteModal intercept＋フルページ fallback）＝プロジェクト標準（ローカル state モーダル禁止）。
- **e2e 3本・seed の chat_group_id 修正はテスト/シード側の陳腐化対応**（chat_thread 刷新の追随漏れ）＝アプリ改修ではない。

## 7. 次にやること（優先順・具体的に）
1. **回帰の締め（着手前に）**＝(a) frontend `cd impl/frontend && npx vitest run` 全域／(b) Playwright e2e フル（`npx playwright test --project=chromium` で**本体 exit code**を見る・落ちたら `--workers=1` で切り分け）。SC-04 追加後に未再実行。
2. **SC-94 会社のLLM設定（フロント）**＝backend S.5 EP は実装済（`GET/PATCH /admin/ai-models`・`GET /admin/ai-usage`）。新規 `impl/frontend/src/features/ai-models/`（or ai-jobs feature 内）＋route `src/app/(app)/admin/ai-models/page.tsx`（踏襲＝SC-93 管理系）。ON/OFF トグル＋月次予算入力＋当月利用/コスト表示＋`paid` ON の確認モーダル（課金合意）。型は `npm run codegen` 済（schema.d.ts に admin/ai-models あり）。
3. **モデルピッカー**＝`GET /ai-models`（会社有効キー・候補1でも常設）を info_summarize を呼ぶ機能画面に置く（設計 §9.2）。まだ「info_summarize を呼ぶ UI」が無い＝どの画面から要約を依頼するか（情報詳細 SC-52 等）を決めて enqueue 導線＋ピッカーを付ける。
4. **SC-04 への導線**＝ヘッダーのベル近傍バッジ（実行中/待ち件数＝`GET /ai-jobs/summary`）＝`impl/frontend/src/features/notifications/components/LiveAppHeader.tsx` 変更／or グローバルナビ（`components/layout/AppNav`）に「AI処理状況」を追加。現状は `/ai-jobs` を URL 直打ちでのみ到達。
5. **実機で縦1本を通す（任意）**＝`docker compose --profile ai up -d ollama` → `docker compose exec ollama ollama pull qwen3:4b`（config `llm_model_light`）→ `--profile workers up -d llm-worker` → SC-04 から enqueue して succeeded まで確認。
6. **Phase2（後段）**＝`iso_generate`（FR-44⑤・既定 qwen3-swallow）／`anthropic` 等クラウドアダプタ／immediate 実行方式／協調キャンセルの running 実装（S-TC-118）／進捗ストリーム（S-TC-116）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd 不持続）。compose＝`impl/compose.yaml`。
- 通常起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**新 DTO は backend 再ビルド後に `cd impl/frontend && npm run codegen`**（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）→frontend ビルド。
- **backend pytest**（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（対象限定は末尾に `tests/ai_jobs` 等）。**全テストは FakeEmbeddings＋FakeChat 固定**（conftest autouse）＝ネット不要。クリーンDB切り分け＝`docker compose exec -T db psql -U ideaquest -d postgres -c "DROP DATABASE IF EXISTS ideaquest_company_acme WITH (FORCE);"`（acme2 も）→ 次の pytest が bootstrap で再作成。
- **frontend 検証**＝`cd impl/frontend && npm run build`（tsc/lint 兼・必須）・`npx vitest run <path>`。e2e＝`npx playwright test <spec> --project=chromium`（**本体 exit code を見る・パイプ禁止**・実バグは `--workers=1`）。storageState 認証＝既定 `user@acme`。使い捨て spec＝`e2e/tmp-*.spec.ts`（確認後削除）・スクショ `tmp_shots/`。
- **LLM 基盤**（実生成・profile ai）＝`docker compose --profile ai up -d ollama` → `docker compose exec ollama ollama pull qwen3:4b`（chat・config `llm_model_light`）／`bge-m3`（埋め込み・FR-44）。**既定 up では起動しない**（未起動なら chat は LLMUnavailable→リトライ／埋め込みは keyword フォールバック）。env＝`LLM_BASE_URL`（既定 `http://ollama:11434/v1`）・`LLM_MODEL_LIGHT`（既定 `qwen3:4b`）・`LLM_MODEL_SWALLOW`・`LLM_WORKER_CONCURRENCY`（既定1）。
- **ワーカー**（mail/account_sync/llm）＝`docker compose --profile workers up -d`（既定 up では非起動）。**pytest 時は競合回避に `docker compose stop worker mail-worker llm-worker`**。
- **TC トレーサビリティ**＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート・**一意性は見ない**＝採番前に当該ドメインの max を grep）。S-TC 実装済＝201-206（gateway unit）・101/103/105/107/108/109/110/112/115/117/120/121/125/126/127/129（int/api）。**未実装（先出しのみ）**＝102 冪等・104 N並行・106 timeout・111 明示model・113 会社OFF（api 相当は test_admin_model_disabled で確認済）・114 external・116 進捗・118 running協調キャンセル・119/128 e2e・122/123/124。company migration head＝**0048_ai_jobs**（次は 0049）。R-TC max 208/115・C-TC max 305。
- **ポート**＝frontend `:3000`／backend `:8000`／MailHog `:8025`／MinIO `:9000`／Ollama `:11434`（profile ai）。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme.example`（company_account_admin）／`admin@ops.example`（system_admin）・共に `Passw0rd!`。
- **DB 直確認**＝`docker compose -f impl/compose.yaml exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。FR-45 表＝`ai_jobs`・`company_ai_model_settings`・`ai_usage_events`。会社DBの user_id は control `accounts.login_id`→`accounts.id`→会社DB `users.account_id` で引く。
