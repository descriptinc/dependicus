import { describe, it, expect, vi } from 'vitest';
import { NpmRegistrySource } from './NpmRegistrySource';
import { FactStore, FactKeys } from './FactStore';
import type { DirectDependency, PackageVersionInfo } from '../types';
import type { RegistryService, PackageMetadata } from '../services/RegistryService';

function makeDep(
    packageName: string,
    version: string,
    latestVersion: string,
): DirectDependency {
    return {
        packageName,
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

function mockRegistryService(overrides: Partial<RegistryService> = {}): RegistryService {
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
    } as unknown as RegistryService;
}

describe('NpmRegistrySource', () => {
    it('has the correct name and no dependencies', () => {
        const source = new NpmRegistrySource(mockRegistryService());
        expect(source.name).toBe('npm-registry');
        expect(source.dependsOn).toEqual([]);
    });

    it('fetches full metadata for all package names', async () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const prefetchFullMetadata = vi.fn(async () => {});
        const service = mockRegistryService({ prefetchFullMetadata });
        const source = new NpmRegistrySource(service);
        const deps = [makeDep('react', '18.2.0', '19.0.0'), makeDep('vue', '3.3.0', '3.4.0')];

        await source.fetch(deps, new FactStore());

        expect(prefetchFullMetadata).toHaveBeenCalledWith(['react', 'vue']);
    });

    it('stores version-level facts from registry metadata', async () => {
        const metadata: PackageMetadata = {
            name: 'react',
            version: '18.2.0',
            description: 'A JavaScript library for building user interfaces',
            homepage: 'https://react.dev',
            repository: { type: 'git', url: 'git+https://github.com/facebook/react.git' },
            bugs: { url: 'https://github.com/facebook/react/issues' },
            dist: { unpackedSize: 12345 },
        };

        const service = mockRegistryService({
            getPackageMetadata: vi.fn(async () => metadata),
        });
        const source = new NpmRegistrySource(service);
        const store = new FactStore();

        await source.fetch([makeDep('react', '18.2.0', '19.0.0')], store);

        expect(store.getVersionFact('react', '18.2.0', FactKeys.DESCRIPTION)).toBe(
            'A JavaScript library for building user interfaces',
        );
        expect(store.getVersionFact('react', '18.2.0', FactKeys.HOMEPAGE)).toBe(
            'https://react.dev',
        );
        expect(store.getVersionFact('react', '18.2.0', FactKeys.REPOSITORY_URL)).toBe(
            'https://github.com/facebook/react',
        );
        expect(store.getVersionFact('react', '18.2.0', FactKeys.BUGS_URL)).toBe(
            'https://github.com/facebook/react/issues',
        );
        expect(store.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBe(12345);
    });

    it('stores the raw repo URL for downstream sources', async () => {
        const metadata: PackageMetadata = {
            name: 'react',
            version: '18.2.0',
            repository: { url: 'git+https://github.com/facebook/react.git' },
        };

        const service = mockRegistryService({
            getPackageMetadata: vi.fn(async () => metadata),
        });
        const source = new NpmRegistrySource(service);
        const store = new FactStore();

        await source.fetch([makeDep('react', '18.2.0', '19.0.0')], store);

        expect(store.getVersionFact('react', '18.2.0', FactKeys.RAW_REPO_URL)).toBe(
            'git+https://github.com/facebook/react.git',
        );
    });

    it('stores versions between current and latest', async () => {
        const versionsBetween: PackageVersionInfo[] = [
            {
                version: '18.3.0',
                publishDate: '2024-06-01',
                isPrerelease: false,
                npmUrl: 'https://www.npmjs.com/package/react/v/18.3.0',
            },
        ];

        const service = mockRegistryService({
            getVersionsBetween: vi.fn(async () => versionsBetween),
        });
        const source = new NpmRegistrySource(service);
        const store = new FactStore();

        await source.fetch([makeDep('react', '18.2.0', '19.0.0')], store);

        expect(store.getVersionFact('react', '18.2.0', FactKeys.VERSIONS_BETWEEN)).toEqual(
            versionsBetween,
        );
    });

    it('handles missing metadata gracefully', async () => {
        const service = mockRegistryService({
            getPackageMetadata: vi.fn(async () => undefined),
        });
        const source = new NpmRegistrySource(service);
        const store = new FactStore();

        await source.fetch([makeDep('unknown-pkg', '1.0.0', '2.0.0')], store);

        // Should not throw, and versions-between should still be stored
        expect(
            store.getVersionFact('unknown-pkg', '1.0.0', FactKeys.DESCRIPTION),
        ).toBeUndefined();
        expect(store.getVersionFact('unknown-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN)).toEqual(
            [],
        );
    });

    it('processes multiple versions per dependency', async () => {
        const getPackageMetadata = vi.fn(async (_name: string, version: string) => ({
            name: 'react',
            version,
            description: `react@${version}`,
        }));

        const service = mockRegistryService({ getPackageMetadata });
        const source = new NpmRegistrySource(service);
        const store = new FactStore();

        const dep: DirectDependency = {
            packageName: 'react',
            versions: [
                {
                    version: '17.0.0',
                    latestVersion: '19.0.0',
                    usedBy: ['@my/app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2023-01-01',
                    inCatalog: false,
                },
                {
                    version: '18.2.0',
                    latestVersion: '19.0.0',
                    usedBy: ['@my/lib'],
                    dependencyTypes: ['dev'],
                    publishDate: '2024-01-01',
                    inCatalog: false,
                },
            ],
        };

        await source.fetch([dep], store);

        expect(store.getVersionFact('react', '17.0.0', FactKeys.DESCRIPTION)).toBe(
            'react@17.0.0',
        );
        expect(store.getVersionFact('react', '18.2.0', FactKeys.DESCRIPTION)).toBe(
            'react@18.2.0',
        );
    });
});
