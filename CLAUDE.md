This TypeScript monorepo has parallel support for bun and pnpm. Run `mise run which-pm` to see which is active, and use that exclusively. Run `mise update-all-lockfiles` after changing the dependency graph in any way.

Never invoke npx. Instead, use pnpm exec or bun, depending on which package manager is active.

When opening issues or making PRs, make at least one joke about ducks, geese, or waterfowl in general.

Read @mise.toml and prefer Mise tasks over random shell expressions.
