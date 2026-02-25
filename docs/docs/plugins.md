# Writing Plugins

Dependicus plugins can:

- Collect and cache data from external sources in the `update` stage
- Add columns to HTML output in the `html` stage
- Create rollup pages in the `html` stage
- Add some or all Linear ticket data in the `make-linear-issues` stage, or GitHub issue data in the `make-github-issues` stage

Plugin output is combined. A plugin can do a small subset of these things, or all of them.

Dependicus ships with [BasicCompliancePlugin](../api/classes/BasicCompliancePlugin.html), which serves as sample code as well as a reasonable way to think about update SLOs.

[Plugin API](../api/interfaces/DependicusPlugin.html)

## Setting ticket data and metadata

To set the team, due date, content, or anything else supported by [LinearIssueSpec](../api/types/LinearIssueSpec.html), implement `getLinearIssueSpec`. Similarly, implement `getGitHubIssueSpec` for [GitHubIssueSpec](../api/types/GitHubIssueSpec.html). Both return partials, so you can only override what you need.

For example, Dependicus comes with `BasicCompliancePlugin` for threshold-based compliance tracking. (See [Compliance](./compliance.md) for more on that). But compliance isn’t enough to make a ticket—you also need to put it somewhere. So one thing you could do would be to compose `BasicCompliancePlugin` with your own `OwnershipPlugin`, like this:

```ts
const dependencyOwners = {
    react: 'devex',
    'react-dom': 'devex',
    express: 'api',
};

const teams = {
    devex: {
        name: 'Developer Experience',
        teamId: 'xxx',
    },
    api: {
        name: 'API',
        teamId: 'yyy',
    },
};

void dependicusCli({
    repoRoot,
    dependicusBaseUrl: 'https://mycompany.internal/dependicus',
    plugins: [
        new BasicCompliancePlugin({
            /* options */
        }),
        {
            name: 'Ownership',
            getLinearIssueSpec: (context, store) => {
                const ownerId = dependencyOwners[context.name];
                const owner = teams[ownerId]!;
                return {
                    teamId: owner.teamId,
                    ownerLabel: owner.name,
                };
            },
        },
        {
            name: 'Grouping',
            getLinearIssueSpec: (context, store) => {
                // Bonus example: batch all updates for dependencies of the form
                // @x/y into single tickets, so for example you get @react/*
                // as just one ticket
                if (context.name.startsWith('@') && context.name.includes('/')) {
                    return { group: context.name.split('/')[0] };
                } else {
                    return undefined;
                }
            },
        },
    ],
}).run(process.argv);
```

### GitHub Issues

Plugins can also provide `getGitHubIssueSpec` to contribute partial GitHub issue specs. The same composability pattern applies: multiple plugins can each return a `Partial<GitHubIssueSpec>`, and they are merged together with `descriptionSections` concatenated. For example, one plugin can set the `owner`/`repo` while another adds labels:

```ts
const routingPlugin: DependicusPlugin = {
    name: 'github-routing',
    getGitHubIssueSpec: () => ({
        owner: 'myorg',
        repo: 'myrepo',
    }),
};

const labelPlugin: DependicusPlugin = {
    name: 'github-labels',
    getGitHubIssueSpec: (context) => ({
        labels: context.name.startsWith('@internal/') ? ['internal'] : ['external'],
    }),
};
```

## Adding a custom column to the table

You can add columns by adding [CustomColumn](../api/interfaces/CustomColumn.html) objects to `columns`. Custom columns require a unique key, header text, and a value getter, and have a few other options that correspond to [Tabulator](https://tabulator.info/) APIs.

```ts
import type { DependicusPlugin } from 'dependicus';

const ANIMALS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮'];

function animalForDependency(name: string): string {
    let hash = 0;
    for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return ANIMALS[Math.abs(hash) % ANIMALS.length]!;
}

const animalPlugin: DependicusPlugin = {
    name: 'animal-emoji',
    columns: [
        {
            key: 'animal',
            header: 'Animal',
            width: 80,
            getValue: (name) => animalForDependency(name),
        },
    ],
};
```

Columns can also define `filter: 'input'` for free-text search, or `filter: 'list'` with `filterValues` for a dropdown. Use `getFilterValue` when the filter key differs from the display value (e.g. filtering by ID while displaying a label). See `BasicCompliancePlugin.buildColumns` for a working example.

`getValue` return values and `GroupingSection.html` strings are rendered as raw HTML, so plugins can return rich markup (links, badges, styled text, etc.). All raw HTML is sanitized with DOMPurify before rendering to prevent XSS from registry-derived data.

## Adding information with `DataSource`

The `update` stage is the right time to fetch information and add it to `FactStore` for later use by HTML and Linear output. Fetching information is done by `DataSource` objects.

This example fetches CVE count from an imaginary source and stores it in `FactStore`, then uses the new fact to show a table column in the HTML and a section in the Linear ticket (or GitHub issue).

```ts
import type { DependicusPlugin, DataSource, DirectDependency, CustomColumn } from 'dependicus';
import type { VersionContext, LinearIssueSpec } from 'dependicus';
import { FactStore } from 'dependicus';
import { getCveCount } from 'magic-cve-fetcher';

const CVE_FACT = 'cveCountByVersion';

const cveSource: DataSource = {
    name: 'cve-lookup',
    dependsOn: [],
    async fetch(dependencies: DirectDependency[], store: FactStore) {
        for (const dep of dependencies) {
            const cvesByVersion: Record<string, number> = {};
            for (const version of dep.versions) {
                cvesByVersion[version.version] = await getCveCount(dep.name, version.version);
            }
            store.setDependencyFact(dep.name, CVE_FACT, cvesByVersion);
        }
    },
};

class CvePlugin implements DependicusPlugin {
    readonly name = 'cve';
    readonly sources = [cveSource];

    get columns(): CustomColumn[] {
        return [
            {
                key: 'cves',
                header: 'CVEs',
                width: 80,
                getValue: (name, version, store) => {
                    const counts = store.getDependencyFact<Record<string, number>>(name, CVE_FACT);
                    return String(counts?.[version.version] ?? 0);
                },
            },
        ];
    }

    getLinearIssueSpec = (
        context: VersionContext,
        store: FactStore,
    ): Partial<LinearIssueSpec> | undefined => {
        const counts = store.getDependencyFact<Record<string, number>>(context.name, CVE_FACT);
        const cveCount = counts?.[context.currentVersion] ?? 0;
        if (cveCount === 0) return undefined;

        return {
            descriptionSections: [
                {
                    title: 'Security',
                    body: `${cveCount} known CVE${cveCount > 1 ? 's' : ''} affect this version.`,
                },
            ],
        };
    };
}
```

A source can declare `dependsOn: ['npm-registry']` to run after another source. It can also provide a `refreshLocal` method for re-populating facts from local data (e.g. re-reading a YAML file) without network access. This runs during `dependicus html` to pick up local changes without a full update.

## Grouping pages

Groupings create rollup pages that aggregate dependencies by a shared key (e.g. team, policy tier). Each `GroupingConfig` provides `getValue` to extract the key from the store. The detail page for each group value shows that group's dependencies and any sections returned by `getSections`.

`BasicCompliancePlugin` creates a grouping page per compliance policy automatically. For a working example of `getValue` and `getSections` on a grouping, see `buildGroupings` in [`compliance.ts`](../api/classes/BasicCompliancePlugin.html).

See [`GroupingConfig`](../api/interfaces/GroupingConfig.html) in the API reference.
