"""S2S 共有シークレットの読取と定数時間比較（F9・設計=シークレット管理(SOPS) §5/§8/§13）。

純 stdlib（Java/pyreportjasper 非依存）＝単体テスト可能。backend の `secrets_dir` と同じ
`/run/secrets/<name>` 規約で、env をやめ本番はファイルマウントで供給できるようにする。
優先順位は **file > env**（backend 側 `settings_customise_sources` と揃える）＝env は覗ける露出面（T3）なので、
安全にマウントした file が迷い込んだ/残留 env に負けないようにする。dev は file 無し＝env／本番は file マウント。
"""
from __future__ import annotations

import hmac
import os


def read_secret(env_name: str, file_path: str) -> str:
    """`file_path`（`/run/secrets/<name>`）を優先し、無ければ env を読む（末尾改行/空白は strip）。

    どちらも無ければ空文字＝秘密未設定＝呼び出し側で fail-closed（/render は 401）。file が env に勝つ（T3）。
    """
    try:
        with open(file_path, encoding="utf-8") as fh:
            val = fh.read().strip()
            if val:
                return val
    except OSError:
        pass
    return (os.environ.get(env_name) or "").strip()


def secret_matches(given: str | None, expected: str) -> bool:
    """定数時間比較（`hmac.compare_digest`）でタイミング差から秘密を推測させない（§8/§13）。

    `expected` が空（秘密未設定）なら常に False＝秘密無しの運用は必ず拒否（fail-closed）。
    """
    if not expected or given is None:
        return False
    return hmac.compare_digest(given, expected)
