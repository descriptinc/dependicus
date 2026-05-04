# SecurityPlugin

Dependicus ships with `SecurityPlugin`, which queries public vulnerability databases and enriches your dependency dashboard with security findings. It adds columns for severity, fix availability, and advisory details, and attaches security context to Linear and GitHub issue tickets.

## Data sources

`SecurityPlugin` supports three data sources, each enabled independently:

- **OSV** ([osv.dev](https://osv.dev)) -- Queries the OSV batch API to find known vulnerabilities for each dependency version. Uses CVSS vectors (v3.0, v3.1, v4.0) to compute severity scores. Supports npm, PyPI, Go, and Cargo ecosystems.

- **deps.dev** ([deps.dev](https://deps.dev)) -- Checks deprecation status and optionally fetches transitive dependency counts. Useful for flagging abandoned packages. Supports npm, PyPI, Go, and Cargo ecosystems.

- **GitHub Advisory Database** -- Queries the GitHub Advisory API for security advisories affecting each dependency version. Supports npm, pip, Go, and Rust ecosystems. Uses `GITHUB_TOKEN` when available for higher rate limits.

Each source writes `SecurityFinding` objects into `FactStore`, keyed by dependency name and version. When multiple sources are enabled, findings from all sources are merged and deduplicated by advisory ID.

## Programmatic setup

For custom cache TTLs, selective dependency counts, or other options beyond what the CLI flag provides, instantiate `SecurityPlugin` directly:

```ts
import { dependicusCli, SecurityPlugin } from 'dependicus';

void dependicusCli({
    repoRoot,
    plugins: [
        new SecurityPlugin({
            osv: true,
            depsdev: true,
            githubAdvisory: true,
        }),
    ],
}).run(process.argv);
```

Pass `true` for default settings, or pass a config object to customize behavior:

```ts
new SecurityPlugin({
    osv: { batchSize: 500, vulnCacheTtlDays: 3 },
    depsdev: { includeDependencies: false, cacheTtlDays: 14 },
    githubAdvisory: { cacheTtlDays: 1 },
});
```

## Caching

All three sources use `CacheService` for persistent caching to avoid redundant API calls across runs. The plugin receives the cache via the `init(ctx)` lifecycle hook, so no manual wiring is needed. Cache TTL is configurable per source (default: 7 days for all three).

## Table columns

When enabled, `SecurityPlugin` adds four columns to the HTML dashboard:

| Column        | Key           | Description                                                                                          |
| ------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Severity      | `security`    | Worst severity across all findings (None/Low/Medium/High/Critical), linked to the first advisory URL |
| Fix Available | `securityFix` | Whether any advisory has a known fix (Yes/No)                                                        |
| Security      | `securityWhy` | Linked advisory IDs and non-advisory rationale (e.g. deprecation, transitive dep count)              |
| Deprecated    | `maintenance` | Shows "Stale" for deprecated packages (from deps.dev)                                                |

All columns support filtering. Severity and Fix Available use dropdown filters; Security uses free-text search.

## Ticket integration

`SecurityPlugin` contributes `descriptionSections` to both Linear and GitHub issue specs. When findings exist for a dependency version, the ticket description includes:

- **Security summary** -- severity, CVSS score, advisory count, fix availability, maintenance posture
- **Advisories** -- deduplicated list of advisory IDs with summaries, severity, CVSS scores, and fix status, linked to their source URLs
- **Why this matters** -- non-advisory rationale (deprecation, transitive dependency counts)

These sections are appended to any sections from other plugins (like `BasicCompliancePlugin`).

## Grouping detail pages

`SecurityPlugin` also provides `getSections` for grouping detail pages (e.g. per-team rollup pages). The security section shows counts of dependencies with advisories, how many have fixes available, and how many are clean.

## Configuration reference

### `SecurityPluginConfig`

| Field            | Type                              | Description                                   |
| ---------------- | --------------------------------- | --------------------------------------------- |
| `osv`            | `boolean \| OsvConfig`            | Enable OSV.dev vulnerability lookups          |
| `depsdev`        | `boolean \| DepsDevConfig`        | Enable deps.dev maintenance/ecosystem context |
| `githubAdvisory` | `boolean \| GitHubAdvisoryConfig` | Enable GitHub Advisory vulnerability lookups  |

### `OsvConfig`

| Field              | Type     | Default | Description                                    |
| ------------------ | -------- | ------- | ---------------------------------------------- |
| `batchSize`        | `number` | 1000    | Batch size for OSV API queries                 |
| `vulnCacheTtlDays` | `number` | 7       | Days to cache individual vulnerability details |

### `DepsDevConfig`

| Field                 | Type      | Default | Description                                                       |
| --------------------- | --------- | ------- | ----------------------------------------------------------------- |
| `includeDependencies` | `boolean` | true    | Include transitive dependency counts (extra API call per package) |
| `cacheTtlDays`        | `number`  | 7       | Cache TTL in days                                                 |

### `GitHubAdvisoryConfig`

| Field          | Type     | Default | Description       |
| -------------- | -------- | ------- | ----------------- |
| `cacheTtlDays` | `number` | 7       | Cache TTL in days |
