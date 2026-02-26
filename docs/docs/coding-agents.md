# Using coding agents to update dependencies

Dependabot and Renovate solve a real problem, but they solve it by opening pull requests mechanically. They bump a version, regenerate the lockfile, and hand you a PR. When CI passes, great. When it doesn't, you're debugging someone else's automated branch.

Coding agents like [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) and [Cursor](https://www.cursor.com/) change the economics here. They can do the same version bump, but they can also run the type checker, fix what breaks, read the changelog, migrate deprecated APIs, and run the test suite before opening a PR that's already green.

## Tickets as the unit of work

Dependabot and Renovate maintain their own PR queue on their own schedule, separate from whatever project management tool your team actually uses. Dependicus takes a different approach: it creates tickets in Linear with context about the update, including how far behind you are, which workspace packages are affected, and links to changelogs and release notes.

Those tickets flow through the same system as the rest of your work. They show up in sprint planning, they're tracked against SLOs, and they're routed to the team that owns the affected packages.

The ticket model also gives humans a natural place to add context before the work starts. If you know that upgrading `react-query` requires migrating off a deprecated hook, you can leave that as a comment on the ticket. When the coding agent picks it up, it reads the comments and accounts for the gotcha instead of stumbling into it blind. Dependabot and Renovate don't have this feedback channel.

You can assign a ticket to a coding agent the same way you'd assign it to a person. The agent reads the ticket, does the update, and opens a PR, with no separate queue to manage.

## Monorepos benefit the most

In a monorepo, a single dependency update can touch many workspace packages. A bot opens one PR and leaves you to sort out whether it broke anything across the repo. A coding agent can work through each affected package, running lint, type checks, and tests locally until everything is clean.

This matters more as the monorepo grows. When you have 15 workspace packages across 4 teams and a shared dependency needs a major version bump, the coding agent handles the migration work rather than handing you a red CI run to investigate.
