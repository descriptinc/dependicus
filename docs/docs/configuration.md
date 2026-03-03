# Configuration

## Input

### `repoRoot`

Root of your workspace. Defaults to the working directory.

### `providerNames` (optional): `string[]`

Explicitly select which dependency providers to use. Supported values: `'pnpm'`, `'bun'`, `'yarn'`, `'npm'`, `'mise'`, `'uv'`, `'go'`, `'rust'`. When omitted, Dependicus [auto-detects](./package-managers.md) the active providers.

### `providers` (optional): `DependencyProvider[]`

For advanced use cases, pass fully-constructed provider instances. This takes precedence over `providerNames` and auto-detection. See [Package Managers](./package-managers.md#custom-providers) for details.

## Output

### `siteName`

Name as it appears in the header and `<title>` tag of the HTML output. Defaults to `Dependicus for ${rootDir dirname}`.

### `outputDir`

Where HTML and JSON output will be created. Defaults to `${repoRoot}/dependicus-out`.

### `dependicusBaseUrl`

Base URL of where Dependicus will be deployed. Used for linking from Linear tickets and GitHub Issues.

Can also be passed via the CLI with `--dependicus-base-url <url>`. The CLI flag takes precedence over the programmatic config value.

### `cacheDir`

Dependicus aggressively caches data in individual JSON files. This parameter controls where they go. The default value is `${repoRoot}/.dependicus-cache`.

## Linear

Dependicus assumes you want fine-grained control over how tickets are created. There is no default behavior because we aren’t confident enough to predict what you want.

### `linear.getLinearIssueSpec` (optional): `(context: VersionContext, store: FactStore) => LinearIssueSpec | undefined`

For a given dependency version, return a `LinearIssueSpec` describing what ticket to create, or `undefined` to skip. See [Linear tickets](./linearissues.md) for details on the `LinearIssueSpec` fields.

This field is optional because [plugins](./plugins.md) can provide the same functionality. Depending on how complex your setup is, you might choose to write a plugin instead of providing a function for this parameter.

If you do not write a plugin or pass a `getLinearIssueSpec()` function, then Dependicus cannot create Linear tickets for you.

### `linear.cooldownDays` (optional, defaults to `0`)

Wait at least this many days after a release before creating or updating tickets to include it.

### `linear.allowNewIssues` (optional, defaults to `true`)

You can set this to `false` to disable ticket creation, for example when running CI on pull requests.

### `linear.skipStateNames` (optional): `string[]`

Skip updating issues whose Linear workflow state name matches any entry (case-insensitive). For example, if your Linear workspace has custom states like "PR" and "Verify" for issues that are actively being worked on, you can prevent Dependicus from overwriting them:

```ts
linear: {
    skipStateNames: ['pr', 'verify'],
}
```

When omitted (the default), Dependicus updates all non-closed issues regardless of state.

## GitHub Issues

Dependicus can also create and manage GitHub Issues for outdated dependencies. Like Linear, there is no default behavior — you must provide a `getGitHubIssueSpec()` function or a plugin.

### `github.getGitHubIssueSpec` (optional): `(context: VersionContext, store: FactStore) => GitHubIssueSpec | undefined`

For a given dependency version, return a `GitHubIssueSpec` describing what issue to create, or `undefined` to skip. See [GitHub Issues](./githubissues.md) for details.

### `github.cooldownDays` (optional, defaults to `0`)

Wait at least this many days after a release before creating or updating issues to include it.

### `github.allowNewIssues` (optional, defaults to `true`)

You can set this to `false` to disable issue creation, for example when running CI on pull requests.

## Plugins

To use plugins, pass an array of plugins as the value of the `plugins` parameter.

To write a plugin, read [Writing Plugins](./plugins.md)!
