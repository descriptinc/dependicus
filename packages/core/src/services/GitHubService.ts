import { Octokit } from '@octokit/rest';
import type { CacheService } from './CacheService';
import { sanitizeCacheKey } from '../utils/formatters';
import { findReleaseForVersion, detectTagFormat } from '../utils/releaseUtils';

export interface GitHubRepo {
    owner: string;
    repo: string;
}

export interface GitHubRelease {
    tagName: string;
    name: string;
    publishedAt: string;
    body: string; // markdown release notes
    htmlUrl: string;
}

export interface ChangelogInfo {
    url: string;
    filename: string;
}

export class GitHubService {
    private octokit: Octokit;

    constructor(
        private cacheService: CacheService,
        private lockfilePath: string,
    ) {
        // Use GITHUB_TOKEN if available for higher rate limits
        const auth = process.env.GITHUB_TOKEN;
        // Suppress verbose request logging (debug/info) but keep warn/error
        // This hides the 404s when checking for changelog files
        const noop = () => {
            /* intentionally empty */
        };
        this.octokit = new Octokit({
            auth,
            log: {
                debug: noop,
                info: noop,
                warn: console.warn,
                error: console.error,
            },
        });
    }

    /**
     * Parse a repository URL from npm package metadata into owner/repo.
     * Handles various formats:
     * - git+https://github.com/owner/repo.git
     * - https://github.com/owner/repo
     * - github:owner/repo
     * - git://github.com/owner/repo.git
     * - git+ssh://git@github.com/owner/repo.git
     */
    parseRepoUrl(repoUrl: string | undefined): GitHubRepo | undefined {
        if (!repoUrl) return undefined;

        // Handle github: shorthand
        const githubShorthand = repoUrl.match(/^github:([^/]+)\/([^/]+)$/);
        if (githubShorthand && githubShorthand[1] && githubShorthand[2]) {
            return { owner: githubShorthand[1], repo: githubShorthand[2] };
        }

        // Handle various GitHub URL formats
        const githubUrlPattern = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/;
        const match = repoUrl.match(githubUrlPattern);
        if (match && match[1] && match[2]) {
            return { owner: match[1], repo: match[2] };
        }

        return undefined;
    }

    /**
     * Get the cache key for a single release.
     */
    private getReleaseCacheKey(repo: GitHubRepo, tagName: string): string {
        return `github-release-${sanitizeCacheKey(repo.owner)}-${sanitizeCacheKey(repo.repo)}-${sanitizeCacheKey(tagName)}`;
    }

    /**
     * Get cached tag names for a repo.
     */
    private getCachedTagsCacheKey(repo: GitHubRepo): string {
        return `github-release-tags-${sanitizeCacheKey(repo.owner)}-${sanitizeCacheKey(repo.repo)}`;
    }

    /**
     * Get all releases for a repository.
     * Releases are cached permanently by tag name. Only fetches new releases
     * when the lockfile changes.
     */
    async getReleases(repo: GitHubRepo): Promise<GitHubRelease[]> {
        const tagsCacheKey = this.getCachedTagsCacheKey(repo);

        // Load existing cached tags
        const cachedTagsJson = await this.cacheService.readPermanentCache(tagsCacheKey);
        const hasCachedTags = cachedTagsJson !== undefined;
        const cachedTags: string[] = cachedTagsJson ? JSON.parse(cachedTagsJson) : [];

        // If we have cache (even empty) and lockfile hasn't changed, return cached releases
        const lockfileChanged = await this.cacheService.hasLockfileChangedSinceLastFetch(
            this.lockfilePath,
        );

        if (hasCachedTags && !lockfileChanged) {
            return await this.loadCachedReleases(repo, cachedTags);
        }

        // Lockfile changed or no cache - fetch new releases
        try {
            const newReleases = await this.fetchNewReleases(repo, cachedTags);

            // Cache each new release permanently
            for (const release of newReleases) {
                const releaseKey = this.getReleaseCacheKey(repo, release.tagName);
                await this.cacheService.writePermanentCache(
                    releaseKey,
                    JSON.stringify(release),
                );
            }

            // Update the list of cached tags
            const allTags = [...new Set([...cachedTags, ...newReleases.map((r) => r.tagName)])];
            await this.cacheService.writePermanentCache(tagsCacheKey, JSON.stringify(allTags));

            // Return all releases (cached + new)
            return await this.loadCachedReleases(repo, allTags);
        } catch (error) {
            // Only cache 404s (repo doesn't exist) - don't cache rate limits or other transient errors
            if (
                cachedTags.length === 0 &&
                error instanceof Error &&
                'status' in error &&
                error.status === 404
            ) {
                await this.cacheService.writePermanentCache(tagsCacheKey, JSON.stringify([]));
            }
            return await this.loadCachedReleases(repo, cachedTags);
        }
    }

    /**
     * Load releases from permanent cache by tag names.
     */
    private async loadCachedReleases(
        repo: GitHubRepo,
        tags: string[],
    ): Promise<GitHubRelease[]> {
        const releases: GitHubRelease[] = [];
        for (const tag of tags) {
            const releaseKey = this.getReleaseCacheKey(repo, tag);
            const cached = await this.cacheService.readPermanentCache(releaseKey);
            if (cached) {
                releases.push(JSON.parse(cached) as GitHubRelease);
            }
        }
        return releases;
    }

    /**
     * Fetch releases from GitHub that aren't already cached.
     * Stops paginating once we hit releases we already have.
     */
    private async fetchNewReleases(
        repo: GitHubRepo,
        cachedTags: string[],
    ): Promise<GitHubRelease[]> {
        const cachedTagSet = new Set(cachedTags);
        const newReleases: GitHubRelease[] = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const response = await this.octokit.repos.listReleases({
                owner: repo.owner,
                repo: repo.repo,
                per_page: perPage,
                page,
            });

            let foundCached = false;
            for (const release of response.data) {
                if (release.draft) continue;

                // If we've seen this tag before, we've caught up
                if (cachedTagSet.has(release.tag_name)) {
                    foundCached = true;
                    continue;
                }

                newReleases.push({
                    tagName: release.tag_name,
                    name: release.name || release.tag_name,
                    publishedAt: release.published_at || release.created_at,
                    body: release.body || '',
                    htmlUrl: release.html_url,
                });
            }

            // Stop if we've hit cached releases or reached end of results
            if (foundCached || response.data.length < perPage) break;
            page++;

            // Safety limit
            if (page > 50) break;
        }

        return newReleases;
    }

    /**
     * Check if releases are cached for a repo.
     */
    async hasReleasesCache(repo: GitHubRepo): Promise<boolean> {
        const tagsCacheKey = this.getCachedTagsCacheKey(repo);
        return this.cacheService.hasPermanentCache(tagsCacheKey);
    }

    /**
     * Check if changelog is cached for a repo.
     */
    hasChangelogCache(repo: GitHubRepo): boolean {
        const cacheKey = `github-changelog-${sanitizeCacheKey(repo.owner)}-${sanitizeCacheKey(repo.repo)}`;
        return this.cacheService.hasPermanentCache(cacheKey);
    }

    /**
     * Find a release that matches a given version.
     * Tries common tag formats: v1.0.0, 1.0.0, package@1.0.0
     */
    findReleaseForVersion(
        releases: GitHubRelease[],
        version: string,
        packageName?: string,
    ): GitHubRelease | undefined {
        return findReleaseForVersion(releases, version, packageName);
    }

    /**
     * Check if CHANGELOG.md exists in the repository root.
     * Returns the URL and filename if found.
     * Results are cached permanently (including failures).
     */
    async getChangelogUrl(repo: GitHubRepo): Promise<ChangelogInfo | undefined> {
        const cacheKey = `github-changelog-${sanitizeCacheKey(repo.owner)}-${sanitizeCacheKey(repo.repo)}`;

        if (this.cacheService.hasPermanentCache(cacheKey)) {
            const cached = await this.cacheService.readPermanentCache(cacheKey);
            if (!cached) return undefined;
            const result = JSON.parse(cached) as ChangelogInfo | null;
            return result || undefined;
        }

        try {
            // Get the default branch first
            const repoInfo = await this.octokit.repos.get({
                owner: repo.owner,
                repo: repo.repo,
            });
            const defaultBranch = repoInfo.data.default_branch;

            // Check for CHANGELOG.md only
            try {
                await this.octokit.repos.getContent({
                    owner: repo.owner,
                    repo: repo.repo,
                    path: 'CHANGELOG.md',
                });

                const result: ChangelogInfo = {
                    filename: 'CHANGELOG.md',
                    url: `https://github.com/${repo.owner}/${repo.repo}/blob/${defaultBranch}/CHANGELOG.md`,
                };

                await this.cacheService.writePermanentCache(cacheKey, JSON.stringify(result));
                return result;
            } catch (contentError) {
                // Only cache 404 (file doesn't exist) - don't cache rate limits
                if (
                    contentError instanceof Error &&
                    'status' in contentError &&
                    contentError.status === 404
                ) {
                    await this.cacheService.writePermanentCache(cacheKey, 'null');
                }
                return undefined;
            }
        } catch (error) {
            // Only cache 404s (repo doesn't exist) - don't cache rate limits or other transient errors
            if (error instanceof Error && 'status' in error && error.status === 404) {
                await this.cacheService.writePermanentCache(cacheKey, 'null');
            }
            return undefined;
        }
    }

    /**
     * Detect the tag format used by a repo based on existing releases.
     * Returns a function that converts a version to a tag name.
     */
    detectTagFormat(releases: GitHubRelease[]): (version: string) => string {
        return detectTagFormat(releases);
    }

    /**
     * Get a URL to compare two versions on GitHub.
     * Uses releases to detect the correct tag format.
     */
    getCompareUrl(
        repo: GitHubRepo,
        fromVersion: string,
        toVersion: string,
        releases: GitHubRelease[],
    ): string {
        const toTag = this.detectTagFormat(releases);
        const fromTag = toTag(fromVersion);
        const toTagStr = toTag(toVersion);
        return `https://github.com/${repo.owner}/${repo.repo}/compare/${fromTag}...${toTagStr}`;
    }

    /**
     * Get URL to a specific tag/release on GitHub.
     * Uses releases to detect the correct tag format.
     */
    getReleaseUrl(repo: GitHubRepo, version: string, releases: GitHubRelease[]): string {
        const toTag = this.detectTagFormat(releases);
        return `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${toTag(version)}`;
    }

    /**
     * Prefetch GitHub data for a list of repos, with progress logging.
     * This fetches releases and changelog info for repos that aren't cached.
     */
    async prefetchRepoData(repos: GitHubRepo[]): Promise<void> {
        // Deduplicate repos by owner/repo
        const uniqueRepos = new Map<string, GitHubRepo>();
        for (const repo of repos) {
            const key = `${repo.owner}/${repo.repo}`;
            if (!uniqueRepos.has(key)) {
                uniqueRepos.set(key, repo);
            }
        }

        const lockfileChanged = await this.cacheService.hasLockfileChangedSinceLastFetch(
            this.lockfilePath,
        );

        // Filter to repos that need fetching
        const reposToFetch: GitHubRepo[] = [];
        for (const repo of uniqueRepos.values()) {
            const hasReleases = await this.hasReleasesCache(repo);
            const hasChangelog = this.hasChangelogCache(repo);

            // Need to fetch if: no cache, or lockfile changed (for releases)
            const needsReleases = !hasReleases || lockfileChanged;
            const needsChangelog = !hasChangelog;

            if (needsReleases || needsChangelog) {
                reposToFetch.push(repo);
            }
        }

        if (reposToFetch.length === 0) {
            process.stderr.write('GitHub data already cached for all repos\n');
            return;
        }

        process.stderr.write(
            `Fetching GitHub data for ${reposToFetch.length} repos${lockfileChanged ? ' (lockfile changed)' : ''}...\n`,
        );

        let completed = 0;
        for (const repo of reposToFetch) {
            await this.getReleases(repo);

            if (!this.hasChangelogCache(repo)) {
                await this.getChangelogUrl(repo);
            }

            completed++;
            if (completed % 10 === 0 || completed === reposToFetch.length) {
                process.stderr.write(`  Fetched ${completed}/${reposToFetch.length} repos\n`);
            }
        }

        // Update lockfile hash after successful fetch
        await this.cacheService.setLastReleaseFetchHash(this.lockfilePath);
    }
}
