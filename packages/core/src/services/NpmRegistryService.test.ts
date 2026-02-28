import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NpmRegistryService } from './NpmRegistryService';
import type { CacheService } from './CacheService';

function createMockCacheService(overrides = {}): CacheService {
    return {
        isCacheValid: vi.fn().mockResolvedValue(false),
        readCache: vi.fn().mockResolvedValue(''),
        writeCache: vi.fn().mockResolvedValue(undefined),
        writePermanentCache: vi.fn().mockResolvedValue(undefined),
        hasPermanentCache: vi.fn().mockReturnValue(false),
        readPermanentCache: vi.fn().mockResolvedValue(undefined),
        getLastReleaseFetchHash: vi.fn().mockResolvedValue(undefined),
        setLastReleaseFetchHash: vi.fn().mockResolvedValue(undefined),
        hasLockfileChangedSinceLastFetch: vi.fn().mockResolvedValue(true),
        ...overrides,
    } as unknown as CacheService;
}

describe('NpmRegistryService', () => {
    let service: NpmRegistryService;
    let cacheService: CacheService;

    beforeEach(() => {
        vi.clearAllMocks();
        cacheService = createMockCacheService();
        service = new NpmRegistryService(cacheService, '/fake/lockfile');
    });

    describe('getVersionsBetween', () => {
        it('handles versions as an object (npm registry format)', async () => {
            const metadata = {
                name: 'react',
                version: '18.3.1',
                versions: {
                    '18.0.0': {},
                    '18.1.0': {},
                    '18.2.0': {},
                    '18.3.0': {},
                    '18.3.1': {},
                },
                time: {
                    '18.0.0': '2022-03-29T00:00:00.000Z',
                    '18.1.0': '2022-04-26T00:00:00.000Z',
                    '18.2.0': '2022-06-14T00:00:00.000Z',
                    '18.3.0': '2024-04-25T00:00:00.000Z',
                    '18.3.1': '2024-04-26T00:00:00.000Z',
                },
            };

            vi.spyOn(service, 'getFullPackageMetadata').mockResolvedValue(metadata);

            const versions = await service.getVersionsBetween('react', '18.1.0', '18.3.1');

            expect(versions).toHaveLength(3);
            expect(versions.map((v) => v.version)).toEqual(['18.2.0', '18.3.0', '18.3.1']);
        });

        it('handles versions as an array (legacy cached format)', async () => {
            const metadata = {
                name: 'react',
                version: '18.3.1',
                versions: ['18.0.0', '18.1.0', '18.2.0', '18.3.0', '18.3.1'],
                time: {
                    '18.0.0': '2022-03-29T00:00:00.000Z',
                    '18.1.0': '2022-04-26T00:00:00.000Z',
                    '18.2.0': '2022-06-14T00:00:00.000Z',
                    '18.3.0': '2024-04-25T00:00:00.000Z',
                    '18.3.1': '2024-04-26T00:00:00.000Z',
                },
            };

            vi.spyOn(service, 'getFullPackageMetadata').mockResolvedValue(metadata);

            const versions = await service.getVersionsBetween('react', '18.1.0', '18.3.1');

            expect(versions).toHaveLength(3);
            expect(versions.map((v) => v.version)).toEqual(['18.2.0', '18.3.0', '18.3.1']);
        });

        it('skips prereleases', async () => {
            const metadata = {
                name: 'react',
                version: '19.0.0',
                versions: {
                    '18.2.0': {},
                    '19.0.0-rc.1': {},
                    '19.0.0': {},
                },
                time: {
                    '18.2.0': '2022-06-14T00:00:00.000Z',
                    '19.0.0-rc.1': '2024-10-01T00:00:00.000Z',
                    '19.0.0': '2024-12-05T00:00:00.000Z',
                },
            };

            vi.spyOn(service, 'getFullPackageMetadata').mockResolvedValue(metadata);

            const versions = await service.getVersionsBetween('react', '18.2.0', '19.0.0');

            expect(versions.map((v) => v.version)).toEqual(['19.0.0']);
        });

        it('returns empty array when current equals latest', async () => {
            const versions = await service.getVersionsBetween('react', '18.2.0', '18.2.0');
            expect(versions).toEqual([]);
        });

        it('returns empty array when metadata is missing', async () => {
            vi.spyOn(service, 'getFullPackageMetadata').mockResolvedValue(undefined);

            const versions = await service.getVersionsBetween('react', '18.0.0', '18.2.0');
            expect(versions).toEqual([]);
        });
    });
});
