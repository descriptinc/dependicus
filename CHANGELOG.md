# Changelog

<!-- loosely based on https://keepachangelog.com/en/1.0.0/ -->

## 0.2.2 - 2026-05-19

### Added

- Linear issue creation can now be rate-limited per team with `linear.teamIssueRateLimit`, capping how many new or reopened Dependicus tickets one Linear team receives during a rolling window while still updating and closing existing tickets.

### Changed

- `searchDependicusIssues` (in `@dependicus/github-issues`) now skips every pull request returned by GitHub's issues endpoint — drafts and ready-to-review alike — and also skips anything flagged as a draft. Only real, non-draft issues are returned, so notification bots and reports built on this helper stop counting pull requests as open Dependicus items.

### Fixed

- Fix version numbers without `.` failing to match open tickets, resulting in duplicates

### Removed

## 0.2.1 - 2026-05-07

### Fixed

- The output schema rejected data from providers that don't set `publishDate` (like Mise), causing `make-github-issues` and `make-linear-issues` to crash with a ZodError when run against multi-ecosystem output.

## 0.2.0 - 2026-05-07

### Added

- Plugin lifecycle hook: plugins can implement `init(ctx: PluginContext)` to receive `CacheService` after services are created but before data collection. `PluginContext` is exported from `@dependicus/core`.
- `softDependsOn` on `DataSource`: sources can declare optional ordering dependencies that are respected when present in the pool and silently ignored when absent. Provider sources and plugin sources now run in a single topological sort per ecosystem, so plugin sources can declare ordering relative to provider sources.
- `ColumnContext` type in `@dependicus/core` shared by `CustomColumn` callbacks and `UsedByGroupKeyFn`, carrying `name`, `version`, `store`, and `ecosystem` in one object.
- `CacheService` is now re-exported from the top-level `dependicus` package, so plugins and consumers no longer need to import it from `@dependicus/core` directly.
- `getGroupingFilename()` helper for building URL-safe filenames from grouping values, analogous to `getDetailFilename()` for dependency pages.
- `SecurityPlugin` for querying public vulnerability databases (OSV, deps.dev, GitHub Advisory) and enriching the dashboard with severity, fix availability, deprecation status, and advisory details. Findings are attached to Linear and GitHub issue tickets and shown on grouping detail pages. Enable via `--vuln-source` CLI flag or programmatically.
- Issue lifecycle comments: when Dependicus closes or reopens an issue, it posts a comment explaining why with version details and policy context. Plugins can contribute additional context via `commentSections` on the issue spec (same shape as `descriptionSections`).
- Closed-issue reopen: when about to create a new issue, Dependicus first searches for a closed issue with an identical title and reopens it instead of creating a duplicate.
- Flapping prevention: the close loop skips closing when a dependency or group was absent from provider input, preventing spurious close/reopen cycles caused by transient provider failures or external agents closing tickets.

### Changed

- **Breaking:** `CustomColumn.getValue`, `getTooltip`, and `getFilterValue` now take a single `ColumnContext` argument instead of `(name, version, store, ecosystem)`.
- **Breaking:** `UsedByGroupKeyFn` now takes `ColumnContext` instead of `(name, version, store)`.
- **Breaking:** `buildIssueDescription` and `buildGroupIssueDescription` in both `@dependicus/linear` and `@dependicus/github-issues` now take a single params object (`IssueDescriptionParams` / `GroupDescriptionParams`) instead of positional arguments.
- **Breaking:** Plugin issue spec merging no longer validates with Zod immediately. `ResolvedPlugins.getLinearIssueSpec` and `getGitHubIssueSpec` return `Partial<Spec> | undefined`. Validation happens in the CLI after flag injection via new `validateLinearIssueSpec` / `validateGitHubIssueSpec` helpers.
- **Breaking:** Direct `config.linear.getLinearIssueSpec` and `config.github.getGitHubIssueSpec` are now merged with plugin specs instead of overriding them. Config specs provide defaults; plugin specs can override scalar fields; `descriptionSections` from all sources are concatenated.

### Fixed

- Grouping detail pages (surfaces, teams) with spaces, parentheses, or other URL-unsafe characters in their names now produce sanitized filenames instead of raw values, fixing 404s on static file servers.
- The pnpm and aube providers now work on single-package repos (no `pnpm-workspace.yaml`). Previously they unconditionally used `-r list` which could produce malformed output or error outside a workspace.

## 0.1.10 - 2026-04-22

### Added

- aube package manager support
    - New `AubeProvider` in `@dependicus/providers-node` runs `aube list` (root) and `aube -r list` (workspaces) and reuses aube's pnpm-compatible `pnpm-workspace.yaml` for catalog and patch metadata. Workspace-to-workspace deps that aube inlines as concrete versions are stripped by name so they don't show up as registry dependencies.
    - When `DEPENDICUS_ALLOW_INSTALL=1` is set and `node_modules/.aube` is missing, `AubeProvider` runs `aube install --frozen-lockfile` first. Symmetric to the `PnpmProvider` guard, so multi-provider runs still produce accurate output for both tabs even when one provider reinstalled on top of the other's tree.
    - Auto-detection covers the `aube/` user agent and an `aube-lock.yaml` lockfile fallback
    - `--provider aube` is accepted by the CLI alongside the existing provider names

### Fixed

- `PnpmProvider` now detects when `node_modules/.pnpm` is missing (because another package manager populated `node_modules`) and, if `DEPENDICUS_ALLOW_INSTALL=1` is set, runs `pnpm install --prefer-frozen-lockfile` before `pnpm -r list`. Without that env var, it emits a warning and proceeds. The repo's CI workflow sets `DEPENDICUS_ALLOW_INSTALL=1`, so CI artifacts from non-pnpm jobs now show correct pnpm dep counts instead of empty ones. Local runs are never modified without the opt-in.
- Recommended catalog YAML snippets are now idiomatic YAML
    - Scoped package names (those containing `/`) are wrapped in single quotes so the snippet is valid YAML
    - Version numbers are no longer double-quoted

## 0.1.9 - 2026-03-23

Bug fixes.

## 0.1.8 - 2026-03-20

First usable public release.
