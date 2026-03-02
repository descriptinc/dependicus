# Dependicus

Dependicus is a dependency governance tool for monorepos. It collects data from your lockfiles, tool configs, the npm registry, and GitHub, then produces two outputs: an interactive dashboard, and tickets for either Linear or GitHub.

If you maintain a monorepo with multiple teams, dozens of workspace packages, and hundreds of dependencies, Dependicus gives you the visibility that automated-PR tools don't: which dependencies are behind, by how much, who owns them, and where teams have drifted to different versions of the same package. The dashboard is a single view of your entire dependency landscape. The tickets are driven by compliance policies you define.

You can define SLOs for how quickly different kinds of updates need to happen, route tickets to the right team, group related dependencies, and distinguish between advisory notifications and hard deadlines. The tickets are rich enough that [coding agents can pick them up directly](https://descriptinc.github.io/dependicus/coding-agents/).

Dependicus supports [pnpm](https://pnpm.io/), [bun](https://bun.sh/), [yarn](https://yarnpkg.com/), [npm](https://www.npmjs.com/), and [mise](https://mise.jdx.dev/) as dependency providers, with auto-detection of the active one. It has a plugin system for customization. It’s a young open source project, but we use it daily at [Descript](https://descript.com).

[Full documentation](https://descriptinc.github.io/dependicus/) | [Demo deployment targeting this repo](https://descriptinc.github.io/dependicus/dependencies/)

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

If you're a Linear shop, you can reuse the same data to create issues when updates are available. The default behavior is very naive, so this example uses `--dry-run` just to give you a sense of what would happen.

```sh
export LINEAR_API_KEY=<a Linear API key>
pnpm dlx dependicus@latest make-linear-issues \
    --linear-team-id=<uuid of a Linear team> \
    --dry-run
```

Or use GitHub issues:

```sh
pnpm dlx dependicus@latest make-github-issues \
    --github-owner=<owner> \
    --github-repo=<repo> \
    --dry-run
```

Dependicus offers extensive customization through its JavaScript API.

[Full documentation](https://descriptinc.github.io/dependicus/) | [Demo deployment targeting this repo](https://descriptinc.github.io/dependicus/dependencies/)
