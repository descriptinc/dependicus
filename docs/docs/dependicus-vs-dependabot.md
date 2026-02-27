# Dependicus vs Dependabot

Dependabot is the default dependency update tool for millions of GitHub repositories. It's built into the platform, requires minimal configuration, and handles security updates automatically. For many teams, it's exactly the right tool.

Dependicus solves a different problem. This article explains what each tool does and when you might want one, the other, or both.

## What Dependabot does

[Dependabot](https://docs.github.com/en/code-security/dependabot) is GitHub's built-in dependency management service. It has two main capabilities: security updates and version updates.

Security updates are automatic. When GitHub's advisory database identifies a vulnerability in one of your dependencies, Dependabot opens a pull request to update to a patched version. This happens without any configuration and is one of the most valuable features of the GitHub platform.

Version updates are opt-in. You add a `dependabot.yml` to your repository specifying which ecosystems to track and how often to check. Dependabot then opens PRs to keep your dependencies current, regardless of whether there's a known vulnerability.

Dependabot supports around 30 package ecosystems including npm, pip, Bundler, Docker, Go modules, Cargo, Maven, and GitHub Actions. Its grouped updates feature, which reached general availability with cross-ecosystem support in mid-2025, lets you consolidate related updates into fewer PRs.

The deep integration with GitHub is a genuine strength. Dependabot alerts surface in the Security tab, compatibility scores appear on PRs, and the whole experience feels native because it is native.

## What Dependicus does

Dependicus collects data about your JavaScript dependencies from your pnpm, bun, or yarn lockfile, the npm registry, and GitHub, then produces an interactive dashboard and (optionally) Linear tickets.

The dashboard shows every direct dependency in your monorepo in a single table: package name, current version, latest version, published date, age, whether it's in your catalog, how many workspace packages use it, which packages those are, and whether any transitive dependencies are deprecated. Each package links through to a detail page with the full upgrade path, changelog links, GitHub release URLs, and size comparisons.

On the ticket side, Dependicus creates Linear tickets or GitHub Issues based on configurable policies. You define SLOs (patch within 30 days, minor within 90), route tickets to the owning team, and distinguish between advisory notifications and enforced deadlines. Tickets are grouped, deduplicated, and updated automatically as new versions appear.

## Different shapes of the same concern

Both tools exist because outdated dependencies are a real problem. They just address it from different angles.

Dependabot's approach is reactive and automated: a new version appears, a PR is opened, you review and merge. The unit of work is the pull request. This works well when your team can process PRs efficiently and when most updates are safe to take with a passing CI run.

Dependicus's approach is proactive and informational: you see the full picture of your dependency health at a glance, then decide what to do about it. The unit of work is the decision, supported by context. This works well when you need to coordinate across teams, prioritize based on risk, or demonstrate compliance.

## Monorepos make this harder

The automated-PR model works reasonably well for a single-package repository with a handful of dependencies. In a monorepo, the picture gets more complicated.

A typical JavaScript monorepo has dozens of workspace packages maintained by different teams, sharing hundreds of direct dependencies. The same package often appears at different versions across workspaces. Teams have different risk tolerances, different release cadences, and different opinions about when to take a major version bump. A shared utility library used by 15 packages across 4 teams is a fundamentally different update than a dev dependency pinned in a single package.

Dependabot doesn't model any of this. It sees packages and versions, not teams and ownership. Its grouped updates feature can consolidate PRs within an ecosystem, but it can't distinguish between a patch to something only the platform team uses and a major bump to something every team depends on. It can't route an update to the team that owns the affected packages, or hold off on a shared dependency until the teams that consume it have coordinated.

Filippo Valsorda's widely-discussed article ["Turn Dependabot Off"](https://words.filippo.io/dependabot/) ([HN discussion](https://news.ycombinator.com/item?id=47094192)) captures a related tension. Valsorda argues that Dependabot conflates two distinct concerns, security and freshness, and handles both poorly. Security alerts fire on vulnerabilities in code paths you may never call. Version updates generate PRs on someone else's release schedule, not yours. The result is alert fatigue: when everything looks urgent, nothing gets proper triage.

These problems compound in a monorepo. The volume of PRs grows with the number of workspace packages. Teams either auto-merge aggressively (trading review quality for throughput) or let PRs pile up (trading currency for sanity). Neither outcome improves as the monorepo grows.

Dependicus was built for this environment. It tracks which workspace packages use each dependency, routes tickets to owning teams, and lets you set different policies for different tiers of risk. The dashboard shows version dispersion across workspaces, so you can see at a glance where teams have drifted apart on a shared dependency and decide whether that matters.

## Where Dependabot has more to offer

Dependabot's zero-configuration security updates are hard to beat. If you're on GitHub, you get vulnerability alerts and automated patches without lifting a finger. This is a genuinely important capability, and it's free.

The breadth of ecosystem support is another advantage. Dependabot handles npm, pip, Docker, Bundler, Go, Cargo, Maven, Gradle, Terraform, GitHub Actions, and more. Dependicus supports pnpm, bun, and yarn.

Dependabot also does the actual work of updating. It creates branches, modifies manifests and lockfiles, and opens PRs you can merge. Dependicus surfaces information and creates tickets, but the update itself is still manual.

For teams that are GitHub-only and want the simplest possible dependency management, Dependabot is the obvious choice. Enable it in your repository settings, add a `dependabot.yml`, and you're done.

## Where Dependicus has more to offer

Dependicus gives you a dashboard that shows the full state of your dependencies at once. This is a different experience from scrolling through a list of open PRs. You can sort by age, filter by team, see which packages are used most broadly, and identify deprecated transitive dependencies, all without leaving a single page.

The plugin system lets you attach custom data to your dependency graph. If you need to enrich dependencies with CVE data, internal ownership, compliance classifications, or anything else specific to your organization, you write a plugin and the dashboard and tickets reflect that data automatically.

The compliance features (SLOs, due dates, policy types) serve teams that need to track and demonstrate that dependency updates are being handled according to organizational policy. Dependabot doesn't have an equivalent to this.

## Using them together

There's no conflict between running both. A natural division of labor:

Dependabot handles security updates automatically. When a vulnerability is disclosed, you want a PR immediately, and Dependabot delivers that.

Dependicus provides the strategic layer. It shows the full dependency landscape, tracks compliance against your SLOs, routes tickets to the right teams, and gives leadership visibility into dependency health across the monorepo. It handles the organizational question of "are we keeping up?" rather than the mechanical question of "is there a new version?"

For version updates specifically, you might use Dependabot's version updates for simple, low-risk upgrades (dev dependencies, patch versions) while relying on Dependicus tickets for updates that need more deliberation: major versions, broadly-used packages, or anything that crosses team boundaries.

## Summary

|                         | Dependabot                                      | Dependicus                                                                     |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Primary output          | Pull requests and security alerts               | Dashboard and tickets                                                          |
| Security updates        | Automatic, zero-config                          | Not a focus (can surface deprecations)                                         |
| Automation level        | High (creates branches, updates lockfiles)      | Low (surfaces information, creates tickets)                                    |
| Ecosystem support       | ~30 package managers                            | pnpm, bun, and yarn                                                            |
| Platform                | GitHub only                                     | Platform-agnostic (reads lockfile locally)                                     |
| Ticket integration      | GitHub PRs and alerts                           | Linear and GitHub Issues                                                       |
| Compliance/SLO tracking | Not built-in                                    | Built-in (BasicCompliancePlugin)                                               |
| Plugin system           | None                                            | JavaScript API for data sources, columns, groupings, ticket policies           |
| Configuration           | YAML file                                       | JavaScript function call                                                       |
| Monorepo awareness      | Grouped updates (same ecosystem)                | Per-package usage tracking, version dispersion, team routing, catalog tracking |
| Best for                | Automated dependency updates with minimal setup | Organizational dependency governance and informed decision-making              |
