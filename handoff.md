# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-08（セッション末）。
- ブランチ: `main`（main 直 push が慣習・毎コミット push 済み）。
- 最新コミット: `5f3668b8`（`.env.example` 再構成＋AI系を compose 経由で設定可能化）。working tree clean。
- alembic heads: control=`0020_signup_challenges`／company=`0059_quests_recommended`（変更なし＝今セッションは migration 追加なし）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装機能の処理。

## 3. 今回やったこと（コミットと理由・新しい順）
1. `5f3668b8` **`.env.example` 最新化＋compose に AI 系 env 追加**＝`.env.example` が stale（compose が渡す LOG_*/MINIO_*/ALIGNMENT_*/ALLOWED_ORIGINS/APP_BASE_URL/LOGIN_RATE_LIMIT_*/OLLAMA_PORT/E2E_WORKER_COMPANIES を未記載）だったため現行化。さらに config.py にあるが compose 未配線だった AI 設定（`LLM_*`/`EVAL_RAG_*`/`RECOMMEND_*`/`LLM_AUTO_EVALUATE_ON_PUBLISH`/`ALIGNMENT_EMBED_TIMEOUT_SECONDS`）を `compose.yaml` の `backend_env` アンカーに追加＝`impl/.env` で設定可能にした（llm-worker 等も `*backend_env` 共有）。
2. `95ae170a` **選択中パーティ（右側）もログインIDで絞り込み**＝`QuestMemberDTO` に `login_id` 追加（`quests/application._member_dto`）・`QuestForm` の右フィルタを名前 OR login_id・メンバー行に login_id 表示（`.pmember__login`）。同名メンバー判別のため。
3. `1fd04018` **空ゾーンも常時表示（B案）**＝ダッシュボードのゾーンがデータ更新で出入りして分かりにくい指摘に対応。`DashboardView` の D/E/B 可視条件を `data !== null` に統一（空は空状態メッセージ）。stale 化していた e2e I-TC-157/158 も現構造へ追従修正。
4. `6197aade` **パーティ候補（左側）をログインIDで絞り込み**＝`QuestCandidateDTO` に login_id 追加・候補クエリ `list_cross_group_candidates`/`list_group_member_candidates` の q を名前 OR login_id に・候補チップに login_id 表示。
5. `ca2e5805` **Zone E「参加中」を参加中/所有タブに集約**＝自作クエスト（is_owner）を「所有」タブに表示（旧設計 §6 で SC-10 へ移設していたのを一部差し戻し・ユーザー要望）。`DashboardView.ownedAll`。
6. `42e9352a` **おすすめのクエストの飛び先を参加前ダイアログに**＝ダッシュボード Zone D のリンクが `/quests/{id}`（メンバー専用詳細）で未参加だと参照エラー→`/quest-catalog?quest=<id>` にして `QuestCatalogView` が参加前ダイアログを自動で開く。
7. `4ce54238` **S-TC-119 e2e 追加**＝SC-04（AI処理状況）の進捗確認・行キャンセル・完了行遷移。機能は実装済み・テストだけ欠落していた。
8. `17841991`/`7c043c52`/`8d4138ee`/`89689f08` **④おすすめクエスト選出 一式**＝ダッシュボード結線（Zone D スコアリング）＋管理者お勧め toggle（SC-13 発見カタログ・`PUT /quests/{id}/recommended`）。
9. `e5cf09e5`/`ba5d4bb5` **残作業台帳の整備＋現状化**＝「発生時に記録・完了時に削除」をプロジェクトルール化（CLAUDE.md）。memory 由来で未実装扱いしていた**実装済み機能（コンセプト FR-42/ソリューション開発 FR-43/アイデアコンテスト/経営資料LLM生成/⑥AI評価/コンセプト#13推奨）を実コードで裏取りし台帳から削除**。

## 4. 現在の状態（動作 / テスト）
- **backend/frontend とも最新コードでベイク済み**（backend は login_id 等を含む image・最後に `up -d backend` で新 env 反映／frontend は右フィルタ等を含む `--build`）。コンテナ db/redis/minio/mailhog/backend/frontend すべて Up。
- 今セッションで実際に実行し green を確認したテスト:
  - backend `tests/quests`（`--build -v` マウント run で multigroup+sc11=61 passed／おすすめ関連 145 passed）・`tests/dashboard/test_cross_domain`（I-TC-170 等）。**フル `tests/` 全体は未実行＝未確認**。
  - e2e `sc-01-dashboard*`（8+6 passed）・`sc-04-ai-jobs`（S-TC-119 含む 4 passed）・`sc-13-catalog`（C-TC-320 含む 4 passed）。
  - **AI 評価（⑥）は実装をコードで確認**（`backend/app/tenant/evaluations/ai_eval.py`・`evaluations/router.py` の `POST /ideas/{id}/ai-evaluation/regenerate`・`ideas/application._enqueue_idea_ai_evaluation`・frontend `EvaluationComments.aiEvaluation`）。テスト `tests/evaluations/test_ai_eval.py` は存在するが**今セッションでは未実行＝未確認**。
  - red-green 証跡＝各コミットメッセージに記載（C-TC-315/319/321/322・I-TC-170 等。永続化行の一時 revert で red 実測→復元で green）。
  - TC トレーサビリティ **✅ 1063**（`python3 scripts/check_tc_traceability.py`・リポジトリルートで実行）。
- `.env`/compose 検証＝`docker compose config` 妥当・新 AI env（`LLM_AUTO_EVALUATE_ON_PUBLISH` 等）が backend コンテナに `printenv` で到達することを確認・compose⇔.env.example 双方向 diff で過不足0（87/87）。

## 5. 詰まっている点（試して失敗・回避策）
- **`.env` が backend に届かない誤解の解明**＝`config.py` は `env_file=".env"` を持つが、backend コンテナに `/app/.env` は無く（Dockerfile は backend/ だけ COPY・impl/.env は対象外）、compose にも `env_file:` 無し。**唯一の経路は compose の明示マッピング `${VAR:-default}`**。→ 新しい設定を env 可変にするには **compose.yaml の backend_env に必ず追加**する（今回 AI 系を追加）。旧 handoff の「impl/.env に LLM_AUTO_EVALUATE_ON_PUBLISH」は今回の compose 追加で初めて実効化。
- **memory を鵜呑みにしない**＝前回までの handoff/memory が完了済み機能を「未実装/次=実装」と記載していた。台帳整備で実コード裏取りし多数を削除。以後、残作業の起票/削除は**必ず実コードで裏取り**（CLAUDE.md の運用ルール3に明記）。
- **共有 dev DB のノイズ**（継続）＝テストは自分の seed id の相対順序/包含で検証（絶対 top-N は避ける）。目視検証用のクエストは API で作って後始末（DELETE）する。

## 6. 決定事項と根拠
- **ダッシュボード空ゾーンは常時表示（B案・2026-10-08）**＝不採用＝旧「ゾーンごと空で非表示」（データ更新で出入りして分かりにくい）。レイアウト安定を優先。正本＝`doc/設計ドラフト/ダッシュボード再設計・お知らせ_設計.md` §3.1。
- **自作クエストを Zone E「所有」タブに再掲**＝旧 §6「SC-10 一覧へ移設」の一部差し戻し。SC-10 のスイッチは維持（ダッシュボード=要約・一覧=全件の役割分担）。
- **ログインIDで候補/メンバーを絞り込み＋表示**＝同名ユーザー（例「E2E 発行太郎」複数）の判別。login_id は tenant `users.login_id`（accounts ミラー）。
- **AI 系 env を compose へ配線**＝不採用＝backend に impl/.env をマウント（config 機構を変える・既存は compose 明示マッピング方式で統一）。既存パターンに合わせ backend_env に追加。
- **残作業台帳は未完のみ保持・完了で削除**（CLAUDE.md 設計の正本に明記）。完了記録は commit/README/handoff。

## 7. 次にやること（優先順）
> 着手前に実コードで裏取り（memory を信用しすぎない）。残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`。

1. **【ユーザー要望・次セッション冒頭】D5 情報インプット テンプレート機能に着手**＝正本 `doc/設計ドラフト/情報インプットテンプレート機能_設計.md`（新規 `info_templates`・会社DB／SC-51 登録編集モーダル拡張＋SC-5x テンプレート管理マスタ／API は `doc/API設計/N_情報インプット` に追記）。実装先＝`impl/backend/app/tenant/info/`（orm/repository/application/router/schemas 一式あり・テンプレート表/EP は未実装）。着手手順＝設計ドラフトを データモデル→API設計→画面設計→テスト TC に正式反映してから migration＋backend→frontend。
2. **バックログの他 D 項目**（`doc/バックログ/未実装・ギャップ一覧.md`）＝D1 帳票V（TC 先出し済 `doc/テスト/V_帳票.md`・`reports`/`billing` ドメイン無し）／D2 AI駆動型アイデア生成（`idea_generate` task_type 無し）／D3 カメリオ／D4 情報動的タブ／D6 SOPS／D7 アイデアを探す。
3. **ISO ギャップ G2 ポートフォリオ / G3 指標ダッシュボード（高）**・**X1 §2.1 監査6カラム未準拠（要討議）**・O1 ZAP DAST。
4. **AI 機能のローカル実動作確認（任意）**＝`impl/.env` に `LLM_AUTO_EVALUATE_ON_PUBLISH=true`＋`docker compose --profile ai up -d ollama`＋`ollama pull bge-m3`/`qwen3:4b`＋`--profile workers,ai up -d --build llm-worker`＋会社でモデル ON → アイデア published で AI 評価が自動投入されるか。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。compose は `impl/compose.yaml`。
- 起動：`cd impl && docker compose up -d`。backend=`:8000`・frontend=`:3000`・openapi=`:8000/openapi.json`・MailHog=`:8025`・MinIO=`:9000`/コンソール`:9001`。
- **反映（ソースベイク・volumes 無）**：`cd impl && docker compose up -d --build backend|frontend`。型再生成＝`cd impl/frontend && npm run codegen`（backend 再ビルド後）。env だけ変えた時は `docker compose up -d backend`（再ビルド不要）。
- workers（必ず `--build`）：`cd impl && docker compose --profile workers up -d --build worker mail-worker`。AI は `--profile ai` で `ollama`＋`--profile workers` で `llm-worker`。確認後 `docker compose stop ...`。
- テスト：
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`（entrypoint が bootstrap=migrate+seed→pytest）。
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- `.env`（`impl/.env`・gitignore 追跡外）＝`impl/.env.example` をコピーして使う。compose は明示マッピング方式＝`.env.example`/compose に無い変数は backend に届かない。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin・display_name=「ACME 管理者」）／OPS `admin@ops.example`（system_admin・会社`OPS`）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium・form ログインは `#company_code`/`#login_id`/`#password`・`page.request` は絶対URL＋CSRF ヘッダ `X-CSRF-Token`＝`iq_csrf` cookie）を作り**使い終わったら削除**。検証用に作ったクエスト等は API で DELETE して後始末。**必ず新コンテナ起動後に実行**。
