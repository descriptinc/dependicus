import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CargoProvider, parsePackageId } from './CargoProvider';
import type { CacheService } from '@dependicus/core';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

// Realistic `cargo metadata --format-version 1` output for a workspace with one member
const singleWorkspaceMetadata = JSON.stringify({
    packages: [
        {
            id: 'path+file:///project#my-app@0.1.0',
            name: 'my-app',
            version: '0.1.0',
            source: null,
            manifest_path: '/project/Cargo.toml',
        },
        {
            id: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.210',
            name: 'serde',
            version: '1.0.210',
            source: 'registry+https://github.com/rust-lang/crates.io-index',
            manifest_path: '/home/user/.cargo/registry/src/serde-1.0.210/Cargo.toml',
        },
        {
            id: 'registry+https://github.com/rust-lang/crates.io-index#tokio@1.40.0',
            name: 'tokio',
            version: '1.40.0',
            source: 'registry+https://github.com/rust-lang/crates.io-index',
            manifest_path: '/home/user/.cargo/registry/src/tokio-1.40.0/Cargo.toml',
        },
        {
            id: 'registry+https://github.com/rust-lang/crates.io-index#criterion@0.5.1',
            name: 'criterion',
            version: '0.5.1',
            source: 'registry+https://github.com/rust-lang/crates.io-index',
            manifest_path: '/home/user/.cargo/registry/src/criterion-0.5.1/Cargo.toml',
        },
    ],
    workspace_members: ['path+file:///project#my-app@0.1.0'],
    resolve: {
        nodes: [
            {
                id: 'path+file:///project#my-app@0.1.0',
                deps: [
                    {
                        name: 'serde',
                        pkg: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.210',
                        dep_kinds: [{ kind: null, target: null }],
                    },
                    {
                        name: 'tokio',
                        pkg: 'registry+https://github.com/rust-lang/crates.io-index#tokio@1.40.0',
                        dep_kinds: [{ kind: null, target: null }],
                    },
                    {
                        name: 'criterion',
                        pkg: 'registry+https://github.com/rust-lang/crates.io-index#criterion@0.5.1',
                        dep_kinds: [{ kind: 'dev', target: null }],
                    },
                ],
            },
        ],
    },
});

// Metadata with a path dependency (workspace-local)
const pathDepMetadata = JSON.stringify({
    packages: [
        {
            id: 'path+file:///project#my-app@0.1.0',
            name: 'my-app',
            version: '0.1.0',
            source: null,
            manifest_path: '/project/Cargo.toml',
        },
        {
            id: 'path+file:///project/my-lib#my-lib@0.1.0',
            name: 'my-lib',
            version: '0.1.0',
            source: null,
            manifest_path: '/project/my-lib/Cargo.toml',
        },
        {
            id: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.210',
            name: 'serde',
            version: '1.0.210',
            source: 'registry+https://github.com/rust-lang/crates.io-index',
            manifest_path: '/home/user/.cargo/registry/src/serde-1.0.210/Cargo.toml',
        },
    ],
    workspace_members: ['path+file:///project#my-app@0.1.0'],
    resolve: {
        nodes: [
            {
                id: 'path+file:///project#my-app@0.1.0',
                deps: [
                    {
                        name: 'my-lib',
                        pkg: 'path+file:///project/my-lib#my-lib@0.1.0',
                        dep_kinds: [{ kind: null, target: null }],
                    },
                    {
                        name: 'serde',
                        pkg: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.210',
                        dep_kinds: [{ kind: null, target: null }],
                    },
                ],
            },
        ],
    },
});

// Metadata with a build dependency
const buildDepMetadata = JSON.stringify({
    packages: [
        {
            id: 'path+file:///project#my-app@0.1.0',
            name: 'my-app',
            version: '0.1.0',
            source: null,
            manifest_path: '/project/Cargo.toml',
        },
        {
            id: 'registry+https://github.com/rust-lang/crates.io-index#cc@1.1.0',
            name: 'cc',
            version: '1.1.0',
            source: 'registry+https://github.com/rust-lang/crates.io-index',
            manifest_path: '/home/user/.cargo/registry/src/cc-1.1.0/Cargo.toml',
        },
    ],
    workspace_members: ['path+file:///project#my-app@0.1.0'],
    resolve: {
        nodes: [
            {
                id: 'path+file:///project#my-app@0.1.0',
                deps: [
                    {
                        name: 'cc',
                        pkg: 'registry+https://github.com/rust-lang/crates.io-index#cc@1.1.0',
                        dep_kinds: [{ kind: 'build', target: null }],
                    },
                ],
            },
        ],
    },
});

describe('CargoProvider', () => {
    const mockCacheService = {
        isCacheValid: vi.fn().mockResolvedValue(false),
        readCache: vi.fn(),
        writeCache: vi.fn().mockResolvedValue(undefined),
        hasPermanentCache: vi.fn().mockReturnValue(false),
        readPermanentCache: vi.fn(),
        writePermanentCache: vi.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
    const rootDir = '/project';

    beforeEach(() => {
        vi.clearAllMocks();
        (mockCacheService.isCacheValid as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        (mockCacheService.writeCache as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn());
    });

    it('has correct name and ecosystem', () => {
        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.name).toBe('rust');
        expect(provider.ecosystem).toBe('cargo');
        expect(provider.supportsCatalog).toBe(false);
    });

    it('discovers Cargo.lock files and returns containing directories', () => {
        vi.mocked(execSync).mockReturnValueOnce('Cargo.lock\nservices/api/Cargo.lock\n');

        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual(['.', 'services/api']);
    });

    it('lockfilePath points to first discovered Cargo.lock', () => {
        vi.mocked(execSync).mockReturnValueOnce('services/api/Cargo.lock\n');

        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.lockfilePath).toBe('/project/services/api/Cargo.lock');
    });

    it('lockfilePath falls back to root when Cargo.lock is at root', () => {
        vi.mocked(execSync).mockReturnValueOnce('Cargo.lock\n');

        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.lockfilePath).toBe('/project/Cargo.lock');
    });

    it('parses workspace metadata with prod and dev deps', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('Cargo.lock\n') // git ls-files
            .mockReturnValueOnce(singleWorkspaceMetadata); // cargo metadata

        const provider = new CargoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        expect(packages[0]!.name).toBe('project');
        expect(packages[0]!.version).toBe('0.1.0');

        const deps = packages[0]!.dependencies!;
        expect(Object.keys(deps).sort()).toEqual(['serde', 'tokio']);
        expect(deps['serde']!.version).toBe('1.0.210');
        expect(deps['tokio']!.version).toBe('1.40.0');

        const devDeps = packages[0]!.devDependencies!;
        expect(Object.keys(devDeps)).toEqual(['criterion']);
        expect(devDeps['criterion']!.version).toBe('0.5.1');
    });

    it('skips path dependencies (workspace-local crates)', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('Cargo.lock\n') // git ls-files
            .mockReturnValueOnce(pathDepMetadata); // cargo metadata

        const provider = new CargoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        const deps = packages[0]!.dependencies!;
        // my-lib is a path dep and should be skipped
        expect(deps['my-lib']).toBeUndefined();
        expect(deps['serde']!.version).toBe('1.0.210');
    });

    it('classifies build dependencies as prod (not dev-only)', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('Cargo.lock\n') // git ls-files
            .mockReturnValueOnce(buildDepMetadata); // cargo metadata

        const provider = new CargoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        // build deps should appear in dependencies, not devDependencies
        const deps = packages[0]!.dependencies!;
        expect(deps['cc']!.version).toBe('1.1.0');
        expect(packages[0]!.devDependencies).toBeUndefined();
    });

    it('returns empty when cargo metadata fails', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('Cargo.lock\n') // git ls-files
            .mockImplementationOnce(() => {
                throw new Error('cargo not found');
            }); // cargo metadata

        const provider = new CargoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toEqual([]);
    });

    it('falls back to root when git ls-files fails', () => {
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('not a git repo');
        });

        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual(['.']);
    });

    it('returns empty discoverProjectDirs when no Cargo.lock found', () => {
        vi.mocked(execSync).mockReturnValueOnce('package.json\ntsconfig.json\n');

        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual([]);
    });

    it('resolves version metadata from crates.io', async () => {
        vi.mocked(execSync).mockReturnValueOnce('Cargo.lock\n');

        const cratesIoResponse = {
            crate: { name: 'serde', newest_version: '1.0.215' },
            versions: [
                { num: '1.0.215', created_at: '2025-01-15T00:00:00Z', yanked: false },
                { num: '1.0.210', created_at: '2024-09-01T00:00:00Z', yanked: false },
            ],
        };

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(cratesIoResponse),
        } as Response);

        const provider = new CargoProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'serde', versions: ['1.0.210'] },
        ]);

        expect(result.get('serde@1.0.210')).toEqual({
            publishDate: '2024-09-01T00:00:00Z',
            latestVersion: '1.0.215',
        });
    });

    it('falls back gracefully when crates.io fetch fails', async () => {
        vi.mocked(execSync).mockReturnValueOnce('Cargo.lock\n');
        vi.mocked(fetch).mockRejectedValue(new Error('network error'));

        const provider = new CargoProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'serde', versions: ['1.0.210'] },
        ]);

        expect(result.get('serde@1.0.210')).toEqual({
            publishDate: undefined,
            latestVersion: '1.0.210',
        });
    });

    it('catalog and patch methods return false', () => {
        const provider = new CargoProvider(mockCacheService, rootDir);
        expect(provider.isInCatalog('serde', '1.0.210')).toBe(false);
        expect(provider.hasInCatalog('serde')).toBe(false);
        expect(provider.isPatched('serde', '1.0.210')).toBe(false);
    });

    it('caches packages after first call', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('Cargo.lock\n') // git ls-files
            .mockReturnValueOnce(singleWorkspaceMetadata); // cargo metadata

        const provider = new CargoProvider(mockCacheService, rootDir);
        const first = await provider.getPackages();
        const second = await provider.getPackages();

        expect(first).toBe(second);
        // git ls-files + cargo metadata = 2 calls, no more on second getPackages()
        expect(execSync).toHaveBeenCalledTimes(2);
    });
});

describe('parsePackageId', () => {
    it('parses registry package IDs', () => {
        expect(
            parsePackageId('registry+https://github.com/rust-lang/crates.io-index#serde@1.0.210'),
        ).toEqual({ name: 'serde', version: '1.0.210' });
    });

    it('parses path package IDs', () => {
        expect(parsePackageId('path+file:///project#my-app@0.1.0')).toEqual({
            name: 'my-app',
            version: '0.1.0',
        });
    });

    it('handles crate names with hyphens', () => {
        expect(
            parsePackageId(
                'registry+https://github.com/rust-lang/crates.io-index#serde-json@1.0.128',
            ),
        ).toEqual({ name: 'serde-json', version: '1.0.128' });
    });

    it('returns undefined for malformed IDs without hash', () => {
        expect(parsePackageId('no-hash-here')).toBeUndefined();
    });

    it('returns undefined for malformed IDs without @', () => {
        expect(parsePackageId('path+file:///project#no-version')).toBeUndefined();
    });
});
