# Package Managers

Dependicus supports pnpm, bun, and yarn as dependency providers. It reads the lockfile, workspace structure, and catalog configuration for whichever package manager you use.

## Auto-detection

When you run Dependicus without specifying a provider, it uses a two-step detection strategy:

1. Runtime detection. If the current process was launched by a known package manager, Dependicus uses that provider:
    - `process.versions.bun` is set &rarr; bun
    - `process.env.npm_config_user_agent` starts with `"pnpm/"` &rarr; pnpm
    - `process.env.npm_config_user_agent` starts with `"yarn/"` &rarr; yarn

2. Lockfile fallback. If the runtime is ambiguous (e.g. you ran `node your-script.js` directly), Dependicus checks for lockfiles in the repo root:
    - `pnpm-lock.yaml` &rarr; pnpm
    - `bun.lock` &rarr; bun
    - `yarn.lock` &rarr; yarn

If multiple lockfiles exist and the runtime is ambiguous, all matching providers are activated and their results are merged.

## Explicit provider selection

You can bypass auto-detection with the `--provider` CLI flag:

```sh
dependicus update --provider pnpm
dependicus update --provider bun
dependicus update --provider yarn
```

Or in a script:

```ts
void dependicusCli({
    repoRoot,
    providerNames: ['pnpm'],
}).run(process.argv);
```

You can specify multiple providers to analyze dependencies from both package managers:

```sh
dependicus update --provider pnpm --provider bun
```

This is useful if your repository contains both a `pnpm-lock.yaml` and a `bun.lock` and you want a unified view.

## Catalog support

pnpm and bun support dependency catalogs, which centralize version ranges so workspace packages can reference them instead of duplicating version specifiers. yarn does not have a native catalog feature, so `isCatalog` always returns false for the yarn provider.

| Feature             | pnpm                                   | bun                              | yarn          |
| ------------------- | -------------------------------------- | -------------------------------- | ------------- |
| Catalog location    | `pnpm-workspace.yaml` under `catalog:` | `package.json` under `"catalog"` | Not supported |
| Workspace reference | `catalog:` protocol in `package.json`  | `"catalog:"` in `package.json`   | Not supported |

Dependicus reads the catalog from the appropriate location for each provider. In the dashboard, dependencies that are in the catalog are flagged, and dependencies whose installed version doesn't satisfy the catalog range are shown as a catalog mismatch.

## Patching

pnpm supports [patched packages](https://pnpm.io/cli/patch) via the `pnpm.patchedDependencies` field in `package.json`. When a dependency is patched, Dependicus flags it in the dashboard so you know that upgrading requires re-evaluating the patch.

bun does not have a patching mechanism, so `isPatched` always returns false for the bun provider.

yarn supports patching through the `patch:` protocol. Dependicus detects `patch:` protocol entries in `yarn.lock` and flags them accordingly. Note that yarn's builtin optional patches are not flagged since they are managed by yarn itself rather than being user-applied patches.

## Provider capabilities

| Capability         | pnpm                            | bun                        | yarn                                   |
| ------------------ | ------------------------------- | -------------------------- | -------------------------------------- |
| Dependency listing | `pnpm -r list --json --depth=0` | Parses `bun.lock` directly | Parses `yarn.lock` directly            |
| Catalog            | `pnpm-workspace.yaml`           | `package.json`             | Not supported                          |
| Patched packages   | Yes                             | No                         | Yes (`patch:` protocol in `yarn.lock`) |
| Lockfile           | `pnpm-lock.yaml`                | `bun.lock`                 | `yarn.lock`                            |

## CI considerations

In CI, the runtime detection step relies on the process being launched by pnpm, bun, or yarn. If you invoke your Dependicus script with bare `node`, auto-detection falls back to lockfile presence. You can make detection explicit with `--provider`:

```sh
node your-dependicus-script.js update --provider pnpm
```

## Custom providers

The `DependencyProvider` interface is exported from `@dependicus/core` for advanced use cases. If you need to support a package manager that isn't built in, you can implement the interface and pass it directly:

```ts
import { dependicusCli } from 'dependicus';
import { MyCustomProvider } from './my-provider';

void dependicusCli({
    repoRoot,
    providers: [new MyCustomProvider(cacheService, repoRoot)],
}).run(process.argv);
```

The `providers` option takes precedence over `providerNames` and auto-detection.
