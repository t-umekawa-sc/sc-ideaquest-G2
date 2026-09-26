# テストパターン P. コンセプト（創造・検証／ISO 56001 ②③段・FR-42）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/P_コンセプト.md`](../API設計/P_コンセプト.md)（P.0〜P.10）・[`../データモデル.md`](../データモデル.md) §5.38〜§5.46・§3（`concept_status`/`concept_decision`/`assumption_verdict`/`concept_criticality`/`concept_eval_aspect`/`concept_chat_scope_kind`）。設計背景＝[`../設計ドラフト/コンセプト機能_ISO56001_再設計.md`](../設計ドラフト/コンセプト機能_ISO56001_再設計.md)（§3.3〜§3.8）。エラー code の網羅は OpenAPI が SoT（[API設計 README](../API設計/README.md) §1.7）。
> 対象＝ドメイン P（コンセプト）の縦スライス＝`app/tenant/concepts/`（schemas/repository/application/router）。門番＝パーティー所属 AND クエストグループ所属（P.0）。チャットは E 機構を再利用（`chat_messages`/`chat_reads` に `concept_chat_scope_id`）。XP/コインは `app.tenant.gamification.ledger`（G）を同一 UoW。通知は H・realtime は L・情報リンクは N。
> 前提フィクスチャ＝seed 会社 ACME-01。repository テストは前提（クエスト/アイデア/ユーザー）を ORM で直接 seed。api テストは seed 一般ユーザー（ACME-01）でログインし、会社DB にクエスト＋自分のパーティー参加＋（必要な）`evaluator`/owner 権限を seed。変更系は Origin/CSRF＋状態変更は `X-CSRF-Token`。**このファイルは実装前の TC 設計（md-first・テスト規約 §5.2）**＝実装時に red→green を目視し、証跡はコミットメッセージへ。

## 1. repository（永続化プリミティブ・§5.38〜§5.46）

> 対象＝`app/tenant/concepts/repository.py`。コンセプト CRUD・由来 M:N・前提/検証イベント（`current_verdict` 導出）・M:N リンク（criticality/stale）・評価 upsert＋観点スコア置換・投票・チャットスコープを検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-001 | int | コンセプト作成（既定値） | クエスト/作成者 seed | `create_concept`（title＋viability jsonb） | 行1・`status=draft`・`decision=undecided`・`is_selected=false`・`current_revision=1`・viability 反映（総合ルーム自動生成は application＝P-TC-103） | §5.38／P.2 |
| P-TC-002 | int | 由来アイデア M:N（同一クエスト・置換） | 選別済みアイデア2 seed | `set_source_ideas([a,b])`→`set_source_ideas([b])` | `concept_source_ideas` が置換され最終は1件 | §5.39／P.2 |
| P-TC-003 | int | 前提＝検証プール（クエスト単位・第一級） | クエスト seed | `create_assumption`（statement） | 行1・`current_verdict=inconclusive`（既定） | §5.40／P.3 |
| P-TC-004 | int | 検証イベント追記→current_verdict 導出（最新） | 前提1 | `add_validation`（supported, 実施日/規模）→`add_validation`（refuted, 後日） | `assumption_validations` 2行（履歴保持）・`current_verdict=refuted`（最新イベント） | §5.41／§3.5 |
| P-TC-005 | int | 現在判定は実施日順（後から古い実施日を足しても最新日維持） | 前提1 | `add_validation`（supported 5/1）→（refuted 2/1・後から古い日付） | `current_verdict=supported`（最新実施日 5/1 が維持・挿入順でない） | §5.41／§3.5 |
| P-TC-006 | int | コンセプト↔前提リンク（M:N＋criticality） | コンセプト/前提 | `link_assumption`（criticality=critical） | `concept_assumption_links` 1行・`criticality=critical`・`is_stale=false` | §5.42／P.4 |
| P-TC-007 | int | 共有前提の反証で全リンク先を stale | 前提を2コンセプトにリンク | `add_validation`（refuted）→`mark_links_stale` | 両リンクが `is_stale=true` | §5.41/§5.42／P.7 |
| P-TC-008 | int | stale 解除（再評価の記録） | stale リンク | `set_link_stale(false)` | `is_stale=false` | §5.42／P.4 |
| P-TC-009 | int | 前提削除はリンク有りで不可（未リンクのみ） | リンク有り前提／未リンク前提 | `delete_assumption` | リンク有り＝拒否（409 相当）・未リンク＝削除 | §5.40／P.3 |
| P-TC-010 | int | 評価 upsert（作成→更新・1人1評価） | コンセプト/評価者 | `upsert_evaluation`（draft→submitted） | 行1・status/overall_comment/recommendation/submitted_at 更新 | §5.43／P.5 |
| P-TC-011 | int | 観点スコア置換（中核5＋補助3・UNIQUE） | 評価1 | `replace_scores`（中核5）→再置換（補助含む8） | `concept_evaluation_scores` が全置換・`UNIQUE(evaluation_id, aspect)` | §5.44／P.5 |
| P-TC-012 | int | 集計（観点別平均・総合＝中核5・推奨内訳） | submitted 2名（既知スコア/推奨） | `aggregate_scores` | 観点別平均・中核5の総合平均・`recommendations` の Go/Pivot/Kill 内訳 | §5.44／P.5 |
| P-TC-013 | int | 投票 upsert（賛成/反対・1人1票・切替/取消） | コンセプト/投票者 | `upsert_vote(approve)`→`(oppose)`→`delete_vote` | `concept_votes` 1→更新→0・集計反映 | §5.46／P.5b |
| P-TC-014 | int | チャットスコープ（overall/group/assumption） | コンセプト＋前提リンク | `create_scope(group)`／前提リンクで assumption スコープ生成 | `overall`1＋`group`＋`assumption`（assumption_id 紐付き） | §5.45／§3.7 |
| P-TC-015 | int | 論理削除（監査保持） | コンセプト1 | `soft_delete` | `deleted_at` セット・一覧から除外・行は残る | §5.38 |

## 2. コンセプトの取得・登録・編集・遷移・選定・判定 API（P.1/P.2・SC-61/SC-60/SC-12）

> 対象＝`application.py`・`router.py`（`GET /quests/{id}/concepts`・`GET /concepts/{id}`・`POST /quests/{id}/concepts`・`PATCH/DELETE /concepts/{id}`・`activate`/`archive`/`select`/`decision`）。門番＝P.0。状態遷移/選定/判定は owner/quest_admin。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-101 | api | 一覧（自分の draft を含む・要約列） | active2＋自分の draft1＋他人 draft1 | `GET /quests/{id}/concepts` | active2＋自分draft1（他人draftは不可視）・各行に status/decision/is_selected/由来数/前提数/評価要約/更新日・カーソル | P.1 |
| P-TC-102 | api | 詳細（合成＝スキーマ＋由来＋前提＋評価＋chat_scopes＋related_info＋my_permissions） | active コンセプト（前提/評価/情報リンク有） | `GET /concepts/{id}` | 全項目合成・`assumptions[]` に criticality/is_stale/現在判定・`related_info[]`（target_type=concepts） | P.1 |
| P-TC-103 | api | 作成（既定 draft＋総合ルーム自動生成） | パーティー | `POST /quests/{id}/concepts`（title＋source_idea_ids） | 201・`status=draft`・overall ルーム1・作成者本人のみ可視 | P.2 |
| P-TC-104 | api | 由来アイデアは同一クエストの選別済みのみ | 他クエストのアイデアID | `POST`（source_idea_ids に他クエスト） | 422/403（スコープ外・門番） | P.2／§1.1 |
| P-TC-105 | api | 編集（作成者＋owner／部分更新＋由来差替） | 作成者 | `PATCH /concepts/{id}`（viability 更新＋source_idea_ids 差替） | 200・更新反映 | P.2 |
| P-TC-106 | api | 活性化（draft→active・owner のみ） | owner／一般 | `POST .../activate` | owner=200 `active`・一般=403 | P.2 |
| P-TC-107 | api | 保管（active→archived・owner のみ） | owner | `POST .../archive` | 200 `archived`・一覧から除外（論理保持） | P.2 |
| P-TC-108 | api | 選定/解除（複数可・owner のみ・解除で履歴保持） | owner・active2 | `POST .../select`×2→`DELETE .../select`×1 | `is_selected` 反映・複数選定可・解除しても履歴残す | P.2 |
| P-TC-109 | api | 総合判定 Go/Pivot/Kill（owner のみ・根拠） | owner | `PUT .../decision`（go＋rationale） | 200・`decision=go`・rationale 保存・一般は403 | P.2／§3.3 |
| P-TC-110 | api | draft は本人のみ可視（存在秘匿） | 他人の draft | 非作成者で `GET /concepts/{id}` | 404（存在秘匿） | P.0/P.1 |
| P-TC-111 | api | 門番（非パーティー/非グループ） | 非パーティー | `GET /concepts/{id}` | 404 | P.0 |
| P-TC-112 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST /quests/{id}/concepts` | 403 csrf_failed／401 | A.0/P.8 |

## 3. 前提＝検証プール API（P.3）・反証波及（P.7）

> 対象＝`GET/POST /quests/{id}/assumptions`・`GET/PATCH/DELETE /assumptions/{id}`・`POST/GET /assumptions/{id}/validations`。前提作成・検証追記・編集はプール所有（owner/quest_admin）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-201 | api | 検証プール一覧（クエスト単位・要約） | 前提2（判定/検証件数/リンク数） | `GET /quests/{id}/assumptions` | 各行に current_verdict/validation_count/linked_concept_count/latest_validated_on | P.3 |
| P-TC-202 | api | 前提作成（プール所有のみ） | owner／一般 | `POST /quests/{id}/assumptions` | owner=201 `inconclusive`・一般=403 | P.3 |
| P-TC-203 | api | 検証イベント追記（必須＝method/verdict/validated_on） | 前提1 | `POST .../validations`（欠落） | 422（`errors[].field`） | P.3 |
| P-TC-204 | api | 検証追記→current_verdict 更新＋履歴 | 前提1 | `POST .../validations`（supported）→（refuted） | `current_verdict=refuted`・`GET .../validations` は実施日降順で2件 | P.3／§3.5 |
| P-TC-205 | api | 前提詳細（検証履歴＋リンク先＋related_info） | リンク有り前提 | `GET /assumptions/{id}` | validations 時系列・linked_concepts[]（criticality/is_stale）・related_info（target_type=assumptions） | P.3 |
| P-TC-206 | api | 前提削除はリンク有りで 409（先に解除を促す） | リンク有り | `DELETE /assumptions/{id}` | 409（未リンクは 204） | P.3 |
| P-TC-207 | api | 反証波及＝refuted で全リンク先 stale＋通知 | 前提を2コンセプトにリンク | `POST .../validations`（refuted） | 両コンセプトのリンク `is_stale=true`・各作成者＋評価者へ通知（H `info_refuting_raised` 相当/`assumption_refuted`） | P.7／§3.5 |

## 4. コンセプト↔前提リンク API（P.4）

> 対象＝`POST /concepts/{id}/assumptions`・`PATCH/DELETE /concepts/{id}/assumptions/{aid}`。既存前提の再利用が基本（プールから選ぶ）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-301 | api | リンク（重要度付き・同一クエスト限定） | コンセプト＋同一クエスト前提 | `POST .../assumptions`（criticality=major） | 201・link 生成・assumption スコープ生成 | P.4／§3.7 |
| P-TC-302 | api | 他クエストの前提はリンク不可 | 他クエスト前提 | `POST .../assumptions` | 422/403（スコープ外） | P.4／§1.1 |
| P-TC-303 | api | 重要度変更／stale 解除 | stale リンク | `PATCH .../assumptions/{aid}`（criticality/is_stale=false） | 200・更新反映（再評価の記録） | P.4 |
| P-TC-304 | api | リンク解除（前提本体・エビデンスは残す） | リンク有り | `DELETE .../assumptions/{aid}` | 204・前提/検証は残存（単一ソース） | P.4／§3.5 |

## 5. コンセプト評価 API（P.5・SC-62/SC-61 §4.6）

> 対象＝`GET /concepts/{id}/evaluation/me`・`GET /concepts/{id}/evaluation`・`PUT /concepts/{id}/evaluation`。門番＋（入力は）`evaluator`。`submitted` は中核5(1..5)＋総評＋recommendation をサーバー検証。visibility は F と同挙動。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-401 | api | 自分の評価取得（未作成は空） | evaluator・未評価 | `GET .../evaluation/me` | 200・未作成（空） | P.5 |
| P-TC-402 | api | 下書き保存（部分可・付与なし） | evaluator | `PUT`（中核一部・draft） | 200・draft・読み戻せる | P.5 |
| P-TC-403 | api | 確定＝中核5＋総評＋推奨 必須 | evaluator | `PUT`（中核5(1..5)＋overall＋recommendation・submitted） | 200・submitted・submitted_at | P.5／§3.6 |
| P-TC-404 | api | 確定の必須検証（中核欠け/総評空/推奨欠け） | evaluator | `PUT`（中核4 or overall 空 or recommendation なし・submitted） | 422（`errors[].field`） | P.5 |
| P-TC-405 | api | スコア範囲外（0/6）は 422 | evaluator | `PUT`（score=0/6） | 422（`scores`） | P.5 |
| P-TC-406 | api | 補助3は任意（未採点で確定可） | evaluator | `PUT`（中核5のみ・submitted） | 200（補助未採点でも可） | P.5／§3.6 |
| P-TC-407 | api | 集計（観点別平均・総合＝中核5・推奨分布・評価者一覧） | submitted 2名 | `GET .../evaluation` | aspects/overall_avg/evaluator_count=2/recommendations/evaluators[] | P.5 |
| P-TC-408 | api | limited は範囲外に完全非表示（分母除外） | limited＋party 評価 | 範囲外で `GET .../evaluation` | limited 除外集計・evaluators に出ない | P.5／F.1 |
| P-TC-409 | api | 入力は evaluator 権限必須 | パーティーだが evaluator なし | `PUT` | 403 | P.0/P.5 |
| P-TC-410 | api | 反証波及後の stale 表示（要再評価） | リンク前提が refuted | `GET .../evaluation`（my） | stale フラグ／要再評価が読める（SC-62 バナー源） | P.7／§3.5 |
| P-TC-456 | api | 評価の変更履歴＝確定ごとに版（下書きは版なし・§3.6） | evaluator | `PUT .../evaluation`（draft→submitted→submitted〔総評変更〕） | `GET .../evaluation/me` の `revisions` が rev2＋rev1（新しい順・初版空・rev2 に overall_comment） | §3.6／migration 0040 |
| P-TC-457 | api | 同一内容の再確定は版を進めない（既存仕様踏襲） | evaluator | `PUT .../evaluation`（同値 submitted×2） | `revisions` は rev1 のみ | §3.6 |
| P-TC-458 | api | コンセプト評価の確定版差分（recommendation=scalar） | 2版 | `GET .../evaluation/revisions/2/diff` | recommendation＝scalar・overall_comment＝text | §3.6 |

## 6. コンセプト投票 API（P.5b・SC-61 §4.5）

> 対象＝`POST/DELETE /concepts/{id}/vote`。賛成/反対の 1人1票・切替/取消・XP+5（各コンセプト初回・日次上限・アイデア投票と同ルール）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-451 | api | 投票（賛成/反対・upsert・集計） | パーティー | `POST .../vote`（approve）→（oppose） | 200・my_vote 切替・approve/oppose 集計反映 | P.5b／§3.4 |
| P-TC-452 | api | 取消 | 投票済み | `DELETE .../vote` | 200・my_vote 解除・集計減算 | P.5b |
| P-TC-453 | api | XP+5 は各コンセプト初回のみ（日次上限） | 未投票 | 初回 `POST .../vote`→切替→取消→再投票 | XP+5 は初回1回のみ（`activities` reason=concept_vote・冪等/日次上限） | P.5b／§7 |
| P-TC-454 | api | 確定応答に xp_delta（獲得フィードバック・#8） | 未投票 | 初回投票→再投票 | 初回 `xp_delta=5`・以降 0（金額の正はサーバー） | P.5b／#8 |
| P-TC-455 | api | 変更系の CSRF/未認証 | CSRF なし | `POST .../vote` | 403 csrf_failed／401 | A.0/P.8 |

## 7. コンセプト議論チャット API（P.6・E 再利用）

> 対象＝`GET /concepts/{id}/chat-scopes`・`POST /concepts/{id}/chat-scopes`・`GET/POST /concept-chat-scopes/{sid}/messages`・`POST .../read`。機構は E 共有（`chat_messages.concept_chat_scope_id`）。reactions/編集/削除は E の EP 流用（本テストは対象外＝E で担保）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-501 | api | スコープ一覧（総合/グループ/前提スレッド＋未読） | overall＋group＋assumption | `GET /concepts/{id}/chat-scopes` | items に kind/label/assumption_id?/position/unread_count・コンセプト単位ロールアップ | P.6／§3.7 |
| P-TC-502 | api | グループ・ルーム作成（owner・3〜5 の範囲） | owner | `POST /concepts/{id}/chat-scopes`（group） | 201・group 追加 | P.6 |
| P-TC-503 | api | メッセージ投稿（Idempotency-Key 必須・E 機構） | scope | `POST /concept-chat-scopes/{sid}/messages`（body） | 201・`chat_messages` に concept_chat_scope_id で紐付き・冪等 | P.6／E.3 |
| P-TC-504 | api | メッセージ取得（カーソル・E.1 同形） | メッセージ複数 | `GET .../messages?before=` | items（本文/添付/メンション/引用）・カーソル | P.6／E.1 |
| P-TC-505 | api | 既読位置更新（chat_reads・E.7 同型） | scope | `POST .../read`（last_read_message_id） | 204・未読数更新 | P.6／§5.31 |
| P-TC-506 | api | 門番（非パーティーはスコープ/投稿不可） | 非パーティー | `GET /concepts/{id}/chat-scopes`／`POST .../messages` | 404/403 | P.0 |
| P-TC-507 | api | グループ・ルームを複数作成（回帰・§5.45 の 3〜5） | owner | `POST /concepts/{id}/chat-scopes` を3ラベル | すべて 201・group 3件（0033 のユニークが group を潰し2個目 500 だった不具合＝migration 0036 で修正） | P.6／§5.45 |
| P-TC-510 | api | フル機能パリティ＝rich チャット GET（アイデアと同形・thread 経由） | scope | `GET /concept-chat-scopes/{sid}/chat` | thread_id＋data＋未読・chat_group_id は null（コンセプトは chat_group を持たない・§5.45） | P.6／E.1／§5.14b |
| P-TC-511 | api | フル機能パリティ＝コンセプトメッセージへ共通 message-id EP でリアクション | scope メッセージ | `POST /concept-chat-scopes/{sid}/chat-messages`→`POST /chat-messages/{id}/reactions` | 200・reactions.normal に付与（中核をホスト非依存で共有） | P.6／E.4／§5.14b |
| P-TC-512 | api | フル機能パリティ＝rich 既読 EP で未読カーソル前進 | scope メッセージ2件 | `POST /concept-chat-scopes/{sid}/chat/read` | rich GET の unread_count が減る | P.6／E.5／§5.14b |

## 8. エラー・セキュリティ横断（P.8）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-701 | api | 完了クエストは書込凍結（作成/編集/評価/投票/判定） | completed クエスト | 各変更系 | 409（invalid_state） | P.8／C.5 |
| P-TC-702 | api | テナント越境不可（他社DBのコンセプトID） | 別会社 | `GET /concepts/{id}` | 404（テナント分離） | P.0/P.8 |
| P-TC-703 | api | 監査列（作成/更新者・時刻）とソフトデリート | 変更操作 | 各更新 | created_by/updated_at 記録・削除は deleted_at | §5.38 |

## 9. 画面 e2e（SC-61 詳細・SC-60 登録編集・SC-62 評価・SC-12 コンセプトタブ）

> 対象＝フロント接続後の SC-61/SC-60/SC-62 と SC-12 §4.6。e2e は**契約の最終確認**（画面↔API）に限定し、分岐は §2〜§7 の api で担保。前提＝dev seed 一般ユーザー ACME-01（owner＝作成/選定/判定＋evaluator）。下地クエスト/アイデアは API で作成し teardown で論理削除。ガイダンス `.screen-purpose`（[デザイン標準](../画面設計/デザイン標準.md) §4.13）は reduce-motion 抑制テストを含む（[デザイン標準](../画面設計/デザイン標準.md) §4.9 と同方針）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| P-TC-801 | e2e | SC-12 コンセプトタブ＝一覧＋検証プール＋作成導線 | active コンセプト有 | SC-12 で 🧩 タブを開く | 一覧行・検証プール・「＋作成」→SC-60・行→SC-61 | SC-12 §4.6 |
| P-TC-802 | e2e | SC-60 登録＝由来選択＋スキーマ入力→SC-61 | パーティー | ＋作成→入力→保存 | draft 作成・SC-61 へ・総合ルーム生成 | SC-60／P.2 |
| P-TC-803 | e2e | SC-61 詳細＝スキーマ/前提と検証/投票/評価結果/総合判定/議論 | active コンセプト | SC-61 を開く | 各ブロック描画・投票インライン・💬グループ/前提スレッド導線・関連情報パネル | SC-61／P.1 |
| P-TC-804 | e2e | SC-62 評価＝中核5＋補助3＋総評＋推奨→SC-61 §4.6 反映 | evaluator | 評価する→採点→確定 | 集計・推奨分布が SC-61 §4.6 に反映 | SC-62／P.5 |
| P-TC-805 | e2e | ガイダンス ⓘ＝ホバー展開／クリックで全文／reduce で静止 | 任意画面 | ⓘ にホバー→クリック→reduce ON | 展開（隣を押さない）・全文ダイアログ・reduce で流れ静止 | デザイン標準 §4.13/§4.9 |

## 10b. 変更履歴＝内容の版＋意思決定ログ（変更履歴標準 §3.1/§3.2・migration 0037）

| TC-ID | 種別 | 目的（説明） | 前提 | 操作 | 期待 | 根拠 |
|---|---|---|---|---|---|---|
| P-TC-250 | api | 作成で初版・内容編集で版が増える | active コンセプト | `POST /quests/{id}/concepts`→`PATCH /concepts/{id}`（title 変更） | `GET .../revisions` が rev1（初版・changed_fields 空）＋rev2（changed_fields に title）を新しい順で返す | §3.1 |
| P-TC-251 | api | 空更新は版を進めない（既存仕様踏襲） | rev あり | `PATCH /concepts/{id}`（同値 or 変更なし） | 版数が増えない | §3.1 |
| P-TC-252 | api | 版差分（前版比較・text/scalar） | 2版 | `GET .../revisions/2/diff` | fields に変更フィールドの差分（title＝text segments） | §3.1 |
| P-TC-253 | api | 判断材料スナップショット | 投票/評価あり | `GET .../revisions` | 各版 context_snapshot に votes/eval/assumptions | §3.3 |
| P-TC-254 | api | 総合判定の意思決定ログ | active | `POST /concepts/{id}/decision`（go・rationale） | `GET .../decision-log` に kind=decision・from/to・reason・context_snapshot | §3.2 |
| P-TC-255 | api | ステータス遷移の意思決定ログ | draft | `POST /concepts/{id}/activate` | decision-log に kind=status（draft→active） | §3.2 |
| P-TC-256 | api | 履歴の門番（非パーティーは 404） | 非パーティー | `GET .../revisions`／`.../decision-log` | 404（存在秘匿） | P.0 |

## 10. 未確定・実装時に詰める（テスト観点）

- **議論アクティビティ集計 API**（SC-61 §4.8）＝P に EP 追加の是非（アイデア `activity` 相当）。追加時に集計 TC を起こす。
- **XP/コイン**＝投票 XP+5 は本版で付与（P-TC-453/454）。評価/選定/投稿の付与は実装時判断（F 踏襲するか）＝確定時に TC 追加。
- **集計の重み付け**（criticality × 前提判定）＝Phase2。導入時に P-TC-012/407 を拡張。
- **版管理**（`concept_revisions`）＝**実装済**（10b・変更履歴標準 Phase 1・migration 0037）。評価/振り返り/クエストの版は後続フェーズ。
- **付随＝関連リンク対象ピッカーへ concepts/assumptions 追加**（N `search_link_candidates` が現状 else→[]）＝実装時に N 側 TC も更新（[API設計 P_コンセプト](../API設計/P_コンセプト.md) P.10）。
