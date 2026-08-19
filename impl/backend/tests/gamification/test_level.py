"""G レベル進捗の純粋関数テスト（データモデル §7・API設計 K.1/I.1）。

Lv n→n+1 必要 XP（増分）＝100+(n-1)×50。累積閾値＝Lv1:0 / Lv2:100 / Lv3:250 / Lv4:450。
DB 非依存＝`app.tenant.gamification.level.level_progress`。
"""
from __future__ import annotations

import pytest

from app.tenant.gamification.level import level_progress, level_span


def test_level_span_increments():
    assert level_span(1) == 100 and level_span(2) == 150 and level_span(3) == 200


@pytest.mark.parametrize(
    "xp,level,xp_to_next,span",
    [
        (0, 1, 100, 100),      # Lv1 起点
        (99, 1, 1, 100),       # Lv1 内・残1
        (100, 2, 150, 150),    # ちょうど Lv2
        (249, 2, 1, 150),      # Lv2 内・残1（250 で Lv3）
        (250, 3, 200, 200),    # ちょうど Lv3
        (260, 3, 190, 200),    # Lv3・10 消化
        (450, 4, 250, 250),    # ちょうど Lv4（span=100+3×50=250）
    ],
)
def test_level_progress(xp, level, xp_to_next, span):
    p = level_progress(xp)
    assert p == {"level": level, "xp_to_next": xp_to_next, "level_span": span}


def test_level_progress_clamps_negative():
    assert level_progress(-10) == {"level": 1, "xp_to_next": 100, "level_span": 100}
