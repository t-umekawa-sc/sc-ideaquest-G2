"""システムログ基盤の unit テスト（テスト規約 unit 層・DB 非依存）。

O-TC-001..006＝JSONL 整形／相関注入／秘匿マスク／例外格納／日次ローテーションの gzip・保持。
正＝doc/テスト/O_システムログ.md・実装＝app/core/logging_config.py。
"""
from __future__ import annotations

import gzip
import json
import logging
import sys

from app.core import audit_context, log_context
from app.core.logging_config import (
    ContextFilter,
    DailyGzipTimedRotatingFileHandler,
    JsonFormatter,
)


def _record(msg: str = "hello", *, level: int = logging.INFO, exc_info=None, **extra) -> logging.LogRecord:
    rec = logging.LogRecord(
        name="app.test", level=level, pathname=__file__, lineno=10, msg=msg, args=(), exc_info=exc_info,
    )
    for k, v in extra.items():
        setattr(rec, k, v)
    return rec


def test_o_tc_001_json_single_line_required_fields():
    """O-TC-001＝JSONL は改行なし1行で、必須フィールドを持つ有効 JSON（本番デプロイ要件 §6.6）。"""
    out = JsonFormatter("backend").format(_record("started up"))
    assert "\n" not in out  # 1行1レコード（JSONL）
    parsed = json.loads(out)  # 有効 JSON
    for key in ("ts", "level", "service", "logger", "msg"):
        assert key in parsed
    assert parsed["service"] == "backend"
    assert parsed["level"] == "INFO"
    assert parsed["msg"] == "started up"


def test_o_tc_002_context_injection_request_id_actor_tenant():
    """O-TC-002＝request_id/actor/tenant を contextvar から自動注入（1リクエスト串刺し追跡）。"""
    rid = log_context.set_request_id("req_abc123")
    ten = log_context.set_tenant("ideaquest_company_acme")
    act = audit_context._actor.set("acc-42")
    try:
        rec = _record("op done")
        ContextFilter().filter(rec)
        parsed = json.loads(JsonFormatter("backend").format(rec))
        assert parsed["request_id"] == "req_abc123"
        assert parsed["tenant"] == "ideaquest_company_acme"
        assert parsed["actor"] == "acc-42"
    finally:
        log_context.reset_request_id(rid)
        log_context.reset_tenant(ten)
        audit_context._actor.reset(act)

    # 未 set のときは null（前段のリクエストの値が漏れない）。
    parsed2 = json.loads(JsonFormatter("backend").format(_record("no ctx")))
    assert parsed2["request_id"] is None and parsed2["tenant"] is None and parsed2["actor"] is None


def test_o_tc_003_sensitive_keys_masked():
    """O-TC-003＝秘匿キー（PW/トークン/OTP/CSRF/セッション）は値をマスク・非秘匿は素通し（§15）。"""
    rec = _record(
        "login",
        password="hunter2",
        access_token="tok_secret",
        otp="123456",
        csrf_token="c",
        nested={"session_id": "s1", "keep": "visible"},
        login_id="user@acme.example",  # 非秘匿（識別子）＝素通し
    )
    parsed = json.loads(JsonFormatter("backend").format(rec))
    assert parsed["password"] == "***"
    assert parsed["access_token"] == "***"
    assert parsed["otp"] == "***"
    assert parsed["csrf_token"] == "***"
    assert parsed["nested"]["session_id"] == "***"  # ネストも再帰マスク
    assert parsed["nested"]["keep"] == "visible"
    assert parsed["login_id"] == "user@acme.example"  # 識別子は消さない（追跡に必要）


def test_o_tc_004_exception_stack_captured():
    """O-TC-004＝exc_info があると `exc` にスタックトレースを格納（原因追跡・§14）。"""
    try:
        raise ValueError("boom-xyz")
    except ValueError:
        rec = _record("crash", level=logging.ERROR, exc_info=sys.exc_info())
    parsed = json.loads(JsonFormatter("backend").format(rec))
    assert "exc" in parsed
    assert "ValueError" in parsed["exc"] and "boom-xyz" in parsed["exc"]


def test_o_tc_005_retention_selects_oldest_beyond_backupcount(tmp_path):
    """O-TC-005＝保持日数超過の古いログ（.gz 含む）を新しい方から残して削除対象に選ぶ。"""
    base = tmp_path / "backend.jsonl"
    handler = DailyGzipTimedRotatingFileHandler(str(base), backup_count=3)
    try:
        # 5 日分の回転済みファイル（うち一部は gzip 済み）。日付昇順＝古い順。
        dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]
        for i, d in enumerate(dates):
            name = f"backend.jsonl.{d}" + (".gz" if i % 2 == 0 else "")
            (tmp_path / name).write_text("x")
        to_delete = handler.getFilesToDelete()
        # backup_count=3 → 新しい3日を残し、古い2日（09-01,09-02）を削除対象に。
        names = sorted(p.split("/")[-1] for p in to_delete)
        assert names == ["backend.jsonl.2026-09-01.gz", "backend.jsonl.2026-09-02"]
        # 現行のベースファイルは削除対象に含めない。
        assert not any(p.endswith("backend.jsonl") for p in to_delete)
    finally:
        handler.close()


def test_o_tc_006_rotator_gzips_and_removes_source(tmp_path):
    """O-TC-006＝日次ローテーションは前日分を gzip 圧縮し、原本を削除する（アーカイブ化）。"""
    source = tmp_path / "backend.jsonl"
    source.write_text('{"msg":"day1"}\n{"msg":"day1b"}\n')
    dest = tmp_path / "backend.jsonl.2026-09-21"
    DailyGzipTimedRotatingFileHandler._gzip_rotator(str(source), str(dest))
    gz = tmp_path / "backend.jsonl.2026-09-21.gz"
    assert gz.exists()
    assert not source.exists()  # 原本は消える
    with gzip.open(gz, "rt") as f:
        assert "day1" in f.read()
