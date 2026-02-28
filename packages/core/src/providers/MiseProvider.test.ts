import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiseProvider } from './MiseProvider';
import type { CacheService } from '../services/CacheService';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
}));

import { execSync } from 'node:child_process';

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

    it('parses mise ls output into packages', async () => {
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

        vi.mocked(execSync).mockReturnValueOnce(miseOutput);

        const provider = new MiseProvider(mockCacheService, rootDir);
        const packages = await provider.getPackages();

        expect(packages).toHaveLength(1);
        expect(packages[0]!.name).toBe('mise-tools');
        // jq should be excluded (global config, not under rootDir)
        expect(packages[0]!.dependencies).toBeDefined();
        expect(Object.keys(packages[0]!.dependencies!)).toEqual(['node', 'bun']);
        expect(packages[0]!.dependencies!['node']!.version).toBe('22.12.0');
        expect(packages[0]!.dependencies!['bun']!.version).toBe('1.3.0');
    });

    it('resolves latest versions from mise outdated', async () => {
        // resolveVersionMetadata calls execSync twice:
        //   1. mise outdated --json --bump
        //   2. mise ls --json (via getPackages)
        const outdatedOutput = JSON.stringify({
            node: {
                name: 'node',
                current: '22.12.0',
                requested: '22',
                latest: '22.14.0',
                bump: '22.14.0',
            },
        });

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
        });

        vi.mocked(execSync).mockReturnValueOnce(outdatedOutput).mockReturnValueOnce(miseOutput);

        const provider = new MiseProvider(mockCacheService, rootDir);
        const result = await provider.resolveVersionMetadata(['node', 'bun']);

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
    });

    it('catalog methods return false', () => {
        const provider = new MiseProvider(mockCacheService, rootDir);
        expect(provider.isInCatalog('node', '22.0.0')).toBe(false);
        expect(provider.hasPackageInCatalog('node')).toBe(false);
        expect(provider.isPatched('node', '22.0.0')).toBe(false);
    });
});
