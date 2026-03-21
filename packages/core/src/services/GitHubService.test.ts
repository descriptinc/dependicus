import { describe, it, expect, vi } from 'vitest';
import { GitHubService } from './GitHubService';
import type { GitHubRelease } from './GitHubService';
import type { CacheService } from './CacheService';

// We test parseRepoUrl, getCompareUrl, and detectTagFormat which don't require network.
// Construct a minimal GitHubService. Cache/lockfile args won't be used for these tests.
function createService(): GitHubService {
    // The constructor creates an Octokit client but we won't call any network methods.
    // Pass a dummy CacheService.
    const dummyCache = {
        isCacheValid: async () => false,
        readCache: async () => '',
        writeCache: async (_key: string, _data: string, _file: string) => {
            /* noop */
        },
        writePermanentCache: async (_key: string, _data: string) => {
            /* noop */
        },
        hasPermanentCache: () => false,
        readPermanentCache: async () => undefined,
    };
    return new GitHubService(dummyCache as unknown as CacheService);
}

/**
 * Build a GitHubService whose cache has specific tag lists, changelog entries,
 * and checked-versions pre-populated, so we can test the prefetch filtering
 * logic without network. The Octokit client is stubbed so no real API calls
 * are made.
 */
function createServiceWithCache(
    tagsByRepo: Record<string, string[]>,
    changelogRepos: string[] = [],
    checkedVersionsByRepo: Record<string, string[]> = {},
): { service: GitHubService; writes: Array<{ key: string; data: string }> } {
    const writes: Array<{ key: string; data: string }> = [];

    const permanentKeys = new Map<string, string>();
    for (const [repoKey, tags] of Object.entries(tagsByRepo)) {
        const [owner, repo] = repoKey.split('/');
        permanentKeys.set(`github-release-tags-${owner}-${repo}`, JSON.stringify(tags));
    }
    for (const repoKey of changelogRepos) {
        const [owner, repo] = repoKey.split('/');
        permanentKeys.set(`github-changelog-${owner}-${repo}`, 'null');
    }
    for (const [repoKey, versions] of Object.entries(checkedVersionsByRepo)) {
        const [owner, repo] = repoKey.split('/');
        permanentKeys.set(`github-checked-versions-${owner}-${repo}`, JSON.stringify(versions));
    }

    const dummyCache = {
        isCacheValid: async () => false,
        readCache: async () => '',
        writeCache: async () => {
            /* noop */
        },
        writePermanentCache: vi.fn(async (key: string, data: string) => {
            writes.push({ key, data });
            permanentKeys.set(key, data);
        }),
        hasPermanentCache: (key: string) => permanentKeys.has(key),
        readPermanentCache: async (key: string) => permanentKeys.get(key),
    };

    const service = new GitHubService(dummyCache as unknown as CacheService);

    // Replace the real Octokit with stubs so tests never hit the network
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).octokit = {
        repos: {
            listReleases: vi.fn(async () => ({ data: [] })),
            getContent: vi.fn(async () => {
                const err = new Error('Not Found') as Error & { status: number };
                err.status = 404;
                throw err;
            }),
        },
    };

    return { service, writes };
}

describe('GitHubService', () => {
    describe('parseRepoUrl', () => {
        const svc = createService();

        it('parses https URLs', () => {
            const result = svc.parseRepoUrl('https://github.com/facebook/react');
            expect(result).toEqual({ owner: 'facebook', repo: 'react' });
        });

        it('parses git+https URLs', () => {
            const result = svc.parseRepoUrl('git+https://github.com/facebook/react.git');
            expect(result).toEqual({ owner: 'facebook', repo: 'react' });
        });

        it('parses github: shorthand', () => {
            const result = svc.parseRepoUrl('github:facebook/react');
            expect(result).toEqual({ owner: 'facebook', repo: 'react' });
        });

        it('parses git:// URLs', () => {
            const result = svc.parseRepoUrl('git://github.com/facebook/react.git');
            expect(result).toEqual({ owner: 'facebook', repo: 'react' });
        });

        it('parses git+ssh URLs', () => {
            const result = svc.parseRepoUrl('git+ssh://git@github.com/facebook/react.git');
            expect(result).toEqual({ owner: 'facebook', repo: 'react' });
        });

        it('returns undefined for non-GitHub URLs', () => {
            expect(svc.parseRepoUrl('https://gitlab.com/owner/repo')).toBeUndefined();
        });

        it('returns undefined for undefined input', () => {
            expect(svc.parseRepoUrl(undefined)).toBeUndefined();
        });

        it('returns undefined for empty string', () => {
            expect(svc.parseRepoUrl('')).toBeUndefined();
        });

        it('handles repos with dots in names', () => {
            const result = svc.parseRepoUrl('https://github.com/owner/repo.js');
            expect(result).toEqual({ owner: 'owner', repo: 'repo.js' });
        });

        it('handles repos with hyphens', () => {
            const result = svc.parseRepoUrl('https://github.com/my-org/my-repo');
            expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' });
        });
    });

    describe('getCompareUrl', () => {
        const svc = createService();

        const createRelease = (tagName: string): GitHubRelease => ({
            tagName,
            name: `Release ${tagName}`,
            publishedAt: '2025-01-01',
            body: '',
            htmlUrl: `https://github.com/owner/repo/releases/tag/${tagName}`,
        });

        it('generates compare URL with v-prefix format', () => {
            const releases = [createRelease('v1.0.0'), createRelease('v2.0.0')];
            const url = svc.getCompareUrl(
                { owner: 'facebook', repo: 'react' },
                '1.0.0',
                '2.0.0',
                releases,
            );
            expect(url).toBe('https://github.com/facebook/react/compare/v1.0.0...v2.0.0');
        });

        it('generates compare URL with no-prefix format', () => {
            const releases = [createRelease('1.0.0'), createRelease('2.0.0')];
            const url = svc.getCompareUrl(
                { owner: 'facebook', repo: 'react' },
                '1.0.0',
                '2.0.0',
                releases,
            );
            expect(url).toBe('https://github.com/facebook/react/compare/1.0.0...2.0.0');
        });

        it('defaults to v-prefix when no releases available', () => {
            const url = svc.getCompareUrl(
                { owner: 'facebook', repo: 'react' },
                '1.0.0',
                '2.0.0',
                [],
            );
            expect(url).toBe('https://github.com/facebook/react/compare/v1.0.0...v2.0.0');
        });
    });

    describe('detectTagFormat', () => {
        const svc = createService();

        const createRelease = (tagName: string): GitHubRelease => ({
            tagName,
            name: `Release ${tagName}`,
            publishedAt: '2025-01-01',
            body: '',
            htmlUrl: `https://github.com/owner/repo/releases/tag/${tagName}`,
        });

        it('detects v-prefix format', () => {
            const toTag = svc.detectTagFormat([createRelease('v1.0.0'), createRelease('v2.0.0')]);
            expect(toTag('3.0.0')).toBe('v3.0.0');
        });

        it('detects no-prefix format', () => {
            const toTag = svc.detectTagFormat([createRelease('1.0.0'), createRelease('2.0.0')]);
            expect(toTag('3.0.0')).toBe('3.0.0');
        });

        it('defaults to v-prefix when no releases', () => {
            const toTag = svc.detectTagFormat([]);
            expect(toTag('1.0.0')).toBe('v1.0.0');
        });
    });

    describe('getChangelogUrl error handling', () => {
        it('caches null on non-rate-limit 403 (e.g. IP allowlist)', async () => {
            const { service, writes } = createServiceWithCache({});

            const err = new Error('IP not permitted') as Error & {
                status: number;
                response: { headers: Record<string, string> };
            };
            err.status = 403;
            err.response = { headers: { 'x-ratelimit-remaining': '14542' } };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any).octokit.repos.getContent = vi.fn(async () => {
                throw err;
            });

            const result = await service.getChangelogUrl({ owner: 'pubnub', repo: 'javascript' });
            expect(result).toBeUndefined();
            expect(writes.some((w) => w.key.includes('changelog') && w.data === 'null')).toBe(true);
        });

        it('throws on rate limit so caller can stop fetching', async () => {
            const { service } = createServiceWithCache({});

            const err = new Error('Rate limit') as Error & {
                status: number;
                response: { headers: Record<string, string> };
            };
            err.status = 403;
            err.response = { headers: { 'x-ratelimit-remaining': '0' } };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any).octokit.repos.getContent = vi.fn(async () => {
                throw err;
            });

            await expect(
                service.getChangelogUrl({ owner: 'facebook', repo: 'react' }),
            ).rejects.toThrow('Rate limit');
        });
    });

    describe('prefetchRepoData version-aware caching', () => {
        const repo = { owner: 'facebook', repo: 'react' };

        it('skips fetching when v-prefix tags cover the latest version', async () => {
            const { service, writes } = createServiceWithCache(
                { 'facebook/react': ['v18.0.0', 'v19.0.0'] },
                ['facebook/react'],
            );

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '19.0.0', packageName: 'react' }]]]),
            );

            // No new cache writes means no fetching happened
            expect(writes).toHaveLength(0);
        });

        it('skips fetching when bare tags cover the latest version', async () => {
            const { service, writes } = createServiceWithCache(
                { 'facebook/react': ['18.0.0', '19.0.0'] },
                ['facebook/react'],
            );

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '19.0.0', packageName: 'react' }]]]),
            );

            expect(writes).toHaveLength(0);
        });

        it('skips fetching when repo has no releases (empty tag list)', async () => {
            const { service, writes } = createServiceWithCache({ 'facebook/react': [] }, [
                'facebook/react',
            ]);

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '2.0.0', packageName: 'react' }]]]),
            );

            expect(writes).toHaveLength(0);
        });

        it('skips fetching when monorepo package@version tags match', async () => {
            const babelRepo = { owner: 'babel', repo: 'babel' };
            const { service, writes } = createServiceWithCache(
                { 'babel/babel': ['@babel/core@7.24.0', '@babel/core@7.25.0'] },
                ['babel/babel'],
            );

            await service.prefetchRepoData(
                [babelRepo],
                new Map([['babel/babel', [{ version: '7.25.0', packageName: '@babel/core' }]]]),
            );

            expect(writes).toHaveLength(0);
        });

        it('skips fetching when scoped package short name tags match', async () => {
            const someRepo = { owner: 'org', repo: 'toolkit' };
            const { service, writes } = createServiceWithCache(
                { 'org/toolkit': ['cli@3.0.0', 'cli@4.0.0'] },
                ['org/toolkit'],
            );

            await service.prefetchRepoData(
                [someRepo],
                new Map([['org/toolkit', [{ version: '4.0.0', packageName: '@org/cli' }]]]),
            );

            expect(writes).toHaveLength(0);
        });

        it('skips when version was already checked but has no matching tag', async () => {
            // Repo has releases (v18, v19) but the npm latest is 19.0.1 which
            // has no corresponding GitHub release. We already checked 19.0.1 last
            // run, so we should not re-fetch.
            const { service, writes } = createServiceWithCache(
                { 'facebook/react': ['v18.0.0', 'v19.0.0'] },
                ['facebook/react'],
                { 'facebook/react': ['19.0.1'] },
            );

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '19.0.1', packageName: 'react' }]]]),
            );

            expect(writes).toHaveLength(0);
        });

        it('fetches when latest version is new and unchecked', async () => {
            // We previously checked 19.0.0, now latest is 20.0.0 — should re-fetch
            const { service, writes } = createServiceWithCache(
                { 'facebook/react': ['v18.0.0', 'v19.0.0'] },
                ['facebook/react'],
                { 'facebook/react': ['19.0.0'] },
            );

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '20.0.0', packageName: 'react' }]]]),
            );

            const tagWrites = writes.filter((w) => w.key.includes('release-tags'));
            expect(tagWrites.length).toBeGreaterThan(0);
        });

        it('records checked versions after fetching', async () => {
            const { service, writes } = createServiceWithCache(
                { 'facebook/react': ['v18.0.0', 'v19.0.0'] },
                ['facebook/react'],
            );

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '20.0.0', packageName: 'react' }]]]),
            );

            const checkedWrite = writes.find((w) => w.key.includes('checked-versions'));
            expect(checkedWrite).toBeDefined();
            expect(JSON.parse(checkedWrite!.data)).toEqual(['20.0.0']);
        });

        it('fetches when no tags cache exists at all', async () => {
            const { service, writes } = createServiceWithCache({});

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '19.0.0', packageName: 'react' }]]]),
            );

            const tagWrites = writes.filter((w) => w.key.includes('release-tags'));
            expect(tagWrites.length).toBeGreaterThan(0);
        });

        it('still fetches changelog when releases are cached but changelog is not', async () => {
            const { service, writes } = createServiceWithCache({
                'facebook/react': ['v19.0.0'],
            });

            await service.prefetchRepoData(
                [repo],
                new Map([['facebook/react', [{ version: '19.0.0', packageName: 'react' }]]]),
            );

            const changelogWrites = writes.filter((w) => w.key.includes('changelog'));
            expect(changelogWrites.length).toBeGreaterThan(0);
        });
    });
});
