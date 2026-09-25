# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-25 JST**
- ブランチ: **main**（本 handoff の docs コミット＝tip・**push は未実施**。それ以外の作業ツリーは clean）。
- **本セッションは FR-42 を「設計フェーズ → backend 完全実装（P.1〜P.6）」まで一気に進めた**（`impl/` に大量の実装＋テスト）。
- 最新コミット（新→古／tip は本 handoff 更新コミット）:
  - `docs(handoff)` セッション終了・handoff 全文更新（本コミット）
  - `23c3b6c` feat(concept): 議論チャット P.6（スコープ/メッセージ/既読・E機構共有・P-TC-501〜506）
  - `cd86595` feat(concept): 評価 P.5＋投票+XP P.5b（P-TC-401〜410/451〜455）
  - `4250924` feat(concept): 前提=検証プール P.3＋前提リンク P.4＋反証波及（P-TC-201〜207/301〜304）
  - `a20eddc` feat(concept): application/router層 P.1/P.2（P-TC-101〜112）
  - `f9e957c` feat(concept): repository層＋int P-TC-001〜015
  - `1ae6bea` feat(concept): migration 0033（9テーブル＋チャット一般化）
  - `445a844` docs(concept): テスト設計 P-TC 起票（doc/テスト/P_コンセプト.md）
  - `d4858ba` docs(concept): SC-12コンセプトタブ＋SC-62＋画面遷移図
  - `caed395` docs(concept): 画面設計 SC-61/60＋横断ガイダンス標準§4.13（.screen-purpose）
- コミット方針: ユーザーが「コミット/プッシュして」と言うまで実行しない。**1スライス=1コミット**。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..P・画面 SC-xx）。実装は `impl/`。

## 3. 今回やったこと＝**FR-42「コンセプト創造・検証（ISO56002 ②③段）」を設計→backend 完全実装まで**

### 3-1. 画面設計（docs）
- **SC-61 コンセプト詳細（フルページ）** `doc/画面設計/screens/SC-61_コンセプト詳細.md`＝SC-22 と対称（ヘッダー→関連情報パネル[全幅独立]→メイン[スキーマA/B/Cグループ＋各末尾💬グループ議論／⑥前提と検証=核心]＋右レール[投票→評価結果→総合判定[最下部]]→下部=総合チャット[SC-22§4.4同型アクティビティグラフ]）。
- **SC-60 登録・編集モーダル** `SC-60_コンセプト登録編集.md`（由来アイデア選択＋スキーマ入力）／**SC-62 評価モーダル** `SC-62_コンセプト評価.md`（中核5＋補助3＋Go/Pivot/Kill推奨）。
- **SC-12 に「🧩 コンセプト」タブ**追記（§4.6・一覧＋検証プール＋作成導線）／**画面遷移図**に SC-60/61/62 反映。
- **横断ガイダンス標準 §4.13 新設**（`doc/画面設計/デザイン標準.md`）＝**`.screen-purpose`**＝ⓘ＋短ラベル→ホバー/フォーカスで**フローティング展開（絶対配置＝隣を押し出さない・地続き1ピル）**→収まらなければ流れる（マーキー・折返さず端クランプ）→クリックで全文ダイアログ。reduce-motion 静止（§4.9）・フォーカスは枠線を青（outline不可）。**ヘッダー固定でなく説明が要る要素の傍**に配置。**見本＝`doc/画面設計/mocks/style-guide.html`「4d」（ユーザーとデザイン確定済）**。SC-61/60/62 に適用（コンセプトとは？/viability/前提と検証/評価観点/各観点）。

### 3-2. テスト設計（md-first）
- `doc/テスト/P_コンセプト.md`（接頭辞 **P-TC**・`根拠` 列付き）＝§1 repository〜§9 画面e2e。

### 3-3. backend 実装（**P.1〜P.6 完了・全層 red→green**）＝`impl/backend/app/tenant/concepts/`
- **migration 0033**（`migrations/company/versions/0033_concepts.py`）＝9テーブル（concepts/concept_source_ideas/assumptions/assumption_validations/concept_assumption_links/concept_evaluations/concept_evaluation_scores/concept_chat_scopes/concept_votes）＋**チャット一般化**（chat_messages/chat_reads に `concept_chat_scope_id` 追加＋`chat_group_id` NULL可＋`num_nonnulls(...)=1` CHECK）。**ACME DB 適用確認済**。
- **orm.py/repository.py**＝9モデル＋永続化プリミティブ（純関数・commitしない）。current_verdict＝最新実施日の検証イベントから再導出。
- **application.py/router.py/schemas.py**＝門番（`quests_repo.can_access_quest`）・draft本人可視・完了凍結(409)・UoW。
  - **P.1/P.2**＝一覧/詳細合成/作成(既定draft＋総合ルーム自動生成)/編集/activate/archive/select/decision。
  - **P.3/P.4**＝前提の一覧/作成/詳細/編集/削除(リンク中409)/検証イベント追記/履歴＋リンク(重要度・前提スレッド自動生成)/stale変更/解除。**反証波及**＝verdict=refuted で `mark_links_stale_for_assumption`→リンク先全 is_stale=true。
  - **P.5/P.5b**＝評価(GET me/集計・PUT upsert・submittedは中核5＋総評＋推奨検証・limited可視性)＋投票(POST/DELETE・XP+5各コンセプト初回のみ・G台帳 reason=concept_vote)。
  - **P.6**＝チャット（スコープ一覧+未読・グループ作成・メッセージ取得/投稿・既読）＝**E機構共有**（chat_messages/chat_reads を concept_chat_scope_id で流用・chat ORM を §5.45 に整合）。
- **router 登録**＝`app/main.py` に `concepts_router`。
- **テスト**＝`tests/concepts/`（test_repository.py=P-TC-001〜015／test_api.py=101〜112／test_assumptions.py=201〜207・301〜304／test_evaluation.py=401〜410・451〜455／test_chat.py=501〜506）＝**concepts 58件 passed・E chat 29件 回帰なし（計87 passed）**。

## 4. 現在の状態（本セッションで確認）
- **backend＝FR-42 P.1〜P.6 実装済・稼働中**（`docker compose up -d --build backend` 実施済＝新EP稼働・**exited でなく起動中**）。DB は migration 0033 適用済。
- **テスト**＝`tests/concepts/` 58件 passed＋`tests/chat/` 29件 passed。**TCトレーサビリティ 813件 ✅**（`python3 scripts/check_tc_traceability.py`）。
- **frontend＝未着手**（FR-42 の画面は未実装＝次フェーズ）。`.screen-purpose` は style-guide.html のみ（production 未移植）。
- **壊れているもの**＝無し。**未確認**＝frontend build／e2e（frontend 未着手のため今回は不要）。

## 5. 詰まっている点 / 試して失敗したこと（＝次回同じ轍を踏まない）
- **Idempotency-Key はグローバル・ミドルウェアが担う**（API設計 §1.9）＝アプリ層の冪等チェック（`post_message` の message_id 再送）は belt-and-suspenders。**red 実演でアプリ側を潰しても P-TC-503 は緑のまま**だった（ミドルウェアが短絡）＝アプリ側の冪等は「二重の保険」と理解。
- **red→green の実演法**（実装先行になった時）＝該当ロジックを一時的に `if ... and False:` 等で潰し、対象TCが red になるのを目視→復旧して green。証跡はコミットメッセージに記録（本セッション各 feat コミット参照）。
- **chat ORM は migration に手動整合が要る**＝0033 で列追加しても `chat/orm.py` の ChatMessage/ChatRead は自動更新されない。`concept_chat_scope_id` 追加＋`chat_group_id` を NULL 可に手当てして初めて concept メッセージを挿入できる。
- **teardown の FK 順**＝`chat_reads.last_read_message_id`→`chat_messages` を参照するので、**ChatRead を先に削除**してから ChatMessage（逆順で ForeignKeyViolation）。
- **pytest は cwd=impl・source マウント必須**＝`docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/concepts -q`（backend はソースをベイクするため未コミット反映に `-v` が要る）。**前に `docker compose stop worker mail-worker`**（*_outbox 競合回避）→後で start。

## 6. 決定事項と根拠（設計＋実装）
- **スコープ境界**＝クエスト=ISO①②③で1サイクル／④⑤はクエスト外＝PM/WBS／コンセプト=クエスト内・横断は「収束クエスト」（`doc/設計ドラフト/コンセプト機能_ISO56002_再設計.md` §1.1）。
- **viability=jsonb**／`decision`(go/pivot/kill)と`is_selected`は別列／評価観点=中核5＋補助3（ISO §8.3.3 b）／投票=賛成・反対＋XP+5（reason=`concept_vote`・ref_type=`concepts`・各コンセプト初回のみ・日次上限・exists_ref 冪等）。
- **チャット一般化＝最小侵襲**（chat_messages/chat_reads に concept_chat_scope_id・reactions/mentions/quotes/attachments は E 無改修で共有）。
- **ガイダンス標準 §4.13（.screen-purpose）**＝フローティング展開（隣を押し出さない）・端クランプ・reduce-motion 静止・クリックで全文（ユーザーとデザイン確定済）。
- **repository は純関数・commitしない**（application が UoW 境界）＝既存 evaluations/ideas と同型。
- **評価 limited 可視性**＝範囲外（非manager/非author/非当該評価者）に完全非表示・分母除外。集計に **stale**（リンク前提の反証で要再評価＝SC-62 バナー源）。
- **反証波及の通知（H）は未結線**＝stale マーキングは実装済み・作成者/評価者への通知は follow-up（`application.add_validation` にコメント）。

## 7. 次にやること（優先順・具体的に）
1. **frontend（FR-42 画面）＝モック先行→接続**（フロントエンド実装フロー規約）。
   - **`npm run codegen`**（`cd impl/frontend`）で新 API 型（P ドメイン）を `src/lib/api/schema.d.ts` に反映。
   - **ガイダンス `.screen-purpose` を production 実装**＝style-guide.html「4d」を `design-system.css` へ移植（JS 挙動＝溢れ時マーキー/端クランプ/フォーカス青枠/reduce-motion）。
   - **SC-61 詳細→SC-60 登録編集→SC-62 評価→SC-12 コンセプトタブ** の順で feature 実装（`impl/frontend/src/features/concepts/` を新設想定）。各画面でユーザー動作確認の受入ゲート（メモリ `backend-connection-per-screen-loop`）。
2. **反証波及の通知結線**（H・`assumption_refuted` 相当＝作成者＋評価者へ要再評価・`application.add_validation`）。
3. **付随＝関連リンク対象ピッカーへ concepts/assumptions 追加**（backend `impl/backend/app/tenant/info/repository.py::search_link_candidates` が現状 concepts/assumptions で候補ゼロ＝ドラフト §4 ⚠・API P.10）。related_info の合成（`GET /concepts|assumptions/{id}` の `related_info[]`＝現状 `[]`）も同時に結線。
4. **ER 図（データモデル mermaid）へコンセプト9テーブル反映**（テーブル定義が正・図は追随・未着手）。
5. **議論アクティビティ集計 API**（SC-61 §4.8）＝アイデア `activity` 相当を P に追加するか（現状未定義・SC-61 §9 TBD）。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。remote=`origin`（GitHub `t-umekawa-sc/sc-ideaquest-G2`）。compose=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker は **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。**frontend/backend はソースをベイク（volumes 無）**＝コード反映は **`docker compose up -d --build frontend`**（または backend）。**migration/`_SEEDS` 追加後は `--build backend`**（entrypoint が bootstrap＝DB作成/migrate/seed を毎起動・冪等）。**worker/mail-worker は `profiles: ["workers"]`**＝`docker compose up -d worker mail-worker`。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/concepts -q`（`-v` で未コミット反映）。**pytest 前に `docker compose stop worker mail-worker`**→終わったら start。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート＝Next lint 含む）。**backend の API 型を変えたら `npm run codegen`**（openapi→`src/lib/api/schema.d.ts`）＝**FR-42 で P ドメイン EP が増えたので frontend 着手時に必ず codegen**。
- **e2e（Playwright）**: `cd /home/t-umekawa/sc-ideaquest-G2/impl/frontend` から `npx playwright test e2e/<spec> --workers=1`（フルスタック起動＋frontend `--build` 前提）。認証は storageState 方式。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（現在 813件・TC-ID＝`[A-Z]-TC-\d{3}`・コンセプト接頭辞=**P-TC**）。**TC はコードより先に `doc/テスト/P_コンセプト.md` に行追加**。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=`/healthz`）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **ログイン**: `user@acme.example`/`ACME-01`/`Passw0rd!`＝一般。`kanri@acme.example`＝company_account_admin。`admin@ops.example`/`OPS`＝system_admin。状態変更 API は `iq_csrf` Cookie を `X-CSRF-Token` に載せる。
- **DB 名（罠）**: control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`。ユーザー/パス=ideaquest。
- **設計正本/メモリ**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へ。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`（FR-42 の全経緯＝メモリ `fr42-concept-stage`）。API 正本＝`doc/API設計/P_コンセプト.md`。

---
### 自己チェック（本ファイルだけで再開できるか）
- FR-42 の到達点（設計 SC-61/60/62/SC-12タブ/遷移図/デザイン標準§4.13 → テスト設計 P-TC → **backend P.1〜P.6 全実装・87 passed**）と**次＝frontend（codegen→.screen-purpose→SC-61/60/62/SC-12接続）**をファイル/関数レベルで記載。
- 主要な設計＋実装判断（スコープ境界／viability=jsonb／評価中核5+補助3／投票 concept_vote XP／チャット E 共有／ガイダンス §4.13／repository 純関数／limited 可視性／反証波及 stale・通知未結線）を §6 に根拠付きで記録。
- 実装現況＝backend 稼働中・migration 適用済・concepts 58＋E 29 passed・TC 813✅・frontend 未着手 を §4 に明記。
- 失敗/教訓（Idempotency はミドルウェア／red-green 実演法／chat ORM 手動整合／teardown FK 順／pytest cwd・mount・workers停止）を §5 に記録＝再発防止。
