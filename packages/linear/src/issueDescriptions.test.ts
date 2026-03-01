import { describe, it, expect } from 'vitest';
import type {
    DependencyVersion,
    PackageVersionInfo,
    GitHubData,
    DetailUrlFn,
} from '@dependicus/core';
import { RootFactStore, FactKeys, getDetailFilename } from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
import type { OutdatedPackage, OutdatedGroup } from './types';
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

function makePackage(overrides: Partial<OutdatedPackage> = {}): OutdatedPackage {
    return {
        packageName: 'test-pkg',
        ecosystem: 'npm',
        versions: [makeVersion()],
        worstCompliance: { updateType: 'major', daysOverdue: 30, thresholdDays: 360 },
        teamId: 'team-123',
        policy: { type: 'dueDate' },
        assignment: { type: 'unassigned' },
        ...overrides,
    } as OutdatedPackage;
}

/** Create a FactStore populated with facts for a package. */
function makeStore(
    pkg: OutdatedPackage,
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
    const store = root.scoped(pkg.ecosystem);
    const version = pkg.versions[0]!;
    const vb = opts.versionsBetween ?? defaultVersionsBetween;

    store.setVersionFact(pkg.packageName, version.version, FactKeys.VERSIONS_BETWEEN, vb);
    if (opts.description !== undefined) {
        store.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.DESCRIPTION,
            opts.description,
        );
    } else {
        store.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.DESCRIPTION,
            'A test package',
        );
    }
    if (opts.homepage !== undefined) {
        store.setVersionFact(pkg.packageName, version.version, FactKeys.HOMEPAGE, opts.homepage);
    }
    if (opts.repositoryUrl !== undefined) {
        store.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.REPOSITORY_URL,
            opts.repositoryUrl,
        );
    }
    if (opts.bugsUrl !== undefined) {
        store.setVersionFact(pkg.packageName, version.version, FactKeys.BUGS_URL, opts.bugsUrl);
    }
    if (opts.unpackedSize !== undefined) {
        store.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.UNPACKED_SIZE,
            opts.unpackedSize,
        );
    }
    if (opts.compareUrl !== undefined) {
        store.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.COMPARE_URL,
            opts.compareUrl,
        );
    }
    if (opts.github !== undefined) {
        store.setPackageFact(pkg.packageName, FactKeys.GITHUB_DATA, opts.github);
    }
    if (opts.deprecatedTransitiveDeps !== undefined) {
        store.setPackageFact(
            pkg.packageName,
            FactKeys.DEPRECATED_TRANSITIVE_DEPS,
            opts.deprecatedTransitiveDeps,
        );
    }
    if (opts.isPatched) {
        store.setVersionFact(pkg.packageName, version.version, FactKeys.IS_PATCHED, true);
    }

    // Set URL patterns as package-level fact
    store.setPackageFact(pkg.packageName, FactKeys.URLS, {
        'Dependency Graph': 'https://npmgraph.js.org/?q={name}@{version}',
        Registry: 'https://www.npmjs.com/package/{name}/v/{version}',
    });

    return root;
}

/** Create a store for a group of packages (populates facts for all packages). */
function makeGroupStore(group: OutdatedGroup, descriptions?: Record<string, string>): FactStore {
    const root = new RootFactStore();
    for (const pkg of group.packages) {
        const version = pkg.versions[0];
        if (!version) continue;
        const scoped = root.scoped(pkg.ecosystem);
        scoped.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.VERSIONS_BETWEEN,
            defaultVersionsBetween,
        );
        scoped.setVersionFact(
            pkg.packageName,
            version.version,
            FactKeys.DESCRIPTION,
            descriptions?.[pkg.packageName] ?? 'A test package',
        );
        // Set URL patterns per package
        scoped.setPackageFact(pkg.packageName, FactKeys.URLS, {
            'Dependency Graph': 'https://npmgraph.js.org/?q={name}@{version}',
            Registry: 'https://www.npmjs.com/package/{name}/v/{version}',
        });
    }
    return root;
}

const BASE_URL = 'https://example.com/dependicus';
const testGetDetailUrl: DetailUrlFn = (_ecosystem, packageName, version) => {
    const filename = getDetailFilename(packageName, version);
    return `${BASE_URL}/npm/details/${filename}`;
};

const npmProviderInfo = {
    name: 'pnpm',
    ecosystem: 'npm',
    supportsCatalog: true,
    installCommand: 'pnpm install',
    urlPatterns: {
        'Dependency Graph': 'https://npmgraph.js.org/?q={name}@{version}',
        Registry: 'https://www.npmjs.com/package/{name}/v/{version}',
    },
};

const npmProviderInfoMap = new Map([['npm', npmProviderInfo]]);

describe('buildIssueDescription', () => {
    it('includes package description as blockquote', () => {
        const pkg = makePackage();
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('> A test package');
    });

    it('omits blockquote when no description', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, { description: undefined });
        // Need to clear the description fact (through scoped store, since that's where it was written)
        store
            .scoped(pkg.ecosystem)
            .setVersionFact(
                pkg.packageName,
                '1.0.0',
                FactKeys.DESCRIPTION,
                undefined as unknown as string,
            );
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).not.toContain('> ');
    });

    it('includes summary with version info', () => {
        const pkg = makePackage();
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
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
        expect(result).toContain('**Versions behind:** 2');
        expect(result).toContain('**Dependency types:** prod');
        expect(result).toContain('**In catalog:** Yes');
    });

    it('hides latest version when target equals latest', () => {
        const pkg = makePackage();
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '2.0.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).not.toContain('**Latest version:**');
    });

    it('shows multi-version info', () => {
        const pkg = makePackage({
            versions: [
                makeVersion({ version: '1.0.0', usedBy: ['@app/web'] }),
                makeVersion({ version: '0.9.0', usedBy: ['@app/desktop'] }),
            ],
        });
        const store = makeStore(pkg);
        // Also populate facts for the second version
        store.setVersionFact(
            pkg.packageName,
            '0.9.0',
            FactKeys.VERSIONS_BETWEEN,
            defaultVersionsBetween,
        );
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('**Current versions in monorepo:**');
        expect(result).toContain('`1.0.0`');
        expect(result).toContain('`0.9.0`');
    });

    it('shows display label', () => {
        const pkg = makePackage({ ownerLabel: 'Web App (Frontend)' });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('- Web App (Frontend)');
    });

    it('shows catalog How to Update', () => {
        const pkg = makePackage();
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('managed in the pnpm catalog');
        expect(result).toContain('  test-pkg: "2.0.0"');
    });

    it('shows non-catalog How to Update for single consumer', () => {
        const pkg = makePackage({
            versions: [makeVersion({ inCatalog: false, usedBy: ['@app/web'] })],
        });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('NOT in the catalog');
        expect(result).toContain('`@app/web`');
    });

    it('recommends catalog when multiple consumers', () => {
        const pkg = makePackage({
            versions: [
                makeVersion({
                    inCatalog: false,
                    usedBy: ['@app/web', '@app/desktop'],
                }),
            ],
        });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('used by 2 packages');
        expect(result).toContain('Consider adding it to the catalog');
    });

    it('includes patch warning when patched', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, { isPatched: true });
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('Patch Applied');
    });

    it('renders consumer-provided description sections', () => {
        const pkg = makePackage({
            descriptionSections: [{ title: 'Policy Info', body: 'Must comply within 90 days.' }],
        });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('## Policy Info');
        expect(result).toContain('Must comply within 90 days.');
    });

    it('includes major version available note', () => {
        const pkg = makePackage({ availableMajorVersion: '3.0.0' });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('Major Version Available');
        expect(result).toContain('`3.0.0`');
    });

    it('includes upgrade path with version list', () => {
        const pkg = makePackage();
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('## Upgrade Path');
        expect(result).toContain('**2.0.0** (latest)');
        expect(result).toContain('1.1.0');
        expect(result).toContain('[Registry]');
    });

    it('includes links section', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, {
            description: 'Test',
            homepage: 'https://example.com',
            repositoryUrl: 'https://github.com/example/test',
            bugsUrl: 'https://github.com/example/test/issues',
            github: {
                owner: 'example',
                repo: 'test',
                changelogUrl: 'https://github.com/example/test/blob/main/CHANGELOG.md',
                releases: [],
            },
        });
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('[Dependicus Detail Page]');
        expect(result).toContain('[Registry]');
        expect(result).toContain('[Dependency Graph]');
        expect(result).toContain('[Homepage](https://example.com)');
        expect(result).toContain('[Repository](https://github.com/example/test)');
        expect(result).toContain('[CHANGELOG]');
        expect(result).toContain('[Issues]');
    });

    it('includes deprecated transitive deps warning', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, { deprecatedTransitiveDeps: ['old-dep', 'ancient-lib'] });
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('Deprecated Transitive Dependencies');
        expect(result).toContain('`old-dep`');
        expect(result).toContain('`ancient-lib`');
    });

    it('includes AI agent instructions and footer', () => {
        const pkg = makePackage();
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('PR title should be');
        expect(result).toContain('automatically created by Dependicus');
    });

    it('handles scoped package names in detail URL', () => {
        const pkg = makePackage({ packageName: '@scope/my-pkg' });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        // Scoped names should have @ removed and / replaced with -
        expect(result).toContain('scope-my-pkg@1.0.0.html');
    });

    it('shows overflow when more than 15 versions', () => {
        const manyVersions: PackageVersionInfo[] = Array.from({ length: 20 }, (_, i) => ({
            version: `1.${i + 1}.0`,
            publishDate:
                i < 12
                    ? `2024-${String(i + 1).padStart(2, '0')}-01`
                    : `2025-${String(i - 11).padStart(2, '0')}-01`,
            isPrerelease: false,
            registryUrl: `https://www.npmjs.com/package/test-pkg/v/1.${i + 1}.0`,
        }));

        const pkg = makePackage();
        const store = makeStore(pkg, { versionsBetween: manyVersions });
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '1.20.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('... and 5 more versions');
    });

    it('shows overflow when more than 20 usedBy packages', () => {
        const manyUsedBy = Array.from({ length: 25 }, (_, i) => `@app/pkg-${i}`);
        const pkg = makePackage({
            versions: [makeVersion({ inCatalog: false, usedBy: manyUsedBy })],
        });
        const store = makeStore(pkg);
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('... and 5 more');
    });

    it('includes compareUrl in upgrade path when available', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, {
            compareUrl: 'https://github.com/example/test/compare/v1.0.0...v2.0.0',
        });
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('[View full diff on GitHub]');
        expect(result).toContain('compare/v1.0.0...v2.0.0');
    });

    it('handles empty versionsBetween', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, { versionsBetween: [] });
        const result = buildIssueDescription(
            pkg,
            store,
            '2.0.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).not.toContain('## Upgrade Path');
    });

    it('includes GitHub release links in upgrade path when available', () => {
        const pkg = makePackage();
        const store = makeStore(pkg, {
            github: {
                owner: 'example',
                repo: 'test',
                releases: [
                    {
                        tagName: 'v2.0.0',
                        name: 'v2.0.0',
                        publishedAt: '2024-06-01',
                        body: '',
                        htmlUrl: 'https://github.com/example/test/releases/tag/v2.0.0',
                    },
                ],
            },
        });
        const result = buildIssueDescription(
            pkg,
            store,
            '1.1.0',
            '2.0.0',
            testGetDetailUrl,
            npmProviderInfo,
        );
        expect(result).toContain('[GitHub Release]');
    });
});

describe('buildGroupIssueDescription', () => {
    it('includes group intro and summary', () => {
        const group: OutdatedGroup = {
            groupName: 'react-group',
            packages: [
                makePackage({ packageName: 'react' }),
                makePackage({ packageName: 'react-dom' }),
            ],
            teamId: 'team-123',
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
        expect(result).toContain('**react-group** package group');
        expect(result).toContain('**Group:** react-group');
        expect(result).toContain('**Packages:** 2');
        expect(result).not.toContain('**Team:**');
        expect(result).toContain('**Worst update type:** major');
        expect(result).toContain('**Days overdue:** 10');
    });

    it('shows notifications-only for awareness groups', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            packages: [makePackage()],
            teamId: 'team-123',
            policy: { type: 'fyi' },
            worstCompliance: {
                updateType: 'minor',
                daysOverdue: 0,
                thresholdDays: undefined,
            },
        };

        const store = makeGroupStore(group);
        const result = buildGroupIssueDescription(
            group,
            store,
            testGetDetailUrl,
            npmProviderInfoMap,
        );
        expect(result).toContain('Tracked for awareness only');
        expect(result).not.toContain('Worst update type');
    });

    it('lists all packages with details', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            packages: [
                makePackage({ packageName: '@scope/pkg-a' }),
                makePackage({ packageName: 'pkg-b' }),
            ],
            teamId: 'team-123',
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
        expect(result).toContain('### @scope/pkg-a');
        expect(result).toContain('### pkg-b');
        expect(result).toContain('[Dependicus Detail]');
    });

    it('includes catalog yaml in How to Update', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            packages: [makePackage({ packageName: 'react' })],
            teamId: 'team-123',
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
        expect(result).toContain('catalog:');
        expect(result).toContain('react: "2.0.0"');
    });

    it('includes AI agent instructions and footer', () => {
        const group: OutdatedGroup = {
            groupName: 'test-group',
            packages: [makePackage()],
            teamId: 'team-123',
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
        expect(result).toContain('PR title should be');
        expect(result).toContain('automatically created by Dependicus');
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
        expect(result).toContain('2024-07-01');
        expect(result).toContain('[Registry]');
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
        expect(result).toContain('**2.2.0**');
        expect(result).toContain('**2.1.0**');
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

    it('works without github data', () => {
        const newVersions: PackageVersionInfo[] = [
            {
                version: '2.1.0',
                publishDate: '2024-07-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.1.0',
            },
        ];

        const result = buildNewVersionsComment('test-pkg', '2.0.0', newVersions);
        expect(result).not.toContain('GitHub Release');
        expect(result).toContain('[Registry]');
    });
});
