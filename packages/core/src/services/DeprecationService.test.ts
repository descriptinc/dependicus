import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeprecationService } from './DeprecationService';
import type { CacheService } from './CacheService';

// The mock execFile needs [util.promisify.custom] so that promisify(execFile)
// returns { stdout, stderr } instead of just the first callback arg.
const { mockExecFilePromisified } = vi.hoisted(() => ({
    mockExecFilePromisified: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    const util = await import('node:util');
    const mockExecFile = vi.fn();
    (mockExecFile as unknown as Record<symbol, unknown>)[util.promisify.custom] =
        mockExecFilePromisified;
    return {
        ...actual,
        execSync: vi.fn(),
        execFile: mockExecFile,
    };
});

vi.mock('node:fs', () => ({
    existsSync: vi.fn().mockReturnValue(false),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, unlinkSync } from 'node:fs';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);

/** Make the next execFileAsync call resolve with { stdout }. */
function mockExecFileReturns(stdout: string): void {
    mockExecFilePromisified.mockResolvedValueOnce({ stdout, stderr: '' });
}

/** Make the next execFileAsync call reject with an error. */
function mockExecFileThrows(message: string): void {
    mockExecFilePromisified.mockRejectedValueOnce(new Error(message));
}
const mockCopyFileSync = vi.mocked(copyFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

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

describe('DeprecationService', () => {
    let cacheService: CacheService;
    let service: DeprecationService;

    beforeEach(() => {
        vi.clearAllMocks();
        cacheService = createMockCacheService();
        service = new DeprecationService(cacheService, '/repo');
    });

    describe('getDeprecatedPackages', () => {
        it('parses direct deprecated packages from pnpm output', async () => {
            const pnpmOutput = [
                'Scope: all 50 workspace projects',
                'services/api                             |  WARN  deprecated elevenlabs@1.59.0',
                'services/api                             |  WARN  deprecated old-lib@2.3.0',
                'Done in 5s',
            ].join('\n');

            mockExecSync.mockReturnValue(pnpmOutput);

            const result = await service.getDeprecatedPackages();

            expect(result).toEqual(new Set(['elevenlabs@1.59.0', 'old-lib@2.3.0']));
        });

        it('parses transitive deprecated subdependencies', async () => {
            const pnpmOutput = [
                ' WARN  3 deprecated subdependencies found: pkg-a@1.0.0, pkg-b@2.0.0, pkg-c@3.0.0',
            ].join('\n');

            mockExecSync.mockReturnValue(pnpmOutput);

            const result = await service.getDeprecatedPackages();

            expect(result).toEqual(new Set(['pkg-a@1.0.0', 'pkg-b@2.0.0', 'pkg-c@3.0.0']));
        });

        it('combines direct and transitive deprecated packages', async () => {
            const pnpmOutput = [
                'apps/web                                 |  WARN  deprecated direct-dep@1.0.0',
                ' WARN  2 deprecated subdependencies found: transitive-a@1.0.0, transitive-b@2.0.0',
            ].join('\n');

            mockExecSync.mockReturnValue(pnpmOutput);

            const result = await service.getDeprecatedPackages();

            expect(result).toEqual(
                new Set(['direct-dep@1.0.0', 'transitive-a@1.0.0', 'transitive-b@2.0.0']),
            );
        });

        it('returns empty set when no deprecated packages found', async () => {
            mockExecSync.mockReturnValue('Scope: all 50 workspace projects\nDone in 5s\n');

            const result = await service.getDeprecatedPackages();

            expect(result).toEqual(new Set());
        });

        it('uses cached output when lockfile unchanged', async () => {
            const cachedOutput =
                'services/api                             |  WARN  deprecated cached-pkg@1.0.0';
            cacheService = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn().mockResolvedValue(cachedOutput),
            });
            service = new DeprecationService(cacheService, '/repo');

            const result = await service.getDeprecatedPackages();

            expect(result).toEqual(new Set(['cached-pkg@1.0.0']));
            expect(mockExecSync).not.toHaveBeenCalled();
        });

        it('backs up and restores lockfile', async () => {
            mockExistsSync.mockReturnValue(true);
            mockExecSync.mockReturnValue('');

            await service.getDeprecatedPackages();

            expect(mockCopyFileSync).toHaveBeenCalledWith(
                '/repo/pnpm-lock.yaml',
                '/repo/pnpm-lock.yaml.bak',
            );
            // Restore after
            expect(mockCopyFileSync).toHaveBeenCalledWith(
                '/repo/pnpm-lock.yaml.bak',
                '/repo/pnpm-lock.yaml',
            );
            expect(mockUnlinkSync).toHaveBeenCalledWith('/repo/pnpm-lock.yaml.bak');
        });

        it('restores lockfile even when pnpm fails', async () => {
            mockExistsSync.mockReturnValue(true);
            mockExecSync.mockImplementation(() => {
                throw new Error('pnpm failed');
            });

            await expect(service.getDeprecatedPackages()).rejects.toThrow('pnpm failed');

            expect(mockCopyFileSync).toHaveBeenCalledWith(
                '/repo/pnpm-lock.yaml.bak',
                '/repo/pnpm-lock.yaml',
            );
        });

        it('caches results in memory on subsequent calls', async () => {
            mockExecSync.mockReturnValue(
                'services/api                             |  WARN  deprecated pkg@1.0.0',
            );

            const result1 = await service.getDeprecatedPackages();
            const result2 = await service.getDeprecatedPackages();

            expect(result1).toBe(result2);
            expect(mockExecSync).toHaveBeenCalledTimes(1);
        });
    });

    describe('isDeprecated', () => {
        it('returns true for deprecated packages', async () => {
            mockExecSync.mockReturnValue(
                'services/api                             |  WARN  deprecated some-pkg@1.0.0',
            );

            const result = await service.isDeprecated('some-pkg', '1.0.0');

            expect(result).toBe(true);
        });

        it('returns false for non-deprecated packages', async () => {
            mockExecSync.mockReturnValue('');

            const result = await service.isDeprecated('safe-pkg', '2.0.0');

            expect(result).toBe(false);
        });
    });

    describe('getDeprecationMap', () => {
        it('traces deprecated packages with pnpm why', async () => {
            // First call: getDeprecatedPackages
            const resolutionOutput =
                'apps/web                                 |  WARN  deprecated old-lib@1.0.0';
            const isCacheValid = vi.fn();
            // First call (resolution-only) -> cache miss
            isCacheValid.mockResolvedValueOnce(false);
            // Second call (pnpm-why) -> cache miss
            isCacheValid.mockResolvedValueOnce(false);

            cacheService = createMockCacheService({ isCacheValid });
            service = new DeprecationService(cacheService, '/repo');

            // pnpm install --resolution-only
            mockExecSync.mockReturnValueOnce(resolutionOutput);

            // pnpm -r why old-lib@1.0.0 --json
            const whyOutput = JSON.stringify([
                {
                    name: '@myapp/web',
                    dependencies: { 'some-wrapper': { version: '2.0.0' } },
                },
            ]);
            mockExecFileReturns(whyOutput);

            const result = await service.getDeprecationMap();

            expect(result.get('old-lib@1.0.0')).toEqual(['some-wrapper']);
        });

        it('skips malformed entries (no @ separator)', async () => {
            const resolutionOutput =
                ' WARN  1 deprecated subdependencies found: malformed-no-version';
            mockExecSync.mockReturnValueOnce(resolutionOutput);

            const result = await service.getDeprecationMap();

            expect(result.size).toBe(0);
        });

        it('caches map in memory on subsequent calls', async () => {
            mockExecSync.mockReturnValue('');

            const result1 = await service.getDeprecationMap();
            const result2 = await service.getDeprecationMap();

            expect(result1).toBe(result2);
        });

        it('handles pnpm why errors gracefully', async () => {
            const resolutionOutput =
                'apps/web                                 |  WARN  deprecated broken-pkg@1.0.0';
            const isCacheValid = vi.fn();
            isCacheValid.mockResolvedValueOnce(false);
            isCacheValid.mockResolvedValueOnce(false);

            cacheService = createMockCacheService({ isCacheValid });
            service = new DeprecationService(cacheService, '/repo');

            // pnpm install --resolution-only
            mockExecSync.mockReturnValueOnce(resolutionOutput);
            // pnpm -r why throws
            mockExecFileThrows('package not found');

            const result = await service.getDeprecationMap();

            // Should not throw, just returns empty list for that package
            expect(result.has('broken-pkg@1.0.0')).toBe(false);
        });
    });

    describe('getDeprecatedTransitiveDeps', () => {
        it('returns transitive deprecated deps brought in by a direct dep', async () => {
            const resolutionOutput =
                'apps/web                                 |  WARN  deprecated transitive-dep@1.0.0';
            const isCacheValid = vi.fn();
            isCacheValid.mockResolvedValueOnce(false);
            isCacheValid.mockResolvedValueOnce(false);

            cacheService = createMockCacheService({ isCacheValid });
            service = new DeprecationService(cacheService, '/repo');

            mockExecSync.mockReturnValueOnce(resolutionOutput);

            const whyOutput = JSON.stringify([
                {
                    name: '@myapp/web',
                    dependencies: { 'my-wrapper': { version: '2.0.0' } },
                },
            ]);
            mockExecFileReturns(whyOutput);

            const allDirectDeps = new Set(['my-wrapper', 'react']);
            const result = await service.getDeprecatedTransitiveDeps(
                'my-wrapper',
                allDirectDeps,
            );

            expect(result).toEqual(['transitive-dep@1.0.0']);
        });

        it('excludes deprecated packages that are themselves direct dependencies', async () => {
            const resolutionOutput =
                'apps/web                                 |  WARN  deprecated direct-pkg@1.0.0';
            const isCacheValid = vi.fn();
            isCacheValid.mockResolvedValueOnce(false);
            isCacheValid.mockResolvedValueOnce(false);

            cacheService = createMockCacheService({ isCacheValid });
            service = new DeprecationService(cacheService, '/repo');

            mockExecSync.mockReturnValueOnce(resolutionOutput);

            const whyOutput = JSON.stringify([
                {
                    name: '@myapp/web',
                    dependencies: { 'my-wrapper': { version: '2.0.0' } },
                },
            ]);
            mockExecFileReturns(whyOutput);

            // direct-pkg is also a direct dep -> should be excluded
            const allDirectDeps = new Set(['my-wrapper', 'direct-pkg']);
            const result = await service.getDeprecatedTransitiveDeps(
                'my-wrapper',
                allDirectDeps,
            );

            expect(result).toEqual([]);
        });
    });

    describe('warmCaches', () => {
        it('calls both getDeprecatedPackages and getDeprecationMap', async () => {
            mockExecSync.mockReturnValue('');

            await service.warmCaches();

            // Both should have been called (and results cached)
            const packages = await service.getDeprecatedPackages();
            const map = await service.getDeprecationMap();
            expect(packages).toBeDefined();
            expect(map).toBeDefined();
            // execSync should have been called exactly once (for getDeprecatedPackages)
            // getDeprecationMap reuses the result
            expect(mockExecSync).toHaveBeenCalledTimes(1);
        });
    });
});
