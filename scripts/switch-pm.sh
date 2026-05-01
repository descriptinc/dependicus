#!/bin/bash
set -e
pm="$1"

echo "Switching to $pm..."
rm -rf node_modules
if [ "$pm" = "pnpm" ]; then
    pnpm install
elif [ "$pm" = "bun" ]; then
    mise exec -- bun install
elif [ "$pm" = "npm" ]; then
    npm install
elif [ "$pm" = "yarn" ]; then
    # Disable hardened mode so yarn can update the lockfile when called
    # from update-all-lockfiles in CI (public PRs enable hardened mode).
    export YARN_ENABLE_HARDENED_MODE=0
    mise exec -- yarn install
elif [ "$pm" = "aube" ]; then
    # aube writes to whichever supported lockfile already exists, preferring
    # aube-lock.yaml when present. Import from the existing pnpm-lock.yaml so
    # that aube produces its own lockfile rather than overwriting pnpm's.
    mise exec -- aube import --force
    mise exec -- aube install
else
    echo "Usage: switch-pm.sh <pnpm|bun|npm|yarn|aube>" >&2
    exit 1
fi
echo "$pm" > .package-manager
echo "Done. node_modules installed by $pm."
