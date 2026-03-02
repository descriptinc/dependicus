# Package Managers

Dependicus supports pnpm, bun, yarn, npm, and mise as dependency providers. For Node.js package managers it reads the lockfile and workspace structure. For mise it reads `mise.toml` and queries the mise CLI for tool versions.

## Auto-detection

When you run Dependicus without specifying a provider, it uses a two-step detection strategy:

1. Runtime detection. If the current process was launched by a known package manager, Dependicus uses that provider:
    - `process.versions.bun` is set &rarr; bun
    - `process.env.npm_config_user_agent` starts with `"pnpm/"` &rarr; pnpm
    - `process.env.npm_config_user_agent` starts with `"yarn/"` &rarr; yarn
    - `process.env.npm_config_user_agent` starts with `"npm/"` &rarr; npm

2. Lockfile fallback. If the runtime is ambiguous (e.g. you ran `node your-script.js` directly), Dependicus checks for lockfiles in the repo root:
    - `pnpm-lock.yaml` &rarr; pnpm
    - `bun.lock` &rarr; bun
    - `yarn.lock` &rarr; yarn
    - `package-lock.json` &rarr; npm
    - `mise.toml` &rarr; mise

If multiple lockfiles exist and the runtime is ambiguous, all matching providers are activated and their results are merged. Mise is always detected via lockfile presence (there is no runtime detection for mise).

## Explicit provider selection

You can bypass auto-detection with the `--provider` CLI flag:

```sh
dependicus update --provider pnpm
dependicus update --provider bun
dependicus update --provider yarn
dependicus update --provider npm
dependicus update --provider mise
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

This is useful if your repository contains both a `pnpm-lock.yaml` and a `bun.lock` and you want a unified view.

## Catalog support

pnpm and bun support dependency catalogs, which centralize version ranges so workspace packages can reference them instead of duplicating version specifiers. yarn, npm, and mise do not have a native catalog feature, so `isCatalog` always returns false for those providers.

| Feature             | pnpm                                   | bun                              | yarn / npm    |
| ------------------- | -------------------------------------- | -------------------------------- | ------------- |
| Catalog location    | `pnpm-workspace.yaml` under `catalog:` | `package.json` under `"catalog"` | Not supported |
| Workspace reference | `catalog:` protocol in `package.json`  | `"catalog:"` in `package.json`   | Not supported |

Dependicus reads the catalog from the appropriate location for each provider. In the dashboard, dependencies that are in the catalog are flagged, and dependencies whose installed version doesn't satisfy the catalog range are shown as a catalog mismatch.

## Patching

pnpm supports [patched packages](https://pnpm.io/cli/patch) via the `pnpm.patchedDependencies` field in `package.json`. When a dependency is patched, Dependicus flags it in the dashboard so you know that upgrading requires re-evaluating the patch.

bun and npm do not have a patching mechanism, so `isPatched` always returns false for those providers.

yarn supports patching through the `patch:` protocol. Dependicus detects `patch:` protocol entries in `yarn.lock` and flags them accordingly. Note that yarn's builtin optional patches are not flagged since they are managed by yarn itself rather than being user-applied patches.

## Mise

[Mise](https://mise.jdx.dev/) is a polyglot tool version manager. The mise provider tracks the tools declared in `mise.toml` (e.g. node, python, bun) as dependencies, letting you see which tools are outdated and what newer versions are available.

The mise provider differs from the Node.js package manager providers in a few ways:

- **No publish dates.** Mise tools don't carry publish date metadata, so age-based columns show as empty and date-based compliance policies return not-applicable.
- **No catalogs or patching.** These are npm-specific concepts.
- **Version data comes from mise-versions.** The provider fetches the version list from `https://mise-versions.jdx.dev/<tool>` to build the upgrade path between your current version and the latest.
- **Latest version comes from `mise outdated`.** The provider runs `mise outdated --json --bump` to determine the latest version of each tool.

The mise provider only includes tools whose configuration lives under the repo root (tools from global `~/.config/mise/config.toml` are excluded).

## Provider capabilities

| Capability         | pnpm                            | bun                        | yarn                                   | npm                        | mise             |
| ------------------ | ------------------------------- | -------------------------- | -------------------------------------- | -------------------------- | ---------------- |
| Dependency listing | `pnpm -r list --json --depth=0` | Parses `bun.lock` directly | Parses `yarn.lock` directly            | Parses `package-lock.json` | `mise ls --json` |
| Catalog            | `pnpm-workspace.yaml`           | `package.json`             | Not supported                          | Not supported              | Not supported    |
| Patched packages   | Yes                             | No                         | Yes (`patch:` protocol in `yarn.lock`) | No                         | No               |
| Lockfile           | `pnpm-lock.yaml`                | `bun.lock`                 | `yarn.lock`                            | `package-lock.json`        | `mise.toml`      |
| Publish dates      | Yes (npm registry)              | Yes (npm registry)         | Yes (npm registry)                     | Yes (npm registry)         | No               |
| Ecosystem          | npm                             | npm                        | npm                                    | npm                        | mise             |

## CI considerations

In CI, the runtime detection step relies on the process being launched by a package manager. Mise has no runtime detection and is always detected via `mise.toml` presence. If you invoke your Dependicus script with bare `node`, auto-detection falls back to lockfile presence. You can make detection explicit with `--provider`:

```sh
node your-dependicus-script.js update --provider pnpm
```
