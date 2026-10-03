# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう全文上書きで維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-03 JST
- ブランチ: `main`（作業は main 直 push が本プロジェクトの慣習）
- 最新コミット: `64c7be88 feat(contest): パーティに運営がメンバーを直接追加（会社ユーザーピッカー）`（commit＋origin/main へ push 済）
- working tree: clean（全コミット済・push 済）。※`doc/セキュリティ検証/DAST_ZAP検証手順.md` は別セッションで作業中（本セッション対象外・ユーザー確認済）。
- alembic heads: control=`0019_company_access_mode` / company=`0053_contest_auto_approve`。
- **SC-54 受入ポリッシュ第2弾（本セッション・全 push 済）**: 4パネル（概要/コンテスト内アクティビティ/新着の議論/活発さ・`355a278d`）＋新着の議論を本人参加アイデアに限定（my_participating_idea_ids・T-TC-117）／チェックボックス標準化（.checkbox）／「パーティー→パーティ」UI全面統一（`fd10fd5d`・35ファイル）／**上位タブ 💡アイデア・🔍全文検索・👥パーティ**（`5ea2ce51`・パーティは運営のみ=can_manage・`GET /contests/{id}/participants`・T-TC-118）。全backend 936 passed・traceability ✅（960件）。
- **SC-53/54 受入ポリッシュ（本セッション後半・全 push 済）**: ①一覧を SC-10 UI に統一（DataTable＋RowMenu 詳細/編集/複製/削除）＋ステータスをセグメントスイッチに（`26acf5f0`）＋`DELETE /contests/{id}`（T-TC-106）／②作成/編集に会期入力（開始日/締切・自動お蔵入り日数）＋詳細に会期ステータス遷移（`34949470`）／③**ステータス隣接後退可**＋詳細の遷移UIをクエスト詳細の ⋯ RowMenu（進める/戻す/削除）に統一（`f7345c52`・T-TC-107）／④`.page-title` をビジネス体に是正＝ピクセル体はゲーム要素専用（`893019a2`・全業務画面26箇所に波及）。全backend 933 passed・traceability ✅（957件）。
- **（解決済）参加ポリシー**: 会社単位ではなく**コンテスト単位 `contests.auto_approve`** で選べるようにした（`66c456e1`・作成/編集モーダルのトグル・T-TC-116）。public/DEMO は常に自動承認（決定G）。
- **（解決済）SC-54 パネル/タブ化＋パーティ管理**: 4パネル＋上位タブ（アイデア/全文検索=クエスト詳細と同一UI/パーティ=運営のみ）。パーティは主催者表示・審査員トグル（contest_evaluator）・排除（rejected 論理削除）まで実装。「パーティー→パーティ」UI統一済み。
- **（解決済）パーティ直接追加**: 運営が会社ユーザーを直接追加＝`GET /contests/{id}/participant-candidates?q=`（会社全体候補・主催者/既参加除外・運営のみ＝`list_cross_group_candidates([])` 流用）＋パーティタブの検索ピッカー（`64c7be88`・T-TC-124）。追加は PATCH participation approved 再利用。これで SC-54 パーティは主催者/審査員/排除/追加までクエスト詳細同等。

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
- **Step2b-2 単一ポリシー統合** `5fd88ead`: 新モジュール `app/tenant/contests/access.py`（`contest_of`/`can_vote`/`can_chat`/`can_evaluate`）にコンテスト配下のアクセスポリシーを集約（設計 §2.3）。コアゲート4箇所に分岐を1つずつ上乗せ＝①可視: `quests/repository.py:can_access_quest` 先頭に遅延import分岐（contest 配下なら会社全体可視 True）＝**全 read gate 約30を一括カバー**／②投票: `ideas/application.py:_guard_votable`（Tier1 `is_contest_participant`）／③チャット: `chat/application.py:_require_comment`（引数 `idea` 追加＋Tier2 `is_idea_participant`・呼出 L177）／④評価: `evaluations/application.py:_is_evaluator`（`contest_evaluator` 能力のみ・owner/投稿者でも不可）。テスト＝`tests/contests/test_contest_access.py`（T-TC-112/113/120・red→green 証跡あり）。**docs**＝`doc/テスト/T_アイデアコンテスト.md` T-TC-113 行を実装名（access.py）に整合。
- **Step2b-2b Tier1 アイデア投稿開放** `ae2b135f`: `access.py` に `can_post_idea`（Tier1）追加。`ideas/application.py:create_idea` の作成権限ゲートにコンテスト分岐＝contest 配下なら Tier1 参加者に投稿を開放（member/`idea_create` 権限を置換・§5.1「自分のアイデア投稿」）。通常クエストは従来の `idea_create` ゲート据え置き。TC＝T-TC-115（md 追記＋テスト・red→green 証跡あり）。
- **Step2c 表彰・ランキング・恒久フラグ（本セッション・未コミット）**: ①`GET /contests/{id}/ranking?axis=`（T.3・T-TC-130）＝`repo.rank_approve_votes`/`rank_avg_score`/`rank_contribution`（votes/evaluation_scores/activities を backing quest×[starts_at,ends_at) で直接集計・新テーブル不要）。②`POST /contests/{id}/finalize`（T.1・T-TC-131・冪等）＝judging→closed・各軸上位N の XP/コインをユーザー単位で軸横断合算し1回ずつ付与（reason='contest_award'・`grant_exists_by_ref` 冪等）・入賞バッジ（順位→tier＝`contest_award_{tier}`）・成果軸1位は `hall_of_fame`・`is_selected=true`・通知。③`contest_app.auto_shelve_expired`（T-TC-132・rolling の期限超過に `shelved` 冪等付与・スケジューラ後追いの明示トリガ）。新規＝`contests/repository.py`（rank_*/flag CRUD）・`application.py`（ranking/finalize/auto_shelve）・schemas（Ranking/Finalize）・router（ranking GET/finalize POST）・migration `0052_contest_achievements.py`（入賞バッジ gold/silver/bronze・condition=manual・coin_reward=0＝報酬は prize_config 側）・`achievements/repository.get_by_code`。**副作用**＝実績カタログが12→15（`tests/achievements/test_api.py:test_g_tc_501` の件数を15に更新）。TC＝T-TC-130/131/132（red→green 証跡あり）。
- **Step2b-3 SC-54 コンテスト詳細（frontend・本セッション・未コミット）**: `src/features/contests/components/ContestDetailView.tsx`＋`src/app/(app)/contests/[contestId]/page.tsx`。SC-12 流用＝ヘッダー（会期/テーマ/賞/応募数）＋表彰台（ランキング3軸 top3・`GET /contests/{id}/ranking?axis=`）＋アイデア一覧タブ（応募中/入賞/殿堂入り/お蔵入り＝`contest_idea_flags`＋`is_selected` から導出）＋Tier1「参加する」（`POST /participation`）＋管理者「🏆 表彰を確定」（judging 時のみ・`POST /finalize`＋確認ダイアログ）。api.ts に getContestRanking/requestContestParticipation/finalizeContest 追加・types に軸/タブ定義・contests.css に詳細スタイル。**backend 追記**＝`GET /contests/{id}` 詳細に `flags`（殿堂入り/お蔵入り）を露出（タブ導出用）＋コンテスト用スキーマを `Contest` 接頭辞にリネーム（`ContestRankingResponse`/`ContestRankingEntry`/`ContestFinalizeResponse`）＝既存 gamification `RankingResponse` との**命名衝突回避**（衝突すると FastAPI がモジュール修飾名にして既存 ranking 型参照まで壊れる）。codegen 済（`schema.d.ts`）。**目視検証済**＝seed（アイデア2件＋賛成票）で /contests/{id} をスクショ＝ヘッダー/表彰台（3票/1票）/タブ件数/アイデアカードが backend 値と一致。`npm run build` green・全backend 931 passed・traceability ✅（955件）。
- **Step2b-3b SC-53/54 UI 刷新＋コンテスト削除（本セッション・受入フィードバック反映・未コミット）**: ①SC-53 一覧を**クエスト一覧（SC-10）UIに統一**＝backlink＋page-head＋`DataTable`（検索/並び替え/絞り込み/列設定/エクスポート/標準・コンパクト・カード・リスト）＋**行アクション `RowMenu`（詳細を開く→編集→複製→削除〔danger 赤〕＝デザイン標準 §4.5 の統一順/色）**。会期ステータス切替は**セグメントスイッチ `.segmented`**（SC-12 アイデア一覧流用・件数付き）。SC-54 のアイデアタブも同 `.segmented` に統一。②作成/編集/複製モーダル＝入力系フッター（キャンセル＋**主ボタン `btn-primary`**・§4.10）＋説明欄追加。主 CTA（＋作成・参加する）も `btn-primary` 化。③**backend 追加＝`DELETE /contests/{id}`**（論理削除＝contest＋backing quest・`contest_create`/管理者・子データ監査保持）＝`contests/application.delete_contest`＋router。api.ts に `deleteContest`。TC＝T-TC-106（md 追記＋test・削除 204/一般403/論理削除確認）。**目視検証済**＝RowMenu（詳細/編集/複製/削除赤）・一覧DataTable・作成モーダル主ボタン青 をスクショ確認。`npm run build` green・全backend 932 passed・traceability ✅（956件）。

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
  - **全backend 931 passed**（Step2c 後にフル再実行・回帰ゼロ。新規3＝T-TC-130/131/132＋g_tc_501 件数更新）。
  - `tests/contests` 11 passed＝従来7（T-TC-101/101b/102/103/105/110/111）＋**新規4（T-TC-112/113/115/120）**。
  - traceability `python3 scripts/check_tc_traceability.py`＝✅（code 955 件すべて md 記載）。
  - red→green 証跡: 4ゲート編集のみ `git stash` して新3本が red（投票=403/評価=404/可視=False）→ pop で green を確認。
- **未確認**: コンテスト画面（SC-53）の**ブラウザ目視は未実施**（ビルド green のみ）。Step2b-2 は backend ゲートのみ＝**フロントからの体感確認は SC-54 詳細（Step2b-3）実装後**が自然。
- **壊れているもの**: 既知なし。
- **dev スタックの非標準状態（重要）**: 通常 `llm-worker` を**停止**し、代わりに `iq-livefix-worker`（AI生成テスト用・`LLM_MODEL_SWALLOW=qwen2.5:0.5b`・source mount・`--name iq-livefix-worker`）が稼働中。`ollama` も起動中（qwen2.5:0.5b/qwen3:4b/bge-m3 pull 済）。AI生成を試さないなら復旧推奨（§7-末尾）。
- alembic heads: control=`0019_company_access_mode` / company=`0052_contest_achievements`。

## 5. 詰まっている点（試して失敗 → 対処）
- **quest_create ゲートが既存クエスト作成テストを壊す懸念**→ 実際に影響するのは API 経由 `POST /api/v1/quests` の非管理者作成のみ（`tests/quests/test_catalog.py` の `_make_owner`）。対処＝`_make_owner` に `factory.grant_capability(acc["id"], "quest_create")`、bootstrap に seed ユーザ付与、migration 0051 で既存作成者自動付与。他の `client.post(".../quests/{qid}/...")` はサブリソースでゲート非該当。
- **conftest teardown の FK 違反**（user_capabilities が users 削除を阻害）→ teardown に user_capabilities(user_id/granted_by_id) 掃除を追加（`tests/conftest.py`）。
- **（過去）worker が全 AIジョブを NoReferencedTableError で落とす**→ `ai_jobs/application.py` で FK 先 ORM を side-effect import（解決済・S-TC-132）。
- **（過去）本番既定モデル qwen3-swallow は Ollama で pull 不可**（hf.co realm 不一致・GGUF 無）→ dev は qwen2.5:0.5b を override（§8）。
- ~~**2b-2（単一ポリシーのコアゲート統合）は未着手**~~→ **完了（本セッション・§3A Step2b-2/2b-2b）**。可視分岐は `can_access_quest` 中央集約（ユーザー承認の方針）＝最もDRY。**アイデア投稿（create_idea）の Tier1 開放も対応済**（§3A Step2b-2b・T-TC-115）。

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
0. **（済）Step2b-2/2b-2b/2c/2b-3** → §3A 参照（単一ポリシー5ゲート・Tier1投稿・表彰/ランキング/フラグ backend・SC-54 frontend）。全 931 green・SC-54 目視検証済。
1. **Step2b-3 残フォロー（任意・SC-54 の作り込み）**＝①Tier2 チャット参加導線（アイデア詳細 SC-22 側にリクエスト/承認 UI）／②参加状態・権限に応じた CTA 出し分け（現状は「参加する」常時表示＋backend 403→snackbar）／③ランキング軸の会期日付が未設定（starts_at/ends_at=null）だと全期間集計になる点の UI 明示／④SC-54 の正式モック（`doc/画面設計/mocks`）と screens/SC-54 md の起票（現状は遷移図のみが仕様源）。
2. **Step3 公開/非公開モード**＝access_mode 外周ガード（README §1.6・A §A.11.1＝public×general はコンテスト系以外 403）＋`GET /public/bootstrap`。TC＝T-TC-150/151/201＋T-TC-114（public 自動承認）。
3. **Step4 セルフサインアップ（FR-48・SEC 重）**＝SC-05＋`POST /public/signup`・`/public/signup/verify`。A-TC-120〜127。
4. **Step5 アイデア→クエスト昇格（FR-47・T.5）**＝`POST /ideas/{id}/promote-to-quest`（要 quest_create・内容コピー＋origin_idea_id）。T-TC-140。
5. **保留タスク**＝info_curators → user_capabilities のデータ移行＋ドメインN参照差し替え（慎重に・別ステップ）。
6. **dev 復旧（AI生成テスト不要なら）**＝`docker rm -f iq-livefix-worker`／`docker compose stop ollama`／`docker compose up -d llm-worker`（通常 worker は qwen3-swallow 想定＝Ollama未pullなので AIジョブは失敗する点に注意。生成を回すなら override を使う）。

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
