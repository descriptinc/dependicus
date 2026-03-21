import { describe, it, expect } from 'vitest';
import { createCoreServices } from './createCoreServices';
import type { DataSource, FactStore } from './sources/types';
import type { DependencyProvider } from './providers/DependencyProvider';
import type { DirectDependency, ProviderOutput } from './types';

/** Minimal provider that returns canned dependencies. */
function stubProvider(output: ProviderOutput): DependencyProvider {
    return {
        name: output.name,
        ecosystem: output.ecosystem,
        supportsCatalog: output.supportsCatalog,
        installCommand: output.installCommand,
        urlPatterns: output.urlPatterns,
        getPackages: async () =>
            output.dependencies.map((d) => ({
                name: d.name,
                version: '0.0.0',
                dependencies: Object.fromEntries(
                    d.versions.map((v) => [d.name, { version: v.version }]),
                ),
            })),
        resolveVersionMetadata: async (packages: Array<{ name: string; versions: string[] }>) => {
            const map = new Map<string, { latestVersion: string; publishDate?: string }>();
            for (const pkg of packages) {
                for (const v of pkg.versions) {
                    map.set(`${pkg.name}@${v}`, {
                        latestVersion: v,
                        publishDate: '2024-01-01',
                    });
                }
            }
            return map;
        },
        createSources: () => [],
        isPatched: () => false,
        hasInCatalog: () => false,
        isInCatalog: () => false,
    } as unknown as DependencyProvider;
}

describe('createCoreServices plugin source scoping', () => {
    it('plugin sources receive a scoped store so facts are readable by scoped consumers', async () => {
        const output: ProviderOutput = {
            name: 'pnpm',
            ecosystem: 'npm',
            supportsCatalog: false,
            installCommand: 'pnpm install',
            urlPatterns: {},
            dependencies: [
                {
                    name: 'react',
                    ecosystem: 'npm',
                    versions: [
                        {
                            version: '18.0.0',
                            latestVersion: '18.0.0',
                            usedBy: ['app'],
                            dependencyTypes: ['prod'],
                            publishDate: '2024-01-01',
                            inCatalog: false,
                        },
                    ],
                },
            ],
        };

        // A plugin source that writes directly to the store it receives,
        // without calling store.scoped() — simulating a naive plugin.
        const pluginSource: DataSource = {
            name: 'ownership',
            dependsOn: [],
            async fetch(deps: DirectDependency[], store: FactStore) {
                for (const d of deps) {
                    store.setDependencyFact(d.name, 'owner', 'TeamA');
                }
            },
        };

        const services = createCoreServices({
            repoRoot: '/fake',
            cacheDir: '/fake/cache',
            providers: [stubProvider(output)],
            sources: [pluginSource],
        });

        const { store } = await services.collect();

        // The plugin wrote to whatever store it received. The fact must be
        // readable through a scoped store — this is how HtmlWriter reads it.
        const scoped = store.scoped('npm');
        expect(scoped.getDependencyFact('react', 'owner')).toBe('TeamA');

        // The fact should NOT be on the unscoped root (that was the bug).
        expect(store.getDependencyFact('react', 'owner')).toBeUndefined();
    });

    it('plugin sources run per-ecosystem and see only that ecosystem deps', async () => {
        const npmOutput: ProviderOutput = {
            name: 'pnpm',
            ecosystem: 'npm',
            supportsCatalog: false,
            installCommand: 'pnpm install',
            urlPatterns: {},
            dependencies: [
                {
                    name: 'react',
                    ecosystem: 'npm',
                    versions: [
                        {
                            version: '18.0.0',
                            latestVersion: '18.0.0',
                            usedBy: ['app'],
                            dependencyTypes: ['prod'],
                            publishDate: '2024-01-01',
                            inCatalog: false,
                        },
                    ],
                },
            ],
        };

        const miseOutput: ProviderOutput = {
            name: 'mise',
            ecosystem: 'mise',
            supportsCatalog: false,
            installCommand: 'mise install',
            urlPatterns: {},
            dependencies: [
                {
                    name: 'node',
                    ecosystem: 'mise',
                    versions: [
                        {
                            version: '22.0.0',
                            latestVersion: '22.0.0',
                            usedBy: ['root'],
                            dependencyTypes: ['prod'],
                            publishDate: '2024-01-01',
                            inCatalog: false,
                        },
                    ],
                },
            ],
        };

        const seenEcosystems: string[][] = [];

        const pluginSource: DataSource = {
            name: 'tagger',
            dependsOn: [],
            async fetch(deps: DirectDependency[], store: FactStore) {
                seenEcosystems.push(deps.map((d) => d.ecosystem));
                for (const d of deps) {
                    store.setDependencyFact(d.name, 'tagged', 'yes');
                }
            },
        };

        const services = createCoreServices({
            repoRoot: '/fake',
            cacheDir: '/fake/cache',
            providers: [stubProvider(npmOutput), stubProvider(miseOutput)],
            sources: [pluginSource],
        });

        const { store } = await services.collect();

        // Plugin ran twice — once per ecosystem
        expect(seenEcosystems).toHaveLength(2);
        expect(seenEcosystems).toContainEqual(['npm']);
        expect(seenEcosystems).toContainEqual(['mise']);

        // Facts readable through correct scoped stores
        expect(store.scoped('npm').getDependencyFact('react', 'tagged')).toBe('yes');
        expect(store.scoped('mise').getDependencyFact('node', 'tagged')).toBe('yes');

        // No cross-contamination
        expect(store.scoped('npm').getDependencyFact('node', 'tagged')).toBeUndefined();
        expect(store.scoped('mise').getDependencyFact('react', 'tagged')).toBeUndefined();
    });
});
