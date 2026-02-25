# Go

The Go provider tracks dependencies in projects managed by [Go modules](https://go.dev/ref/mod). Dependicus discovers Go projects by searching for `go.mod` files anywhere in the repository (using `git ls-files`). For each project directory found, it runs `go list -m -json all` to get the full module dependency graph.

- **Publish dates come from the Go module proxy.** The provider fetches version metadata from `https://proxy.golang.org/` to get publish dates and latest versions.
- **Version data comes from the Go module proxy.** The provider fetches the version list from the proxy and filters it to build the upgrade path, excluding prereleases.
- **Direct dependencies only.** The `go list` output distinguishes direct and indirect dependencies. Only direct dependencies (those not marked `Indirect`) are tracked.
- **Replace directives are honored.** If a dependency has a `replace` directive pointing to a different version, the replacement version is used. Replace directives pointing to local directories are skipped.

Requires Go >= 1.16 (when `go list -m -json all` became stable). The provider strips the `v` prefix from Go semver tags to store plain semver versions.

Go is always detected via `go.mod` presence (there is no runtime detection).
