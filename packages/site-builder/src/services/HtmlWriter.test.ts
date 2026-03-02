import { describe, it, expect } from 'vitest';
import type {
    DirectDependency,
    DependencyVersion,
    GroupingConfig,
    ProviderOutput,
} from '@dependicus/core';
import { RootFactStore, FactKeys, getDetailFilename } from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
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
        name: '@scope/test-pkg',
        ecosystem: 'npm',
        versions: [makeMockVersion()],
        ...overrides,
    };
}

function makeProvider(
    deps: DirectDependency[],
    overrides?: Partial<ProviderOutput>,
): ProviderOutput {
    return {
        name: 'pnpm',
        ecosystem: 'npm',
        supportsCatalog: true,
        installCommand: 'pnpm install',
        urlPatterns: {
            'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
            Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
        },
        dependencies: deps,
        ...overrides,
    };
}

/**
 * Create a FactStore populated with facts matching the old EnrichedDependency shape.
 */
function makeMockStore(deps?: DirectDependency[]): FactStore {
    const store = new RootFactStore();
    const allDeps = deps ?? [makeMockDependency()];

    for (const dep of allDeps) {
        const scoped = store.scoped(dep.ecosystem);
        // Dependency-level facts
        scoped.setDependencyFact(dep.name, FactKeys.GITHUB_DATA, {
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
        scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);
        scoped.setDependencyFact(dep.name, FactKeys.URLS, {
            'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
            Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
        });
        scoped.setDependencyFact(dep.name, 'testMeta', {
            surfaceId: 'test-surface',
            teamName: 'TestTeam',
        });

        for (const ver of dep.versions) {
            // Version-level facts
            scoped.setVersionFact(dep.name, ver.version, FactKeys.DESCRIPTION, 'A test package');
            scoped.setVersionFact(dep.name, ver.version, FactKeys.HOMEPAGE, 'https://example.com');
            scoped.setVersionFact(
                dep.name,
                ver.version,
                FactKeys.REPOSITORY_URL,
                'https://github.com/test/test-pkg',
            );
            scoped.setVersionFact(
                dep.name,
                ver.version,
                FactKeys.BUGS_URL,
                'https://github.com/test/test-pkg/issues',
            );
            scoped.setVersionFact(dep.name, ver.version, FactKeys.VERSIONS_BETWEEN, [
                {
                    version: '1.1.0',
                    publishDate: '2024-03-01T00:00:00.000Z',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/1.1.0',
                },
                {
                    version: '2.0.0',
                    publishDate: '2024-06-01T00:00:00.000Z',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/2.0.0',
                },
            ]);
            scoped.setVersionFact(
                dep.name,
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
            expect(getDetailFilename('@scope/pkg', '1.0.0')).toBe('scope-pkg@1.0.0.html');
        });

        it('generates safe filename for unscoped packages', () => {
            expect(getDetailFilename('lodash', '4.17.21')).toBe('lodash@4.17.21.html');
        });
    });

    describe('toHtml', () => {
        it('generates HTML with dependency data', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            // Check that the output is valid HTML with expected structure
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Dependicus - Dependency Report');
            expect(html).toContain('@scope/test-pkg');
            expect(html).toContain('1.0.0');
            expect(html).toContain('2.0.0');
        });

        it('includes Tabulator script tags', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('tabulator-tables');
            expect(html).toContain('window.dependicusData');
        });

        it('includes tab structure', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('data-tab="pnpm"');
            expect(html).toContain('pnpm duplicates');
        });

        it('generates multi-version rows for packages with multiple versions', async () => {
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
            const store = new RootFactStore();
            const scoped = store.scoped(dep.ecosystem);
            // Set minimal facts for both versions
            for (const ver of dep.versions) {
                scoped.setVersionFact(dep.name, ver.version, FactKeys.VERSIONS_BETWEEN, []);
            }
            scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            // Duplicates tab should have data (multi-version dep goes in the duplicates tab)
            expect(html).toContain('"tabs"');
            expect(html).toContain('pnpm duplicates');
        });
    });

    describe('toDetailPages', () => {
        it('generates detail pages for each version', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

            expect(pages).toHaveLength(1);
            expect(pages[0]!.filename).toBe('pnpm/details/scope-test-pkg@1.0.0.html');
            expect(pages[0]!.html).toContain('@scope/test-pkg@1.0.0');
        });

        it('includes package metadata in detail page', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

            const html = pages[0]!.html;
            expect(html).toContain('A test package');
            expect(html).toContain('https://example.com');
            expect(html).toContain('https://github.com/test/test-pkg');
        });

        it('includes upgrade path section', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

            const html = pages[0]!.html;
            expect(html).toContain('Upgrade Path');
            expect(html).toContain('Version History');
        });

        it('includes used-by section', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

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
                            const meta = s.getDependencyFact<{ surfaceId: string }>(
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
                            const meta = s.getDependencyFact<{ teamName: string }>(pkg, 'testMeta');
                            return meta?.teamName ?? '';
                        },
                    },
                ],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

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
                            const meta = s.getDependencyFact<{ surfaceId: string }>(
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
            const store = new RootFactStore();
            const scoped = store.scoped(dep.ecosystem);
            scoped.setVersionFact(dep.name, '1.0.0', FactKeys.VERSIONS_BETWEEN, []);
            scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

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
            getValue: (name: string, store: FactStore) => {
                const meta = store.getDependencyFact<{ teamName: string }>(name, 'testMeta');
                return meta?.teamName ?? 'Unknown';
            },
        };

        it('toAllGroupingPages returns empty array when no groupings configured', () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toAllGroupingPages(providers, store);
            expect(pages).toHaveLength(0);
        });

        it('toGroupingPages generates index and detail pages', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const { index, details } = writer.toGroupingPages(
                [dep],
                teamGrouping,
                store.scoped(dep.ecosystem),
                'pnpm/',
            );

            expect(index.filename).toBe('pnpm/teams/index.html');
            expect(index.html).toContain('Teams');
            expect(index.html).toContain('TestTeam');

            expect(details).toHaveLength(1);
            expect(details[0]!.filename).toBe('pnpm/teams/TestTeam.html');
            expect(details[0]!.html).toContain('Teams: TestTeam');
            expect(details[0]!.html).toContain('@scope/test-pkg');
        });

        it('toAllGroupingPages generates pages for all groupings', () => {
            const surfaceGrouping: GroupingConfig = {
                key: 'surface',
                label: 'Surfaces',
                slugPrefix: 'surfaces',
                getValue: (name: string, factStore: FactStore) => {
                    const meta = factStore.getDependencyFact<{ surfaceId: string }>(
                        name,
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
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toAllGroupingPages(providers, store);
            // 1 team index + 1 team detail + 1 surface index + 1 surface detail = 4
            expect(pages).toHaveLength(4);

            const filenames = pages.map((p) => p.filename);
            expect(filenames).toContain('pnpm/teams/index.html');
            expect(filenames).toContain('pnpm/teams/TestTeam.html');
            expect(filenames).toContain('pnpm/surfaces/index.html');
            expect(filenames).toContain('pnpm/surfaces/test-surface.html');
        });

        it('groups multiple deps under the same grouping value', () => {
            const dep1 = makeMockDependency({ name: 'pkg-a' });
            const dep2 = makeMockDependency({ name: 'pkg-b' });
            const store = makeMockStore([dep1, dep2]);

            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const { details } = writer.toGroupingPages(
                [dep1, dep2],
                teamGrouping,
                store.scoped('npm'),
                'pnpm/',
            );

            expect(details).toHaveLength(1);
            expect(details[0]!.html).toContain('pkg-a');
            expect(details[0]!.html).toContain('pkg-b');
        });

        it('skips deps without matching grouping value', () => {
            const partialGrouping: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                getValue: (name: string) => {
                    return name === 'with-team' ? 'TeamA' : undefined;
                },
            };

            const dep1 = makeMockDependency({ name: 'with-team' });
            const dep2 = makeMockDependency({ name: 'no-team' });
            const store = makeMockStore([dep1, dep2]);

            const writer = new HtmlWriter({
                groupings: [partialGrouping],
            });
            const { details } = writer.toGroupingPages(
                [dep1, dep2],
                partialGrouping,
                store.scoped('npm'),
                'pnpm/',
            );

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
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toAllGroupingPages(providers, store);

            const filenames = pages.map((p) => p.filename);
            expect(filenames).toContain('pnpm/env/index.html');
            expect(filenames).toContain('pnpm/env/production.html');
        });

        it('includes nav links for configured groupings', async () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('teams/index.html');
            expect(html).toContain('Teams');
        });

        it('detail pages include nav links for configured groupings', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

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
            const { details } = writer.toGroupingPages(
                [dep],
                teamGrouping,
                store.scoped(dep.ecosystem),
                'pnpm/',
            );

            expect(details[0]!.html).toContain('Compliance');
            expect(details[0]!.html).toContain('Out of Compliance');
        });

        it('grouping index shows outdated count', () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const { index } = writer.toGroupingPages(
                [dep],
                teamGrouping,
                store.scoped(dep.ecosystem),
                'pnpm/',
            );

            // The dep is outdated (1.0.0 vs 2.0.0)
            expect(index.html).toContain('outdated');
        });
    });

    describe('supportsCatalog in provider', () => {
        it('includes supportsCatalog: true in tabs JSON when provider supports catalog', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency({
                versions: [makeMockVersion({ inCatalog: false })],
            });
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep], { supportsCatalog: true })];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('"supportsCatalog":true');
        });

        it('includes supportsCatalog: false in tabs JSON when provider does not support catalog', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency({
                versions: [makeMockVersion({ inCatalog: true })],
            });
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep], { supportsCatalog: false })];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('"supportsCatalog":false');
        });

        it('defaults supportsCatalog based on provider when not explicitly set', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency({
                versions: [makeMockVersion({ inCatalog: true })],
            });
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep], { supportsCatalog: false })];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('"supportsCatalog":false');
        });
    });

    describe('edge cases', () => {
        it('handles empty providers array', async () => {
            const writer = new HtmlWriter();
            const store = new RootFactStore();
            const html = await writer.toHtml([], store);
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Dependicus - Dependency Report');
        });

        it('handles provider with empty dependencies array', async () => {
            const writer = new HtmlWriter();
            const providers: ProviderOutput[] = [makeProvider([])];
            const store = new RootFactStore();
            const html = await writer.toHtml(providers, store);
            expect(html).toContain('<!DOCTYPE html>');
        });

        it('handles dependencies with empty versions array', async () => {
            const writer = new HtmlWriter();
            const dep: DirectDependency = {
                name: 'empty-pkg',
                ecosystem: 'npm',
                versions: [],
            };
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const store = new RootFactStore();
            const html = await writer.toHtml(providers, store);
            expect(html).toContain('<!DOCTYPE html>');
        });

        it('generates no detail pages for empty providers', () => {
            const writer = new HtmlWriter();
            const store = new RootFactStore();
            const pages = writer.toDetailPages([], store);
            expect(pages).toHaveLength(0);
        });

        it('handles detail page with deprecated transitive deps', () => {
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            store
                .scoped(dep.ecosystem)
                .setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, [
                    'old-dep@1.0.0',
                    '@scope/legacy@2.0.0',
                ]);

            const writer = new HtmlWriter();
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

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
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

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
            const store = new RootFactStore();
            const scoped = store.scoped(dep.ecosystem);
            scoped.setVersionFact(dep.name, '2.0.0', FactKeys.VERSIONS_BETWEEN, []);
            scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

            const html = pages[0]!.html;
            expect(html).toContain('up to date');
            expect(html).not.toContain('Upgrade Path');
        });

        it('includes size column in detail page upgrade path', () => {
            const dep = makeMockDependency();
            const store = new RootFactStore();
            const scoped = store.scoped(dep.ecosystem);
            scoped.setVersionFact(dep.name, '1.0.0', FactKeys.UNPACKED_SIZE, 50_000);
            scoped.setVersionFact(dep.name, '1.0.0', FactKeys.VERSIONS_BETWEEN, [
                {
                    version: '1.1.0',
                    publishDate: '2024-03-01T00:00:00.000Z',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/1.1.0',
                    unpackedSize: 75_000,
                },
                {
                    version: '2.0.0',
                    publishDate: '2024-06-01T00:00:00.000Z',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/@scope/test-pkg/v/2.0.0',
                    unpackedSize: 100_000,
                },
            ]);
            scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);
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
            const store = new RootFactStore();
            const scoped = store.scoped(dep.ecosystem);
            // No GITHUB_DATA fact set
            scoped.setVersionFact(dep.name, '1.0.0', FactKeys.VERSIONS_BETWEEN, []);
            scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const writer = new HtmlWriter();
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const pages = writer.toDetailPages(providers, store);

            const html = pages[0]!.html;
            expect(html).toContain('@scope/test-pkg@1.0.0');
            expect(html).not.toContain('CHANGELOG');
        });

        it('toHtml includes custom column data in JSON', async () => {
            const writer = new HtmlWriter({
                columns: [
                    {
                        key: 'surface',
                        header: 'Surface',
                        getValue: (pkg, _ver, s) => {
                            const meta = s.getDependencyFact<{ surfaceId: string }>(
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
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            // The custom column data should be in the tabs JSON
            expect(html).toContain('"surface"');
            expect(html).toContain('test-surface');
            expect(html).toContain('customColumns');
        });

        it('toHtml includes standard notes in filter even when absent from data', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            // Store without any boolean note facts
            const store = new RootFactStore();
            const scoped = store.scoped(dep.ecosystem);
            scoped.setVersionFact(dep.name, '1.0.0', FactKeys.VERSIONS_BETWEEN, []);
            scoped.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, []);

            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            // Standard notes should still appear in uniqueNotes for filter dropdown
            expect(html).toContain('Patched');
            expect(html).toContain('Forked');
            expect(html).toContain('Catalog Mismatch');
        });

        it('toHtml works without getSections configured', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            // Should not throw
            const html = await writer.toHtml(providers, store);
            expect(html).toContain('<!DOCTYPE html>');
        });

        it('groupDependenciesByMeta returns null when no getUsedByGroupKey', async () => {
            const writer = new HtmlWriter();
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            // Without getUsedByGroupKey, Used By Grouped should be null in the JSON data
            expect(html).toContain('"Used By Grouped":null');
        });

        it('groupDependenciesByMeta uses custom group key', async () => {
            const writer = new HtmlWriter({
                getUsedByGroupKey: (pkg, _ver, s) => {
                    const meta = s.getDependencyFact<{ teamName: string }>(pkg, 'testMeta');
                    return meta?.teamName ?? 'Unknown';
                },
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            expect(html).toContain('TestTeam');
        });
    });
});
