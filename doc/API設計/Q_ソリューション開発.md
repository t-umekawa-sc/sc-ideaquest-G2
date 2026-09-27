# ドメイン Q. ソリューション開発（プロジェクト／タスク管理・テナントプレーン）＝設計ドラフト（2026-09-27）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可〔クエスト内6権限〕・§1.8 一覧・§1.9 冪等・§1.12 リアルタイム）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)、クエスト/パーティー/権限・状態機械/凍結は [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)、チャットは [`E_チャット・リアクション・魔法発動.md`](./E_チャット・リアクション・魔法発動.md)、ゲーミフィケーション（XP/コイン付与）は [`G_ゲーミフィケーション.md`](./G_ゲーミフィケーション.md)、通知は [`H_通知.md`](./H_通知.md)、コンセプトは [`P_コンセプト.md`](./P_コンセプト.md)。

対象＝**ISO 56001 ④ソリューションの開発＋⑤導入（価値の実現）**（原本 §8.3.5）を担う新ドメイン。コンセプト段（②③・FR-42）の**出口**＝`decision='go'` のコンセプトを入力に、**クエスト外の別パラダイム（探索/合議でなく「実行・デリバリ管理」）**でプロジェクト／タスクを回す。要件＝**FR-43**（[要件定義 README](../要件定義/README.md)）／正本＝[ソリューション開発機能 設計ドラフト](../設計ドラフト/ソリューション開発機能_設計.md)。データモデル §5.49〜5.51・`users.delivery_xp`・`activities(kind=delivery_xp_gain)`・`chat_thread(owner_type='task')`。すべて**テナントAPI**（会社DB）。テスト接頭辞＝**Q-TC**。

**設計方針（DRY・[コーディング規約](../規約/コーディング規約.md) §2.3）**＝ゲーム機構（XP/コイン＝G）・チャット中核（thread＝E/§5.14b）・一覧サーバー委譲（§1.8.1）・権限（クエストパーティー＝C）を**再利用**。**継承しない**＝コンセプト/アイデア段の議論ルーム群・投票・評価者評価・Go/Pivot/Kill ゲート（実行段には持ち込まない）。

**この分割レビューで確定（2026-09-27）**:
- **ドメインレター＝Q**（P の次・テスト接頭辞 Q-TC）。
- **起票ゲート＝`concepts.decision='go'`**・**1コンセプト=1プロジェクト**（`projects.concept_id` UNIQUE）。
- **権限＝由来クエストのパーティー権限（FR-27）を継承**（`projects.quest_id` 冗長保持で `can_access_quest` を流用・担当割当は当該パーティー所属者のみ）。
- **タスク＝単一 `tasks` 自己参照ツリー＋`kind`**（任意深さ・案A）。
- **完了報酬は G へ委譲**（`status→done` で `delivery_xp`＋コインを冪等付与）。
- **タスクチャットは既存チャットEP を thread 単位で流用**（`chat_thread(owner_type='task')`・E/中核は無改修・門番 `_resolve_host` に task 分岐のみ）。
- **MVP=起票+タスクCRUD/ツリー+報酬+チャット+導入メタ**／CSV取込・依存関係・工数見積・外部PM双方向は **Phase2**。

## Q.0 アクター・認可スコープ（門番＝二層メンバーシップ＝クエストパーティー OR 開発メンバー）

**二層メンバーシップ（開発担当≠イノベーション担当・FR-43 §2・2026-09-27 確定）**:
- **イノベーション担当**＝由来クエスト（`projects.quest_id`）のパーティー（`quest_members`）。**プロジェクトの参照＋チャット発言（＝口出し）を継承**（開発段でも関与を維持）。
- **開発担当**＝プロジェクト単位の新メンバー `project_members`（`role=lead/member`・**会社内の任意ユーザー可**＝クエストパーティー外でもよい）。**タスク担当（assignee）はここに限る**。

**アクセス門番**＝`can_access_project(project, user) = is_quest_party(project.quest_id, user) OR is_project_member(project.id, user)`。いずれでもないユーザーは閲覧・操作とも **404 `not_found`**（存在秘匿・§1.6）。**コンセプト非依存プロジェクト（`quest_id` NULL）＝`is_quest_party` は常に false ＝ アクセスは owner＋`project_members` のみ**（イノベーション担当の継承なし）。

| 操作 | 必要な権限 | 補足 |
| --- | --- | --- |
| プロジェクト/タスク/進捗の閲覧・**チャット発言** | イノベーション担当（quest party）**OR** 開発担当（project member） | 両者が同席＝橋渡し。発言者は開発/イノベーションをバッジ表示（§Q.4） |
| プロジェクトの起票（コンセプトから） | `owner`/`quest_admin` | 起票ゲート＝`decision='go'`（アプリ層検証） |
| プロジェクトの編集（title/description/status/deployment/external_link） | 起票者本人 ＋ `owner`/`quest_admin` | |
| 開発メンバー（`project_members`）の追加/役割変更/削除 | project owner ＋ `quest_owner`/`quest_admin` | 追加先は会社内の任意ユーザー |
| タスクの作成・編集・削除・並べ替え・親変更 | project owner ＋ 開発 `lead` ＋ `owner`/`quest_admin` | |
| タスクの状態更新（`status`/`done`） | **担当者(assignee)** ＋ 開発 `lead` ＋ project owner | 実行者の自律（2026-09-27 確定・点2） |
| タスクの担当割当 | project owner ＋ 開発 `lead` ＋ `owner`/`quest_admin` | 割当先は **`project_members` に限る**（範囲外は 422） |
| タスクチャットの投稿 | `comment` 権限（quest party）**OR** 開発メンバー | E チャットと同型（門番＝`can_access_project`） |

- **クエスト完了（`quest_status=completed`）後もプロジェクト/タスクの書き込みは凍結しない**（実行段は完了後に走る＝コンセプト P.0 の凍結とは扱いを分ける・2026-09-27 確定・点1）。
- 認可失敗＝**403 `forbidden`**／範囲外＝**404 `not_found`**／未認証＝**401 `unauthenticated`**。
- **`my_permissions`（起票/編集/メンバー管理/担当割当/状態更新/コメント可否＋自分の領域〔dev/innovation〕）はサーバーが算出して返す**（フロントは再実装しない・コーディング規約 §1）。

---

## Q.1 プロジェクト（起票・取得・編集）

| メソッド/パス | 概要 | リクエスト | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `POST /concepts/{concept_id}/project` | go コンセプトからプロジェクト起票（1コンセプト1プロジェクト） | パス: `concept_id`／ボディ: `{title?, description?, deployment?, members?〔{user_id,role}[]〕}`（既定 title=コンセプト名・内容で初期値） | 201 `project`（下記詳細）。既に存在すれば 409 `conflict`／`decision≠go` は 409 `invalid_state` |
| `POST /projects` | **コンセプト非依存**の単純タスク管理プロジェクト作成（`concept_id`/`quest_id` NULL・2026-09-27 追加） | ボディ: `{title(必須), description?, deployment?, members?}` | 201 `project`。作成者が owner・アクセスは owner＋`project_members`（クエストパーティー継承なし・Q.0） |
| `GET /projects` | プロジェクト一覧（SC-70・サーバー委譲 DataTable） | クエリ: §1.8（`q`/ソート/フィルタ＝`status`・`quest_id`・`concept_id`／進捗・担当で絞込） | `items[]`＝`{id, title, status, concept:{id,title}, quest:{id,title}, progress〔done/total〕, task_count, owner, updated_at}`・カーソル |
| `GET /projects/{project_id}` | プロジェクト詳細（SC-71・合成） | パス: `project_id` | `project`＝`{id, title, description, status, deployment〔jsonb〕, external_link, concept, quest, owner, progress, my_permissions, created_at, updated_at}` |
| `PATCH /projects/{project_id}` | プロジェクト編集（title/description/status/deployment/external_link） | パス＋ボディ（部分更新・無変更は info・デザイン標準 §14） | 200 `project` |

- 一覧は**サーバー委譲契約**（§1.8.1・列 flags ホワイトリスト）。`progress` は配下タスクの `done/total` 比率（サーバー算出・非永続）。
- 起票導線＝SC-61 コンセプト詳細「開発を始める」（`decision='go'` かつ未起票時のみ活性）。起票後は「プロジェクトへ」リンク。
- 詳細の `project` には**自分の領域**（`viewer_domain`＝`dev`/`innovation`/`both`）を含める＝UI の発言バッジ・見え方の出し分けに使う。

## Q.1b 開発メンバー（project_members・開発担当≠イノベーション担当）

> 開発領域の担当者をプロジェクトに参加させる（会社内の任意ユーザー）。イノベーション担当（クエストパーティー）は本 API に載せずとも参照＋チャット発言を継続（門番フォールバック）。

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /projects/{project_id}/members` | 開発メンバー一覧 | パス: `project_id` | `members[]`＝`{user, role〔lead/member〕, added_at}`。併せて `innovation_members[]`（クエストパーティー要約＝参照/口出し可の一覧・read 合成）も返してよい |
| `POST /projects/{project_id}/members` | 開発メンバー追加 | ボディ: `{user_id, role}`（`user_id`＝会社内ユーザー） | 201 `member`。既存は 409／会社外は 422 |
| `PATCH /projects/{project_id}/members/{user_id}` | 役割変更（lead/member） | パス＋ボディ: `{role}` | 200 `member` |
| `DELETE /projects/{project_id}/members/{user_id}` | 開発メンバー除外 | パス | 204。**担当タスクが残る場合の扱い**＝担当を外す or 409（実装時に確定・Q.7） |

- 権限＝project owner ＋ `quest_owner`/`quest_admin`（開発メンバー管理）。役割＝`lead`（タスク管理/割当/メンバー管理）／`member`（自分の担当タスクの状態更新）。
- 会社ディレクトリからの候補選択（追加 UI）は B の会社ディレクトリ read を流用（横断 EP を増やさない）。
- **UI＝実装済みの「参加メンバー（パーティー）・権限」エディタを踏襲**（フロントエンド実装フロー規約 §2.1c・新規 UI を作らない）＝登録時は「クエストを作成」ダイアログの同セクション、編集時は「パーティー・権限を編集」ダイアログ（`features/quests/QuestForm` `partyOnly`／`QuestPartyModal`）と同じ**候補追加＋選択中一覧**構成。**メンバーごとのコントロールのみ**クエスト5権限のチェック→**開発役割（lead/member）**に適応（土台・操作・用語は踏襲）。プロジェクト詳細（SC-71）の**「誰がどの役割か」一覧はクエスト詳細のパーティー一覧（`QuestDetailView` party タブ・`.pmember`/`PERM_BADGE`）を踏襲**して表示。

## Q.2 タスク（自己参照ツリー・CRUD）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /projects/{project_id}/tasks` | タスクツリー（WBS・SC-71） | パス: `project_id`／クエリ: `assignee?`/`status?`（絞込） | `tree[]`＝ネストした `{id, kind, title, description, assignee, status, sort_order, due_date, done_at, children[]}`（親→子・`sort_order` 昇順） |
| `POST /projects/{project_id}/tasks` | タスク作成（要件/作業） | ボディ: `{parent_task_id?, kind, title, description?, assignee_account_id?, due_date?, sort_order?}` | 201 `task`。作成時に `chat_thread(owner_type='task')` を冪等生成 |
| `GET /tasks/{task_id}` | タスク詳細 | パス: `task_id` | `task`（全項目＋`project_id`/`parent_task_id`＋`chat`〔thread_id・E 参照〕＋`my_permissions`） |
| `PATCH /tasks/{task_id}` | タスク編集（title/desc/kind/assignee/status/due_date/親・並び替え） | パス＋ボディ（部分更新） | 200 `task`。`status→done` で完了報酬（Q.3）／`assignee` は **`project_members`（開発担当）に限る**（範囲外 422）／状態更新は担当者/lead/owner（Q.0）／`parent_task_id` 変更は循環禁止（422）｜無変更は info |
| `DELETE /tasks/{task_id}` | タスク削除 | パス: `task_id` | 204。**子タスクがあれば 409 `conflict`**（先に子を処理／カスケードは実装時に判断） |

- ツリーは**同一 `project_id` 内**で完結（親も同プロジェクト）。深さ無制限・`kind` と深さは緩く対応（強制しない）。
- **コンセプトからの種継ぎ**＝`POST /projects/{id}/tasks/seed-from-concept`（コンセプトの「解の形態＋必要な能力」を要件タスク候補として返す／人手採否）。**MVP は候補提示のみ・一括作成/生成AIは Phase2**（seam）。

## Q.3 完了報酬（開発XP＋コイン・G 委譲）

- タスク `status→done` 遷移時に **G ドメインの付与ロジックへ委譲**＝`activities(kind='delivery_xp_gain', reason='task_done', ref_type='tasks', ref_id=<task_id>)` の**存在チェックで冪等付与**（二重付与防止・データモデル §5.27）。同一 Tx で `users.delivery_xp`＋`users.coin_balance` を更新。
- **開発XP はイノベーション XP（`users.xp`）と別軸**（`kind='xp_gain'` とは別 kind）。付与量・レベル式・称号は**当面持たず累計＋簡易バッジ**（実装時に額を確定）。
- `done→todo/doing` へ戻した場合の XP 取り消しは**しない**（付与は初回 done で確定・冪等台帳の存在で二重防止／取消運用は将来）。※要レビュー論点。
- 完了通知（担当外の owner 等への「タスク完了」通知）は **H 委譲**（実装時に要否判断）。

## Q.4 タスク単位チャット（既存チャットEP を thread 単位で流用）

- **新規チャットEP は作らない**。タスク作成時に `chat_thread(owner_type='task', owner_id=tasks.id)` を冪等生成し、以降はチャット中核 EP（`E` の `/chat-threads/{thread_id}/messages` 系＝thread 駆動）をそのまま使う。
- **門番＝`chat/application._resolve_host` に `task` 分岐を1つ追加**（`tasks.project_id → projects.quest_id` のパーティー権限へ委譲）。中核（メッセージ CRUD/リアクション/ピン/メンション/引用/添付）と DB は無改修（`chat_thread` の CHECK 制約を `task` 込みに広げる migration 0041 のみ）。
- realtime＝`chat:{thread_id}`（L 既存）。frontend は共有 `IdeaChatView` を `taskSource` で駆動（同一 UI/機能）。
- **将来「束ねて仕様に」**＝プロジェクト配下の全 thread を横断集約する read は後から追加（MVP は各タスクで会話できるまで）。

## Q.5 外部PM連携（seam・Phase2）

- **MVP はエクスポートの seam のみ**＝プロジェクト/タスクを外部PMへ渡す一方向（`external_link`＝`{provider, external_id, url}` を保持）。実 EP（CSV/API push・双方向同期・Webhook 取り込み）は **Phase2**。

## Q.5b 仕様確定の投票（spec decision・**Phase2・器のみ先出し**）

- 用途＝開発中に「仕様で決めないといけない事案」を起票→**開発担当とイノベーション担当が投票→仕様を確定**（コンセプトの Go/Pivot/Kill 投票とは別目的＝デリバリ中の争点決着）。§1.2「投票は継承しない」＝コンセプトのループ機構の話で、本ツールとは目的が異なり矛盾しない。
- **MVP は共有チャットでの橋渡しまで**＝EP は作らない。データの器（`spec_decisions`/`spec_decision_votes`・データモデル §5.52-5.53）だけ先出しして作り直しを回避（§3.6 と同思想）。
- Phase2 で実装（想定 EP＝`POST /projects/{id}/spec-decisions`／`POST /spec-decisions/{id}/votes`／`POST /spec-decisions/{id}/decide`）。**確定の効力**（タスク化・仕様メモ/`deployment` 反映）は Phase2 で詰める。

## Q.6 エラー・横断

- バリデーション＝422（`errors[].field`・§1.7）。起票ゲート違反（`decision≠go`）・重複起票・子ありタスク削除＝409（`invalid_state`/`conflict`）。範囲外＝404。
- 一覧＝§1.8.1 の DataTable クエリ契約（複数ソート・enum フィルタ・`page`/`per_page`＋`page_info.total`・`format=csv`）。
- 冪等＝完了報酬は台帳存在チェック（§1.9 の Idempotency-Key ではなく `(reason,ref_type,ref_id)` の一意性で担保）。

## Q.7 確定事項（2026-09-27・ユーザー確認済み）と実装時に詰める点

**確定（2026-09-27）**:
1. **クエスト完了後もプロジェクト/タスクの書き込みは凍結しない**（実行段は完了後に走る・Q.0）。
2. **二層メンバーシップ**＝開発担当（`project_members`・lead/member・会社内任意ユーザー）とイノベーション担当（クエストパーティー・参照＋チャット発言継承）。担当割当は開発担当に限る。状態更新は担当者/lead/owner（Q.0/Q.1b）。
3. **完了報酬**＝`done` 初回で `delivery_xp`＋コイン冪等付与（`done→todo` 差し戻しでの**取消はしない**・Q.3）。付与額は実装時に確定。
4. **タスク削除**＝子ありは **409**（先に子を処理・Q.2）。
5. **進捗ロールアップ**＝子孫タスクの done 比率（MVP は要件/作業を**均等重み**）。
6. **仕様確定の投票**＝**Phase2**（器 `spec_decisions`/`spec_decision_votes` は先出し・Q.5b）。

**実装時に詰める**:
- 完了報酬の額（delivery_xp／コイン）と完了通知（H 委譲）の要否。
- 開発メンバー除外時に担当タスクが残る場合の扱い（担当を外す or 409・Q.1b）。
- 種継ぎの粒度（Q.2 seed-from-concept が返す候補の作り方）。
- Phase2＝仕様確定投票の効力設計／CSV 取込の列マッピング・`task_dependencies` の有効化・工数見積 UI・外部PM 双方向・KPI 固定指標・チャット横断集約・仕様ブレ自動検知。
