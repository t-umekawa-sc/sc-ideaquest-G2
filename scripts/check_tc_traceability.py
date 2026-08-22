#!/usr/bin/env python3
"""TC-ID トレーサビリティ検査（テスト規約 §1 の自動ガード）。

テストコード（`impl/backend/tests/**/*.py`・`impl/frontend/e2e/**/*.spec.ts`）に現れる TC-ID
（`<ドメイン>-TC-<連番>` 例 `C-TC-101`）が、すべて **テストパターン md（`doc/テスト/*.md`）にも記載**
されているかを照合する。片側（コードのみ／md のみ）を検出して非ゼロ終了する＝
「パターン md を書かずにテストを追加した／TC-ID の綴り違い」を機械的に防ぐ。

使い方（リポジトリルートで）:
    python3 scripts/check_tc_traceability.py            # 検査（差分があれば exit 1）
    python3 scripts/check_tc_traceability.py --list     # 検出した TC-ID を一覧表示

CI / pre-commit に組み込むと再発防止が自動化される（テスト規約 §1・§5.2）。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TC_RE = re.compile(r"\b([A-Z])-TC-(\d{3})\b")

CODE_GLOBS = [
    ("impl/backend/tests", "*.py"),
    ("impl/frontend/e2e", "*.spec.ts"),
]
PATTERN_DIR = ROOT / "doc" / "テスト"


def _scan(paths) -> dict[str, set[Path]]:
    """TC-ID → 出現ファイル集合。"""
    found: dict[str, set[Path]] = {}
    for f in paths:
        try:
            text = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for m in TC_RE.finditer(text):
            found.setdefault(f"{m.group(1)}-TC-{m.group(2)}", set()).add(f)
    return found


def main(argv: list[str]) -> int:
    code_files: list[Path] = []
    for rel, pat in CODE_GLOBS:
        code_files += list((ROOT / rel).rglob(pat))
    md_files = list(PATTERN_DIR.glob("*.md"))

    in_code = _scan(code_files)
    in_md = _scan(md_files)

    if "--list" in argv:
        print(f"code TC-IDs: {len(in_code)} / md TC-IDs: {len(in_md)}")
        for tc in sorted(set(in_code) | set(in_md)):
            print(f"  {tc}  code={'Y' if tc in in_code else '-'} md={'Y' if tc in in_md else '-'}")

    code_only = sorted(set(in_code) - set(in_md))
    md_only = sorted(set(in_md) - set(in_code))

    ok = True
    if code_only:
        ok = False
        print("❌ テストコードにあるが パターン md に無い TC-ID（＝md 先行を飛ばした/綴り違い）:")
        for tc in code_only:
            files = ", ".join(sorted(str(p.relative_to(ROOT)) for p in in_code[tc]))
            print(f"   {tc}  ← {files}")
    if md_only:
        # md にあるがコード未実装＝将来 TC（許容）。警告のみで失敗にはしない。
        print("⚠️  パターン md にあるが テストコード未実装の TC-ID（将来 TC・許容）:")
        for tc in md_only:
            print(f"   {tc}")

    if ok:
        print(f"✅ TC-ID トレーサビリティ OK（code {len(in_code)} 件すべて md に記載）")
        return 0
    print("\nテスト規約 §1/§5.2＝テストコードの TC-ID は必ず doc/テスト/<ドメイン>_*.md に対応行を持つこと。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
