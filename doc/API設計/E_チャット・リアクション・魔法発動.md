# ドメイン E. チャット・リアクション・魔法発動（テナントプレーン）＝詳細確定（2026-08-07）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可〔クエスト内6権限〕・§1.8 一覧〔カーソル〕・§1.9 冪等・§1.10 添付〔MinIO・署名URL〕・§1.12 リアルタイム配信〔WebSocket〕）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)、クエスト/パーティー/権限は [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)、アイデア/添付/版/投票/フォローは [`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)。本ファイルはドメイン E の分割レビュー成果。

対象画面＝**SC-24（アイデアチャット）**。すべて**テナントAPI**（会社DB＝`chat_groups`/`chat_messages`/`chat_mentions`/`reactions`/`reaction_emojis`/`chat_reads`/`attachments`／魔法解放判定に `user_spells`/`spells`）。データモデル §5.15〜5.18・§5.19/5.20・§5.30・§5.31・§3（`reaction_type`〔normal/magic〕・`spell_effect`）。コーディング規約 §1（認可・業務ロジックはサーバー強制・フロントは表示/UX のみ）・§2.2（セキュリティ）・§3.1/§3.4（4層・`tenant/chat` 縦スライス）準拠。

**この分割レビューでユーザー選択により確定（2026-08-07）**:
- **未読位置＝`chat_reads` テーブルを新設**（データモデル §5.31・§8-⑰）。`POST /ideas/{idea_id}/chat/read` と未読セパレータを E で確定（従来 SC-24 §9 の TBD を解消）。
- **チャット添付＝単一 multipart `POST /chat-messages`**（本文＋メンション＋ファイルを 1 回で送り、メッセージ＋`attachments` を単一 UoW で作成）。D の「アイデア添付＝独立サブリソース `POST /ideas/{id}/attachments`」とは形が異なるが、**添付のAPI形はそのエンティティのライフサイクルに従う**という同一原則の帰結（後述 E.3 なぜ）。
- **魔法リアクション＝通常と同じ `POST/DELETE /chat-messages/{id}/reactions` に `type` 判別で統合**（`reactions` テーブルが `type` で一元化されているのと対称）。

## E.0 アクター・認可スコープ（門番＝パーティー所属＋comment 権限）

**アクセスの門番＝パーティー所属**（ドメイン C.0/D.0 と同一）。当該チャットの属するアイデア→クエストの `quest_members`（`quest_id`×`user_id`）に**有効な行（`removed_at IS NULL`）が無い**ユーザーは、チャット取得・投稿・リアクション・既読いずれも **404 `not_found`**（存在秘匿・§1.6・可視範囲＝パーティー内のみ）。また、当該クエストが属する**クエストグループにユーザーが所属していない場合**（`quest_group_members` に `removed_at IS NULL` の行が無い）も同様に 404（そのグループのクエスト配下のアイデア・チャットは一切不可視）。**下書き（`draft`）アイデアにはチャットが存在しない**（`chat_groups` は publish 時に作成＝D②）ため、未公開アイデアのチャットは 404。

| 操作 | 必要な権限（`permission_type`・データモデル §5.9） | 補足 |
| --- | --- | --- |
| チャット閲覧（メッセージ・活発度・既読更新） | **パーティー所属**（権限バッジ不問） | パーティーなら全員が閲覧可（SC-24 §2） |
| メッセージ投稿・添付・メンション | `comment`（**新規参加の既定権限**） | 無い場合は入力欄無効化＋理由（SC-24 §6） |
| メッセージ編集 | **投稿者本人**（`chat_messages.author_id`） | 本文上書き＋`is_edited`・履歴なし（§8-⑪） |
| メッセージ削除（論理） | **投稿者本人**＋`owner`/`quest_admin`＋QG管理者/システム管理者 | トゥームストーン・`deleted_by_id`/`deleted_at`（§8-⑪） |
| 通常リアクション（付与/取消） | **パーティー所属**（権限バッジ不問） | 閲覧できる＝リアクションできる・装飾のみ |
| 魔法リアクション（発動/取消） | **パーティー所属**＋**当該魔法を解放済み**（`user_spells`） | 解放＝SP 消費はドメイン G。E は解放済みチェックのみ |

- **クエスト完了（`quest_status=completed`）で書き込み凍結**（**全体像の単一正＝C.5**。本ドメインは自 EP の挙動を再掲）: メッセージ投稿/編集/削除・通常リアクション付与/取消・魔法発動/取消は**すべて 409 `conflict`（`invalid_state`）**でサーバー拒否＝読み取り専用（完了済みクエストの議論状態を変更させない）。**例外＝既読更新（`POST /ideas/{idea_id}/chat/read`）は完了後も許可**（読み取り系の副作用＝共有コンテンツを変更せず、完了後も未読の消し込みは必要なため。データモデル §5.31・§8-⑰）。
- 認可失敗＝**403 `forbidden`**／範囲外（非パーティー・他グループ・他テナント・未公開アイデア）は**404 `not_found`**／未認証は**401 `unauthenticated`**。
- **`my_permissions`（投稿可否等）・`can_post` はサーバーが算出して返す**（フロントは権限判定を再実装しない・コーディング規約 §1）。UX 便宜であり、実アクションは各エンドポイントで再検証。

---

## E.1 チャットの取得（メッセージ一覧・活発度・プレビュー）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /ideas/{idea_id}/chat` | アイデアのチャットメッセージ一覧を取得（SC-24 スレッド） | パス: `idea_id`／クエリ: `limit`（既定 50）・`before?`（このカーソルより過去へ遡上＝初期ロード/上スクロール）・`after?`（このカーソルより新しい方＝WS 切断後の再同期・§1.12）（§1.8 カーソル） | `data`=メッセージ行の配列（下記「メッセージ表現」）。`page_info.{next_cursor,has_next}`（`before` 遡上時は過去方向）。`unread`（`{first_unread_message_id, unread_count}`＝`chat_reads` 基準・§5.31）。`chat_group_id` |
| `GET /ideas/{idea_id}/chat-activity` | 議論アクティビティ・グラフ用の集計（SC-22 §4.4・**D から委譲**） | パス: `idea_id`／クエリ: `days?`（既定 14） | `daily`=直近 `days` 日の `[{date, message_count}]`（削除済みは除外・投稿者の `created_at` 基準・会社TZ）＋`revision_markers`=版が記録された日付 `[{date, revision}]`（元データは D.4 の `idea_revisions` 日時）＋`total_messages` |

### メッセージ表現（`GET /ideas/{idea_id}/chat` の各行・`chat_preview` も同形の抜粋）
- `id`／`author`（`{id, name, avatar, level}`）／`body`（Markdown ライト＝太字 `**`・コード `` ` ``・リンク `[]()`・メンション `@`。**サーバーは保存時サニタイズ、表示エスケープはフロント**・一覧 1/2 系）／`created_at`／`is_edited`／`reply_to`（`{id, author_name, excerpt}`＝引用返信元・自己参照 `reply_to_message_id`。元が削除済みなら excerpt はトゥームストーン文言）。
- `attachments[]`（D.3 と同じメタ＝`{id, original_name, size_bytes, mime, kind:image|file, download_url?}`。DL は署名URL＝§1.10・E.3）／`mentions[]`（`{user_id, name}`）。
- `reactions`（集計）＝`{normal:[{emoji, count, reacted_by_me, users?}], magic: {spell_id, effect, icon, actor?}|null}`（`users?`/`actor?` はホバーの「誰が押したか」用・匿名化なし＝チャットは記名。魔法は 1 メッセージ 1 件＝オブジェクト or null）。
- **削除済み（`is_deleted=true`）はトゥームストーン化して返す**＝`{id, is_deleted:true, deleted_at, created_at}` のみ（`body`・`attachments`・`mentions`・`reactions` は返さない＝UI 非表示。本文は監査用に DB 保持）。§8-⑪。

- **`chat_preview`（D の `GET /ideas/{id}` が内包）は E が形を定義**＝**直近 3 件**のメッセージ表現の抜粋（`body` は先頭数十字に切詰め・`attachments` は件数のみ・削除済みはトゥームストーン）＋`total_count`。D はこの構造をそのまま埋め込む（境界分離＝D は本文を持たない）。
- **ページング（§1.8）**: チャットは**カーソル方式**（`limit`/`before`/`after`）。新着は末尾に増えるため、初期表示は末尾 `limit` 件＋上スクロールで `before` 遡上、WS 切断後は `after` で差分再同期（§1.12「WS は速報・REST は真実」）。
- **未読情報**: `unread.first_unread_message_id` は `chat_reads.last_read_message_id`（§5.31）の直後のメッセージ＝SC-24 の「ここから未読」セパレータ位置。`chat_reads` 行が無い（初回閲覧）＝全件未読。算出はサーバー（フロントは表示のみ）。

---

## E.2 メッセージの投稿・編集・削除

| メソッド/パス | 概要 | リクエスト（パス/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `POST /chat-messages` | メッセージ投稿（**multipart**・本文/メンション/添付を単一 UoW） | **`multipart/form-data`**: `idea_id`（server が `chat_groups` を解決）・`body?`（Markdown ライト）・`reply_to_message_id?`・`mentions[]?`（`user_id` の配列）・`files[]?`（添付・§1.10）。**`Idempotency-Key` 必須**（§1.9・XP 副作用） | 201＋作成メッセージ表現（E.1）。副作用＝投稿 XP+5（下記）・メンション/フォロワー/投稿者通知（E.6）・Redis event（E.7） |
| `PATCH /chat-messages/{message_id}` | 自分のメッセージを編集（本文/添付追加・multipart） | パス: `message_id`／`multipart/form-data`: `body?`・`mentions[]?`（置換）・`files[]?`（追加）・`remove_attachment_ids[]?`（除去） | 200＋更新後メッセージ表現（`is_edited=true`）。Redis event（`chat_message_updated`） |
| `DELETE /chat-messages/{message_id}` | メッセージを論理削除（トゥームストーン） | パス: `message_id` | 200（`{id, is_deleted:true, deleted_at}`）。Redis event（`chat_message_deleted`） |

- **空メッセージ不可**: `body` が空**かつ** `files[]` も無い場合は **422 `empty_message`**（SC-24 §4.3・添付のみ〔本文空〕は可）。
- **投稿 XP+5（各ユーザー日次初回のみ・日次上限=チャット10/日）**: `activities` に `kind=xp_gain`,`reason=chat`,`ref_type=chat_messages`,`ref_id=message_id` を**同一 UoW で記帳**（ドメイン G の gamification repo を呼ぶ・コーディング規約 §3.4）。上限到達後の投稿は XP 付与なしで成功（投稿自体は可）。canonical XP 表・日次上限は README §6／データモデル §8-⑥。
- **メンション（`chat_mentions`）**: `mentions[]` は**当該パーティーのメンバーに限定**（非メンバー指定は 422 `invalid_mention`）。`UNIQUE(chat_message_id, mentioned_user_id)`（§5.17）。編集時は差し替え（増減した対象の通知整合は E.6/H）。
- **引用返信（`reply_to_message_id`）**: 同一 `chat_group` 内のメッセージのみ（他チャット/他アイデアは 422）。ネスト式スレッドは将来（SC-24 §9・MVP スコープ外）。
- **編集＝本人のみ・履歴なし**（`is_edited=true`・本文上書き）。他者の編集は **403**。**削除＝論理（トゥームストーン）**で**本人＋`owner`/`quest_admin`＋QG管理者/システム管理者**（`deleted_by_id` に実行者・モデレーション）。権限外の削除は 403。既に削除済みへの編集/削除は 409 `invalid_state`。§8-⑪。
- **完了凍結**: 上記 3 EP は `quest_status=completed` で **409 `invalid_state`**（canonical C.5）。
- **冪等（§1.9）**: `POST /chat-messages` は `Idempotency-Key` 必須（二重送信での重複投稿・二重 XP を防ぐ）。同一キー再送は保存済みレスポンスを再生。編集/削除は自然冪等（状態収束）につきキー任意。

---

## E.3 チャット添付（MinIO・署名URL）

- **投稿/編集の multipart に同梱**（E.2）。専用の一覧/直アップロード EP は設けない（メッセージのライフサイクルに従属）。保存時に §1.10 のサーバー検証（**1ファイル20MB／1メッセージ10件／MIME allowlist**＝§8-⑦・D.3 と同一初期値）。物理名はハッシュ化・元名/サイズ/MIME を `attachments` に保持（`chat_message_id` を設定＝§5.12）。
- **ダウンロード＝`GET /attachments/{attachment_id}/download`**（**D.3 と共通の署名URL EP**）。非公開バケット＋発行時サーバー認可（パーティー所属を再検証）＋短TTL署名URL（§1.10）。恒久公開URLは作らない。
- 画像はサムネイル/ライトボックス表示（フロント・SC-24 §4.2）。添付の除去は E.2 `PATCH`（`remove_attachment_ids[]`）またはメッセージ削除で表示除去（物理削除は監査保持方針に従い実装時判断）。

### なぜ D（アイデア添付）と形が違うか（設計判断・記録）
- **D＝独立サブリソース `POST/DELETE /ideas/{id}/attachments`**: アイデアは `draft` として先に存在する長命コンテナで、添付は複数の編集セッションにまたがり独立に増減し、draft→publish／版（revisions）をまたいで持続する。**既存のアイデア id にぶら下げる**のが自然。
- **E＝単一 multipart `POST /chat-messages`**: チャットメッセージは**事前の空コンテナが無い**追記単位で、**添付のみ（本文空）のメッセージ＝添付がメッセージの内容そのもの**。ゆえにメッセージと添付は**同時に存在**する必要があり、単一 UoW で作るのが正しい（D の publish のアトミック思想と対称）。先行ステージングアップロード方式は `chat_message_id` NULL の孤児行を生み GC が要る＝過剰。
- 結論＝**両者は「添付のAPI形はエンティティのライフサイクルに従う」という同一原則の別解**であり、不整合ではない。

---

## E.4 リアクション（通常＋魔法・統合エンドポイント）

| メソッド/パス | 概要 | リクエスト（パス/ボディ/クエリ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `POST /chat-messages/{message_id}/reactions` | リアクション付与（通常＝絵文字／魔法＝spell） | パス: `message_id`／ボディ: `{type:'normal', emoji}` または `{type:'magic', spell_id}` | 200＋当該メッセージの `reactions` 集計（E.1）。魔法は Redis event（`reaction_added`）＋魔法受領通知（E.6） |
| `DELETE /chat-messages/{message_id}/reactions` | リアクション取消（自分の分） | パス: `message_id`／クエリ: `emoji`（通常の取消）または `type=magic`（自分の魔法を取消） | 200＋更新後の `reactions` 集計。Redis event（`reaction_removed`） |

- **通常リアクション**: `emoji` は **`reaction_emojis` マスタ（`is_active=true`）に存在するもののみ**（任意絵文字は不可＝422 `invalid_reaction_emoji`・§5.30）。**同一ユーザー×同一絵文字は不可**（`UNIQUE(chat_message_id, user_id, emoji) WHERE type='normal'`・§5.18）。同じ絵文字の再 POST は**冪等**（既存につき現状集計を 200 で返す）＝トグルは付与=POST／取消=DELETE で表現。1 ユーザーが 1 メッセージに付けられる通常リアクションは最大でセット種類数。**通常リアクションは通知を発火しない**（装飾のみ）。
- **魔法リアクション**（FR-33・SC-24 §4.3b/§5）:
  - **解放済みチェック**＝`user_spells` に当該 `spell_id` が無ければ **403 `spell_not_unlocked`**（解放＝SP 消費/系統前提は**ドメイン G**。E は所有可否のみ判定）。
  - **1 メッセージ 1 魔法・早い者勝ち**＝当該メッセージに既に魔法があれば **409 `message_already_has_magic`**（`UNIQUE(chat_message_id) WHERE type='magic'`・§5.18 魔法②）。他ユーザーの魔法は取消不可。
  - **各魔法は 1 アイデアチャットにつき 1 回**＝同一ユーザー×同一 spell を同一チャットで再付与すると **409 `spell_already_used_in_chat`**（`UNIQUE(chat_group_id, user_id, spell_id) WHERE type='magic'`・§5.18 魔法①。`chat_group_id` は非正規化保持）。取消すれば同チャット内の別メッセージへ付け替え可。
  - 付与時に `reactions` へ `type=magic, spell_id, chat_group_id` を記録。エフェクト種別は `spells.effect`（fire/ice/thunder/sparkle/rainbow/aura）。
- **リアクション・魔法は装飾/社交演出のみ**（XP・評価・投票に非影響・§5.18）。**SP/コイン等の増減は伴わない**（魔法の解放時に消費済み）。
- **完了凍結**: 付与/取消とも `completed` で **409 `invalid_state`**（canonical C.5）。

---

## E.5 既読位置（未読セパレータ）

| メソッド/パス | 概要 | リクエスト（パス/ボディ） | レスポンス |
| --- | --- | --- | --- |
| `POST /ideas/{idea_id}/chat/read` | 既読位置を更新（未読セパレータ/未読件数用） | パス: `idea_id`／ボディ: `{last_read_message_id}` | 200（`{last_read_message_id, unread_count:0}`） |

- `chat_reads`（§5.31）を **`UNIQUE(chat_group_id, user_id)` で upsert**（後退防止＝既存 `last_read_message_id` より新しい位置のみ前進。古い id を受けたら現状維持）。
- **未読件数/セパレータの算出はサーバー**（`last_read_message_id` の `created_at`（同時刻は `id`）より後を未読）。`GET /ideas/{idea_id}/chat` の `unread` に反映（E.1）。
- **完了後も許可**（読み取り系の副作用＝凍結対象外・§5.31/§8-⑰）。ヘッダーベル（`notifications.is_read`）とは別系統（ベル＝ドメイン H・チャット既読＝本 EP）。

---

## E.6 メンション・通知連携（ドメイン H 連携点）

書込側（E の application）が **通知レコード生成をトリガ**する（配信テンプレ/多言語/一覧は**ドメイン H**・§1.13）。E は「いつ・誰に・どの種別を」発火するかを規定：

| 契機 | 通知種別（`notification_type`・§3） | 宛先 |
| --- | --- | --- |
| メッセージ投稿（メンションあり） | `mention` | `mentions[]` の各ユーザー（自分宛は除外） |
| メッセージ投稿 | `idea_comment` | アイデア投稿者（`ideas.author_id`・自分の投稿は除外） |
| メッセージ投稿 | `follow_comment` | 当該アイデアのフォロワー（`follows`・投稿者/メンション済みと重複排除） |
| 魔法リアクション付与 | `magic_reaction` | 対象メッセージの投稿者（自分への付与は除外） |

- 通知レコードは `notifications`（§5.24）に `ref_idea_id`／`ref_chat_message_id` を設定。**同一 UoW ではなく application の副作用の殻で生成**（投稿本体の成功を優先・コーディング規約 §3.4）。**通常リアクションは通知を発火しない**。
- 重複排除＝1 投稿で複数種別の対象が重なる場合の最終的な1通化ルールは**ドメイン H で確定**（E は発火契機を提供）。

---

## E.7 リアルタイム配信連携（ドメイン L 連携点・§1.12）

- **書き込みは REST・WS は配信専用**（§1.12・コーディング規約 §1/§3.1）。E の各書込 EP は成功時に application が **Redis Pub/Sub へ event を発行**する（ドメイン層の迂回禁止）。
- **トピック `chat:{chat_group_id}`**（SC-24 を開いたクライアントが購読）へ発行するイベント: `chat_message_created`／`chat_message_updated`／`chat_message_deleted`／`reaction_added`／`reaction_removed`（魔法エフェクト含む）。ペイロードは E.1 のメッセージ/集計表現に準拠。
- **トピック `notifications:{user_id}`**（常時購読）へ E.6 の通知イベント（新着・未読数）を発行。
- 配信の詳細（購読権限検証・再接続再同期・ハートビート）は**ドメイン L**／§1.12。切断中の欠落は **REST を正**として補完（再接続時 `GET /ideas/{idea_id}/chat?after=<cursor>`）。

---

## E.8 他ドメイン境界・残 TBD

- **委譲**: SP 消費/魔法解放/系統前提＝**G**（`POST /spells/{id}/unlock`）／通知配信・テンプレ・多言語・一覧＝**H**／WS トランスポート・購読制御・再同期＝**L**（§1.12）／全文検索（`chat_messages.body`）＝**J**（PGroonga・§6）。
- **確定済み（本レビュー）**: 未読 `chat_reads`（§5.31）・チャット添付の単一 multipart・リアクション統合 EP・`chat-activity`/`chat_preview` の形。
- **残 TBD（軽微・実装 or 該当ドメインで整理）**: リアクション「誰が押したか」の本番ポップオーバー UI（API は `users?`/`actor?` で供給済み）・魔法エフェクトを SC-22 チャットプレビュー等の他画面でも出すか（SC-24 §9）・引用返信のネストスレッド化（MVP 外候補）・添付の画像以外プレビュー（PDF 等）。
