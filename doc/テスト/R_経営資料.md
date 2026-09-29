# R. 経営資料・整合 テストパターン（FR-44・API設計 R・データモデル §5.54-5.55）

> トレーサビリティ＝設計書→本 md（TC-ID・`根拠` 列）→テストコード（テスト規約 §5）。TC-ID は `R-TC-1xx`（api/int）・`R-TC-2xx`（e2e/unit）で採番。設計元＝[経営資料整合・自動関連付け 設計](../設計ドラフト/経営資料整合・自動関連付け_設計.md)。
>
> Phase1 を Step 単位で実装＝Step2 CRUD／Step3 整合率＋コイン／Step3ب 埋め込み／Step4 機会脅威率／Step5 エクスポート。各 Step 着手時に本 md へ TC 行（`根拠` 付き）を追加してからテストコードを書く（md 無しでコード書かない・CLAUDE.md）。

## 1. 経営資料 CRUD（R.1・SC-80/81/82・Step2）

> 権限＝`company_account_admin`/`system_admin` のみ変更可（一般/クエスト権限は 403）。検証＝§4.7（title 必須・doc_kind ホワイトリスト・period_from<=period_to）。`body_text` 連結＋`entity_tokens`（owner_type='strategy_doc'）同期。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| _（Step2 で追加）_ | | | | | | |

## 2. 整合率＋コイン（R.2/R.3・SC-22・Step3）

> 整合率＝`SimilarityProvider`（keyword TF-IDF cosine）→`idea_alignment` upsert・最大採用＋effective tokens。コイン＝段階（≥50→+3/≥70→+7/≥90→+15）・冪等・初回のみ・下げない。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| _（Step3 で追加）_ | | | | | | |

## 3. 機会/脅威/影響率（R.4・Step4）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| _（Step4 で追加）_ | | | | | | |

## 4. Markdown エクスポート（R.5・Step5）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| _（Step5 で追加）_ | | | | | | |
