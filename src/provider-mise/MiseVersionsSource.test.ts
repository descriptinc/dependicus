import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiseVersionsSource } from './MiseVersionsSource';
import { FactKeys, RootFactStore } from '../core/index';
import type { DirectDependency } from '../core/index';

describe('MiseVersionsSource', () => {
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
        const source = new MiseVersionsSource(mockCacheService as any, '/project/mise.toml');
        expect(source.name).toBe('mise-versions');
        expect(source.dependsOn).toEqual([]);
    });

    it('fetches versions between current and latest', async () => {
        const mockResponse = {
            ok: true,
            text: () =>
                Promise.resolve(
                    '20.0.0\n21.0.0\n22.0.0\n22.10.0\n22.11.0\n22.12.0\n22.13.0\n22.14.0\n',
                ),
        };
        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const source = new MiseVersionsSource(mockCacheService as any, '/project/mise.toml');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'node',
                ecosystem: 'mise',
                versions: [
                    {
                        version: '22.12.0',
                        latestVersion: '22.14.0',
                        usedBy: ['mise-tools'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        const versionsBetween = store.getVersionFact<any[]>(
            'node',
            '22.12.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeDefined();
        expect(versionsBetween!.length).toBe(2); // 22.13.0 and 22.14.0
        expect(versionsBetween![0].version).toBe('22.13.0');
        expect(versionsBetween![1].version).toBe('22.14.0');
        expect(versionsBetween![0].publishDate).toBeUndefined();
    });

    it('skips packages already at latest', async () => {
        const source = new MiseVersionsSource(mockCacheService as any, '/project/mise.toml');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'node',
                ecosystem: 'mise',
                versions: [
                    {
                        version: '22.14.0',
                        latestVersion: '22.14.0',
                        usedBy: ['mise-tools'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        const versionsBetween = store.getVersionFact<any[]>(
            'node',
            '22.14.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeUndefined();
    });

    it('uses cached version data', async () => {
        mockCacheService.isCacheValid.mockResolvedValue(true);
        mockCacheService.readCache.mockResolvedValue(JSON.stringify(['22.13.0', '22.14.0']));

        const source = new MiseVersionsSource(mockCacheService as any, '/project/mise.toml');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'node',
                ecosystem: 'mise',
                versions: [
                    {
                        version: '22.12.0',
                        latestVersion: '22.14.0',
                        usedBy: ['mise-tools'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        await source.fetch(deps, store);

        expect(fetch).not.toHaveBeenCalled();
        const versionsBetween = store.getVersionFact<any[]>(
            'node',
            '22.12.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toBeDefined();
        expect(versionsBetween!.length).toBe(2);
    });

    it('handles fetch failure gracefully', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

        const source = new MiseVersionsSource(mockCacheService as any, '/project/mise.toml');
        const store = new RootFactStore();

        const deps: DirectDependency[] = [
            {
                name: 'node',
                ecosystem: 'mise',
                versions: [
                    {
                        version: '22.12.0',
                        latestVersion: '22.14.0',
                        usedBy: ['mise-tools'],
                        dependencyTypes: ['prod'],
                        publishDate: undefined,
                        inCatalog: false,
                    },
                ],
            },
        ];

        // Should not throw
        await source.fetch(deps, store);

        const versionsBetween = store.getVersionFact<any[]>(
            'node',
            '22.12.0',
            FactKeys.VERSIONS_BETWEEN,
        );
        expect(versionsBetween).toEqual([]);
    });
});
