# 帳票連携（JasperReports）機能 — 設計ドラフト（疎結合な帳票出力基盤）

> 状態: **実装済み（2026-10-09・フル＝実 JasperReports 連携まで）**。(1) データ・プッシュ(JSON)／(2) 同期ストリーム／(3) `fallback`(純 Python) に加え、**(4) 実 Jasper サービス**（`impl/jasper`・内部 network `jasper_net`・`POST /render`・S2S `X-Report-Secret`・jrxml ベイク）まで構築し、SC-92 からの請求書 PDF ダウンロードを**実 Jasper 描画でエンドツーエンド確認済み**。請求書データは固定サンプル値・jrxml は英字サンプルレイアウト（和文化は台帳 F8）。実体＝`app/infra/reports/*`・`app/control_plane/billing/*`・`impl/jasper/*`・SC-92 `CompanyDetailView`。残 follow-up＝台帳 F8〜F11。参照表記は [ドキュメント作成規約](../規約/ドキュメント作成規約.md) 準拠（文書間参照は文書名接頭辞）。
> 関連正本＝[コーディング規約](../規約/コーディング規約.md)（§2 セキュリティ・§2.3 DRY・§3.4 バックエンド4層）・[WEBアプリ開発時のセキュリティ対策一覧](../WEBアプリ開発時のセキュリティ対策一覧.md)・[API設計 README](../API設計/README.md)（§1.x 横断規約）・[データモデル](../データモデル.md)・[本番デプロイ要件](../本番デプロイ要件.md)。
> 実体化先＝[API設計 V_帳票・レポート](../API設計/V_帳票・レポート.md)・[テスト V_帳票](../テスト/V_帳票.md)。初回の縦1本＝**会社詳細（[SC-92](../画面設計/screens/SC-92_会社詳細.md)）から使用料請求書 PDF をダウンロード**。
> 提供参考資料＝JasperReports × Python 連携サンプル（`pyreportjasper` + FastAPI・`v_pythonjasper`・2026-05-13 納品）。本書はその統合設計。

## 0. 位置づけ・狙い

- **フロント →（自前バックエンド経由）→ JasperReports で帳票を出力し、ブラウザに PDF がダウンロードされる**一連の仕組みを、**疎結合**（JasperReports が無くてもアプリが動く）に構築する。
- 帳票ロジック（＝何を印字するかのデータ組み立て）を**レンダリング・エンジン（Jasper）から切り離す**。Jasper は差し替え可能な 1 レンダラに過ぎない設計にする。
- **なぜ疎結合か**＝(a) Jasper は Java 製の重い外部依存（JVM・jrxml テンプレ）で、開発/テスト/小規模デプロイでは不在のことがある。(b) 帳票は将来エンジンが変わり得る（Jasper→別エンジン）。データ組み立てをエンジンに密結合させると移行で業務ロジックごと壊れる。

## 1. 提供サンプルのレビュー（現状分析と課題）

`v_pythonjasper` は**独立した FastAPI サービス**（`:8000`）で、`GET /generate?report_id&format&group` を受け、`reports/{group}/{report_id}.jrxml` を `pyreportjasper` で実行し `FileResponse` で返す。付属 `sample.ts` はフロントから `window.open('http://localhost:8000/generate?...')` で**直接**叩く構成。Jasper は `config.ini` の DB 資格情報で DB へ JDBC 接続し、jrxml 内の SQL（`SELECT ... FROM accounts`）でデータを取得する（DB 直結型）。

そのまま本番統合すると以下が問題になる（本設計で解消する）。

| # | サンプルの実装 | 課題 | 本設計での対処 |
|---|---|---|---|
| R1 | フロントが Jasper(`:8000`) を直接叩く（`window.open`） | 認証・テナント境界を素通り。Jasper がブラウザに露出 | **自前バックエンドを唯一の窓口**にし、Jasper は内部ネットワーク限定（§3） |
| R2 | `CORSMiddleware(allow_origins=["*"])` | 本番で危険 | ブラウザから直接呼ばない設計ゆえ CORS 不要（内部 S2S・§11） |
| R3 | `# ここに認証ロジックを組み込む`（未実装） | 無認証 | バックエンド側で認可（会社管理者のみ）＋ S2S は共有シークレット（§11） |
| R4 | `config.ini` に DB 資格情報・jrxml 内に `SELECT ... FROM accounts`（JDBC 直結） | Jasper が**我々の DB スキーマ・テナント分割・資格情報に密結合** | **データ・プッシュ型**（JSON データソース）へ切替。Jasper から DB 資格情報を排除（§4） |
| R5 | `reports/{group}/{report_id}.jrxml` を query から直接組み立て | **パストラバーサル**（`report_id=../../etc`） | `report_key` を**ホワイトリスト**（レジストリ）で解決（§11） |
| R6 | `/tmp/{report_id}.{fmt}` に出力し削除しない | 一時ファイル・リーク／多テナントで衝突 | バイト列でストリームし即破棄、重い帳票は MinIO 短 TTL（§8） |
| R7 | 同期 `window.open` 固定 | 重い帳票で UX 劣化 | MVP は同期ストリーム、重い帳票は AI ジョブ基盤パターンで非同期化（§9） |

> つまりサンプルは「Jasper 単体の動作確認用」としては有効。統合点はバックエンドに寄せ、**Jasper を純粋なレンダリング・エンジンに限定**するのが本設計の肝。

## 2. 設計方針（疎結合の 3 原則）

1. **バックエンドが唯一の窓口**。フロントは自前 API だけを叩く。Jasper はブラウザから見えない内部サービス。
2. **帳票ロジックとレンダリングの分離**。「何を印字するか（データ組み立て）」は自前ドメインの純粋ロジック、「どう描画するか（PDF 化）」は差し替え可能な**レンダラ port**。Jasper は後者の 1 実装。
3. **env ゲートで着脱**。`REPORT_RENDERER=jasper|fallback|none` で切替。Jasper 未デプロイでもアプリは落ちない。
   - **なぜ**＝[S_AIジョブ・LLM連携](../API設計/S_AIジョブ・LLM連携.md) の LLM ゲートウェイ（`infra/llm`・env 可変・Fake 注入でテスト）と同作法に揃える＝既存知見の再利用（DRY・コーディング規約 §2.3）。

## 3. アーキテクチャ全体像

```
 ブラウザ(SC-92)
    │  ① GET /api/v1/admin/companies/{id}/billing/invoice?period=YYYY-MM  (同一オリジン, Cookie認証)
    ▼
┌──────────────────────────── 自前 Backend (FastAPI) ─────────────────────────────┐
│  router(認可: 会社管理者)                                                          │
│     └─ application                                                               │
│          ├─ ② domain: 請求書データ組み立て(純粋) → InvoiceReportData (JSON可)      │
│          └─ ③ infra/reports: ReportRenderer port で描画                          │
│                 ├─ JasperHttpRenderer ──④ POST /render (JSON body, S2S秘密) ──┐  │
│                 └─ FallbackPdfRenderer (純Python, Jasper不要)                 │  │
└──────────────────────────────────────────────────────────────────────────────┼──┘
    ▲  ⑥ 200 OK: PDFバイト列 (Content-Disposition: attachment)                    │
    │                                                                            ▼
    │                                        ┌──── Jasper Service (内部のみ) ────┐
    └────────────── ⑥ ブラウザへストリーム ──┤  /render: JSONデータ+テンプレIDで  │
                                             │  jrxml実行 → PDFバイト列を返す ⑤  │
                                             └──────────────────────────────────┘
```

**「誰がファイルを持つか」の結論**＝**バックエンドが取りに行き、バックエンドが返す**。Jasper → バックエンド（S2S・バイト列）→ ブラウザへストリーム。フロントは既存 CSV エクスポートと同じ seam（同一オリジンの GET ナビゲーション）でダウンロードするだけで、Jasper の URL はフロントに一切出さない。
- **なぜ**＝認可・テナント解決・CSRF/Cookie の作法を**既存バックエンドに集約**でき、Jasper を露出しないため（R1〜R3 を構造的に封じる）。

## 4. データ連携モデル＝データ・プッシュ（JSON）【決定】

Jasper へのデータ供給は 2 通り。**(B) データ・プッシュを本線に採用**（§5 決定）。

| | (A) DB 直結（サンプル方式） | (B) データ・プッシュ（JSON データソース）★採用 |
|---|---|---|
| 仕組み | jrxml に SQL、Jasper が DB へ JDBC 接続 | バックエンドが JSON を組み立て Jasper に渡す。jrxml は JSON データアダプタ |
| 結合度 | Jasper が我々のスキーマ・テナント分割・DB 資格情報に**密結合** | Jasper は**スキーマを知らない**純粋レンダラ |
| マルチテナント | 会社別 DB ルーティングを Jasper 側で再実装が必要（破綻しやすい） | バックエンドが解決済みのデータを渡すだけ |
| セキュリティ | Jasper に DB 資格情報（R4） | Jasper から DB 資格情報を**排除** |
| サンプルからの変更 | ほぼ無改修 | Jasper 側を「JSON を受けて描画」に小改修 |

- **採用理由**＝疎結合・マルチテナント・セキュリティ（特に R4）を満たすのは (B) のみ。「帳票ロジック切り離し」の主要件とも整合する。
- **(A) 不採用理由**＝サンプル無改修は魅力だが、会社別 DB（[API設計 README §0](../API設計/README.md) の 2 層 DB・動的ルーティング）を Jasper 側に再実装させる必要があり、資格情報も分散する。初回スパイク検証に限り (A) を許容するが、本線には載せない。
- **Jasper 側の必要改修（最小 2 点）**＝(a) jrxml を JSON データアダプタ化（SQL を除去）、(b) `/render` を JSON body 受けに変更。これで `config.ini` の `[DATABASE]` 節は丸ごと不要になる。

## 5. 決定事項（2026-10-08 レビューで確定）

| 決定点 | 確定 | なぜ |
|---|---|---|
| データ連携（§4） | **データ・プッシュ（JSON）** | Jasper から DB 資格情報・スキーマ依存を排除（R4 解消）・純レンダラ化で疎結合／マルチテナント対応 |
| 出力方式（§9） | **MVP は同期ストリーム** | 既存 CSV エクスポートと同形。請求書は軽量で受入基準（落ちれば OK）に十分・実装最小 |
| 切り離し（§12） | **`fallback`（純 Python）を用意** | `REPORT_RENDERER=jasper/fallback/none`。Jasper 無しでも PDF が落ちる＝主要件を完全充足 |

## 6. バックエンド設計（4 層＋レンダラ port）

[コーディング規約 §3.4](../規約/コーディング規約.md) の 4 層に準拠。帳票**基盤**は `infra`（LLM の `infra/llm` と同じ立ち位置）、請求書**機能**はコントロールプレーン（SC-92 は admin 画面）に置く。

```
app/infra/reports/            ← 帳票基盤
  ├─ port.py                  ReportRenderer(Protocol): render(report_key, data, fmt) -> bytes
  ├─ jasper_http.py           JasperHttpRenderer   (HTTP で Jasper を呼ぶ)
  ├─ fallback_pdf.py          FallbackPdfRenderer  (純 Python: reportlab 等で PDF/HTML/CSV)
  ├─ registry.py              report_key のホワイトリスト解決(R5) + レンダラ選択(env)
  └─ errors.py                ReportUnavailable / ReportConfigError

app/control_plane/billing/    ← 請求書「機能」(4層)
  ├─ router.py                GET .../invoice  (認可→application→Response でストリーム)
  ├─ schemas.py               期間パラメータ等の DTO
  ├─ application.py           ②データ組み立て呼び出し→③レンダラ選択→bytes 返却
  └─ domain/
       └─ invoice.py          InvoiceReportData 構築(純粋・レンダラ非依存＝これが「帳票ロジック」)
```

**切り離しの核心**＝`domain/invoice.py`（何を印字するか）はレンダラを知らない。`infra/reports/port.py` の `ReportRenderer` を介してのみ描画し、`JasperHttpRenderer` / `FallbackPdfRenderer` を env で差し替える。テストは `FakeRenderer` を注入（既存 `set_chat_client(FakeChat)` と同作法・[テスト S_AIジョブ](../テスト/S_AIジョブ.md) の Fake ゲートウェイ方針に揃える）。

## 7. API 設計（新ドメイン V）

詳細は [API設計 V_帳票・レポート](../API設計/V_帳票・レポート.md)。MVP は同期・既存 CSV エクスポート（`GET /admin/companies?format=csv`）と同形。

| メソッド | パス | 認可 | 返却 |
|---|---|---|---|
| GET | `/api/v1/admin/companies/{id}/billing/invoice?period=YYYY-MM&format=pdf` | 会社管理者（既存 SC-92 認可を再利用） | `200` PDF バイト列 + `Content-Disposition: attachment; filename="invoice-{company}-{period}.pdf"` |

- `format` は `pdf` 既定（将来 `xlsx`/`csv` は Jasper の `output_formats` で拡張）。`period` は `^\d{4}-\d{2}$` 検証。`report_key` は内部ホワイトリスト固定（外部から任意テンプレ指定をさせない＝R5）。
- Jasper 停止時＝`fallback` なら純 Python 生成、`jasper` でダウン時は `502`（再試行可メッセージ）、`none` は `503`／ボタン非活性。

## 8. 一時ファイルの扱い（R6）

- **MVP（同期）**＝Jasper からバイト列で受領→そのまま `Response` でストリーム→保持しない。サンプルの `/tmp` 書き捨ては不採用。Jasper サービス側で一時生成する場合は生成直後に削除（finally）。
- **非同期（将来）**＝MinIO に短 TTL（既存 `minio_url_ttl_seconds` 既定 300s）で置き、署名 URL を返す（既存添付ダウンロードと同じ seam・[D_アイデア・添付・版・投票・フォロー](../API設計/D_アイデア・添付・版・投票・フォロー.md)）。

## 9. 同期 / 非同期【MVP=同期】

- **MVP は同期ストリーム**（§5 決定）。Jasper 呼び出しに `JASPER_TIMEOUT_SECONDS`（既定 30s 程度）を設定。
- 重い帳票や一括出力が出てきたら [S_AIジョブ・LLM連携](../API設計/S_AIジョブ・LLM連携.md) のジョブ基盤と同型で非同期化（202＋job_id→WS/ポーリング→署名 URL）。**最初から両対応を作り込まない**（過剰設計回避）。

## 10. 設定・デプロイ

`impl/compose.yaml` に Jasper を内部サービスとして追加（公開ポートを張らない）。backend から `http://jasper:8000` で到達。

| env | 既定 | 用途 |
|---|---|---|
| `REPORT_RENDERER` | `none` | `jasper`/`fallback`/`none`（着脱スイッチ） |
| `JASPER_BASE_URL` | `http://jasper:8000` | 内部エンドポイント |
| `JASPER_TIMEOUT_SECONDS` | `30` | タイムアウト |
| `JASPER_SHARED_SECRET` | （空） | S2S 認証ヘッダ。**env 直置きは §17.5 G1 で撤回**＝compose `secrets:` ファイルマウント（`/run/secrets/<name>`）で供給する |

- jrxml テンプレートは Jasper サービスのイメージ内（`reports/{group}/{id}.jrxml`）にバージョン管理。
- 本番要件（ネットワーク分離・ヘルスチェック・JVM headless）は [本番デプロイ要件](../本番デプロイ要件.md) に追記。

## 11. セキュリティ（[WEBアプリ開発時のセキュリティ対策一覧](../WEBアプリ開発時のセキュリティ対策一覧.md) 突合）

- **Jasper 非公開**（内部ネットワークのみ・ブラウザ露出なし）。CORS `*` は不採用（R1/R2）。
- **認可**＝自前エンドポイントで会社管理者のみ（既存 SC-92 認可再利用）。他社請求書は存在秘匿で 404（[API設計 README §1.5](../API設計/README.md)・テナント分離）。
- **S2S 認証**＝`JASPER_SHARED_SECRET` ヘッダ（将来 mTLS 可）。サンプルの TODO（R3）を埋める。
- **パストラバーサル対策**（R5）＝`report_key` はレジストリのホワイトリスト解決。query から直接パスを組み立てない。
- **DB 資格情報の排除**（R4）＝データ・プッシュ採用で Jasper 側 `config.ini` の DB 接続を廃止。
- **入力検証**＝`period`/`format` を [デザイン標準 §4.7](../画面設計/デザイン標準.md) 相当で検証。CSRF は GET ダウンロードのため不要（状態変更なし・[API設計 README §1.4](../API設計/README.md)）。

## 12. 切り離し可能性（Jasper 無しで動く）＝主要件の担保【fallback 採用】

| `REPORT_RENDERER` | 挙動 |
|---|---|
| `jasper` | Jasper で高品質 PDF |
| `fallback` | 純 Python（reportlab 等）で PDF/HTML/CSV を生成。**Jasper 不要で全機能稼働** |
| `none` | 帳票機能オフ（ボタン非活性）。アプリ本体は無影響 |

帳票ロジック（`domain/invoice.py`）はレンダラ非依存なので、Jasper 撤去＝`jasper_http.py` を使わないだけ。ドメイン・API・フロントは無改修。

## 13. フロントエンド設計（SC-92 への追加）

- [SC-92 会社詳細](../画面設計/screens/SC-92_会社詳細.md) に「請求書」アクション（期間ピッカー＋ダウンロードボタン）を追加。
- ダウンロードは**既存 CSV エクスポートと同じ seam**＝同一オリジンの GET ナビゲーション（Cookie 認証・CSRF 不要）。`features/companies/api.ts` の `companiesCsvUrl()` に倣い `invoiceUrl(companyId, period)` を追加。
- サンプルの `window.open('http://localhost:8000/...')` は不採用（Jasper 露出）。
- `REPORT_RENDERER=none` 時はボタン非活性＋ツールチップ（「押せない方が親切」＝完了クエスト凍結 UI と同原則）。
- フロント実装は [フロントエンド実装フロー規約](../規約/フロントエンド実装フロー規約.md)（モック先行→接続）に従い、SC-92 既存ダウンロード導線を踏襲（新規 UI を作らない）。

## 14. テスト方針（[テスト規約](../規約/テスト規約.md)）

詳細 TC は [テスト V_帳票](../テスト/V_帳票.md)。TC-ID は `V-TC-1xx`（api/int）・`V-TC-2xx`（e2e/unit）。実装前に md へ TC 行（`根拠` 列付き）を追加してからコードを書く（CLAUDE.md）。

- unit＝`domain/invoice.py` のデータ組み立て／`registry` のホワイトリスト（`../` 拒否＝R5 回帰）。
- int＝`FakeRenderer` 注入で application がバイト列を返す／`none` で 503／`jasper` ダウンで 502。
- api＝エンドポイントの認可（他社 404）・`Content-Disposition`・`period` 検証。
- 受入＝SC-92 で実際に PDF が落ちること（目視検証）。

## 15. 段階的実装計画（MVP）

1. `infra/reports` port＋`FallbackPdfRenderer`＋registry（**Jasper 無しで PDF が落ちる**所まで）。
2. `control_plane/billing` ドメイン＋ API（同期ストリーム）。
3. SC-92 にボタン＋`invoiceUrl()`。→ ここで受入（落ちれば OK）。
4. Jasper サービスを `/render`（JSON body）対応に小改修＋jrxml を JSON データソース化。compose に追加。`REPORT_RENDERER=jasper` へ切替。
5. S2S 秘密・ネットワーク分離・本番要件追記。

> この順なら **1〜3 の時点で「帳票ダウンロード」が Jasper 無しで成立**し、4 で Jasper を“挿すだけ”＝疎結合が実証できる。

## 16. 正式反映の TODO（本ドラフト合意後）

- [x] FR 採番（[要件定義 README](../要件定義/README.md) に「帳票出力基盤」＝FR-51 を追加）。
- [x] [データモデル](../データモデル.md)＝MVP の同期では DB 追加なし（非同期化時のみ `report_jobs` 等＝台帳 F11）。
- [x] [API設計 V_帳票・レポート](../API設計/V_帳票・レポート.md) の詳細確定（実装済みに更新）。
- [x] [SC-92 会社詳細](../画面設計/screens/SC-92_会社詳細.md) に請求書アクションの節を追記。
- [x] [本番デプロイ要件](../本番デプロイ要件.md) に Jasper コンテナ（内部ネットワーク・ヘルスチェック）を追記。
- [~] S2S 秘密＝dev は env で実装（既存 SMTP 等と同様）。**本番の compose `secrets:` ファイルマウント化は台帳 F9**（D6 と連動）。
- [x] 請求書 DL の監査ログ（§17.5 G3）＝`billing.invoice_download`（誰が/会社/期間/形式・本文/金額は残さない）を実装＋ V-TC-108 追加。

## 17. リファクタリング／Docker 再チェック（2026-10-09 追記）

> §1（R1〜R7）がアーキテクチャ層の課題を扱うのに対し、本節は**サンプルの Docker・依存・サービスコード内部**をリファクタリング観点で精査した結果。移植（§15 の手順4）で**そのままでは動かない実バグ**と、§4 の「最小2点」に収まらない改修点を明文化する。実体＝`doc/JasperReports/…/v_pythonjasper/`。

### 17.1 サンプルの「そのままでは動かない」バグ（移植時に必修正）

| # | 箇所 | 問題 | 対処 |
|---|---|---|---|
| D1 | `Dockerfile.txt:6` `dnf -y install python39 && \  ## …` | 行継続 `\` の**後ろ**にコメントが続き、`\` が末尾でないため空白エスケープ扱い→コメント語が `dnf` 引数に。**ビルド失敗** | 末尾コメントを除去（または別行コメント化） |
| D2 | `requirements.txt:1,2,4` `fastapi　# …` | `#` 前が**全角スペース U+3000**。pip は区切り空白と見なさず不正パッケージ名に。**依存解決失敗** | 全角除去＋インラインコメント削除 |
| D3 | `Dockerfile.txt:5` `dnf -y update` | 非再現ビルド（アンチパターン） | 固定タグ運用・`update` 撤去 |
| D4 | `requirements.txt:3` `pyreportjasper`（版未固定） | 再現性なし | 版ピン（backend の pyproject 作法に合わせる） |

### 17.2 Docker 構成のリファクタ（§10 を実物対比で具体化）

- **ポート非公開**＝サンプル `docker-compose.yaml:4` `ports:["8000:8000"]` は撤去し内部到達のみ（§10 の意図を実物対比で明記）。
- **ソースをベイク**＝`docker-compose.yaml:6` の bind mount `.:/app` は撤去し、jrxml 込みでイメージにベイク（当プロジェクト方針＝backend も volumes 無し）。
- **無関係サービス除外**＝サンプル compose の `nextjs-ui`（:3000）は連携対象外。
- **イメージのスリム化**＝`almalinux:8` + `java-11-openjdk-**devel**`（コンパイラ一式）は実行には過剰。`java-11-openjdk-**headless**` へ。`python39` の要否も検討（backend は `python:3.12-slim`）。
- **ヘルスチェック**＝Jasper サービスに `/health` EP ＋ `HEALTHCHECK` を追加（`impl/compose.yaml` は全サービスに healthcheck あり。MVP compose 時点で必要・本番要件へ丸投げしない）。
- **非 root 実行**＝専用ユーザで起動。
- **JasperStarter/JVM 資産のベイク**＝`pyreportjasper` は JasperStarter バイナリ＋JVM リソースを要し初回取得が走り得る。閉域/再現性のため**ビルド時にベイク**。

### 17.3 Jasper サービス側改修の補足（§4「最小2点」に追加）

§4 の (a) jrxml→JSON アダプタ化・(b) `/render` JSON body 化に加え、以下も必須。

1. **一時ファイルの衝突**（§8 の補強）＝`jasper_service.py:31` は `/tmp/{report_id}` 固定。データ・プッシュ後は複数テナントが同一 `report_key` を同時出力すると `/tmp/同名` で競合/取り違え。`tempfile.mkdtemp()` で一意化し `finally` で削除。
2. **Jasper 側にも多層防御のパス検証**（R5 の補強）＝backend レジストリの whitelist に加え、Jasper も `reports/{group}/{report_id}.jrxml` を**リクエストから組み立てる**（`jasper_service.py:30`）ため、`..`/絶対パス拒否を Jasper 側にも入れる（defense in depth）。
3. **DB 配管の全撤去**＝`[DATABASE]` 節だけでなく `configparser` 読込・`DB_CONFIG`（`jasper_service.py:5-22`）・`drivers/` ・`[JDBC]` 節まで一掃。
4. **JSON 入力口**＝`jasper.config(data_file=<json>, json_query=…, db_connection=None)` で JSON データソースはネイティブ対応（実装者向け補足）。
5. **返却形**＝`/tmp` 経由の `FileResponse` をやめ `Response(bytes)` で返す（R6 の実装面）。
6. **デッドコード除去**＝`jasper_service.py:38` の `os.environ['JAVA_OPTS']=…` は Dockerfile `ENV`（:21）と重複。
7. **エラー漏洩**＝`jasper_python_main.py:27` の `str(e)` 直返し（500）はサニタイズ（`errors.py` をサービス側にも）。
8. **CORS 撤去**＝`CORSMiddleware(allow_origins=["*"])`（`jasper_python_main.py:8`）は S2S 化で削除（R2）。

### 17.4 軽微

- サンプル `config.ini` に実在風の資格情報（`163.43.70.68`/`admin1234`）が残存。サンプルゆえ実害は低いが **impl へ持ち込まない**。
- （将来最適化）JVM コールドスタート回避＝ビルド時に `.jrxml`→`.jasper` プリコンパイルし、リクエスト毎のコンパイルを省く。

### 17.5 現状システム構成・横断セキュリティ要件との突合（追加指摘）

> §11 がアプリ層の認可・テナント・パス対策を押さえるのに対し、本小節は**現状の `impl/compose.yaml`・横断の秘密管理／セキュリティ要件**に照らして、ドラフトに未反映だった改修点を補う。根拠＝[WEBアプリ開発時のセキュリティ対策一覧](../WEBアプリ開発時のセキュリティ対策一覧.md)・[シークレット管理(SOPS) 設計](シークレット管理(SOPS)_設計.md)・[本番デプロイ要件](../本番デプロイ要件.md)。

- **G1 S2S 秘密の供給方式を横断方針に合わせる**＝§10 表は `JASPER_SHARED_SECRET` を env で渡す前提だが、[シークレット管理(SOPS) 設計](シークレット管理(SOPS)_設計.md) §5 が確定した方針は**「鍵・秘密は env でなく compose `secrets:` ファイルマウント（`/run/secrets/<name>`・読取専用）」**（セキュリティ一覧 §11「シークレット管理サービスを利用」「秘密鍵を Git/イメージに埋め込まない」）。本連携は**その消費者**として、S2S 秘密を**ファイルマウントで供給**し、compose には参照だけ書く（カメリオ連携と同じ扱い＝DRY）。§10 の env 直置きは撤回。
- **G2 ネットワーク分離の機構を明記（現状 compose に未接地）**＝現状 `impl/compose.yaml` は**カスタム network 定義ゼロ**＝全サービスが既定 bridge で相互到達可（既存 `ollama` もホスト公開）。**「公開ポートを張らない」だけでは分離にならない**（同一 bridge の他コンテナから到達可）。Jasper は `internal: true` の専用 network に隔離し、到達可能なのは backend のみに限定する（セキュリティ一覧 §16「外部通信をネットワークレベルでも制限」）。本機構は [本番デプロイ要件](../本番デプロイ要件.md) にも追記（§16 TODO）。
- **G3 監査ログ**＝使用料請求書 DL は**他社の財務情報を扱う機微な管理者操作**。セキュリティ一覧 §15（「アクセス/変更を監査」「追跡用 ID とともにサーバログへ」）に従い、**誰が・どの会社の・どの期間の請求書を・いつ DL したか**を既存 system logging（JSONL＋request_id/tenant 相関）へ記録する。請求書**本文（PII/金額）はログに残さない**（同 §11/§15）。
- **軽微（要件表にあり未記載）**＝(a) SSRF（§16）＝Jasper URL は固定 env でユーザー入力由来にしない旨を明記し、**応答サイズ上限**を設定（タイムアウトは §9 にあり）。(b) XXE/デシリアライズ（§17）＝Jasper は XML(jrxml)＋JSON を処理。jrxml はベイク（信頼済）だが、**受領 JSON のサイズ上限/DoS 対策**と XXE 無効化を一言添える。
