# Package Managers

Dependicus supports pnpm, bun, yarn, npm, aube, mise, uv, Go modules, and Rust crates as dependency providers. For Node.js package managers it reads the lockfile and workspace structure. For mise it reads `mise.toml` and queries the mise CLI for tool versions. For Python projects managed by uv it reads the CycloneDX SBOM export and queries the PyPI registry. For Go modules it runs `go list -m -json all` and queries the Go module proxy. For Rust projects it runs `cargo metadata` and queries the crates.io API.

See the individual provider pages for details on each:

- [Node.js (pnpm, bun, yarn, npm, aube)](providers/node.md) — catalog support, patching, Node-specific auto-detection
- [Mise](providers/mise.md) — polyglot tool version management
- [Python (uv)](providers/uv.md) — CycloneDX SBOM-based dependency tracking
- [Go](providers/go.md) — Go module proxy integration
- [Rust (Cargo)](providers/rust.md) — crates.io integration

## Auto-detection

When you run Dependicus without specifying a provider, it uses a two-step detection strategy:

1. Runtime detection. If the current process was launched by a known package manager, Dependicus uses that provider:
    - `process.versions.bun` is set &rarr; bun
    - `process.env.npm_config_user_agent` starts with `"aube/"` &rarr; aube
    - `process.env.npm_config_user_agent` starts with `"pnpm/"` &rarr; pnpm
    - `process.env.npm_config_user_agent` starts with `"yarn/"` &rarr; yarn
    - `process.env.npm_config_user_agent` starts with `"npm/"` &rarr; npm

2. Lockfile fallback. If the runtime is ambiguous (e.g. you ran `node your-script.js` directly), Dependicus checks for lockfiles in the repo root:
    - `pnpm-lock.yaml` &rarr; pnpm
    - `bun.lock` &rarr; bun
    - `yarn.lock` &rarr; yarn
    - `package-lock.json` &rarr; npm
    - `aube-lock.yaml` &rarr; aube
    - `mise.toml` &rarr; mise
    - `uv.lock` (anywhere in the repo) &rarr; uv
    - `go.mod` (anywhere in the repo) &rarr; go
    - `Cargo.lock` (anywhere in the repo) &rarr; rust

If multiple lockfiles exist and the runtime is ambiguous, all matching providers are activated and their results are merged. Mise is always detected via `mise.toml` presence, uv is always detected via `uv.lock` presence, Go is always detected via `go.mod` presence, and Rust is always detected via `Cargo.lock` presence (there is no runtime detection for any of these).

## Explicit provider selection

You can bypass auto-detection with the `--provider` CLI flag:

```sh
dependicus update --provider pnpm
dependicus update --provider bun
dependicus update --provider yarn
dependicus update --provider npm
dependicus update --provider aube
dependicus update --provider mise
dependicus update --provider uv
dependicus update --provider go
dependicus update --provider rust
```

Or in a script:

```ts
void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://deps.example.com',
    providerNames: ['pnpm'],
}).run(process.argv);
```

You can specify multiple providers to analyze dependencies from both package managers:

```sh
dependicus update --provider pnpm --provider bun
```

## Provider capabilities

| Capability         | pnpm                            | bun                        | yarn                                   | npm                        | aube                            | mise             | uv                                | go                     | rust                                |
| ------------------ | ------------------------------- | -------------------------- | -------------------------------------- | -------------------------- | ------------------------------- | ---------------- | --------------------------------- | ---------------------- | ----------------------------------- |
| Dependency listing | `pnpm -r list --json --depth=0` | Parses `bun.lock` directly | Parses `yarn.lock` directly            | Parses `package-lock.json` | `aube -r list --json --depth=0` | `mise ls --json` | `uv export --format cyclonedx1.5` | `go list -m -json all` | `cargo metadata --format-version 1` |
| Catalog            | `pnpm-workspace.yaml`           | `package.json`             | Not supported                          | Not supported              | `pnpm-workspace.yaml`           | Not supported    | Not supported                     | Not supported          | Not supported                       |
| Patched packages   | Yes                             | No                         | Yes (`patch:` protocol in `yarn.lock`) | No                         | Yes (pnpm-compatible)           | No               | No                                | No                     | No                                  |
| Lockfile           | `pnpm-lock.yaml`                | `bun.lock`                 | `yarn.lock`                            | `package-lock.json`        | `aube-lock.yaml`                | `mise.toml`      | `uv.lock`                         | `go.sum`               | `Cargo.lock`                        |
| Publish dates      | Yes (npm registry)              | Yes (npm registry)         | Yes (npm registry)                     | Yes (npm registry)         | Yes (npm registry)              | No               | Yes (PyPI registry)               | Yes (Go module proxy)  | Yes (crates.io)                     |
| Ecosystem          | npm                             | npm                        | npm                                    | npm                        | npm                             | mise             | pypi                              | gomod                  | cargo                               |
