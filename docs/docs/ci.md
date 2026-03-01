# Continuous Integration

To run Dependicus in CI, run `dependicus update`, cache `.dependicus-cache` between runs, and then generate the static site, Linear tickets, and/or GitHub Issues.

The update step is the only one that requires network access, and it's the slowest because it calls external APIs. Caching `.dependicus-cache` between runs avoids redundant requests. The HTML and ticket steps can run in parallel since they both just read `dependencies.json`.

## Environment variables

| Variable         | Required by                    | Description                                                           |
| ---------------- | ------------------------------ | --------------------------------------------------------------------- |
| `GITHUB_TOKEN`   | `update`, `make-github-issues` | Strongly recommended for `update`. Required for `make-github-issues`. |
| `LINEAR_API_KEY` | `make-linear-issues`           | Required. Must have write access to the teams you route tickets to.   |

## GitHub Actions

```yaml
name: dependicus

on:
    push:
        branches: [main]

jobs:
    dependicus-update:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4

            # Set up Node and your package manager however you normally do

            - name: Cache Dependicus
              uses: actions/cache@v4
              with:
                  path: .dependicus-cache
                  # No need to bust on lockfile changes—dependicus
                  # can still reuse most of the cached data.
                  key: dependicus
                  restore-keys: dependicus

            - name: Collect dependency data
              run: node your-dependicus-script.js update
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

            - name: Upload dependency data
              uses: actions/upload-artifact@v4
              with:
                  name: dependicus-data
                  path: dependicus-out/dependencies.json

    dependicus-html:
        runs-on: ubuntu-latest
        needs: dependicus-update
        steps:
            - uses: actions/checkout@v4

            # Set up Node and your package manager however you normally do

            - uses: actions/download-artifact@v4
              with:
                  name: dependicus-data
                  path: dependicus-out/

            - name: Generate HTML site
              run: node your-dependicus-script.js html

            - name: Upload site
              uses: actions/upload-artifact@v4
              with:
                  name: dependicus-site
                  path: dependicus-out/

    dependicus-linear-tickets:
        runs-on: ubuntu-latest
        needs: dependicus-update
        steps:
            - uses: actions/checkout@v4

            # Set up Node and your package manager however you normally do

            - uses: actions/download-artifact@v4
              with:
                  name: dependicus-data
                  path: dependicus-out/

            - name: Create/update Linear tickets
              run: node your-dependicus-script.js make-linear-issues
              env:
                  LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}

    dependicus-github-issues:
        runs-on: ubuntu-latest
        needs: dependicus-update
        steps:
            - uses: actions/checkout@v4

            # Set up Node and your package manager however you normally do

            - uses: actions/download-artifact@v4
              with:
                  name: dependicus-data
                  path: dependicus-out/

            - name: Create/update GitHub issues
              run: node your-dependicus-script.js make-github-issues
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Replace `your-dependicus-script.js` with whatever script calls `dependicusCli()`. Adjust `dependicus-out` and `.dependicus-cache` if you’ve overridden `outputDir` or `cacheDir`.

### Provider detection in CI

When your script is launched by a package manager, Dependicus auto-detects the provider from the runtime. If you invoke your script with bare `node`, auto-detection falls back to lockfile presence. To be explicit, pass `--provider`:

```sh
node your-dependicus-script.js update --provider pnpm
```

### Other package managers

The workflow above uses pnpm as an example, but the structure is the same for any package manager. Just swap in the appropriate run command:

```sh
# bun
bun run your-dependicus-script.js update

# yarn
yarn run your-dependicus-script.js update

# npm
npx your-dependicus-script.js update
```

The rest of the jobs (HTML generation, ticket creation) are identical regardless of package manager since they only read `dependencies.json`.

Note that yarn does not natively support the `catalog:` protocol, so if your Dependicus script references catalog data under yarn, you may need to resolve it beforehand with a helper script.

On pull requests, you probably want to skip the Linear tickets and GitHub Issues jobs, or set `allowNewIssues: false` / `allowNewIssues: false` in your config.

For deploying the static site, you’ll have to decide what works best for your project. GitHub Pages is an easy option and can even be a good solution for companies, due to the ability to gate it behind a GitHub login and org authorization.
