# Rust (Cargo)

The Rust provider tracks dependencies in projects managed by [Cargo](https://doc.rust-lang.org/cargo/). Dependicus discovers Rust projects by searching for `Cargo.lock` files anywhere in the repository (using `git ls-files`). Using `Cargo.lock` rather than `Cargo.toml` naturally deduplicates workspace roots, since Cargo workspaces share a single lockfile. For each project directory found, it runs `cargo metadata --format-version 1` to get the full dependency graph.

- **Publish dates come from crates.io.** The provider fetches crate metadata from `https://crates.io/api/v1/crates/` to get publish dates and latest versions.
- **Version data comes from crates.io.** The provider filters the full version list to build the upgrade path, excluding prereleases and yanked versions.
- **Dev dependency classification.** If a crate is only used as a dev dependency across all workspace members, it's classified as a dev dependency in the dashboard. Build dependencies are classified as prod.
- **Path dependencies are skipped.** Workspace-local crates are excluded from tracking since they are part of your own repo, not external dependencies.

Rust is always detected via `Cargo.lock` presence (there is no runtime detection).
