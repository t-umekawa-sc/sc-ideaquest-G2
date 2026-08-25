# テストパターン E. チャット・リアクション・魔法発動

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/E_チャット・リアクション・魔法発動.md`](../API設計/E_チャット・リアクション・魔法発動.md)（E.0〜E.8）・[`../データモデル.md`](../データモデル.md) §5.15〜§5.20・§5.30・§5.31。エラー code の網羅は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン E（チャット）の縦スライス＝`app/tenant/chat/`。門番＝パーティー所属（C.0）＋投稿は `comment` 権限。投稿 XP+5 は G ledger（日次上限10/日）。通知（H）・リアルタイム（L）は post-commit no-op。完了は 409（既読は例外＝許可）。
> **段階実装**: 本 md はまず**コア会話**（メッセージ CRUD・既読・活発度・添付・メンション＝E.1/E.2/E.5）。リアクション（E.4・通常/魔法）と魔法解放（G）は後続コミットで追記する。
> 前提＝seed 一般ユーザー ACME-01（owner＝comment 権限保有）。下地クエスト/公開アイデアは ORM/API で用意し teardown で物理削除。変更系は Origin/CSRF。

## 1. コア会話 API（E.1/E.2/E.5・SC-24）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| E-TC-101 | api | チャット取得（0件・未読全件） | 公開アイデア・未投稿 | `GET /ideas/{id}/chat` | 200・`data=[]`・`unread.unread_count=0`・`chat_group_id` 返る（遅延生成） | E.1 |
| E-TC-102 | api | メッセージ投稿→一覧反映＋XP+5 | comment 権限 | `POST /chat-messages`（body） | 201・一覧に出る・投稿者に XP+5（`activities` reason=chat・ref_type=chat_messages） | E.2／§8-⑥ |
| E-TC-103 | api | 空メッセージ不可 | 同上 | `POST`（body 空・files 無） | 422 `empty_message` | E.2 |
| E-TC-104 | api | 投稿は comment 権限必須 | パーティー参加だが comment なし | `POST` | 403 | E.0 |
| E-TC-105 | api | 門番/可視性（非パーティー・下書き） | 非パーティー／draft アイデア | `GET chat`／`POST` | 404（存在秘匿・未公開はチャット無し） | E.0 |
| E-TC-106 | api | 完了クエストは投稿凍結 | completed クエストの公開アイデア | `POST` | 409（invalid_state） | E.0／C.5 |
| E-TC-107 | api | メンション検証 | パーティー員＋非メンバー | `POST`（mentions=member）／（mentions=非member） | 前者 201・`mentions[]` 反映／後者 422 `invalid_mention` | E.2 |
| E-TC-108 | api | 引用返信は同一チャットのみ | 同グループのメッセージ／別アイデアのメッセージ | `POST`（reply_to_message_id） | 前者 201・`reply_to` に抜粋／後者 422 | E.2 |
| E-TC-109 | api | 編集＝本人のみ・is_edited | 自分／他人のメッセージ | `PATCH /chat-messages/{id}`（body） | 本人 200・`is_edited=true`・本文更新／他人 403／削除済み 409 | E.2 |
| E-TC-110 | api | 削除＝本人＋owner/quest_admin・トゥームストーン | 自分／他人（一般）／他人（owner） | `DELETE /chat-messages/{id}` | 本人 200・`is_deleted`／一般が他人 403／owner が他人 200・一覧でトゥームストーン化 | E.2／§8-⑪ |
| E-TC-111 | api | 既読更新→未読件数（後退防止） | メッセージ2件 | `POST .../chat/read`（1件目）→`GET chat` | `unread.first_unread_message_id`＝2件目・`unread_count=1`。古い id 再送で後退しない | E.5／§5.31 |
| E-TC-112 | api | 活発度集計（日次＋版マーカー） | メッセージ数件＋公開後編集（版2） | `GET /ideas/{id}/chat-activity` | `daily[]`（日次件数）・`revision_markers[]`（版日時）・`total_messages` | E.1／D.4 |
| E-TC-113 | api | チャット添付→DL 署名URL | comment 権限・Fake storage | `POST`（files=png）→`GET /attachments/{aid}/download` | 201・メッセージ `attachments[]`（kind=image）・DL EP が `{url}`（チャット添付も共通 EP で解決） | E.3／§1.10 |
| E-TC-114 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST /chat-messages` | 403 csrf_failed／401 | A.0 |

## 2. リアクション（通常＋魔法・E.4）

> 対象＝`POST/DELETE /chat-messages/{id}/reactions`（統合 EP・`type` 判別）。通常＝`reaction_emojis` マスタ・同一ユーザー×同一絵文字不可。魔法＝解放済み（`user_spells`）＋1メッセージ1魔法（早い者勝ち）＋1チャット1回。完了は 409。魔法解放（前提）は §G 参照。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| E-TC-115 | api | 通常リアクション付与→取消（トグル・集計） | メッセージ1件 | `POST reactions`（normal 👍）→`DELETE ?emoji=👍` | 付与で `normal[👍].count=1`・`reacted_by_me`／取消で 0 | E.4／§5.18 |
| E-TC-116 | api | 通常はマスタ絵文字のみ | メッセージ1件 | `POST reactions`（normal・非マスタ絵文字） | 422 `invalid_reaction_emoji` | E.4／§5.30 |
| E-TC-117 | api | 同一ユーザー×同一絵文字は冪等 | 👍付与済み | `POST reactions`（normal 👍）再送 | 200・`count` は 1 のまま（重複行なし） | E.4／§5.18 |
| E-TC-118 | api | 魔法は解放済み必須 | 未解放の spell | `POST reactions`（magic・未解放） | 403 `spell_not_unlocked` | E.4／§5.20 |
| E-TC-119 | api | 1メッセージ1魔法（早い者勝ち） | 他ユーザーが魔法付与済みのメッセージ・自分は別 spell 解放済み | `POST reactions`（magic） | 409 `message_already_has_magic` | E.4／§5.18 魔法② |
| E-TC-120 | api | 1チャット1回（同一ユーザー×同一 spell） | msg1 に自分の魔法済み・同 spell | 別 msg2 に `POST reactions`（同 spell） | 409 `spell_already_used_in_chat`。取消すれば付け替え可 | E.4／§5.18 魔法① |
| E-TC-121 | api | 魔法取消は本人のみ | 自分の魔法／他人の魔法 | `DELETE ?type=magic` | 本人＝除去（別メッセージへ付け替え可）／他人＝残る | E.4 |
| E-TC-122 | api | 完了クエストはリアクション凍結 | completed クエスト | `POST/DELETE reactions` | 409（invalid_state） | E.4／C.5 |

## 3. 画面 e2e（SC-24 アイデアチャット・E.1/E.2/E.4）

> 対象＝フロント接続済み SC-24（`features/chat/components/IdeaChatView.tsx`・`/(app)/ideas/[ideaId]/chat`）。e2e は契約の最終確認（画面↔API）に限定。前提＝dev seed ACME-01（owner＝comment 権限）。下地クエスト/公開アイデアは API で作成し teardown で論理削除。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| E-TC-201 | e2e | メッセージ投稿→スレッド反映＋通常リアクション | ログイン・API で recruiting クエスト＋published アイデア（chat_group は公開で自動作成） | `/ideas/{id}/chat` で入力→送信→リアクション ＋→👍 | 送信メッセージが `.msg__text` に出る（`postMessage`→`getChat`）・「＋」→ピッカー→👍 で `.reaction` チップ（`addReaction`・`getChat` 実データ） | E.1/E.2/E.4／SC-24 |
| E-TC-202 | e2e | SC-22 §4.4 チャット活発度/プレビューが実データ | published アイデア＋API でメッセージ投稿 | `/ideas/{id}` を表示 | チャットカードの件数バッジ＝実 `total_messages`・`.chat-preview` に投稿本文が出る（`getChatActivity`/`getChat`・デモ文言なし） | E.1／SC-22 §4.4 |
