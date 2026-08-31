#!/usr/bin/env bash
# Run the whole app locally: the FastAPI bridge (core/api) + the Next frontend (web/).
#
#   ./dev.sh            # API on :8001, web on :3000 -> http://localhost:3000
#   PORT=3001 ./dev.sh  # override the web port
#
# The Next dev server forwards /api/* to the API verbatim (see web/next.config.ts), and the
# API reads core/.env for its Postgres connection. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

API_PORT="${API_PORT:-8001}"
WEB_PORT="${PORT:-3000}"
PY="${PY:-.venv/bin/python}"
[ -x "$PY" ] || PY=python3

pids=()
cleanup() { trap - INT TERM EXIT; for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup INT TERM EXIT

echo "→ API   http://127.0.0.1:${API_PORT}  (docs at /docs)"
"$PY" -m uvicorn core.api.main:app --reload --port "$API_PORT" &
pids+=($!)

echo "→ Web   http://localhost:${WEB_PORT}"
(cd web && API_URL="http://127.0.0.1:${API_PORT}" npm run dev -- --port "$WEB_PORT") &
pids+=($!)

# Plain `wait` (not `wait -n`): macOS ships bash 3.2, which has no -n. Ctrl-C hits the
# trap above and takes both down together.
wait
