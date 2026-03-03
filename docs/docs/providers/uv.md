# Python (uv)

[uv](https://docs.astral.sh/uv/) is a fast Python package and project manager. The uv provider tracks Python dependencies in projects managed by uv, letting you see which packages are outdated and what newer versions are available on PyPI.

Dependicus discovers Python projects by searching for `uv.lock` files anywhere in the repository (using `git ls-files`). This means a monorepo can contain multiple independent Python projects and they will all be included. For each project directory found, Dependicus runs `uv export --format cyclonedx1.5` to get a structured [CycloneDX](https://cyclonedx.org/specification/overview/) SBOM. This approach handles both standalone projects and uv workspaces uniformly, without parsing `pyproject.toml` or `uv.lock` directly.

- **Publish dates come from PyPI.** The provider fetches package metadata from `https://pypi.org/pypi/<name>/json` to get publish dates and latest versions.
- **Version data comes from the PyPI registry.** The provider filters the full release history to build the upgrade path, excluding prereleases and yanked releases.
- **Direct dependencies only.** The CycloneDX SBOM distinguishes direct and transitive dependencies. Only direct dependencies of each workspace member are tracked.

Requires uv >= 0.9.11 (when CycloneDX export was added). The provider passes `--frozen` to read from the existing lockfile without re-resolving, and `--no-dev` to exclude development dependencies.

uv is always detected via `uv.lock` presence (there is no runtime detection).
