"""ダッシュボード集約ルータ（`/api/v1`・テナントプレーン・ドメイン I）＝SC-01。

認可＝Depends(require_me)。読取専用（新業務ロジックなし・I.0）。自分スコープのみ（cross-tenant 不可・§1.5）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.control_plane.me.deps import require_me
from app.tenant.dashboard import application as svc

router = APIRouter(prefix="/api/v1", tags=["dashboard"])


@router.get("/dashboard")
def get_dashboard(session: dict = Depends(require_me)) -> dict:
    """SC-01 の全パネルを1レスポンスに集約（I.1）。部分失敗はパネル単位 null（I.4）。"""
    return svc.get_dashboard(session)
