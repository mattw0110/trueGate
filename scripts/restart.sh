#!/usr/bin/env bash
# Restart the user-level truegate.service after local changes.
# The unit runs `tsx watch` so a build is NOT required for src/ edits,
# but tsx-watch occasionally misses newly-created files — restarting is
# the reliable path.
#
# Flags:
#   --build       run `npm run build` before restart (for dist/ consumers)
#   --typecheck   run typecheck + tests before restart (fail-fast)
#   --no-tail     skip the post-restart log tail
#   -h | --help

set -euo pipefail

SERVICE="truegate.service"
DO_BUILD=0
DO_CHECK=0
DO_TAIL=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)     DO_BUILD=1 ;;
    --typecheck) DO_CHECK=1 ;;
    --no-tail)   DO_TAIL=0 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

if [[ $DO_CHECK -eq 1 ]]; then
  echo "▸ typecheck"
  npm run typecheck
  echo "▸ test"
  npm test
fi

if [[ $DO_BUILD -eq 1 ]]; then
  echo "▸ build"
  npm run build
fi

echo "▸ restart $SERVICE"
systemctl --user restart "$SERVICE"

# Confirm it's up
sleep 1
if ! systemctl --user is-active --quiet "$SERVICE"; then
  echo "✗ $SERVICE is not active. Last 20 log lines:" >&2
  journalctl --user -u "$SERVICE" -n 20 --no-pager >&2
  exit 1
fi
echo "✓ $SERVICE active"

if [[ $DO_TAIL -eq 1 ]]; then
  echo "▸ tailing logs (Ctrl-C to exit)"
  exec journalctl --user -u "$SERVICE" -f --no-pager
fi
