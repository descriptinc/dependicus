import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UvProvider } from './UvProvider';
import type { CacheService } from '../core/index';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

// Realistic CycloneDX output for a single-project case
const singleProjectBom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
        component: {
            type: 'library',
            'bom-ref': 'my-project-9',
            name: 'my-project',
            properties: [{ name: 'uv:package:is_synthetic_root', value: 'true' }],
        },
    },
    components: [
        {
            type: 'library',
            'bom-ref': 'requests-7@2.32.5',
            name: 'requests',
            version: '2.32.5',
            purl: 'pkg:pypi/requests@2.32.5',
        },
        {
            type: 'library',
            'bom-ref': 'click-4@8.3.1',
            name: 'click',
            version: '8.3.1',
            purl: 'pkg:pypi/click@8.3.1',
        },
        {
            type: 'library',
            'bom-ref': 'certifi-2@2026.2.25',
            name: 'certifi',
            version: '2026.2.25',
            purl: 'pkg:pypi/certifi@2026.2.25',
        },
        {
            type: 'library',
            'bom-ref': 'my-project-1@0.1.0',
            name: 'my-project',
            version: '0.1.0',
            properties: [{ name: 'uv:package:is_project_root', value: 'true' }],
        },
    ],
    dependencies: [
        { ref: 'requests-7@2.32.5', dependsOn: ['certifi-2@2026.2.25'] },
        { ref: 'click-4@8.3.1', dependsOn: [] },
        { ref: 'certifi-2@2026.2.25', dependsOn: [] },
        { ref: 'my-project-1@0.1.0', dependsOn: ['requests-7@2.32.5', 'click-4@8.3.1'] },
        { ref: 'my-project-9', dependsOn: ['my-project-1@0.1.0'] },
    ],
};

// CycloneDX output for a workspace with two members
const workspaceBom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
        component: {
            type: 'library',
            'bom-ref': 'workspace-root-9',
            name: 'workspace-root',
            properties: [{ name: 'uv:package:is_synthetic_root', value: 'true' }],
        },
    },
    components: [
        {
            type: 'library',
            'bom-ref': 'requests-7@2.32.5',
            name: 'requests',
            version: '2.32.5',
            purl: 'pkg:pypi/requests@2.32.5',
        },
        {
            type: 'library',
            'bom-ref': 'flask-3@3.1.0',
            name: 'flask',
            version: '3.1.0',
            purl: 'pkg:pypi/flask@3.1.0',
        },
        {
            type: 'library',
            'bom-ref': 'app-a-1@0.1.0',
            name: 'app-a',
            version: '0.1.0',
            properties: [{ name: 'uv:package:is_project_root', value: 'true' }],
        },
        {
            type: 'library',
            'bom-ref': 'app-b-2@0.2.0',
            name: 'app-b',
            version: '0.2.0',
            properties: [{ name: 'uv:package:is_project_root', value: 'true' }],
        },
    ],
    dependencies: [
        { ref: 'requests-7@2.32.5', dependsOn: [] },
        { ref: 'flask-3@3.1.0', dependsOn: [] },
        { ref: 'app-a-1@0.1.0', dependsOn: ['requests-7@2.32.5'] },
        { ref: 'app-b-2@0.2.0', dependsOn: ['flask-3@3.1.0', 'requests-7@2.32.5'] },
        { ref: 'workspace-root-9', dependsOn: ['app-a-1@0.1.0', 'app-b-2@0.2.0'] },
    ],
};

describe('UvProvider', () => {
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
        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.name).toBe('uv');
        expect(provider.ecosystem).toBe('pypi');
        expect(provider.supportsCatalog).toBe(false);
    });

    it('lockfilePath points to first discovered uv.lock', () => {
        vi.mocked(execSync).mockReturnValueOnce('apps/web/uv.lock\n');

        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.lockfilePath).toBe('/project/apps/web/uv.lock');
    });

    it('lockfilePath falls back to root when uv.lock is at root', () => {
        vi.mocked(execSync).mockReturnValueOnce('uv.lock\n');

        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.lockfilePath).toBe('/project/uv.lock');
    });

    it('parses single-project CycloneDX into packages', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('uv.lock\npyproject.toml\n') // git ls-files
            .mockReturnValueOnce(JSON.stringify(singleProjectBom)); // uv export

        const provider = new UvProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        expect(packages[0]!.name).toBe('my-project');
        expect(packages[0]!.version).toBe('0.1.0');

        const deps = packages[0]!.dependencies!;
        expect(Object.keys(deps).sort()).toEqual(['click', 'requests']);
        expect(deps['requests']!.version).toBe('2.32.5');
        expect(deps['click']!.version).toBe('8.3.1');

        // Transitive dep (certifi) should NOT appear as a direct dep
        expect(deps['certifi']).toBeUndefined();
    });

    it('parses workspace CycloneDX with multiple members', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('uv.lock\npyproject.toml\n') // git ls-files
            .mockReturnValueOnce(JSON.stringify(workspaceBom)); // uv export

        const provider = new UvProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(2);

        const appA = packages.find((p) => p.name === 'app-a')!;
        expect(appA.version).toBe('0.1.0');
        expect(Object.keys(appA.dependencies!)).toEqual(['requests']);

        const appB = packages.find((p) => p.name === 'app-b')!;
        expect(appB.version).toBe('0.2.0');
        expect(Object.keys(appB.dependencies!).sort()).toEqual(['flask', 'requests']);
    });

    it('discovers uv.lock files in subdirectories', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('examples/app-a/uv.lock\nexamples/app-b/uv.lock\n') // git ls-files
            .mockReturnValueOnce(JSON.stringify(singleProjectBom)) // uv export for app-a
            .mockReturnValueOnce(JSON.stringify(workspaceBom)); // uv export for app-b

        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual(['examples/app-a', 'examples/app-b']);

        const packages = await provider.getPackages();
        // singleProjectBom has 1 member, workspaceBom has 2
        expect(packages).toHaveLength(3);
    });

    it('returns empty when uv export fails', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('uv.lock\n') // git ls-files
            .mockImplementationOnce(() => {
                throw new Error('uv not found');
            }); // uv export

        const provider = new UvProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toEqual([]);
    });

    it('falls back to root when git ls-files fails', () => {
        vi.mocked(execSync).mockImplementationOnce(() => {
            throw new Error('not a git repo');
        });

        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual(['.']);
    });

    it('returns empty discoverProjectDirs when no uv.lock found', () => {
        vi.mocked(execSync).mockReturnValueOnce('package.json\ntsconfig.json\n');

        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.discoverProjectDirs()).toEqual([]);
    });

    it('resolves version metadata from PyPI', async () => {
        // discoverProjectDirs for primaryLockfile
        vi.mocked(execSync).mockReturnValueOnce('uv.lock\n');

        const pypiResponse = {
            info: {
                version: '2.33.0',
                summary: 'HTTP library',
                home_page: null,
                project_urls: null,
            },
            releases: {
                '2.32.5': [{ upload_time_iso_8601: '2024-06-01T00:00:00Z', yanked: false }],
                '2.33.0': [{ upload_time_iso_8601: '2025-01-15T00:00:00Z', yanked: false }],
            },
        };

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(pypiResponse),
        } as Response);

        const provider = new UvProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'requests', versions: ['2.32.5'] },
        ]);

        expect(result.get('requests@2.32.5')).toEqual({
            publishDate: '2024-06-01T00:00:00Z',
            latestVersion: '2.33.0',
        });
    });

    it('falls back gracefully when PyPI fetch fails', async () => {
        vi.mocked(execSync).mockReturnValueOnce('uv.lock\n');
        vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

        const provider = new UvProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'requests', versions: ['2.32.5'] },
        ]);

        expect(result.get('requests@2.32.5')).toEqual({
            publishDate: undefined,
            latestVersion: '2.32.5',
        });
    });

    it('catalog and patch methods return false', () => {
        const provider = new UvProvider(mockCacheService, rootDir);
        expect(provider.isInCatalog('requests', '2.32.5')).toBe(false);
        expect(provider.hasInCatalog('requests')).toBe(false);
        expect(provider.isPatched('requests', '2.32.5')).toBe(false);
    });

    it('caches packages after first call', async () => {
        vi.mocked(execSync)
            .mockReturnValueOnce('uv.lock\n') // git ls-files
            .mockReturnValueOnce(JSON.stringify(singleProjectBom)); // uv export

        const provider = new UvProvider(mockCacheService, rootDir);
        const first = await provider.getPackages();
        const second = await provider.getPackages();

        expect(first).toBe(second);
        // git ls-files + uv export = 2 calls, no more on second getPackages()
        expect(execSync).toHaveBeenCalledTimes(2);
    });
});
