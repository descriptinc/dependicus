import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoProxyRegistrySource } from './GoProxyRegistrySource';
import { FactKeys, RootFactStore } from '../core/index';
import type { DirectDependency } from '../core/index';

describe('GoProxyRegistrySource', () => {
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
        const source = new GoProxyRegistrySource(mockCacheService as any, '/project/go.sum');
        expect(source.name).toBe('go-proxy-registry');
        expect(source.dependsOn).toEqual([]);
    });

    it('stores HOMEPAGE, REPOSITORY_URL, and VERSIONS_BETWEEN', async () => {
        // Mock version list fetch
        vi.mocked(fetch)
            .mockResolvedValueOnce({
                ok: true,
                text: () => Promise.resolve('v1.8.0\nv1.8.1\nv1.9.0\n'),
            } as Response)
            // Mock version info for v1.9.0 (the only version between 1.8.1 and 1.9.0)
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ Version: 'v1.9.0', Time: '2025-03-01T00:00:00Z' }),
            } as Response);

        const source = new GoProxyRegistrySource(mockCacheService as any, '/project/go.sum');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'github.com/gorilla/mux',
                ecosystem: 'gomod',
                versions: [
                    {
                        version: '1.8.1',
                        latestVersion: '1.9.0',
                        usedBy: ['github.com/example/myapp'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(store.getDependencyFact('github.com/gorilla/mux', FactKeys.HOMEPAGE)).toBe(
            'https://pkg.go.dev/github.com/gorilla/mux',
        );
        expect(store.getDependencyFact('github.com/gorilla/mux', FactKeys.REPOSITORY_URL)).toBe(
            'https://github.com/gorilla/mux',
        );

        const versionsBetween = store.getVersionFact<any[]>(
            'github.com/gorilla/mux',
            '1.8.1',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeDefined();
        expect(versionsBetween!.map((v: any) => v.version)).toEqual(['1.9.0']);
        expect(versionsBetween![0].registryUrl).toBe(
            'https://pkg.go.dev/github.com/gorilla/mux@v1.9.0',
        );
        expect(versionsBetween![0].publishDate).toBe('2025-03-01T00:00:00Z');
    });

    it('derives GitHub repo URL for github.com modules', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(''),
        } as Response);

        const source = new GoProxyRegistrySource(mockCacheService as any, '/project/go.sum');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'github.com/sirupsen/logrus',
                ecosystem: 'gomod',
                versions: [
                    {
                        version: '1.9.0',
                        latestVersion: '1.9.3',
                        usedBy: ['myapp'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(store.getDependencyFact('github.com/sirupsen/logrus', FactKeys.REPOSITORY_URL)).toBe(
            'https://github.com/sirupsen/logrus',
        );
    });

    it('derives pkg.go.dev URL for non-GitHub modules', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(''),
        } as Response);

        const source = new GoProxyRegistrySource(mockCacheService as any, '/project/go.sum');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'golang.org/x/text',
                ecosystem: 'gomod',
                versions: [
                    {
                        version: '0.14.0',
                        latestVersion: '0.15.0',
                        usedBy: ['myapp'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(store.getDependencyFact('golang.org/x/text', FactKeys.REPOSITORY_URL)).toBe(
            'https://pkg.go.dev/golang.org/x/text',
        );
    });

    it('skips packages already at latest', async () => {
        const source = new GoProxyRegistrySource(mockCacheService as any, '/project/go.sum');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'github.com/gorilla/mux',
                ecosystem: 'gomod',
                versions: [
                    {
                        version: '1.9.0',
                        latestVersion: '1.9.0',
                        usedBy: ['myapp'],
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

    it('handles fetch failures gracefully', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

        const source = new GoProxyRegistrySource(mockCacheService as any, '/project/go.sum');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'github.com/gorilla/mux',
                ecosystem: 'gomod',
                versions: [
                    {
                        version: '1.8.1',
                        latestVersion: '1.9.0',
                        usedBy: ['myapp'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        // Should not throw
        await source.fetch(deps, store);

        // HOMEPAGE and REPOSITORY_URL are set before fetching versions
        expect(store.getDependencyFact('github.com/gorilla/mux', FactKeys.HOMEPAGE)).toBe(
            'https://pkg.go.dev/github.com/gorilla/mux',
        );
    });
});
