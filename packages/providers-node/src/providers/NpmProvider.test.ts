import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NpmProvider } from './NpmProvider';
import type { CacheService } from '@dependicus/core';

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

const samplePackageLock = JSON.stringify(
    {
        name: 'my-monorepo',
        version: '0.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
            '': {
                name: 'my-monorepo',
                version: '0.0.0',
                workspaces: ['packages/*'],
                dependencies: { react: '^18.0.0' },
                devDependencies: { vitest: '^4.0.0' },
            },
            'packages/web': {
                name: '@myapp/web',
                version: '1.0.0',
                dependencies: { react: '^18.0.0', '@myapp/shared': '*' },
                devDependencies: { jest: '^29.0.0' },
            },
            'node_modules/react': {
                version: '18.2.0',
                resolved: 'https://registry.npmjs.org/react/-/react-18.2.0.tgz',
                integrity: 'sha512-abc123==',
            },
            'node_modules/vitest': {
                version: '4.0.0',
                resolved: 'https://registry.npmjs.org/vitest/-/vitest-4.0.0.tgz',
                integrity: 'sha512-def456==',
            },
            'node_modules/jest': {
                version: '29.0.0',
                resolved: 'https://registry.npmjs.org/jest/-/jest-29.0.0.tgz',
                integrity: 'sha512-ghi789==',
            },
            'node_modules/@myapp/shared': { resolved: 'packages/shared', link: true },
        },
    },
    null,
    4,
);

function writeSampleRepo(dir: string): void {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-monorepo' }));
    writeFileSync(join(dir, 'package-lock.json'), samplePackageLock);
}

describe('NpmProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = mkdtempSync(join(tmpdir(), 'npm-provider-test-'));
        writeSampleRepo(tmpDir);
    });

    describe('getPackages', () => {
        it('parses package-lock.json to PackageInfo[] format', async () => {
            const provider = new NpmProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();

            const root = packages.find((p) => p.name === 'my-monorepo');
            expect(root).toBeDefined();
            expect(root!.version).toBe('0.0.0');
            expect(root!.dependencies).toEqual({
                react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
            });
            expect(root!.devDependencies).toEqual({
                vitest: { from: 'vitest', version: '4.0.0', resolved: '', path: '' },
            });
        });

        it('caches in memory on subsequent calls', async () => {
            const provider = new NpmProvider(createMockCacheService(), tmpDir);
            const first = await provider.getPackages();
            const second = await provider.getPackages();
            expect(first).toBe(second);
        });

        it('includes workspace packages', async () => {
            const provider = new NpmProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();

            const workspace = packages.find((p) => p.name === '@myapp/web');
            expect(workspace).toBeDefined();
            expect(workspace!.version).toBe('1.0.0');
            expect(packages).toHaveLength(2);
        });

        it('skips workspace link references in dependencies', async () => {
            const provider = new NpmProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();
            const workspace = packages.find((p) => p.name === '@myapp/web');
            expect(workspace!.dependencies).not.toHaveProperty('@myapp/shared');
        });

        it('handles scoped packages in resolved versions', async () => {
            const lockContent = JSON.stringify(
                {
                    name: 'test-repo',
                    version: '1.0.0',
                    lockfileVersion: 3,
                    requires: true,
                    packages: {
                        '': {
                            name: 'test-repo',
                            version: '1.0.0',
                            dependencies: { '@octokit/rest': '^22.0.0' },
                        },
                        'node_modules/@octokit/rest': {
                            version: '22.0.1',
                            resolved: 'https://registry.npmjs.org/@octokit/rest/-/rest-22.0.1.tgz',
                            integrity: 'sha512-abc==',
                        },
                    },
                },
                null,
                4,
            );
            writeFileSync(join(tmpDir, 'package-lock.json'), lockContent);

            const provider = new NpmProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();
            expect(packages[0]!.dependencies!['@octokit/rest']!.version).toBe('22.0.1');
        });
    });

    describe('isInCatalog', () => {
        it('always returns false', () => {
            expect(
                new NpmProvider(createMockCacheService(), tmpDir).isInCatalog('react', '18.2.0'),
            ).toBe(false);
        });
    });

    describe('hasInCatalog', () => {
        it('always returns false', () => {
            expect(new NpmProvider(createMockCacheService(), tmpDir).hasInCatalog('react')).toBe(
                false,
            );
        });
    });

    describe('isPatched', () => {
        it('always returns false', () => {
            const provider = new NpmProvider(createMockCacheService(), tmpDir);
            expect(provider.isPatched('react', '18.2.0')).toBe(false);
        });
    });
});
