import { describe, it, expect } from 'vitest';
import type {
    DirectDependency,
    DependencyVersion,
    GroupingConfig,
    ProviderOutput,
} from '../../core/index';
import { RootFactStore, FactKeys, getDetailFilename } from '../../core/index';
import type { FactStore } from '../../core/index';
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

            expect(html).toContain('data-tab-type="deps"');
            expect(html).toContain('data-tab-type="dups"');
            // Single provider: provider bar is hidden
            expect(html).not.toContain('data-provider=');
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

        it('renders plugin sections on a detail page', () => {
            const writer = new HtmlWriter({
                getDependencySections: (ctx) => [
                    {
                        title: 'Advisories',
                        html: `<p>two for ${ctx.name}@${ctx.version.version}</p>`,
                    },
                ],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([makeProvider([dep])], store);

            expect(pages[0]!.html).toContain('Advisories');
            expect(pages[0]!.html).toContain('two for @scope/test-pkg@');
        });

        it('shows a custom column tooltip alongside its value', () => {
            const writer = new HtmlWriter({
                columns: [
                    {
                        key: 'risk',
                        header: 'Risk',
                        getValue: () => 'High',
                        getTooltip: () => 'CVSS 8.7',
                    },
                ],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toDetailPages([makeProvider([dep])], store);

            expect(pages[0]!.html).toContain('High');
            expect(pages[0]!.html).toContain('CVSS 8.7');
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
                        getValue: ({ name: pkg, store: s }) => {
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
                        getValue: ({ name: pkg, store: s }) => {
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
                        getValue: ({ name: pkg, store: s }) => {
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
            getValue: (name, store) => {
                const meta = store.getDependencyFact<{ teamName: string }>(name, 'testMeta');
                return meta?.teamName ?? 'Unknown';
            },
        };

        it('tells getValue which ecosystem it is placing', () => {
            const seen: Array<{ name: string; ecosystem: string }> = [];
            const recording: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                getValue: (name, _store, ecosystem) => {
                    seen.push({ name, ecosystem });
                    return 'Growth';
                },
            };
            const writer = new HtmlWriter({ groupings: [recording] });
            const dep = makeMockDependency({ ecosystem: 'gomod' });
            const store = makeMockStore([dep]);
            writer.toGroupingPages([dep], recording, store, 'go/', 'gomod');

            expect(seen).toEqual([{ name: dep.name, ecosystem: 'gomod' }]);
        });

        it('puts a grouping that names no ecosystems in one tree at the site root', () => {
            const writer = new HtmlWriter({ groupings: [teamGrouping] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const filenames = pages.map((p) => p.filename);
            expect(filenames).toContain('teams/index.html');
            // Not once per provider, which is what stranded the Go pages.
            expect(filenames).not.toContain('pnpm/teams/index.html');
            expect(filenames).not.toContain('go/teams/index.html');
        });

        it('keeps a grouping restricted to an ecosystem under its provider', () => {
            const npmOnly: GroupingConfig = { ...teamGrouping, ecosystems: ['npm'] };
            const writer = new HtmlWriter({ groupings: [npmOnly] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const filenames = pages.map((p) => p.filename);
            expect(filenames).toContain('pnpm/teams/index.html');
            expect(filenames).not.toContain('teams/index.html');
            expect(filenames).not.toContain('go/teams/index.html');
        });

        it('points a merged page at the provider directory holding each detail page', () => {
            const writer = new HtmlWriter({ groupings: [teamGrouping] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const detail = pages.find(
                (p) => p.filename.startsWith('teams/') && !p.filename.endsWith('index.html'),
            );
            expect(detail!.html).toContain('../go/details/');
            expect(detail!.html).toContain('../pnpm/details/');
        });

        it('splits a rollup page by ecosystem when it spans more than one', () => {
            const writer = new HtmlWriter({ groupings: [teamGrouping] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const detail = pages.find(
                (p) => p.filename.startsWith('teams/') && !p.filename.endsWith('index.html'),
            );
            // Named as a reader would, not by the raw ecosystem id.
            expect(detail!.html).toContain('Go (1)');
            expect(detail!.html).toContain('npm (1)');
            expect(detail!.html).toContain('dep-ecosystem-heading');
        });

        it('leaves a single-ecosystem rollup page as one flat list', () => {
            const npmOnly: GroupingConfig = { ...teamGrouping, ecosystems: ['npm'] };
            const writer = new HtmlWriter({ groupings: [npmOnly] });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([makeProvider([dep])], store);

            const detail = pages.find((p) => !p.filename.endsWith('index.html'));
            expect(detail!.html).not.toContain('dep-ecosystem-heading');
        });

        it('splits the index by ecosystem when values span more than one', () => {
            // The realistic shape: each value is one app or one service, so no
            // single value mixes ecosystems but the index does.
            const perPackage: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                getValue: (name) =>
                    name.startsWith('github.com/') ? 'wal-streamer' : 'lawyer-portal',
            };
            const writer = new HtmlWriter({ groupings: [perPackage] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const index = pages.find((p) => p.filename === 'teams/index.html')!;
            expect(index.html).toContain('Go (1)');
            expect(index.html).toContain('npm (1)');
            // The total stays the total, whatever the headings say.
            expect(index.html).toContain('2 entries');

            // Each value under the heading for its own ecosystem.
            const goHeading = index.html.indexOf('Go (1)');
            const npmHeading = index.html.indexOf('npm (1)');
            expect(index.html.indexOf('wal-streamer')).toBeGreaterThan(goHeading);
            expect(index.html.indexOf('wal-streamer')).toBeLessThan(npmHeading);
            expect(index.html.indexOf('lawyer-portal')).toBeGreaterThan(npmHeading);
        });

        it('leaves the index alone when every value spans the same ecosystems', () => {
            // A team-per-value rollup: every team owns both Go and npm, so a
            // split would list all of them under each heading.
            const perTeam: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                getValue: () => ['Growth', 'Infrastructure'],
            };
            const writer = new HtmlWriter({ groupings: [perTeam] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const index = pages.find((p) => p.filename === 'teams/index.html')!;
            expect(index.html).not.toContain('dep-ecosystem-heading');
            // Each team still listed once.
            expect(index.html.split('>Growth</a>').length - 1).toBe(1);
        });

        it('still splits when only some values span both ecosystems', () => {
            const mixed: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                // Shared owns both; Backend owns only the Go module.
                getValue: (name) =>
                    name.startsWith('github.com/') ? ['Shared', 'Backend'] : ['Shared'],
            };
            const writer = new HtmlWriter({ groupings: [mixed] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const index = pages.find((p) => p.filename === 'teams/index.html')!;
            expect(index.html).toContain('dep-ecosystem-heading');
            // Backend is Go only, so it appears once; Shared spans both.
            expect(index.html.split('>Backend</a>').length - 1).toBe(1);
            expect(index.html.split('>Shared</a>').length - 1).toBe(2);
        });

        it('leaves a single-ecosystem index as one list', () => {
            const writer = new HtmlWriter({ groupings: [teamGrouping] });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([makeProvider([dep])], store);

            const index = pages.find((p) => p.filename.endsWith('index.html'))!;
            expect(index.html).not.toContain('dep-ecosystem-heading');
        });

        it('links a flag at the dependency page when the plugin gives no link', () => {
            const flagging: GroupingConfig = {
                ...teamGrouping,
                getSections: (ctx) => [
                    {
                        title: 'Flagged',
                        flaggedDependencies: ctx.dependencies.map((d) => ({
                            name: d.name,
                            version: d.versions[0]!.version,
                            label: 'overdue',
                        })),
                    },
                ],
            };
            const writer = new HtmlWriter({ groupings: [flagging] });
            const npmDep = makeMockDependency();
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([npmDep, goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([npmDep]), makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            const detail = pages.find(
                (p) => p.filename.startsWith('teams/') && !p.filename.endsWith('index.html'),
            )!;
            // A merged page sits at the root, so a bare ../details/ would 404.
            expect(detail.html).toContain('../pnpm/details/');
            expect(detail.html).toContain('../go/details/');
            expect(detail.html).not.toContain('"../details/');
        });

        it('leaves a flag alone when the plugin supplies its own link', () => {
            const flagging: GroupingConfig = {
                ...teamGrouping,
                getSections: (ctx) => [
                    {
                        title: 'Flagged',
                        flaggedDependencies: ctx.dependencies.map((d) => ({
                            name: d.name,
                            version: d.versions[0]!.version,
                            detailLink: 'https://example.com/elsewhere',
                            label: 'overdue',
                        })),
                    },
                ],
            };
            const writer = new HtmlWriter({ groupings: [flagging] });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([makeProvider([dep])], store);

            const detail = pages.find((p) => !p.filename.endsWith('index.html'))!;
            expect(detail.html).toContain('https://example.com/elsewhere');
        });

        it('gives sections a resolver for their own links', () => {
            let link = '';
            const linking: GroupingConfig = {
                ...teamGrouping,
                getSections: (ctx) => {
                    const dep = ctx.dependencies[0]!;
                    link = ctx.detailLinkFor(dep, dep.versions[0]!.version);
                    return [{ title: 'Linked', html: `<a href="${link}">x</a>` }];
                },
            };
            const writer = new HtmlWriter({ groupings: [linking] });
            const goDep = makeMockDependency({ name: 'github.com/a/b', ecosystem: 'gomod' });
            const store = makeMockStore([goDep]);
            writer.toAllGroupingPages(
                [makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            expect(link).toBe('../go/details/github.com-a-b@1.0.0.html');
        });

        it('files a dependency under every value getValue returns', () => {
            const multi: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                getValue: () => ['Growth', 'Representation'],
            };
            const writer = new HtmlWriter({ groupings: [multi] });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const { details } = writer.toGroupingPages(
                [dep],
                multi,
                store.scoped(dep.ecosystem),
                'pnpm/',
                'npm',
            );

            expect(details.map((d) => d.filename).sort()).toEqual([
                'pnpm/teams/Growth.html',
                'pnpm/teams/Representation.html',
            ]);
        });

        it('skips a grouping whose ecosystems exclude the provider', () => {
            const npmOnly: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                ecosystems: ['npm'],
                getValue: () => 'Growth',
            };
            const writer = new HtmlWriter({ groupings: [npmOnly] });
            const goDep = makeMockDependency({ ecosystem: 'gomod' });
            const store = makeMockStore([goDep]);
            const pages = writer.toAllGroupingPages(
                [makeProvider([goDep], { name: 'go', ecosystem: 'gomod' })],
                store,
            );

            expect(pages).toEqual([]);
        });

        it('keeps a grouping for an ecosystem it lists', () => {
            const npmOnly: GroupingConfig = {
                key: 'team',
                label: 'Teams',
                slugPrefix: 'teams',
                ecosystems: ['npm'],
                getValue: () => 'Growth',
            };
            const writer = new HtmlWriter({ groupings: [npmOnly] });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const pages = writer.toAllGroupingPages([makeProvider([dep])], store);

            expect(pages.map((pg) => pg.filename)).toContain('pnpm/teams/Growth.html');
        });

        it('counts stats in the same unit as the list beside them', () => {
            // Two versions of one dependency, both behind: the total used to
            // count names and the outdated count versions, so outdated came
            // out higher than the total.
            const dep = makeMockDependency({
                versions: [
                    makeMockVersion({ version: '1.0.0', latestVersion: '2.0.0' }),
                    makeMockVersion({ version: '1.5.0', latestVersion: '2.0.0' }),
                ],
            });
            const writer = new HtmlWriter({ groupings: [teamGrouping] });
            const store = makeMockStore([dep]);
            const { details } = writer.toGroupingPages(
                [dep],
                teamGrouping,
                store.scoped(dep.ecosystem),
                'pnpm/',
                'npm',
            );

            expect(details[0]!.html).toContain('Dependencies (2)');
            // Both versions are listed, not just the first.
            expect(details[0]!.html).toContain('1.0.0');
            expect(details[0]!.html).toContain('1.5.0');
        });

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
                'npm',
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
                getValue: (name, factStore) => {
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
            expect(filenames).toContain('teams/index.html');
            expect(filenames).toContain('teams/TestTeam.html');
            expect(filenames).toContain('surfaces/index.html');
            expect(filenames).toContain('surfaces/test-surface.html');
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
                'npm',
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
                getValue: (name) => {
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
                'npm',
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
            expect(filenames).toContain('env/index.html');
            expect(filenames).toContain('env/production.html');
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

        it('index page nav links include provider prefix for groupings', async () => {
            const writer = new HtmlWriter({
                groupings: [teamGrouping],
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const providers: ProviderOutput[] = [makeProvider([dep])];
            const html = await writer.toHtml(providers, store);

            // Nav links must include the provider prefix so they resolve to real files
            expect(html).toContain('href="teams/index.html"');
            // Must not contain "undefined" in any href
            expect(html).not.toMatch(/href="[^"]*undefined[^"]*"/);
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
                'npm',
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
                'npm',
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
                        getValue: ({ name: pkg, store: s }) => {
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

        it('getUsedByGroups supplies the whole grouped map, not just a label', async () => {
            const writer = new HtmlWriter({
                getUsedByGroups: () => ({
                    Growth: ['@app/web'],
                    Platform: ['@app/api'],
                }),
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = await writer.toHtml([makeProvider([dep])], store);

            expect(html).toContain(
                '"Used By Grouped":{"Growth":["@app/web"],"Platform":["@app/api"]}',
            );
        });

        it('lists the consumers the groups name, so the flat column matches the pills', async () => {
            const writer = new HtmlWriter({
                // Deliberately not the dependency's own usedBy.
                getUsedByGroups: () => ({ Platform: ['svc-b', 'svc-a'], Growth: ['svc-a'] }),
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = await writer.toHtml([makeProvider([dep])], store);

            // Deduplicated and sorted across groups.
            expect(html).toContain('"Used By":"svc-a; svc-b"');
            expect(html).toContain('"Used By Count":2');
        });

        it("falls back to the dependency's own consumers when the map is empty", async () => {
            const writer = new HtmlWriter({ getUsedByGroups: () => ({}) });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = await writer.toHtml([makeProvider([dep])], store);

            expect(html).toContain('"Used By":"@app/web; @app/api"');
            expect(html).toContain('"Used By Grouped":null');
        });

        it('leaves getUsedByGroupKey behaviour alone when both are absent from a writer', async () => {
            const writer = new HtmlWriter({
                getUsedByGroupKey: () => 'OneLabel',
            });
            const dep = makeMockDependency();
            const store = makeMockStore([dep]);
            const html = await writer.toHtml([makeProvider([dep])], store);

            expect(html).toContain('"Used By Grouped":{"OneLabel":["@app/api","@app/web"]}');
            expect(html).toContain('"Used By":"@app/web; @app/api"');
        });

        it('groupDependenciesByMeta uses custom group key', async () => {
            const writer = new HtmlWriter({
                getUsedByGroupKey: ({ name: pkg, store: s }) => {
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
