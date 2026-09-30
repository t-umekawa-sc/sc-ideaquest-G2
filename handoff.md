# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況スナップショット）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ台帳）／`doc/設計ドラフト/ローカルLLM連携_設計.md`（LLM連携基盤の設計正本＝FR-45）／`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`（経営資料整合＝FR-44）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-30（本セッション末）
- ブランチ: `main`（作業ツリー clean を目標）。origin/main と同期。
- 本セッションのコミット（新しい順・想定）:
  - `feat(design): FR-45 LLM連携基盤の正式反映（要件/データモデル/API/画面/テスト）＋handoff`（本コミット）
  - `e93ac5ee` test(e2e): 陳腐化した e2e を現行スキーマ/データに追随（chat=thread_id・info-list=行数待ち）
  - `8dc4ecf9` docs(handoff): セッション末・全文更新（経営資料整合 R = Step1〜5＋4-b＋4-d 完了）
  - `6ccc47b0` feat(quests): クエストの語像＝議論の主題（4-d）

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。直近の完了フェーズ＝**経営資料整合（FR-44・ドメイン R）＝Step1〜5＋4-b＋4-d 完了**。本セッションの本命＝**FR-45 LLM連携基盤の設計正式反映**（4-c＝FR-44⑤ in-app 生成 等の前提インフラ）。

## 3. 今回やったこと（変更と理由）

### (0) 引き継ぎ検証＝前セッション状態は全て green（コード変更なし）
- backend フル pytest＝**879 passed**（`docker compose run` で実機確認）。frontend vitest＝**218 passed**。TC トレーサビリティ＝✅（code 905 件）。handoff.md の記述と実リポジトリは完全一致（main/clean/同期/最新コミット整合）。

### (1) e2e 回帰の締め＝陳腐化テスト3本を修正（コミット `e93ac5ee`）
- **重要な落とし穴**＝`npx playwright ... 2>&1 | tail` は**パイプの exit code（tail=0）が返り、Playwright の失敗がマスクされる**。真の結果は本体 exit code か "N failed" 行で見る。
- 並列フル（workers=7 既定）は **exit 1・13 failed/9 failed 等**が出るが、**直列（--workers=1）で切り分けると大半は既知の ~4-6% 並列競合**（設定コメント既知・retries=2 が通常吸収・単体では全て green）。**直列でも落ちる真の failure は3本のみ**で、いずれも**テスト側の陳腐化**（アプリのデグレ無し）:
  - `sc-24-chat.spec.ts`（E-TC-220/221）＝chat_thread 刷新でメッセージは `chat_messages.thread_id` 所属に変更済みなのに、ヘルパが廃止列 `chat_group_id` を参照（`ERROR: column does not exist`）。API レスポンスの `thread_id`（`chat_group_id` とは別エンティティ＝application.py:85 vs 102）と SQL 列を **thread_id に統一**。
  - `sc-50-info-list.spec.ts`（N-TC-203）＝sticky ヘッダー検証のアンカーを特定 seed タイトル「競合A社…」に依存。`市場・業務メモ` seed 30行の増加で既定ページ（-created_at）から外れ toBeVisible タイムアウト。**行数(>=5)待ちに変更**（sticky 検証に必要なのは行高でありアンカー文言ではない）。
  - 修正3本を直列で green 確認（18 passed）。

### (2) FR-45 LLM連携基盤の正式反映（§12・本コミット）
設計ドラフト `ローカルLLM連携_設計.md`（2026-09-29 主要8論点合意済）を**各正本へ転記**（新規の再設計ではなく整合転記）。段階レビューで進行（要件→データモデル→API→画面→テスト）。**採番＝FR-45／API ドメイン S／SC-04（AI処理状況・一般ユーザー）・SC-94（会社のLLM設定・company_account_admin）／テスト S-TC**。
- **要件**＝`doc/要件定義/README.md` に FR-45 行（①ゲートウェイ〔自前薄層・OpenAI互換・論理キーregistry〕②AIジョブ基盤〔状態機械＋dispatcher分離・N件制御〕③協調キャンセル ④段階進捗 ⑤機能側モデル指定＋ピッカー ⑥会社ON/OFF＋課金A＋B/C基礎恒久保持 ⑦通知/画面 ⑧データ主権）。
- **データモデル**＝`doc/データモデル.md` §5.57 `ai_jobs`／§5.58 `company_ai_model_settings`／§5.59 `ai_usage_events`（会社DB・追記専用の課金基礎は独立保持）＋通知 `type` に `ai_task_done`/`ai_task_failed`。migration は実装時採番。
- **API**＝`doc/API設計/README.md` の表に **S 行＋R 行（R は更新漏れだったので併せて是正）**／新規 `S_AIジョブ・LLM連携.md`（S.0 認可〜S.7 セキュリティ・EP＝`POST /ai-jobs`・`GET /ai-jobs`・`/summary`・`/{id}`・`/{id}/cancel`・`GET /ai-models`・管理 `GET/PATCH /admin/ai-models`・`GET /admin/ai-usage`）。
- **画面**＝新規 `SC-04_AI処理状況.md`（踏襲＝SC-02＋共有DataTable）・`SC-94_会社のLLM設定.md`（踏襲＝SC-93 管理系）＋`画面遷移図.md`（§1表・§2 mermaid〔DASH→SC-04・ACCADMIN→SC-94〕・§3 ロール別）。
- **テスト**＝新規 `doc/テスト/S_AIジョブ.md`（S-TC-101〜128 先出し）。

## 4. 現在の状態
- 動いている（本セッションで確認済み）＝backend pytest 879 passed／frontend vitest 218 passed／TC トレーサビリティ ✅（905）／e2e 決定的失敗3本を修正し直列 green。
- 壊れているもの＝無し。**e2e 並列フルは環境特性で exit 1 になり得る**（~4-6% 競合分散・単体では green・retries 吸収）＝実バグ判定は必ず**直列 --workers=1 で切り分ける**。
- FR-45 は**設計正式反映まで完了・実装は未着手**（コード無し＝S-TC は先出しのみ）。

## 5. 詰まっている点（試して失敗した/落とし穴）
- **Playwright をパイプに繋ぐと exit code がマスクされる**（`| tail` は tail の 0 を返す）＝失敗を見逃す。exit code は本体で受けるか "N failed" 行で確認。
- **e2e 並列フルは非決定（~4-6%）**＝落ちた顔ぶれで実バグと即断しない。直列で再現するものだけが真の failure。
- **chat は chat_thread 刷新済**＝`chat_messages.thread_id`（FK→chat_thread）が正。`chat_group_id` は API レスポンスの後方互換フィールド（別エンティティ）で、メッセージ所属には使えない。
- **frontend/backend はイメージにベイク**＝変更は `docker compose up -d --build frontend|backend` で反映。新 DTO は backend 再ビルド→`npm run codegen`→frontend ビルド。

## 6. 決定事項と根拠（本セッション）
- **e2e 3本の修正はテスト側の陳腐化対応**（アプリ改修ではない）。新規 TC 採番なし（既存 TC の機構修正・根拠不変）＝テスト md 変更不要。
- **FR-45 正式反映の採番**＝FR-45／ドメイン S／SC-04・SC-94／S-TC（ユーザー承認済）。
- **SC-94 は company_account_admin**（ドラフト §4.2）＝既存の会社フラグ設定（SC-92＝system_admin のみ）とは**別カテゴリ**（運営の技術設定 vs 会社の課金判断）。SoD 根拠を各所に明記。
- **課金方式 A（内部メータリングのみ）採用・B/C 基礎（`ai_usage_events`）は今から恒久保持**（後から遡及計算可能に）。

## 7. 次にやること（優先順・具体的に）
1. **FR-45 Phase1 の実装着手**＝設計正式反映が済んだので実装へ。縦1本＝`info_summarize`（enqueue→llm_worker→ゲートウェイ→result→通知→SC-04）。順序＝`infra/llm`（gateway/registry/providers/openai_compat）→`tenant/ai_jobs`（状態機械・repository・application・router）→`llm_worker`（compose workers に追加）→SC-04/SC-94 画面（モック先行）。TC は `doc/テスト/S_AIジョブ.md`（先出し済）に沿って red-green。dev LLM＝Ollama（`--profile ai`・軽量 Qwen3）。
2. **FR-44⑤ Phase2（4-c＝in-app 生成 `iso_generate`）**＝上記 LLM 基盤が動いたら2本目の task_type として載せる（既定 `qwen3-swallow`）。整合率の決定性は崩さない（生成は別軸）。
3. **doc 債務の是正（任意）**＝画面遷移図に **SC-80(経営資料) 系が未掲載**（FR-44 の更新漏れ）。触れる機会に正規化。
4. **バックログ**＝`doc/バックログ/未実装・ギャップ一覧.md`・アイデアコンテスト（`513ff831`）・ISO ギャップ（6.4/9.1）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd が持続しない）。compose＝`impl/compose.yaml`。
- 通常起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**新 DTO の型は backend 変更後に `cd impl/frontend && npm run codegen`**→frontend ビルド。
- LLM 基盤（FR-45 実装・意味整合 R でも使用）＝`docker compose --profile ai up -d ollama` → `docker compose exec ollama ollama pull bge-m3`（埋め込み）／実装時は軽量 Qwen3 も pull。**既定 up では起動しない**。env＝`ALIGNMENT_EMBED_*`（R 用）／FR-45 実装時は `LLM_WORKER_CONCURRENCY`（既定1）等を追加予定。
- 非同期系（mail・sc-90 ディレクトリ・将来 llm_worker）＝`docker compose --profile workers up -d`（既定 up では非起動）。**pytest 時は競合回避に `docker compose stop worker mail-worker`**。
- backend pytest（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（対象限定は末尾に `tests/strategy` 等）。**全テストは FakeEmbeddings 固定**（conftest autouse）＝ネット不要。
- frontend 検証＝`cd impl/frontend && npm run build`（tsc/lint 兼）・`npx vitest run <path>`。**e2e は必ず本体 exit code を見る**＝`npx playwright test --project=chromium > log 2>&1; echo $?`（パイプ禁止）。実バグ切り分けは `--workers=1` で直列再現。storageState 認証（既定 `user@acme`）・管理者画面は spec 側で `kanri@acme.example` を自前ログイン。
- TC トレーサビリティ＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート・**一意性は見ない**＝採番前に当該ドメインの max を grep）。現在＝R-TC max 208/115、C-TC max 305、**S-TC は 101〜128（先出し・コード無し）**。
- ポート＝frontend `:3000`／backend `:8000`／MailHog `:8025`／MinIO `:9000`／Ollama `:11434`（profile ai）。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme.example`（company_account_admin）／`admin@ops.example`（system_admin）・共に `Passw0rd!`。
- DB 直確認＝`docker compose -f impl/compose.yaml exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。FR-45 の表（実装後）＝`ai_jobs`・`company_ai_model_settings`・`ai_usage_events`。
