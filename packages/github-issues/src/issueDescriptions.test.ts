import { describe, it, expect } from 'vitest';
import type {
    DependencyVersion,
    PackageVersionInfo,
    GitHubData,
    DetailUrlFn,
} from '@dependicus/core';
import { RootFactStore, FactKeys, getDetailFilename } from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
import type { OutdatedDependency, OutdatedGroup } from './types';
import {
    buildIssueDescription,
    buildGroupIssueDescription,
    buildNewVersionsComment,
} from './issueDescriptions';

const defaultVersionsBetween: PackageVersionInfo[] = [
    {
        version: '1.1.0',
        publishDate: '2024-03-01',
        isPrerelease: false,
        registryUrl: 'https://www.npmjs.com/package/test-pkg/v/1.1.0',
    },
    {
        version: '2.0.0',
        publishDate: '2024-06-01',
        isPrerelease: false,
        registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.0.0',
    },
];

function makeVersion(overrides: Partial<DependencyVersion> = {}): DependencyVersion {
    return {
        version: '1.0.0',
        latestVersion: '2.0.0',
        usedBy: ['@app/web'],
        dependencyTypes: ['prod'],
        publishDate: '2024-01-01',
        inCatalog: true,
        ...overrides,
    };
}

function makeDependency(overrides: Partial<OutdatedDependency> = {}): OutdatedDependency {
    return {
        name: 'test-pkg',
        ecosystem: 'npm',
        versions: [makeVersion()],
        worstCompliance: { updateType: 'major', daysOverdue: 30, thresholdDays: 360 },
        owner: 'myorg',
        repo: 'myrepo',
        policy: { type: 'dueDate' },
        assignment: { type: 'unassigned' },
        ...overrides,
    } as OutdatedDependency;
}

function makeStore(
    dep: OutdatedDependency,
    opts: {
        versionsBetween?: PackageVersionInfo[];
        description?: string;
        homepage?: string;
        repositoryUrl?: string;
        bugsUrl?: string;
        unpackedSize?: number;
        compareUrl?: string;
        github?: GitHubData;
        deprecatedTransitiveDeps?: string[];
        isPatched?: boolean;
    } = {},
): FactStore {
    const root = new RootFactStore();
    const store = root.scoped(dep.ecosystem);
    const version = dep.versions[0]!;
    const vb = opts.versionsBetween ?? defaultVersionsBetween;

    store.setVersionFact(dep.name, version.version, FactKeys.VERSIONS_BETWEEN, vb);
    if (opts.description !== undefined) {
        store.setVersionFact(dep.name, version.version, FactKeys.DESCRIPTION, opts.description);
    } else {
        store.setVersionFact(dep.name, version.version, FactKeys.DESCRIPTION, 'A test package');
    }
    if (opts.homepage !== undefined) {
        store.setVersionFact(dep.name, version.version, FactKeys.HOMEPAGE, opts.homepage);
    }
    if (opts.repositoryUrl !== undefined) {
        store.setVersionFact(
            dep.name,
            version.version,
            FactKeys.REPOSITORY_URL,
            opts.repositoryUrl,
        );
    }
    if (opts.bugsUrl !== undefined) {
        store.setVersionFact(dep.name, version.version, FactKeys.BUGS_URL, opts.bugsUrl);
    }
    if (opts.unpackedSize !== undefined) {
        store.setVersionFact(dep.name, version.version, FactKeys.UNPACKED_SIZE, opts.unpackedSize);
    }
    if (opts.compareUrl !== undefined) {
        store.setVersionFact(dep.name, version.version, FactKeys.COMPARE_URL, opts.compareUrl);
    }
    if (opts.github !== undefined) {
        store.setDependencyFact(dep.name, FactKeys.GITHUB_DATA, opts.github);
    }
    if (opts.deprecatedTransitiveDeps !== undefined) {
        store.setDependencyFact(
            dep.name,
            FactKeys.DEPRECATED_TRANSITIVE_DEPS,
            opts.deprecatedTransitiveDeps,
        );
    }
    if (opts.isPatched) {
        store.setVersionFact(dep.name, version.version, FactKeys.IS_PATCHED, true);
    }

    // Set URL patterns as package-level fact
    store.setDependencyFact(dep.name, FactKeys.URLS, {
        'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
        Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
    });

    return root;
}

function makeGroupStore(group: OutdatedGroup, descriptions?: Record<string, string>): FactStore {
    const root = new RootFactStore();
    for (const dep of group.dependencies) {
        const version = dep.versions[0];
        if (!version) continue;
        const scoped = root.scoped(dep.ecosystem);
        scoped.setVersionFact(
            dep.name,
            version.version,
            FactKeys.VERSIONS_BETWEEN,
            defaultVersionsBetween,
        );
        scoped.setVersionFact(
            dep.name,
            version.version,
            FactKeys.DESCRIPTION,
            descriptions?.[dep.name] ?? 'A test package',
        );
        // Set URL patterns per package
        scoped.setDependencyFact(dep.name, FactKeys.URLS, {
            'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
            Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
        });
    }
    return root;
}

const BASE_URL = 'https://example.com/dependicus';
const testGetDetailUrl: DetailUrlFn = (_ecosystem, dependencyName, version) => {
    const filename = getDetailFilename(dependencyName, version);
    return `${BASE_URL}/npm/details/${filename}`;
};

const npmProviderInfo = {
    name: 'pnpm',
    ecosystem: 'npm',
    supportsCatalog: true,
    installCommand: 'pnpm install',
    urlPatterns: {
        'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
        Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
    },
    catalogFile: 'pnpm-workspace.yaml',
    patchHint:
        'This dependency has a patch applied in `pnpm-workspace.yaml`. When upgrading, check if the patch is still needed or should be removed.',
};

const npmProviderInfoMap = new Map([['npm', npmProviderInfo]]);

describe('buildIssueDescription', () => {
    it('includes package description as blockquote', () => {
        const dep = makeDependency();
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('> A test package');
    });

    it('includes summary with version info', () => {
        const dep = makeDependency();
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('## Summary');
        expect(result).toContain('**Current version:** `1.0.0`');
        expect(result).toContain('**Target version:** `1.1.0`');
        expect(result).toContain('**Latest version:** `2.0.0`');
        expect(result).toContain('**Update type:** major');
    });

    it('includes due date in body when provided', () => {
        const dep = makeDependency();
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
            '2025-06-01',
        );
        expect(result).toContain('**Due date:** 2025-06-01');
    });

    it('omits due date when not provided', () => {
        const dep = makeDependency();
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).not.toContain('Due date');
    });

    it('includes upgrade path', () => {
        const dep = makeDependency();
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('## Upgrade Path');
        expect(result).toContain('**2.0.0** (latest)');
    });

    it('includes links section', () => {
        const dep = makeDependency();
        const store = makeStore(dep, {
            homepage: 'https://example.com',
            repositoryUrl: 'https://github.com/example/test',
        });
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('[Dependicus Detail Page]');
        expect(result).toContain('[Registry]');
        expect(result).toContain('[Homepage](https://example.com)');
    });

    it('includes patch warning when patched', () => {
        const dep = makeDependency();
        const store = makeStore(dep, { isPatched: true });
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('Patch Applied');
    });

    it('renders consumer-provided description sections', () => {
        const dep = makeDependency({
            descriptionSections: [{ title: 'Policy Info', body: 'Must comply within 90 days.' }],
        });
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('## Policy Info');
        expect(result).toContain('Must comply within 90 days.');
    });

    it('includes footer about auto-creation', () => {
        const dep = makeDependency();
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('automatically created by Dependicus');
    });

    it('quotes scoped package names in catalog YAML', () => {
        const dep = makeDependency({ name: '@scope/my-pkg' });
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain("'@scope/my-pkg': \"2.0.0\"");
    });

    it('does not quote unscoped package names in catalog YAML', () => {
        const dep = makeDependency({ name: 'test-pkg' });
        const store = makeStore(dep);
        const result = buildIssueDescription(
            dep,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('test-pkg: "2.0.0"');
        expect(result).not.toContain("'test-pkg'");
    });
});

describe('buildGroupIssueDescription', () => {
    it('includes group intro and summary', () => {
        const group: OutdatedGroup = {
            groupName: 'react-group',
            dependencies: [
                makeDependency({ name: 'react' }),
                makeDependency({ name: 'react-dom' }),
            ],
            owner: 'myorg',
            repo: 'myrepo',
            policy: { type: 'dueDate' },
            worstCompliance: { updateType: 'major', daysOverdue: 10, thresholdDays: 360 },
        };

        const store = makeGroupStore(group);
        const result = buildGroupIssueDescription(
            group,
            store,
            testGetDetailUrl,
            npmProviderInfoMap,
        );
        expect(result).toContain('**react-group** dependency group');
        expect(result).toContain('**Dependencies:** 2');
        expect(result).toContain('**Worst update type:** major');
    });

    it('includes due date in group description', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            dependencies: [makeDependency()],
            owner: 'myorg',
            repo: 'myrepo',
            policy: { type: 'dueDate' },
            worstCompliance: { updateType: 'major', daysOverdue: 0, thresholdDays: 360 },
        };

        const store = makeGroupStore(group);
        const result = buildGroupIssueDescription(
            group,
            store,
            testGetDetailUrl,
            npmProviderInfoMap,
            '2025-06-01',
        );
        expect(result).toContain('**Due date:** 2025-06-01');
    });

    it('shows notifications-only for awareness groups', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            dependencies: [makeDependency()],
            owner: 'myorg',
            repo: 'myrepo',
            policy: { type: 'fyi' },
            worstCompliance: { updateType: 'minor', daysOverdue: 0, thresholdDays: undefined },
        };

        const store = makeGroupStore(group);
        const result = buildGroupIssueDescription(
            group,
            store,
            testGetDetailUrl,
            npmProviderInfoMap,
        );
        expect(result).toContain('Tracked for awareness only');
    });

    it('includes catalog yaml in How to Update', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            dependencies: [makeDependency({ name: 'react' })],
            owner: 'myorg',
            repo: 'myrepo',
            policy: { type: 'dueDate' },
            worstCompliance: { updateType: 'major', daysOverdue: 0, thresholdDays: 360 },
        };

        const store = makeGroupStore(group);
        const result = buildGroupIssueDescription(
            group,
            store,
            testGetDetailUrl,
            npmProviderInfoMap,
        );
        expect(result).toContain('```yaml');
        expect(result).toContain('react: "2.0.0"');
    });

    it('quotes scoped package names in group catalog YAML', () => {
        const group: OutdatedGroup = {
            groupName: 'scoped-group',
            dependencies: [
                makeDependency({ name: '@scope/pkg-a' }),
                makeDependency({ name: 'pkg-b' }),
            ],
            owner: 'myorg',
            repo: 'myrepo',
            policy: { type: 'dueDate' },
            worstCompliance: { updateType: 'major', daysOverdue: 0, thresholdDays: 360 },
        };

        const store = makeGroupStore(group);
        const result = buildGroupIssueDescription(
            group,
            store,
            testGetDetailUrl,
            npmProviderInfoMap,
        );
        expect(result).toContain("'@scope/pkg-a': \"2.0.0\"");
        expect(result).toContain('pkg-b: "2.0.0"');
        expect(result).not.toContain("'pkg-b'");
    });
});

describe('buildNewVersionsComment', () => {
    it('formats single new version', () => {
        const newVersions: PackageVersionInfo[] = [
            {
                version: '2.1.0',
                publishDate: '2024-07-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.1.0',
            },
        ];

        const result = buildNewVersionsComment('test-pkg', '2.0.0', newVersions);
        expect(result).toContain('New versions available for test-pkg');
        expect(result).toContain('a new version has been released');
        expect(result).toContain('**2.1.0**');
    });

    it('formats multiple new versions', () => {
        const newVersions: PackageVersionInfo[] = [
            {
                version: '2.1.0',
                publishDate: '2024-07-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.1.0',
            },
            {
                version: '2.2.0',
                publishDate: '2024-08-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.2.0',
            },
        ];

        const result = buildNewVersionsComment('test-pkg', '2.0.0', newVersions);
        expect(result).toContain('2 new versions have been released');
    });

    it('includes GitHub release links when available', () => {
        const newVersions: PackageVersionInfo[] = [
            {
                version: '2.1.0',
                publishDate: '2024-07-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.1.0',
            },
        ];

        const github: GitHubData = {
            owner: 'example',
            repo: 'test',
            releases: [
                {
                    tagName: 'v2.1.0',
                    name: 'v2.1.0',
                    publishedAt: '2024-07-01',
                    body: '',
                    htmlUrl: 'https://github.com/example/test/releases/tag/v2.1.0',
                },
            ],
        };

        const result = buildNewVersionsComment('test-pkg', '2.0.0', newVersions, github);
        expect(result).toContain('[GitHub Release]');
    });
});
