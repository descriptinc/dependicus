import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CacheService, PackageInfo } from '@dependicus/core';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
    execFile: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { PnpmProvider } from './PnpmProvider';

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

describe('PnpmProvider', () => {
    let tempDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), 'pnpm-provider-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    function writeWorkspaceYaml(content: string): void {
        writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), content);
    }

    function markAsPnpmInstalled(): void {
        mkdirSync(join(tempDir, 'node_modules', '.pnpm'), { recursive: true });
    }

    describe('getPackages', () => {
        it('runs pnpm list and returns parsed packages', async () => {
            writeWorkspaceYaml('');
            markAsPnpmInstalled();
            const cacheService = createMockCacheService();
            const provider = new PnpmProvider(cacheService, tempDir);
            mockExecSync.mockReturnValue(JSON.stringify(samplePackages));

            const result = await provider.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).toHaveBeenCalledWith('pnpm -r list --json --depth=0', {
                encoding: 'utf-8',
                maxBuffer: expect.any(Number),
                cwd: tempDir,
            });
        });

        it('runs `pnpm install` first when node_modules/.pnpm is missing', async () => {
            writeWorkspaceYaml('');
            const cacheService = createMockCacheService();
            const provider = new PnpmProvider(cacheService, tempDir);
            mockExecSync
                .mockReturnValueOnce('') // pnpm install
                .mockReturnValueOnce(JSON.stringify(samplePackages)); // pnpm -r list

            const result = await provider.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).toHaveBeenCalledTimes(2);
            expect(mockExecSync.mock.calls[0]![0]).toBe('pnpm install --prefer-frozen-lockfile');
            expect(mockExecSync.mock.calls[1]![0]).toBe('pnpm -r list --json --depth=0');
        });

        it('uses disk cache when lockfile unchanged', async () => {
            writeWorkspaceYaml('');
            const cacheService = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn().mockResolvedValue(JSON.stringify(samplePackages)),
            });
            const provider = new PnpmProvider(cacheService, tempDir);

            const result = await provider.getPackages();

            expect(result).toEqual(samplePackages);
            expect(mockExecSync).not.toHaveBeenCalled();
            expect(cacheService.readCache).toHaveBeenCalledWith('pnpm-list');
        });

        it('caches in memory on subsequent calls', async () => {
            writeWorkspaceYaml('');
            markAsPnpmInstalled();
            const cacheService = createMockCacheService();
            const provider = new PnpmProvider(cacheService, tempDir);
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
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

            expect(provider.isInCatalog('react', '18.2.0')).toBe(true);
            expect(provider.isInCatalog('react', '18.3.1')).toBe(true);
        });

        it('returns false when version does not satisfy catalog range', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

            expect(provider.isInCatalog('react', '17.0.0')).toBe(false);
            expect(provider.isInCatalog('react', '19.0.0')).toBe(false);
        });

        it('returns false for packages not in catalog', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

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
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

            expect(provider.hasInCatalog('react')).toBe(true);
            expect(provider.hasInCatalog('typescript')).toBe(true);
        });

        it('returns false for packages not in catalog', () => {
            writeWorkspaceYaml(`
catalog:
  react: ^18.2.0
`);
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

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
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

            expect(provider.isPatched('react', '18.2.0')).toBe(true);
            expect(provider.isPatched('lodash', '4.17.21')).toBe(true);
        });

        it('returns false for non-patched packages', () => {
            writeWorkspaceYaml(`
patchedDependencies:
  react@18.2.0: patches/react@18.2.0.patch
`);
            const provider = new PnpmProvider(createMockCacheService(), tempDir);

            expect(provider.isPatched('react', '18.3.0')).toBe(false);
            expect(provider.isPatched('vue', '3.0.0')).toBe(false);
        });
    });
});
