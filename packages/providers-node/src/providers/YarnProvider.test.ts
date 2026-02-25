import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { YarnProvider } from './YarnProvider';
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

const sampleYarnLock = `__metadata:
  version: 8
  cacheKey: 10c0

"react@npm:^18.0.0":
  version: 18.2.0
  resolution: "react@npm:18.2.0"
  checksum: 10c0-abc123
  languageName: node
  linkType: hard

"vitest@npm:^4.0.0":
  version: 4.0.0
  resolution: "vitest@npm:4.0.0"
  checksum: 10c0-def456
  languageName: node
  linkType: hard

"jest@npm:^29.0.0":
  version: 29.0.0
  resolution: "jest@npm:29.0.0"
  checksum: 10c0-ghi789
  languageName: node
  linkType: hard

"@myapp/shared@workspace:packages/shared":
  version: 0.0.0-use.local
  resolution: "@myapp/shared@workspace:packages/shared"
  languageName: unknown
  linkType: soft
`;

function writeSampleRepo(dir: string): void {
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
            name: 'my-monorepo',
            version: '0.0.0',
            workspaces: ['packages/*'],
            dependencies: { react: '^18.0.0' },
            devDependencies: { vitest: '^4.0.0' },
        }),
    );
    writeFileSync(join(dir, 'yarn.lock'), sampleYarnLock);

    const webDir = join(dir, 'packages', 'web');
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
        join(webDir, 'package.json'),
        JSON.stringify({
            name: '@myapp/web',
            version: '1.0.0',
            dependencies: { react: '^18.0.0', '@myapp/shared': 'workspace:*' },
            devDependencies: { jest: '^29.0.0' },
        }),
    );
}

describe('YarnProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = mkdtempSync(join(tmpdir(), 'yarn-provider-test-'));
        writeSampleRepo(tmpDir);
    });

    describe('getPackages', () => {
        it('parses yarn.lock to PackageInfo[] format', async () => {
            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();

            const root = packages.find((p) => p.name === 'my-monorepo');
            expect(root).toBeDefined();
            expect(root!.version).toBe('0.0.0');
            expect(root!.dependencies).toEqual({
                react: { from: 'react', version: '18.2.0', resolved: '', path: '' },
            });
        });

        it('caches in memory on subsequent calls', async () => {
            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            const first = await provider.getPackages();
            const second = await provider.getPackages();
            expect(first).toBe(second);
        });

        it('includes workspace packages', async () => {
            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();
            expect(packages).toHaveLength(2);
            expect(packages.find((p) => p.name === '@myapp/web')).toBeDefined();
        });

        it('skips workspace: references in dependencies', async () => {
            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            const packages = await provider.getPackages();
            const workspace = packages.find((p) => p.name === '@myapp/web');
            expect(workspace!.dependencies).not.toHaveProperty('@myapp/shared');
        });
    });

    describe('isInCatalog', () => {
        it('always returns false', () => {
            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            expect(provider.isInCatalog('react', '18.2.0')).toBe(false);
        });
    });

    describe('isPatched', () => {
        it('returns false when no patches exist', () => {
            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            expect(provider.isPatched('react', '18.2.0')).toBe(false);
        });

        it('detects user-applied patch: protocol entries', () => {
            const lockContent = `__metadata:
  version: 8
  cacheKey: 10c0

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: 10c0-abc
  languageName: node
  linkType: hard

"lodash@patch:lodash@npm%3A4.17.21#./.yarn/patches/lodash-npm-4.17.21-abc123.patch":
  version: 4.17.21
  resolution: "lodash@patch:lodash@npm%3A4.17.21#./.yarn/patches/lodash-npm-4.17.21-abc123.patch::version=4.17.21&hash=abc123"
  languageName: node
  linkType: hard
`;
            writeFileSync(join(tmpDir, 'yarn.lock'), lockContent);

            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            expect(provider.isPatched('lodash', '4.17.21')).toBe(true);
            expect(provider.isPatched('react', '18.2.0')).toBe(false);
        });

        it('does not flag builtin optional patches as user patches', () => {
            const lockContent = `__metadata:
  version: 8
  cacheKey: 10c0

"typescript@npm:^5.9.3":
  version: 5.9.3
  resolution: "typescript@npm:5.9.3"
  checksum: 10c0-abc
  languageName: node
  linkType: hard

"typescript@patch:typescript@npm%3A^5.9.3#optional!builtin<compat/typescript>":
  version: 5.9.3
  resolution: "typescript@patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>::version=5.9.3&hash=abc"
  languageName: node
  linkType: hard
`;
            writeFileSync(join(tmpDir, 'yarn.lock'), lockContent);

            const provider = new YarnProvider(createMockCacheService(), tmpDir);
            expect(provider.isPatched('typescript', '5.9.3')).toBe(false);
        });
    });
});
