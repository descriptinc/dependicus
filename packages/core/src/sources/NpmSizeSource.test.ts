import { describe, it, expect, vi } from 'vitest';
import { NpmSizeSource } from './NpmSizeSource';
import { RootFactStore, FactKeys } from './FactStore';
import type { DirectDependency, PackageVersionInfo } from '../types';
import type { NpmRegistryService } from '../services/NpmRegistryService';

function makeDep(name: string, version = '1.0.0', latestVersion = '2.0.0'): DirectDependency {
    return {
        name,
        ecosystem: 'npm',
        versions: [
            {
                version,
                latestVersion,
                usedBy: ['@my/app'],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01',
                inCatalog: false,
            },
        ],
    };
}

function mockNpmRegistryService(overrides: Partial<NpmRegistryService> = {}): NpmRegistryService {
    return {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        prefetchFullMetadata: vi.fn(async () => {}),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        prefetchUnpackedSizes: vi.fn(async () => {}),
        getPackageMetadata: vi.fn(async () => undefined),
        getVersionsBetween: vi.fn(async () => []),
        getFullPackageMetadata: vi.fn(async () => undefined),
        getPublishDate: vi.fn(async () => ''),
        getLatestVersion: vi.fn(async () => ''),
        hasFullMetadataCache: vi.fn(async () => false),
        getUnpackedSizes: vi.fn(async () => new Map()),
        ...overrides,
    } as unknown as NpmRegistryService;
}

describe('NpmSizeSource', () => {
    it('has the correct name and depends on npm-registry', () => {
        const source = new NpmSizeSource(mockNpmRegistryService());
        expect(source.name).toBe('npm-sizes');
        expect(source.dependsOn).toEqual(['npm-registry']);
    });

    it('fetches unpacked sizes for all package names', async () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const prefetchUnpackedSizes = vi.fn(async () => {});
        const service = mockNpmRegistryService({ prefetchUnpackedSizes });
        const source = new NpmSizeSource(service);

        await source.fetch([makeDep('react'), makeDep('vue')], new RootFactStore());

        expect(prefetchUnpackedSizes).toHaveBeenCalledWith(['react', 'vue']);
    });

    it('stores SIZE_MAP as a Record (not a Map)', async () => {
        const sizeMap = new Map<string, number | undefined>([
            ['1.0.0', 50000],
            ['2.0.0', 60000],
        ]);

        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('react')], store);

        const stored = store.getDependencyFact<Record<string, number | undefined>>(
            'react',
            FactKeys.SIZE_MAP,
        );
        expect(stored).toEqual({ '1.0.0': 50000, '2.0.0': 60000 });
        expect(stored?.['1.0.0']).toBe(50000);
        expect(stored?.['2.0.0']).toBe(60000);
    });

    it('stores separate SIZE_MAP for each package', async () => {
        const reactSizes = new Map([['1.0.0', 50000]]);
        const vueSizes = new Map([['3.0.0', 30000]]);

        const getUnpackedSizes = vi.fn(async (name: string) => {
            return name === 'react' ? reactSizes : vueSizes;
        });

        const service = mockNpmRegistryService({ getUnpackedSizes });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('react'), makeDep('vue')], store);

        expect(store.getDependencyFact('react', FactKeys.SIZE_MAP)).toEqual({ '1.0.0': 50000 });
        expect(store.getDependencyFact('vue', FactKeys.SIZE_MAP)).toEqual({ '3.0.0': 30000 });
    });

    it('handles empty size maps', async () => {
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => new Map()),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('react')], store);

        const stored = store.getDependencyFact<Record<string, number | undefined>>(
            'react',
            FactKeys.SIZE_MAP,
        );
        expect(stored).toEqual({});
    });

    it('sets UNPACKED_SIZE fallback for installed version when not already set', async () => {
        const sizeMap = new Map<string, number | undefined>([['1.0.0', 45000]]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();
        // NpmRegistrySource did NOT set UNPACKED_SIZE (simulating missing dist.unpackedSize)

        await source.fetch([makeDep('react')], store);

        expect(store.getVersionFact('react', '1.0.0', FactKeys.UNPACKED_SIZE)).toBe(45000);
    });

    it('does not overwrite UNPACKED_SIZE if already set by NpmRegistrySource', async () => {
        const sizeMap = new Map<string, number | undefined>([['1.0.0', 45000]]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();
        // NpmRegistrySource already set a precise size
        store.setVersionFact('react', '1.0.0', FactKeys.UNPACKED_SIZE, 44800);

        await source.fetch([makeDep('react')], store);

        expect(store.getVersionFact('react', '1.0.0', FactKeys.UNPACKED_SIZE)).toBe(44800);
    });

    it('augments VERSIONS_BETWEEN entries with unpackedSize from sizeMap', async () => {
        const sizeMap = new Map<string, number | undefined>([
            ['1.1.0', 46000],
            ['1.2.0', 48000],
        ]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();

        // Simulate NpmRegistrySource having stored VERSIONS_BETWEEN without sizes
        const versionsBetween: PackageVersionInfo[] = [
            {
                version: '1.1.0',
                publishDate: '2024-03-01',
                isPrerelease: false,
                registryUrl: 'https://npmjs.com/react/1.1.0',
            },
            {
                version: '1.2.0',
                publishDate: '2024-06-01',
                isPrerelease: false,
                registryUrl: 'https://npmjs.com/react/1.2.0',
            },
        ];
        store.setVersionFact('react', '1.0.0', FactKeys.VERSIONS_BETWEEN, versionsBetween);

        await source.fetch([makeDep('react')], store);

        const augmented = store.getVersionFact<PackageVersionInfo[]>(
            'react',
            '1.0.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(augmented).toHaveLength(2);
        expect(augmented?.[0]?.unpackedSize).toBe(46000);
        expect(augmented?.[1]?.unpackedSize).toBe(48000);
    });

    it('does not overwrite existing unpackedSize on VERSIONS_BETWEEN entries', async () => {
        const sizeMap = new Map<string, number | undefined>([['1.1.0', 46000]]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();

        // Entry already has unpackedSize
        const versionsBetween: PackageVersionInfo[] = [
            {
                version: '1.1.0',
                publishDate: '2024-03-01',
                isPrerelease: false,
                registryUrl: '',
                unpackedSize: 99999,
            },
        ];
        store.setVersionFact('react', '1.0.0', FactKeys.VERSIONS_BETWEEN, versionsBetween);

        await source.fetch([makeDep('react')], store);

        const augmented = store.getVersionFact<PackageVersionInfo[]>(
            'react',
            '1.0.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(augmented?.[0]?.unpackedSize).toBe(99999);
    });

    it('handles missing VERSIONS_BETWEEN gracefully', async () => {
        const sizeMap = new Map<string, number | undefined>([['1.0.0', 50000]]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();
        // No VERSIONS_BETWEEN set — should not throw

        await source.fetch([makeDep('react')], store);

        expect(store.getVersionFact('react', '1.0.0', FactKeys.VERSIONS_BETWEEN)).toBeUndefined();
    });
});
