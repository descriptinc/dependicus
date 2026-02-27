import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PnpmService } from './PnpmService';
import type { CacheService } from './CacheService';
import type { PackageInfo } from '../types';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

const mockExecSync = vi.mocked(execSync);

function createMockCacheService(overrides: Partial<CacheService> = {}): CacheService {
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

describe('PnpmService', () => {
    let cacheService: CacheService;
    let service: PnpmService;

    const samplePackages: PackageInfo[] = [
        {
            name: '@myapp/web',
            version: '1.0.0',
            path: '/repo/apps/web',
            dependencies: {
                react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
            },
        },
        {
            name: '@myapp/api',
            version: '1.0.0',
            path: '/repo/services/api',
            devDependencies: {
                jest: { from: 'jest', version: '29.0.0', resolved: '', path: '' },
            },
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        cacheService = createMockCacheService();
        service = new PnpmService(cacheService, '/repo');
    });

    describe('getPackages', () => {
        it('runs pnpm list and returns parsed packages', async () => {
            mockExecSync.mockReturnValue(JSON.stringify(samplePackages));

            const result = await service.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).toHaveBeenCalledWith('pnpm -r list --json --depth=0', {
                encoding: 'utf-8',
                maxBuffer: expect.any(Number),
            });
        });

        it('caches results in memory on subsequent calls', async () => {
            mockExecSync.mockReturnValue(JSON.stringify(samplePackages));

            const result1 = await service.getPackages();
            const result2 = await service.getPackages();

            expect(result1).toBe(result2);
            expect(mockExecSync).toHaveBeenCalledTimes(1);
        });

        it('uses disk cache when lockfile unchanged', async () => {
            const cacheServiceWithCache = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn().mockResolvedValue(JSON.stringify(samplePackages)),
            });
            service = new PnpmService(cacheServiceWithCache, '/repo');

            const result = await service.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).not.toHaveBeenCalled();
        });

        it('writes cache after fresh pnpm run', async () => {
            const output = JSON.stringify(samplePackages);
            mockExecSync.mockReturnValue(output);

            await service.getPackages();

            expect(cacheService.writeCache).toHaveBeenCalledWith(
                'pnpm-list',
                output,
                '/repo/pnpm-lock.yaml',
            );
        });

        it('returns empty array when pnpm returns empty list', async () => {
            mockExecSync.mockReturnValue('[]');

            const result = await service.getPackages();

            expect(result).toEqual([]);
        });
    });
});
