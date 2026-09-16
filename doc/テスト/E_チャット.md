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
| E-TC-108 | api | 引用返信は複数可・同一チャットのみ | 同グループ2件／別アイデアのメッセージ | `POST`（quoted_message_ids[]） | 複数引用で 201・`quotes[]` に各抜粋／別アイデア引用は 422 | E.2／§5.16b |
| E-TC-109 | api | 編集＝本人のみ・is_edited | 自分／他人のメッセージ | `PATCH /chat-messages/{id}`（body） | 本人 200・`is_edited=true`・本文更新／他人 403／削除済み 409 | E.2 |
| E-TC-223 | api | 引用は通知しない・メンションは通知する（決定 2026-09-16＝引用された本人へ対人通知を出さない・人を呼ぶのは @メンションのみ） | owner 著者アイデア＋other=パーティー員／other の発言を seed（引用対象） | other の発言を引用（メンション無し）／別投稿で other をメンション | 引用のみ＝other は当該メッセージで通知 **0 件**（`ref_chat_message_id` 一致0）／メンション＝other に **`mention` 1 件** | E.6／H.1（決定 2026-09-16） |
| E-TC-109b | api | 編集で引用を置換（省略時は不変・別アイデアは 422） | 自分のメッセージ（引用 [A]）＋同一グループの B／別アイデアのメッセージ | `PATCH /chat-messages/{id}`（`quoted_message_ids[]`） | `[A]`→`[A,B]` に置換（`quotes[]` 反映）／`quoted_message_ids` 省略時は引用不変／別アイデアの引用追加は 422 | E.2／§5.16b |
| E-TC-110 | api | 削除＝本人＋owner/quest_admin・トゥームストーン | 自分／他人（一般）／他人（owner） | `DELETE /chat-messages/{id}` | 本人 200・`is_deleted`／一般が他人 403／owner が他人 200・一覧でトゥームストーン化 | E.2／§8-⑪ |
| E-TC-111 | api | 既読更新→未読件数（後退防止） | メッセージ2件 | `POST .../chat/read`（1件目）→`GET chat` | `unread.first_unread_message_id`＝2件目・`unread_count=1`。古い id 再送で後退しない | E.5／§5.31 |
| E-TC-112 | api | 活発度集計（日次＋版マーカー） | メッセージ数件＋公開後編集（版2） | `GET /ideas/{id}/chat-activity` | `daily[]`（日次件数）・`revision_markers[]`（版日時）・`total_messages` | E.1／D.4 |
| E-TC-113 | api | チャット添付→DL 署名URL | comment 権限・Fake storage | `POST`（files=png）→`GET /attachments/{aid}/download` | 201・メッセージ `attachments[]`（kind=image）・DL EP が `{url}`（チャット添付も共通 EP で解決） | E.3／§1.10 |
| E-TC-114 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST /chat-messages` | 403 csrf_failed／401 | A.0 |
| E-TC-211 | unit | メンション強調は nospace トークン一致のみ（受入不具合 DFT-E-001 再発防止＝描画側と composer の nospace 契約固定） | `renderTextHtml`・members に nospace=`テスト太郎` | `("@テスト太郎 …")`／`("@テスト 太郎 …")`／`<script>` | 前者＝`<span class="mention">@テスト太郎</span>`／空白入りは full name 強調なし（素テキスト）／`<script>`→`&lt;script&gt;`（XSS 無害化） | E.2 |

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
| E-TC-212 | unit | 魔法リアクションは game_mode OFF で非表示（`resolveMagic`・受入不具合 DFT-E-002 再発防止＝OFF でも既存魔法が描画/発動していた） | `reactions.magic` あり | `resolveMagic(reactions, false)`／`(…, true)`／魔法なし | false＝`null`（表示しない・エフェクト/バッジ/ピルとも非表示）／true＝magic 保持／魔法なし＝`null` | E.4／§4.11 |
| E-TC-122 | api | 完了クエストはリアクション凍結 | completed クエスト | `POST/DELETE reactions` | 409（invalid_state） | E.4／C.5 |
| E-TC-210 | api | ピン留めは owner/quest_admin のみ（FR-39 (b)） | owner／一般メンバー（comment のみ） | `POST/DELETE /chat-messages/{id}/pin` | owner=200・is_pinned 反転・一覧DTOに is_pinned／一般=403 | E（FR-39 (b)）／C.0 |

## 3. 画面 e2e（SC-24 アイデアチャット・E.1/E.2/E.4）

> 対象＝フロント接続済み SC-24（`features/chat/components/IdeaChatView.tsx`・`/(app)/ideas/[ideaId]/chat`）。e2e は契約の最終確認（画面↔API）に限定。前提＝dev seed ACME-01（owner＝comment 権限）。下地クエスト/公開アイデアは API で作成し teardown で論理削除。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| E-TC-201 | e2e | メッセージ投稿→スレッド反映＋通常リアクション | ログイン・API で recruiting クエスト＋published アイデア（chat_group は公開で自動作成） | `/ideas/{id}/chat` で入力→送信→リアクション ＋→👍 | 送信メッセージが `.msg__text` に出る（`postMessage`→`getChat`）・「＋」→ピッカー→👍 で `.reaction` チップ（`addReaction`・`getChat` 実データ） | E.1/E.2/E.4／SC-24 |
| E-TC-202 | e2e | SC-22 §4.4 チャット活発度/プレビューが実データ | published アイデア＋API でメッセージ投稿 | `/ideas/{id}` を表示 | チャットカードの件数バッジ＝実 `total_messages`・`.chat-preview` に投稿本文が出る（`getChatActivity`/`getChat`・デモ文言なし） | E.1／SC-22 §4.4 |
| E-TC-203 | e2e | SC-24 複数引用返信 | published アイデア＋2メッセージ投稿 | 2件を💬で引用→本文入力→送信 | 送信メッセージに `.msg__quote` が**2件**（両方の抜粋）＝複数引用（`quoted_message_ids[]`・§5.16b） | E.2／SC-24 §3 |
| E-TC-213 | e2e | SC-24 ピン留め後にホバー操作メニューが残らない（受入不具合 DFT-E-005 の回帰） | published アイデア＋1メッセージ（owner＝ピン権限） | メッセージを hover→📌ピン留め→マウスを外へ移動 | ホバー時 `.msg__actions` 表示／ピン後にホバーを外すと `.msg__actions` は**非表示**（クリックのフォーカスは `:focus-visible` でないため残らない・旧 `:focus-within` では出っぱなし） | SC-24／§4.9 |
| E-TC-214 | unit | 引用ジャンプの着地位置計算＋ハイライトクラス選択（受入不具合 DFT-E-006 再発防止＝ジャンプ先がフローティングバーに隠れる／どこへ飛んだか分からない） | `scrollTopForTarget`・`flashClassFor` | `(elTop, scrollY, barBottom, gap)` 各値／`reduce=false`・`true` | `scrollTopForTarget`＝`scrollY+elTop-barBottom-gap`（負値は 0 クランプ＝バー下端＋gap の直下に着地＝隠れない）／`flashClassFor`＝false=`msg--flash`（アニメ）・true=`msg--flash-static`（静止ハイライト・モーション抑制） | SC-24／§4.9・§4.10 |
| E-TC-215 | e2e | SC-24 引用クリックでジャンプ先が隠れずハイライトされる（受入不具合 DFT-E-006 の回帰） | published アイデア＋メッセージ2件（後発が先発を引用） | 引用チップ `.msg__quote` をクリック | 引用元 `.msg` に `.msg--flash` が一時付与（ジャンプ先が判別可能）／引用元の上端がフローティングバー `.chat-context--float` 下端より下（隠れない） | SC-24／§4.10 |
| E-TC-216 | e2e | SC-24 sticky コンポーザーが重なるメッセージにクリックを奪われない（受入不具合 DFT-E-007 の回帰＝入力欄の右側が反応しない） | `/ideas/{id}/chat` 表示 | `.composer` の computed `z-index` を検証 | `z-index` が数値で **メッセージ内容 z-index（最大3＝`.msg-row`魔法行）より大**かつ **ポップアップ（reaction-picker 40 等）より小**（旧＝`auto` で重なったメッセージ子が前面化しクリックを奪っていた） | SC-24／§4.10 |
| E-TC-217 | e2e | SC-24 最小化中に引用返信すると入力欄が展開する（受入不具合 DFT-E-008 の回帰＝最小化のままで引用が見えず「何も起きない」） | published アイデア＋1メッセージ（入力欄は既定で最小化） | メッセージを hover→💬引用返信をクリック（`openComposer` せず） | 入力欄が展開（`.composer__box` 表示）＋引用チップ表示（`.reply-ctx__head`＝「引用返信（1件）」）（旧＝最小化のまま `composer__full` 非表示で引用が見えなかった） | SC-24／§3 |
| E-TC-218 | e2e | SC-24 ホバー操作メニューに機能説明ツールチップ＋使用中のアクティブ表示（ユーザー要望） | published アイデア＋1メッセージ（owner＝ピン権限） | メッセージを hover→各ボタンの `title` を確認／👍リアクション／📌ピン留め | 各ボタンに機能説明の `title`（リアクション/引用返信/ピン留め/編集/削除）／リアクション後は🙂が `is-active`（`aria-pressed=true`）／ピン後は📌が `is-active`（`aria-pressed=true`・`title`＝「ピン留め中…」） | SC-24／§4.9 |
| E-TC-219 | e2e | SC-24 自分の送信メッセージは再入室で未読にならない（受入不具合 DFT-E-009 の回帰＝「ここから未読」が自分の投稿の上に出る） | published アイデア（未投稿） | チャットで送信→アイデア詳細へ戻る→チャットへ再入室 | 再入室後に `.unread-sep`（「ここから未読」）が**出ない**（送信で既読ポインタ前進＋表示側で自分の投稿の上に区切りを出さない＝自分の投稿は既読扱い） | SC-24／§5.31 |
| E-TC-220 | e2e | SC-24 全件未読での初期スクロール位置＝未読区切りがフローティングバーに隠れない（受入不具合 DFT-E-010 の回帰） | published アイデア＋他ユーザー著者の未読メッセージ多数（DB 直挿入・全件未読） | チャットへ遷移（初期スクロール） | `.unread-sep`（「ここから未読」）が出て、その上端がフローティング文脈バー `.chat-context--float` 下端より下（旧＝block:start で先頭がバー背後に潜り込み） | SC-24／§4.10・§5.31 |
| E-TC-221 | e2e | SC-24 入室時は「画面に見えたメッセージだけ既読」＝未読を一律既読にしない（受入不具合 DFT-E-011・ユーザー選択＝実際に表示されたら既読） | published＋他ユーザー著者の未読メッセージ多数（DB 直挿入・ビューポート超過） | チャットへ入室→**スクロールせず**離脱→再入室 | 再入室後も `.unread-sep` が残る（画面に出ていない下方の未読は既読にならない／旧＝入室で一律全既読にしていた） | SC-24／§5.31 |
| E-TC-222 | e2e | SC-24 リアルタイム反映された他ユーザーの新着は、画面で見たら再入室で既読（受入不具合 DFT-E-011 の報告シナリオ） | 2ユーザー（A=owner・B=user2 を comment 権限でパーティー追加） | B がチャットを開く→A が投稿→B に realtime 反映→B 離脱→再入室 | B 再入室後に当該メッセージの `.unread-sep` が出ない（B は画面で見た＝既読／旧＝realtime 反映後も未読のまま） | SC-24／L・§5.31 |

## 参加部署アクセス門番（FR-38 再設計・`can_access_quest`・C.0）

> チャットの門番を `can_access_quest` へ統一（2026-09-11）。**アクセスの都度、現所属で再判定**＝異動で全参加部署を外れたら名指しパーティー員でもチャット参照は 404（動的失効）。作成者は別格。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| E-TC-204 | api | 動的失効＝全参加部署離脱でチャット参照が 404 | G1 のみ所属の非作成者パーティー員→G1 のグループ所属を除去（参加部署 1 件） | `GET /ideas/{id}/chat`（当該員） | 404（`can_access_quest` 失効） | C.0／E.1 |
