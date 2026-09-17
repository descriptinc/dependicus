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
    # npm rewrites yarn.lock in the old v1 format as a side effect of
    # installing. Left in place, the next `yarn install` treats that as a
    # lockfile to import and re-resolves every range against the registry,
    # so yarn.lock churns whenever anything upstream publishes. Put the
    # real lockfile back so yarn keeps resolving from its own pins.
    if [ -f yarn.lock ]; then
        yarn_lock_backup=$(mktemp)
        cp yarn.lock "$yarn_lock_backup"
        trap 'cp "$yarn_lock_backup" yarn.lock; rm -f "$yarn_lock_backup"' EXIT
        npm install
        cp "$yarn_lock_backup" yarn.lock
        rm -f "$yarn_lock_backup"
        trap - EXIT
    else
        npm install
    fi
elif [ "$pm" = "yarn" ]; then
    # In CI, yarn auto-enables immutable installs and hardened mode (on
    # public PRs), both of which prevent lockfile changes. Disable both
    # so update-all-lockfiles can regenerate yarn.lock.
    export YARN_ENABLE_HARDENED_MODE=0
    export YARN_ENABLE_IMMUTABLE_INSTALLS=false
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
