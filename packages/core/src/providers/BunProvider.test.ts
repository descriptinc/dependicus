import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BunProvider } from './BunProvider';
import type { CacheService } from '../services/CacheService';

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

// Sample bun.lock content with trailing commas (JSONC format, like real bun.lock files)
const sampleBunLock = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "my-monorepo",
      "version": "0.0.0",
      "dependencies": {
        "react": "^18.0.0",
      },
      "devDependencies": {
        "vitest": "^4.0.0",
      },
    },
    "packages/web": {
      "name": "@myapp/web",
      "version": "1.0.0",
      "dependencies": {
        "react": "^18.0.0",
        "@myapp/shared": "workspace:*",
      },
      "devDependencies": {
        "jest": "^29.0.0",
      },
    },
  },
  "packages": {
    "react": ["react@18.2.0", "", {}, "sha512-abc123=="],
    "vitest": ["vitest@4.0.0", "", {}, "sha512-def456=="],
    "jest": ["jest@29.0.0", "", {}, "sha512-ghi789=="],
    "@myapp/shared": ["@myapp/shared@workspace:packages/shared"],
  },
}`;

function writeSampleRepo(dir: string): void {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-monorepo' }));
    writeFileSync(join(dir, 'bun.lock'), sampleBunLock);
}

describe('BunProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = mkdtempSync(join(tmpdir(), 'bun-provider-test-'));
        writeSampleRepo(tmpDir);
    });

    describe('getPackages', () => {
        it('parses bun.lock to PackageInfo[] format', async () => {
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, tmpDir);

            const packages = await provider.getPackages();

            // Root package
            const root = packages.find((p) => p.name === 'my-monorepo');
            expect(root).toBeDefined();
            expect(root!.version).toBe('0.0.0');
            expect(root!.dependencies).toEqual({
                react: {
                    from: 'react',
                    version: '18.2.0',
                    resolved: '',
                    path: '',
                },
            });
            expect(root!.devDependencies).toEqual({
                vitest: {
                    from: 'vitest',
                    version: '4.0.0',
                    resolved: '',
                    path: '',
                },
            });
        });

        it('caches in memory on subsequent calls', async () => {
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, tmpDir);

            const first = await provider.getPackages();
            const second = await provider.getPackages();

            expect(first).toBe(second);
        });

        it('includes workspace packages', async () => {
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, tmpDir);

            const packages = await provider.getPackages();

            const workspace = packages.find((p) => p.name === '@myapp/web');
            expect(workspace).toBeDefined();
            expect(workspace!.version).toBe('1.0.0');
            expect(workspace!.dependencies).toEqual({
                react: {
                    from: 'react',
                    version: '18.2.0',
                    resolved: '',
                    path: '',
                },
            });
            expect(workspace!.devDependencies).toEqual({
                jest: {
                    from: 'jest',
                    version: '29.0.0',
                    resolved: '',
                    path: '',
                },
            });

            // Should have root + 1 workspace = 2 total packages
            expect(packages).toHaveLength(2);
        });

        it('skips workspace: references in dependencies', async () => {
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, tmpDir);

            const packages = await provider.getPackages();

            const workspace = packages.find((p) => p.name === '@myapp/web');
            expect(workspace!.dependencies).not.toHaveProperty('@myapp/shared');
        });

        it('handles scoped packages in resolved versions', async () => {
            const lockContent = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "test-repo",
      "version": "1.0.0",
      "dependencies": {
        "@octokit/rest": "^22.0.0",
      },
    },
  },
  "packages": {
    "@octokit/rest": ["@octokit/rest@22.0.1", "", {}, "sha512-abc=="],
  },
}`;
            writeFileSync(join(tmpDir, 'bun.lock'), lockContent);

            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, tmpDir);
            const packages = await provider.getPackages();

            expect(packages[0]!.dependencies!['@octokit/rest']!.version).toBe('22.0.1');
        });
    });

    describe('isInCatalog', () => {
        it('returns true when version satisfies catalog range from package.json', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bun-catalog-'));
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    catalog: {
                        react: '^18.0.0',
                        typescript: '~5.3.0',
                    },
                }),
            );
            writeFileSync(
                join(dir, 'bun.lock'),
                '{"lockfileVersion":1,"workspaces":{},"packages":{}}',
            );
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, dir);

            expect(provider.isInCatalog('react', '18.2.0')).toBe(true);
            expect(provider.isInCatalog('typescript', '5.3.3')).toBe(true);
        });

        it('returns false when version does not satisfy catalog range', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bun-catalog-'));
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    catalog: {
                        react: '^18.0.0',
                        typescript: '~5.3.0',
                    },
                }),
            );
            writeFileSync(
                join(dir, 'bun.lock'),
                '{"lockfileVersion":1,"workspaces":{},"packages":{}}',
            );
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, dir);

            expect(provider.isInCatalog('react', '17.0.2')).toBe(false);
            expect(provider.isInCatalog('typescript', '5.4.0')).toBe(false);
        });

        it('returns false when package is not in catalog', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bun-catalog-'));
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    catalog: { react: '^18.0.0' },
                }),
            );
            writeFileSync(
                join(dir, 'bun.lock'),
                '{"lockfileVersion":1,"workspaces":{},"packages":{}}',
            );
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, dir);

            expect(provider.isInCatalog('lodash', '4.17.21')).toBe(false);
        });
    });

    describe('hasPackageInCatalog', () => {
        it('returns true when package exists in catalog', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bun-catalog-'));
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    catalog: { react: '^18.0.0', lodash: '^4.0.0' },
                }),
            );
            writeFileSync(
                join(dir, 'bun.lock'),
                '{"lockfileVersion":1,"workspaces":{},"packages":{}}',
            );
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, dir);

            expect(provider.hasPackageInCatalog('react')).toBe(true);
            expect(provider.hasPackageInCatalog('lodash')).toBe(true);
        });

        it('returns false when package is not in catalog', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bun-catalog-'));
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    catalog: { react: '^18.0.0' },
                }),
            );
            writeFileSync(
                join(dir, 'bun.lock'),
                '{"lockfileVersion":1,"workspaces":{},"packages":{}}',
            );
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, dir);

            expect(provider.hasPackageInCatalog('express')).toBe(false);
        });
    });

    describe('isPatched', () => {
        it('always returns false', () => {
            const cacheService = createMockCacheService();
            const provider = new BunProvider(cacheService, tmpDir);

            expect(provider.isPatched('react', '18.2.0')).toBe(false);
            expect(provider.isPatched('lodash', '4.17.21')).toBe(false);
            expect(provider.isPatched('anything', '1.0.0')).toBe(false);
        });
    });
});
