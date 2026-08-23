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
| D-TC-107 | api | 詳細（自分の下書き/公開） | 自分の下書き／参加中の公開 | `GET /ideas/{id}` | 200・本体＋vote/following/my_permissions | D.1 |
| D-TC-108 | api | 詳細の可視性（他人下書き/非メンバー） | 他人の下書き／非パーティー | `GET /ideas/{id}` | 404 | D.1 |
| D-TC-109 | api | 編集＝下書きは版なし/公開は版記録 | 下書き／公開アイデア | `PATCH /ideas/{id}`（title） | draft=200 版増えない／published=200 current_revision++・版1件 | D.2/D.4 |
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

## 3. 画面 e2e（SC-21 アイデア登録・編集フォーム・D.2／§4.7／§13）

> 対象＝フロント接続済み SC-21（`impl/frontend/src/features/ideas/components/IdeaForm.tsx`・登録フルページ `/(app)/quests/[questId]/ideas/new`・編集モーダル `IdeaDetailView`）。e2e は**契約の最終確認**（画面↔API）に限定し、分岐は §2 の api レベルで担保（テスト規約 §4・§5.1 line 112＝接続後は red-green 適用）。前提＝dev seed 一般ユーザー ACME-01「テスト 太郎」（デモグループ所属）。下地クエスト/アイデアは API で作成し teardown で論理削除。変更系は Cookie セッション＋X-CSRF-Token。
> **§4.7 の 3 チャネル（上部サマリ scroll＋足元ヒント＋sticky スナックバー）は SC-21 では主経路で到達不能**＝主ボタン「投稿する／変更を保存」が `disabled={!canSave}`（3 必須が揃うまで無効）で client `validate()` と同条件のため client 検証エラーが出ない。下書き保存は検証スキップ。3 チャネルが発火するのはサーバエラー（完了クエスト編集の 409・公開状態機械の 409 等）経由のみで、これは後続 TC（サーバエラー seed が必要）に回す。本節はその**前段ガード**（ボタン活性・blur インライン）を D-TC-204 で担保する。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| D-TC-201 | e2e | 即公開作成→一覧反映 | ログイン・API で recruiting クエスト作成 | `/quests/{id}/ideas/new` で件名/価値/本文を入力→「投稿する」 | 成功トースト「アイデアを投稿しました」・`/quests/{id}` へ戻る・`GET /quests/{id}/ideas` に当該が status=published で出る | D.2／SC-21／§13 |
| D-TC-202 | e2e | 下書き保存→本人に表示 | 同上 | 件名/価値/本文を入力→「下書き保存」 | トースト「下書きを保存しました」・`GET /quests/{id}/ideas` に status=draft・author=本人で出る（可視性＝本人） | D.2／D.1／SC-21 |
| D-TC-203 | e2e | 編集で件名更新→反映 | API で published アイデア作成 | `/ideas/{id}`→「編集」→件名変更→「変更を保存」 | トースト「変更を保存しました」・`GET /ideas/{id}` の title が更新値 | D.2／D.4／SC-22 |
| D-TC-204 | e2e | 必須ボタン活性ガード＋blur インライン検証（§4.7 前段） | 登録フルページ | 3 必須空／件名を空 blur | 「投稿する」は初期 disabled（3 必須充足で活性）・件名 blur で `aria-invalid`＋インライン「件名は必須です。」表示 | §4.7／SC-21 |
| D-TC-205 | e2e | SC-12 アイデアタブに一覧が実データで出る | API で recruiting クエスト＋published アイデア作成 | `/quests/{id}` のアイデアタブを表示 | タブ件数＝1・当該アイデアの件名が一覧に出る（`listIdeas`・公開可視） | D.1／SC-12 |
| D-TC-206 | e2e | 投稿後に IDEAS_CHANGED で一覧へ反映（跨ルート） | 空クエスト・詳細表示 | 「＋ アイデアを追加」→モーダルで投稿→戻る | 初期は空表示（「まだアイデアがありません」）→投稿後リロードせずタブ一覧に出現（`IDEAS_CHANGED_EVENT` 購読） | D.1/D.2／SC-12 |
| D-TC-207 | e2e | SC-22 詳細が getIdea の実データを描画 | API で published アイデア作成（value/body/stakeholders 指定） | `/ideas/{id}` を表示 | 件名/価値/本文/利害関係者/ステータスバッジ（公開）/作成者が実データで出る。投票ボタンは無効（準備中）＝表示のみ | D.1／SC-22 |
| D-TC-208 | e2e | 登録モーダルは初期表示で誤検証しない（フォーカス制御） | クエスト詳細で「＋ アイデアを追加」（URL モーダル） | モーダルを開いた直後（無操作） | 「件名は必須です。」が出ない・`aria-invalid` なし。件名→価値へタブ移動（blur）した時のみ検証が出る（§4.7 blur 維持） | §4.7／SC-21 |
