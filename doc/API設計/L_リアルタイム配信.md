# ドメイン L. リアルタイム配信（WebSocket・テナントプレーン）＝詳細確定（2026-08-08）

> 本ファイル中の **「WS」は WebSocket の略**（ワーカースレッド/プロセスではない）。

> API 全体規約は [`README.md`](./README.md) 第1章（特に **§1.12 リアルタイム配信〔WebSocket〕**・§1.4 Cookie セッション・§1.5 会社DB動的ルーティング・§1.14 Redis）を参照。イベントの発行元＝[`E_チャット・リアクション・魔法発動.md`](./E_チャット・リアクション・魔法発動.md)（E.7・`chat:{chat_group_id}`）・[`H_通知.md`](./H_通知.md)（H.0/H.1・`notifications:{user_id}`）。門番（パーティー＋クエストグループ所属）は [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md) C.0。本ファイルはドメイン L の分割レビュー成果。

対象画面＝**SC-24 アイデアチャット**（新着メッセージ・リアクション・魔法エフェクト・編集/削除の即時反映）・**SC-02 通知一覧＋共通ヘッダーのベル**（新着通知・未読数）。ダッシュボード等は対象外（表示時取得）。すべて**テナント配信**（接続は `company_id` にバインド）。コーディング規約 §1（書き込みは REST・§3.1 のドメイン層を WS で迂回しない）・§2.2（認可・クロステナント遮断）準拠。

**この分割レビューで確定（2026-08-08）**:
- **イベント `type` を §1.12 準拠のドット記法に canonical 統一**（L.3）。E.7 の underscore 名をマップし `chat.reaction.removed` を補う。
- **publisher の正確化**＝`chat:{chat_group_id}` は **E のみ**が publish／`notifications:{user_id}` は **H の `notify()`** が publish（D の `idea_updated` 等も H 経由）。L は購読→WS 転送に徹する。
- **購読中の認可失効**＝パーティー/グループ除去時に当該購読を**強制ドロップ**＋再接続時に再検証（L.4）。

## L.0 責務境界・アクター

- **責務**＝Redis Pub/Sub に発行された event を、**購読中の対象クライアントへ WebSocket で転送する「配信ハブ」**。**新しい業務ロジック・書き込みは持たない**（全変更は各ドメインの REST が権限/検証/冪等/永続化/元帳を担い、その application が Redis へ event を発行する＝§1.12）。L は「速報」・REST は「真実」。
- **アクター＝認証済みユーザー**（WS 接続はセッション本人・`company_id` バインド）。
- **接続の分離**＝1 ユーザー 1 本の WS で複数トピックを多重化。接続は**セッションの `company_id` にバインド**し、クロステナント配信を物理的に遮断（§1.5）。トピックのキー（`user_id`/`chat_group_id`）は会社DBの UUID。
- **書き込み経路にしない**＝WS は receive-only（＋購読制御メッセージのみ）。ドメイン層を WS で迂回させない（§1.12・コーディング規約 §1）。

## L.1 接続（ハンドシェイク）

| メソッド/パス | 概要 | リクエスト（前提） | 挙動 |
| --- | --- | --- | --- |
| `GET /realtime` | WebSocket ハンドシェイク（Upgrade） | **本セッション必須**（httpOnly Cookie `iq_session`・§1.4）・`Connection: upgrade` | 認証成功＝WS 確立し `notifications:{user_id}` を**自動購読**／**未認証は 101 を返さず 401 でクローズ**。接続を `account_id`/`user_id`/`company_id` にバインド |

- **認証＝既存 Cookie セッション**をハンドシェイクで検証（§1.4・トークンを URL/クエリに載せない）。CSRF は WS が受信専用のため購読制御メッセージのオリジン検証で担保（Origin/Sec-Fetch・§1.4 方針）。
- **ハートビート**＝アイドル接続に ping/pong（ops・§1.12）。リバプロで WS Upgrade を許可（`Connection: upgrade`）。
- **スケール**＝各 API/ハブインスタンスが Redis を購読し、自分に繋がるクライアントの購読集合＋`company_id` でフィルタして転送（水平スケール可・§1.12）。

## L.2 トピックと購読制御（クライアント→サーバー）

- **常時購読＝`notifications:{user_id}`**（接続時に自動購読・本人固定）。
- **動的購読＝`chat:{chat_group_id}`**：クライアントが制御メッセージで開閉。
  - 購読: `{ "op": "subscribe", "topic": "chat:{chat_group_id}" }`（SC-24 を開いた時）。
  - 解除: `{ "op": "unsubscribe", "topic": "chat:{chat_group_id}" }`（離脱時）。
- **購読時の門番（サーバー強制）**＝`chat:{chat_group_id}` の購読要求時に、その chat_group が属するアイデア/クエストについて **C.0/E.0 の門番（`quest_members.removed_at IS NULL` かつ `quest_group_members.removed_at IS NULL` の AND）**を検証し、満たさなければ**購読を拒否**（制御応答でエラー・存在秘匿のため詳細は返さない）。`notifications:{user_id}` は本人固定のため追加検証不要。
- 購読は接続単位（再接続で作り直し）。1 接続で複数の `chat:{id}` を同時購読可（複数タブ相当はクライアント実装依存）。

## L.3 配信イベント（サーバー→クライアント・canonical カタログ）

**メッセージ形（§1.12）**＝`{ "topic": "...", "type": "<下表>", "data": {...}, "id": "<event_id>" }`。`type` は機械可読（ドット記法）、`data` は表示用ペイロード、`id` は将来の再送（`Last-Event-ID` 相当）用の event 識別子。

| topic | type | 発行元 | data（正＝各ドメイン表現） |
| --- | --- | --- | --- |
| `chat:{chat_group_id}` | `chat.message.created` | E（`POST /chat-messages`） | メッセージ表現（E.1） |
| `chat:{chat_group_id}` | `chat.message.updated` | E（`PATCH`） | 更新後メッセージ表現（E.1・`is_edited`） |
| `chat:{chat_group_id}` | `chat.message.deleted` | E（`DELETE`） | トゥームストーン（`{id, is_deleted:true, deleted_at}`・E.1） |
| `chat:{chat_group_id}` | `chat.reaction.added` | E（`POST /reactions`・魔法含む） | 当該メッセージのリアクション集計（E.1） |
| `chat:{chat_group_id}` | `chat.reaction.removed` | E（`DELETE /reactions`） | 当該メッセージのリアクション集計（E.1） |
| `notifications:{user_id}` | `notification.created` | **H の `notify()`**（post-commit） | 通知表現（H.2・**push 時点で受信者ロケールにレンダリングした best-effort 表示ペイロード**）＋`unread_count` |
| `notifications:{user_id}` | `notification.unread_count` | **H の `notify()`**／既読操作の反映 | `{ unread_count }`（ベル同期） |

- **publisher（正確化）**＝`chat:{chat_group_id}` は **E のみ**が publish（E.7・チャットは E が唯一の書込元）。`notifications:{user_id}` は **H の `notify()`** が publish（H.0/H.1・**発火は D/E/F/G/A が H を post-commit 呼び出し**＝D の `idea_updated` 等も H 経由で、D が直接 WS へ publish はしない）。**L 自身は publish しない**（購読→転送のみ）。
- **ペイロードの可視性**＝`data` は各ドメインの REST 表現（E.1／H.2）に準拠し、**匿名化・トゥームストーン・visibility 等は発行元がすでに適用済み**（L は再適用しない）。`notification.created` の本文はロケール切替に対して**速報限りの best-effort**（正は REST 再取得＝取得時レンダリング・§8-⑳）。
- **通常リアクションも `chat.reaction.added/removed` を発行**（装飾・魔法エフェクトは `chat.reaction.added` に含む・E.6）。

## L.4 購読中の認可失効（決定）

購読後に対象ユーザーが**パーティー/クエストグループから外れた**場合（C の `DELETE /quests/{id}/members/{user_id}`＝`quest_members.removed_at` 設定・またはグループ除去）、その `chat:{chat_group_id}` 購読を放置すると短時間だが新着が届き得る。

- **決定＝除去操作時に「購読強制ドロップ」制御シグナルを publish ＋ 再接続時に再検証**。除去を行う application（C）が、対象 `user_id`×該当 `chat_group_id`（当該クエストの chat 群）に対する**失効シグナル**を Redis 経由で発行し、WS ハブは該当接続の当該購読を即時ドロップする。加えて**再接続時は L.2 の門番で必ず再検証**するため、いずれにせよ以後は購読不可になる。REST は既に 404（履歴も引けない）。
- **不採用**＝(a) fan-out のたびに全受信者の権限を再チェック（高コスト・常時パスを重くする）／(b) 次回再接続まで放置（短時間の新着漏れが残る・弱い）。
- 実装の具体（失効シグナルのチャネル名・ハブ内の購読テーブル表現）は L.5 TBD。

### 配信モデル（プロセス毎ハブ集約）

WS 接続と Redis 購読の関係を明確化する（実装者向け・L.4 の失効シグナル／購読テーブルもこのモデル上で動く）。

- **1接続 = 2系統**＝(1) **受信ループ**（クライアント→サーバー・`subscribe`/`unsubscribe` の購読制御のみ・接続ごとに1本）と (2) **配信**（Redis→サーバー→クライアント）。**publish で動くのは (2) だけ**で、受信ループは関与しない（両者は別コルーチン）。
- **ハブ集約（推奨実装）**＝各 API/ハブ**プロセス内に1個のハブ**（そのプロセスのシングルトン）を置き、Redis 購読と配信ループを**そのプロセスの全接続で共有**する。各 `GET /realtime` は自分の接続を**ハブの購読テーブル（topic→接続集合）に登録するだけ**で、接続ごとに `pubsub` を開かない（接続数ぶんの Redis 購読を作らないため）。
  - **不採用＝接続ごとに `redis.pubsub()` を1本ずつ**（接続数と同数の Redis 購読が生まれ非効率）。
- **転送＝購読集合 ＋ `company_id` フィルタ**（L.29）。ハブは受信した event の `topic` に紐づく接続へ、`event.company_id == conn.company_id` を満たすものだけへ送る（クロステナント遮断の最後の砦・§1.5）。
- **水平スケール**＝プロセス／マシンが N 個あればハブも N 個でき、各ハブが Redis を購読する。Redis Pub/Sub は publish を全 subscriber へファンアウトするので、ユーザーがどのプロセスに繋がっていても届く（＝接続の割り当てはインスタンス非依存）。各ハブは自分の購読テーブルに無い topic を捨てる。
- **TBD（L.5）**＝ハブの Redis 購読方式＝(a) パターン購読（`PSUBSCRIBE notifications:*` / `chat:*`・実装単純）か (b) 接続増減に応じた個別 channel の動的 `subscribe`/`unsubscribe`（Redis への配布量を絞れる）か。失効シグナルのチャネル名・購読テーブルの具体表現もここで確定。

## L.5 他ドメイン境界・残 TBD

- **委譲/連携**＝チャット event の発行＝**E**（E.7・`chat:{chat_group_id}`）／通知 event の発行＝**H の `notify()`**（H.0/H.1・`notifications:{user_id}`・発火は D/E/F/G/A が H を呼ぶ）／書き込み・権限・冪等・元帳＝各ドメインの **REST**（L は関与しない）／再同期の真実＝**REST**（チャット `GET /ideas/{id}/chat?after=<cursor>`＝E.1／通知 `GET /notifications`＋`GET /notifications/unread-count`＝H.2）。
- **確定済み（本レビュー）**＝イベント `type` はドット記法に canonical 統一（E.7 の underscore をマップ・`chat.reaction.removed` 補完）／publisher は chat=E・notifications=H の `notify()`（§1.14/§2-L の表現を正確化）／購読門番＝パーティー＋グループ AND（C.0）／認可失効は除去時ドロップ＋再接続再検証／`notification.created` は push 時レンダリングの best-effort（正は REST）。
- **実装で確定（2026-08-26・MVP）**＝ハブの Redis 購読＝**パターン購読**（`PSUBSCRIBE notifications:* / chat:*`・L.5(a)）＋失効チャネル `SUBSCRIBE realtime:revoke`／**失効シグナルのチャネル名＝`realtime:revoke`**（ペイロード `{user_id, chat_group_id, company_id}`）／**ハブ内購読テーブル＝プロセス内 `dict[topic→set[Connection]]`**（プロセス毎シングルトン・`app/tenant/realtime/hub.py`）／転送は購読集合＋`company_id` フィルタ（封筒 `{topic,type,data,id,company_id}`）／エンドポイント＝`GET /api/v1/realtime`（Cookie セッション認証＋Origin 検証）。実装＝`app/tenant/realtime/`（events/hub/gate/router）。発行＝H `notify()` の post-commit（`notification.created`/`notification.unread_count`）・E chat の post-commit（`chat.*`）・C 除去の `publish_revoke`（L.4）。フロント＝単一 WS クライアント `lib/realtime.ts`＋ヘッダーベル即時（`RealtimeProvider`）／SC-02・SC-24 は WS 受信で再取得（REST が真実）。
- **残 TBD（軽微・実装 or 運用で確定）**＝`Last-Event-ID` 相当の再送（`id` は将来用に付与・現状は REST 再同期）／ハートビート間隔・アイドル切断・再接続バックオフの具体値（現状＝再接続バックオフ 1s→最大 15s）／**プレゼンス/タイピング表示**（将来・同 WS 上で拡張）／**外部通知（メール/Slack）**（将来・H＋§1.13）／WS 接続数上限・レート制限（購読制御メッセージの濫用防止）／chat 配信 `data` のビューア依存フィールド（リアクション `mine` 等）は発行元視点＝best-effort（正は REST 再取得・L.3）。
