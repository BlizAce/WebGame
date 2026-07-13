#!/usr/bin/env bash
# GateWars / webWars setup — Ubuntu & Bazzite (Fedora Atomic)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR_MIN=20
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GRN}[setup]${NC} $*"; }
warn()  { echo -e "${YLW}[setup]${NC} $*"; }
fail()  { echo -e "${RED}[setup]${NC} $*" >&2; exit 1; }

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_LIKE="${ID_LIKE:-}"
  else
    OS_ID="unknown"
    OS_LIKE=""
  fi
  info "Detected OS: ${OS_ID} (like: ${OS_LIKE:-n/a})"
}

is_immutable() {
  # Bazzite / Silverblue / Atomic: rpm-ostree present
  command -v rpm-ostree >/dev/null 2>&1
}

node_major() {
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0
}

install_nvm() {
  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "${HOME}/.nvm/nvm.sh"
    return 0
  fi
  info "Installing nvm (user-space Node)…"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="${HOME}/.nvm"
  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh"
}

ensure_node() {
  local major
  major="$(node_major)"
  if [[ "$major" -ge "$NODE_MAJOR_MIN" ]]; then
    info "Node $(node -v) / npm $(npm -v) OK"
    return 0
  fi

  warn "Node ${NODE_MAJOR_MIN}+ required (found: $(node -v 2>/dev/null || echo none))"

  if is_immutable || [[ "$OS_ID" == "bazzite" ]] || [[ "$OS_ID" == "fedora" && -n "$(command -v rpm-ostree 2>/dev/null || true)" ]]; then
    info "Immutable / Bazzite-style system — using nvm"
    install_nvm
    nvm install --lts
    nvm use --lts
  elif [[ "$OS_ID" == "ubuntu" ]] || [[ "$OS_LIKE" == *"debian"* ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      info "Installing Node via NodeSource (Ubuntu/Debian)…"
      if ! command -v curl >/dev/null 2>&1; then
        sudo apt-get update -y
        sudo apt-get install -y curl ca-certificates
      fi
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      install_nvm
      nvm install --lts
      nvm use --lts
    fi
  else
    warn "Unknown distro — falling back to nvm"
    install_nvm
    nvm install --lts
    nvm use --lts
  fi

  major="$(node_major)"
  [[ "$major" -ge "$NODE_MAJOR_MIN" ]] || fail "Node ${NODE_MAJOR_MIN}+ still missing after install"
  info "Node $(node -v) / npm $(npm -v) ready"
}

install_deps() {
  info "npm install…"
  npm install
}

smoke() {
  info "Typecheck / build smoke…"
  npm run build
}

main() {
  detect_os
  ensure_node
  install_deps
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    warn "Skipping build (SKIP_BUILD=1)"
  else
    smoke
  fi
  echo
  info "Done. Start the game with:"
  echo "  ./scripts/launch.sh"
  echo "  or: npm run dev"
  echo "  → http://localhost:3000"
}

main "$@"
