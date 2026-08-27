# テストパターン L. リアルタイム配信（WebSocket・配信ハブ）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/L_リアルタイム配信.md`](../API設計/L_リアルタイム配信.md)（L.0〜L.5）・[`../API設計/README.md`](../API設計/README.md) §1.12（WebSocket）・§1.4（Cookie セッション）・§1.5（会社DB動的ルーティング＝cross-tenant 遮断）。発行元＝H（`notifications:{user_id}`・`notify()` post-commit）／E（`chat:{chat_group_id}`）。エラー code は OpenAPI が SoT。
> 対象＝配信ハブ `app/tenant/realtime/`（プロセス毎ハブ＝購読テーブル topic→接続・`redis.asyncio` PSUBSCRIBE 背景タスク・`company_id` フィルタ転送）＋`GET /realtime`（WS ハンドシェイク）。**L は配信専用**（書き込みは REST・WS は receive-only＋購読制御のみ）。
> 前提＝seed 会社。api/int は starlette `TestClient.websocket_connect` で WS を張り、REST（notify 発火 or chat 投稿）→ WS 受信を照合。publish は sync `get_redis().publish`、購読は async ハブ。**イベント封筒**＝`{topic,type,data,id,company_id}`。

## 1. 接続・認証・自動購読（L.1）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| L-TC-101 | api | 未認証は接続不可 | Cookie セッション無し | `websocket_connect("/realtime")` | 101 を返さず 401 でクローズ（受信前に切断） | L.1 |
| L-TC-102 | api | 認証成功で確立＋notifications 自動購読 | ログイン済み（`iq_session`） | 接続後に自分宛 `notify()` 発火 | `notification.created`（topic=`notifications:{user_id}`）＋`unread_count` を受信 | L.1／L.3 |
| L-TC-131 | api | ハンドシェイクの Origin 検証 | 不正 Origin | `websocket_connect`（bad origin） | 接続拒否（クローズ） | L.1／§1.4 |

## 2. 通知配信（H→L・`notifications:{user_id}`）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| L-TC-103 | api | notify() post-commit で新着配信 | WS 接続中 | 別ユーザーが mention 発火（`notify()`＋commit） | `notification.created`＝受信者ロケールの best-effort body＋`unread_count` を受信（commit 後のみ・rollback では来ない） | L.3／H.0 |
| L-TC-104 | api | 既読操作で未読数同期 | 未読1件・WS 接続中 | `POST /notifications/{id}/read` | `notification.unread_count`（`{unread_count:0}`）を受信 | L.3 |
| L-TC-105 | api | cross-tenant 遮断（company_id フィルタ） | 会社 A のユーザーが接続 | 会社 B の同名トピックへ publish | 会社 A には届かない（`company_id` 不一致で捨てる） | L.0／§1.5 |

## 3. チャット配信・購読門番（E→L・`chat:{chat_group_id}`）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| L-TC-111 | api | 門番 OK（パーティー員）で購読→新着配信 | パーティー参加中・WS 接続 | `{op:subscribe,topic:chat:{cg}}`→他ユーザーが投稿 | subscribe 受理＋`chat.message.created`（E.1 表現）を受信 | L.2／L.3 |
| L-TC-112 | api | 門番 NG（非メンバー）は購読拒否 | 非パーティー員・WS 接続 | `{op:subscribe,topic:chat:{cg}}` | 購読拒否（制御エラー応答・存在秘匿）・以後 chat イベント届かない | L.2 門番 |
| L-TC-113 | api | リアクション/編集/削除の配信 | 購読中 | reaction add/remove・edit・delete | `chat.reaction.added/removed`・`chat.message.updated`・`chat.message.deleted`（トゥームストーン）を受信 | L.3 |

## 4. 購読中の認可失効（L.4）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| L-TC-121 | api | 除去で購読強制ドロップ（増分 DELETE /members） | chat 購読中のパーティー員 | C が当該ユーザーをパーティー除去 | 失効シグナルで当該 `chat:{cg}` 購読が即ドロップ・以後届かない（再接続も門番で不可） | L.4 |
| L-TC-122 | api | 除去で購読強制ドロップ（**バルク PUT /party**・M1） | chat グループ有＋パーティー員 | owner が `PUT /party`（member 除外）で**一括**除去 | 除去メンバー×当該 `chat:{cg}` に `publish_revoke` が発火（増分 DELETE と同じく L.4。set_party/update_quest/publish の全体編集経路の結線漏れを根治） | L.4 |
| L-TC-123 | int | クエストグループ除去の失効対象クエリ（M1b） | グループ内クエストに公開アイデア（chat group）＋パーティー員 | `list_chat_group_ids_for_group_member(group_id, user_id)` | グループ内クエストで**有効パーティー員**の chat group を返す／非参加ユーザーは空（過剰失効なし）。control_plane の group `remove_member` が本クエリで対象特定→post-commit `publish_revoke`（set_party と同一パターン） | L.4 |
