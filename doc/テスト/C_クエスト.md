# テストパターン C. クエスト・パーティー・権限（SC-10/11/12）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/C_クエスト・パーティー・権限.md`](../API設計/C_クエスト・パーティー・権限.md)（C.1〜C.5）・[`../データモデル.md`](../データモデル.md) §5.6〜§5.9・[`../画面設計/screens/`](../画面設計/screens/)（SC-10/11/12）。エラー code の網羅は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン C（クエスト管理）の縦スライス。repository（永続化）＋ application/router（API）を TC-ID で結ぶ。**本 md は実装済みテスト（`impl/backend/tests/quests/`・`impl/frontend/e2e/sc-11*/sc-12*`）の逆追記（retro）を含む**＝2026-08-22 に規約遵守のため整備。以後は本 md 先行（§5.2）で運用する。
> 前提フィクスチャ＝seed 会社 ACME-01（会社DB あり）／一般ユーザー `user@acme.example`。repository テストは前提（グループ/ユーザー/クエスト）を ORM で直接 seed し teardown で物理削除。API テストは seed 一般ユーザーでログインし会社DB に直接 seed。

## 1. repository（永続化プリミティブ・C.1〜C.3・§5.6〜§5.9）

> 対象＝`app/tenant/quests/repository.py`。可視性（グループ×パーティー門番）・カテゴリ置換・パーティー（既定権限/トゥームストーン再利用/権限置換/件数）を検証。呼び出し側 Tx 相乗（自身では commit しない）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-001 | int | 作成と有効行取得・トゥームストーン除外 | グループ/ユーザー seed | `create_quest`→`get_quest`／`deleted_at` 設定後再取得 | 有効行を返す（owner_id 正）／削除後は None | C.1／§5.6 |
| C-TC-002 | int | 一覧の参照制限（公開＋自分の下書き） | 可視グループの公開/自分の下書き/他人の下書き/範囲外を seed | `list_quests_for_user` | 公開＋自分の下書きのみ。他人の下書き/範囲外は除外 | C.1 (A)(B)／FR-15 |
| C-TC-002b | int | パーティー門番（C.0）の強制 | 可視グループの公開だが自分は非パーティー | `list_quests_for_user` | 非パーティーのクエストは除外 | C.0／C.1 |
| C-TC-003 | int | カーソルページング（keyset） | 公開クエスト3件 | `list_quests_for_user`（limit=2→cursor） | `(created_at,id) DESC` で重複なく続きを返す | §1.8 |
| C-TC-004 | int | カテゴリ置換セット | クエスト1件 | `replace_categories` を2回 | 後の配列で全置換（重複なし） | C.2／§5.7 |
| C-TC-005 | int | 既定権限の自動付与 | クエスト1件 | `add_member`（権限省略） | vote+idea_create+comment を付与 | C.3／§5.9 |
| C-TC-006 | int | 再追加はトゥームストーン再利用 | 追加→除外済みメンバー | `add_member` 再実行 | 同一 id・`removed_at`→NULL・権限再付与・行は増えない | C.3／§5.8 |
| C-TC-007 | int | 除外で権限行も失う | 有効メンバー | `remove_member` | `removed_at` 設定＋権限行削除（門番/候補から外れる） | C.3／§5.8 |
| C-TC-008 | int | 権限セット置換 | 既定3権限のメンバー | `set_member_permissions` | 送った集合で置換（追加/削除の差分適用） | C.3／§5.9 |
| C-TC-009 | int | 有効パーティー人数の計上 | 追加2名→1名除外 | `count_active_members` | 有効参加のみ計上（除外者は含めない） | C.1 |
| C-TC-010 | int | 集計列ソート（`-idea_count`）＋keyset の安定 | 公開アイデア 0/1/2 件のクエスト3件 | `list_quests_for_user(sort=[("idea_count",True)])`（limit=50／limit=2→cursor） | idea_count 降順 [2,1,0]・cursor 続きも重複なく降順継続 | C.1／§1.8.1 |
| C-TC-011 | int | `deadline` 昇順は NULLS LAST | 締切 d1<d2 と締切なし の3件 | `list_quests_for_user(sort=[("deadline",False)])` | [d1,d2,NULL] の順（締切なしは末尾） | C.1／§1.8.1 |
| C-TC-012 | int | 複数キーソート＋二次キーの tiebreak | member=2 の1件・member=1 の2件（作成順） | `list_quests_for_user(sort=[("member_count",True),("created_at",True)])` | 先頭=member2／同数は created_at 降順で新しい方が先 | C.1／§1.8.1 |

## 2. 一覧 API（SC-10・C.1/C.4）

> 対象＝`GET /quests`・`GET /quest-groups`（`app/tenant/quests/router.py`・`application.py`）。参照制限のサーバー強制・DTO 形状・カーソル・入力検証・認可を検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-101 | api | 参加中クエストが DTO 形状で返る | seed user が owner=パーティー員の公開クエスト | `GET /quests` | 対象カードが返り status/member_count/idea_count/categories/owner/quest_group/my_state・page_info 正 | C.1／SC-10 |
| C-TC-102 | api | パーティー門番の API 強制 | 他人だけがパーティーの公開クエスト | `GET /quests` | 当該クエストは一覧に出ない | C.0／C.1 |
| C-TC-103 | api | status enum の入力検証 | ログイン済 | `GET /quests?status=bogus` | 422 `validation_error` | §C.6／§1.7 |
| C-TC-104 | api | 所属グループ一覧 | seed user がグループ所属 | `GET /quest-groups` | 自分の有効所属グループを返す | C.4 |
| C-TC-105 | api | 未認証遮断 | セッション無し | `GET /quests` | 401 | require_me（P1） |
| C-TC-106 | api | `sort=-idea_count` でカードが idea_count 降順 | 公開アイデア 2件/0件 の2クエスト（同一グループ） | `GET /quests?group_id=<g>&sort=-idea_count` | アイデア多いカードが少ないカードより前 | C.1／§1.8.1 |
| C-TC-107 | api | 未知ソートキーは 422 | ログイン済 | `GET /quests?sort=bogus` | 422 `validation_error`・`errors[].field="sort"` | §1.8.1（ホワイトリスト） |
| C-TC-108 | api | ソート指定時も keyset ページングが安定 | idea_count 差のある2クエスト（同一グループ） | `GET /quests?group_id=<g>&sort=-idea_count&limit=1`→cursor | page1/page2 が重複なく降順継続 | C.1／§1.8.1 |

## 3. 作成・編集・公開・候補・アイコン API（SC-11・C.2/C.3/C.4）

> 対象＝`POST /quests`・`PATCH /quests/{id}`・`POST /quests/{id}/publish`・`PUT/DELETE /quests/{id}/icon-image`・`GET /quest-groups/{id}/members`。サーバー強制ルール（候補制限・owner 付与は作成者のみ・作成者保護・状態機械・strict 検証）・入力検証・CSRF/認可を検証（`tests/quests/test_sc11_api.py`）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-110 | api | 下書き作成 | ログイン済・グループ所属 | `POST /quests`（draft） | 201・my_state=draft・作成者が owner でパーティー参加 | C.2 |
| C-TC-111 | api | 即公開作成＋メンバー追加 | 同一グループの候補あり | `POST /quests`（recruiting・members） | 201・status=recruiting・追加者に既定権限・作成者は owner | C.2/C.3 |
| C-TC-112 | api | 非所属グループでの作成拒否 | ログイン済 | `POST /quests`（他グループ） | 422（quest_group_id・IDOR 対策） | §C.6 |
| C-TC-113 | api | 即公開は strict（カテゴリ必須） | ログイン済 | `POST /quests`（recruiting・categories 空） | 422（categories） | C.2 §publish 検証 |
| C-TC-114 | api | 下書きは緩い検証 | ログイン済 | `POST /quests`（draft・categories 空） | 201（保存可） | C.7 確定 |
| C-TC-115 | api | 下書き編集→公開 | 下書きクエスト | `PATCH`→`POST publish` | PATCH 200（draft 維持）／publish 200 recruiting | C.2 |
| C-TC-116 | api | 状態機械（publish 前提） | recruiting クエスト | `POST publish` | 409 conflict（invalid_state） | C.2 §56 |
| C-TC-117 | api | publish は owner のみ | 他人所有の recruiting | `POST publish` | 403 | C.2 |
| C-TC-118 | api | 完了後の書き込み凍結 | completed クエスト | `PATCH` | 409 conflict | C.5 |
| C-TC-119 | api | 候補の exclude（サーバー除外） | 同一グループに候補 | `GET /quest-groups/{id}/members`（exclude 有無） | exclude 指定者は候補に出ない | C.4 |
| C-TC-120 | api | 非所属グループの候補は 404 | ログイン済 | `GET /quest-groups/{別id}/members` | 404（存在秘匿） | C.4 |
| C-TC-121 | api | 候補制限（グループ外は追加不可） | recruiting クエスト | `PATCH members`（グループ外 user_id） | 422（user_id） | C.3 候補制限 |
| C-TC-122 | api | owner 付与は作成者のみ | 作成者≠自分・自分は quest_admin | `PATCH members`（他者に owner 付与） | 403 | C.3 |
| C-TC-249 | api | 増分EPでも owner 付与は作成者のみ（PATCH 経路 C-TC-122 と対称） | 作成者=other・自分は quest_admin | `POST /members`（owner）／`PUT .../permissions`（owner） | いずれも 403（権限昇格防止） | C.3 |
| C-TC-250 | api | evaluator 付与は有効パーティー員限定 | 作成者=seed | `PUT .../permissions`（非メンバーへ evaluator／メンバーへ evaluator） | 非メンバー 404／メンバー 200・`permissions` に evaluator 反映 | C.0 |
| C-TC-252 | api | 専用EP GET /members が各員に in_scope＋group_ids を載せる（詳細EP と対称） | recruiting・参加部署=group・員を追加 | `GET /quests/{id}/members` | 追加員 `in_scope=true`・`group_ids` に参加部署を含む | C.1 |
| C-TC-253 | api | POST /quests の Idempotency（同一キー再送は再生・別内容は422・横断MW §1.9） | ログイン | `POST /quests`（同キー2回→別内容） | 1回目201・2回目 `Idempotency-Replayed:true`・同id／別内容は422 `idempotency_key_reuse` | §1.9 |
| C-TC-254 | api | 公開中クエストの PATCH は strict＝recruiting に categories:[] は422（作成時 C-TC-113 の公開中版） | recruiting クエスト | `PATCH /quests/{id}`（categories:[]） | 422（field `categories`） | C.2 |
| C-TC-255 | api | API経路の DELETE→再POST はトゥームストーン再利用＝行が増えない・joined_at更新・既定権限復活（repo C-TC-006 のAPI版） | recruiting・員を追加 | `POST /members`→`DELETE`→`POST /members` | 再追加201・`permissions`＝既定{vote,idea_create,comment}・quest_members は1行のまま（`removed_at` NULL） | C.3／§5.8 |
| C-TC-251 | api | `GET /quests` の q（件名部分一致）/group_id（所属グループ）フィルタ | 一意件名クエスト＋別件クエスト | `?q=<一意>`／`?group_id=<所属>` | q＝一意件名のみ返り別件は出ない／group_id＝所属グループのクエストが返る | C.1 |
| C-TC-123 | api | 作成者保護（差分で外れない） | 作成者＋メンバーのパーティー | `PATCH members=[]` | 作成者は残り・指定外は外れる | C.3 |
| C-TC-124 | api | 変更系の CSRF 必須 | ログイン済・CSRF ヘッダ無し | `POST /quests` | 403 csrf_failed | A.0 |
| C-TC-125 | api | アイコン設定/削除（2段） | recruiting クエスト・Fake storage | `PUT/DELETE .../icon-image` | PUT 200＋署名URL（quest-icons/）／DELETE 204 | 論点2／K.4 |
| C-TC-126 | api | 未認証の作成遮断 | セッション無し | `POST /quests` | 401 | require_me |

## 4. 詳細 API（SC-12 概要／SC-11 編集プリフィル・C.1）

> 対象＝`GET /quests/{id}`。可視性のサーバー強制（下書きは本人のみ／公開系は owner か有効パーティー員のみ・範囲外 404）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-127 | api | 自分の下書き詳細 | 自分の下書き | `GET /quests/{id}` | 200・status draft・my_permissions に owner・作成者メンバー | C.1 |
| C-TC-128 | api | パーティー外は 404 | 他人所有・自分は非メンバー | `GET /quests/{id}` | 404（存在秘匿） | C.1 可視性 |
| C-TC-129 | api | 参加中の公開詳細 | 自分が owner の recruiting | `GET /quests/{id}` | 200・categories/quest_group 同梱 | C.1 |
| C-TC-143 | api | 詳細の idea_count は公開アイデア数（下書き/削除は除外） | recruiting クエスト＋published 2件・自分の下書き 1件・削除済み 1件 | `GET /quests/{id}` | idea_count=2（published・deleted_at IS NULL のみ／draft・削除は数えない） | C.1／D.1／SC-12 |
| C-TC-144 | api | 一覧の idea_count も公開アイデア数を反映 | 同上のクエスト | `GET /quests` | 当該カードの idea_count=2（batch 集計・N+1 回避） | C.1／D.1／SC-10 |
| C-TC-247 | api | クエストカードの is_owner（閲覧者=作成者か・SC-01 で「自分のクエスト」を参加中と分離） | seed 作成クエスト／他者作成で seed が参加中のクエスト | `GET /quests` | 自作カード `is_owner=true`／他者作成カード `is_owner=false` | C.1／SC-01 |

## 5. パーティー粒度・状態遷移・削除 API（SC-12・C.3/C.5/C.2）

> 対象＝`GET/PUT/POST/DELETE /quests/{id}/members*`・`PUT .../party`・`POST .../transition`・`DELETE /quests/{id}`。認可・作成者保護・状態機械（前進のみ）・完了凍結を検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-130 | api | パーティー取得 | recruiting クエスト | `GET .../members` | 作成者を含むパーティーを返す | C.1 |
| C-TC-131 | api | 一括差分適用（PUT party） | recruiting クエスト | `PUT .../party`（members） | あるべき全体像で適用・作成者は保護され残る | C.3 |
| C-TC-132 | api | 増分追加 | recruiting クエスト | `POST .../members` | 201・既定権限 vote/idea_create/comment | C.3 |
| C-TC-133 | api | 増分削除（論理削除） | メンバー追加済み | `DELETE .../members/{user_id}` | 204・パーティーから外れる | C.3 |
| C-TC-134 | api | 作成者は除外不可 | recruiting クエスト | `DELETE .../members/{作成者}` | 422（作成者保護） | C.3 |
| C-TC-135 | api | 権限セット置換 | メンバー追加済み | `PUT .../permissions` | 送った集合で置換 | C.3 |
| C-TC-136 | api | 作成者の権限は変更不可 | recruiting クエスト | `PUT .../{作成者}/permissions` | 422（owner 剥奪防止） | C.3 |
| C-TC-137 | api | 前進遷移 | recruiting クエスト | `POST transition {to:in_progress}` | 200・in_progress | C.5 |
| C-TC-138 | api | 飛び越え遷移の禁止（隣接1段のみ） | recruiting クエスト | `POST transition {to:evaluating}` | 409 conflict | C.5 |
| C-TC-139 | api | draft→recruiting は strict 公開 | 充足済み draft | `POST transition {to:recruiting}` | 200・recruiting | C.5／C.2 |
| C-TC-140 | api | 後退遷移＝隣接1段のみ許可（2026-09-13） | in_progress クエスト | `POST transition {to:recruiting}`／続けて {to:draft} | 200・recruiting／draft戻し（非公開化）は 409 | C.5 |
| C-TC-140 | api | 論理削除 | recruiting クエスト | `DELETE /quests/{id}` | 204・以後 GET 詳細 404 | C.2 |
| C-TC-141 | api | パーティー編集の認可 | 他人所有・自分は非 owner/admin | `PUT .../party` | 403 | C.3 |
| C-TC-142 | api | 完了クエストのパーティー凍結 | completed クエスト | `POST .../members` | 409 conflict | C.5 |
| C-TC-145 | api | 完了クエストの PUT /party 凍結（PUT 経路） | completed クエスト | `PUT .../party`（members） | `409 conflict`（C-TC-142 の POST 経路と対称・書き込み凍結） | C.5 |
| C-TC-146 | api | PUT /party の原子性（検証先行・部分適用しない） | recruiting・owner が編集 | 先頭に有効ユーザー・末尾に候補外 uuid を含む差分を PUT | `422`（`field=user_id`）＋**先頭の有効追加も未適用**（GET members に現れない＝全体が原子的） | C.3 |

## 6. e2e（SC-11/12・実接続・Playwright）

> 対象＝`impl/frontend/e2e/sc-11-quest-create-modal.spec.ts`・`sc-12-quest-detail.spec.ts`。ACME-01 一般ユーザー＋デモグループ seed 前提・各テストで API 後片付け。1ファイルずつ＋`redis-cli FLUSHALL`。テスト名先頭に TC-ID を付す。

| TC-ID | 階層 | 目的 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| C-TC-201 | e2e | 作成モーダルの開閉（URL） | 一覧→「クエストを作成」→Esc | `/quests/new` モーダル→Esc で一覧へ | SC-11／画面遷移図 |
| C-TC-202 | e2e | 直アクセスのフルページ | `/quests/new` 直アクセス | フルページ（モーダルでない） | SC-11 |
| C-TC-203 | e2e | §4.7 入力検証 | 空で「クエストを作成」 | 上部サマリ＋`#q_name` aria-invalid・遷移しない | デザイン標準 §4.7 |
| C-TC-204 | e2e | 下書き作成→一覧反映 | 必須入力→下書き保存 | 一覧に作成タイトルが出る | C.2／SC-10 |
| C-TC-205 | e2e | 詳細の実データ描画 | 詳細を開く | ヘッダー（カテゴリ badge・🗂参加部署）/パーティーが実データ（作成者バッジ）。「概要」タブはレビュー#3で廃止＝ヘッダーに集約 | C.1／SC-12 |
| C-TC-206 | e2e | 遷移→削除 | ⋯ステータスを進める→⋯削除 | in_progress に更新／削除で一覧へ・タイトル消失 | C.5／C.2 |

## 7. 複数部署横断＝参加部署（アクセス条件）・作成者別格・動的失効（FR-38 再設計・2026-09-11・C.0/C.2/C.4）

> 対象＝`POST /quests`（`quest_group_ids`＝参加部署 0..N・**`quest_group_id` は廃止**）・`PATCH /quests/{id}`（`quest_group_ids` 差分＝**409 撤去**）・`GET /quest-detail`（`quest_groups` のみ・**単一 `quest_group` DTO 廃止**）・`GET /quest-group-candidates`（0 件=会社全体・門番=同一会社）・`can_access_quest`（門番の単一ソース）。
> 新モデル（データモデル §5.6/§5.6b/§5.8・API設計 C.0）: **参加部署＝アクセス条件**＝非作成者は「有効パーティー員 かつ（参加部署 0 件なら条件なし／1 件以上なら現在いずれかに有効所属）」で参照可。**アクセスの都度、現所属で再判定**（異動失効）。**作成者は別格**＝常に全参照可・参加部署所属不要。**主グループ（primary）概念は廃止**（フラット 0..N・すべて同格）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-220 | api | 参加部署複数付き作成→詳細に `quest_groups`（全同格） | 作成者はどの参加部署にも非所属（別格） | `POST /quests`（quest_group_ids=[G1,G2]） | 201・`quest_groups`=[G1,G2]（created_at 昇順）・**単一 `quest_group` フィールドは無い** | C.2／§5.6b／FR-38 |
| C-TC-221 | api | 候補＝参加部署いずれかの所属者を members 追加できる | G2 のみ所属ユーザ（G1 非所属） | G2 ユーザを `members` で即公開作成 | 201・当該ユーザがパーティーに含まれる | C.3／FR-38 |
| C-TC-222 | api | 存在しない参加部署は 422 | — | `POST /quests`（quest_group_ids=[乱数]） | 422・field `quest_group_ids` | C.2 |
| C-TC-223 | int | 一覧可視性＝パーティー員 ∧ 参加部署の現所属 | G2 所属＋パーティー員の別ユーザ | `repository.list_quests_for_user(user=別ユーザ, visible_group_ids=[G2])` | 当該クエストが結果に含まれる | C.1／§5.6b／FR-38 |
| C-TC-224 | api | 横断候補 EP＝参加部署の和集合＋所属 group_ids | G1/G2 に跨るユーザ群 | `GET /quest-group-candidates?group_ids=G1&group_ids=G2` | 両 G の有効メンバーを返し、各候補に所属 `group_ids` が付く | C.4／FR-38 |
| C-TC-225 | api | 候補 EP 門番＝同一会社なら非所属でも返す（旧 404 撤廃） | いずれの指定 G にも非所属の同一会社ユーザ | `GET /quest-group-candidates?group_ids=G` | 200・data を返す（会社内は部署をこえて可視・作成者別格で他部署選択可） | C.4 |
| C-TC-226 | api | PATCH で参加部署を差分（増減）→`quest_groups` 反映 | recruiting（参加部署 1 件） | `PATCH`（quest_group_ids=[G1,G2]） | 200・`quest_groups` が 2 件になる | C.2／FR-38 |
| C-TC-227 | api | 参加部署除外はブロックしない（409 撤去）＝失効で表現 | G2 のみ所属の非作成者パーティー員がいる | `PATCH`（quest_group_ids=[G1]＝G2 除外）→ 当該員で `GET quest-detail` | PATCH 200（409 にならない）・当該員は詳細 **404**（動的失効） | C.2／C.0／§5.6b |
| C-TC-228 | api | 部署ディレクトリ＝会社内全グループ（非所属含む） | seed user は group_c 非所属 | `GET /quest-group-directory` | data に非所属の group_c が含まれる（会社内は部署をこえて可視） | C.4／FR-38 |
| C-TC-229 | api | 参加部署 0 件＝候補は会社の有効ユーザー全体 | quest_group_ids=[]（0 件）・会社の任意 active ユーザ | 当該ユーザを `members` で作成 | 201・追加成功（0 件時は会社全体が候補・部署条件なし） | C.3／§5.6b／C.0 |
| C-TC-230 | api | 作成者は別格＝参加部署非所属でも自クエスト詳細を参照可 | 作成者は G1 に非所属 | `GET quest-detail`（owner） | 200（404 にならない） | C.0／§5.6b |
| C-TC-231 | api | 動的失効＝非作成者パーティー員が全参加部署を離脱→詳細 404 | G1 のみ所属の非作成者パーティー員→G1 のグループ所属を除去 | `GET quest-detail`（当該員） | 404（都度再判定でアクセス失効） | C.0／§5.6b |
| C-TC-232 | unit | `can_access_quest` 真偽表（門番の単一ソース） | owner／party+現所属／party+離脱／部署0件+party／非party の各ケース | `repository.can_access_quest(quest, user_id)` | owner=真・party+現所属=真・party+離脱=偽・部署0件+party=真・非party=偽 | C.0／§5.8 |
| C-TC-233 | api | メンバー DTO の `in_scope`＝参加部署外メンバーの失効表示 | 参加部署 group_a・owner 別格・部署内メンバー・部署外の名指しメンバー | `GET /quest-detail`（owner）の `members` | owner=`in_scope:true`・部署内メンバー=`true`・部署外メンバー=`false`（失効中） | C.1／C.0／§5.6b |
| C-TC-234 | api | 横断候補の `group_ids`＝**照会に限らず有効所属全件**（req2/5） | A/B 所属の ab_user・照会は group_a のみ | `GET /quest-group-candidates?group_ids=A` | ab_user の `group_ids`＝{A,B}（照会 A のみでも B を含む全所属） | C.4／FR-38 |
| C-TC-235 | api | メンバー DTO の `group_ids`＝有効所属全件（チップ常時表示/スコープ再判定の材料・req2/3） | 参加部署 group_a・owner／A所属メンバー／B のみメンバー | `GET /quest-detail`（owner）の `members` | 各メンバーの `group_ids`＝その人の有効所属全件（A所属者は A を含む・B のみ者は B） | C.1／FR-38 |
| C-TC-240 | api | 最終結果＝既存集計の合成（FR-39・アイデア選別の申し送り） | 公開2アイデア（1選定）・選定案に submitted 評価(全観点4)・投票1 | `GET /quests/{id}/result` | `participation`（idea 2/選定1/投票1/評価1）・`aspect_averages.fit=4.0`・選定案 `overall_avg=4.0`＋`is_selected`・`can_edit=true`（owner） | C（FR-39）／F.1／§9 |
| C-TC-241 | api | 最終結果の門番（非パーティーは 404） | 他人所有・seed user は非メンバー | `GET /quests/{id}/result` | 404（存在秘匿・C.0） | C（FR-39）／C.0 |
| C-TC-242 | api | 総括の保存と権限（owner/quest_admin のみ） | (1)owner (2)一般メンバー（vote のみ） | `PUT /quests/{id}/result`（summary/next_actions/metrics） | (1)200・GET に反映（summary/next_actions/metrics）(2)403 | C（FR-39）／§10 |
| C-TC-243 | api | 完了で④通知＋成果フィード（quest_result_ready／quest_completed） | evaluating・owner=seed・パーティー員 other | `POST /quests/{id}/transition`（to=completed） | 200・`quest_completed` 活動1件（作成者・冪等）・作成者以外の員に `quest_result_ready` 通知（作成者には出さない） | C（FR-39）／H／FR-36 |
| C-TC-248 | api | 完了の副作用が後退→再前進で二重発生しない（C.5 初回完了時のみ） | evaluating・owner=seed・員 other・公開アイデア＋提出済み評価 | `POST transition` を completed→evaluating→completed | `quest_completed` 活動1件・`quest_result_ready` は宛先ごと1件（other に1・作成者0）・`evaluation_coin` も1件（二重確定なし） | C.5／H／F.4 |
| C-TC-244 | api | ⑥総括初回記入で owner に少額XP（冪等） | owner が result を2回保存 | `PUT /quests/{id}/result`×2 | `quest_result_summary` 活動1件・amount=20・本人1回（2回目は加算しない） | C（FR-39）／G／§10 |
| C-TC-245 | api | 結果に④議論の要点(b)＝ピン留めチャットを集約 | 公開アイデアにピン留めメッセージ | `GET /quests/{id}/result` | `pinned_messages` に当該（idea_id/idea_title/excerpt/author） | C（FR-39 (b)）／E |
| C-TC-246 | api | (c)自動要約＝抽出型・オフライン（外部API不使用）生成/保存＋権限 | (1)owner・チャット複数 (2)一般メンバー（comment のみ） | `POST /quests/{id}/result/chat-summary` | (1)200・`chat_summary` 非空・GET に反映 (2)403 | C（FR-39 (c)）／E |

## 3. 締切の切迫度（frontend 単体・#24 ゲーム感）

> 対象＝`impl/frontend/src/lib/deadline.ts`（`deadlineUrgency`/`deadlineCountdown`＝締切表示の切迫度・純ロジック）。DOM 非依存のみ vitest（node）で担保・UI 結線（バッジ色/脈動・SC-01/10/11/12 の ⏳ 締切）は tsc＋ブラウザ受入（GF-AC）。**トレーサビリティ検査対象外**（`src/**/*.test.ts` は非走査）＝本 md で追跡。

| TC-ID | 階層 | 目的 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| C-TC-210 | unit | 締切→切迫度と残日表示の決定（#24） | `deadlineUrgency(deadline, todayISO)`／`deadlineCountdown(days)` | 締切なし=none/null／過去=over（days<0）／当日〜2日=urgent／3〜7日=soon／8日以上=safe／不正日付=none。`deadlineCountdown`＝null→""・負→「締切超過」・0→「今日締切」・正→「残りN日」 | SC-01/10/11/12（⏳ 締切）／ゲーム感 #24 |

## 7. 発見カタログ・フォロー・参加リクエスト（FR-40・C.9・SC-13）

> 対象＝`app/tenant/quests/{router,application,repository}.py`（`GET /quest-catalog`・`catalog-detail`・`follow`・`join-request`・`join-requests`〔受信側＝承認/却下・SC-12〕）。発見門番 `can_discover_quest`（discoverable ∧ 部署交差／0件=全社・メタ専用）・`my_state`・フォロー/参加リクエスト（申請/取消・通知）・受信側（一覧/承認/却下・認可 owner/quest_admin・通知 `join_request_decided`）を検証。前提＝seed 一般ユーザー（viewer）＋他ユーザー owner の discoverable クエストを seed。対象＝`tests/quests/test_catalog.py`。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-260 | api | 発見門番＝discoverable ∧ 部署交差（0件=全社）・メタのみ | discoverable×自部署／非discoverable／別部署／参加部署0件 の4クエスト | `GET /quest-catalog` | 自部署 discoverable と 全社(0件)discoverable が出る／非discoverable・別部署は出ない／`my_state=none`・`purpose` あり（中身は返さない）・`page_info.total` | C.9.0／FR-40 |
| C-TC-261 | api | フォロー トグル（my_state 追随） | discoverable クエスト | `POST /follow`→`GET`→`DELETE /follow` | follow で `following:true`＋カタログ `my_state=following`／解除で `following:false`＋`none`（冪等） | C.9 |
| C-TC-262 | api | 参加リクエスト＋通知＋重複/取消 | discoverable クエスト | `POST /join-request`→`GET`→重複`POST`→`DELETE` | 201 `pending`＋`my_state=pending`＋作成者へ `join_request_received` 通知1件／重複は 409／取消(204)で `my_state=none` | C.9／H |
| C-TC-263 | api | 門番/既member ガード | 非discoverable／viewer が member の discoverable | `POST follow/join-request`（非discoverable）／`POST join-request`（member） | 非discoverable は 404（存在秘匿）／既 member への申請は 409 `already_member`／カタログで member は `my_state=member` | C.9.0／C.9 |
| C-TC-264 | api | catalog-detail 門番＋sort 422 | discoverable／非discoverable | `GET /catalog-detail`（各）／`GET /quest-catalog?sort=bogus\|-created_at` | discoverable=200／非discoverable=404／未知 sort=422／`-created_at`=200（§1.8.1 ホワイトリスト） | C.9.1／§1.8.1 |
| C-TC-265 | api | catalog-detail 活発度スパーク（メタ限定・本文非返却） | discoverable クエストに公開アイデア2件＋各チャット群に別日メッセージ | `GET /catalog-detail`（非member viewer） | `activity.daily` が日別に集計（クエスト横断＝公開アイデアのチャット合算）・`activity.total` が総数一致・本文（body）は応答に含まれない（メタのみ） | C.9.1／FR-40 |
| C-TC-266 | e2e | 掲示板ダイアログに標準の最大化(⤢)が出る（DFT-E-013） | dev seed の発見デモ discoverable クエスト | `/quest-catalog` → カード → ダイアログ → ⤢ | 「最大化」ボタンが可視・押すとパネル `.is-max`＋「元のサイズに戻す」へ（`maximizable` 既定 on の上書き禁止・§106） | SC-13／デザイン標準 §106／DFT-E-013 |
| C-TC-267 | e2e | 掲示板ダイアログの閉じアニメ（DFT-E-014）＝CRT 電源OFF | dev seed の発見デモ discoverable クエスト | `/quest-catalog` → カード → ダイアログ → × | 閉じ要求後に `.modal:not(.show)`（=`.is-closing`）が一瞬 attach（CRT 電源OFF アニメ中＝マウント保持）→ 最終的に `.modal` が unmount。即アンマウント（旧不具合）では中間状態が観測できず red | SC-13／Modal 閉じアニメ契約（CRT 電源OFF）／DFT-E-014 |
| C-TC-268 | e2e | モーダル CRT 演出の reduce 抑制（ON＝出ない・情報/挙動は残る） | reduce ON（`emulateMedia`）＋発見デモ discoverable クエスト | `/quest-catalog` → カード → ダイアログ → × | `--crt-in` クラスが付かない（open/close の CRT 演出抑制）／`.modal__panel` は可視（情報は残る）／× で即閉じ（挙動は保つ） | デザイン標準 §4.9／テスト規約 §6／全モーダル共通 |
| C-TC-269 | api | 参加リクエスト一覧（受信側・owner・pending 上位/rejected 下部・user メタ） | discoverable クエスト＋viewer が pending・別ユーザーが rejected | owner ログインで `GET /quests/{id}/join-requests` | `data` に pending と rejected 行・各 `user`（`display_name`/`avatar_image_url`/`group_ids`）・`status`/`message`/`created_at`・pending が rejected より上／非 owner/admin は 403 | C.9.1／SC-12 §4.3 |
| C-TC-270 | api | 承認＝member 追加＋通知＋my_state=member | viewer が pending のクエスト（owner 別） | owner が `POST .../join-requests/{viewer}/approve` | 200＋jr `approved`・`decided_at`/`decided_by_id` 設定・`quest_members` に viewer 追加（既定権限 vote/idea_create/comment）・申請者へ `join_request_decided`(approved) 通知1件・カタログで viewer `my_state=member` | C.9.1／H |
| C-TC-271 | api | 却下＝非終端（行残す）＋通知＋後日 approve で復活 | viewer が pending | owner が `reject`→`GET(status=rejected)`→`approve` | reject 200＋jr `rejected`（行残・`my_state=rejected`）・申請者へ `join_request_decided`(rejected) 通知／その後 `approve` 200 で `approved`＋member 追加（rejected→approved 復活） | C.9.1／H |
| C-TC-272 | api | 受信側の認可/状態ガード | discoverable クエスト・viewer 非 owner/admin | viewer が `GET`/`approve`/`reject`／owner が未申請 user を `approve`／approved を `reject` | viewer の一覧/承認/却下は 403／未申請 user への approve は 404（存在秘匿）／approved 済みを reject は 409 `invalid_state` | C.9.1／§1.4 |
