# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう全文上書きで維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-03 JST
- ブランチ: `main`（作業は main 直 push が本プロジェクトの慣習）
- 最新コミット: `2e6bcc1b docs(handoff)` の上に **Step2b-2 単一ポリシー統合**（本セッション・未コミットなら要 commit/push）
- working tree: Step2b-2 の変更あり（`access.py` 新規＋4ゲート編集＋テスト＋doc）。commit/push はユーザー承認後。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別 DB）。ゲーミフィケーション付き。
現フェーズ＝**アイデアコンテスト機能（FR-46/47/48）を段階実装中**。直前まで FR-44 経営資料・FR-45 LLM連携の仕上げを実施。

## 3. 今回やったこと（変更ファイルと理由）
### A. アイデアコンテスト機能（本セッションの主眼・設計ドラフト→正式反映→実装）
正本ドラフト＝`doc/設計ドラフト/アイデアコンテスト機能_設計.md`（全論点 A〜P/SEC 確定済）。
- **Step0 正式反映（docs）** `57e80340`/`02179d3f`:
  - 要件定義 `doc/要件定義/README.md`＝FR-46(コンテスト中核)/FR-47(会社レベル能力 user_capabilities＋アイデア→クエスト昇格・クエスト作成権限)/FR-48(セルフサインアップ＋公開/非公開モード)。※FR-45 が LLM連携で使用済のため +1 シフト。
  - データモデル `doc/データモデル.md`＝§5.60 contests / 5.61 contest_participants / 5.62 idea_participants / 5.63 user_capabilities / 5.64 contest_idea_flags ＋ companies.access_mode/self_signup_enabled ＋ quests.origin_idea_id ＋ §5.37 info_curators に統合注記。
  - API設計＝新ドメイン `doc/API設計/T_アイデアコンテスト.md`＋`doc/API設計/A_認証・セッション.md` §A.11（セルフサインアップ・SEC A〜J）＋README §1.6 外周ガード/索引。
  - 画面遷移図 `doc/画面設計/画面遷移図.md`＝SC-05(アカウント作成)/SC-53(コンテスト一覧)/SC-54(コンテスト詳細)。
  - テストパターン＝`doc/テスト/T_アイデアコンテスト.md`（T-TC-101〜201 先出し）＋`doc/テスト/A_認証.md`（A-TC-120〜127）。
- **Step1a 下地** `354df5a8`: migration `impl/backend/migrations/control/versions/0019_company_access_mode.py`（companies へ access_mode/self_signup_enabled）＋`migrations/company/versions/0050_contests.py`（5新表＋quests.origin_idea_id）。ORM＝`app/tenant/contests/orm.py`（Contest/ContestParticipant/IdeaParticipant/ContestIdeaFlag）・`app/tenant/capabilities/orm.py`（UserCapability＋CAPABILITIES）・Company/Quest に列追加。既存 ideas/votes/evaluations/chat は無改修（＝クエストを器に再利用）。
- **Step1b 能力＋ゲート** `6daaa74d`: `app/tenant/capabilities/`（repository/application/router/schemas）＝`/api/v1/admin/accounts/{uid}/capabilities` GET/POST/DELETE（管理者のみ）。`app/tenant/quests/application.py` の `create_quest` に `_can_create_quest`（管理者 OR quest_create 能力）ゲート追加＝`_is_company_admin`/`_can_create_quest` 新設。migration `0051_grant_quest_create.py`＝既存クエスト作成者へ自動付与（決定K）。seed＝`scripts/bootstrap.py` の `seed_quest_create_capabilities()`。テスト conftest に `factory.grant_capability` ＋ teardown で user_capabilities 掃除。
- **Step2a コンテスト CRUD＋backing quest** `4a271338`(backend)/`c756ddc3`(frontend): `app/tenant/contests/`（repository/application/router/schemas）＝`GET/POST/PATCH /contests`。作成で backing quest を 1:1 生成（contests.quest_id）・状態機械 draft→open→judging→closed→archived を backing quest.status にマップ。frontend＝`src/features/contests/`（api/types/ContestListView）＋`src/app/(app)/contests/page.tsx`（SC-53）＋`src/components/layout/AppNav.tsx` に「🏆 アイデアコンテスト」。
- **Step2b-1 参加2階層** `26f72f44`: contests repository に Tier1(contest_participants)/Tier2(idea_participants) の upsert/get/is_*/contest_by_quest。router＝`POST /contests/{id}/participation`・`PATCH /contests/{id}/participation/{uid}`（管理者）・`POST /ideas/{id}/participation`・`PATCH /ideas/{id}/participation/{uid}`（投稿者のみ）。
- **Step2b-2 単一ポリシー統合（本セッション・未コミット）**: 新モジュール `app/tenant/contests/access.py`（`contest_of`/`can_vote`/`can_chat`/`can_evaluate`）にコンテスト配下のアクセスポリシーを集約（設計 §2.3）。コアゲート4箇所に分岐を1つずつ上乗せ＝①可視: `quests/repository.py:can_access_quest` 先頭に遅延import分岐（contest 配下なら会社全体可視 True）＝**全 read gate 約30を一括カバー**／②投票: `ideas/application.py:_guard_votable`（Tier1 `is_contest_participant`）／③チャット: `chat/application.py:_require_comment`（引数 `idea` 追加＋Tier2 `is_idea_participant`・呼出 L177）／④評価: `evaluations/application.py:_is_evaluator`（`contest_evaluator` 能力のみ・owner/投稿者でも不可）。テスト＝`tests/contests/test_contest_access.py`（T-TC-112/113/120・red→green 証跡あり）。**docs**＝`doc/テスト/T_アイデアコンテスト.md` T-TC-113 行を実装名（access.py）に整合。

### B. FR-44 経営資料の仕上げ（コンテスト着手前・同一セッション）
- R.1b クエスト側から経営資料を適用 `759152f1`＝`app/tenant/quests/`（QuestCreate/Update に strategy_document_ids・`_apply_strategy_docs`）＋QuestDetail に strategy_documents＋SC-11 QuestForm に Multiselect。R-TC-122。
- SC-12 クエスト詳細「📐 経営資料とのマッチ度」パネル `4501b507`＝`GET /quests/{id}/strategy-match`（`quests/application.strategy_match`＋`strategy_repo.quest_match_by_doc`）＋`QuestDetailView`。R-TC-123。
- SC-81 ダイアログのレイアウト調整 `0da564a2`/`0407d34d`/`7a276f17`/`10a51c39`（余白・補助パネル下部移動・仕切り線・下書き全文表示）＝`features/strategy/components/StrategyFormPanel.tsx`＋`strategy.css`。

### C. FR-45 LLM の仕上げ（同一セッション・B より前）
- Phase2 in-app 生成 iso_generate の dev ライブ完走＋会社別 max_output_tokens＋worker ORM 登録バグ修正（`app/tenant/ai_jobs/application.py` で FK 先 ORM を side-effect import・migration 0049）。コミットは本ログの範囲外（f09112d6 等・既 push）。
- SC-04 ストリーミング進捗率＋WebSocket ライブ更新 `5d936662`＋ヘッダー🤖バッジの WS 購読修正 `e3e05d82`。

## 4. 現在の状態
- **動いている**: backend/frontend は再ビルド済で稼働。コンテスト Step2a/2b-1 の API は dev 反映済。SC-53（`/contests`・ナビ「🏆 アイデアコンテスト」）表示・作成可（管理者 or contest_create）。
- **テスト通過状況（確認済・2026-10-03 Step2b-2 後）**:
  - **全backend 927 passed**（Step2b-2 後にフル再実行・回帰ゼロ。2b-1 時点の 924 ＋新規3）。
  - `tests/contests` 10 passed＝従来7（T-TC-101/101b/102/103/105/110/111）＋**新規3（T-TC-112/113/120）**。
  - traceability `python3 scripts/check_tc_traceability.py`＝✅（code 951 件すべて md 記載）。
  - red→green 証跡: 4ゲート編集のみ `git stash` して新3本が red（投票=403/評価=404/可視=False）→ pop で green を確認。
- **未確認**: コンテスト画面（SC-53）の**ブラウザ目視は未実施**（ビルド green のみ）。Step2b-2 は backend ゲートのみ＝**フロントからの体感確認は SC-54 詳細（Step2b-3）実装後**が自然。
- **壊れているもの**: 既知なし。
- **dev スタックの非標準状態（重要）**: 通常 `llm-worker` を**停止**し、代わりに `iq-livefix-worker`（AI生成テスト用・`LLM_MODEL_SWALLOW=qwen2.5:0.5b`・source mount・`--name iq-livefix-worker`）が稼働中。`ollama` も起動中（qwen2.5:0.5b/qwen3:4b/bge-m3 pull 済）。AI生成を試さないなら復旧推奨（§7-末尾）。
- alembic heads: control=`0019_company_access_mode` / company=`0051_grant_quest_create`。

## 5. 詰まっている点（試して失敗 → 対処）
- **quest_create ゲートが既存クエスト作成テストを壊す懸念**→ 実際に影響するのは API 経由 `POST /api/v1/quests` の非管理者作成のみ（`tests/quests/test_catalog.py` の `_make_owner`）。対処＝`_make_owner` に `factory.grant_capability(acc["id"], "quest_create")`、bootstrap に seed ユーザ付与、migration 0051 で既存作成者自動付与。他の `client.post(".../quests/{qid}/...")` はサブリソースでゲート非該当。
- **conftest teardown の FK 違反**（user_capabilities が users 削除を阻害）→ teardown に user_capabilities(user_id/granted_by_id) 掃除を追加（`tests/conftest.py`）。
- **（過去）worker が全 AIジョブを NoReferencedTableError で落とす**→ `ai_jobs/application.py` で FK 先 ORM を side-effect import（解決済・S-TC-132）。
- **（過去）本番既定モデル qwen3-swallow は Ollama で pull 不可**（hf.co realm 不一致・GGUF 無）→ dev は qwen2.5:0.5b を override（§8）。
- ~~**2b-2（単一ポリシーのコアゲート統合）は未着手**~~→ **完了（本セッション・§3A Step2b-2）**。可視分岐は `can_access_quest` 中央集約（ユーザー承認の方針）＝最もDRY。**アイデア投稿（create_idea）の Tier1 開放は本ステップのスコープ外**（先出しTC無し・投稿フローと一緒に後続で：現状コンテスト配下でも投稿は従来 member+idea_create 権限ゲートのまま＝非メンバーは 403・回帰ではなく未開放）。

## 6. 決定事項と根拠（採用しなかった案も）
- **クエストを器に再利用（B案）**＝contests.quest_id が backing quest を 1:1 で指す。ideas/votes/evaluations/chat は無改修共有。A案（ideas.quest_id を nullable 化）はアクセス制御総取替で影響大のため不採用。
- **FR 採番 46/47/48**＝FR-45 が LLM連携で使用済のため、ドラフトの暫定 45/46/47 を +1。
- **SC 採番 05/53/54**＝ドラフトの SC-50/51 は情報インプットで使用済のため採り直し。
- **user_capabilities＝②会社レベル能力の単一レジストリ**＝info_curator/quest_create/contest_create/contest_evaluator を1表に集約。**info_curators の統合（データ移行＋ドメインN参照差し替え）は未実施＝別ステップに保留**（情報インプット稼働部に触るため慎重に）。
- **公開性は会社単位 `companies.access_mode`** に一本化（旧 contests.visibility は廃止）。
- **評価は運営指名の審査員（contest_evaluator）のみ**（投稿者指名案は偏り防止で不採用）。
- **投票=Tier1 全参加者 / チャット=Tier2 投稿者承認**（案X＝賛成票バイアス回避＋心理的安全性）。
- **quest_create 移行＝既存作成者に自動付与で維持**（決定K・管理者は常時可）。
- コミット/push は main 直（本プロジェクトの慣習・ユーザー指示で都度 commit&push）。

## 7. 次にやること（優先順・ファイル/関数レベル）
0. **（済）Step2b-2 単一ポリシー統合** → §3A・§5 参照（access.py＋4ゲート分岐・全927 green・未コミットなら commit/push）。
   - **残フォロー（任意・投稿フローと一緒に）**: コンテスト配下での **Tier1 アイデア投稿開放**。現状 `ideas/application.py:create_idea`（L260 付近）はコンテスト配下でも従来 `can_access_quest`→member+`idea_create` ゲートのまま＝Tier1 参加者（非クエストメンバー）は 403。設計 §5.1 の「Tier1=閲覧＋自分のアイデア投稿」を満たすには create_idea にもコンテスト分岐（Tier1 参加者なら投稿可）が要る。先出しTC無し＝新規採番（例 T-TC-115）して追加。
1. **Step2b-3 SC-54 コンテスト詳細（frontend）**＝`src/features/contests/components/ContestDetailView.tsx`＋`src/app/(app)/contests/[contestId]/page.tsx`。SC-12 クエスト詳細を流用＝アイデア一覧タブ（応募中/入賞/殿堂入り/お蔵入り＝`contest_idea_flags`＋is_selected 導出）＋Tier1/Tier2 参加導線。codegen 要（`npm run codegen`・backend 起動中）。
3. **Step2c 表彰**＝`POST /contests/{id}/finalize`（T.1・Idempotency・上位N へ ledger.grant 冪等 reason='contest_award'＋入賞実績＋is_selected＋通知）＋`GET /contests/{id}/ranking`（T.3）。TC＝T-TC-120/130/131/132。
4. **Step3 公開/非公開モード**＝access_mode 外周ガード（README §1.6・A §A.11.1＝public×general はコンテスト系以外 403）＋`GET /public/bootstrap`。TC＝T-TC-150/151/201＋T-TC-114（public 自動承認）。
5. **Step4 セルフサインアップ（FR-48・SEC 重）**＝SC-05＋`POST /public/signup`・`/public/signup/verify`。A-TC-120〜127。
6. **保留タスク**＝info_curators → user_capabilities のデータ移行＋ドメインN参照差し替え（慎重に・別ステップ）。
7. **dev 復旧（AI生成テスト不要なら）**＝`docker rm -f iq-livefix-worker`／`docker compose stop ollama`／`docker compose up -d llm-worker`（通常 worker は qwen3-swallow 想定＝Ollama未pullなので AIジョブは失敗する点に注意。生成を回すなら override を使う）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2/impl`（compose は `compose.yaml`）。
- 起動: `docker compose up -d`（既起動中）。コード反映は `docker compose up -d --build backend`／`... frontend`（backend/frontend はイメージにベイク）。
- ポート: frontend 3000・backend 8000・db(postgres) 5432（DB ユーザ `ideaquest`・`psql -U ideaquest`）・ollama 11434・mailhog 8025・minio 9000。
- テスト（会社DB 要・source mount で未コミット反映）: `docker compose run --rm -T -v "$PWD/backend:/app" backend pytest <path> -q`。エントリポイントが bootstrap（migration 適用＋seed）を実行してから pytest。
- マイグレーション適用: `docker compose run --rm -T -v "$PWD/backend:/app" --entrypoint python backend scripts/bootstrap.py`（control+全会社DBへ alembic upgrade head）。
- OpenAPI 型再生成（frontend）: backend を :8000 で起動後 `cd frontend && npm run codegen`（→ `src/lib/api/schema.d.ts`）。
- traceability ゲート: `python3 scripts/check_tc_traceability.py`（リポジトリルート）。
- frontend 検証: `cd impl/frontend && npx tsc --noEmit`（型）／`npm run build`（Next lint 含む・内部遷移は `<Link>`）。
- dev ログイン（PW 全て `Passw0rd!`）: 会社コード `ACME-01`／一般 `user@acme.example`（quest_create 付与済）・会社管理者 `kanri@acme.example`（company_account_admin＝コンテスト作成・能力付与可）／system_admin は会社 `OPS`／`admin@ops.example`。
- 必読の正本: `CLAUDE.md`（規約）／`doc/設計ドラフト/アイデアコンテスト機能_設計.md`（コンテスト全論点）／`doc/API設計/T_アイデアコンテスト.md`・`A_認証・セッション.md §A.11`／`doc/テスト/T_アイデアコンテスト.md`・`A_認証.md`／`impl/README.md`（実装現況）。
