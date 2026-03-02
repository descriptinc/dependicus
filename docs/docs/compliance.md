# BasicCompliancePlugin

A common way to think about dependencies is to set an [SLO](https://en.wikipedia.org/wiki/Service-level_objective) around how soon you’ll update to the latest major, minor, or patch version of a dependency. A natural way to be notified of updates and track the work is to create tickets with due dates reflecting your chosen SLO.

Dependicus ships with [BasicCompliancePlugin](../api/classes/BasicCompliancePlugin.html) to make this behavior easy to set up. You provide the constraints, and `BasicCompliancePlugin` will:

- Set due dates, if needed
- Mark dependencies as in compliance, out of compliance, or n/a, depending
- Display this data in the table and on detail pages

The tickets will ask you to update to the oldest version that complies with your chosen policy. If newer versions exist, they will be mentioned.

`BasicCompliancePlugin` doesn’t provide a `teamId`; you’ll need to add it yourself.

Here’s a brief example.

```ts
import { dependicusCli, BasicCompliancePlugin } from 'dependicus';

// Map packages to policy IDs however you like.
const dependencyPolicies: Record<string, string> = {
    react: 'critical',
    'react-dom': 'critical',
    lodash: 'advisory',
};

void dependicusCli({
    repoRoot,
    plugins: [
        new BasicCompliancePlugin({
            {
                critical: {
                    name: 'Critical',
                    thresholdDays: { major: 180, minor: 90, patch: 30 },
                },
                patchOnly: {
                    name: 'Patch Only',
                    // ignores major and minor releases
                    thresholdDays: { patch: 30 },
                }
                advisory: {
                    name: 'Advisory',
                    notificationsOnly: true,
                    notificationRateLimitDays: 30,
                    description: 'No mandatory updates, just notifications',
                },
            },
            getPolicy: (name) => dependencyPolicies[name],
        }),
    ],

    // BasicCompliancePlugin handles compliance status and due dates,
    // but doesn't know which team owns which dependency.
    getLinearIssueSpec: (context) => ({ teamId: 'your-team-uuid' }),
}).run(process.argv);
```
