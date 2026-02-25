# Dependicus vs Renovate

Renovate is an excellent tool. If you're using it, you should probably keep using it. But if you've ever found yourself wishing you had a better view of your dependency landscape before acting on all those pull requests, Dependicus might be a useful complement to your workflow, or even an alternative approach to the problem.

This article explains what each tool does, where they overlap, and where they diverge.

## What Renovate does

[Renovate](https://docs.renovatebot.com/) is a cross-platform dependency update bot maintained by Mend.io. It scans your repositories for outdated dependencies and opens pull requests to update them. It supports over 90 package managers, runs on GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, and Forgejo, and offers a remarkable depth of configuration.

Renovate's core workflow is: scan your repo, detect outdated dependencies, open PRs. It does this well and has invested heavily in making the experience manageable at scale. Features like auto-merge, scheduling, noise reduction, and community-maintained grouping presets all exist to address the fundamental challenge of automated PRs: there are a lot of them.

Renovate also provides a [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/), a GitHub issue (or equivalent on other platforms) that acts as a central control panel for the update process. More on this below.

Renovate also provides Merge Confidence badges that show adoption rate, age, and test pass rate for new versions, giving you some signal about whether an update is safe to take.

## What Dependicus does

Dependicus takes a different approach. Rather than opening pull requests, it collects data about your dependencies from multiple sources (your lockfile, the npm registry, and GitHub), then produces two outputs: an interactive dashboard and (optionally) tickets in Linear or GitHub Issues.

The dashboard gives you a single view of every direct dependency in your monorepo: what version you're on, what's latest, how old your version is, who in your codebase uses it, whether it's in your catalog, and whether any of its transitive dependencies are deprecated. Dependicus enriches each package with changelog links, GitHub release URLs, and size comparisons between your version and the latest.

On the ticket side, Dependicus creates or updates Linear tickets or GitHub Issues based on policies you define. You can set SLOs (e.g., patch updates within 30 days, minor updates within 90), route tickets to the right team, group related updates, and distinguish between advisory notifications and hard deadlines.

## Different tools for different problems

Renovate and Dependicus are best understood as solving adjacent problems.

Renovate answers: "Can we automate the mechanics of updating dependencies?" It does the work of creating branches, updating lockfiles, and opening PRs. For teams that want a high degree of automation, especially those with good CI coverage and comfort with auto-merge, Renovate is outstanding.

Dependicus answers: "Can we make informed decisions about our dependencies at an organizational scale?" It gives you the context to decide what to update, when, and who should own it. For teams that have formal release processes, team-based ownership models, or compliance requirements, Dependicus provides the governance layer.

These are complementary. You could use Renovate to handle the mechanics and Dependicus to provide visibility and policy enforcement. You could also use Dependicus on its own if you prefer to update dependencies manually with full context rather than processing a stream of automated PRs.

## Two different dashboards

Both tools offer something called a "dashboard," but they mean very different things by the term.

Renovate's [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) is a GitHub issue (or GitLab/Gitea equivalent) that Renovate creates and continuously edits. It lists pending updates grouped by category: awaiting schedule, rate-limited, open PRs, updates requiring approval. You trigger or approve PRs by checking boxes. It's a control panel for the PR workflow. If Renovate is holding back an update because of rate limiting or branch conflicts, the Dashboard tells you why and gives you a way to override. It also warns you about failed or blocked updates so they don't silently stall.

This is genuinely useful. Without the Dashboard, Renovate's activity is scattered across dozens of open PRs, and it's easy to lose track of what's pending, what's blocked, and what needs attention. The Dashboard pulls all of that into one place.

But it's still organized around PRs. Each entry is an update that Renovate can open a PR for, and the primary interaction is "check the box to create or retry the PR." The information it surfaces (version numbers, groupings, blocking reasons) serves the goal of helping you manage the PR queue.

Dependicus's dashboard is a static HTML site that shows your entire dependency landscape in a single table. Rather than listing actionable PRs, it shows every direct dependency with rich context: current version, latest version, how long you've been behind, which workspace packages use it, whether it's in your catalog, whether any of its transitive dependencies are deprecated, and links to changelogs and release notes. You can sort, filter, and drill into per-package detail pages with the full upgrade path and size comparisons.

The difference is one of purpose. Renovate's Dashboard answers "what is Renovate doing right now and what should I unblock?" Dependicus's dashboard answers "what does our dependency health look like and where should we focus?" Renovate's is an operational tool for managing an automated process. Dependicus's is an analytical tool for making decisions.

A practical example: if you want to know which of your 200 dependencies are more than a year behind and used by the most workspace packages, Dependicus shows you that in a sortable table. Renovate's Dashboard can tell you which of those updates have open PRs and whether they're passing CI, but it isn't designed to give you that birds-eye prioritization view.

If you run both tools, the two dashboards complement each other. Use Dependicus's dashboard to understand the landscape and decide priorities, and Renovate's Dashboard to manage the mechanics of getting those updates merged.

## Where Renovate has more to offer

Renovate's breadth of ecosystem support is unmatched. It handles npm, pip, Docker, Gradle, Maven, Cargo, Go modules, Helm charts, Terraform, and dozens more. Dependicus supports all major Node.js package managers and [mise](https://mise.jdx.dev/) (which Renovate also supports), but does not extend beyond that.

Renovate also does the actual updating. It creates branches, modifies lockfiles, and opens PRs that you can merge. Dependicus tells you what needs updating and creates tickets, but the actual update is still a manual step.

If you work across multiple platforms (say, GitHub for some repos and GitLab for others), Renovate handles that natively. Dependicus is platform-agnostic in the sense that it reads your lockfile locally, but its ticket integration supports Linear and GitHub Issues.

Renovate's preset system and community configurations are a significant advantage for getting started. You can adopt `config:recommended` and have sensible defaults immediately. The ecosystem of shared presets means you benefit from collective wisdom about how to group and schedule updates.

## Where Dependicus has more to offer

Dependicus gives you a complete picture before you act. The dashboard shows every dependency, its age, its usage across your monorepo, whether it's cataloged, whether it has deprecated transitive dependencies, and links to changelogs and release notes. This is a different kind of value from a PR diff.

The plugin system lets you extend Dependicus with your own data sources, table columns, grouping pages, and ticket policies. If you need to add CVE lookups, internal ownership data, or compliance tier classifications, you write a plugin that attaches that data to the dependency graph. The dashboard and tickets then reflect your custom data automatically.

Dependicus's compliance features (SLOs, due dates, team routing, advisory vs. enforced policies) address a need that Renovate doesn't directly target. If your organization needs to demonstrate that dependencies are being managed according to policy, Dependicus can produce that evidence.

### Monorepo depth

Renovate is monorepo-aware in the sense that it can group packages from the same monorepo into a single PR. But its model of a monorepo is structural, not organizational. It knows which packages live in the same repository. It doesn't know which team owns which package, or that three teams have drifted to different versions of the same dependency, or that a major bump to a shared utility needs coordination before anyone merges anything.

Dependicus tracks per-package usage across every workspace in the monorepo. If a dependency is used by 15 packages across 4 teams, the dashboard shows that, and it's different from a dependency used by a single internal tool. You can sort by breadth of usage to prioritize the updates that affect the most people. You can see version dispersion: where teams have diverged on a shared dependency and whether that's intentional or accidental.

Ticket routing follows the same structure. When Dependicus creates a ticket or issue for an outdated dependency, it routes it to the team that owns the packages consuming it. If the dependency crosses team boundaries, the ticket reflects that. Renovate opens a PR and leaves the question of ownership to whoever notices it first.

For monorepos that use catalogs to enforce version consistency, Dependicus tracks catalog membership directly. The dashboard shows at a glance whether each dependency is in the catalog, which makes it easy to spot packages that have opted out of the shared version (or were never added).

## Using them together

The simplest integration is to run both tools in parallel. Renovate handles the PR workflow: it opens PRs, rebases them, and auto-merges where appropriate. Dependicus provides the strategic view: it shows the full landscape, tracks compliance SLOs, and creates tickets for updates that need human attention or cross-team coordination.

In this model, Renovate handles the routine, low-risk updates automatically, while Dependicus ensures that larger, more consequential updates don't fall through the cracks and are routed to the right people.

## Summary

|                         | Renovate                                                | Dependicus                                                                     |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Primary output          | Pull requests                                           | Dashboard and tickets                                                          |
| Automation level        | High (creates branches, updates lockfiles)              | Low (surfaces information, creates tickets)                                    |
| Ecosystem support       | 90+ package managers (including mise)                   | All major Node.js package managers + mise                                      |
| Platform support        | GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Forgejo | Platform-agnostic (reads lockfile locally)                                     |
| Dashboard               | GitHub issue listing pending PRs and update status      | Static site showing full dependency landscape with rich context                |
| Ticket integration      | GitHub/GitLab issues                                    | Linear and GitHub Issues                                                       |
| Compliance/SLO tracking | Not built-in                                            | Built-in (BasicCompliancePlugin)                                               |
| Plugin system           | Presets and custom managers                             | JavaScript API for data sources, columns, groupings, ticket policies           |
| Monorepo awareness      | Groups monorepo packages in PRs                         | Per-package usage tracking, version dispersion, team routing, catalog tracking |
| Configuration           | JSON/JSON5 config file with presets                     | JavaScript function call                                                       |
| Best for                | Automating the mechanics of dependency updates          | Making informed decisions about dependencies at organizational scale           |
