import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DependencyCollector } from './DependencyCollector';
import type { DependencyProvider } from '../providers/DependencyProvider';
import type { RegistryService } from './RegistryService';
import type { PackageInfo } from '../types';

function createMockProvider(packages: PackageInfo[] = []): DependencyProvider {
    return {
        name: 'mock',
        rootDir: '/repo',
        lockfilePath: '/repo/mock.lock',
        supportsCatalog: false,
        getPackages: vi.fn().mockResolvedValue(packages),
        isInCatalog: vi.fn().mockReturnValue(false),
        hasPackageInCatalog: vi.fn().mockReturnValue(false),
        isPatched: vi.fn().mockReturnValue(false),
    };
}

function createMockRegistryService(): RegistryService {
    return {
        getFullPackageMetadata: vi.fn().mockResolvedValue({
            'dist-tags': { latest: '1.0.0' },
            time: {},
        }),
        prefetchFullMetadata: vi.fn().mockResolvedValue(undefined),
    } as unknown as RegistryService;
}

describe('DependencyCollector', () => {
    let provider: DependencyProvider;
    let registryService: RegistryService;
    let collector: DependencyCollector;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = createMockProvider();
        registryService = createMockRegistryService();
        collector = new DependencyCollector([provider], registryService);
    });

    describe('collectDirectDependencies', () => {
        it('returns empty array for empty monorepo', async () => {
            const result = await collector.collectDirectDependencies();

            expect(result).toEqual([]);
        });

        it('collects production dependencies', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result).toHaveLength(1);
            expect(result[0]!.packageName).toBe('react');
            expect(result[0]!.versions).toHaveLength(1);
            expect(result[0]!.versions[0]!.version).toBe('18.2.0');
            expect(result[0]!.versions[0]!.usedBy).toEqual(['@myapp/web']);
            expect(result[0]!.versions[0]!.dependencyTypes).toEqual(['prod']);
        });

        it('collects dev dependencies', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    devDependencies: {
                        jest: { from: 'jest', version: '29.0.0', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result).toHaveLength(1);
            expect(result[0]!.versions[0]!.dependencyTypes).toEqual(['dev']);
        });

        it('skips workspace packages (link: prefix)', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        '@myapp/shared': {
                            from: '@myapp/shared',
                            version: 'link:../../packages/shared',
                            resolved: '',
                            path: '',
                        },
                        react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result).toHaveLength(1);
            expect(result[0]!.packageName).toBe('react');
        });

        it('deduplicates same dependency used across multiple packages', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
                    },
                },
                {
                    name: '@myapp/mobile',
                    version: '1.0.0',
                    path: '/repo/apps/mobile',
                    dependencies: {
                        react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result).toHaveLength(1);
            expect(result[0]!.versions).toHaveLength(1);
            expect(result[0]!.versions[0]!.usedBy).toEqual(['@myapp/mobile', '@myapp/web']);
        });

        it('tracks multiple versions of the same dependency', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        lodash: { from: 'lodash', version: '4.17.21', resolved: '', path: '' },
                    },
                },
                {
                    name: '@myapp/legacy',
                    version: '1.0.0',
                    path: '/repo/apps/legacy',
                    dependencies: {
                        lodash: { from: 'lodash', version: '3.10.1', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result).toHaveLength(1);
            expect(result[0]!.packageName).toBe('lodash');
            expect(result[0]!.versions).toHaveLength(2);
        });

        it('tracks both dev and prod usage of the same dependency version', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        zod: { from: 'zod', version: '3.22.0', resolved: '', path: '' },
                    },
                    devDependencies: {
                        zod: { from: 'zod', version: '3.22.0', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result).toHaveLength(1);
            expect(result[0]!.versions[0]!.dependencyTypes).toEqual(['dev', 'prod']);
        });

        it('sorts results alphabetically by package name', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        zod: { from: 'zod', version: '3.22.0', resolved: '', path: '' },
                        axios: { from: 'axios', version: '1.6.0', resolved: '', path: '' },
                        moment: { from: 'moment', version: '2.30.0', resolved: '', path: '' },
                    },
                },
            ]);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result.map((d) => d.packageName)).toEqual(['axios', 'moment', 'zod']);
        });

        it('includes catalog status from workspace service', async () => {
            provider = createMockProvider([
                {
                    name: '@myapp/web',
                    version: '1.0.0',
                    path: '/repo/apps/web',
                    dependencies: {
                        react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
                    },
                },
            ]);
            vi.mocked(provider.isInCatalog).mockReturnValue(true);
            collector = new DependencyCollector([provider], registryService);

            const result = await collector.collectDirectDependencies();

            expect(result[0]!.versions[0]!.inCatalog).toBe(true);
        });
    });
});
