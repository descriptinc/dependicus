[](){ #github-issues }

# Creating and Updating GitHub Issues

GitHub Issues are defined by `getGitHubIssueSpec` functions, which take a [VersionContext](../api/interfaces/VersionContext.html) and a [FactStore](../api/classes/FactStore.html), and return a [GitHubIssueSpec](../api/types/GitHubIssueSpec.html).

Here's an example that covers the basics: skipping packages, routing to a repo, choosing between notification-only and SLA-enforced issues, assigning users, and reading from the `FactStore`.

```ts
import { dependicusCli, getUpdateType, FactKeys } from 'dependicus';

void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://mycompany.internal/dependicus',
    github: {
        getGitHubIssueSpec: (context, store) => {
            const { packageName, currentVersion, latestVersion } = context;
            const updateType = getUpdateType(currentVersion, latestVersion);

            // Skip packages you don't want issues for
            if (packageName === 'webpack') return undefined;

            // All issues go to a single repo
            const owner = 'myorg';
            const repo = 'myrepo';

            // Notification-only issues for major updates (no due date)
            if (updateType === 'major') {
                return { owner, repo, policy: { type: 'fyi' } };
            }

            // Read facts from the store
            const isDeprecated = store.getVersionFact<boolean>(
                packageName,
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

## Due dates

Since GitHub Issues have no native due date field, the due date is appended to the issue title: `Update react 18.2.0 → 19.0.0 (due 2025-03-15)`. The due date also appears in the issue body.

## Token resolution

The `make-github-issues` command looks for `GITHUB_TOKEN` in the environment first. If not set, it falls back to `gh auth token` (the GitHub CLI). This means local development works without exporting a token if you've already run `gh auth login`.
