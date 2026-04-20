#!/usr/bin/env bash
set -euo pipefail

if ! command -v mise >/dev/null 2>&1; then
    curl https://mise.run | sh
fi

export PATH="$HOME/.local/bin:$PATH"

if ! rg -F 'mise activate bash' "$HOME/.bashrc" >/dev/null 2>&1; then
    echo 'eval "$(/home/ubuntu/.local/bin/mise activate bash)"' >> "$HOME/.bashrc"
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mise trust "$ROOT_DIR/mise.toml"
mise install
mise run switch:pnpm
