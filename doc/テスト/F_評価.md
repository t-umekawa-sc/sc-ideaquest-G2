# テストパターン F. 評価（評価・選定・投稿者コイン）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/F_評価.md`](../API設計/F_評価.md)（F.0〜F.6）・[`../データモデル.md`](../データモデル.md) §5.21/§5.22・§3（`evaluation_status`/`evaluation_visibility`/`evaluation_aspect`）・§7/§8-⑥/§8-⑱。エラー code の網羅は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン F（評価）の縦スライス＝`app/tenant/evaluations/`（ORM/migration/repository/application/router）。門番＝パーティー所属（C.0）＋`evaluator` 権限。XP/コインは `app.tenant.gamification.ledger`（G）を同一 UoW で呼ぶ。
> 前提フィクスチャ＝seed 会社 ACME-01。repository テストは前提（クエスト/アイデア/ユーザー）を ORM で直接 seed。api テストは seed 一般ユーザー（ACME-01）でログインし会社DB にクエスト＋自分のパーティー参加＋evaluator 権限を seed。変更系は Origin/CSRF。

## 1. repository（永続化プリミティブ・§5.21/§5.22）

> 対象＝`app/tenant/evaluations/repository.py`。評価 upsert（`UNIQUE(idea_id, evaluator_id)`）・観点スコア置換（`UNIQUE(evaluation_id, aspect)`）・アイデアの評価一覧（スコア同梱）・集計を検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F-TC-001 | int | 評価 upsert（作成→更新・1人1評価） | アイデア/評価者 seed | `upsert_evaluation` を2回（draft→submitted） | 行は1つ・status/overall_comment/submitted_at 更新 | §5.21 |
| F-TC-002 | int | 観点スコアの置換セット | 評価1件 | `replace_scores`（5観点）→再置換（値変更） | 各観点1行（`UNIQUE(evaluation_id, aspect)`）・後の値で全置換 | §5.22 |
| F-TC-003 | int | アイデアの評価一覧（スコア同梱） | submitted 2名・draft 1名 | `list_evaluations_for_idea` | submitted のみ/全件（引数）・各評価に観点スコア | F.1 |
| F-TC-004 | int | 集計（観点別平均・総合平均） | submitted 2名（既知スコア） | `aggregate_scores` | 観点別平均・5観点均等の総合平均が一致 | F.1／§5.22 |

## 2. 評価の取得・登録・更新 API（F.1/F.2・SC-25/SC-22）

> 対象＝`app/tenant/evaluations/application.py`・`router.py`（`GET /ideas/{id}/evaluation/me`・`GET /ideas/{id}/evaluation`・`PUT /ideas/{id}/evaluation`）。門番＝パーティー所属＋（入力は）`evaluator` 権限。完了は 409。`submitted` は全5観点＋総評をサーバー検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F-TC-101 | api | 自分の評価取得（未作成は空） | evaluator・未評価 | `GET .../evaluation/me` | 200・`{status:null}` 相当（未作成） | F.1 |
| F-TC-102 | api | 下書き保存（部分可・本人のみ・付与なし） | evaluator | `PUT`（scores 一部・status=draft） | 200・status draft・XP/コイン付与なし・`GET me` で読み戻せる | F.2 |
| F-TC-103 | api | 確定（全5観点＋総評）→XP+30 | evaluator | `PUT`（5観点1..5＋overall・submitted） | 200・status submitted・submitted_at・評価者に XP+30（`activities` reason=evaluation） | F.2／§7 |
| F-TC-104 | api | 確定の必須検証（観点欠け/総評空） | evaluator | `PUT`（4観点 or overall 空・submitted） | 422 `validation_error`（`errors[].field`） | F.2 |
| F-TC-105 | api | 確定 XP は1回のみ（再確定で再付与しない） | 確定済み | `PUT`（submitted）再送 | 200・`activities` の evaluation XP は1件のまま（`exists_ref` 冪等） | F.2／§8-⑥ |
| F-TC-141 | api | 確定応答に `xp_delta` を載せる（獲得フィードバック・#8） | evaluator | `PUT`（初回 submitted→再確定→draft 保存） | 初回確定は `xp_delta=30`（実付与額）・再確定（冪等）は `xp_delta=0`・下書き保存は `xp_delta=0`。金額の正はサーバー（evaluation=+30） | F.2／§8-⑥／#8 |
| F-TC-106 | api | スコア範囲外は 422 | evaluator | `PUT`（score=0 or 6） | 422（`scores`） | F.2 |
| F-TC-107 | api | 入力は evaluator 権限必須 | パーティー参加だが evaluator なし | `PUT` | 403 | F.0 |
| F-TC-108 | api | 門番/可視性（非パーティー・下書きアイデア） | 非パーティー／draft アイデア | `PUT`／`GET me` | 404（存在秘匿・評価対象外） | F.0 |
| F-TC-109 | api | 完了クエストは書込凍結 | completed クエストの公開アイデア | `PUT` | 409（invalid_state） | F.0／C.5 |
| F-TC-110 | api | 集計取得（観点別平均・総合・評価者一覧・coin.projected） | submitted 2名（evaluator 権限） | `GET .../evaluation` | `aspects`/`overall_avg`/`evaluator_count=2`/`evaluators[]`/`coin.projected` | F.1 |
| F-TC-111 | api | limited は範囲外に完全非表示（分母にも入れない） | limited 評価（他評価者）＋party 評価 | 範囲外ユーザーで `GET .../evaluation` | limited を除外して集計・`evaluators[]` にも出ない | F.1 |
| F-TC-112 | api | コイン見込みは visibility 無視で全 submitted 算定 | party1＋limited1（範囲外閲覧） | `GET .../evaluation` | 集計平均は party のみ・`coin.projected` は両方（全 submitted）で算定 | F.1／F.4 |

## 3. 選定・投稿者コイン確定 API（F.3/F.4）

> 対象＝選定 `POST/DELETE /ideas/{id}/select`（owner/quest_admin）・投稿者コイン確定（(a) evaluator 全員提出／(b) completed 遷移・アイデア単位1回・冪等）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F-TC-113 | api | 選定→is_selected＋投稿者 XP+200 | owner・公開アイデア | `POST .../select` | 200・`is_selected=true`・投稿者に XP+200（reason=selection） | F.3／§7 |
| F-TC-114 | api | 選定解除は XP を剥奪しない | 選定済み | `DELETE .../select` | 200・`is_selected=false`・XP は残る | F.3 |
| F-TC-115 | api | 選定 XP は1回のみ（再選定で再付与しない） | 一度選定→解除→再選定 | `POST/DELETE/POST` | selection XP は1件のまま（`exists_ref` 冪等） | F.3 |
| F-TC-116 | api | 選定は owner/quest_admin 必須 | 一般メンバー | `POST .../select` | 403 | F.3 |
| F-TC-117 | api | 完了クエストは選定/解除も 409 | completed | `POST/DELETE .../select` | 409（invalid_state） | F.3／C.5 |
| F-TC-118 | api | コイン確定(a)＝evaluator 全員提出でアイデア単位に1回 | evaluator 2名・両者 submitted | 2人目の `PUT submitted` | 投稿者に evaluation_coin 1件（`round(avg×10)`・最大50）・再判定で増えない | F.4／§8-⑱ |
| F-TC-119 | api | コイン確定(b)＝completed 遷移で未確定を一括確定 | submitted 有・未確定のまま completed | `POST /quests/{id}/transition`(completed) | 未確定 published の投稿者へ evaluation_coin を一括付与（冪等・(a) 済みは二重付与しない） | F.4／C.5 |
| F-TC-120 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `PUT`／`POST select` | 403 csrf_failed／401 | A.0 |

## 4. 画面 e2e（SC-25 評価画面・SC-22 §4.6 評価結果・F.1〜F.3）

> 対象＝フロント接続済み SC-25（`features/evaluations/components/EvaluationView.tsx`・`/(app)/ideas/[ideaId]/eval`）と SC-22 §4.6 評価結果（`features/ideas/components/IdeaDetailView.tsx`）。e2e は**契約の最終確認**（画面↔API）に限定し、分岐は §2/§3 の api で担保。前提＝dev seed 一般ユーザー ACME-01（owner＝評価者＋選定可）。下地クエスト/アイデアは API で作成し teardown で論理削除。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| F-TC-201 | e2e | SC-25 確定→SC-22 評価結果に反映 | ログイン・API で recruiting クエスト＋published アイデア（author=ACME-01・owner=評価者） | `/ideas/{id}/eval` で5観点を★5採点＋総評入力→「評価を確定」 | 成功トースト・`/ideas/{id}` へ戻る・評価結果に「評価者1名」・平均 5.0・観点バー・総評が実データ（`getEvaluationAggregate`）で出る | F.1/F.2／SC-25/SC-22 |
| F-TC-202 | e2e | SC-25 下書き→再訪でプリフィル | 同上 | `/ideas/{id}/eval` で新規性=★3 →「下書き保存」→再訪 | トースト「下書きを保存しました」・再訪時に新規性の3点が復元（`getMyEvaluation`・`aria-pressed`）・確定していないので SC-22 は評価者0名 | F.1/F.2／SC-25 |
| F-TC-203 | e2e | SC-22 選定トグル（owner） | published アイデア（ACME-01 owner） | `/ideas/{id}` で「☆ このアイデアを選定」クリック | トースト「アイデアを選定しました」・ボタンが「★ 選定済み（解除）」・ヘッダーに「選定候補」バッジ（`selectIdea`・楽観更新＋サーバー権威） | F.3／SC-22 |
