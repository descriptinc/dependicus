# Getting Started

## Quickstart

You only need to run a couple of commands to see whether Dependicus is useful to you. First, collect the data and generate the static site.

```sh
export GITHUB_TOKEN=<a GitHub token> # speeds up fetching of changelogs and tags

# pnpm
pnpm dlx dependicus@latest update --html

# bun
bunx dependicus@latest update --html

# yarn
yarn dlx dependicus@latest update --html

# npm
npx dependicus@latest update --html

# open ./dependicus-out/index.html
```

If you're a Linear shop, you can reuse the same data to create tickets when updates are available. The default behavior is very naive, so this example uses `--dry-run` just to give you a sense of what would happen.

```sh
export LINEAR_API_KEY=<a Linear API key>

# pnpm
pnpm dlx dependicus@latest make-linear-issues \
    --linear-team-id=<uuid of a Linear team> \
    --dry-run

# bun
bunx dependicus@latest make-linear-issues \
    --linear-team-id=<uuid of a Linear team> \
    --dry-run

# yarn
yarn dlx dependicus@latest make-linear-issues \
    --linear-team-id=<uuid of a Linear team> \
    --dry-run

# npm
npx dependicus@latest make-linear-issues \
    --linear-team-id=<uuid of a Linear team> \
    --dry-run
```

## Installation

From here on out, the docs will assume you're installing Dependicus via `package.json` rather than running it directly with your package manager's `dlx`/`npx` command. After all, dependency governance is important!

```sh
# pnpm
pnpm add dependicus

# bun
bun add dependicus

# yarn
yarn add dependicus

# npm
npm install dependicus
```

## Peer dependency note

The Linear integration (`make-linear-issues`) depends on `@linear/sdk`, which has a transitive peer dependency on `graphql`. If your project uses `strictPeerDependencies`, you may need to add `graphql` to your own dependencies. This is only required for Linear ticket creation.

## Environment variables

### `GITHUB_TOKEN`

Dependicus uses the GitHub API to attempt to find canonical releases and changelogs for each of your dependencies so you can conveniently click through to them from the static site. The GitHub API is severely rate limited without an API key, so we strongly recommend you set this variable. (GitHub CI sets it for you automatically.)

### `LINEAR_API_KEY`

This field is required in order to use the Linear ticket creation feature of Dependicus. If you don't plan to use those features, you can omit this variable.

## The Dependicus CLI

Dependicus ships with a CLI that uses bare-bones defaults. This may be enough for people who don't use Linear or GitHub Issues and don't need to add additional data with plugins.

```sh
> pnpm exec dependicus -h
Usage: dependicus [options] [command]

Dependency analysis powered by Dependicus

Options:
  -h, --help                     display help for command

Commands:
  update [options]               Collect and enrich dependency data (requires network)
  html [options]                 Generate HTML site from enriched data (offline)
  make-linear-issues [options]  Create/update Linear tickets for outdated dependencies
  make-github-issues [options]   Create/update GitHub issues for outdated dependencies
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

In other words, if you want to customize Dependicus's behavior in any way, you need to write a script to call it.

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
