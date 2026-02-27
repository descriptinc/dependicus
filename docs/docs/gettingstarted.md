# Getting Started

From here on out, the docs will assume you’re installing Dependicus via `package.json` rather than running with `pnpm dlx`, `bunx`, or `yarn dlx`. After all, dependency governance is important!

## Installation

```sh
# pnpm
pnpm add dependicus

# bun
bun add dependicus

# yarn
yarn add dependicus
```

## Environment variables

### `GITHUB_TOKEN`

Dependicus uses the GitHub API to attempt to find canonical releases and changelogs for each of your dependencies so you can conveniently click through to them from the static site. The GitHub API is severely rate limted without an API key, so we strongly recommend you set this variable.

### `LINEAR_API_KEY`

This field is required in order to use the Linear ticket creation feature of Dependicus. If you don’t plan to use those features, you can omit this variable.

## The Dependicus CLI

Dependicus ships with a CLI that uses bare-bones defaults. This may be enough for people who don’t use Linear and don’t need to add additional data with plugins.

```sh
> pnpm exec dependicus -h
Usage: dependicus [options] [command]

Dependency analysis powered by Dependicus

Options:
  -h, --help                     display help for command

Commands:
  update [options]               Collect and enrich dependency data (requires network)
  html [options]                 Generate HTML site from enriched data (offline)
  make-linear-tickets [options]  Create/update Linear tickets for outdated dependencies
  help [command]                 display help for command
```

The `update` command accepts a `--provider` flag to explicitly select the package manager:

```sh
pnpm exec dependicus update --provider pnpm
bun run dependicus update --provider bun
```

When `--provider` is omitted, Dependicus [auto-detects](./package-managers.md) the active package manager from the runtime environment, falling back to lockfile presence.

## Customizing Dependicus by wrapping the `dependicusCli()` function

Dependicus does not offer a config file. The JavaScript ecosystem has many build systems, multiple languages, and copious linters with different default rule sets, which creates many edge cases for JS-based config files. Given this variety, we chose to expose Dependicus's configuration as a function call so you can use your normal project conventions with it.

In other words, if you want to customize Dependicus’s behavior in any way, you need to write a script to call it.

```ts
// dependicus.js
import { dependicusCli } from 'dependicus';

// Point this to your repo root. This example assumes dependicus.js is
// at your repo root.
const repoRoot = resolve(__dirname);

void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://mycompany.internal/dependicus',
}).run(process.argv);
```

Once you have your script, invoke it with `node ./dependicus.js`.
