#!/usr/bin/env bash
# 起動時に DB を用意（作成→マイグレーション→シード）してから API を起動する。
# すべて冪等（再起動しても壊れない）。
set -euo pipefail

echo "[entrypoint] bootstrap: create databases + migrate + seed"
python -m scripts.bootstrap

# 引数があればそれを実行（例: `docker compose run --rm backend pytest`）。無ければ API 起動。
if [ "$#" -gt 0 ]; then
  echo "[entrypoint] exec: $*"
  exec "$@"
fi

echo "[entrypoint] starting uvicorn"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
