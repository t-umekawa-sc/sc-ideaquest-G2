"""V-TC-212/213: jasper の S2S 秘密読取（file>env）と定数時間比較（F9・設計 §5/§8/§13）。

`_secrets` は純 stdlib（Java/pyreportjasper 非依存）＝backend イメージの pytest で検証できる
（cwd=/jasper・PYTHONPATH=/jasper で `import _secrets`）。
"""
from __future__ import annotations

from _secrets import read_secret, secret_matches


def test_v_tc_212_read_secret_file_beats_env(tmp_path, monkeypatch):
    f = tmp_path / "jasper_shared_secret"
    # (1) file（末尾改行あり）＋ env 併存 → file が勝つ・改行除去。
    f.write_text("FROM_FILE\n")
    monkeypatch.setenv("JASPER_SHARED_SECRET", "FROM_ENV")
    assert read_secret("JASPER_SHARED_SECRET", str(f)) == "FROM_FILE"
    # (2) file 無し → env。
    missing = str(tmp_path / "nope")
    assert read_secret("JASPER_SHARED_SECRET", missing) == "FROM_ENV"
    # (3) 両方無し → 空（fail-closed）。
    monkeypatch.delenv("JASPER_SHARED_SECRET", raising=False)
    assert read_secret("JASPER_SHARED_SECRET", missing) == ""


def test_v_tc_213_secret_matches_constant_time_and_fail_closed():
    assert secret_matches("abc", "abc") is True          # 一致
    assert secret_matches("abc", "abd") is False         # 不一致
    assert secret_matches(None, "abc") is False          # ヘッダ無し
    assert secret_matches("abc", "") is False            # 秘密未設定は常に拒否（fail-closed）
    assert secret_matches(None, "") is False
