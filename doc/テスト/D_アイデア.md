# テストパターン D. アイデア・添付・版・投票・フォロー

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/D_アイデア・添付・版・投票・フォロー.md`](../API設計/D_アイデア・添付・版・投票・フォロー.md)（D.1〜D.6）・[`../データモデル.md`](../データモデル.md) §5.10〜§5.14・§5.23。エラー code の網羅は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン D（アイデア）の縦スライス。**本スライスはまずデータ基盤（ORM/migration/repository）**＝`app/tenant/ideas/`。application/router（作成/編集/公開/添付/版/投票/フォローの API）は後続で本 md に追記する。
> 前提フィクスチャ＝seed 会社 ACME-01（会社DB あり）。repository テスト（`impl/backend/tests/ideas/test_repository.py`）は前提（グループ/クエスト/ユーザー）を ORM で直接 seed し teardown で物理削除。呼び出し側 Tx 相乗（自身では commit しない）。

## 1. repository（永続化プリミティブ・D.1〜D.6・§5.10〜§5.14・§5.23）

> 対象＝`app/tenant/ideas/repository.py`。アイデア CRUD・可視性（公開＋自分の下書き）・利害関係者置換・投票（1人1票・切替/取消・集計）・版（追加/一覧/取得・UNIQUE）・添付（追加/計数/削除）・フォロー（冪等）を検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| D-TC-001 | int | 作成と有効行取得・トゥームストーン除外 | クエスト/ユーザー seed | `create_idea`→`get_idea`／`deleted_at` 設定後再取得 | 有効行を返す（author_id 正・current_revision=1）／削除後は None | D.1／§5.10 |
| D-TC-002 | int | 一覧の可視性（公開＋自分の下書き） | 公開/自分の下書き/他人の下書きを seed | `list_ideas_for_quest` | 公開＋自分の下書きのみ。他人の下書きは除外 | D.1／§5.10 |
| D-TC-003 | int | status フィルタ（published のみ） | 公開＋自分の下書き | `list_ideas_for_quest(status=['published'])` | 公開のみ（自分の下書きも除外） | D.1 |
| D-TC-004 | int | カーソルページング（keyset） | 公開3件 | `list_ideas_for_quest`（limit=2→cursor） | `(created_at,id) DESC` で重複なく続きを返す | §1.8 |
| D-TC-005 | int | 利害関係者の置換セット | アイデア1件 | `replace_stakeholders` を2回 | 後の配列で全置換 | D.2／§5.11 |
| D-TC-006 | int | 投票 1人1票・初回/切替 | アイデア1件 | `upsert_vote`（approve→oppose） | 初回 created=True／切替 created=False・type 更新・行は1つ | D.5／§5.13 |
| D-TC-007 | int | 賛成/反対の集計 | 2名が approve/oppose | `count_votes` | `{approve:1, oppose:1}` | D.5 |
| D-TC-008 | int | 投票取消の冪等 | 投票済み | `remove_vote` を2回 | 1回目 True／2回目 False（XP は戻さない） | D.5／§8-⑥ |
| D-TC-009 | int | 版の追加/一覧/取得・UNIQUE | アイデア1件 | `add_revision`×2→`list`/`get` | 新しい順に返る・changes スナップショット取得可 | D.4／§5.14 |
| D-TC-010 | int | 添付の追加/計数/削除 | アイデア1件 | `add_attachment`→`count`→`remove` | count 1→0（size CHECK 満たす） | D.3／§5.12 |
| D-TC-011 | int | フォローの冪等 | アイデア1件 | `add_follow`×2→`remove_follow` | 重複行を作らない・is_following True→False | D.6／§5.23 |
| D-TC-012 | int | フォロー中アイデア集合 | 1件フォロー | `list_followed_idea_ids` | フォロー中のみ含む | D.6 |

## 2. 作成・一覧・詳細・編集・公開・削除 API（SC-21/12/22・D.1/D.2）

> 対象＝`app/tenant/ideas/application.py`・`router.py`（`POST/GET/PATCH/DELETE /quests/{quest_id}/ideas`・`/ideas/{id}`・`/ideas/{id}/publish`）。門番＝クエストのパーティー所属（C.0）／作成は `idea_create` 権限／編集・削除・公開は投稿者本人 or `owner`/`quest_admin`。公開処理（chat_groups 作成・投稿 XP+50・idea_updated 通知）は E/G/H 実装まで no-op フック。前提＝seed 一般ユーザー（ACME-01）でログインし会社DB にクエスト＋自分のパーティー参加を seed。変更系は Origin/CSRF。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| D-TC-101 | api | 下書き作成 | パーティー参加（idea_create）| `POST /quests/{id}/ideas`（draft） | 201・status draft・author=本人・my_state draft | D.2 |
| D-TC-102 | api | 即公開作成 | 同上 | `POST /quests/{id}/ideas`（published・必須充足） | 201・status published（公開処理は no-op フック） | D.2 |
| D-TC-103 | api | 作成は idea_create 権限必須 | パーティー参加だが idea_create なし | `POST .../ideas` | 403 | D.2 |
| D-TC-104 | api | 即公開は strict 検証 | パーティー参加 | `POST .../ideas`（published・body 空） | 422（body） | D.2／validate_publishable |
| D-TC-105 | api | 一覧の可視性 | 公開/自分の下書き/他人の下書きを seed | `GET /quests/{id}/ideas` | 公開＋自分の下書きのみ・他人の下書きは除外 | D.1 (A)(B) |
| D-TC-106 | api | 一覧はパーティー門番 | 非パーティーのクエスト | `GET /quests/{id}/ideas` | 404（存在秘匿・C.0） | D.1 門番 |
| D-TC-150 | api | 一覧カードの評価集計（F・SC-12 評価列） | published アイデア2（1つに submitted 評価 val=4 party）＋未評価1 | `GET /quests/{id}/ideas` | 評価済カード＝`evaluation.state="done"`・`overall_avg=4.0`／未評価＝`state="pending"`・`overall_avg=null`。数値は可視評価のみ（F.1） | D.1／F.1／SC-12 §69 |
| D-TC-151 | api | 一覧カードのコメント数（E・SC-12 💬） | published アイデアの chat_group に非削除2＋削除1 | `GET /quests/{id}/ideas` | 当該カード `comment_count=2`（削除トゥームストーンは除外・E.1）。chat 無しは 0 | D.1／E.1／SC-12 §69 |
| D-TC-160 | api | 公開で投稿 XP+50（G 結線・FR-01） | 下書きアイデア | `POST /ideas/{id}/publish`（or 作成 status=published） | 投稿者に `activities(kind=xp_gain,reason=idea_post,ref_type=ideas,ref_id=idea,quest_id)` 1件・+50・`users.xp` 反映。二重公開は 409 で加算なし | D.2／§8-⑥（投稿=50）|
| D-TC-161 | api | 初回投票で XP+5（G 結線・FR-23） | 参加クエストの公開アイデア | `POST /ideas/{id}/vote`（approve） | 投票者に `reason=vote,ref_type=ideas,ref_id=idea` 1件・+5・応答 `xp_awarded=true` | D.5／§8-⑥（投票=5・初回のみ）|
| D-TC-162 | int | 投票 XP は各アイデア初回のみ＋日次上限5 | 同一アイデアで賛成→反対→取消→再投票／別アイデア6件に初回投票 | `_award_vote_xp` 経由 | 同一アイデアは切替/取消/再投票で追加なし（`xp_awarded=false`・冪等 ref）・別アイデアは初回のみ付与し**6件目は日次上限で付与なし**（最大25XP/日） | §8-⑥（初回のみ・上限5/日）|
| D-TC-163 | api | 公開応答に `xp_delta` を載せる（獲得フィードバック・#8） | 下書きアイデア | `POST /ideas/{id}/publish`／`GET /ideas/{id}` | 初回公開の応答は `xp_delta=50`（実付与額）・参照系（取得）は `xp_delta=0`（アクションでないため）。金額の正はサーバー（idea_post=+50） | D.2／§8-⑥／#8 |
| D-TC-164 | api | 投票応答に `xp_delta` を載せる（獲得フィードバック・#8） | 参加クエストの公開アイデア | `POST /ideas/{id}/vote`（初回→切替） | 初回は `xp_delta=5`・`xp_awarded=true`／切替（2回目）は `xp_delta=0`・`xp_awarded=false`（`xp_awarded` と `xp_delta>0` が同値） | D.5／§8-⑥／#8 |
| D-TC-107 | api | 詳細（自分の下書き/公開） | 自分の下書き／参加中の公開 | `GET /ideas/{id}` | 200・本体＋vote/following/my_permissions | D.1 |
| D-TC-108 | api | 詳細の可視性（他人下書き/非メンバー） | 他人の下書き／非パーティー | `GET /ideas/{id}` | 404 | D.1 |
| D-TC-109 | api | 編集＝下書きは版なし/公開は版記録 | 下書き／公開アイデア（公開時に初版 revision=1 記録済み・D-TC-142）| `PATCH /ideas/{id}`（title） | draft=200 版増えない／published=200 current_revision=2・版2件（初版1＋編集2） | D.2/D.4 |
| D-TC-143 | api | 公開アイデアの並行 PATCH は楽観ロックで 409 `edit_conflict`（500 にしない・D.2 line67） | 公開アイデア（`current_revision=1`）で、別編集者が既に `revision=2` を作成済み（自分の base は stale） | `PATCH /ideas/{id}`（title） | `next_rev=2` の INSERT が `UNIQUE(idea_id,revision)` 違反→**`409` `code=edit_conflict`**（`IntegrityError` を捕捉して翻訳・**500 にしない**）。クライアントは最新再取得へ誘導 | D.2（楽観ロック・方針A） |
| D-TC-144 | api | 投票後に版が進むと `vote.stale=true`（投票見直し導線・D.1/D.5） | 公開アイデアに投票（`voted_revision=1`）→ 公開中編集で `current_revision=2` | `GET /ideas/{id}`（投票直後／編集後） | 投票直後＝`vote.my_vote=approve`・**`vote.stale=false`**（同版）／編集後＝`vote.my_vote=approve`・**`vote.stale=true`**（`voted_revision < current_revision`）。押し直しで解消 | D.1／D.5 |
| D-TC-145 | api | 下書きの公開は投稿者のみ＝代理公開は不可（他人 owner でも 404） | owner（seed・投稿者でない）が他ユーザー（Other）の下書きを `POST publish` | 応答＋`activities` | **404**（下書きは本人のみ可視・`_authorize_edit_idea`）＝公開が起きず `idea_post` は誰にも付与されない。ゆえに投稿 XP+50 の受給者は常に投稿者本人（監査 M3「公開者に付く」は本ガードにより発生しない誤検知・将来この経路を開くなら本テスト赤化で再検討を促す） | D.2／§8-⑥ |
| D-TC-110 | api | 公開中の編集は strict | 公開アイデア | `PATCH /ideas/{id}`（body 空） | 422 | D.2 |
| D-TC-111 | api | 完了後の編集凍結 | completed クエストのアイデア | `PATCH /ideas/{id}` | 409（invalid_state） | D.0/C.5 |
| D-TC-112 | api | 下書き公開 | 自分の下書き（充足） | `POST /ideas/{id}/publish` | 200・published | D.2 |
| D-TC-113 | api | 公開の状態機械 | 公開済みアイデア | `POST /ideas/{id}/publish` | 409（invalid_state） | D.2 |
| D-TC-114 | api | 編集/公開の認可 | 他人の公開アイデア（自分は一般メンバー）| `PATCH`/`publish` | 403 | D.2 |
| D-TC-115 | api | 論理削除 | 自分のアイデア | `DELETE /ideas/{id}` | 204・以後詳細 404 | D.2／§5.10 |
| D-TC-116 | api | 削除の認可 | 他人のアイデア（自分は一般メンバー）| `DELETE /ideas/{id}` | 403 | D.2 |
| D-TC-117 | api | 変更系の CSRF 必須 | ログイン済・CSRF なし | `POST .../ideas` | 403 csrf_failed | A.0 |
| D-TC-118 | api | 未認証遮断 | セッションなし | `POST .../ideas` | 401 | require_me |
| D-TC-119 | api | 投票登録（賛成） | vote 権限・公開アイデア | `POST /ideas/{id}/vote`（approve） | 200・my_vote=approve・summary.approve=1 | D.5 |
| D-TC-120 | api | 投票切替（賛成→反対・1人1票） | 投票済み（approve） | `POST /ideas/{id}/vote`（oppose） | 200・my_vote=oppose・summary=approve0/oppose1（行は1つ） | D.5／§5.13 |
| D-TC-121 | api | 投票取消の冪等 | 投票済み | `DELETE /ideas/{id}/vote` ×2 | 1回目204／2回目204（XP は戻さない） | D.5／§8-⑥ |
| D-TC-122 | api | 投票は vote 権限必須 | パーティー参加だが vote なし | `POST /ideas/{id}/vote` | 403 | D.5 |
| D-TC-123 | api | 下書きへの投票不可 | 自分の下書き | `POST /ideas/{id}/vote` | 409（invalid_state） | D.5 |
| D-TC-124 | api | 完了クエストの投票凍結 | completed クエストの公開アイデア | `POST /ideas/{id}/vote` | 409（invalid_state） | D.5／C.5 |
| D-TC-125 | api | 投票のパーティー門番 | 非パーティーのアイデア | `POST /ideas/{id}/vote` | 404（存在秘匿） | D.5／C.0 |
| D-TC-126 | api | フォローの冪等 | パーティー員・公開アイデア | `POST /ideas/{id}/follow` ×2 | 204／204（重複行なし・is_following True） | D.6／§5.23 |
| D-TC-127 | api | フォロー解除の冪等 | フォロー済み | `DELETE /ideas/{id}/follow` ×2 | 204／204（is_following False） | D.6 |
| D-TC-128 | api | 完了後は新規フォロー不可・解除は可 | completed クエストのアイデア | `POST follow`／`DELETE follow` | POST=409（invalid_state）／DELETE=204 | D.6／C.5 |
| D-TC-129 | api | フォローのパーティー門番 | 非パーティーのアイデア | `POST /ideas/{id}/follow` | 404（存在秘匿） | D.6／C.0 |
| D-TC-130 | api | 詳細に quest 参照が入る（SC-22 導線用） | published アイデア（categories 付きクエスト） | `GET /ideas/{id}` | `quest.id`＝当該クエスト・`quest.title`/`quest.status`/`quest.categories[]`/`quest.deadline` が返る | D.1／SC-22 |
| D-TC-131 | api | 添付追加（複数）→ 詳細に反映 | published アイデア・Fake storage | `POST /ideas/{id}/attachments`（png+pdf の2件） | 201・`attachments` 2件（`id`/`original_name`/`size_bytes`/`mime_type`/`uploaded_by`/`uploaded_at`）・`GET /ideas/{id}` の `attachments` も2件 | D.3／§1.10 |
| D-TC-132 | api | 添付は1アイデア10件まで | 既に9件添付 | `POST attachments`（2件） | 422 `validation_error`（`errors[].code=too_many`・既存＋今回で超過） | D.3／§5.12 |
| D-TC-133 | api | 不許可 MIME は拒否 | published アイデア | `POST attachments`（`evil.exe`） | 422 `validation_error`（`mime_not_allowed`・拡張子/申告 Content-Type を信用しない） | D.3／§1.10 |
| D-TC-134 | api | 添付削除＝DB＋MinIO 削除 | 添付1件 | `DELETE /ideas/{id}/attachments/{aid}` | 204・`GET /ideas/{id}` の `attachments` から消える・storage からも remove | D.3 |
| D-TC-135 | api | 添付追加は編集権限（本人/owner/quest_admin） | 他人の published（自分は vote のみ） | `POST attachments` | 403 | D.3 |
| D-TC-136 | api | DL はパーティー所属→短TTL 署名URL | 添付1件 | `GET /attachments/{aid}/download` | 200・`{url}`（署名URL・生パス非露出） | D.3／§1.10 |
| D-TC-137 | api | 完了クエストは添付追加を凍結 | completed クエストの published アイデア | `POST attachments` | 409 `conflict`（invalid_state） | D.3／C.5 |
| D-TC-142 | api | 公開処理で初版 revision=1 を記録（通知なし・D.4 line104） | 下書きを `POST publish`／`POST ideas`（published） | `GET /ideas/{id}/revisions` | 初版 revision=1 が1件・`current_revision=1`・`changed_fields=[]`（初版）・通知は発火しない | D.4／§5.14 |
| D-TC-138 | api | 版タイムライン取得（新しい順） | published を2回編集（初版1＋編集2/3）| `GET /ideas/{id}/revisions` | `data` が `revision` 降順〔3,2,1〕・各行に `editor`〔氏名〕/`created_at`/`changed_fields[]`〔前版比の変更フィールド・初版は空〕/`memo?`・`page_info` | D.4 |
| D-TC-139 | api | 版タイムラインの門番/可視性 | 非パーティーのアイデア／他人の下書き | `GET /ideas/{id}/revisions` | 404（存在秘匿・下書きは本人のみ・C.0） | D.4／C.0 |
| D-TC-140 | api | 差分取得（既定＝前版比較） | published を編集（本文/価値/タイムリミット変更）| `GET /ideas/{id}/revisions/{rev}/diff` | `from_revision=rev-1`・`to_revision=rev`・`fields` にテキスト系（title/value/body/note）は add/del セグメント・その他（time_limit/stakeholders）は `{old,new}`。存在しない版は 404 | D.4 |
| D-TC-141 | api | 差分の from 明示（投票時点からの差分）| revision=3 のアイデア | `GET .../revisions/3/diff?from=1` | `from_revision=1`・`to_revision=3`・初版からの累積差分。`from>to`/範囲外は 422/404 | D.4／D.5 |

## 3. 画面 e2e（SC-21 アイデア登録・編集フォーム・D.2／§4.7／§13）

> 対象＝フロント接続済み SC-21（`impl/frontend/src/features/ideas/components/IdeaForm.tsx`・登録フルページ `/(app)/quests/[questId]/ideas/new`・編集モーダル `IdeaDetailView`）。e2e は**契約の最終確認**（画面↔API）に限定し、分岐は §2 の api レベルで担保（テスト規約 §4・§5.1 line 112＝接続後は red-green 適用）。前提＝dev seed 一般ユーザー ACME-01「テスト 太郎」（デモグループ所属）。下地クエスト/アイデアは API で作成し teardown で論理削除。変更系は Cookie セッション＋X-CSRF-Token。
> **§4.7 の 3 チャネル（上部サマリ scroll＋足元ヒント＋sticky スナックバー）は SC-21 では主経路で到達不能**＝主ボタン「投稿する／変更を保存」が `disabled={!canSave}`（3 必須が揃うまで無効）で client `validate()` と同条件のため client 検証エラーが出ない。下書き保存は検証スキップ。3 チャネルが発火するのはサーバエラー（完了クエスト編集の 409・公開状態機械の 409 等）経由のみで、これは **D-TC-216**（完了クエストのアイデア編集で 409 を seed）で担保する。本節の前段ガード（ボタン活性・blur インライン）は D-TC-204 で担保する。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| D-TC-201 | e2e | 即公開作成→一覧反映 | ログイン・API で recruiting クエスト作成 | `/quests/{id}/ideas/new` で件名/価値/本文を入力→「投稿する」 | 成功トースト「アイデアを投稿しました」・`/quests/{id}` へ戻る・`GET /quests/{id}/ideas` に当該が status=published で出る | D.2／SC-21／§13 |
| D-TC-202 | e2e | 下書き保存→本人に表示 | 同上 | 件名/価値/本文を入力→「下書き保存」 | トースト「下書きを保存しました」・`GET /quests/{id}/ideas` に status=draft・author=本人で出る（可視性＝本人） | D.2／D.1／SC-21 |
| D-TC-203 | e2e | 編集で件名更新→反映 | API で published アイデア作成 | `/ideas/{id}`→「編集」→件名変更→「変更を保存」 | トースト「変更を保存しました」・`GET /ideas/{id}` の title が更新値 | D.2／D.4／SC-22 |
| D-TC-204 | e2e | 必須ボタン活性ガード＋blur インライン検証（§4.7 前段） | 登録フルページ | 3 必須空／件名を空 blur | 「投稿する」は初期 disabled（3 必須充足で活性）・件名 blur で `aria-invalid`＋インライン「件名は必須です。」表示 | §4.7／SC-21 |
| D-TC-205 | e2e | SC-12 アイデアタブに一覧が実データで出る | API で recruiting クエスト＋published アイデア作成 | `/quests/{id}` のアイデアタブを表示 | タブ件数＝1・当該アイデアの件名が一覧に出る（`listIdeas`・公開可視） | D.1／SC-12 |
| D-TC-206 | e2e | 投稿後に IDEAS_CHANGED で一覧へ反映（跨ルート） | 空クエスト・詳細表示 | 「＋ アイデアを追加」→モーダルで投稿→戻る | 初期は空表示（「まだアイデアがありません」）→投稿後リロードせずタブ一覧に出現（`IDEAS_CHANGED_EVENT` 購読） | D.1/D.2／SC-12 |
| D-TC-207 | e2e | SC-22 詳細が getIdea の実データを描画 | API で published アイデア作成（value/body/stakeholders 指定） | `/ideas/{id}` を表示 | 件名/価値/本文/利害関係者/ステータスバッジ（公開）/作成者が実データで出る。投票/フォローのボタンが活性（挙動は D-TC-209〜212） | D.1／SC-22 |
| D-TC-208 | e2e | 登録モーダルは初期表示で誤検証しない（フォーカス制御） | クエスト詳細で「＋ アイデアを追加」（URL モーダル） | モーダルを開いた直後（無操作） | 「件名は必須です。」が出ない・`aria-invalid` なし。件名→価値へタブ移動（blur）した時のみ検証が出る（§4.7 blur 維持） | §4.7／SC-21 |
| D-TC-209 | e2e | SC-22 投票（賛成）→集計反映・ハイライト | API で recruiting クエスト＋published アイデア作成（vote は新規パーティーの既定権限） | `/ideas/{id}` で「▲ 賛成」クリック | 賛成 1・「▲ 賛成」が `is-on`（`aria-pressed=true`）・`GET /ideas/{id}` の `vote.my_vote=approve`（`voteIdea`・楽観更新） | D.5／SC-22 §4.5 |
| D-TC-210 | e2e | SC-22 投票切替（賛成→反対・1人1票） | 賛成投票済み | 「▼ 反対」クリック | 反対 1・賛成 0・「▼ 反対」が `is-on`／「▲ 賛成」off（行は1つ・`my_vote=oppose`） | D.5／§5.13／SC-22 §4.5 |
| D-TC-211 | e2e | SC-22 投票取消（同ボタン再クリック） | 賛成投票済み | 「▲ 賛成」を再クリック | 賛成 0・どちらも未ハイライト・`GET` の `vote.my_vote=null`（`removeVote`） | D.5／SC-22 §4.5 |
| D-TC-212 | e2e | SC-22 フォロー→解除（トグル） | published アイデア（パーティー員） | 「☆ フォロー」→「★ フォロー中」→再クリック | ON: `aria-pressed=true`＋`GET` `following=true`（`followIdea`）／OFF: false（`unfollowIdea`・楽観更新） | D.6／SC-22 §4.5 |
| D-TC-213 | e2e | SC-22「クエストへ戻る」が実導線＋カテゴリーバッジ | published アイデア（categories 付きクエスト） | `/ideas/{id}` を表示 | 「← クエストへ戻る」の href が `/quests/{quest_id}`（一覧固定でない）・ヘッダーにクエストのカテゴリーバッジ表示（`quest.categories`） | D.1／SC-22 |
| D-TC-214 | e2e | SC-22 完了クエストは投票/新規フォローを事前無効化 | recruiting→…→completed に遷移した published アイデア | `/ideas/{id}` を表示 | 「▲ 賛成」「▼ 反対」が `disabled`（凍結理由 title）・「☆ フォロー」が `disabled`（`quest.status=completed` 事前判定・サーバー 409 も権威） | D.5/D.6／SC-22 §4.5／C.5 |
| D-TC-215 | e2e | SC-21 で添付して投稿→SC-22 に出る＋DL | 登録フォームで件名/価値/本文＋ファイル添付→投稿 | `/quests/{id}/ideas/new` で添付付き投稿→`/ideas/{id}` | SC-22 の関連資料に添付名が実データで出る（`uploadAttachments`）・ダウンロードボタンが活性・`GET /attachments/{aid}/download` が `{url}` を返す | D.3／SC-21/SC-22 |
| D-TC-216 | e2e | SC-21 サーバエラー（完了クエスト編集 409）で §4.7 の 3 チャネルが発火 | API で recruiting クエスト＋published アイデアを作成し `completed` へ遷移（`/quests/{id}/transition`）| `/ideas/{id}`→「編集」→件名を変更→「変更を保存」（PATCH が 409 invalid_state）| `mapServerErrors`→conflict で ① 上部サマリ `.form-summary` に「現在の状態では実行できません。」・② 足元ヒント `.form-footer-error`「⚠ 入力エラーがあります。…」・③ エラースナックバー `.snackbar--error`（`duration:0`＝`.snackbar__timer` 無し＝自動消滅しない）の 3 チャネルが出る | §4.7／D.0/C.5／SC-21 |
| D-TC-217 | e2e | SC-22 更新履歴モーダルが実データ（版タイムライン＋差分） | API で published アイデア作成→本文/価値を PATCH で1回編集（版2に） | `/ideas/{id}`→「版 N（履歴）」クリック→更新履歴モーダル | デモ文言でなく実データ＝版が新しい順（v2/v1〔初版〕）・v1 に「初版」表記・v2 の変更フィールドと差分（`.diff-add`/`.diff-del` セグメント）が `getRevisions`/`getRevisionDiff` で描画される | D.4／SC-22 |
| D-TC-218 | e2e | SC-21 編集モードで既存添付の一覧＋削除 | API で published アイデア作成＋添付1件アップロード | `/ideas/{id}`→「編集」→保存済み添付が一覧に出る→× →確認ダイアログ「削除する」 | 編集フォームに保存済み添付名が出る（`getIdea.attachments`）・× で確認ダイアログ→確定で即時サーバー削除（`deleteAttachment`）・一覧から消え成功トースト・`GET /ideas/{id}` の `attachments` が空（版は増えない） | D.3／SC-21 |

> **削除 UI の置き場所（SC-22 §4.3 準拠）**＝SC-22 の関連資料は「一覧＋ダウンロード」のみ（削除ボタンは無い・0件なら非表示）。添付の**削除は SC-21 フォームの添付チップ（×）**で行い、EP は `DELETE /ideas/{id}/attachments/{aid}`（api の D-TC-134 で担保）。SC-21 編集モードでの**既存添付の一覧/削除 UI は実装済み（D-TC-218）**＝`getIdea.attachments` を読み込み `.attach` 行で表示し、× は確認ダイアログ→即時サーバー削除（本文編集と独立・版を生まない・§D.3）。投稿前の未アップロード添付（新規追加分）の × は従来どおりクライアント除去。

> **サーバー権威の可否判定（締切後/権限なし）**: 可否は**サーバー判定を権威**とし、`POST vote` の 409（`invalid_state`＝締切後/`completed`/下書き）・403（vote 権限なし）・`POST follow` の 409（completed 後の新規）を受けたら**楽観更新をロールバック＋理由をトースト表示**する。**事前無効化（disabled）＝実装済み**＝`IdeaDetailDTO` は `quest.status`/`quest.deadline`（D-TC-130）を返すため、`completed`（凍結）に加え**締切後（`quest.deadline < 今日`）も投票ボタンを事前無効化**（`isVotingClosed`＝サーバー `_guard_votable` と一致・D-TC-219）。フォロー/選定は `completed` のみ事前無効化（締切は対象外）。分岐網羅は §2 の api（D-TC-122〜125/128〜129）で担保。

## 4. フロント単体（vitest・純ロジック・node）

> 対象＝`impl/frontend/src/features/ideas/voting.ts`（`isVotingClosed`＝投票の事前無効化判定・SC-22）。DOM 非依存の純ロジックのみ vitest（node）で担保し、UI 結線（ボタン `disabled`・バッジ/文言）は tsc＋手動/e2e で確認。**トレーサビリティ検査対象外**（`src/**/*.test.ts` は非走査）＝本 md で追跡。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| D-TC-219 | unit | 投票の事前無効化がサーバー `_guard_votable` と一致 | `quest.status`/`quest.deadline`・今日 | `isVotingClosed(quest, todayISO)` | 締切前/締切当日＝可（`closed:false`）／締切翌日以降＝`deadline` で不可／`completed`＝`completed` で不可（優先）／`deadline` 未設定＝締切無効化なし | D.5／SC-22 |
