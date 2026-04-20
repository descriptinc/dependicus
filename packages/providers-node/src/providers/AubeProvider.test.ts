import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CacheService, PackageInfo } from '@dependicus/core';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
    execFile: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { AubeProvider } from './AubeProvider';

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

describe('AubeProvider', () => {
    let tempDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), 'aube-provider-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    function writeWorkspaceYaml(content: string): void {
        writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), content);
    }

    describe('getPackages', () => {
        it('runs aube list and returns parsed packages', async () => {
            writeWorkspaceYaml('');
            const cacheService = createMockCacheService();
            const provider = new AubeProvider(cacheService, tempDir);
            mockExecSync.mockReturnValue(JSON.stringify(samplePackages));

            const result = await provider.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).toHaveBeenCalledWith('aube -r list --json --depth=0', {
                encoding: 'utf-8',
                maxBuffer: expect.any(Number),
                cwd: tempDir,
            });
        });

        it('uses disk cache when lockfile unchanged', async () => {
            writeWorkspaceYaml('');
            const cacheService = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn().mockResolvedValue(JSON.stringify(samplePackages)),
            });
            const provider = new AubeProvider(cacheService, tempDir);

            const result = await provider.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).not.toHaveBeenCalled();
            expect(cacheService.readCache).toHaveBeenCalledWith('aube-list');
        });

        it('caches in memory on subsequent calls', async () => {
            writeWorkspaceYaml('');
            const cacheService = createMockCacheService();
            const provider = new AubeProvider(cacheService, tempDir);
            mockExecSync.mockReturnValue(JSON.stringify(samplePackages));

            const result1 = await provider.getPackages();
            const result2 = await provider.getPackages();

            expect(result1).toBe(result2);
            expect(mockExecSync).toHaveBeenCalledTimes(1);
        });
    });

    describe('isInCatalog', () => {
        it('returns true when version satisfies catalog range', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.isInCatalog('react', '18.2.0')).toBe(true);
            expect(provider.isInCatalog('react', '18.3.1')).toBe(true);
        });

        it('returns false when version does not satisfy catalog range', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.isInCatalog('react', '17.0.0')).toBe(false);
            expect(provider.isInCatalog('react', '19.0.0')).toBe(false);
        });

        it('returns false for packages not in catalog', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.isInCatalog('vue', '3.0.0')).toBe(false);
        });
    });

    describe('hasInCatalog', () => {
        it('returns true for packages in catalog', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
  typescript: ~5.3.0
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.hasInCatalog('react')).toBe(true);
            expect(provider.hasInCatalog('typescript')).toBe(true);
        });

        it('returns false for packages not in catalog', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.hasInCatalog('vue')).toBe(false);
        });
    });

    describe('isPatched', () => {
        it('returns true for patched packages', () => {
            writeWorkspaceYaml(`
patchedDependencies:
  react@18.2.0: patches/react@18.2.0.patch
  lodash@4.17.21: patches/lodash@4.17.21.patch
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.isPatched('react', '18.2.0')).toBe(true);
            expect(provider.isPatched('lodash', '4.17.21')).toBe(true);
        });

        it('returns false for non-patched packages', () => {
            writeWorkspaceYaml(`
patchedDependencies:
  react@18.2.0: patches/react@18.2.0.patch
`);
            const provider = new AubeProvider(createMockCacheService(), tempDir);

            expect(provider.isPatched('react', '18.3.0')).toBe(false);
            expect(provider.isPatched('vue', '3.0.0')).toBe(false);
        });
    });
});
