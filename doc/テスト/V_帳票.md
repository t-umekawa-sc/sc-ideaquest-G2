# V. 帳票・レポート テストパターン（API設計 V・設計ドラフト 帳票連携(JasperReports)）

> トレーサビリティ＝設計書→本 md（TC-ID・`根拠` 列）→テストコード（[テスト規約](../規約/テスト規約.md) §5）。TC-ID は `V-TC-1xx`（api/int）・`V-TC-2xx`（e2e/unit）で採番。設計元＝[帳票連携(JasperReports) 設計](../設計ドラフト/帳票連携(JasperReports)_設計.md)・[API設計 V_帳票・レポート](../API設計/V_帳票・レポート.md)。
>
> **状態＝実装済み（2026-10-09・V-TC-101〜108/201〜204/210/211 green）**。**Jasper 呼び出しはテストを不安定化**＝レンダラは `FakeRenderer`（決定的スタブ・外部未接続）で差し替える（S ドメインの Fake ゲートウェイと同方針）。初版の縦1本＝`company_usage_invoice`（SC-93 会社アカウント管理→API→レンダラ port→実 Jasper 描画→PDF バイト列ダウンロード）。

## 1. レンダラ port・切り離し（設計 §6/§12・V.4）

> `REPORT_RENDERER=jasper|fallback|none` で描画実装を差し替え。帳票データ組み立て（`domain/invoice.py`）はレンダラ非依存。`report_key` はホワイトリスト解決（R5）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| V-TC-201 | unit | 帳票データ組み立て＝`InvoiceReportData` が会社/期間/明細/合計を正しく構築（レンダラ非依存） | 会社・period 指定 | `domain/invoice.build(company, period)` | 期待フィールド（company_code/period/lines/total）を持つ純データを返す（I/O なし） | 設計 §6 |
| V-TC-202 | unit | `report_key` ホワイトリスト＝未知キー/パス的入力は拒否（パストラバーサル防止） | registry 定義済み `company_usage_invoice` のみ | `registry.resolve_template('../../etc/passwd')` 等 | 例外（`ReportConfigError`）・ファイルパスを組み立てない | 設計 §11・R5 |
| V-TC-203 | int | `fallback` レンダラ＝Jasper 無しで PDF バイト列を生成（全機能稼働） | `REPORT_RENDERER=fallback` | application.render_invoice(...) | 非空のバイト列・先頭が PDF マジック（`%PDF-`）・Jasper へ未接続 | 設計 §12 |
| V-TC-204 | int | `jasper` レンダラ＝FakeRenderer 注入でバイト列を返す（S2S body に report_key/format/data が渡る） | `REPORT_RENDERER=jasper`・FakeRenderer 注入 | application.render_invoice(...) | FakeRenderer が受けた引数＝`{report_key:'company_usage_invoice',format:'pdf',data:...}`・返りバイト列をそのまま返す | 設計 §4・V.2 |

## 2. エンドポイント・認可・検証（API設計 V.0/V.1）

> `GET /admin/companies/{id}/billing/invoice`。会社管理者のみ・他社は 404・GET ゆえ CSRF 不要。`period` 検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| V-TC-101 | api | 正常＝請求書 PDF を attachment でストリーム返却 | 会社管理者・`REPORT_RENDERER=fallback`（or Fake） | `GET /admin/companies/{id}/billing/invoice?period=2026-09&format=pdf` | 200・`Content-Type: application/pdf`・`Content-Disposition: attachment; filename="invoice-{code}-2026-09.pdf"`・body 非空 | V.1 |
| V-TC-102 | api | 認可＝一般/クエスト権限ユーザーは 403 | 非管理者 | 同上 GET | 403（`forbidden`） | V.0 |
| V-TC-103 | api | テナント境界＝他社の company_id は 404（存在秘匿） | 会社A の管理者 | 会社B の `{id}` で GET | 404 | V.0・README §1.5 |
| V-TC-104 | api | `period` 不正＝422（field=period） | 会社管理者 | `?period=2026/9` 等 | 422・`invalid_period`・field=period | V.1 |
| V-TC-105 | api | 未対応 `format`＝422 | 会社管理者 | `?period=2026-09&format=docx` | 422・`unsupported_format`・field=format | V.1 |
| V-TC-106 | api | 機能オフ＝`REPORT_RENDERER=none` で 503 | `REPORT_RENDERER=none` | 正常 GET | 503・`report_disabled`（フロントはボタン非活性） | V.1・設計 §12 |
| V-TC-107 | api | バックエンド不達＝`jasper` 選択時に Jasper 到達不可で 502 | `REPORT_RENDERER=jasper`・Fake が `ReportUnavailable` | 正常 GET | 502・`report_backend_unavailable`（再試行可メッセージ） | V.1 |
| V-TC-108 | api | 監査＝請求書 DL で `billing.invoice_download` が記録（誰が/会社/期間/形式・本文/金額は残さない） | 会社管理者・FakeRenderer | 正常 GET | system_audit に `billing.invoice_download` 1件・detail に company_id/period/format・明細/金額なし | 設計 §17.5 G3 |

## 3. フロント連携・受入（SC-92・設計 §13）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| V-TC-210 | e2e | SC-93 から会社管理者が自社の請求書 PDF をダウンロード（同一オリジン GET・Cookie 認証） | 会社管理者/OPS ログイン・`jasper`（実描画）or `fallback` | SC-93（/admin/accounts）で期間選択→ダウンロードボタン | ブラウザにファイルが保存される（download イベント・filename `invoice-{code}-{period}.pdf`）・Jasper URL はフロントに露出しない | 設計 §13・V.3 |
| V-TC-211 | e2e | 機能可否＝`GET /me` の `company.report_enabled` とボタン活性が一致（none で非活性＋ツールチップ） | デプロイの `REPORT_RENDERER` | SC-93 表示 | report_enabled=false ならボタン disabled・ツールチップ／true なら活性 | 設計 §13 |
