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

An issue is due `thresholdDays` after the release it asks for was published. If you're on `react` 18.2.0 and your spec sets `thresholdDays: 90`, the issue is due 90 days after the release of 19.0.0.

Your spec sets the threshold, so your spec sets the due date. This helps when you adopt a new policy. Updates that came out long ago would be overdue on the first run, so you can give them a larger threshold that makes them all due on the same day.

A `dueDate` spec without `thresholdDays` files no issue. If it also sets `targetVersion`, Dependicus files an FYI issue with no due date.

## One issue per team

Suppose packages owned by three teams use `react`. Dependicus files one issue for it, in the team your spec names, and the other two teams never see it.

To file an issue for each team, return an array of specs, each with its own `scope`:

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

`context.usedBy` lists the packages that use the version. A spec's `usedBy` limits its issue to the packages that team owns.

Dependicus puts the scope in the title, like `[Dependicus] [npm] [Payments] Update react from ...`, and uses it to find the issue on later runs. Each team's issue is updated and closed separately. A scope can't contain square brackets.

A spec without a scope works as it did before, and so do the issues it filed. A plugin that returns a single spec, like `SecurityPlugin` with its advisory sections, is merged into every scoped spec.

## Security fixes

By default, an issue asks for the first release of the update type needed, such as the next major. For a vulnerability, that release often lacks the fix. The fix may be a patch on your current line, or several majors ahead.

Set `minimumVersion` to ask for a specific release. The title asks for at least that version, and the issue is due `thresholdDays` after its release.

With `SecurityPlugin` and Snyk, you don't need to find the version yourself. Snyk lists the releases that fix each advisory. Dependicus picks the lowest release that fixes all of them, and `getFixVersion` returns it:

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
