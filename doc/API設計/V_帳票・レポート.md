# V. 帳票・レポート（JasperReports 疎結合連携・PDF 出力）

> 横断規約＝[API設計 README](README.md)（§1.4 認証/CSRF・§1.5 テナント分離・§1.10 画像/ファイル）。設計元＝[帳票連携(JasperReports) 設計](../設計ドラフト/帳票連携(JasperReports)_設計.md)。画面＝[SC-92 会社詳細](../画面設計/screens/SC-92_会社詳細.md)（請求書ダウンロード）。
>
> **状態＝ドラフト（実装未着手・2026-10-08 方針確定）**。帳票は**レンダラ port（`infra/reports`）**を介した疎結合構成＝「帳票データの組み立て（自前ドメイン）」と「描画（Jasper／純 Python fallback）」を分離。`REPORT_RENDERER=jasper|fallback|none` で着脱（§V.4）。**バックエンドが唯一の窓口**で、Jasper はブラウザに露出しない（S2S・内部ネットワーク）。

## V.0 アクター・認可スコープ

| 操作 | 権限 | 補足 |
| --- | --- | --- |
| 使用料請求書ダウンロード | **`company_account_admin` / `system_admin`** | 機微（請求情報）＝会社管理者スコープ。一般/クエスト権限では不可（403） |

- テナント/会社境界＝他社の `{company_id}` は存在秘匿で 404（README §1.5）。
- ダウンロードは **GET（状態変更なし）** ゆえ CSRF 不要（README §1.4）。認証は Cookie セッション（同一オリジン）。

## V.1 使用料請求書（会社詳細・同期ストリーム）

| メソッド / パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /admin/companies/{id}/billing/invoice` | 使用料請求書を帳票レンダラで生成し**バイト列でストリーム返却**（同期） | パス: `id`（会社）／クエリ: `period`（`YYYY-MM`・必須）・`format`（`pdf` 既定） | `200` 帳票バイト列＋`Content-Type: application/pdf`＋`Content-Disposition: attachment; filename="invoice-{company_code}-{period}.pdf"` |

- **検証（§4.7）**＝`period` は `^\d{4}-\d{2}$`（不正は 422・`field=period`）。`format` はホワイトリスト（`pdf` のみ初期・将来 `xlsx`/`csv`）。`report_key` はクライアント入力を受けず**サーバー内部でホワイトリスト固定**（`company_usage_invoice`）＝パストラバーサル防止（設計 §11・R5）。
- **データ組み立て**＝`control_plane/billing/domain/invoice.py`（純粋・レンダラ非依存）が `InvoiceReportData`（会社・期間・明細・合計など）を構築。MVP はサンプル値で可。
- **描画**＝`infra/reports` の `ReportRenderer.render(report_key, data, fmt)` を application が呼ぶ。実装は env で解決（§V.4）。
- **「誰がファイルを返すか」**＝**バックエンドが取りに行き、バックエンドが返す**。`jasper` 時は backend が Jasper に S2S（JSON body）でデータを渡し、返ったバイト列をそのままブラウザへストリーム。Jasper の URL はフロントに出さない（設計 §3）。

### エラー

| 状況 | ステータス | body（`{error:{code,message}}`） |
| --- | --- | --- |
| `period` 不正 | 422 | `invalid_period`（field=period） |
| 未対応 `format` | 422 | `unsupported_format`（field=format） |
| 他社/存在しない会社 | 404 | 存在秘匿（README §1.5） |
| 権限不足 | 403 | `forbidden` |
| `REPORT_RENDERER=none`（帳票機能オフ） | 503 | `report_disabled`（フロントはボタン非活性＝設計 §13） |
| `jasper` 選択時に Jasper 到達不可/タイムアウト | 502 | `report_backend_unavailable`（再試行可メッセージ） |

## V.2 内部 S2S 契約（backend → Jasper・`jasper` 時のみ）

> ブラウザからは呼ばれない。内部ネットワーク限定＋共有シークレット。サンプルの `GET /generate`（query＋DB 直結）を、**JSON body でデータを渡す `POST /render`** へ小改修して用いる（設計 §4）。

| メソッド / パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST {JASPER_BASE_URL}/render` | jrxml（`report_key` で解決）に **JSON データを流し込み**描画 | ヘッダ: `X-Report-Secret: {JASPER_SHARED_SECRET}`／body: `{report_key, format, data}` | `200` 帳票バイト列（`application/octet-stream`） |

- Jasper 側は jrxml を **JSON データアダプタ**で構成（SQL を除去）＝DB 資格情報不要（R4）。`report_key` はサービス内の `reports/{group}/{report_key}.jrxml` にマップ（ホワイトリスト・R5）。
- 認証＝`X-Report-Secret` 一致（不一致は 401）。サンプルの未実装認証（R3）を埋める。

## V.3 フロント連携（SC-92）

- 既存 CSV エクスポートと同じ seam＝**同一オリジンの GET ナビゲーション**（`features/companies/api.ts` の `companiesCsvUrl()` に倣い `invoiceUrl(companyId, period)` を追加）。`window.open` で Jasper を直接叩かない。
- `REPORT_RENDERER=none` 時はボタン非活性＋ツールチップ（設計 §13）。

## V.4 レンダラ選択・設定（env）

| env | 既定 | 用途 |
| --- | --- | --- |
| `REPORT_RENDERER` | `none` | `jasper`／`fallback`（純 Python）／`none`（機能オフ） |
| `JASPER_BASE_URL` | `http://jasper:8000` | 内部エンドポイント（内部ネットワークのみ） |
| `JASPER_TIMEOUT_SECONDS` | `30` | Jasper 呼び出しタイムアウト |
| `JASPER_SHARED_SECRET` | （空） | S2S 認証ヘッダ（`X-Report-Secret`） |

- **疎結合の担保**＝`fallback` は Jasper 不在でも PDF を生成（全機能稼働）。`none` は機能のみ無効化しアプリ本体は無影響。テストは `FakeRenderer` 注入（決定的・外部未接続＝S ドメインの Fake ゲートウェイと同方針）。

## V.5 非同期化（将来・MVP 非対象）

- 重い帳票・一括出力は [S_AIジョブ・LLM連携](S_AIジョブ・LLM連携.md) のジョブ基盤と同型で非同期化：`POST .../reports:render`（202＋`job_id`）→ WS/ポーリングで完了検知 → MinIO 署名 URL（§1.10・既存添付と同 seam）でダウンロード。**MVP では採用せず拡張点として明記のみ**（過剰設計回避）。
