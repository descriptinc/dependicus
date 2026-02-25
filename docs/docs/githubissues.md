[](){ #github-issues }

# Creating and Updating GitHub Issues

GitHub Issues are defined by `getGitHubIssueSpec` functions, which take a [VersionContext](../api/interfaces/VersionContext.html) and a [FactStore](../api/classes/FactStore.html), and return a [GitHubIssueSpec](../api/types/GitHubIssueSpec.html).

Here's an example that covers the basics: skipping dependencies, routing to a repo, choosing between notification-only and SLA-enforced issues, assigning users, and reading from the `FactStore`.

```ts
import { dependicusCli, getUpdateType, FactKeys } from 'dependicus';

void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://mycompany.internal/dependicus',
    github: {
        getGitHubIssueSpec: (context, store) => {
            const { name, currentVersion, latestVersion } = context;
            const updateType = getUpdateType(currentVersion, latestVersion);

            // Skip dependencies you don't want issues for
            if (name === 'webpack') return undefined;

            // All issues go to a single repo
            const owner = 'myorg';
            const repo = 'myrepo';

            // Notification-only issues for major updates (no due date)
            if (updateType === 'major') {
                return { owner, repo, policy: { type: 'fyi' } };
            }

            // Read facts from the store
            const isDeprecated = store.getVersionFact<boolean>(
                name,
                latestVersion,
                FactKeys.IS_DEPRECATED,
            );
            if (isDeprecated) return undefined;

            // SLA-enforced issues for minor/patch
            return {
                owner,
                repo,
                policy: { type: 'dueDate' },
                // Assign GitHub users to patch updates
                assignment:
                    updateType === 'patch'
                        ? { type: 'assign', assignees: ['dependabot-helper'] }
                        : { type: 'unassigned' },
                // Add extra labels for categorization
                labels: ['dependencies'],
            };
        },
    },
}).run(process.argv);
```

## CLI flags

The `make-github-issues` command accepts these flags in addition to `--dry-run`, `--json-file`, `--github-owner`, and `--github-repo`:

- `--cooldown-days <days>` — days to wait before creating a new issue for a newly-published version. Overrides `github.cooldownDays` in the programmatic config.
- `--rate-limit-days <days>` — default notification rate limit in days. Applied when per-policy `rateLimitDays` is not set. Overrides `github.rateLimitDays`.
- `--no-new-issues` — prevent creation of new issues; only update existing ones. Overrides `github.allowNewIssues`.

```sh
dependicus make-github-issues --cooldown-days 5 --rate-limit-days 14 --no-new-issues
```

## Due dates

Since GitHub Issues have no native due date field, the due date is appended to the issue title: `Update react 18.2.0 → 19.0.0 (due 2025-03-15)`. The due date also appears in the issue body.

## Token resolution

The `make-github-issues` command looks for `GITHUB_TOKEN` in the environment first. If not set, it falls back to `gh auth token` (the GitHub CLI). This means local development works without exporting a token if you've already run `gh auth login`.
