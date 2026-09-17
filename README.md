# Dependicus

Dependicus is a dependency governance tool for monorepos. It collects data from your lockfiles, tool configs, package registries, and GitHub, then produces two outputs: an interactive dashboard, and tickets for either Linear or GitHub.

If you maintain a monorepo with multiple teams, dozens of workspace packages, and hundreds of dependencies, Dependicus gives you the visibility that automated-PR tools don't: which dependencies are behind, by how much, who owns them, and where teams have drifted to different versions of the same package. The dashboard is a single view of your entire dependency landscape. The tickets are driven by compliance policies you define.

You can define SLOs for how quickly different kinds of updates need to happen, route tickets to the right team, group related dependencies, and distinguish between advisory notifications and hard deadlines. The tickets are rich enough that [coding agents can pick them up directly](https://descriptinc.github.io/dependicus/coding-agents/).

Dependicus supports [pnpm](https://pnpm.io/), [bun](https://bun.sh/), [yarn](https://yarnpkg.com/), [npm](https://www.npmjs.com/), [aube](https://aube.en.dev/), [mise](https://mise.jdx.dev/), [uv](https://docs.astral.sh/uv/), [Go](https://go.dev/), and [Rust](https://www.rust-lang.org/) as dependency providers, with auto-detection of the active one. Node.js package managers, mise tool versions, Python dependencies managed by uv, Go modules, and Rust crates are all tracked in a single unified view. It has a plugin system for customization. It’s a young open source project, but we use it daily at [Descript](https://descript.com).

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

## Installing from git

To try a fix that isn't released yet, install from the repo instead of the registry. Dependicus builds itself from the clone, so you still get a working `dependicus` command.

```sh
npm install github:descriptinc/dependicus
```

Package managers don't run a git dependency's build script until you tell them the package is trusted, so pnpm and yarn need a line of config first.

In `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
    - dependicus
```

In `.yarnrc.yml`:

```yaml
approvedGitRepositories:
    - 'https://github.com/descriptinc/dependicus.git'
```

npm needs no configuration. Bun and aube can't do this at all: bun doesn't install a git dependency's devDependencies, so the build has nothing to run with, and aube doesn't accept git specifiers. Install from the registry with those two.

## Peer dependency note

The Linear integration (`make-linear-issues`) depends on `@linear/sdk`, which has a transitive peer dependency on `graphql`. If your project uses `strictPeerDependencies`, you may need to add `graphql` to your own dependencies. This is only required for Linear ticket creation.

[Full documentation](https://descriptinc.github.io/dependicus/) | [Demo deployment targeting this repo](https://descriptinc.github.io/dependicus/dependencies/)
