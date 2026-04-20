# Changelog

<!-- loosely based on https://keepachangelog.com/en/1.0.0/ -->

## 0.1.10 - Unreleased

### Added

- aube package manager support
    - New `AubeProvider` in `@dependicus/providers-node` reads `aube-lock.yaml` via `aube -r list --json --depth=0` and reuses aube's pnpm-compatible `pnpm-workspace.yaml` for catalog and patch metadata
    - Auto-detection covers the `aube/` user agent and an `aube-lock.yaml` lockfile fallback
    - `--provider aube` is accepted by the CLI alongside the existing provider names

### Changed

### Fixed

- Recommended catalog YAML snippets are now idiomatic YAML
    - Scoped package names (those containing `/`) are wrapped in single quotes so the snippet is valid YAML
    - Version numbers are no longer double-quoted

### Removed

## 0.1.9 - 2026-03-23

Bug fixes.

## 0.1.8 - 2026-03-20

First usable public release.
