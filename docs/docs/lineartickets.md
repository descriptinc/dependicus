[](){ #linear-tickets }

# Creating and Updating Linear Tickets

Linear tickets are defined by `getTicketSpec` functions, which take a [VersionContext](../api/interfaces/VersionContext.html) and a [FactStore](../api/classes/FactStore.html), and return a [TicketSpec](../api/types/TicketSpec.html).

Here's an example that covers the basics: skipping packages, routing to different teams, choosing between notification-only and SLA-enforced tickets, delegating simple updates, and reading from the `FactStore`.

```ts
import { dependicusCli, getUpdateType, FactKeys } from 'dependicus';

void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://mycompany.internal/dependicus',
    linear: {
        getTicketSpec: (context, store) => {
            const { packageName, currentVersion, latestVersion } = context;
            const updateType = getUpdateType(currentVersion, latestVersion);

            // Skip packages you don't want tickets for
            if (packageName === 'webpack') return undefined;

            // Route different packages to different teams
            const teamId = packageName.startsWith('@mycompany/')
                ? 'team-uuid-platform'
                : 'team-uuid-frontend';

            // Notification-only tickets for major updates (no due date)
            if (updateType === 'major') {
                return { teamId, policy: { type: 'fyi' } };
            }

            // Read facts from the store — skip deprecated packages
            // rather than filing tickets to update them
            const isDeprecated = store.getVersionFact<boolean>(
                packageName,
                latestVersion,
                FactKeys.IS_DEPRECATED,
            );
            if (isDeprecated) return undefined;

            // SLA-enforced tickets for minor/patch.
            // Auto-assign patch releases to a bot — but not if the
            // package has local patches (pnpm patch), since those
            // need human attention when updating.
            const isPatched = store.getVersionFact<boolean>(
                packageName,
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
