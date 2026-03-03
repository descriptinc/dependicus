import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoProvider, encodeModulePath } from './GoProvider';
import type { CacheService } from '@dependicus/core';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

// Realistic `go list -m -json all` output for a single module with two direct deps
const singleModuleOutput = [
    JSON.stringify({
        Path: 'github.com/example/myapp',
        Main: true,
        Dir: '/home/user/myapp',
    }),
    JSON.stringify({
        Path: 'github.com/gorilla/mux',
        Version: 'v1.8.1',
    }),
    JSON.stringify({
        Path: 'github.com/sirupsen/logrus',
        Version: 'v1.9.3',
    }),
    JSON.stringify({
        Path: 'golang.org/x/sys',
        Version: 'v0.20.0',
        Indirect: true,
    }),
].join('\n');

// Output with a Replace directive
const replacedModuleOutput = [
    JSON.stringify({
        Path: 'github.com/example/myapp',
        Main: true,
    }),
    JSON.stringify({
        Path: 'github.com/gorilla/mux',
        Version: 'v1.8.1',
        Replace: { Path: 'github.com/gorilla/mux', Version: 'v1.8.0' },
    }),
    JSON.stringify({
        Path: 'github.com/example/local-fork',
        Version: 'v0.1.0',
        Replace: { Path: '../local-fork' },
    }),
].join('\n');

describe('GoProvider', () => {
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
        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.name).toBe('go');
        expect(provider.ecosystem).toBe('gomod');
        expect(provider.supportsCatalog).toBe(false);
    });

    it('discovers go.mod files and returns containing directories', () => {
        vi.mocked(execSync).mockReturnValueOnce('go.mod\nservices/api/go.mod\n');

        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual(['.', 'services/api']);
    });

    it('lockfilePath points to first discovered go.sum', () => {
        vi.mocked(execSync).mockReturnValueOnce('services/api/go.mod\n');

        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.lockfilePath).toBe('/project/services/api/go.sum');
    });

    it('lockfilePath falls back to root when go.mod is at root', () => {
        vi.mocked(execSync).mockReturnValueOnce('go.mod\n');

        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.lockfilePath).toBe('/project/go.sum');
    });

    it('parses single-module output into packages', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('go.mod\n') // git ls-files
            .mockReturnValueOnce(singleModuleOutput); // go list

        const provider = new GoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        expect(packages[0]!.name).toBe('github.com/example/myapp');
        expect(packages[0]!.version).toBe('0.0.0'); // main module has no version

        const deps = packages[0]!.dependencies!;
        expect(Object.keys(deps).sort()).toEqual([
            'github.com/gorilla/mux',
            'github.com/sirupsen/logrus',
        ]);
        expect(deps['github.com/gorilla/mux']!.version).toBe('1.8.1');
        expect(deps['github.com/sirupsen/logrus']!.version).toBe('1.9.3');

        // Indirect dep should NOT appear
        expect(deps['golang.org/x/sys']).toBeUndefined();
    });

    it('handles Replace directives correctly', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('go.mod\n') // git ls-files
            .mockReturnValueOnce(replacedModuleOutput); // go list

        const provider = new GoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);

        const deps = packages[0]!.dependencies!;
        // Replaced with versioned replacement: use replacement version
        expect(deps['github.com/gorilla/mux']!.version).toBe('1.8.0');
        // Replaced with local path (no version): skipped
        expect(deps['github.com/example/local-fork']).toBeUndefined();
    });

    it('returns empty when go list fails', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('go.mod\n') // git ls-files
            .mockImplementationOnce(() => {
                throw new Error('go not found');
            }); // go list

        const provider = new GoProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toEqual([]);
    });

    it('falls back to root when git ls-files fails', () => {
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('not a git repo');
        });

        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual(['.']);
    });

    it('returns empty discoverProjectDirs when no go.mod found', () => {
        vi.mocked(execSync).mockReturnValueOnce('package.json\ntsconfig.json\n');

        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual([]);
    });

    it('resolves version metadata from Go module proxy', async () => {
        vi.mocked(execSync).mockReturnValueOnce('go.mod\n');

        const latestResponse = { Version: 'v1.9.0', Time: '2025-03-01T00:00:00Z' };
        const currentResponse = { Version: 'v1.8.1', Time: '2024-01-15T00:00:00Z' };

        vi.mocked(fetch)
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(latestResponse),
            } as Response)
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(currentResponse),
            } as Response);

        const provider = new GoProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'github.com/gorilla/mux', versions: ['1.8.1'] },
        ]);

        expect(result.get('github.com/gorilla/mux@1.8.1')).toEqual({
            publishDate: '2024-01-15T00:00:00Z',
            latestVersion: '1.9.0',
        });
    });

    it('falls back gracefully when proxy fetch fails', async () => {
        vi.mocked(execSync).mockReturnValueOnce('go.mod\n');
        vi.mocked(fetch).mockRejectedValue(new Error('network error'));

        const provider = new GoProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'github.com/gorilla/mux', versions: ['1.8.1'] },
        ]);

        expect(result.get('github.com/gorilla/mux@1.8.1')).toEqual({
            publishDate: undefined,
            latestVersion: '1.8.1',
        });
    });

    it('catalog and patch methods return false', () => {
        const provider = new GoProvider(mockCacheService, rootDir);
        expect(provider.isInCatalog('github.com/gorilla/mux', '1.8.1')).toBe(false);
        expect(provider.hasInCatalog('github.com/gorilla/mux')).toBe(false);
        expect(provider.isPatched('github.com/gorilla/mux', '1.8.1')).toBe(false);
    });

    it('caches packages after first call', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('go.mod\n') // git ls-files
            .mockReturnValueOnce(singleModuleOutput); // go list

        const provider = new GoProvider(mockCacheService, rootDir);
        const first = await provider.getPackages();
        const second = await provider.getPackages();

        expect(first).toBe(second);
        // git ls-files + go list = 2 calls, no more on second getPackages()
        expect(execSync).toHaveBeenCalledTimes(2);
    });
});

describe('encodeModulePath', () => {
    it('encodes uppercase letters', () => {
        expect(encodeModulePath('github.com/Azure/azure-sdk-for-go')).toBe(
            'github.com/!azure/azure-sdk-for-go',
        );
    });

    it('leaves lowercase paths unchanged', () => {
        expect(encodeModulePath('github.com/gorilla/mux')).toBe('github.com/gorilla/mux');
    });

    it('handles multiple uppercase letters', () => {
        expect(encodeModulePath('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml');
    });
});
