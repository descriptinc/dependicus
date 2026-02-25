import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PyPiRegistrySource } from './PyPiRegistrySource';
import { FactKeys, RootFactStore } from '@dependicus/core';
import type { DirectDependency } from '@dependicus/core';

describe('PyPiRegistrySource', () => {
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

    const pypiData = {
        info: {
            version: '2.33.0',
            summary: 'Python HTTP for Humans.',
            home_page: null,
            project_urls: {
                Documentation: 'https://requests.readthedocs.io',
                Homepage: 'https://requests.readthedocs.io',
                'Source Code': 'https://github.com/psf/requests',
            },
        },
        releases: {
            '2.32.5': [{ upload_time_iso_8601: '2024-06-01T00:00:00Z', yanked: false }],
            '2.32.6': [{ upload_time_iso_8601: '2024-09-01T00:00:00Z', yanked: false }],
            '2.33.0': [{ upload_time_iso_8601: '2025-01-15T00:00:00Z', yanked: false }],
            '2.33.1a0': [{ upload_time_iso_8601: '2025-02-01T00:00:00Z', yanked: false }],
            '2.32.7': [{ upload_time_iso_8601: '2024-10-01T00:00:00Z', yanked: true }],
        },
    };

    it('has correct name and no dependencies', () => {
        const source = new PyPiRegistrySource(mockCacheService as any, '/project/uv.lock');
        expect(source.name).toBe('pypi-registry');
        expect(source.dependsOn).toEqual([]);
    });

    it('stores DESCRIPTION, HOMEPAGE, REPOSITORY_URL, and VERSIONS_BETWEEN', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(pypiData),
        } as Response);

        const source = new PyPiRegistrySource(mockCacheService as any, '/project/uv.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'requests',
                ecosystem: 'pypi',
                versions: [
                    {
                        version: '2.32.5',
                        latestVersion: '2.33.0',
                        usedBy: ['my-project'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(store.getDependencyFact('requests', FactKeys.DESCRIPTION)).toBe(
            'Python HTTP for Humans.',
        );
        expect(store.getDependencyFact('requests', FactKeys.HOMEPAGE)).toBe(
            'https://requests.readthedocs.io',
        );
        expect(store.getDependencyFact('requests', FactKeys.REPOSITORY_URL)).toBe(
            'https://github.com/psf/requests',
        );

        const versionsBetween = store.getVersionFact<any[]>(
            'requests',
            '2.32.5',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeDefined();
        // 2.32.6 and 2.33.0 — prerelease 2.33.1a0 excluded, yanked 2.32.7 excluded
        expect(versionsBetween!.map((v: any) => v.version)).toEqual(['2.32.6', '2.33.0']);
        expect(versionsBetween![0].registryUrl).toBe('https://pypi.org/project/requests/2.32.6/');
        expect(versionsBetween![0].publishDate).toBe('2024-09-01T00:00:00Z');
    });

    it('skips packages already at latest', async () => {
        const source = new PyPiRegistrySource(mockCacheService as any, '/project/uv.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'requests',
                ecosystem: 'pypi',
                versions: [
                    {
                        version: '2.33.0',
                        latestVersion: '2.33.0',
                        usedBy: ['my-project'],
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

    it('uses cached data when available', async () => {
        mockCacheService.isCacheValid.mockResolvedValue(true);
        mockCacheService.readCache.mockResolvedValue(JSON.stringify(pypiData));

        const source = new PyPiRegistrySource(mockCacheService as any, '/project/uv.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'requests',
                ecosystem: 'pypi',
                versions: [
                    {
                        version: '2.32.5',
                        latestVersion: '2.33.0',
                        usedBy: ['my-project'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(fetch).not.toHaveBeenCalled();
        expect(store.getDependencyFact('requests', FactKeys.DESCRIPTION)).toBe(
            'Python HTTP for Humans.',
        );
    });

    it('handles fetch failures gracefully', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

        const source = new PyPiRegistrySource(mockCacheService as any, '/project/uv.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'requests',
                ecosystem: 'pypi',
                versions: [
                    {
                        version: '2.32.5',
                        latestVersion: '2.33.0',
                        usedBy: ['my-project'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        // Should not throw
        await source.fetch(deps, store);

        // No facts stored since fetch failed
        expect(store.getDependencyFact('requests', FactKeys.DESCRIPTION)).toBeUndefined();
    });

    it('correctly filters yanked releases from VERSIONS_BETWEEN', async () => {
        const dataWithYanked = {
            ...pypiData,
            releases: {
                '1.0.0': [{ upload_time_iso_8601: '2023-01-01T00:00:00Z', yanked: false }],
                '1.1.0': [{ upload_time_iso_8601: '2023-06-01T00:00:00Z', yanked: true }],
                '1.2.0': [{ upload_time_iso_8601: '2024-01-01T00:00:00Z', yanked: false }],
            },
        };

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(dataWithYanked),
        } as Response);

        const source = new PyPiRegistrySource(mockCacheService as any, '/project/uv.lock');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'some-pkg',
                ecosystem: 'pypi',
                versions: [
                    {
                        version: '1.0.0',
                        latestVersion: '1.2.0',
                        usedBy: ['my-project'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        const versionsBetween = store.getVersionFact<any[]>(
            'some-pkg',
            '1.0.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        // 1.1.0 is yanked, only 1.2.0 should appear
        expect(versionsBetween!.map((v: any) => v.version)).toEqual(['1.2.0']);
    });
});
