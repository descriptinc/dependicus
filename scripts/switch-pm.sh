#!/bin/bash
set -e
pm="$1"

# npm doesn't understand "workspace:*", so we rewrite to "*" before install.
# Other PMs understand "workspace:*" natively, so we restore it.
rewrite_workspace_deps_for_npm() {
    sed -i '' 's/"workspace:\*"/"*"/g' packages/*/package.json
}

restore_workspace_deps() {
    sed -i '' 's/"\(@dependicus\/[^"]*\)": "\*"/"\1": "workspace:*"/g' packages/*/package.json
}

echo "Switching to $pm..."
rm -rf node_modules packages/*/node_modules
if [ "$pm" = "pnpm" ]; then
    restore_workspace_deps
    pnpm install
elif [ "$pm" = "bun" ]; then
    restore_workspace_deps
    mise exec -- bun install
elif [ "$pm" = "npm" ]; then
    rewrite_workspace_deps_for_npm
    npm install
    # npm install overwrites yarn.lock with v1 format; restore the Berry lockfile
    git checkout -- yarn.lock
elif [ "$pm" = "yarn" ]; then
    restore_workspace_deps
    mise exec -- yarn install
else
    echo "Usage: switch-pm.sh <pnpm|bun|npm|yarn>" >&2
    exit 1
fi
echo "$pm" > .package-manager
echo "Done. node_modules installed by $pm."
