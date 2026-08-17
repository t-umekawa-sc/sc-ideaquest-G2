"""一覧 API（DataTable クエリ契約・§1.8.1）の共通ヘルパ（EP 非依存の純関数）。

会社一覧・アカウント一覧など複数の `/admin/*` 一覧 EP が同じ契約（複数ソート・enum 多値フィルタ・
CSV エクスポート・固定行〔ピン〕）を満たすため、EP 間で重複しない共通部品をここへ集約する（DRY・§2.3）。
各 EP 固有の部分（ORM カラム/集計式・クエリ組み立て・行射影）は呼び出し側に残し、本モジュールは
**パラメータ解析（ホワイトリスト検証つき）と CSV 直列化**のみを担う。正＝doc/API設計/README.md §1.8.1。
"""
from __future__ import annotations

import csv
import io
import uuid
from collections.abc import Iterable, Mapping, Sequence

from app.core.errors import AppError

MAX_PER_PAGE = 100  # per_page の上限（§1.8）
DEFAULT_PER_PAGE = 20  # per_page 既定（§1.8）
MAX_PINS = 5  # 固定行（ピン）件数上限（デザイン標準 §4.5⑨ maxPins 既定・§1.8.1④）


def parse_sort(sort: str | None, allowed: Mapping[str, object]) -> list:
    """`?sort=a,-b` を ORDER BY 式のリストへ（左が最優先・`-` で降順・§1.8.1①）。

    `allowed`＝ソート可能キー→ORDER BY 対象（ORM カラム/集計式）のマップ。ホワイトリスト外のキーは
    `422 validation_error`（列挙耐性・任意列ソート/注入の遮断・§2.2）。集計列は呼び出し側が allowed に混ぜる。
    """
    order: list = []
    for token in (sort or "").split(","):
        token = token.strip()
        if not token:
            continue
        desc = token.startswith("-")
        key = token[1:] if desc else token
        col = allowed.get(key)
        if col is None:
            raise AppError(422, "validation_error", extra={"errors": [{"field": "sort", "value": key}]})
        order.append(col.desc() if desc else col.asc())
    return order


def parse_enum(value: str | None, field: str, allowed: Iterable[str]) -> list[str] | None:
    """`?field=a,b` を検証済みの値リストへ（enum 多値＝OR・§1.8.1②）。未知値は 422（ホワイトリスト・§2.2）。"""
    if not value:
        return None
    vals = [v.strip() for v in value.split(",") if v.strip()]
    for v in vals:
        if v not in allowed:
            raise AppError(422, "validation_error", extra={"errors": [{"field": field, "value": v}]})
    return vals or None


def parse_pin_ids(pin_ids: str | None, *, max_pins: int = MAX_PINS) -> list[uuid.UUID]:
    """`?pin_ids=<id>,<id>` を UUID リストへ（上限 max_pins・§1.8.1④）。不正形式は 422。"""
    if not pin_ids:
        return []
    out: list[uuid.UUID] = []
    for tok in pin_ids.split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            out.append(uuid.UUID(tok))
        except ValueError:
            raise AppError(422, "validation_error", extra={"errors": [{"field": "pin_ids", "value": tok}]})
    return out[:max_pins]  # 上限超はクライアント側 maxPins で抑止・サーバーは防御的に切り詰め


def parse_columns(columns: str | None, allowed: Iterable[str], default_order: Sequence[str]) -> list[str]:
    """`?columns=a,b` を表示列リストへ（ホワイトリスト・§1.8.1③）。未指定は既定列順。未知列は 422。"""
    if not columns:
        return list(default_order)
    keys = [c.strip() for c in columns.split(",") if c.strip()]
    for k in keys:
        if k not in allowed:
            raise AppError(422, "validation_error", extra={"errors": [{"field": "columns", "value": k}]})
    return keys or list(default_order)


def to_csv_bytes(header: Sequence[str], rows: Iterable[Sequence[str]]) -> bytes:
    """ヘッダ＋行を CSV バイト列へ（UTF-8 BOM 付き＝Excel 互換・§1.8.1③）。"""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8-sig")
