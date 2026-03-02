import { describe, it, expect, vi } from 'vitest';
import { NpmSizeSource } from './NpmSizeSource';
import { RootFactStore, FactKeys } from '@dependicus/core';
import type { DirectDependency } from '@dependicus/core';
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
        prefetchFullMetadata: vi.fn(async () => {}),
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

    it('stores SIZE_MAP as a Record', async () => {
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
    });

    it('sets UNPACKED_SIZE fallback for installed version when not already set', async () => {
        const sizeMap = new Map<string, number | undefined>([['1.0.0', 45000]]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('react')], store);

        expect(store.getVersionFact('react', '1.0.0', FactKeys.UNPACKED_SIZE)).toBe(45000);
    });

    it('does not overwrite UNPACKED_SIZE if already set', async () => {
        const sizeMap = new Map<string, number | undefined>([['1.0.0', 45000]]);
        const service = mockNpmRegistryService({
            getUnpackedSizes: vi.fn(async () => sizeMap),
        });
        const source = new NpmSizeSource(service);
        const store = new RootFactStore();
        store.setVersionFact('react', '1.0.0', FactKeys.UNPACKED_SIZE, 44800);

        await source.fetch([makeDep('react')], store);

        expect(store.getVersionFact('react', '1.0.0', FactKeys.UNPACKED_SIZE)).toBe(44800);
    });
});
