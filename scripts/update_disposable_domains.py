#!/usr/bin/env python3
"""使い捨てメールドメイン blocklist の更新（FR-48② SEC G・案A＝CI 週次で実行し差分を PR）。

公開リスト（disposable-email-domains）を取得し、正規化（小文字・重複排除・ソート）して
`impl/backend/app/core/disposable_domains.txt` に書き出す。実行時は外部を叩かない方針のため、
更新はビルド外（CI）で行い、生成物をリポジトリに同梱する（実行時外部依存ゼロ）。

安全策（誤爆防止）:
- 主要メールプロバイダ（gmail/outlook 等）を allowlist で常に除外（上流に紛れても守る）。
- `*.example`（seed/テスト用）は常に除外。
- サニティチェック＝取得件数が下限（既定 500）未満なら異常として中止（空/壊れた取得で全消しを防ぐ）。
  既存ファイルがある場合は「新件数が現件数の 50% 未満」も異常として中止（急減ガード）。

使い方:
  python scripts/update_disposable_domains.py                 # 既定 URL から取得して書き出し
  python scripts/update_disposable_domains.py --input f.txt   # ローカル入力（オフライン/テスト）
  python scripts/update_disposable_domains.py --output /tmp/x.txt --check-only  # 書き出さず検証のみ
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

DEFAULT_URL = (
    "https://raw.githubusercontent.com/disposable-email-domains/"
    "disposable-email-domains/main/disposable_email_blocklist.conf"
)
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "impl/backend/app/core/disposable_domains.txt"
MIN_FLOOR = 500  # 上流は数千件。これ未満は取得異常とみなす。

# 主要メールプロバイダ＝使い捨てではない。上流に紛れても常に除外（誤爆防止・大文字小文字無視）。
ALLOWLIST = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
    "yahoo.com", "yahoo.co.jp", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
    "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.net", "mail.com",
    "zoho.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com", "sina.com",
    "naver.com", "daum.net", "hanmail.net", "fastmail.com", "hey.com",
    # 日本の主要キャリア/プロバイダ
    "docomo.ne.jp", "ezweb.ne.jp", "au.com", "softbank.ne.jp", "i.softbank.jp",
    "ybb.ne.jp", "nifty.com", "biglobe.ne.jp", "so-net.ne.jp", "ocn.ne.jp",
}

HEADER = (
    "# 使い捨て（一時）メールドメイン blocklist（FR-48② SEC G・ローカル同梱）。\n"
    "# 自動生成＝scripts/update_disposable_domains.py（CI 週次で更新し差分を PR・案A）。手動編集しない。\n"
    "# 出典＝disposable-email-domains（公開リスト）を正規化（小文字/重複排除/ソート）。\n"
    "# 主要プロバイダ（gmail/outlook 等）と *.example は allowlist/規則で除外済み。\n"
)


def _normalize(raw_lines: list[str]) -> list[str]:
    out: set[str] = set()
    for line in raw_lines:
        d = line.strip().lower()
        if not d or d.startswith("#"):
            continue
        if d.endswith(".example") or d == "example.com":
            continue  # seed/テスト用は常に除外
        if d in ALLOWLIST:
            continue  # 主要プロバイダは誤爆防止で除外
        out.add(d)
    return sorted(out)


def _fetch(url: str) -> list[str]:
    req = urllib.request.Request(url, headers={"User-Agent": "ideaquest-blocklist-updater"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310（固定の https 公開URL）
        return resp.read().decode("utf-8", "replace").splitlines()


def _current_count(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for ln in path.read_text(encoding="utf-8").splitlines()
               if ln.strip() and not ln.lstrip().startswith("#"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--input", default=None, help="ローカル入力ファイル（指定時は URL 取得しない）")
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--check-only", action="store_true", help="書き出さず検証のみ")
    args = ap.parse_args()

    raw = Path(args.input).read_text(encoding="utf-8").splitlines() if args.input else _fetch(args.url)
    domains = _normalize(raw)

    # サニティチェック（誤爆/取得異常で全消しを防ぐ）。
    if len(domains) < MIN_FLOOR:
        print(f"[abort] 取得件数が下限未満: {len(domains)} < {MIN_FLOOR}（取得異常の可能性）", file=sys.stderr)
        return 2
    leaked = ALLOWLIST & set(domains)
    if leaked:
        print(f"[abort] 主要プロバイダが混入: {sorted(leaked)}", file=sys.stderr)
        return 3
    out_path = Path(args.output)
    prev = _current_count(out_path)
    if prev and len(domains) < prev * 0.5:
        print(f"[abort] 件数が急減: {len(domains)} < 現在 {prev} の50%（取得異常の可能性）", file=sys.stderr)
        return 4

    content = HEADER + "\n".join(domains) + "\n"
    if args.check_only:
        print(f"[ok] 検証のみ＝{len(domains)} 件（現在 {prev} 件）。書き出しなし。")
        return 0
    out_path.write_text(content, encoding="utf-8")
    print(f"[ok] {out_path} を更新＝{len(domains)} 件（現在 {prev} 件・差分 {len(domains) - prev:+d}）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
