"""帳票・レポート（ドメイン V）テスト＝使用料請求書 PDF（SC-92・API設計 V・設計ドラフト 帳票連携）。

トレーサビリティ＝doc/テスト/V_帳票.md（V-TC-1xx api・V-TC-2xx unit/int）。Jasper 呼び出しはテストを不安定化
させるため、レンダラは `FakeRenderer`（決定的・外部未接続）を `registry.set_renderer` で差し替える
（S ドメインの Fake ゲートウェイと同方針）。`none`（503）検証のみ注入せず env 既定（none）で行う。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.auth.orm import Company
from app.control_plane.billing import application as billing_app
from app.control_plane.billing.domain import invoice as invoice_domain
from app.core.config import get_settings
from app.db.control import control_session
from app.infra.reports import registry
from app.infra.reports.errors import ReportConfigError, ReportUnavailable
from app.infra.reports.fallback_pdf import FallbackPdfRenderer
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.conftest import SEED_COMPANY_CODE

LOGIN = "/api/v1/auth/login"


def _company_id(code: str) -> uuid.UUID:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=code).one().id


def _url(company_id, period: str = "2026-09", fmt: str | None = "pdf") -> str:
    q = f"?period={period}"
    if fmt is not None:
        q += f"&format={fmt}"
    return f"/api/v1/admin/companies/{company_id}/billing/invoice{q}"


class _FakeRenderer:
    """描画引数を記録する決定的レンダラ（S2S body に report_key/format/data が渡るかの検証用・V-TC-204）。"""

    def __init__(self, result: bytes = b"%PDF-1.4\nfake\n%%EOF\n", raises: Exception | None = None) -> None:
        self.result = result
        self.raises = raises
        self.calls: list[dict] = []

    def render(self, report_key: str, data: dict, fmt: str) -> bytes:
        self.calls.append({"report_key": report_key, "format": fmt, "data": data})
        if self.raises is not None:
            raise self.raises
        return self.result


@pytest.fixture(autouse=True)
def _reset_renderer():
    """各テスト後にレンダラ注入を解除（env 既定へ戻す）。"""
    yield
    registry.set_renderer(None)


def _admin(factory) -> dict:
    """ACME-01 配下の会社アカウント管理者（自社スコープ・V.0）を作ってログイン情報を返す。"""
    return factory.make_seed_company_account(system_role="company_account_admin",
                                             display_name=f"BillAdmin-{uuid.uuid4().hex[:6]}")


# --- unit（V.1・設計 §6/§11） ----------------------------------------------------------------

def test_v_tc_201_invoice_data_build():
    """V-TC-201 帳票データ組み立て＝InvoiceReportData が会社/期間/明細/合計を構築（レンダラ非依存）。根拠 設計 §6。"""
    data = invoice_domain.build("ACME-01", "Acme Inc.", "2026-09")
    assert data.company_code == "ACME-01"
    assert data.period == "2026-09"
    assert data.lines and all(ln.amount == ln.qty * ln.unit_price for ln in data.lines)
    assert data.subtotal == sum(ln.amount for ln in data.lines)
    assert data.total == data.subtotal + data.tax
    payload = data.to_payload()  # JSON 可（データ・プッシュ）＝company_code/period/lines/total を持つ純データ
    assert payload["company_code"] == "ACME-01" and payload["period"] == "2026-09"
    assert isinstance(payload["lines"], list) and payload["total"] == data.total


def test_v_tc_202_report_key_whitelist_rejects_traversal():
    """V-TC-202 report_key ホワイトリスト＝未知/パス的入力は拒否（パストラバーサル防止）。根拠 設計 §11・R5。"""
    assert registry.resolve_template("company_usage_invoice") == "company_usage_invoice"
    for bad in ("../../etc/passwd", "company_usage_invoice/../x", "unknown_key", ""):
        with pytest.raises(ReportConfigError):
            registry.resolve_template(bad)


# --- int（V.2/V.4・設計 §4/§12） -------------------------------------------------------------

def _system_session() -> dict:
    return {"system_role": "system_admin", "company_id": str(uuid.uuid4()), "account_id": str(uuid.uuid4())}


def test_v_tc_203_fallback_renderer_pdf_bytes():
    """V-TC-203 fallback レンダラ＝Jasper 無しで PDF バイト列を生成（全機能稼働）。根拠 設計 §12。"""
    registry.set_renderer(FallbackPdfRenderer())
    cid = _company_id(SEED_COMPANY_CODE)
    content, filename, mime = billing_app.render_invoice(
        cid, period="2026-09", fmt="pdf", session=_system_session())
    assert content.startswith(b"%PDF-") and len(content) > 100
    assert mime == "application/pdf" and filename.endswith("-2026-09.pdf")


def test_v_tc_204_jasper_renderer_receives_payload():
    """V-TC-204 jasper レンダラ＝Fake 注入でバイト列を返す（S2S body に report_key/format/data）。根拠 設計 §4・V.2。"""
    fake = _FakeRenderer(result=b"%PDF-1.4\nreal-jasper\n%%EOF\n")
    registry.set_renderer(fake)
    cid = _company_id(SEED_COMPANY_CODE)
    content, _filename, _mime = billing_app.render_invoice(
        cid, period="2026-09", fmt="pdf", session=_system_session())
    assert content == b"%PDF-1.4\nreal-jasper\n%%EOF\n"
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["report_key"] == "company_usage_invoice" and call["format"] == "pdf"
    assert call["data"]["company_code"] and isinstance(call["data"]["lines"], list)


# --- api（V.0/V.1） ----------------------------------------------------------------------------

def test_v_tc_101_download_invoice_attachment(client, factory):
    """V-TC-101 正常＝請求書 PDF を attachment でストリーム返却。根拠 V.1。"""
    registry.set_renderer(FallbackPdfRenderer())
    admin = _admin(factory)
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.headers["content-disposition"] == f'attachment; filename="invoice-{SEED_COMPANY_CODE}-2026-09.pdf"'
    assert r.content.startswith(b"%PDF-")


def test_v_tc_102_non_admin_forbidden(client, factory):
    """V-TC-102 認可＝一般ユーザーは 403。根拠 V.0。"""
    registry.set_renderer(FallbackPdfRenderer())
    user = factory.make_seed_company_account(system_role="general")
    _login(client, user["company_code"], user["login_id"], user["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 403 and r.json()["code"] == "forbidden"


def test_v_tc_103_other_company_not_found(client, factory):
    """V-TC-103 テナント境界＝他社の company_id は 404（存在秘匿）。根拠 V.0・README §1.5。"""
    registry.set_renderer(FallbackPdfRenderer())
    admin = _admin(factory)  # ACME-01 の会社管理者
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    other = factory.make_company()  # 別会社
    r = client.get(_url(other["id"]))
    assert r.status_code == 404


def test_v_tc_104_invalid_period(client, factory):
    """V-TC-104 period 不正＝422（field=period）。根拠 V.1。"""
    registry.set_renderer(FallbackPdfRenderer())
    admin = _admin(factory)
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid, period="2026/9"))
    assert r.status_code == 422 and r.json()["code"] == "invalid_period"
    assert r.json()["errors"][0]["field"] == "period"


def test_v_tc_105_unsupported_format(client, factory):
    """V-TC-105 未対応 format＝422（field=format）。根拠 V.1。"""
    registry.set_renderer(FallbackPdfRenderer())
    admin = _admin(factory)
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid, fmt="docx"))
    assert r.status_code == 422 and r.json()["code"] == "unsupported_format"
    assert r.json()["errors"][0]["field"] == "format"


def test_v_tc_106_disabled_renderer_503(client, factory, monkeypatch):
    """V-TC-106 機能オフ＝REPORT_RENDERER=none で 503。根拠 V.1・設計 §12。"""
    # 注入せず REPORT_RENDERER=none を強制 → get_renderer() は None → 503（autouse がキャッシュ復元）。
    monkeypatch.setenv("REPORT_RENDERER", "none")
    get_settings.cache_clear()
    assert get_settings().report_renderer == "none"
    admin = _admin(factory)
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 503 and r.json()["code"] == "report_disabled"


def test_v_tc_107_jasper_unreachable_502(client, factory):
    """V-TC-107 バックエンド不達＝jasper 選択時に Jasper 到達不可で 502。根拠 V.1。"""
    registry.set_renderer(_FakeRenderer(raises=ReportUnavailable("connection refused")))
    admin = _admin(factory)
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 502 and r.json()["code"] == "report_backend_unavailable"


def test_v_tc_108_audit_recorded(client, factory):
    """V-TC-108 監査＝billing.invoice_download を記録（会社/期間/形式・本文/金額は残さない）。根拠 設計 §17.5 G3。"""
    from app.control_plane.audit.orm import SystemAuditLog

    registry.set_renderer(_FakeRenderer())
    admin = _admin(factory)
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 200, r.text
    with control_session() as s:
        rows = s.query(SystemAuditLog).filter_by(action="billing.invoice_download").all()
    assert len(rows) == 1
    detail = rows[0].detail or {}
    assert detail.get("company_id") == str(cid) and detail.get("period") == "2026-09"
    assert detail.get("format") == "pdf"
    assert "lines" not in detail and "total" not in detail and "amount" not in detail
