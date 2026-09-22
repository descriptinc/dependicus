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

The clock starts when the update you need comes out. If you're on `react` 18.2.0 and the spec says `thresholdDays: 90`, the issue is due 90 days after 19.0.0 was published.

Since your spec picks the threshold, it picks the deadline. That's handy when you roll out a new policy: old updates would all be overdue on day one, so you can pass a bigger threshold that puts them all on the same date instead.

If a `dueDate` spec leaves out `thresholdDays`, there's nothing to track, so no issue gets filed. (Set `targetVersion` too and you get an FYI issue with no due date.)

## One issue per team

Say `react` is used by packages that belong to three teams. By default, that's one issue, and it goes to whichever team your spec names. The other two teams never hear about it.

To give each team its own issue, return an array of specs with a different `scope` on each one:

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

`context.usedBy` tells you which packages use this version. Setting `usedBy` on a spec narrows that issue to the team's own packages, so nobody gets asked to update code they don't own.

Each scope shows up in its issue's title, like `[Dependicus] [npm] [Payments] Update react from ...`. That's how Dependicus finds the issue again on the next run, so each team's issue gets updated and closed on its own. Scopes can't contain square brackets.

A few other things to know:

- A spec without a scope works exactly like it did before, and so do the issues it already filed.
- If another plugin returns a single spec, like `SecurityPlugin` adding advisories to the description, it gets merged into every scoped spec.

## Security fixes

By default, an issue asks you to update to the first release of the kind you need, like the next major. For a vulnerability, that's usually not the release with the fix. The fix might be a patch on the version you're already on, or it might be three majors away.

Set `minimumVersion` to ask for a specific release instead. The title will say "at least" that version, and the due date counts from the day it came out.

If you use `SecurityPlugin` with Snyk, you don't have to work out the version yourself. Snyk says which releases fix each advisory, Dependicus picks the lowest one that fixes all of them, and `getFixVersion` gives it to you:

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
