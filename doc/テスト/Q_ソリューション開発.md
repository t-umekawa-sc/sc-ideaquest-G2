# テストパターン Q. ソリューション開発（プロジェクト/タスク・ISO 56001 ④⑤・FR-43）

> 対象＝`app/tenant/solutions`（projects/project_members/tasks・二層メンバーシップ門番・完了報酬）。正＝[API設計 Q](../API設計/Q_ソリューション開発.md)・[データモデル §5.49-5.53](../データモデル.md)。テスト接頭辞＝**Q-TC**。前提＝dev seed 一般ユーザー ACME-01。

## 1. プロジェクト起票・取得・門番（Q.1）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| Q-TC-101 | api | コンセプト非依存プロジェクト作成（単純タスク管理） | ログイン | `POST /projects`（title） | 201・`concept=null`/`quest=null`・作成者が owner＝詳細取得可 | Q.1 |
| Q-TC-102 | api | go コンセプトから起票＋1コンセプト1プロジェクト | go コンセプト（owner） | `POST /concepts/{id}/project`→再度 | 1回目201（concept/quest 設定）・2回目409（conflict） | Q.1 |
| Q-TC-103 | api | 起票ゲート＝decision≠go は 409 | undecided コンセプト | `POST /concepts/{id}/project` | 409（invalid_state） | Q.1 |
| Q-TC-104 | api | 起票は owner/quest_admin のみ | 一般（非管理） | `POST /concepts/{id}/project` | 403 | Q.0 |
| Q-TC-105 | api | 一覧・詳細の門番＝アクセス範囲外は秘匿 | 他者のコンセプト非依存プロジェクト | `GET /projects/{id}`（非メンバー） | 404（not_found） | Q.0 |
| Q-TC-106 | api | プロジェクト編集（基本情報・状態・導入メタ） | 自分のプロジェクト | `PATCH /projects/{id}`（title/status/deployment） | 200・詳細に反映（title/status/deployment） | Q.1 |
| Q-TC-107 | api | 編集は起票者/owner のみ | 非owner・非管理（メンバー） | `PATCH /projects/{id}` | 403（forbidden） | Q.0 |
| Q-TC-108 | api | プロジェクトのソフト削除＝一覧/詳細から除外＋コンセプト再起票可 | go コンセプト由来プロジェクト（owner） | `DELETE /projects/{id}`→`GET /projects`・`GET /projects/{id}`→`POST /concepts/{id}/project` | 204・一覧から消える・詳細404・同コンセプトから再起票201（部分ユニークが未削除のみ） | Q.1 |
| Q-TC-109 | api | 削除は起票者/owner のみ | 非owner・非管理（メンバー） | `DELETE /projects/{id}` | 403（forbidden） | Q.0 |

## 2. 開発メンバー（Q.1b・二層メンバーシップ）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| Q-TC-110 | api | 開発メンバー追加/役割変更/削除 | 自分のプロジェクト | `POST /members`（member）→`PATCH`（lead）→`DELETE` | 追加201・役割 lead・削除204 | Q.1b |
| Q-TC-111 | api | メンバー管理は owner のみ | 非owner・非管理 | `POST /projects/{id}/members` | 403 | Q.0 |
| Q-TC-112 | api | 開発メンバーは会社内ユーザーで参照＋イノベーション担当も返す | quest 由来プロジェクト | `GET /projects/{id}/members` | `members[]`＋`innovation_members[]`（クエストパーティー） | Q.1b |

## 3. タスク（Q.2）・完了報酬（Q.3）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| Q-TC-120 | api | タスク作成・任意深さツリー | プロジェクト | `POST /tasks`（親）→（子・parent 指定）→（孫） | `GET /tasks` が3階層のネストを返す | Q.2／§3.1 |
| Q-TC-121 | api | 担当割当は開発メンバーに限る | 非メンバーを担当指定 | `POST /tasks`（assignee=非メンバー） | 422（assignee_account_id） | Q.0 |
| Q-TC-122 | api | タスク完了で開発XP＋コイン冪等付与 | 担当付きタスク（開発メンバー） | `PATCH /tasks/{id}`（status=done）→ done→todo→done | delivery_xp/コインは初回のみ加算（再doneで二重なし・台帳1件） | Q.3／§5.27 |
| Q-TC-123 | api | 状態更新は担当者も可（非管理でも自分のタスク） | 担当=自分・非管理 | `PATCH /tasks/{id}`（status=doing） | 200（担当者は状態更新可） | Q.0 |
| Q-TC-124 | api | 子ありタスク削除は 409（先に子処理） | 親（子あり） | `DELETE /tasks/{parent}` | 409（has_children） | Q.2 |
| Q-TC-125 | api | 親タスク循環禁止 | タスク | `PATCH /tasks/{id}`（parent=自身） | 422（parent_task_id） | Q.2 |

## 4. タスクチャット（Q.4・チャット中核 thread 再利用）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| Q-TC-130 | api | タスクチャット投稿→一覧（アイデアと同一中核・thread=task） | 自分のプロジェクトのタスク | `POST /tasks/{id}/chat-messages`（body）→`GET /tasks/{id}/chat` | 201・一覧 data に投稿が1件（thread_id=task-…） | Q.4／§5.14b |
| Q-TC-131 | api | タスクチャットの門番＝範囲外は 404 | 非メンバーのタスク | `GET /tasks/{id}/chat` | 404（not_found・存在秘匿） | Q.0／Q.4 |
