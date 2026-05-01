# CLI Reference

Dependicus provides four commands: `update`, `html`, `make-linear-issues`, and `make-github-issues`. All commands share a set of global options.

## Global options

| Flag                          | Description                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--repo-root <path>`          | Root directory of the project (default: cwd)                                                                       |
| `--provider <name>`           | Dependency provider to use (repeatable): pnpm, bun, yarn, npm, aube, mise, uv, go, rust. Auto-detects if omitted.  |
| `--vuln-source <source>`      | Vulnerability source to enable (repeatable): osv, depsdev, ghsa, github-advisory, all. See [below](#-vuln-source). |
| `--dependicus-base-url <url>` | Base URL where the Dependicus site is published                                                                    |
| `--output-dir <path>`         | Directory to write HTML and JSON output (default: `<repo-root>/dependicus-out`)                                    |
| `--cache-dir <path>`          | Directory to store cached API data (default: `<repo-root>/.dependicus-cache`)                                      |
| `--site-name <name>`          | Name shown in site heading and title tag                                                                           |

## Commands

### `update`

Collect dependency data from all configured providers, run data sources (registry lookups, vulnerability checks), and write `dependencies.json`.

```sh
dependicus update
dependicus update --html
dependicus update --provider pnpm --vuln-source all --html
```

| Flag     | Description                                       |
| -------- | ------------------------------------------------- |
| `--html` | Also generate the HTML site after collecting data |

### `html`

Generate the HTML site from previously collected data. Does not require network access.

```sh
dependicus html
dependicus html --json-file /path/to/dependencies.json
```

| Flag                 | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| `--json-file <path>` | Path to a `dependencies.json` file (default: `<output-dir>/dependencies.json`) |

### `make-linear-issues`

Create and update Linear tickets for outdated dependencies. Requires `LINEAR_API_KEY` environment variable.

```sh
LINEAR_API_KEY=lin_xxx dependicus make-linear-issues
```

| Flag                       | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `--dry-run`                | Preview changes without creating or modifying issues |
| `--json-file <path>`       | Path to `dependencies.json`                          |
| `--linear-team-id <id>`    | Assign all issues to this Linear team                |
| `--cooldown-days <days>`   | Days to wait before creating issues for new versions |
| `--rate-limit-days <days>` | Default notification rate limit in days              |
| `--no-new-issues`          | Only update existing issues, don't create new ones   |
| `--skip-state <name>`      | Skip issues in this Linear state (repeatable)        |

### `make-github-issues`

Create and update GitHub issues for outdated dependencies. Requires `GITHUB_TOKEN` environment variable (or `gh auth login`).

```sh
GITHUB_TOKEN=ghp_xxx dependicus make-github-issues
```

| Flag                       | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `--dry-run`                | Preview changes without creating or modifying issues |
| `--json-file <path>`       | Path to `dependencies.json`                          |
| `--github-owner <owner>`   | GitHub repository owner                              |
| `--github-repo <repo>`     | GitHub repository name                               |
| `--cooldown-days <days>`   | Days to wait before creating issues for new versions |
| `--rate-limit-days <days>` | Default notification rate limit in days              |
| `--no-new-issues`          | Only update existing issues, don't create new ones   |

## `--vuln-source`

Enable vulnerability scanning during `update`. This instantiates [SecurityPlugin](./security.md) with the selected sources. The flag is repeatable to enable multiple sources at once.

| Value             | Source                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `osv`             | [OSV.dev](https://osv.dev) -- known vulnerabilities via CVSS scoring                         |
| `depsdev`         | [deps.dev](https://deps.dev) -- deprecation status and transitive dependency counts          |
| `ghsa`            | GitHub Advisory Database -- security advisories (uses `GITHUB_TOKEN` for higher rate limits) |
| `github-advisory` | Alias for `ghsa`                                                                             |
| `all`             | Enable all three sources                                                                     |

```sh
dependicus update --vuln-source osv
dependicus update --vuln-source ghsa --vuln-source depsdev
dependicus update --vuln-source all
```

When omitted, no vulnerability scanning runs. For programmatic use with custom cache TTLs or other options, instantiate `SecurityPlugin` directly in the `plugins` array (see [SecurityPlugin](./security.md)).
