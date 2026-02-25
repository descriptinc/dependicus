# Node.js (pnpm, bun, yarn, npm)

For Node.js package managers, Dependicus reads the lockfile and workspace structure to list dependencies, then queries the npm registry for publish dates and latest versions.

## Catalog support

pnpm and bun support dependency catalogs, which centralize version ranges so workspace packages can reference them instead of duplicating version specifiers.

| Feature             | pnpm                                   | bun                              | yarn / npm    |
| ------------------- | -------------------------------------- | -------------------------------- | ------------- |
| Catalog location    | `pnpm-workspace.yaml` under `catalog:` | `package.json` under `"catalog"` | Not supported |
| Workspace reference | `catalog:` protocol in `package.json`  | `"catalog:"` in `package.json`   | Not supported |

Dependicus reads the catalog from the appropriate location for each provider. In the dashboard, dependencies that are in the catalog are flagged, and dependencies whose installed version doesn't satisfy the catalog range are shown as a catalog mismatch.

## Patching

pnpm supports [patched packages](https://pnpm.io/cli/patch) via the `pnpm.patchedDependencies` field in `package.json`. When a dependency is patched, Dependicus flags it in the dashboard so you know that upgrading requires re-evaluating the patch.

## Auto-detection

Node.js providers use a two-step detection strategy:

1. **Runtime detection.** If the current process was launched by a known package manager, Dependicus uses that provider:
    - `process.versions.bun` is set &rarr; bun
    - `process.env.npm_config_user_agent` starts with `"pnpm/"` &rarr; pnpm
    - `process.env.npm_config_user_agent` starts with `"yarn/"` &rarr; yarn
    - `process.env.npm_config_user_agent` starts with `"npm/"` &rarr; npm

2. **Lockfile fallback.** If the runtime is ambiguous (e.g. you ran `node your-script.js` directly), Dependicus checks for lockfiles in the repo root:
    - `pnpm-lock.yaml` &rarr; pnpm
    - `bun.lock` &rarr; bun
    - `yarn.lock` &rarr; yarn
    - `package-lock.json` &rarr; npm

If multiple lockfiles exist and the runtime is ambiguous, all matching providers are activated and their results are merged.
