# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-08（セッション末）。
- ブランチ: `main`（main 直 push が慣習）。
- 本セッションの実コミット＝**④ おすすめクエスト選出アルゴリズムの backend 実装**（1本・docs＋backend＋migration＋test 一括）。
- working tree: 本 handoff 更新コミット前は ④ 分のみ。**別セッションの未追跡ドラフト2本**（`doc/設計ドラフト/カメリオAPI連携_設計.md`・`doc/設計ドラフト/情報インプット動的タブ_設計.md`）は巻き込まない（明示パス add で分離済み）。
- alembic heads: control=`0020_signup_challenges`／company=**`0059_quests_recommended`**（acme/acme2/demo/ops 全4DB 適用済み・列 `quests.recommended`＋索引 `ix_quests_recommended` 確認）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘消化＋仕様確定済み未実装機能を順次処理。

## 3. 今回やったこと＝④ おすすめクエスト選出アルゴリズム（backend 実装完了・討議→合意→実装）
> handoff 前版の「最優先・持ち越し討議」だった ④ を、方式合意のうえ backend 実装まで完了。フロント（SC-01 Zone D）結線は未着手。

### 3-1. 合意した方式（2026-10-08 確定）
- **候補母集団（「参加可」＝ハードフィルタ）**＝`can_discover_quest`（発見門番）∩ 閲覧者が未参加（有効 member でない）∩ 参加申請 `pending` でない。
- **スコア**＝各成分 0..1 正規化の**加重和**（乗算ではない）: `score = w_align·整合率 + w_active·直近活発 + w_admin·recommended`。
  - `align`＝適用経営資料の**平均**整合率（既存 `strategy.repository.quest_match_by_doc` の `idea_alignment` キャッシュ流用・LLM は呼ばない）。
  - `active`＝**直近30日**の〔公開アイデア＋チャット＋新規参加/申請〕件数を**母集団内 max で相対正規化**。
  - `admin`＝`quests.recommended`（新 bool 列）true→1.0（加重和ブースト）。
  - 既定重み＝0.45/0.35/0.20（`core/config.py`・env 可変）。tie-break＝score 降順→`updated_at` 降順→`id`。母集団0件→空配列。
- **ユーザー原案「参加可 × 整合率 × 活発 × お勧め」の解釈**＝「参加可」のみ掛け算的ハードフィルタ、残り3成分は足し合わせ（乗算すると admin=0 の大多数が score=0 になり破綻するため）。memory [[recommend-quest-algorithm]]。

### 3-2. 変更ファイル/関数
- migration＝`impl/backend/migrations/company/versions/0059_quests_recommended.py`＝`quests.recommended`(bool NOT NULL default false)＋部分索引 `ix_quests_recommended (recommended) WHERE recommended AND deleted_at IS NULL`。**索引は migration 同梱**（bootstrap で入る＝今回は drift なし）。
- ORM＝`app/tenant/quests/orm.py`（`Quest.recommended`）。
- config＝`app/core/config.py`（`recommend_weight_align/active/admin`・`recommend_active_window_days=30`・`recommend_default_limit=3`・`recommend_max_limit=10`）。
- repository＝`app/tenant/quests/repository.py`＝`list_recommend_candidates`（候補母集団・`_discoverable_conds` 流用＋member/pending の NOT EXISTS）・`recent_activity_counts`（窓内活動＝公開アイデア＋チャット＋参加/申請の合算）。chat＝`app/tenant/chat/repository.py` に `message_counts_by_quest`（一括版・`daily_message_counts_for_quest` と同母集合）。
- application＝`app/tenant/quests/application.py`＝`_align_for_quest`（整合率平均・グレースフル）・`score_and_rank`（純関数・正規化＋加重和＋tie-break）・`get_recommended_quests`（オーケストレーション・limit クランプ・整合率欠損は try/except で 0 成分縮退）。
- router/schema＝`GET /quests/recommended?limit=3`（**動的 `/quests/{quest_id}` より前に宣言**＝"recommended" が quest_id に捕捉されるのを防ぐ）・`RecommendedQuestsResponse`/`RecommendedQuestCardDTO`（catalog カード＋`score`・`my_state` は候補が未参加なので通常 none）。
- 設計＝データモデル §5.6（`recommended` 行）・`doc/設計ドラフト/ダッシュボード再設計・お知らせ_設計.md` §8a（確定仕様）・`doc/API設計/C_クエスト・パーティー・権限.md` C.9.1（EP 追記）。
- テスト＝`tests/quests/test_recommend.py`（C-TC-309〜314）。TC 行＝`doc/テスト/C_クエスト.md` §8。

## 4. 現在の状態（動作 / テスト）
- **④ のソースは green**。新テスト6件＋回帰ともに green（`-v` マウントで検証）。
  - `tests/quests` ＝ **142 passed**／`tests/chat tests/ideas tests/strategy tests/evaluations` ＝ **183 passed**。
  - red-green 証跡＝C-TC-309（除外条件を一時 revert→red）／C-TC-311・313（admin 項を一時 revert→red）→復元で green。コミットメッセージに記載。
  - TC トレーサビリティ **✅ 1053 件**（`scripts/check_tc_traceability.py`・リポジトリルートで実行）。
- **要注意①＝backend コンテナが未ベイク**＝稼働中の `backend`（:8000）は旧イメージのまま＝`GET /quests/recommended` も `recommended` ORM も**稼働アプリ未反映**。稼働確認は `cd impl && docker compose up -d --build backend` が必須。※DB は 0059 適用済み（`docker compose run` の bootstrap が全4会社DBへ適用）なので旧イメージ×新DBでも壊れない（旧 ORM は recommended を触らない）。
- **frontend 変更なし**（④ は backend のみ・`npm run build` 不要）。e2e は本セッション未実行。
- コンテナ: 本セッション db/redis/minio/mailhog/backend/frontend すべて Up。

## 5. 詰まっている点（試して失敗・回避策）
- **共有 dev DB のおすすめ候補ノイズ**＝全社（部署0件）discoverable クエストは閲覧者全員に見える。おすすめ EP は top-N なので、テストは**自分の seed id の相対順序（subsequence）**で検証（絶対 top-N は避ける）。acme には全社 discoverable 候補が1件あり（活動あり）＝ノイズは相対順序に影響しない。
- **ルート順**＝FastAPI は宣言順マッチ。`/quests/recommended`（単一セグメント）は `/quests/{quest_id}` より**前**に置く（後ろだと quest_id="recommended" で 404/422）。
- **red-green の staging**＝実装とテストを同一ターンで書くため、red は実装側を一時 revert→2テスト fail→復元で取得（§4）。
- **並行セッションと working tree 共有**（継続注意）＝別セッションが同じ working tree にドラフトを置くことがある。コミットは `git add` を**明示パス指定**して自分の変更分だけ拾う。
- **目視/テストの psql seed**（継続）＝`psql` ヘルパーは単一行 SQL。seed user id は共有 DB で揺れるので `users.login_id='user@acme.example'` 等で実行時取得。

## 6. 決定事項と根拠
### ④ おすすめクエスト選出（2026-10-08 確定・実装済み）
- **管理者お勧め＝新列 `quests.recommended` 追加で4成分**（不採用＝3成分で後回し／既存ピン流用）。規約 §2.1 の監査列バックフィルは別件（本列は単独追加）。
- **加重和ブースト（admin を一項として加算）**（不採用＝ハードピン＝recommended を常に最優先枠に固定）。整合率ゼロの無関係クエストを押し上げない一方、ブーストで上位化はする。
- **直近30日・アイデア＋チャット＋参加/申請**（不採用＝14日のみ／アイデア件数のみ）。**整合率は資料横断で平均**（不採用＝最大）。
- **スコアリングだけ先行（EP まで）**＝ダッシュボード再設計（Zone 再編＝Phase1）未実装でも独立に検証可（後から Zone D パネルがこの EP を叩く）。管理者 toggle UI/EP は follow-up。
- 正本＝`doc/設計ドラフト/ダッシュボード再設計・お知らせ_設計.md` §8a・API設計 C.9.1・データモデル §5.6。

### ⑥ LLM自動評価（前セッション・参照）
- AI＝独立した正当な1評価者／再生成＝評価者権限(FR-27)保持者のみ・版として残す／アイデア=published 自動起動（opt-in gate `llm_auto_evaluate_on_publish` 既定OFF）・コンセプト=手動。RAG top-k（②）・SC-04 起票主体フィルタ（③ `ai_jobs.created_by_id`）まで実装済み。正本＝`doc/設計ドラフト/アイデアLLM自動評価_設計.md`。

## 7. 次にやること（優先順）
> 着手前にコードで裏取り（memory `handoff-notes-often-stale`）。

1. **（次セッション冒頭推奨）backend 再ビルドして ④（と ②③）を稼働確認**＝`cd impl && docker compose up -d --build backend`。確認観点＝`GET /quests/recommended?limit=3` が未参加 discoverable を score 降順で返す／`quests.recommended=true` が上位化。整合率を効かせるなら経営資料＋公開アイデアの整合キャッシュがあるクエストで。
2. **④ のフロント結線（SC-01 ダッシュボード Zone D）**＝ダッシュボード再設計 Phase1（ゾーン再編）と合流。おすすめパネル（最大3件・空状態メッセージ）が `GET /quests/recommended` を叩く。
3. **管理者お勧め toggle（`recommended` を立てる UI/EP）**＝`company_account_admin` 向け。follow-up（本 Phase はスコアリング読取まで）。
4. **【バックログ・要討議】データモデル §2.1 監査6カラムの広範な未準拠**（memory `audit-columns-21-noncompliance`）＝全テーブルにバックフィルか §2.1 を緩めるか。現状 ai_jobs のみ対応。
5. **帳票（V）の実装着手**＝設計ドラフト起票済み・実装未着手。縦1本（SC-92 使用料請求書→API V.x→レンダラ port→PDF）。TC 先出し済み＝`doc/テスト/V_帳票.md`。memory [[jasper-report-integration-design]]。
6. **前セッションからの持ち越し（未着手）**＝Turnstile `size:flexible` 幅の実ブラウザ目視／アイデアコンテスト Phase2／コンセプト #13 recommendation 表示（優先度低）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`:8000`・frontend=`:3000`・openapi=`:8000/openapi.json`・MailHog=`:8025`。
- **反映（ソースベイク・volumes無）**：`cd impl && docker compose up -d --build backend|frontend`。**本セッション末は backend に未ベイクの ④（と ②③）がある**（§4）。型再生成＝`cd impl/frontend && npm run codegen`。
- workers（必ず `--build`）：`cd impl && docker compose --profile workers up -d --build worker mail-worker`。AI 評価を走らせるなら `--profile ai` + `llm-worker`＋`impl/.env` に `LLM_AUTO_EVALUATE_ON_PUBLISH=true`。確認後 `docker compose stop worker mail-worker llm-worker`。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）／`-d ideaquest_ops`（OPS 会社）。資格＝`ideaquest`/`ideaquest`。
- テスト：
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`（entrypoint が bootstrap=migrate+seed→pytest を実行＝**新 migration も全会社DBへ適用される**）。
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- `.env`（`impl/.env`・gitignore 追跡外）現状＝dev 共有スタック既定（`LLM_AUTO_EVALUATE_ON_PUBLISH` 未設定＝OFF）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社`OPS`）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium・form ログイン＋`page.request` は絶対URL＋psql は単一行）を作り**使い終わったら削除**。**必ず新コンテナ起動後に実行**。
