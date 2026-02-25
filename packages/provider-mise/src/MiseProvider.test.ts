import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiseProvider, isMiseConfigFile } from './MiseProvider';
import type { CacheService } from '@dependicus/core';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
}));

import { execSync } from 'node:child_process';

describe('isMiseConfigFile', () => {
    it('matches root mise.toml', () => {
        expect(isMiseConfigFile('mise.toml')).toBe(true);
    });

    it('matches nested mise.toml', () => {
        expect(isMiseConfigFile('docs/mise.toml')).toBe(true);
    });

    it('matches dot-prefixed .mise.toml', () => {
        expect(isMiseConfigFile('.mise.toml')).toBe(true);
        expect(isMiseConfigFile('backend/.mise.toml')).toBe(true);
    });

    it('matches local variants', () => {
        expect(isMiseConfigFile('mise.local.toml')).toBe(true);
        expect(isMiseConfigFile('.mise.local.toml')).toBe(true);
    });

    it('matches .tool-versions', () => {
        expect(isMiseConfigFile('.tool-versions')).toBe(true);
        expect(isMiseConfigFile('services/api/.tool-versions')).toBe(true);
    });

    it('matches mise/config.toml and .mise/config.toml', () => {
        expect(isMiseConfigFile('mise/config.toml')).toBe(true);
        expect(isMiseConfigFile('.mise/config.toml')).toBe(true);
        expect(isMiseConfigFile('backend/mise/config.toml')).toBe(true);
    });

    it('matches .config/mise/conf.d/*.toml', () => {
        expect(isMiseConfigFile('.config/mise/conf.d/tools.toml')).toBe(true);
    });

    it('rejects unrelated toml files', () => {
        expect(isMiseConfigFile('pyproject.toml')).toBe(false);
        expect(isMiseConfigFile('config.toml')).toBe(false);
        expect(isMiseConfigFile('random/config.toml')).toBe(false);
    });

    it('rejects unrelated files with similar names', () => {
        expect(isMiseConfigFile('not-mise.toml')).toBe(false);
        expect(isMiseConfigFile('mise.json')).toBe(false);
    });
});

describe('MiseProvider', () => {
    const mockCacheService = {} as CacheService;
    const rootDir = '/project';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('has correct name and ecosystem', () => {
        const provider = new MiseProvider(mockCacheService, rootDir);
        expect(provider.name).toBe('mise');
        expect(provider.ecosystem).toBe('mise');
        expect(provider.supportsCatalog).toBe(false);
    });

    it('parses mise ls output into per-config-file packages', async () => {
        const gitLsOutput = 'mise.toml\npackage.json\n';
        const miseOutput = JSON.stringify({
            node: [
                {
                    version: '22.12.0',
                    requested_version: '22',
                    install_path: '/home/.local/share/mise/installs/node/22.12.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
            bun: [
                {
                    version: '1.3.0',
                    requested_version: '1.3',
                    install_path: '/home/.local/share/mise/installs/bun/1.3.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
            jq: [
                {
                    version: '1.7.1',
                    install_path: '/home/.local/share/mise/installs/jq/1.7.1',
                    source: { type: 'mise.toml', path: '/home/.config/mise/config.toml' },
                },
            ],
        });

        vi.mocked(execSync)
            .mockReturnValueOnce(gitLsOutput) // git ls-files
            .mockReturnValueOnce(miseOutput); // mise ls --json

        const provider = new MiseProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        // One package per config file; jq excluded (global config, not under rootDir)
        expect(packages).toHaveLength(1);
        expect(packages[0]!.name).toBe('mise.toml');
        expect(packages[0]!.dependencies).toBeDefined();
        expect(Object.keys(packages[0]!.dependencies!)).toEqual(['node', 'bun']);
        expect(packages[0]!.dependencies!['node']!.version).toBe('22.12.0');
        expect(packages[0]!.dependencies!['bun']!.version).toBe('1.3.0');
    });

    it('discovers tools from subdirectory config files', async () => {
        const gitLsOutput = 'mise.toml\ndocs/mise.toml\npackage.json\n';
        const rootMiseOutput = JSON.stringify({
            node: [
                {
                    version: '22.12.0',
                    install_path: '/home/.local/share/mise/installs/node/22.12.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
            uv: [
                {
                    version: '0.6.11',
                    install_path: '/home/.local/share/mise/installs/uv/0.6.11',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
        });
        const docsMiseOutput = JSON.stringify({
            // uv also appears here but sourced from parent — should be filtered out
            uv: [
                {
                    version: '0.6.11',
                    install_path: '/home/.local/share/mise/installs/uv/0.6.11',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
            python: [
                {
                    version: '3.12.0',
                    install_path: '/home/.local/share/mise/installs/python/3.12.0',
                    source: { type: 'mise.toml', path: '/project/docs/mise.toml' },
                },
            ],
        });

        vi.mocked(execSync)
            .mockReturnValueOnce(gitLsOutput) // git ls-files
            .mockReturnValueOnce(rootMiseOutput) // mise ls --json (root)
            .mockReturnValueOnce(docsMiseOutput); // mise ls --json -C docs

        const provider = new MiseProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(2);
        const names = packages.map((p) => p.name).sort();
        expect(names).toEqual(['docs/mise.toml', 'mise.toml']);

        const rootPkg = packages.find((p) => p.name === 'mise.toml')!;
        expect(Object.keys(rootPkg.dependencies!).sort()).toEqual(['node', 'uv']);

        const docsPkg = packages.find((p) => p.name === 'docs/mise.toml')!;
        expect(Object.keys(docsPkg.dependencies!)).toEqual(['python']);
    });

    it('filters out tools inherited from parent configs', async () => {
        const gitLsOutput = 'mise.toml\nsub/mise.toml\n';
        const rootMiseOutput = JSON.stringify({
            node: [
                {
                    version: '22.12.0',
                    install_path: '/home/.local/share/mise/installs/node/22.12.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
        });
        // Running mise ls -C sub returns both the local python AND the inherited node
        const subMiseOutput = JSON.stringify({
            node: [
                {
                    version: '22.12.0',
                    install_path: '/home/.local/share/mise/installs/node/22.12.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
            python: [
                {
                    version: '3.11.0',
                    install_path: '/home/.local/share/mise/installs/python/3.11.0',
                    source: { type: 'mise.toml', path: '/project/sub/mise.toml' },
                },
            ],
        });

        vi.mocked(execSync)
            .mockReturnValueOnce(gitLsOutput)
            .mockReturnValueOnce(rootMiseOutput)
            .mockReturnValueOnce(subMiseOutput);

        const provider = new MiseProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        // node should only appear in the root config, not duplicated in sub
        const rootPkg = packages.find((p) => p.name === 'mise.toml')!;
        expect(Object.keys(rootPkg.dependencies!)).toEqual(['node']);

        const subPkg = packages.find((p) => p.name === 'sub/mise.toml')!;
        expect(Object.keys(subPkg.dependencies!)).toEqual(['python']);
    });

    it('resolves latest versions from mise outdated across directories', async () => {
        const gitLsOutput = 'mise.toml\ndocs/mise.toml\n';
        const rootOutdatedOutput = JSON.stringify({
            node: {
                name: 'node',
                current: '22.12.0',
                requested: '22',
                latest: '22.14.0',
                bump: '22.14.0',
            },
        });
        const docsOutdatedOutput = JSON.stringify({
            python: {
                name: 'python',
                current: '3.12.0',
                requested: '3.12',
                latest: '3.13.0',
                bump: '3.13.0',
            },
        });

        const rootMiseOutput = JSON.stringify({
            node: [
                {
                    version: '22.12.0',
                    requested_version: '22',
                    install_path: '/home/.local/share/mise/installs/node/22.12.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
            bun: [
                {
                    version: '1.3.0',
                    requested_version: '1.3',
                    install_path: '/home/.local/share/mise/installs/bun/1.3.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
        });
        const docsMiseOutput = JSON.stringify({
            python: [
                {
                    version: '3.12.0',
                    install_path: '/home/.local/share/mise/installs/python/3.12.0',
                    source: { type: 'mise.toml', path: '/project/docs/mise.toml' },
                },
            ],
        });

        vi.mocked(execSync)
            // discoverConfigDirs (called by resolveVersionMetadata)
            .mockReturnValueOnce(gitLsOutput)
            // mise outdated for root
            .mockReturnValueOnce(rootOutdatedOutput)
            // mise outdated for docs
            .mockReturnValueOnce(docsOutdatedOutput)
            // mise ls for root (via getPackages -> discoverConfigDirs uses cache)
            .mockReturnValueOnce(rootMiseOutput)
            // mise ls for docs
            .mockReturnValueOnce(docsMiseOutput);

        const provider = new MiseProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata([
            { name: 'node', versions: ['22.12.0'] },
            { name: 'bun', versions: ['1.3.0'] },
            { name: 'python', versions: ['3.12.0'] },
        ]);

        // node is outdated
        expect(result.get('node@22.12.0')).toEqual({
            publishDate: undefined,
            latestVersion: '22.14.0',
        });
        // bun is up-to-date (not in outdated output)
        expect(result.get('bun@1.3.0')).toEqual({
            publishDate: undefined,
            latestVersion: '1.3.0',
        });
        // python is outdated (from docs subdir)
        expect(result.get('python@3.12.0')).toEqual({
            publishDate: undefined,
            latestVersion: '3.13.0',
        });
    });

    it('falls back to root when git ls-files fails', async () => {
        const miseOutput = JSON.stringify({
            node: [
                {
                    version: '22.12.0',
                    install_path: '/home/.local/share/mise/installs/node/22.12.0',
                    source: { type: 'mise.toml', path: '/project/mise.toml' },
                },
            ],
        });

        vi.mocked(execSync)
            .mockImplementationOnce(() => {
                throw new Error('not a git repo');
            }) // git ls-files fails
            .mockReturnValueOnce(miseOutput); // mise ls --json

        const provider = new MiseProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        expect(packages[0]!.name).toBe('mise.toml');
    });

    it('catalog methods return false', () => {
        const provider = new MiseProvider(mockCacheService, rootDir);
        expect(provider.isInCatalog('node', '22.0.0')).toBe(false);
        expect(provider.hasInCatalog('node')).toBe(false);
        expect(provider.isPatched('node', '22.0.0')).toBe(false);
    });
});
