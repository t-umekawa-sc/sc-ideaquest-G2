# O. システムログ / 観測性（テストパターン）

> ドメイン記号 **O**（Observability）＝横断のシステムログ基盤。API ドメイン（A..N）ではなく運用・観測性の横断機能。
> 仕様の正＝[`doc/本番デプロイ要件.md`](../本番デプロイ要件.md) §6.6（ログの仕組み・保持・アーカイブ）＋
> セキュリティ対策一覧 §15（ログにパスワード/トークンを出さない・保存期間を決める）。
> 実装＝[`impl/backend/app/core/logging_config.py`](../../impl/backend/app/core/logging_config.py)・
> [`app/core/log_context.py`](../../impl/backend/app/core/log_context.py)・アクセスログは
> [`app/core/audit_context.py`](../../impl/backend/app/core/audit_context.py)。

## 1. ロギング基盤（JSONL 整形・相関注入・秘匿マスク・日次ローテーション）

> 対象＝`logging_config` の `JsonFormatter`／`ContextFilter`／`_scrub`／`DailyGzipTimedRotatingFileHandler`。
> 範囲＝(1) 構造化 JSON の必須フィールドと1行性、(2) request_id/actor/tenant の contextvar 自動注入、
> (3) 秘匿キーのマスキング、(4) 例外のスタック格納、(5) 日次ローテーションの gzip 化と保持日数超過の削除。
> 非対象＝実際のファイル出力先/マウント（デプロイ側・§6.6）・アクセスログのミドルウェア結線（結合＝別途 e2e/手動）。
> 前提・フィクスチャ＝DB 非依存の純 unit（contextvar を直接 set／`tmp_path` に一時ファイルを作る）。
> 出典＝本番デプロイ要件 §6.6／セキュリティ対策一覧 §15。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| O-TC-001 | unit | 構造化ログは1行の有効 JSON＋必須フィールドを持つ（機械解析可能性の担保） | `JsonFormatter("backend")` と INFO レコード | `format(record)` | 改行を含まない1行で、`json.loads` 可能・`ts/level/service/logger/msg` を含む | 本番デプロイ要件 §6.6 |
| O-TC-002 | unit | request_id/actor/tenant を contextvar から全ログへ自動注入（1リクエスト串刺し追跡） | contextvar に request_id/actor/tenant を set | `ContextFilter().filter(record)`→`JsonFormatter.format` | JSON の `request_id/actor/tenant` が set した値に一致（未 set は null） | 本番デプロイ要件 §6.6 |
| O-TC-003 | unit | 秘匿値（PW/トークン/セッション/OTP 等）はキー名でマスクする（漏洩防止） | `extra` に `password`/`access_token`/`otp`/`csrf` 等を含むレコード | `format(record)` | 該当キーの値が全て `***`・非秘匿キーは素通し（ネスト dict/list も再帰マスク） | セキュリティ対策一覧 §15 |
| O-TC-004 | unit | 例外はスタックトレースを `exc` に格納（障害の原因追跡） | `exc_info` 付きレコード（try/except で発生） | `format(record)` | JSON に `exc` があり例外型名/トレースを含む | 本番デプロイ要件 §6.6／セキュリティ一覧 §14 |
| O-TC-005 | unit | 保持日数超過の古いログ（.gz 含む）を新しい方から残して削除対象に選ぶ（保持ポリシー） | `tmp_path` に `<base>.YYYY-MM-DD(.gz)` を retention+α 個作成・`backup_count=N` | `handler.getFilesToDelete()` | 日付降順で新しい N 個を残し、超過した古い分（.gz も）だけを返す | 本番デプロイ要件 §6.6 |
| O-TC-006 | unit | 日次ローテーションは前日分を gzip 圧縮しアーカイブ化（原本は消える） | `tmp_path` の実ファイルに対し handler の rotator を実行 | `handler.rotator(source, dest)` | `dest.gz` が生成され中身が復元可能・`source` は削除される | 本番デプロイ要件 §6.6 |
