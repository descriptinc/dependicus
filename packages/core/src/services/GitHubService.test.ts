import { describe, it, expect } from 'vitest';
import { GitHubService } from './GitHubService';
import type { GitHubRelease } from './GitHubService';
import type { CacheService } from './CacheService';

// We test parseRepoUrl, getCompareUrl, and detectTagFormat which don't require network.
// Construct a minimal GitHubService. Cache/lockfile args won't be used for these tests.
function createService(): GitHubService {
    // The constructor creates an Octokit client but we won't call any network methods.
    // Pass dummy values for cacheService and lockfilePath.
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
        getLastReleaseFetchHash: async () => undefined,
        setLastReleaseFetchHash: async (_path: string) => {
            /* noop */
        },
        hasLockfileChangedSinceLastFetch: async () => true,
    };
    return new GitHubService(dummyCache as unknown as CacheService, '/dev/null');
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
});
