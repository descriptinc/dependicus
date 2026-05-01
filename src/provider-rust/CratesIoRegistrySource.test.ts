import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CratesIoRegistrySource } from './CratesIoRegistrySource';
import { FactKeys, RootFactStore } from '../core/index';
import type { DirectDependency } from '../core/index';

describe('CratesIoRegistrySource', () => {
    const mockCacheService = {
        isCacheValid: vi.fn().mockResolvedValue(false),
        readCache: vi.fn(),
        writeCache: vi.fn().mockResolvedValue(undefined),
        hasPermanentCache: vi.fn().mockReturnValue(false),
        readPermanentCache: vi.fn(),
        writePermanentCache: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
        vi.resetAllMocks();
        mockCacheService.isCacheValid.mockResolvedValue(false);
        mockCacheService.writeCache.mockResolvedValue(undefined);
        mockCacheService.hasPermanentCache.mockReturnValue(false);
        mockCacheService.writePermanentCache.mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn());
    });

    it('has correct name and no dependencies', () => {
        const source = new CratesIoRegistrySource(mockCacheService as any, '/project/Cargo.lock');
        expect(source.name).toBe('crates-io-registry');
        expect(source.dependsOn).toEqual([]);
    });

    it('stores DESCRIPTION, HOMEPAGE, REPOSITORY_URL, and VERSIONS_BETWEEN', async () => {
        const cratesIoResponse = {
            crate: {
                name: 'serde',
                newest_version: '1.0.215',
                description: 'A serialization framework',
                homepage: 'https://serde.rs',
                repository: 'https://github.com/serde-rs/serde',
            },
            versions: [
                { num: '1.0.215', created_at: '2025-01-15T00:00:00Z', yanked: false },
                { num: '1.0.214', created_at: '2025-01-10T00:00:00Z', yanked: false },
                { num: '1.0.211', created_at: '2024-10-01T00:00:00Z', yanked: false },
                { num: '1.0.210', created_at: '2024-09-01T00:00:00Z', yanked: false },
                { num: '1.0.209', created_at: '2024-08-01T00:00:00Z', yanked: false },
            ],
        };

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(cratesIoResponse),
        } as Response);

        const source = new CratesIoRegistrySource(mockCacheService as any, '/project/Cargo.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'serde',
                ecosystem: 'cargo',
                versions: [
                    {
                        version: '1.0.210',
                        latestVersion: '1.0.215',
                        usedBy: ['my-app'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(store.getDependencyFact('serde', FactKeys.DESCRIPTION)).toBe(
            'A serialization framework',
        );
        expect(store.getDependencyFact('serde', FactKeys.HOMEPAGE)).toBe('https://serde.rs');
        expect(store.getDependencyFact('serde', FactKeys.REPOSITORY_URL)).toBe(
            'https://github.com/serde-rs/serde',
        );

        const versionsBetween = store.getVersionFact<any[]>(
            'serde',
            '1.0.210',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeDefined();
        expect(versionsBetween!.map((v: any) => v.version)).toEqual([
            '1.0.211',
            '1.0.214',
            '1.0.215',
        ]);
        expect(versionsBetween![0].registryUrl).toBe('https://crates.io/crates/serde/1.0.211');
        expect(versionsBetween![0].publishDate).toBe('2024-10-01T00:00:00Z');
    });

    it('skips packages already at latest', async () => {
        const source = new CratesIoRegistrySource(mockCacheService as any, '/project/Cargo.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'serde',
                ecosystem: 'cargo',
                versions: [
                    {
                        version: '1.0.215',
                        latestVersion: '1.0.215',
                        usedBy: ['my-app'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('excludes yanked versions from VERSIONS_BETWEEN', async () => {
        const cratesIoResponse = {
            crate: {
                name: 'tokio',
                newest_version: '1.42.0',
                description: 'An async runtime',
                homepage: null,
                repository: 'https://github.com/tokio-rs/tokio',
            },
            versions: [
                { num: '1.42.0', created_at: '2025-02-01T00:00:00Z', yanked: false },
                { num: '1.41.0', created_at: '2025-01-01T00:00:00Z', yanked: true },
                { num: '1.40.0', created_at: '2024-09-01T00:00:00Z', yanked: false },
            ],
        };

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(cratesIoResponse),
        } as Response);

        const source = new CratesIoRegistrySource(mockCacheService as any, '/project/Cargo.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'tokio',
                ecosystem: 'cargo',
                versions: [
                    {
                        version: '1.40.0',
                        latestVersion: '1.42.0',
                        usedBy: ['my-app'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        const versionsBetween = store.getVersionFact<any[]>(
            'tokio',
            '1.40.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeDefined();
        // 1.41.0 is yanked, should not appear
        expect(versionsBetween!.map((v: any) => v.version)).toEqual(['1.42.0']);
    });

    it('handles fetch failures gracefully', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

        const source = new CratesIoRegistrySource(mockCacheService as any, '/project/Cargo.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'serde',
                ecosystem: 'cargo',
                versions: [
                    {
                        version: '1.0.210',
                        latestVersion: '1.0.215',
                        usedBy: ['my-app'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        // Should not throw
        await source.fetch(deps, store);

        // No facts should be set since the fetch failed
        expect(store.getDependencyFact('serde', FactKeys.DESCRIPTION)).toBeUndefined();
    });

    it('does not set facts when crate metadata fields are null', async () => {
        const cratesIoResponse = {
            crate: {
                name: 'some-crate',
                newest_version: '2.0.0',
                description: null,
                homepage: null,
                repository: null,
            },
            versions: [
                { num: '2.0.0', created_at: '2025-01-01T00:00:00Z', yanked: false },
                { num: '1.0.0', created_at: '2024-01-01T00:00:00Z', yanked: false },
            ],
        };

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(cratesIoResponse),
        } as Response);

        const source = new CratesIoRegistrySource(mockCacheService as any, '/project/Cargo.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'some-crate',
                ecosystem: 'cargo',
                versions: [
                    {
                        version: '1.0.0',
                        latestVersion: '2.0.0',
                        usedBy: ['my-app'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(store.getDependencyFact('some-crate', FactKeys.DESCRIPTION)).toBeUndefined();
        expect(store.getDependencyFact('some-crate', FactKeys.HOMEPAGE)).toBeUndefined();
        expect(store.getDependencyFact('some-crate', FactKeys.REPOSITORY_URL)).toBeUndefined();
    });
});
