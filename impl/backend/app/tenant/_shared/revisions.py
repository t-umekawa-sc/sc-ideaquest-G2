"""変更履歴（内容の版）の共通エンジン（横断標準・設計ドラフト doc/設計ドラフト/変更履歴標準.md §3.1）。

版スナップショット（JSONB `changes`）の差分算出・変更フィールド抽出・カーソルを一元化する。
アイデア（D.4）と情報インプット（§85）で二重実装だったものを共通化し、コンセプト/振り返り/クエスト/評価へ展開する土台。

方針: エンティティ差は **FieldSpec のタプル**（追跡フィールドと型・整形関数）だけに閉じる。
- text 系＝文字単位の語句差分（equal/add/del セグメント・日本語対応の SequenceMatcher）。任意で表示前変換（例: HTML→プレーンテキスト）。
- scalar 系＝`{old,new}`（任意で表示整形＝ラベル連結など）。
- `skip_when_old_none`＝旧スナップに無い（機能導入前の）フィールドは差分を出さない（誤検知防止）。
"""
from __future__ import annotations

import base64
import binascii
import difflib
from dataclasses import dataclass
from typing import Callable

from app.core.errors import AppError


@dataclass(frozen=True)
class FieldSpec:
    name: str
    kind: str  # "text" | "scalar"
    text_transform: Callable[[str], str | None] | None = None  # text: 差分前の表示用変換（例 HTML→plain）
    scalar_fmt: Callable[[object], object] | None = None       # scalar: old/new の表示整形（既定＝そのまま）
    skip_when_old_none: bool = False                            # 旧スナップに欠落するフィールドは比較しない


def text_diff_segments(old: str, new: str) -> list[dict]:
    """文字単位の差分セグメント（equal/add/del）。日本語対応のため文字レベル SequenceMatcher。"""
    sm = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    segments: list[dict] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            segments.append({"op": "equal", "text": old[i1:i2]})
        elif op == "delete":
            segments.append({"op": "del", "text": old[i1:i2]})
        elif op == "insert":
            segments.append({"op": "add", "text": new[j1:j2]})
        elif op == "replace":
            segments.append({"op": "del", "text": old[i1:i2]})
            segments.append({"op": "add", "text": new[j1:j2]})
    return segments


def changed_fields(old: dict | None, new: dict, specs: tuple[FieldSpec, ...]) -> list[str]:
    """前版スナップショット比較で変わったフィールド名（初版＝old None は空）。"""
    if old is None:
        return []
    out: list[str] = []
    for s in specs:
        if s.skip_when_old_none and old.get(s.name) is None:
            continue
        if old.get(s.name) != new.get(s.name):
            out.append(s.name)
    return out


def diff_fields(old: dict, new: dict, specs: tuple[FieldSpec, ...]) -> dict:
    """2版のスナップショットから、変わったフィールドの差分を算出（text＝語句差分／scalar＝{old,new}）。"""
    result: dict[str, dict] = {}
    for s in specs:
        ov, nv = old.get(s.name), new.get(s.name)
        if s.skip_when_old_none and ov is None:
            continue
        if ov == nv:
            continue
        if s.kind == "text":
            a: str = ov or ""
            b: str = nv or ""
            if s.text_transform is not None:
                a = s.text_transform(a) or ""
                b = s.text_transform(b) or ""
            result[s.name] = {"kind": "text", "segments": text_diff_segments(a, b)}
        else:  # scalar
            fmt = s.scalar_fmt or (lambda v: v)
            result[s.name] = {"kind": "scalar", "old": fmt(ov), "new": fmt(nv)}
    return result


def encode_revision_cursor(revision: int) -> str:
    return base64.urlsafe_b64encode(f"rev|{revision}".encode()).decode()


def decode_revision_cursor(cursor: str) -> int:
    try:
        prefix, rev = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        if prefix != "rev":
            raise ValueError
        return int(rev)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])
