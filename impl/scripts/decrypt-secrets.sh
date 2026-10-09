#!/usr/bin/env bash
# D6: SOPS+age デプロイ時復号（案1 デプロイ時復号・案2 鍵は常駐させず投入のみ・平文は tmpfs）。
# 設計=シークレット管理(SOPS) §4-A/§5/§10／本番デプロイ要件 §3.1。
#
# 本番サーバで `docker compose ... up` の直前に実行する。secrets/secrets.enc.yaml（暗号文・Git 可）を
# age 秘密鍵で復号し、各キーを復号先ディレクトリに `<name>` ファイル（0400）として materialize する。
# compose.secrets.yaml はそのディレクトリを `file:` 参照する。
#
# セキュリティ方針（なぜこう書くか）:
#  - age 秘密鍵は「投入のみ・常駐させない」(案2)＝SOPS_AGE_KEY_FILE で一時的に渡す。本スクリプトは鍵を
#    ディスクへ書かない／コピーしない。呼び出し側が使い終わりに鍵を破棄する前提（例: tmpfs/リムーバブル）。
#  - 復号先は tmpfs 推奨（平文をディスクに残さない・§8）。既定 ./secrets が tmpfs でない場合は警告する。
#  - 鍵が無ければ fail-closed（復号しない・空ファイルも作らない）。
#  - 権限: 復号先ディレクトリを 0700（ホスト側で deploy ユーザ＋root のみ到達）・ファイルを 0444 にする。
#    理由＝**非 Swarm の docker compose は secret の uid/gid/mode を無視しホストの所有/権限のまま bind-mount する**。
#    コンテナの実行ユーザ（例: jasper=10001）がホストファイルを読めないと env へフォールバックしてしまうため、
#    ファイルは「どの uid でも読める 0444」にし、平文は **親ディレクトリ 0700（＋tmpfs）** で守る（protect-by-directory）。
#    より厳格にしたい場合は root で実行し、消費コンテナの uid へ chown して 0400 にする（下記 STRICT_CHOWN_UID）。
#
# 使い方:
#   SOPS_AGE_KEY_FILE=/path/to/age.key impl/scripts/decrypt-secrets.sh            # 復号先=impl/secrets
#   SOPS_AGE_KEY_FILE=/path/to/age.key OUT_DIR=/run/ideaquest-secrets impl/scripts/decrypt-secrets.sh
# 前提: sops / age が PATH にあること（本番/CI の運用前提・apt の age・sops バイナリ）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = impl/
ENC_FILE="${ENC_FILE:-$HERE/secrets/secrets.enc.yaml}"
OUT_DIR="${OUT_DIR:-$HERE/secrets}"

command -v sops >/dev/null 2>&1 || { echo "[decrypt-secrets] ERROR: sops が PATH にありません" >&2; exit 1; }
if [ -z "${SOPS_AGE_KEY:-}" ] && [ -z "${SOPS_AGE_KEY_FILE:-}" ]; then
  echo "[decrypt-secrets] ERROR: age 秘密鍵が未投入（SOPS_AGE_KEY か SOPS_AGE_KEY_FILE を設定）。fail-closed。" >&2
  exit 1
fi
[ -f "$ENC_FILE" ] || { echo "[decrypt-secrets] ERROR: 暗号化ファイルが無い: $ENC_FILE" >&2; exit 1; }

mkdir -p "$OUT_DIR"; chmod 0700 "$OUT_DIR" || true
# 復号先が tmpfs かを確認（平文をディスクに残さないため・§8）。tmpfs でなければ警告のみ（dev 検証は通す）。
if command -v stat >/dev/null 2>&1; then
  FSTYPE="$(stat -f -c %T "$OUT_DIR" 2>/dev/null || echo unknown)"
  case "$FSTYPE" in
    tmpfs|ramfs) : ;;
    *) echo "[decrypt-secrets] WARN: 復号先 $OUT_DIR は tmpfs ではありません（$FSTYPE）。本番は tmpfs に（平文がディスクに残る）。" >&2 ;;
  esac
fi

# JSON で復号 → 各トップレベルキーを `<name>` ファイルへ（値は改行なしで書く＝backend/jasper の strip と整合）。
# python3 は backend 前提環境で常用。sops 出力はメモリ経由（中間平文ファイルを作らない）。
# 注: `python3 -c` で渡す（`python3 - <<EOF` だと heredoc が stdin を奪い JSON が届かない）。
# STRICT_CHOWN_UID を設定し root で実行すると、ファイルを 0400＋その uid 所有にする（最厳格・消費 uid が1つの時）。
PYPROG='
import json, os, sys
data = json.load(sys.stdin)
out = os.environ["OUT_DIR"]
strict_uid = os.environ.get("STRICT_CHOWN_UID", "")
n = 0
for k, v in data.items():
    if not isinstance(v, (str, int, float)):
        continue  # ネスト値は対象外（フラットな <name>:<値> のみ）
    p = os.path.join(out, k)
    # 既存ファイルの残存権限に影響されないよう作り直す。
    if os.path.exists(p):
        os.remove(p)
    mode = 0o400 if strict_uid else 0o444  # 非 Swarm: compose は mode を無視＝ホスト権限で決まる。既定は 0444（コンテナ読取可）
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as fh:
        fh.write(str(v))
    os.chmod(p, mode)
    if strict_uid:
        os.chown(p, int(strict_uid), -1)  # root 実行時のみ成功（最厳格: 消費コンテナ uid 所有＋0400）
    n += 1
print(n)
'
COUNT="$(sops --decrypt --output-type json "$ENC_FILE" | OUT_DIR="$OUT_DIR" python3 -c "$PYPROG")"
MODE_NOTE="$([ -n "${STRICT_CHOWN_UID:-}" ] && echo "0400 owner=${STRICT_CHOWN_UID}" || echo "0444・dir 0700")"
echo "[decrypt-secrets] OK: $COUNT 件の秘密を $OUT_DIR に materialize（$MODE_NOTE）。compose.secrets.yaml がこれを file マウントします。"
echo "[decrypt-secrets] 注意: age 秘密鍵は本スクリプトでは保存していません。呼び出し側で破棄してください（案2）。"
