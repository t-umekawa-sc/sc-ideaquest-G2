# ドメイン D. アイデア・添付・版・投票・フォロー（テナントプレーン）＝詳細確定（2026-07-31）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可〔クエスト内6権限〕・§1.8 一覧・§1.9 冪等・§1.10 添付〔MinIO・署名URL〕）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)、クエスト/パーティー/権限は [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)。本ファイルはドメイン D の分割レビュー成果。

対象画面＝**SC-21（アイデア登録・編集モーダル）/ SC-22（アイデア詳細）**。すべて**テナントAPI**（会社DB＝`ideas`/`idea_stakeholders`/`attachments`/`votes`/`idea_revisions`/`chat_groups`/`follows`）。データモデル §5.10〜5.15・§5.23・§3（`idea_status`/`vote_type`/`activity_ref_type`）。コーディング規約 §1（認可・業務ロジックはサーバー強制・フロントは表示/UX のみ）・§2.2（セキュリティ）準拠。

**この 2 件をユーザー選択で確定（2026-07-31）**:
- **投票エンドポイントの形＝`POST /ideas/{id}/vote {type}`（登録/切替）＋`DELETE /ideas/{id}/vote`（取消）**（RESTful・冪等・状態が URL に素直）。
- **版の粒度＝公開アイデアの全保存で 1 版を記録し、投票者＋フォロワーへ `idea_updated` 通知**（データモデル §5.14 / FR-34 どおり。軽微修正の通知抑制は D.8 未確定へ）。

## D.0 アクター・認可スコープ（門番＝パーティー所属＋クエスト内権限）

**アクセスの門番＝パーティー所属**（ドメイン C.0 と同一）。当該アイデアの属するクエストの `quest_members`（`quest_id`×`user_id`）に行が無いユーザーは、アイデア詳細・添付・版・投票・フォローいずれも **404 `not_found`**（存在秘匿・§1.6・可視範囲＝パーティー内のみ）。`quest_group_members`（`removed_at IS NULL`）に無いグループのアイデアも当然 404。

| 操作 | 必要な権限（`permission_type`・データモデル §5.9） | 補足 |
| --- | --- | --- |
| アイデア閲覧（詳細・添付DL・版・活発度） | **パーティー所属**（権限バッジ不問） | パーティーなら全員が閲覧可（README 2節・SC-22 §2） |
| アイデア作成・公開 | `idea_create`（**新規参加の既定権限**） | SC-21 登録 |
| アイデア編集 | **投稿者本人**（`ideas.author_id`）または `owner`/`quest_admin` | 編集は版を生む（D.4） |
| アイデア削除（論理） | **投稿者本人**または `owner`/`quest_admin` | §5.10・トゥームストーン |
| 投票（賛成/反対/取消） | `vote`（**新規参加の既定権限**） | 自分のアイデアにも可 |
| フォロー（ウォッチ） | **パーティー所属**（権限バッジ不問） | 閲覧できる＝フォローできる |

- **`draft`（下書き）アイデアは投稿者本人のみ可視**（§5.10）。他パーティーメンバーには 404 相当で見せない（一覧・詳細から除外）。**本人の下書きは一覧にも表示する**（`GET /quests/{quest_id}/ideas` に本人の `draft` を含める＝クリックで SC-21 編集・D.1 の決定）＋**ダッシュボード**（ドメイン I）にも集約＝両導線に出る。
- **クエスト完了（`quest_status=completed`）で書き込み凍結**（C.5）: アイデア作成/編集/削除・投票（登録/切替/取消）・フォローは維持可だが**投稿系は 409 `conflict`（`invalid_state`）**でサーバー拒否（読み取り専用）。フォローは通知購読なので凍結後も切替可とする（D.6 注記）。
- 認可失敗＝**403 `forbidden`**／範囲外（非パーティー・他グループ・他テナント・下書き他人）は**404 `not_found`**／未認証は**401 `unauthenticated`**。

---

## D.1 アイデアの取得（一覧・詳細）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /quests/{quest_id}/ideas` | クエスト内アイデア一覧＋自分の下書きを取得（SC-12 アイデアタブ） | パス: `quest_id`／クエリ: `q?`（件名/本文/価値 部分一致は検索＝J に委譲・ここは件名の簡易絞り）・`status?`（`published`〔既定〕`\|draft`〔自分の下書きのみ〕）・`sort`（`-created_at`〔新着〕/`-vote_count`/`-updated_at`）・`limit`/`cursor`（§1.8） | `data`=アイデア行の配列（`id`/`title`/`status`/`author`〔アバター/Lv/氏名〕/`vote_summary`〔`approve`/`oppose` 数・匿名化考慮・下書きは 0〕/`comment_count`/`is_selected`/`current_revision`/`updated_at`/`my_vote`〔自分の投票・匿名でも本人には返す〕/`following`/`my_state`〔`draft`〔本人の下書き〕/未投票/投票済 等〕）。`page_info.{next_cursor,has_next}` |
| `GET /ideas/{idea_id}` | アイデア詳細を取得（SC-22） | パス: `idea_id` | アイデア本体（`title`/`value`/`body`/`stakeholders[]`/`time_limit`/`note`/`status`/`is_selected`/`current_revision`/`author`/`created_at`/`updated_at`）＋`attachments[]`（D.3 メタ）＋`vote`（`summary`＋`my_vote`＋`voters?`〔記名時のみ・D.5〕＋`stale`〔投票後更新フラグ・D.5〕）＋`following`（bool）＋`chat_preview`（直近数件＝ドメイン E）＋`my_permissions`（UX 出し分け用） |

- **参照制限（サーバー強制・FR-15）**: `GET /quests/{quest_id}/ideas` は次の **(A) OR (B)** を返す（いずれも `ideas.deleted_at IS NULL`・セッション会社内・パス/クエリで `company_id` は受け取らない＝§1.5）。前提として、クエスト自体が可視であること（当該クエストの `quest_members.removed_at IS NULL` に自分の行があり、`quest_group_members.removed_at IS NULL`＝ドメイン C.0 と同一）を門番で満たすこと。
  - **(A) 公開系**: `status = published`（パーティーメンバー全員に可視）。
  - **(B) 自分の下書き**: `author_id = 自分` かつ `status = draft`（**投稿者本人のみ可視**）。
- **下書き（`draft`）を一覧にも表示（決定 2026-08-06・UX 改善／C.1 の下書きクエスト表示と対称）**: 従来「下書きは一覧に出さない（本人の下書きはダッシュボード〔ドメイン I〕集約のみ）」だったが、**一覧から下書き作成 → 戻ると消える**という不便を解消するため、**投稿者本人の下書きは `GET /quests/{quest_id}/ideas` にも含める**（`my_state=draft` で下書きバッジ表示・**クリックで SC-21 編集モーダル**〔公開済みは SC-22〕・投票/コメントは公開後のみ＝一覧では表示のみ）。**ダッシュボード（ドメイン I）にも引き続き集約**＝両導線に出る。他パーティーメンバーには他人の下書きは一切見えない（一覧から除外・`GET /ideas/{id}` は `draft` の場合 `author_id` 本人のみ 200・それ以外は 404）。
- **投票集計の匿名化**（§1.6/README 匿名化）: `vote_summary` は常に賛成/反対の**数**を返す。**投票者の身元（`voters[]`）は `companies.vote_anonymized` が記名モード（OFF）のときのみ**返す。匿名モードでも `my_vote`（本人の投票）はフロントのハイライト用に本人へ返す（自分の投票は隠さない）。匿名モード＋`hide_voters_from_managers=false` のときは `owner`/`quest_admin` に限り `voters[]` を返す（一般には非表示・README 匿名化仕様）。
- **評価結果**（SC-22 §4.6 右レール）は**ドメイン F**＝`GET /ideas/{idea_id}/evaluation`（公開範囲 `visibility` 考慮の集計＋観点別コメント＋総評）。本ドメインの `GET /ideas/{id}` には評価集計を含めない（境界分離・フロントは 2 リクエストを合成）。
- **議論アクティビティ・グラフ**（SC-22 §4.4・直近14日の日次メッセージ数＋更新マーカー）は**ドメイン E**（チャット集計）＝`GET /ideas/{idea_id}/chat-activity`。本ドメインは版の更新マーカー元データ（`idea_revisions` の日時）を D.4 で提供する。
- **`my_vote`/`following`/`my_permissions`/`stale`** はサーバーが算出して返す（フロントは権限・匿名化を再実装しない・コーディング規約 §1）。UX 便宜であり、実アクションは各エンドポイントで再検証。

## D.2 アイデアの作成・編集・削除・公開（SC-21）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `POST /quests/{quest_id}/ideas` | アイデアを作成（SC-21・`idea_create` 権限） | パス: `quest_id`／ボディ: `title`（必須）,`value`（必須）,`body`（必須）,`time_limit?`,`stakeholders?`（`[{label, is_custom?}]`）,`note?`,`status`（`draft\|published`）。`Idempotency-Key` 推奨（§1.9） | 作成されたアイデア（`draft` は本人のみ表示・`published` は公開）。`author_id`＝セッション本人。`published` で公開処理（下記）を同一 UoW 実行 |
| `PATCH /ideas/{idea_id}` | アイデアを編集（投稿者本人 or `owner`/`quest_admin`） | パス: `idea_id`／ボディ（差分）: `title`/`value`/`body`/`time_limit`/`stakeholders`/`note` | 更新後のアイデア。**公開済みなら 1 版を記録し通知発火**（D.4）。`stakeholders` は**置換セット**（送られた配列で `idea_stakeholders` を全置換） |
| `DELETE /ideas/{idea_id}` | アイデアを論理削除（投稿者本人 or `owner`/`quest_admin`） | パス: `idea_id` | 204。`deleted_at`＋`deleted_by_id` を設定（トゥームストーン）。以後一覧/詳細/検索/集計から除外。子（チャット/投票/評価/版/添付/フォロー・`activities` 元帳）は**物理削除せず監査保持**（§5.10・`ON DELETE RESTRICT`） |
| `POST /ideas/{idea_id}/publish` | 下書きを公開（`draft` → `published`） | パス: `idea_id`／`Idempotency-Key` 推奨 | 公開後のアイデア（`status=published`）。公開処理（下記）を実行。投稿者本人 or `owner`/`quest_admin` |

- **必須充足**（サーバー検証・§2.2 入力検証）: `title`・`value`・`body`。未充足は **422 `validation_error`**（`errors[].field`）。`time_limit`/`stakeholders`/`note` は任意（§5.10 は NULL 可＝SC-21 の必須 3 項目表示はフロント UX、権威はサーバーの本規約）。
- **公開処理（`published` になる瞬間に 1 回だけ・同一 UoW）**:
  1. `chat_groups` を作成（`idea` と 1:1・`UNIQUE(idea_id)`・§5.15）。**冪等**＝既に存在すれば作らない。
  2. **投稿 XP+50 を投稿者に付与**（README §6 canonical＝アイデア投稿=50・`activities` に `reason=idea_post`,`ref_type=ideas`,`ref_id=idea_id` を同一 UoW で記帳＝ドメイン G の gamification repo を呼ぶ・コーディング規約 §3.4）。**日次上限の対象外**（投稿 XP は上限リストに無い＝投票5/チャット10/ログイン1 のみが上限対象・§8-⑥）。
  3. **公開は一方向**（`idea_status` は `draft`/`published` の 2 値・非公開への差し戻しは MVP 非対応）。よって XP+50・チャットグループ作成は**アイデアにつき 1 回**（再 `publish` は 409 `conflict`〔`invalid_state`〕・同一 `Idempotency-Key` 再送は最初の結果を返す）。
- **`POST /ideas` の `status=published`** は「作成＋即公開」＝作成後に公開処理を同一 UoW で走らせる（`publish` を分けて呼ぶ必要なし）。`status=draft` なら公開処理はしない（付与なし・本人のみ表示）。
- **編集と版**: 公開済みアイデアの `PATCH` は毎回 `idea_revisions` に 1 版追加＋`ideas.current_revision++`＋投票者/フォロワーへ `idea_updated` 通知（D.4）。**下書き中の編集は版を作らない**（公開前は履歴不要・保存で上書き）。
- **Mass Assignment 防止**: `author_id`/`status`（`publish` 以外での昇格）/`is_selected`/`current_revision`/`deleted_*`/監査列はクライアント入力を受けない（サーバー設定・§1.4）。`is_selected` の変更は評価・選定（ドメイン F/G）の責務でありここでは受けない。
- **添付は別 API**（D.3）。新規アイデアはまず本文を `POST /ideas`（下書き可）で作って `idea_id` を得てから添付する（§1.10 が `POST /ideas/{id}/attachments` を要求＝id 先行）。SC-21 モーダルの「添付してから投稿」は、フロントが下書き作成→添付→公開の順に内部で呼ぶ（D.3 注記）。

## D.3 添付ファイル（§1.10・MinIO）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /ideas/{idea_id}/attachments` | アイデアに添付を追加（`multipart/form-data`） | パス: `idea_id`／`multipart`: `files[]`（1〜複数） | 追加された `attachments[]`（`id`/`original_name`/`size_bytes`/`mime_type`/`uploaded_by`/`uploaded_at`） |
| `DELETE /ideas/{idea_id}/attachments/{attachment_id}` | 添付を削除 | パス: `idea_id`,`attachment_id` | 204。DB 行削除＋MinIO オブジェクト削除（同一 UoW・失敗時はロールバック） |
| `GET /attachments/{attachment_id}/download` | 添付のダウンロード（権限検証後に署名 URL） | パス: `attachment_id` | 302（署名付き GET URL・短 TTL）または `{url}` JSON（§1.10） |

- **検証（サーバー・§1.10・§5.12）**: **1ファイル 20MB 上限**（超過は **413** 相当＝`validation_error`〔`errors[].code=too_large`〕）／**1 アイデアあたり 10 件まで**（既存件数＋今回件数が 10 を超えたら **422 `validation_error`**〔`errors[].code=too_many`〕）／**許可 MIME allowlist**（画像 `png`/`jpeg`/`gif`/`webp`・`pdf`・Office `docx`/`xlsx`/`pptx`・テキスト `txt`/`csv`/`md`・`zip`／それ以外は **422 `validation_error`**〔`errors[].code=mime_not_allowed`〕）。判定は**MIME スニッフィング＋拡張子**の両面（申告 `Content-Type` を信用しない）。
- **物理名ハッシュ化**（§1.10・§5.12）: `object_key` はサーバーが CSPRNG 由来のハッシュ名で採番（元名は保存しない・パストラバーサル/上書き対策）。`original_name` は表示・全文検索用に別カラム保持（PGroonga 索引・§6）。
- **アップロード権限**: 添付追加は**そのアイデアの編集権限と同じ**（投稿者本人 or `owner`/`quest_admin`）。ダウンロードは**パーティー所属**（閲覧できる＝落とせる）。範囲外は 404。
- **添付は編集扱いだが版は生まない**: 添付の追加/削除は本文フィールドの変更ではないため `idea_revisions` を増やさない（SC-22 §4.4c の「添付＝＋file/−file」は将来の版連動で扱う＝D.8）。MVP は添付操作を版に含めない。
- **削除凍結**: クエスト `completed` 後は添付の追加/削除も投稿系として 409（読み取り専用）。ダウンロードは可。

## D.4 版・変更履歴・差分（FR-34）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /ideas/{idea_id}/revisions` | 版タイムラインを取得（SC-22 更新履歴モーダル） | パス: `idea_id`／クエリ: `limit`/`cursor` | `data`=版の配列（新しい順・`revision`/`editor`〔アバター/氏名〕/`created_at`/`changed_fields[]`〔変更フィールド名〕/`memo?`）。`page_info` |
| `GET /ideas/{idea_id}/revisions/{revision}/diff` | ある版の差分を取得（前版と比較） | パス: `idea_id`,`revision`／クエリ: `from?`（比較元版・既定＝`revision-1`／`my_vote` 時点も指定可） | `fields`＝フィールドごとの差分（テキスト系＝語句差分の add/del セグメント／その他＝`{old, new}`）。サーバーが 2 版のスナップショットを比較して算出 |

- **版の生成（確定方針）**: **公開済みアイデアの `PATCH`（保存）ごとに 1 版**を `idea_revisions` に追加（`revision`＝`ideas.current_revision` を +1 した新値・`UNIQUE(idea_id, revision)`・§5.14）。`changes` に**その版時点の対象フィールド全値のスナップショット**（`title`/`value`/`body`/`time_limit`/`note`/`stakeholders`）を保存（§8-⑤ 決定）。差分は保存せず、`diff` エンドポイントで**表示時にサーバーが前版と比較して算出**（後から差分アルゴリズムを変えられる・監査に強い）。
- **通知発火（FR-34）**: 版追加ごとに**投票者＋フォロワー**へ `idea_updated` 通知を発火（ドメイン H・`notifications.type=idea_updated`・`ref_idea_revision_id` を持つ）。同一 UoW で `idea_revisions` 追加→通知作成→（購読中クライアントへ）Redis event（ドメイン L）を実施。**MVP は誤字修正も 1 版・通知あり**（軽微修正の抑制は D.8）。
- **投票の陳腐化との連動**（D.5）: `votes.voted_revision < ideas.current_revision` のとき「投票後に更新」＝SC-22 の差分導線。`diff?from=<voted_revision>` で「自分の投票時点からの差分」を返す。
- **版 0/初版の扱い**: 公開時点を `revision=1`（`ideas.current_revision` 既定 1・§5.10）とし、初版のスナップショットは公開処理時に 1 件記録（以後の編集が 2,3,...）。※初版記録の有無は実装細部＝D.8 に注記（下書き→公開の初版を `idea_revisions` に残すか）。

## D.5 投票（SC-22 右レール・賛成/反対/取消）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /ideas/{idea_id}/vote` | 投票を登録・切替（`vote` 権限） | パス: `idea_id`／ボディ: `type`（`approve\|oppose`） | 更新後の `vote`（`my_vote`＝`approve\|oppose`／`summary`〔賛成/反対数〕／`xp_awarded`〔初回のみ true〕） |
| `DELETE /ideas/{idea_id}/vote` | 投票を取消 | パス: `idea_id` | 204。`votes` 行を削除（**XP は戻さない**＝初回付与済み分は保持・§8-⑥） |

- **1 人 1 票・締切まで変更可**（§5.13・`UNIQUE(idea_id, user_id)`）。`POST` は**冪等な upsert**＝既存行があれば `type` を切替（賛成⇄反対）、無ければ作成。**`voted_revision` は毎回 `ideas.current_revision` で更新**（＝賛成/反対を押し直すと陳腐化フラグ〔`stale`〕が解消・SC-22 §4.5「押し直せば見直し完了」）。`voted_at` も更新。
- **XP+5 は各アイデア初回のみ**（確定・§7/§8-⑥）: 当該ユーザー×当該アイデアで**過去に投票 XP を記帳していなければ**のみ `activities`（`reason=vote`,`ref_type=ideas`,`ref_id=idea_id`）を 1 件作成＝XP+5。**賛成/反対の切替・取消・再投票では追加付与しない**（冪等判定＝`activities` の存在／取消後の再投票でも再付与しない）。**日次上限＝初回投票 5 回/日**（超過分は投票自体は成立するが XP 付与を抑止・サーバー判定・§8-⑥）。
- **投票可否（サーバー強制）**: `vote` 権限あり＋アイデアが `published`＋クエストが締切前/未凍結。締切後・`completed` は **409 `conflict`**（`invalid_state`）＝SC-22「締切後はボタン無効化＋理由」の権威判定。自分のアイデアにも投票可（README）。
- **匿名化は表示のみ制御**（§1.6・D.1）: 投票データ（`user_id`）は**常に内部保持**。`summary`（数）は全員に返す。`voters[]`（身元）は記名モードのみ／匿名＋管理者開示 ON のとき owner/quest_admin のみ。`my_vote` は常に本人へ返す。
- **陳腐化（`stale`）**: `GET /ideas/{id}` の `vote.stale`＝`my_vote` があり `voted_revision < current_revision` のとき true。フロントは「⚠ 投票後に更新／差分を見る（`revisions/{current}/diff?from={voted_revision}`）」を出す（SC-22 §4.5）。投票は有効のまま。

## D.6 フォロー（ウォッチ・FR-28）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /ideas/{idea_id}/follow` | アイデアをフォロー（ウォッチ登録） | パス: `idea_id` | 204（冪等＝既存なら何もしない・`UNIQUE(user_id, idea_id)`・§5.23） |
| `DELETE /ideas/{idea_id}/follow` | フォロー解除 | パス: `idea_id` | 204（冪等＝無ければ何もしない） |

- **フォロー可＝パーティー所属**（自分が参加中のクエストのアイデアのみ・§5.23）。範囲外は 404。権限バッジは不問（閲覧できる＝フォローできる）。
- **通知連動**（ドメイン H）: フォロー中アイデアの**コメント/評価/選定/更新**を通知（`follow_comment`/`follow_evaluation`/`follow_selection`/`idea_updated`・§3 `notification_type`）。ダッシュボード（ドメイン I）のフォローパネルの表示源。
- **凍結との関係**: フォローは通知購読であり投稿系ではないため、クエスト `completed` 後も切替可（読み取り専用の例外・D.0 注記）。

## D.7 セキュリティ対策マッピング（`doc/WEBアプリ開発時のセキュリティ対策一覧.md` 突合・§2認可/4入力/9API/11アップロード/18業務）

- **認可（2）**: 全エンドポイントでサーバー強制。**IDOR 対策**＝`idea_id`/`attachment_id` を書き換えても、パーティー所属・クエスト内権限・投稿者本人性を都度照合し範囲外は **404/403**。可視範囲＝パーティー内のみ（会社/グループ全体へ漏らさない）。下書きは投稿者本人のみ。**クロステナント遮断**＝`company_id` はセッション由来（§1.5）。
- **入力検証（4）**: `status`/`type`（vote）は enum 限定。`title`/`value`/`body`/`note` は長さ上限、`stakeholders` は件数上限＋正規化（`UNIQUE(idea_id, label)`）。**Mass Assignment 防止**＝`author_id`/`is_selected`/`current_revision`/`deleted_*`/監査列はクライアント入力を受けない（§1.4・Pydantic strict で想定外プロパティ拒否）。
- **API（9）**: 一覧はページング必須＋最大 `limit`（§1.8）。DB モデル直返し禁止（Pydantic DTO・§3.2）＝内部列（`deleted_*`/`object_key`）を露出しない。投票者身元は匿名化ポリシーを通した後のみ返す。
- **ファイルアップロード（11）**: サイズ/件数/MIME allowlist をサーバー検証（MIME スニッフィング＋拡張子）、**物理名ハッシュ化**（パストラバーサル・上書き・実行ファイル対策）、ダウンロードは**権限検証＋短 TTL 署名 URL**（直リンク流出耐性）。実行系 MIME は拒否。
- **業務ロジック（18）**: `POST /ideas`（作成/公開）・投票の二重送信は `Idempotency-Key`／冪等 upsert で防止。**公開は一方向・XP+50 はアイデアにつき 1 回**（多重付与防止）。**投票 XP+5 は各アイデア初回のみ・日次上限**（乱獲対策・§8-⑥）。**状態機械をサーバーで強制**（締切後/`completed` の書き込みを拒否）。パーティー除外後も過去の投票/コメント/アイデアは保持（改ざん/消失防止・監査・§5.8）。

## D.8 未確定（実装時に確定でも可）

- ~~**下書きアイデアの一覧露出**（`GET /quests/{id}/ideas?status=` に本人の `draft` を混ぜるか・ダッシュボード〔ドメイン I〕に寄せるか）~~ → **決定済み（2026-08-06）＝本人の `draft` を一覧に含める（両導線）**。D.0/D.1 参照。
- **軽微編集の版/通知抑制**（誤字修正を版に含めるか・`notify:false` 保存を設けるか＝MVP は全保存で版＋通知・SC-21/22 §9）。**添付の追加/削除を版に連動**させるか（SC-22 §4.4c の ＋file/−file 表示・MVP は版化しない）。
- **初版スナップショットの記録**（下書き→公開の初版〔`revision=1`〕を `idea_revisions` に残すか・差分の起点をどう扱うか・D.4）。
- **テキスト差分の粒度**（語句/文字単位・サーバー算出アルゴリズム・大きな本文のパフォーマンス・SC-22 §9）。
- **締切/クローズ後**の投票/コメント/評価の可否ルール確定（クエスト状態連動・C.5/SC-12/SC-22/SC-24/SC-25 と共通で明文化）。
- **投票陳腐化の通知強度**（アプリ内のみ／一覧にも未見直しを出すか・評価者にも「投票後更新」を示すか・SC-22 §9）。
- **添付の会社別上限**（当面は全社共通の既定＝20MB/10件・§8-⑦）／**インラインプレビュー**（画像サムネイル・SC-21/24 共通化）／**添付ダウンロードの監査ログ**強度。
- **利害関係者ラベルの会社内マスタ昇格**（自由入力の一元管理・候補昇格・カテゴリー〔C.7〕と共通課題）。
- **アイデアの下書き保持期間/自動保存**（FR-29・SC-21 §9）。
