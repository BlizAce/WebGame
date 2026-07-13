#!/usr/bin/env bash
# GateWars / webWars launcher — Linux / macOS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR_MIN=20
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GRN}[launch]${NC} $*"; }
warn()  { echo -e "${YLW}[launch]${NC} $*"; }
fail()  { echo -e "${RED}[launch]${NC} $*" >&2; exit 1; }

node_major() {
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0
}

# Load nvm if present (Bazzite / user-space Node)
if ! command -v node >/dev/null 2>&1; then
  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "${HOME}/.nvm/nvm.sh"
  fi
fi

command -v node >/dev/null 2>&1 || fail "Node.js not found. Run ./scripts/setup.sh first."
command -v npm >/dev/null 2>&1 || fail "npm not found. Run ./scripts/setup.sh first."

major="$(node_major)"
[[ "$major" -ge "$NODE_MAJOR_MIN" ]] || fail "Node ${NODE_MAJOR_MIN}+ required (found: $(node -v 2>/dev/null || echo none)). Run ./scripts/setup.sh first."

if [[ ! -d node_modules ]]; then
  warn "node_modules missing — running npm install…"
  npm install
fi

PORT="${PORT:-3000}"
info "Starting GateWars at http://localhost:${PORT}"
info "Press Ctrl+C to stop."
echo

# Prefer next's -p when PORT is customized
if [[ "$PORT" == "3000" ]]; then
  exec npm run dev
else
  exec npx next dev -p "$PORT"
fi
