# Contributing to Dependicus

## Setup

```sh
mise install
hk install
```

The repo [supports all major Node.js package managers](https://github.com/descriptinc/dependicus/blob/main/EVERY_NODE_PACKAGE_MANAGER_WORKS.md) (pnpm, bun, yarn, and npm). Use mise tasks to switch between them:

```sh
mise run switch:pnpm   # delete node_modules and reinstall with pnpm
mise run switch:bun    # delete node_modules and reinstall with bun
mise run switch:yarn   # delete node_modules and reinstall with yarn
mise run switch:npm    # delete node_modules and reinstall with npm
mise run which-pm      # show which PM last installed node_modules
```

Build, test, and typecheck tasks are namespaced by package manager:

```sh
mise run pnpm:build    # or bun:build, yarn:build, npm:build
mise run pnpm:test     # or bun:test, yarn:test, npm:test
mise run pnpm:typecheck # or bun:typecheck, yarn:typecheck, npm:typecheck
```

## Discussion

We accept contributions exclusively in the form of discussions on GitHub. Some topics we are curious about include:

- Are there bugs? We don’t think so, but are there?
- What work management solution do you use? We are open to integrations with JIRA, Asana, etc.
- Does anyone else assign teams to own dependencies and route tickets accordingly, like we do at Descript? Should we include a way to do that?
- Is the HTML output ugly? If so, what would make it better?
- Is there a valuable data source we should add to enrich dependency metadata?

If you have something to say about these topics, head on over to the [Discussions](https://github.com/descriptinc/dependicus/discussions) page and let us know.
