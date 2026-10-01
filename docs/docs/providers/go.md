# Go

The Go provider tracks dependencies in projects managed by [Go modules](https://go.dev/ref/mod). Dependicus discovers Go projects by searching for `go.mod` files anywhere in the repository (using `git ls-files`). For each project directory found, it runs `go list -m -json all` to get the full module dependency graph.

- **Publish dates come from the Go module proxy.** The provider fetches version metadata from `https://proxy.golang.org/` to get publish dates and latest versions.
- **Version data comes from the Go module proxy.** The provider fetches the version list from the proxy and filters it to build the upgrade path, excluding prereleases.
- **Direct dependencies only.** The `go list` output distinguishes direct and indirect dependencies. Only direct dependencies (those not marked `Indirect`) are tracked.
- **Replace directives are honored.** If a dependency has a `replace` directive pointing to a different version, the replacement version is used. Replace directives pointing to local directories are skipped.

## Knowing which packages use a dependency

`go list -m` sees a module as one unit, so every dependency is attributed to the module: a backend with a hundred binaries under `cmd/` reads as a single consumer, where a pnpm workspace attributes each dependency to the packages that name it.

Dependicus can't fix that by guessing what a service is in your layout, so it publishes what Go does know and lets you decide. For each dependency it records two facts:

- `goImportedBy`: the import paths of your own packages that import it, including from tests.
- `goBinaries`: the import paths of the `main` packages that reach it, following imports through your own packages. Test imports aren't followed, since a package's tests aren't part of what its binary ships. A thin `cmd/` binary usually reaches its dependencies through the `internal/` packages it imports rather than importing them itself, so this is the fact that answers "which services ship this".

A grouping can map either to owners:

```ts
const teams: DependicusPlugin = {
    name: 'go-teams',
    groupings: [
        {
            key: 'team',
            label: 'Teams',
            ecosystems: ['gomod'],
            getValue: (name, store) => {
                const binaries = store.getDependencyFact<string[]>(name, 'goBinaries') ?? [];
                return [...new Set(binaries.map(teamForBinary))];
            },
        },
    ],
};
```

Returning several values files the dependency under each of them, so a module reached from more than one of those groups appears on each of their pages.

Reading imports needs the module's sources, not only the `go.mod` files that `go list -m all` fetches. When they aren't present Dependicus says so and skips these two facts; everything else is unaffected.

Requires Go >= 1.16 (when `go list -m -json all` became stable), and Go >= 1.19 for the import-graph facts above, which ask `go list` for named fields. On an older toolchain the facts are skipped and everything else still works. The provider strips the `v` prefix from Go semver tags to store plain semver versions.

Go is always detected via `go.mod` presence (there is no runtime detection).
