# Go

The Go provider tracks dependencies in projects managed by [Go modules](https://go.dev/ref/mod). Dependicus discovers Go projects by searching for `go.mod` files anywhere in the repository (using `git ls-files`). For each project directory found, it runs `go list -m -json all` to get the full module dependency graph.

- **Publish dates come from the Go module proxy.** The provider fetches version metadata from `https://proxy.golang.org/` to get publish dates and latest versions.
- **Version data comes from the Go module proxy.** The provider fetches the version list from the proxy and filters it to build the upgrade path, excluding prereleases.
- **Direct dependencies only.** The `go list` output distinguishes direct and indirect dependencies. Only direct dependencies (those not marked `Indirect`) are tracked.
- **Replace directives are honored.** If a dependency has a `replace` directive pointing to a different version, the replacement version is used. Replace directives pointing to local directories are skipped.

## Which services use a dependency

A Go module is one unit to `go list -m`, so every dependency belongs to the module. A backend with a hundred binaries under `cmd/` shows up as one consumer, where a pnpm workspace shows the packages that use each dependency.

Dependicus can't know which directories are services in your layout, so it records what Go does know and leaves the rest to you. Every dependency gets two facts:

- `goImportedBy`: your packages that import it, tests included.
- `goBinaries`: your `main` packages that reach it.

`goBinaries` answers "which services ship this". A `cmd/` binary is usually thin, reaching its dependencies through the `internal/` packages it imports, so Dependicus follows imports to find them. It doesn't follow test imports, because a package's tests aren't part of what its binary ships.

Use either in a grouping:

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

Return several values and the dependency appears on each of their pages.

Reading imports needs your module's sources, not just the `go.mod` files `go list -m all` downloads. Without them Dependicus says so and skips both facts.

Requires Go 1.16, or Go 1.19 for the two facts above. On an older toolchain they're skipped and the rest still works. The provider strips the `v` prefix from Go semver tags to store plain semver versions.

Go is always detected via `go.mod` presence (there is no runtime detection).
