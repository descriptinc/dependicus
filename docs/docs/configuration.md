# Configuration

## Input

### `repoRoot`

Root of your workspace. Defaults to the working directory.

## Output

### `siteName`

Name as it appears in the header and `<title>` tag of the HTML output. Defaults to `Dependicus for ${rootDir dirname}`.

### `outputDir`

Where HTML and JSON output will be created. Defaults to `${repoRoot}/dependicus-out`.

### `dependicusBaseUrl`

Base URL of where Dependicus will be deployed. Used for linking from Linear tickets.

### `cacheDir`

Dependicus aggressively caches data in individual JSON files. This parameter controls where they go. The default value is `${repoRoot}/.dependicus-cache`.

## Linear

Dependicus assumes you want fine-grained control over how tickets are created. There is no default behavior because we aren’t confident enough to predict what you want.

### `linear.getLinearIssueSpec` (optional): `(context: VersionContext, store: FactStore) => LinearIssueSpec | undefined`

For a given package version, return a `LinearIssueSpec` describing what ticket to create, or `undefined` to skip. See [Linear tickets](./lineartickets.md) for details on the `LinearIssueSpec` fields.

This field is optional because [plugins](./plugins.md) can provide the same functionality. Depending on how complex your setup is, you might choose to write a plugin instead of providing a function for this parameter.

If you do not write a plugin or pass a `getLinearIssueSpec()` function, then Dependicus cannot create Linear tickets for you.

### `linear.cooldownDays` (optional, defaults to `0`)

Wait at least this many days after a release before creating or updating tickets to include it.

### `linear.allowNewTickets` (optional, defaults to `true`)

You can set this to `false` to disable ticket creation, for example when running CI on pull requests.

## Plugins

To use plugins, pass an array of plugins as the value of the `plugins` parameter.

To write a plugin, read [Writing Plugins](./plugins.md)!
