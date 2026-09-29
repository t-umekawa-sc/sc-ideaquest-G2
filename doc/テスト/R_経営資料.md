# R. 経営資料・整合 テストパターン（FR-44・API設計 R・データモデル §5.54-5.55）

> トレーサビリティ＝設計書→本 md（TC-ID・`根拠` 列）→テストコード（テスト規約 §5）。TC-ID は `R-TC-1xx`（api/int）・`R-TC-2xx`（e2e/unit）で採番。設計元＝[経営資料整合・自動関連付け 設計](../設計ドラフト/経営資料整合・自動関連付け_設計.md)。
>
> Phase1 を Step 単位で実装＝Step2 CRUD／Step3 整合率＋コイン／Step3ب 埋め込み／Step4 機会脅威率／Step5 エクスポート。各 Step 着手時に本 md へ TC 行（`根拠` 付き）を追加してからテストコードを書く（md 無しでコード書かない・CLAUDE.md）。

## 1. 経営資料 CRUD（R.1・SC-80/81/82・Step2）

> 権限＝`company_account_admin`/`system_admin` のみ変更可（一般/クエスト権限は 403）。検証＝§4.7（title 必須・doc_kind ホワイトリスト・period_from<=period_to）。`body_text` 連結＋`entity_tokens`（owner_type='strategy_doc'）同期。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-101 | api | 作成＝201＋body_text 連結＋トークン永続化（owner='strategy_doc'） | company_account_admin | `POST /strategy-documents`（構造化項目） | 201・`status=active`／`entity_tokens`（owner_type='strategy_doc'）が生成される | R.1／§5.54/§5.36b |
| R-TC-102 | api | 管理一覧に出る／一般ユーザーは 403 | admin で1件作成 | admin `GET /strategy-documents?q=`／一般 `GET` | admin＝data に作成分・page_info.total≥1／一般＝403（管理者スコープ・R.0） | R.1／R.0 |
| R-TC-103 | api | 選択用一覧はクエスト作成者可・active のみ・軽量 | admin で1件作成 | 一般ユーザーで `GET ?for=selection&q=` | 200・作成分を含む・キーは `{id,title,doc_kind,period_from,period_to}` のみ（全文/率なし） | R.0／R.1 |
| R-TC-104 | api | 更新＝反映＋トークン再永続化／doc_kind 不正・期間逆転は 422 | admin で1件作成 | `PATCH`（strategy 変更）／`PATCH`（doc_kind=bogus）／`PATCH`（period_from>period_to） | 前者200・反映／後2つ 422（field=doc_kind／period_to） | R.1／§4.7 |
| R-TC-105 | api | 変更系の CSRF/認可 | admin／一般 | CSRF 無し `POST`／一般ユーザー `POST`（CSRF有） | いずれも 403（csrf_failed／forbidden） | R.0／A.0 |
| R-TC-106 | api | アーカイブ（論理削除）＝status=archived・選択用一覧から除外（物理削除はしない） | admin で1件作成 | `POST /{id}/archive`→一般で `?for=selection` | archived・選択用一覧に出ない（active のみ）・レコードは残る | R.1／R.0 |
| R-TC-107 | api | 復元（アーカイブ解除）＝active に戻り選択用一覧に再掲（誤アーカイブの復元） | admin で1件作成→archive | `POST /{id}/unarchive`→一般で `?for=selection` | status=active・選択用一覧に再び出る | R.1 |
| R-TC-108 | api | 経営資料←→クエストの紐づけ（候補検索/追加/解除）＋クエスト版履歴に記録・authz | admin で資料＋クエスト作成 | `GET /quest-candidates`／`POST /{id}/quests`／`GET /{id}/quests`／`DELETE /{id}/quests/{qid}`／一般で `GET /{id}/quests` | 候補に出る／追加で linked に出る／版履歴（quest_revisions）の changes に `strategy_documents`（資料タイトル）が載る／解除で消える／一般は 403 | R.1b／§5.56／§3.1 |

## 2. 整合率＋コイン（R.2/R.3・SC-22・Step3）

> 整合率＝`SimilarityProvider`（keyword TF-IDF cosine）→`idea_alignment` upsert・最大採用＋effective tokens。コイン＝段階（≥50→+3/≥70→+7/≥90→+15）・冪等・初回のみ・下げない。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-201 | int | 整合率＝母集合（クエストの選択資料）でキーワード cosine を算出→best・効いた語を idea_alignment に保存／best 段階でコイン初回付与（冪等） | アイデア・経営資料・quest_strategy_documents・両者の entity_tokens（cosine≈0.924）をシード | `alignment.recompute_for_idea(award=True)`×2 | best≥0.9／idea_alignment 1行・matched_tokens に「脱炭素」／`alignment_payload` の best_strategy=当該資料・coins_awarded=15／コイン付与は初回のみ（activities 1件・exists_ref 冪等） | R.2／R.3／§5.55 |

## 3. 機会/脅威/影響率（R.4・Step4）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| _（Step4 で追加）_ | | | | | | |

## 4. Markdown エクスポート（R.5・Step5）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| _（Step5 で追加）_ | | | | | | |
