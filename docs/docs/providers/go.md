# Go

The Go provider tracks dependencies in projects managed by [Go modules](https://go.dev/ref/mod). Dependicus discovers Go projects by searching for `go.mod` files anywhere in the repository (using `git ls-files`). For each project directory found, it runs `go list -m -json all` to get the full module dependency graph.

- **Publish dates come from the Go module proxy.** The provider fetches version metadata from `https://proxy.golang.org/` to get publish dates and latest versions.
- **Version data comes from the Go module proxy.** The provider fetches the version list from the proxy and filters it to build the upgrade path, excluding prereleases.
- **Direct dependencies only.** The `go list` output distinguishes direct and indirect dependencies. Only direct dependencies (those not marked `Indirect`) are tracked.
- **Replace directives are honored.** If a dependency has a `replace` directive pointing to a different version, the replacement version is used. Replace directives pointing to local directories are skipped.

## Attributing dependencies to services

By default every dependency in a module is attributed to the module itself, so a backend with a hundred binaries under `cmd/` reads as one consumer. Pass `consumerOf` to split that up:

```ts
import { GoProvider, PnpmProvider } from 'dependicus';

export default dependicusCli({
    dependicusBaseUrl: 'https://example.com/dependicus/',
    providers: ({ cacheService, repoRoot }) => [
        new PnpmProvider(cacheService, repoRoot),
        new GoProvider(cacheService, repoRoot, {
            consumerOf: (dir) => (dir.split('/')[0] === 'cmd' ? dir.split('/')[1] : undefined),
        }),
    ],
});
```

`consumerOf` is given each package directory relative to the module root and returns the name to attribute it to, or undefined to leave it on the module. Dependicus then runs `go list -json=ImportPath,Dir,Imports,TestImports,XTestImports ./...`, resolves each import to the module providing it by longest prefix, and groups the result by consumer. That gives the same per-package "Used By" the Node providers produce, so a grouping can map Go dependencies to owning teams.

Imports that only appear in tests become dev dependencies of that consumer. A module nothing imports, such as one kept alive by a `tools.go` behind a build tag, stays attributed to the module so it isn't dropped.

Reading imports needs the module's sources in `GOMODCACHE`, not only the `go.mod` files that `go list -m all` fetches, which is why this is opt-in. If the package list can't be read, Dependicus logs it and falls back to attributing everything to the module.

Requires Go >= 1.16 (when `go list -m -json all` became stable). The provider strips the `v` prefix from Go semver tags to store plain semver versions.

Go is always detected via `go.mod` presence (there is no runtime detection).
