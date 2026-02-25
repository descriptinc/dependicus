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

    constructor(private cacheService: CacheService) {
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
     * Cache key for the set of latest versions we last checked for a repo.
     */
    private getCheckedVersionsCacheKey(repo: GitHubRepo): string {
        return `github-checked-versions-${sanitizeCacheKey(repo.owner)}-${sanitizeCacheKey(repo.repo)}`;
    }

    /**
     * Get all releases for a repository.
     * Returns cached releases. The prefetch step handles fetching when needed.
     */
    async getReleases(repo: GitHubRepo): Promise<GitHubRelease[]> {
        const tagsCacheKey = this.getCachedTagsCacheKey(repo);
        const cachedTagsJson = await this.cacheService.readPermanentCache(tagsCacheKey);
        const cachedTags: string[] = cachedTagsJson ? JSON.parse(cachedTagsJson) : [];
        return await this.loadCachedReleases(repo, cachedTags);
    }

    /**
     * Fetch and cache new releases for a repository.
     * Called by prefetchRepoData when cache needs updating.
     */
    private async fetchAndCacheReleases(repo: GitHubRepo): Promise<void> {
        const tagsCacheKey = this.getCachedTagsCacheKey(repo);
        const cachedTagsJson = await this.cacheService.readPermanentCache(tagsCacheKey);
        const cachedTags: string[] = cachedTagsJson ? JSON.parse(cachedTagsJson) : [];

        try {
            const newReleases = await this.fetchNewReleases(repo, cachedTags);

            for (const release of newReleases) {
                const releaseKey = this.getReleaseCacheKey(repo, release.tagName);
                await this.cacheService.writePermanentCache(releaseKey, JSON.stringify(release));
            }

            const allTags = [...new Set([...cachedTags, ...newReleases.map((r) => r.tagName)])];
            await this.cacheService.writePermanentCache(tagsCacheKey, JSON.stringify(allTags));
        } catch (error) {
            if (
                cachedTags.length === 0 &&
                error instanceof Error &&
                'status' in error &&
                error.status === 404
            ) {
                await this.cacheService.writePermanentCache(tagsCacheKey, JSON.stringify([]));
            }
        }
    }

    /**
     * Load releases from permanent cache by tag names.
     */
    private async loadCachedReleases(repo: GitHubRepo, tags: string[]): Promise<GitHubRelease[]> {
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
     * Re-throws rate-limit errors (403/429) so callers can abort gracefully.
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
            const response = await this.octokit.repos.getContent({
                owner: repo.owner,
                repo: repo.repo,
                path: 'CHANGELOG.md',
            });

            const file = response.data;
            if (!Array.isArray(file) && file.type === 'file' && file.html_url) {
                const result: ChangelogInfo = {
                    filename: 'CHANGELOG.md',
                    url: file.html_url,
                };
                await this.cacheService.writePermanentCache(cacheKey, JSON.stringify(result));
                return result;
            }

            await this.cacheService.writePermanentCache(cacheKey, 'null');
            return undefined;
        } catch (error) {
            if (error instanceof Error && 'status' in error) {
                if (error.status === 404) {
                    await this.cacheService.writePermanentCache(cacheKey, 'null');
                } else if (error.status === 403 || error.status === 429) {
                    throw error;
                }
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
     * Check if the cached releases for a repo already cover the given latest
     * versions. Two ways a version is considered "covered":
     *   1. A tag matching the version exists in cached releases (fast path).
     *   2. We already fetched releases while this version was current, so
     *      re-fetching would produce the same result.
     */
    private async hasCachedLatestVersions(
        repo: GitHubRepo,
        entries: Array<{ version: string; packageName: string }>,
    ): Promise<boolean> {
        const tagsCacheKey = this.getCachedTagsCacheKey(repo);
        const cachedTagsJson = await this.cacheService.readPermanentCache(tagsCacheKey);
        if (!cachedTagsJson) return false;

        const cachedTags: string[] = JSON.parse(cachedTagsJson);

        // No releases exist for this repo — re-fetching won't help
        if (cachedTags.length === 0) return true;

        const tagSet = new Set(cachedTags);

        // Load versions we already checked (may not exist yet)
        const checkedKey = this.getCheckedVersionsCacheKey(repo);
        const checkedJson = await this.cacheService.readPermanentCache(checkedKey);
        const checkedVersions = checkedJson
            ? new Set<string>(JSON.parse(checkedJson) as string[])
            : new Set<string>();

        for (const { version, packageName } of entries) {
            // Fast path: a matching tag exists in cached releases
            const candidates = [`v${version}`, version, `${packageName}@${version}`];
            if (packageName.startsWith('@')) {
                const shortName = packageName.split('/')[1];
                if (shortName) {
                    candidates.push(`${shortName}@${version}`);
                }
            }
            if (candidates.some((tag) => tagSet.has(tag))) continue;

            // Slow path: we already fetched while this version was current
            if (checkedVersions.has(version)) continue;

            return false;
        }
        return true;
    }

    /**
     * Prefetch GitHub data for a list of repos, with progress logging.
     * Uses per-repo latest version checking to avoid unnecessary API calls:
     * if the latest version's tag is already cached, we skip that repo entirely.
     */
    async prefetchRepoData(
        repos: GitHubRepo[],
        latestVersions?: Map<string, Array<{ version: string; packageName: string }>>,
    ): Promise<void> {
        // Deduplicate repos by owner/repo
        const uniqueRepos = new Map<string, GitHubRepo>();
        for (const repo of repos) {
            const key = `${repo.owner}/${repo.repo}`;
            if (!uniqueRepos.has(key)) {
                uniqueRepos.set(key, repo);
            }
        }

        // Filter to repos that need fetching
        const reposToFetch: GitHubRepo[] = [];
        for (const [key, repo] of uniqueRepos) {
            const hasReleases = await this.hasReleasesCache(repo);
            const hasChangelog = this.hasChangelogCache(repo);

            // If we have cached tags and they include the latest versions, skip releases
            let needsReleases = !hasReleases;
            if (hasReleases && latestVersions) {
                const entries = latestVersions.get(key);
                if (entries) {
                    const covered = await this.hasCachedLatestVersions(repo, entries);
                    needsReleases = !covered;
                }
            }

            if (needsReleases || !hasChangelog) {
                reposToFetch.push(repo);
            }
        }

        if (reposToFetch.length === 0) {
            process.stderr.write('GitHub data already cached for all repos\n');
            return;
        }

        process.stderr.write(`Fetching GitHub data for ${reposToFetch.length} repos...\n`);

        let completed = 0;
        let changelogRateLimited = false;
        for (const repo of reposToFetch) {
            await this.fetchAndCacheReleases(repo);

            // Record the versions we just checked so we don't re-fetch next run
            const repoKey = `${repo.owner}/${repo.repo}`;
            const entries = latestVersions?.get(repoKey);
            if (entries) {
                const checkedKey = this.getCheckedVersionsCacheKey(repo);
                const versions = [...new Set(entries.map((e) => e.version))];
                await this.cacheService.writePermanentCache(checkedKey, JSON.stringify(versions));
            }

            if (!changelogRateLimited && !this.hasChangelogCache(repo)) {
                try {
                    await this.getChangelogUrl(repo);
                } catch (error) {
                    if (
                        error instanceof Error &&
                        'status' in error &&
                        (error.status === 403 || error.status === 429)
                    ) {
                        changelogRateLimited = true;
                        process.stderr.write(
                            'GitHub rate limit hit, skipping remaining changelog lookups\n',
                        );
                    }
                }
            }

            completed++;
            if (completed % 10 === 0 || completed === reposToFetch.length) {
                process.stderr.write(`  Fetched ${completed}/${reposToFetch.length} repos\n`);
            }
        }
    }
}
