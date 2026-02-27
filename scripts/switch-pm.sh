#!/bin/bash
set -e
pm="$1"
echo "Switching to $pm..."
rm -rf node_modules packages/*/node_modules
if [ "$pm" = "pnpm" ]; then
    pnpm install
elif [ "$pm" = "bun" ]; then
    mise exec -- bun install
else
    echo "Usage: switch-pm.sh <pnpm|bun>" >&2
    exit 1
fi
echo "$pm" > .package-manager
echo "Done. node_modules installed by $pm."
