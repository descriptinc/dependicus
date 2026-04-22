# Changelog

<!-- loosely based on https://keepachangelog.com/en/1.0.0/ -->

## 0.1.10 - Unreleased

### Added

- aube package manager support
    - New `AubeProvider` in `@dependicus/providers-node` runs `aube list` (root) and `aube -r list` (workspaces) and reuses aube's pnpm-compatible `pnpm-workspace.yaml` for catalog and patch metadata. Workspace-to-workspace deps that aube inlines as concrete versions are stripped by name so they don't show up as registry dependencies.
    - When `DEPENDICUS_ALLOW_INSTALL=1` is set and `node_modules/.aube` is missing, `AubeProvider` runs `aube install --frozen-lockfile` first. Symmetric to the `PnpmProvider` guard, so multi-provider runs still produce accurate output for both tabs even when one provider reinstalled on top of the other's tree.
    - Auto-detection covers the `aube/` user agent and an `aube-lock.yaml` lockfile fallback
    - `--provider aube` is accepted by the CLI alongside the existing provider names

### Changed

### Fixed

- `PnpmProvider` now detects when `node_modules/.pnpm` is missing (because another package manager populated `node_modules`) and, if `DEPENDICUS_ALLOW_INSTALL=1` is set, runs `pnpm install --prefer-frozen-lockfile` before `pnpm -r list`. Without that env var, it emits a warning and proceeds. The repo's CI workflow sets `DEPENDICUS_ALLOW_INSTALL=1`, so CI artifacts from non-pnpm jobs now show correct pnpm dep counts instead of empty ones. Local runs are never modified without the opt-in.
- Recommended catalog YAML snippets are now idiomatic YAML
    - Scoped package names (those containing `/`) are wrapped in single quotes so the snippet is valid YAML
    - Version numbers are no longer double-quoted

### Removed

## 0.1.9 - 2026-03-23

Bug fixes.

## 0.1.8 - 2026-03-20

First usable public release.
