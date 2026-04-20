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

// Shape of `aube list --json --depth=0` (root-only): a single-element array
// containing the root importer with its devDependencies populated.
const sampleRootListOutput: PackageInfo[] = [
    {
        name: 'my-monorepo',
        version: '0.0.0',
        path: '/repo',
        devDependencies: {
            oxfmt: { from: 'oxfmt', version: '0.35.0', resolved: '', path: '' },
            tsx: { from: 'tsx', version: '4.21.0', resolved: '', path: '' },
        },
    } as PackageInfo,
];

// Shape of `aube -r list --json --depth=0`: every workspace package except
// the root. Workspace-to-workspace deps are inlined with the linked package's
// version (not a link: marker), so they look like registry deps and must be
// filtered out by name.
const sampleWorkspaceListOutput: PackageInfo[] = [
    {
        name: '@myapp/shared',
        version: '1.0.0',
        path: '/repo/packages/shared',
    } as PackageInfo,
    {
        name: '@myapp/web',
        version: '1.0.0',
        path: '/repo/packages/web',
        dependencies: {
            react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
            '@myapp/shared': {
                from: '@myapp/shared',
                version: '1.0.0',
                resolved: '',
                path: '',
            },
        },
        devDependencies: {
            vitest: { from: 'vitest', version: '4.1.0', resolved: '', path: '' },
        },
    } as PackageInfo,
];

describe('AubeProvider', () => {
    let tmpDir: string;
    let savedAllowInstall: string | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = mkdtempSync(join(tmpdir(), 'aube-provider-test-'));
        savedAllowInstall = process.env.DEPENDICUS_ALLOW_INSTALL;
        // Most tests exercise the "install state already matches" path. Opt
        // out of the reinstall guard by default; the guard gets its own tests.
        delete process.env.DEPENDICUS_ALLOW_INSTALL;
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        if (savedAllowInstall === undefined) {
            delete process.env.DEPENDICUS_ALLOW_INSTALL;
        } else {
            process.env.DEPENDICUS_ALLOW_INSTALL = savedAllowInstall;
        }
    });

    function markAsAubeInstalled(): void {
        mkdirSync(join(tmpDir, 'node_modules', '.aube'), { recursive: true });
    }

    function wireAubeListMocks(): void {
        mockExecSync.mockImplementation((command: unknown) => {
            if (typeof command !== 'string') throw new Error(`unexpected exec ${String(command)}`);
            if (command.startsWith('aube -r ')) {
                return JSON.stringify(sampleWorkspaceListOutput);
            }
            if (command.startsWith('aube list')) {
                return JSON.stringify(sampleRootListOutput);
            }
            throw new Error(`unexpected exec: ${command}`);
        });
    }

    describe('getPackages', () => {
        it('concatenates root and workspace list output', async () => {
            markAsAubeInstalled();
            wireAubeListMocks();
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            const packages = await provider.getPackages();

            expect(packages.map((p) => p.name).sort()).toEqual([
                '@myapp/shared',
                '@myapp/web',
                'my-monorepo',
            ]);

            const root = packages.find((p) => p.name === 'my-monorepo');
            expect(root!.devDependencies).toEqual({
                oxfmt: { from: 'oxfmt', version: '0.35.0', resolved: '', path: '' },
                tsx: { from: 'tsx', version: '4.21.0', resolved: '', path: '' },
            });
        });

        it('filters workspace-to-workspace deps that aube inlines as registry deps', async () => {
            markAsAubeInstalled();
            wireAubeListMocks();
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            const packages = await provider.getPackages();

            const web = packages.find((p) => p.name === '@myapp/web');
            // @myapp/shared is another workspace package, so it must be
            // stripped even though aube listed it with a concrete version.
            expect(web!.dependencies).toEqual({
                react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
            });
            expect(web!.devDependencies).toEqual({
                vitest: { from: 'vitest', version: '4.1.0', resolved: '', path: '' },
            });
        });

        it('runs aube with --json --depth=0 both non-recursively and recursively, with rootDir as cwd', async () => {
            markAsAubeInstalled();
            wireAubeListMocks();
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            await provider.getPackages();

            const calls = mockExecSync.mock.calls.map((c) => c[0]);
            expect(calls).toContain('aube list --json --depth=0');
            expect(calls).toContain('aube -r list --json --depth=0');
            for (const call of mockExecSync.mock.calls) {
                expect(call[1]).toMatchObject({ cwd: tmpDir });
            }
        });

        it('runs `aube install` first when DEPENDICUS_ALLOW_INSTALL=1 and node_modules/.aube is missing', async () => {
            process.env.DEPENDICUS_ALLOW_INSTALL = '1';
            mockExecSync.mockImplementation((command: unknown) => {
                if (typeof command !== 'string') throw new Error('unexpected');
                if (command === 'aube install --frozen-lockfile') return '';
                if (command.startsWith('aube -r '))
                    return JSON.stringify(sampleWorkspaceListOutput);
                if (command.startsWith('aube list')) return JSON.stringify(sampleRootListOutput);
                throw new Error(`unexpected exec: ${command}`);
            });
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            await provider.getPackages();

            const commands = mockExecSync.mock.calls.map((c) => c[0]);
            expect(commands[0]).toBe('aube install --frozen-lockfile');
            expect(commands.slice(1).sort()).toEqual([
                'aube -r list --json --depth=0',
                'aube list --json --depth=0',
            ]);
        });

        it('skips the install and warns when DEPENDICUS_ALLOW_INSTALL is not set', async () => {
            wireAubeListMocks();
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            await provider.getPackages();

            const commands = mockExecSync.mock.calls.map((c) => c[0]);
            expect(commands).not.toContain('aube install --frozen-lockfile');
            expect(commands.sort()).toEqual([
                'aube -r list --json --depth=0',
                'aube list --json --depth=0',
            ]);
        });

        it('uses cache when lockfile unchanged', async () => {
            const cacheService = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn().mockImplementation((key: string) => {
                    if (key === 'aube-list')
                        return Promise.resolve(JSON.stringify(sampleRootListOutput));
                    if (key === 'aube-list--r')
                        return Promise.resolve(JSON.stringify(sampleWorkspaceListOutput));
                    return Promise.resolve('');
                }),
            });
            const provider = new AubeProvider(cacheService, tmpDir);

            const packages = await provider.getPackages();

            expect(mockExecSync).not.toHaveBeenCalled();
            expect(packages).toHaveLength(3);
        });

        it('caches in memory on subsequent calls', async () => {
            wireAubeListMocks();
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            const first = await provider.getPackages();
            const second = await provider.getPackages();

            expect(first).toBe(second);
            // Two calls total for the first run; second call is fully cached.
            expect(mockExecSync).toHaveBeenCalledTimes(2);
        });
    });

    describe('isInCatalog', () => {
        it('returns true when version satisfies catalog range from pnpm-workspace.yaml', () => {
            writeFileSync(
                join(tmpDir, 'pnpm-workspace.yaml'),
                `catalog:\n  react: ^18.0.0\n  typescript: ~5.3.0\n`,
            );
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.isInCatalog('react', '18.2.0')).toBe(true);
            expect(provider.isInCatalog('typescript', '5.3.3')).toBe(true);
        });

        it('returns false when version does not satisfy catalog range', () => {
            writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), `catalog:\n  react: ^18.0.0\n`);
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.isInCatalog('react', '17.0.0')).toBe(false);
            expect(provider.isInCatalog('react', '19.0.0')).toBe(false);
        });

        it('returns false for packages not in catalog', () => {
            writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), `catalog:\n  react: ^18.0.0\n`);
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.isInCatalog('vue', '3.0.0')).toBe(false);
        });
    });

    describe('hasInCatalog', () => {
        it('returns true for packages in catalog', () => {
            writeFileSync(
                join(tmpDir, 'pnpm-workspace.yaml'),
                `catalog:\n  react: ^18.0.0\n  lodash: ^4.0.0\n`,
            );
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.hasInCatalog('react')).toBe(true);
            expect(provider.hasInCatalog('lodash')).toBe(true);
        });

        it('returns false for packages not in catalog', () => {
            writeFileSync(join(tmpDir, 'pnpm-workspace.yaml'), `catalog:\n  react: ^18.0.0\n`);
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.hasInCatalog('express')).toBe(false);
        });
    });

    describe('isPatched', () => {
        it('returns true for patched packages', () => {
            writeFileSync(
                join(tmpDir, 'pnpm-workspace.yaml'),
                `patchedDependencies:\n  react@18.2.0: patches/react@18.2.0.patch\n`,
            );
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.isPatched('react', '18.2.0')).toBe(true);
        });

        it('returns false for non-patched packages', () => {
            writeFileSync(
                join(tmpDir, 'pnpm-workspace.yaml'),
                `patchedDependencies:\n  react@18.2.0: patches/react@18.2.0.patch\n`,
            );
            const provider = new AubeProvider(createMockCacheService(), tmpDir);

            expect(provider.isPatched('react', '18.3.0')).toBe(false);
            expect(provider.isPatched('vue', '3.0.0')).toBe(false);
        });
    });
});
