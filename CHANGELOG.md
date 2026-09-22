# Changelog

<!-- loosely based on https://keepachangelog.com/en/1.0.0/ -->

## 0.2.2 - 2026-05-19

### Added

- Dependicus can be installed from a git URL, not just from the registry, which is useful for trying a fix that isn't released yet.
    - Dependicus now builds itself from the clone, so `npm install github:descriptinc/dependicus` gives you a working `dependicus` command instead of an empty one.
    - pnpm and yarn refuse to run a git dependency's build script until you list the package as trusted. The README has the line of config each one wants.
    - Bun and aube can't install Dependicus from git. Bun doesn't install a git dependency's devDependencies, so the build has nothing to run with, and aube doesn't accept git specifiers.
- `GroupingConfig.getValue` may return several values, and the dependency is filed under each of them. A grouping used to be a partition, which doesn't fit a dimension whose membership overlaps: a package used by three teams belongs on all three of their pages. Returning a single string still works.
- `GroupingConfig.ecosystems` limits a grouping to the ecosystems it can actually be computed for, e.g. `['npm']`. Providers for any other ecosystem skip it, and their pages leave it out of the nav, instead of rendering an index with no entries and a nav link to it. Omitting the field keeps today's behavior.

- `SecurityPlugin` now renders its advisories on each dependency's own page: a summary of severity, score, fix availability and which sources reported it, the advisories themselves with their summaries and links, and the non-advisory rationale. It had assembled all of this for Linear and GitHub issue bodies already and had nowhere to put it on the site, so a vulnerable dependency's page showed a severity word and no way to find out more.
- `DependicusPlugin.getDependencySections` puts sections on a single dependency's page, the same shape as the grouping ones. A plugin holding per-version detail, like the advisories `SecurityPlugin` already assembles for Linear and GitHub issues, can render it where someone is looking at that dependency instead of only as a metadata row.
- A custom column's `getTooltip` now shows next to its value on a dependency's page. The table shows it on hover, and that page was the one place the extra detail was dropped, so a Severity column read "High" with its CVSS score and fix version nowhere.
- `getDetailFilename` is exported, like `getGroupingFilename` already was. A plugin section that links a dependency needs it to build the href.

- A Snyk source for `SecurityPlugin`, enabled with `--vuln-source snyk` plus `--snyk-org <uuid>`, or `snyk: { orgId }` programmatically. It reads `SNYK_API_TOKEN` and skips itself when that's unset, so it costs nothing to leave configured. Snyk is paid, so this is deliberately outside `--vuln-source all`.
    - Snyk carries two things the free sources don't: its own severity grade, which often disagrees with NVD's, and an exploit-maturity verdict saying whether a working exploit is published. Run across one monorepo it found four npm packages that OSV and the GitHub Advisory Database both missed.
    - Its findings merge with the other sources' and deduplicate against them on GHSA or CVE, so advisory counts don't double up.
    - Go coverage is partial and the docs say why: Snyk files many Go advisories against an individual package or the standard library, while the Go provider reports module paths.

- Issue specs can file one issue per team for a dependency several teams use.
    - `getLinearIssueSpec` and `getGitHubIssueSpec` may return an array of specs. Each spec with its own `scope` gets its own issue, with the scope in the title, created, updated and closed independently of the others. A single spec works as before, and unscoped issues keep matching.
    - `VersionContext.usedBy` lists the packages that use the version, and a spec's `usedBy` narrows its issue to the packages it covers, so each team's issue names only its own.
    - Plugin specs merge per scope. A plugin returning a single spec, like `SecurityPlugin`'s description sections, reaches every scoped issue.
- Issue specs can set `minimumVersion`, the lowest release that resolves the issue. The title asks for at least that version, and the due date counts from when it was published. Without it, issues still ask for the first release of the update type needed, which for a vulnerability is often not the release that fixes it.
- The Snyk source records which versions fix each advisory, and the lowest version that fixes them all. Tickets and dependency pages show them, and `getFixVersion(store, name, version)` returns it for use as `minimumVersion`.

### Changed

- `searchDependicusIssues` (in `@dependicus/github-issues`) now treats draft pull requests as not yet open for review and excludes them from results, while ready-for-review pull requests are returned alongside regular issues. Each returned entry carries an `isPullRequest` boolean so notification bots can count open Dependicus items accurately — drafts no longer pad the total — and the reconciler can avoid mutating pull requests. Anything explicitly flagged as a draft (PR or otherwise) is still skipped defensively.

### Fixed

- Deprecation detection now works on pnpm 11 and pnpm 12, not just pnpm 10.
    - pnpm 12 removed the `pnpm install --resolution-only` flag Dependicus used to find deprecated packages, so `dependicus update` failed outright against any pnpm 12 workspace and produced no output at all.
    - pnpm 11 and pnpm 12 skip re-resolving when the lockfile and `node_modules` already agree, which left every package looking undeprecated. Dependicus now asks pnpm to resolve anyway.
    - Deprecation warnings are read from pnpm's machine-readable reporter rather than scraped from console text, and `pnpm why` output is understood in both its old and new shapes, so the deprecated flag and the list of deprecated transitive dependencies are correct on every supported pnpm version.
- The dashboard no longer throws `Cannot read properties of null (reading 'offsetWidth')` on load. Switching to a tab redrew its table before the table had finished building, and the error aborted the rest of the navigation, so the URL hash was never updated either. Tables are now redrawn once they report themselves ready.
- Fix version numbers without `.` failing to match open tickets, resulting in duplicates
- `dependicus update` no longer reuses a dependency listing from an install that covered only part of a pnpm workspace.
    - The `pnpm -r list` output is cached against the lockfile hash, but the command reports what is in `node_modules`. A run whose install skipped part of the workspace, which is what `pnpm install --filter ...` on a fresh checkout gives you, cached a listing with those packages' dependencies missing. Every later run on the same lockfile was handed it back, and the dashboard silently left out most of the workspace.
    - The listing now invalidates on `node_modules/.modules.yaml` too, which is pnpm's own record of the install, so it is discarded when the installed set changes. `CacheService.isCacheValid` and `writeCache` accept several invalidation paths for this. A single path hashes exactly as before, so existing caches survive the upgrade.
- Installing Dependicus from git now works on pnpm 12.
    - pnpm 12 fails any install that skipped a dependency's build script, and esbuild, a transitive dependency of Dependicus, has one. This surfaced as `ERR_PNPM_PREPARE_PACKAGE`, because pnpm builds a git dependency by running `prepare` in a nested install you cannot configure.
    - Dependicus now allows esbuild's build script itself, which also fixes `pnpm install` in a Dependicus checkout.
    - That allowlist lives in a `pnpm-workspace.yaml`, which pnpm 12 also reads its config from. The file declares the single package explicitly, because `aube -r list` errors without a `packages` key.
- The README's pnpm instructions for installing from git were wrong on pnpm 12, which wants an `allowBuilds` entry keyed on the resolved package URL instead of the `onlyBuiltDependencies` name older versions accepted.

- A grouping's detail page counted and listed its dependencies three different ways. "Total Dependencies" counted distinct names while "Outdated" and "In Catalog" counted versions, so a group holding a dependency installed at more than one version reported more outdated than it had in total: 41 and 62 on the same card here. The list beside them showed only each dependency's first version, hiding the rest. All three counts and the list are now per dependency@version.

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
