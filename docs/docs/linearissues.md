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

## Due dates

A `dueDate` policy needs `thresholdDays`, and the due date is `thresholdDays` after the first release of the kind of update needed. For `react` 18.2.0 with 19.0.0 out, that's the day 19.0.0 was published, so a 90-day threshold is due 90 days after that. The spec sets the threshold, so it decides the deadline: to give every issue open when you adopt a policy the same grace period, pass a threshold that lands on that date. With `minimumVersion`, the clock starts at that version's release instead. A `dueDate` spec without `thresholdDays` files no issue, or an FYI one with no due date if it sets `targetVersion`.

## One issue per team

A dependency used by several teams gets one issue, in the one team the spec names. To give each team its own, return an array of specs, each with a different `scope`. Every scope gets a separate issue with the scope in its title, like `[Dependicus] [npm] [Payments] Update react from ...`, and is created, updated and closed on its own. `context.usedBy` lists the packages that use the version, so you can work out which teams those are, and a spec's `usedBy` narrows the issue to the packages that team owns.

```ts
getLinearIssueSpec: (context) => {
    const byTeam = new Map<string, string[]>();
    for (const pkg of context.usedBy ?? []) {
        const team = teamForPackage(pkg);
        byTeam.set(team, [...(byTeam.get(team) ?? []), pkg]);
    }
    return [...byTeam].map(([team, usedBy]) => ({
        teamId: linearTeamIds[team],
        scope: team,
        usedBy,
        policy: { type: 'dueDate' },
        thresholdDays: 90,
    }));
},
```

A spec without a scope behaves as it always has, so an existing unscoped issue stays matched. Plugins that return a single spec, like `SecurityPlugin`'s description sections, are merged into every scoped one. Scopes can't contain square brackets.

## Security fixes

By default an issue asks for the first release of the kind of update needed, like the next major. For a vulnerability that's often the wrong version: the fix may be a patch on the current line, or several majors up. Set `minimumVersion` to ask for a specific release instead. The title asks for at least that version, and the due date counts from when it was published.

`SecurityPlugin`'s Snyk source records the lowest version that fixes every advisory against a dependency version, and `getFixVersion` reads it back:

```ts
import { getFixVersion, SECURITY_FINDINGS_KEY, type SecurityFinding } from 'dependicus';

getLinearIssueSpec: (context, store) => {
    const findings = store.getVersionFact<SecurityFinding[]>(
        context.name,
        context.currentVersion,
        SECURITY_FINDINGS_KEY,
    );
    if (!findings?.some((f) => f.severity === 'high' || f.severity === 'critical')) {
        return undefined;
    }
    return {
        teamId: 'your-team-uuid',
        policy: { type: 'dueDate' },
        thresholdDays: 28,
        minimumVersion: getFixVersion(store, context.name, context.currentVersion),
    };
},
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
