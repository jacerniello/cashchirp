#!/usr/bin/env bash
# Pull the latest main on a server and restart only what changed.
#
#   sudo ./deploy.sh           # pull, rebuild what the diff touched, restart, verify
#   sudo ./deploy.sh --force   # rebuild and restart everything, even with no new commits
#   sudo ./deploy.sh --dry-run # say what would happen, change nothing
#
# Run it from the checkout on the server (/opt/cashchirp on the droplet). It needs root
# for `systemctl restart`. Everything it touches is derived — the Python venv, web/.next —
# so a failed run leaves the previous build serving rather than a half-updated site.
#
# Builds happen BEFORE any restart, deliberately: a build that fails must not take the
# running site down with it.
set -euo pipefail
cd "$(dirname "$0")"

API_SERVICE="${API_SERVICE:-cashchirp-api}"
WEB_SERVICE="${WEB_SERVICE:-cashchirp-web}"
API_URL="${API_HEALTH_URL:-http://127.0.0.1:8001/health}"
WEB_URL="${WEB_HEALTH_URL:-http://127.0.0.1:3010/}"
PY="${PY:-.venv/bin/python}"

FORCE=0; DRY=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then say "would run: $*"; else "$@"; fi; }

[ -d .git ] || { echo "not a git checkout: $PWD" >&2; exit 1; }

# Refuse to clobber uncommitted work. A server checkout should never have any, and if it
# does, someone edited in production and deserves to be told rather than overwritten.
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty — refusing to deploy:" >&2
  git status --short >&2
  exit 1
fi

step "pulling"
OLD=$(git rev-parse HEAD)
[ "$DRY" = 1 ] || git pull --ff-only --quiet
NEW=$(git rev-parse HEAD)
if [ "$OLD" = "$NEW" ]; then
  say "already at $(git rev-parse --short HEAD) — nothing new"
  [ "$FORCE" = 1 ] || { say "(pass --force to rebuild and restart anyway)"; exit 0; }
else
  say "$(git rev-parse --short "$OLD") -> $(git rev-parse --short "$NEW")"
  git --no-pager log --oneline "$OLD..$NEW" | sed 's/^/    /'
fi

# What changed decides what gets rebuilt. --force, or a missing build, means everything.
CHANGED=$(git diff --name-only "$OLD" "$NEW" || true)
touched() { [ "$FORCE" = 1 ] && return 0; printf '%s\n' "$CHANGED" | grep -q "$1"; }

DO_PIP=0; DO_NPM=0; DO_BUILD=0; DO_API=0; DO_WEB=0
touched '^core/requirements'           && DO_PIP=1
touched '^web/package\(-lock\)\?\.json' && DO_NPM=1
touched '^web/'                        && DO_BUILD=1
touched '^core/'                       && DO_API=1
[ -d web/.next ] || { DO_BUILD=1; say "web/.next missing — forcing a build"; }
[ "$DO_BUILD" = 1 ] && DO_WEB=1
[ "$DO_NPM" = 1 ] && DO_BUILD=1

# ---- build first, restart second -------------------------------------------------
if [ "$DO_PIP" = 1 ]; then
  step "python dependencies"
  run "$PY" -m pip install -q -r core/requirements.txt
fi

if [ "$DO_NPM" = 1 ]; then
  step "node dependencies"
  # NOT --omit=dev: typescript, tailwindcss and @tailwindcss/postcss are devDependencies,
  # and the build needs all three. Dropping them breaks `next build` and leaves
  # next.config.ts unreadable at startup.
  run npm --prefix web ci --no-audit --no-fund
fi

if [ "$DO_BUILD" = 1 ]; then
  step "building the frontend"
  say "this needs ~1 GB; the droplet leans on swap here, so it is slow but survives"
  run npm --prefix web run build
fi

# ---- restarts ---------------------------------------------------------------------
[ "$DO_API" = 1 ] && { step "restarting $API_SERVICE"; run systemctl restart "$API_SERVICE"; }
[ "$DO_WEB" = 1 ] && { step "restarting $WEB_SERVICE"; run systemctl restart "$WEB_SERVICE"; }
if [ "$DO_API$DO_WEB" = "00" ]; then
  step "no service needed restarting"
  say "changes touched neither core/ nor web/"
fi

# ---- verify ------------------------------------------------------------------------
[ "$DRY" = 1 ] && { step "dry run — nothing changed"; exit 0; }

step "verifying"
check() {  # name url -> 0 if it answers 200 within ~30s
  local name=$1 url=$2 code=
  for _ in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url" || true)
    [ "$code" = "200" ] && { say "$name: 200"; return 0; }
    sleep 2
  done
  say "$name: $code (expected 200)"
  return 1
}
rc=0
check "api ($API_URL)" "$API_URL" || rc=1
check "web ($WEB_URL)" "$WEB_URL" || rc=1

if [ "$rc" != 0 ]; then
  step "FAILED — recent logs"
  journalctl -u "$API_SERVICE" -u "$WEB_SERVICE" -n 25 --no-pager 2>/dev/null | sed 's/^/    /'
  exit 1
fi

step "deployed $(git rev-parse --short HEAD)"
