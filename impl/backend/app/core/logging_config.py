"""システムログの集中設定（JSONL 構造化・ファイル日次ローテーション・秘匿マスキング）。

目的＝本番稼働時の問題/データ不整合を、後から（Claude が）解析できるだけの十分なログを残す。
正＝[`doc/本番デプロイ要件.md`](../../../../doc/本番デプロイ要件.md) §6.6・テスト＝`doc/テスト/O_システムログ.md`（O-TC-xxx）。

設計:
- **出力先**＝stdout（`docker logs`/集約基盤向け・常時）＋ファイル（`log_dir/<service>.jsonl`・`log_to_file` で ON/OFF）。
- **形式**＝既定 JSONL（1行1 JSON・機械解析容易）。`log_format=plain` で人間可読テキストにも切替可。
- **相関**＝`ContextFilter` が request_id / actor / ip / ua / tenant を contextvar から全 LogRecord に注入。
- **ローテーション**＝日次（`when=midnight`）。前日分を gzip 圧縮＝アーカイブ。保持は `log_retention_days`（既定30・超過削除）。
- **エラー集約**＝`<service>.error.jsonl` に WARNING 以上のみを別出力（障害時に真っ先に見るファイル）。
- **秘匿**＝PW/セッション/トークン/OTP 等はキー名で検出しマスク（セキュリティ対策一覧 §15・ログにパスワード/トークンを出さない）。
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import sys
from logging.handlers import TimedRotatingFileHandler

from app.core.audit_context import current_audit_context
from app.core.config import get_settings
from app.core.log_context import get_request_id, get_tenant

# 標準 LogRecord 属性＝JSON へそのまま出さない（メッセージ/文脈/extra 以外は冗長）。
_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename", "module", "exc_info",
    "exc_text", "stack_info", "lineno", "funcName", "created", "msecs", "relativeCreated", "thread",
    "threadName", "processName", "process", "taskName", "message", "asctime",
    # ContextFilter が明示的に別枠で出す注入フィールド（extra の二重出力を避ける）。
    "request_id", "actor", "ip", "ua", "tenant",
}

# 秘匿とみなすキー（部分一致・小文字化して判定）。値は完全に伏せる（セキュリティ対策一覧 §15）。
_SENSITIVE_SUBSTRINGS = (
    "password", "passwd", "pwd", "secret", "token", "authorization", "cookie", "session",
    "csrf", "otp", "api_key", "apikey", "access_key", "private", "credential",
)
_MASK = "***"


def _is_sensitive(key: str) -> bool:
    k = key.lower()
    return any(s in k for s in _SENSITIVE_SUBSTRINGS)


def _scrub(value):
    """dict/list を再帰的に走査し、秘匿キーの値をマスクする（ログインジェクション/秘匿漏れ防止・§15）。"""
    if isinstance(value, dict):
        return {k: (_MASK if _is_sensitive(str(k)) else _scrub(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub(v) for v in value]
    return value


def _json_default(o):
    """JSON 化できない値は文字列化（例＝UUID/datetime/Enum）＝ログ生成で落ちない。"""
    try:
        return str(o)
    except Exception:  # noqa: BLE001
        return "<unserializable>"


class ContextFilter(logging.Filter):
    """request_id / actor / ip / ua / tenant を contextvar から LogRecord に注入する。

    どの層のログにも相関情報が自動で乗る（呼び出し側が毎回 extra を書かなくてよい）。
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        actor, ip, ua = current_audit_context()
        record.request_id = get_request_id()
        record.actor = actor
        record.ip = ip
        record.ua = ua
        record.tenant = get_tenant()
        return True


class JsonFormatter(logging.Formatter):
    """1行1 JSON（JSONL）で構造化出力する。fields＝ts/level/logger/service/msg＋相関＋extra。"""

    def __init__(self, service: str):
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S")
            + f".{int(record.msecs):03d}Z",  # ISO8601 風（UTC 想定は log_utc で制御）
            "level": record.levelname,
            "service": self.service,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
            "actor": getattr(record, "actor", None),
            "tenant": getattr(record, "tenant", None),
            "ip": getattr(record, "ip", None),
            "ua": getattr(record, "ua", None),
        }
        # extra（呼び出し側が渡した構造化フィールド）を取り込み、秘匿はマスク。
        extra = {k: v for k, v in record.__dict__.items() if k not in _RESERVED and not k.startswith("_")}
        if extra:
            payload.update(_scrub(extra))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        elif record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)
        return json.dumps(payload, ensure_ascii=False, default=_json_default)


class PlainFormatter(logging.Formatter):
    """人間可読テキスト（dev 向け・log_format=plain）。相関は末尾に付す。"""

    def format(self, record: logging.LogRecord) -> str:
        base = f"{self.formatTime(record)} {record.levelname} {record.name}: {record.getMessage()}"
        rid = getattr(record, "request_id", None)
        tenant = getattr(record, "tenant", None)
        actor = getattr(record, "actor", None)
        tail = " ".join(f"{k}={v}" for k, v in (("rid", rid), ("tenant", tenant), ("actor", actor)) if v)
        if tail:
            base = f"{base} [{tail}]"
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"
        return base


class DailyGzipTimedRotatingFileHandler(TimedRotatingFileHandler):
    """日次ローテーション＋前日分を gzip 圧縮するハンドラ（保持は backupCount 日）。

    - 現在のファイル＝`<base>`（例 `backend.jsonl`）。0時に `<base>.YYYY-MM-DD.gz` へ回転＝アーカイブ。
    - 保持＝`<base>.*` を日付順で新しい方から backupCount 個残し、超過を削除（`getFilesToDelete` を .gz 対応に上書き）。
    """

    def __init__(self, filename: str, backup_count: int, utc: bool = False, encoding: str = "utf-8"):
        super().__init__(filename, when="midnight", backupCount=max(backup_count, 0), utc=utc, encoding=encoding)
        self.rotator = self._gzip_rotator  # 回転時に gzip 圧縮

    @staticmethod
    def _gzip_rotator(source: str, dest: str) -> None:
        # source＝回転前の現行ファイル、dest＝日付サフィックス付きの名前。gzip して source を消す。
        with open(source, "rb") as f_in, gzip.open(f"{dest}.gz", "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        os.remove(source)

    def getFilesToDelete(self) -> list[str]:  # noqa: N802 (基底のメソッド名に合わせる)
        # 基底実装はサフィックス正規表現に依存し .gz を取りこぼすため、prefix 一致で自前計算する。
        dir_name, base_name = os.path.split(self.baseFilename)
        prefix = base_name + "."
        entries = [
            os.path.join(dir_name, fn)
            for fn in os.listdir(dir_name or ".")
            if fn.startswith(prefix) and fn != base_name
        ]
        entries.sort()  # `YYYY-MM-DD` サフィックスは辞書順＝時系列順
        if self.backupCount <= 0 or len(entries) <= self.backupCount:
            return []
        return entries[: len(entries) - self.backupCount]


def _make_formatter(service: str) -> logging.Formatter:
    return JsonFormatter(service) if get_settings().log_format == "json" else PlainFormatter()


def configure_logging(service: str) -> None:
    """プロセス（backend/worker/mail-worker）のロギングを一括設定する。多重呼び出しは冪等。

    service＝出力ファイル名/JSON の `service` フィールドに使う（例 "backend"・"worker"・"mail-worker"）。
    """
    s = get_settings()
    level = getattr(logging, s.log_level.upper(), logging.INFO)
    formatter = _make_formatter(service)
    ctx_filter = ContextFilter()

    handlers: list[logging.Handler] = []

    console = logging.StreamHandler(sys.stdout)  # 常時＝docker logs / 集約基盤向け
    console.setFormatter(formatter)
    console.addFilter(ctx_filter)
    handlers.append(console)

    file_setup_error: Exception | None = None
    if s.log_to_file:
        # ログディレクトリが用意できない/書けない環境（権限・未マウント）でもアプリを落とさない＝stdout で継続。
        try:
            os.makedirs(s.log_dir, exist_ok=True)
            file_all = DailyGzipTimedRotatingFileHandler(
                os.path.join(s.log_dir, f"{service}.jsonl"), backup_count=s.log_retention_days, utc=s.log_utc,
            )
            file_all.setFormatter(formatter)
            file_all.addFilter(ctx_filter)
            handlers.append(file_all)

            file_err = DailyGzipTimedRotatingFileHandler(
                os.path.join(s.log_dir, f"{service}.error.jsonl"), backup_count=s.log_retention_days, utc=s.log_utc,
            )
            file_err.setLevel(logging.WARNING)  # 障害の一次切り分け＝WARNING 以上だけを別ファイルに集約
            file_err.setFormatter(formatter)
            file_err.addFilter(ctx_filter)
            handlers.append(file_err)
        except OSError as e:  # noqa: BLE001
            file_setup_error = e  # 設定後に警告（root ハンドラ確定後でないとログできない）

    root = logging.getLogger()
    for h in list(root.handlers):  # 冪等＝既存ハンドラを外して張り替える（多重出力防止）
        root.removeHandler(h)
    root.setLevel(level)
    for h in handlers:
        root.addHandler(h)

    # uvicorn の独自ハンドラを外し root へ委譲＝アクセス/エラーも同じ JSONL に揃える。
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        for h in list(lg.handlers):
            lg.removeHandler(h)
        lg.propagate = True

    # 冗長な第三者ライブラリの INFO を抑制＝正常系ログで異常を埋もれさせない（§15）。
    # 例＝httpx は送信毎に "HTTP Request:" を INFO で出す／SQLAlchemy engine の echo 等。WARNING 以上のみ残す。
    for name in ("httpx", "httpcore", "sqlalchemy.engine", "asyncio", "python_multipart", "urllib3"):
        logging.getLogger(name).setLevel(logging.WARNING)

    if file_setup_error is not None:
        logging.getLogger("app").warning(
            "file logging disabled (falling back to stdout): %s", file_setup_error,
            extra={"event": "log_file_setup_failed", "log_dir": s.log_dir},
        )


# データ変更トレース（データ不整合の追跡・full スコープ）。application/worker から呼ぶ薄い helper。
_mutation_logger = logging.getLogger("app.mutation")


def log_mutation(action: str, *, entity: str | None = None, entity_id=None, **fields) -> None:
    """状態変更（作成/更新/削除/同期）を1行の構造化ログに残す（actor/tenant/request_id は filter が自動付与）。

    例＝`log_mutation("account.sync.upsert", entity="user", entity_id=uid, op="upsert")`。
    秘匿値は渡さない（渡っても formatter がキー名でマスクする＝二重防御・§15）。
    """
    _mutation_logger.info(
        "mutation %s", action,
        extra={"action": action, "entity": entity, "entity_id": None if entity_id is None else str(entity_id), **fields},
    )
