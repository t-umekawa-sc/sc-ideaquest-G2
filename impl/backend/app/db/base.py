"""SQLAlchemy の宣言ベース（プレーン別）。共通監査ミックスイン（§2.1）は必要になった時に追加する。

各モジュールの `orm.py` はここの Base を継承してテーブルを定義する
（`domain/model.py`＝純粋ドメインと名前衝突させないため ORM は `orm.py`・§3.4）。
"""
from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class ControlBase(DeclarativeBase):
    """管理DB（コントロールプレーン）のテーブル群のベース。"""


class CompanyBase(DeclarativeBase):
    """会社DB（テナントプレーン）のテーブル群のベース。"""
