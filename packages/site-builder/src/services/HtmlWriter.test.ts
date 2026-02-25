import { describe, it, expect } from 'vitest';
import type { DirectDependency, DependencyVersion, GroupingConfig } from '@dependicus/core';
import { FactStore, FactKeys } from '@dependicus/core';
import { HtmlWriter } from './HtmlWriter';

function makeMockVersion(overrides?: Partial<DependencyVersion>): DependencyVersion {
    return {
        version: '1.0.0',
        latestVersion: '2.0.0',
        usedBy: ['@app/web', '@app/api'],
        dependencyTypes: ['prod'],
        publishDate: '2024-01-15T00:00:00.000Z',
        inCatalog: true,
        ...overrides,
    };
}

function makeMockDependency(overrides?: Partial<DirectDependency>): DirectDependency {
    return {
        packageName: '@scope/test-pkg',
        versions: [makeMockVersion()],
        ...overrides,
    };
}

/**
 * Create a FactStore populated with facts matching the old EnrichedDependency shape.
 */
function makeMockStore(deps?: DirectDependency[]): FactStore {
    const store = new FactStore();
    const allDeps = deps ?? [makeMockDependency()];

    for (const dep of allDeps) {
        // Package-level facts
        store.setPackageFact(dep.packageName, FactKeys.GITHUB_DATA, {
            owner: 'test',
            repo: 'test-pkg',
            releases: [
                {
                    tagName: 'v2.0.0',
                    name: 'v2.0.0',
                    publishedAt: '2024-06-01',
                    body: '## Breaking Changes\n- Changed API',
                    htmlUrl: 'https://github.com/test/test-pkg/releases/tag/v2.0.0',
                },
            ],
            changelogUrl: 'https://github.com/test/test-pkg/blob/main/CHANGELOG.md',
        });
        store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);
        store.setPackageFact(dep.packageName, 'testMeta', {
            surfaceId: 'test-surface',
            teamName: 'TestTeam',
        });

        for (const ver of dep.versions) {
            // Version-level facts
            store.setVersionFact(
                dep.packageName,
                ver.version,
                FactKeys.DESCRIPTION,
                'A test package',
            );
            store.setVersionFact(
                dep.packageName,
                ver.version,
                FactKeys.HOMEPAGE,
                'https://example.com',
            );
            store.setVersionFact(
                dep.packageName,
                ver.version,
                FactKeys.REPOSITORY_URL,
                'https://github.com/test/test-pkg',
            );
            store.setVersionFact(
                dep.packageName,
                ver.version,
                FactKeys.BUGS_URL,
                'https://github.com/test/test-pkg/issues',
            );
            store.setVersionFact(dep.packageName, ver.version, FactKeys.VERSIONS_BETWEEN, [
                {
                    version: '1.1.0',
                    publishDate: '2024-03-01T00:00:00.000Z',
                    isPrerelease: false,
                    npmUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/1.1.0',
                },
                {
                    version: '2.0.0',
                    publishDate: '2024-06-01T00:00:00.000Z',
                    isPrerelease: false,
                    npmUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/2.0.0',
                },
            ]);
            store.setVersionFact(
                dep.packageName,
                ver.version,
                FactKeys.COMPARE_URL,
                'https://github.com/test/test-pkg/compare/v1.0.0...v2.0.0',
            );
        }
    }

    return store;
}

describe('HtmlWriter', () => {
    describe('getDetailFilename', () => {
        it('generates safe filename for scoped packages', () => {
            expect(HtmlWriter.getDetailFilename('@scope/pkg', '1.0.0')).toBe(
                'scope-pkg@1.0.0.html',
            );
        });

        it('generates safe filename for unscoped packages', () => {
            expect(HtmlWriter.getDetailFilename('lodash', '4.17.21')).toBe(
                'lodash@4.17.21.html',
            );
        });
    });

    describe('toHtml', () => {
        it('generates HTML with dependency data', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            // Check that the output is valid HTML with expected structure
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Dependicus - Dependency Report');
            expect(html).toContain('@scope/test-pkg');
            expect(html).toContain('1.0.0');
            expect(html).toContain('2.0.0');
        });

        it('includes Tabulator script tags', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            expect(html).toContain('tabulator-tables');
            expect(html).toContain('window.dependicusData');
        });

        it('includes tab structure', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            expect(html).toContain('data-sheet="all"');
            expect(html).toContain('Multiple Versions');
            expect(html).toContain('Catalog');
        });

        it('generates multi-version rows for packages with multiple versions', () => {
            const dep = makeMockDependency({
                versions: [
                    makeMockVersion({
                        version: '1.0.0',
                        usedBy: ['@app/web'],
                        inCatalog: false,
                    }),
                    makeMockVersion({
                        version: '1.5.0',
                        usedBy: ['@app/api'],
                        dependencyTypes: ['dev'],
                        publishDate: '2024-03-01T00:00:00.000Z',
                        inCatalog: false,
                    }),
                ],
            });
            const store = new FactStore();
            // Set minimal facts for both versions
            for (const ver of dep.versions) {
                store.setVersionFact(
                    dep.packageName,
                    ver.version,
                    FactKeys.VERSIONS_BETWEEN,
                    [],
                );
            }
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const html = writer.toHtml([dep], store);

            // Multi-version tab should have count > 0
            expect(html).toContain('multiVersionData');
        });
    });

    describe('toDetailPages', () => {
        it('generates detail pages for each version', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([dep], store);

            expect(pages).toHaveLength(1);
            expect(pages[0]!.filename).toBe('scope-test-pkg@1.0.0.html');
            expect(pages[0]!.html).toContain('@scope/test-pkg@1.0.0');
        });

        it('includes package metadata in detail page', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('A test package');
            expect(html).toContain('https://example.com');
            expect(html).toContain('https://github.com/test/test-pkg');
        });

        it('includes upgrade path section', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('Upgrade Path');
            expect(html).toContain('Version History');
        });

        it('includes used-by section', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('Used By <span class="dep-count-badge">2</span>');
            expect(html).toContain('@app/web');
            expect(html).toContain('@app/api');
        });

        it('shows custom metadata on detail page when columns are configured', () => {
            const writer = new HtmlWriter({
                columns: [
                    {
                        key: 'surface',
                        header: 'Surface',
                        getValue: (pkg, _ver, s) => {
                            const meta = s.getPackageFact<{ surfaceId: string }>(
                                pkg,
                                'testMeta',
                            );
                            return meta?.surfaceId ?? '';
                        },
                    },
                    {
                        key: 'team',
                        header: 'Team',
                        getValue: (pkg, _ver, s) => {
                            const meta = s.getPackageFact<{ teamName: string }>(
                                pkg,
                                'testMeta',
                            );
                            return meta?.teamName ?? '';
                        },
                    },
                ],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('Surface');
            expect(html).toContain('test-surface');
            expect(html).toContain('Team');
            expect(html).toContain('TestTeam');
        });

        it('shows no custom metadata when meta is not in store', () => {
            const writer = new HtmlWriter({
                columns: [
                    {
                        key: 'surface',
                        header: 'Surface',
                        getValue: (pkg, _ver, s) => {
                            const meta = s.getPackageFact<{ surfaceId: string }>(
                                pkg,
                                'testMeta',
                            );
                            return meta?.surfaceId ?? '';
                        },
                    },
                ],
            });
            const dep = makeMockDependency();
            // Store without META fact
            const store = new FactStore();
            store.setVersionFact(dep.packageName, '1.0.0', FactKeys.VERSIONS_BETWEEN, []);
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            // Should not contain the custom metadata section label inline with value
            expect(html).not.toContain('Surface');
        });
    });

    describe('grouping pages', () => {
        const teamGrouping: GroupingConfig = {
            key: 'team',
            label: 'Teams',
            slugPrefix: 'teams',
            getValue: (packageName: string, store: FactStore) => {
                const meta = store.getPackageFact<{ teamName: string }>(
                    packageName,
                    'testMeta',
                );
                return meta?.teamName ?? 'Unknown';
            },
        };

        it('toAllGroupingPages returns empty array when no groupings configured', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([dep], store);
            expect(pages).toHaveLength(0);
        });

        it('toGroupingPages generates index and detail pages', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const { index, details } = writer.toGroupingPages([dep], teamGrouping, store);

            expect(index.filename).toBe('teams/index.html');
            expect(index.html).toContain('Teams');
            expect(index.html).toContain('TestTeam');

            expect(details).toHaveLength(1);
            expect(details[0]!.filename).toBe('teams/TestTeam.html');
            expect(details[0]!.html).toContain('Teams: TestTeam');
            expect(details[0]!.html).toContain('@scope/test-pkg');
        });

        it('toAllGroupingPages generates pages for all groupings', () => {
            const surfaceGrouping: GroupingConfig = {
                key: 'surface',
                label: 'Surfaces',
                slugPrefix: 'surfaces',
                getValue: (packageName: string, factStore: FactStore) => {
                    const meta = factStore.getPackageFact<{ surfaceId: string }>(
                        packageName,
                        'testMeta',
                    );
                    return meta?.surfaceId ?? 'Unknown';
                },
            };

            const writer = new HtmlWriter({
                groupings: [teamGrouping, surfaceGrouping],
            });

            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([dep], store);
            // 1 team index + 1 team detail + 1 surface index + 1 surface detail = 4
            expect(pages).toHaveLength(4);

            const filenames = pages.map((p) => p.filename);
            expect(filenames).toContain('teams/index.html');
            expect(filenames).toContain('teams/TestTeam.html');
            expect(filenames).toContain('surfaces/index.html');
            expect(filenames).toContain('surfaces/test-surface.html');
        });

        it('groups multiple deps under the same grouping value', () => {
            const dep1 = makeMockDependency({ packageName: 'pkg-a' });
            const dep2 = makeMockDependency({ packageName: 'pkg-b' });
            const store = makeMockStore([dep1, dep2]);

            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const { details } = writer.toGroupingPages([dep1, dep2], teamGrouping, store);

            expect(details).toHaveLength(1);
            expect(details[0]!.html).toContain('pkg-a');
            expect(details[0]!.html).toContain('pkg-b');
        });

        it('skips deps without matching grouping value', () => {
            const partialGrouping: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                getValue: (packageName: string) => {
                    return packageName === 'with-team' ? 'TeamA' : undefined;
                },
            };

            const dep1 = makeMockDependency({ packageName: 'with-team' });
            const dep2 = makeMockDependency({ packageName: 'no-team' });
            const store = makeMockStore([dep1, dep2]);

            const writer = new HtmlWriter({
                groupings: [partialGrouping],
            });
            const { details } = writer.toGroupingPages([dep1, dep2], partialGrouping, store);

            expect(details).toHaveLength(1);
            expect(details[0]!.html).toContain('with-team');
            expect(details[0]!.html).not.toContain('no-team');
        });

        it('uses key as slug when slugPrefix is not set', () => {
            const grouping: GroupingConfig = {
                key: 'env',
                label: 'Environments',
                getValue: () => 'production',
            };

            const writer = new HtmlWriter({
                groupings: [grouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([dep], store);

            const filenames = pages.map((p) => p.filename);
            expect(filenames).toContain('env/index.html');
            expect(filenames).toContain('env/production.html');
        });

        it('includes nav links for configured groupings', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            expect(html).toContain('teams/index.html');
            expect(html).toContain('Teams');
        });

        it('detail pages include nav links for configured groupings', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([dep], store);

            expect(pages[0]!.html).toContain('teams/index.html');
            expect(pages[0]!.html).toContain('Teams');
        });

        it('grouping detail page shows sections from getSections', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
                getSections: () => [
                    {
                        title: 'Compliance',
                        stats: [
                            { label: 'Compliant', value: 0 },
                            { label: 'Out of Compliance', value: 1 },
                        ],
                    },
                ],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const { details } = writer.toGroupingPages([dep], teamGrouping, store);

            expect(details[0]!.html).toContain('Compliance');
            expect(details[0]!.html).toContain('Out of Compliance');
        });

        it('grouping index shows outdated count', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const { index } = writer.toGroupingPages([dep], teamGrouping, store);

            // The dep is outdated (1.0.0 vs 2.0.0)
            expect(index.html).toContain('outdated');
        });
    });

    describe('edge cases', () => {
        it('handles empty dependencies array', () => {
            const writer = new HtmlWriter();
            const store = new FactStore();
            const html = writer.toHtml([], store);
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Dependicus - Dependency Report');
        });

        it('handles dependencies with empty versions array', () => {
            const writer = new HtmlWriter();
            const dep: DirectDependency = {
                packageName: 'empty-pkg',
                versions: [],
            };
            const store = new FactStore();
            const html = writer.toHtml([dep], store);
            expect(html).toContain('<!DOCTYPE html>');
        });

        it('generates no detail pages for empty dependencies', () => {
            const writer = new HtmlWriter();
            const store = new FactStore();
            const pages = writer.toDetailPages([], store);
            expect(pages).toHaveLength(0);
        });

        it('handles detail page with deprecated transitive deps', () => {
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, [
                'old-dep@1.0.0',
                '@scope/legacy@2.0.0',
            ]);

            const writer = new HtmlWriter();
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('Deprecated Transitive Dependencies');
            expect(html).toContain('old-dep@1.0.0');
            expect(html).toContain('@scope/legacy@2.0.0');
        });

        it('handles detail page without deprecated transitive deps', () => {
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            // Default store already has empty deprecated transitive deps

            const writer = new HtmlWriter();
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).not.toContain('Deprecated Transitive Dependencies');
        });

        it('handles detail page when version is up to date', () => {
            const dep = makeMockDependency({
                versions: [
                    makeMockVersion({
                        version: '2.0.0',
                        latestVersion: '2.0.0',
                    }),
                ],
            });
            const store = new FactStore();
            store.setVersionFact(dep.packageName, '2.0.0', FactKeys.VERSIONS_BETWEEN, []);
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('up to date');
            expect(html).not.toContain('Upgrade Path');
        });

        it('includes size column in detail page upgrade path', () => {
            const dep = makeMockDependency();
            const store = new FactStore();
            store.setVersionFact(dep.packageName, '1.0.0', FactKeys.UNPACKED_SIZE, 50_000);
            store.setVersionFact(dep.packageName, '1.0.0', FactKeys.VERSIONS_BETWEEN, [
                {
                    version: '1.1.0',
                    publishDate: '2024-03-01T00:00:00.000Z',
                    isPrerelease: false,
                    npmUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/1.1.0',
                    unpackedSize: 75_000,
                },
                {
                    version: '2.0.0',
                    publishDate: '2024-06-01T00:00:00.000Z',
                    isPrerelease: false,
                    npmUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/2.0.0',
                    unpackedSize: 100_000,
                },
            ]);
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const pages = writer.toDetailPages([dep], store);
            const html = pages[0]!.html;

            // Size column header should be present
            expect(html).toContain('>Size</div>');
            // Formatted sizes should appear
            expect(html).toContain('75.0 kB');
            expect(html).toContain('100.0 kB');
            // Size change percentages should appear
            expect(html).toContain('+50%');
            expect(html).toContain('+100%');
            // Installed size should appear in sidebar
            expect(html).toContain('Installed Size');
            expect(html).toContain('50.0 kB');
        });

        it('handles detail page without github data', () => {
            const dep = makeMockDependency();
            const store = new FactStore();
            // No GITHUB_DATA fact set
            store.setVersionFact(dep.packageName, '1.0.0', FactKeys.VERSIONS_BETWEEN, []);
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const pages = writer.toDetailPages([dep], store);

            const html = pages[0]!.html;
            expect(html).toContain('@scope/test-pkg@1.0.0');
            expect(html).not.toContain('CHANGELOG');
        });

        it('toHtml includes custom column data in JSON', () => {
            const writer = new HtmlWriter({
                columns: [
                    {
                        key: 'surface',
                        header: 'Surface',
                        getValue: (pkg, _ver, s) => {
                            const meta = s.getPackageFact<{ surfaceId: string }>(
                                pkg,
                                'testMeta',
                            );
                            return meta?.surfaceId ?? '';
                        },
                    },
                ],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            // The custom column data should be in the allData JSON
            expect(html).toContain('"surface"');
            expect(html).toContain('test-surface');
            expect(html).toContain('customColumns');
        });

        it('toHtml includes standard notes in filter even when absent from data', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            // Store without any boolean note facts
            const store = new FactStore();
            store.setVersionFact(dep.packageName, '1.0.0', FactKeys.VERSIONS_BETWEEN, []);
            store.setPackageFact(dep.packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const html = writer.toHtml([dep], store);

            // Standard notes should still appear in uniqueNotes for filter dropdown
            expect(html).toContain('Patched');
            expect(html).toContain('Forked');
            expect(html).toContain('Catalog Mismatch');
        });

        it('toHtml works without getSections configured', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            // Should not throw
            const html = writer.toHtml([dep], store);
            expect(html).toContain('<!DOCTYPE html>');
        });

        it('groupPackagesByMeta returns null when no getUsedByGroupKey', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            // Without getUsedByGroupKey, Used By Grouped should be null in the JSON data
            expect(html).toContain('"Used By Grouped": null');
        });

        it('groupPackagesByMeta uses custom group key', () => {
            const writer = new HtmlWriter({
                getUsedByGroupKey: (pkg, _ver, s) => {
                    const meta = s.getPackageFact<{ teamName: string }>(pkg, 'testMeta');
                    return meta?.teamName ?? 'Unknown';
                },
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = writer.toHtml([dep], store);

            expect(html).toContain('TestTeam');
        });
    });
});
