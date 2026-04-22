#!/bin/bash
set -e
pm="$1"

# npm doesn't understand "workspace:*", so we rewrite to "*" before install.
# Other PMs understand "workspace:*" natively, so we restore it.
rewrite_workspace_deps_for_npm() {
    for f in packages/*/package.json; do
        jq --indent 4 '
            (.dependencies // {}) |= with_entries(if .value == "workspace:*" then .value = "*" else . end) |
            (.devDependencies // {}) |= with_entries(if .value == "workspace:*" then .value = "*" else . end)
        ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    done
}

restore_workspace_deps() {
    for f in packages/*/package.json; do
        jq --indent 4 '
            (.dependencies // {}) |= with_entries(if (.key | startswith("@dependicus/")) and .value == "*" then .value = "workspace:*" else . end) |
            (.devDependencies // {}) |= with_entries(if (.key | startswith("@dependicus/")) and .value == "*" then .value = "workspace:*" else . end)
        ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    done
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
elif [ "$pm" = "aube" ]; then
    restore_workspace_deps
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
