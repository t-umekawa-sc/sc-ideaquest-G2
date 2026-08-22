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

## 2. 一覧 API（SC-10・C.1/C.4）

> 対象＝`GET /quests`・`GET /quest-groups`（`app/tenant/quests/router.py`・`application.py`）。参照制限のサーバー強制・DTO 形状・カーソル・入力検証・認可を検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| C-TC-101 | api | 参加中クエストが DTO 形状で返る | seed user が owner=パーティー員の公開クエスト | `GET /quests` | 対象カードが返り status/member_count/idea_count/categories/owner/quest_group/my_state・page_info 正 | C.1／SC-10 |
| C-TC-102 | api | パーティー門番の API 強制 | 他人だけがパーティーの公開クエスト | `GET /quests` | 当該クエストは一覧に出ない | C.0／C.1 |
| C-TC-103 | api | status enum の入力検証 | ログイン済 | `GET /quests?status=bogus` | 422 `validation_error` | §C.6／§1.7 |
| C-TC-104 | api | 所属グループ一覧 | seed user がグループ所属 | `GET /quest-groups` | 自分の有効所属グループを返す | C.4 |
| C-TC-105 | api | 未認証遮断 | セッション無し | `GET /quests` | 401 | require_me（P1） |

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
| C-TC-138 | api | 飛び越え遷移の禁止 | recruiting クエスト | `POST transition {to:evaluating}` | 409 conflict | C.5 |
| C-TC-139 | api | draft→recruiting は strict 公開 | 充足済み draft | `POST transition {to:recruiting}` | 200・recruiting | C.5／C.2 |
| C-TC-140 | api | 論理削除 | recruiting クエスト | `DELETE /quests/{id}` | 204・以後 GET 詳細 404 | C.2 |
| C-TC-141 | api | パーティー編集の認可 | 他人所有・自分は非 owner/admin | `PUT .../party` | 403 | C.3 |
| C-TC-142 | api | 完了クエストのパーティー凍結 | completed クエスト | `POST .../members` | 409 conflict | C.5 |

## 6. e2e（SC-11/12・実接続・Playwright）

> 対象＝`impl/frontend/e2e/sc-11-quest-create-modal.spec.ts`・`sc-12-quest-detail.spec.ts`。ACME-01 一般ユーザー＋デモグループ seed 前提・各テストで API 後片付け。1ファイルずつ＋`redis-cli FLUSHALL`。テスト名先頭に TC-ID を付す。

| TC-ID | 階層 | 目的 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| C-TC-201 | e2e | 作成モーダルの開閉（URL） | 一覧→「クエストを作成」→Esc | `/quests/new` モーダル→Esc で一覧へ | SC-11／画面遷移図 |
| C-TC-202 | e2e | 直アクセスのフルページ | `/quests/new` 直アクセス | フルページ（モーダルでない） | SC-11 |
| C-TC-203 | e2e | §4.7 入力検証 | 空で「クエストを作成」 | 上部サマリ＋`#q_name` aria-invalid・遷移しない | デザイン標準 §4.7 |
| C-TC-204 | e2e | 下書き作成→一覧反映 | 必須入力→下書き保存 | 一覧に作成タイトルが出る | C.2／SC-10 |
| C-TC-205 | e2e | 詳細の実データ描画 | 詳細を開く | ヘッダー/概要/パーティーが実データ（作成者バッジ） | C.1／SC-12 |
| C-TC-206 | e2e | 遷移→削除 | ⋯ステータスを進める→⋯削除 | in_progress に更新／削除で一覧へ・タイトル消失 | C.5／C.2 |
