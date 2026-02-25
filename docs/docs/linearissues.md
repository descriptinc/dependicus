[](){ #linear-issues }

# Creating and Updating Linear Issues

Linear issues are defined by `getLinearIssueSpec` functions, which take a [VersionContext](../api/interfaces/VersionContext.html) and a [FactStore](../api/classes/FactStore.html), and return a [LinearIssueSpec](../api/types/LinearIssueSpec.html).

Here's an example that covers the basics: skipping dependencies, routing to different teams, choosing between notification-only and SLA-enforced issues, delegating simple updates, and reading from the `FactStore`.

```ts
import { dependicusCli, getUpdateType, FactKeys } from 'dependicus';

void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://mycompany.internal/dependicus',
    linear: {
        getLinearIssueSpec: (context, store) => {
            const { name, currentVersion, latestVersion } = context;
            const updateType = getUpdateType(currentVersion, latestVersion);

            // Skip dependencies you don't want issues for
            if (name === 'webpack') return undefined;

            // Route different dependencies to different teams
            const teamId = name.startsWith('@mycompany/')
                ? 'team-uuid-platform'
                : 'team-uuid-frontend';

            // Notification-only issues for major updates (no due date)
            if (updateType === 'major') {
                return { teamId, policy: { type: 'fyi' } };
            }

            // Read facts from the store — skip deprecated dependencies
            // rather than filing issues to update them
            const isDeprecated = store.getVersionFact<boolean>(
                name,
                latestVersion,
                FactKeys.IS_DEPRECATED,
            );
            if (isDeprecated) return undefined;

            // SLA-enforced issues for minor/patch.
            // Auto-assign patch releases to a bot — but not if the
            // dependency has local patches applied, since those need
            // human attention when updating.
            const isPatched = store.getVersionFact<boolean>(
                name,
                currentVersion,
                FactKeys.IS_PATCHED,
            );
            return {
                teamId,
                policy: { type: 'dueDate' },
                assignment:
                    updateType === 'patch' && !isPatched
                        ? { type: 'delegate', assigneeId: 'your-bot-user-uuid' }
                        : { type: 'unassigned' },
            };
        },
    },
}).run(process.argv);
```

## CLI flags

The `make-linear-issues` command accepts these flags in addition to `--dry-run`, `--json-file`, and `--linear-team-id`:

- `--cooldown-days <days>` — days to wait before creating a new issue for a newly-published version. Overrides `linear.cooldownDays` in the programmatic config.
- `--rate-limit-days <days>` — default notification rate limit in days. Applied when per-policy `rateLimitDays` is not set. Overrides `linear.rateLimitDays`.
- `--no-new-issues` — prevent creation of new issues; only update existing ones. Overrides `linear.allowNewIssues`.
- `--skip-state <name>` — skip updating issues in this Linear state (repeatable, case-insensitive). Overrides `linear.skipStateNames`.

```sh
dependicus make-linear-issues --cooldown-days 3 --rate-limit-days 7 --skip-state pr --skip-state verify
```
