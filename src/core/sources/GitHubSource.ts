import type { DirectDependency, GitHubData } from '../types';
import type { GitHubService, GitHubRepo } from '../services/GitHubService';
import type { DataSource, FactStore } from './types';
import { FactKeys } from './FactStore';

/**
 * Fetches GitHub releases and changelog URLs for each dependency.
 *
 * Depends on NpmRegistrySource having already stored the raw repository URL
 * as a version fact (`rawRepoUrl`). Parses those URLs into owner/repo pairs,
 * fetches release data in bulk, then stores the assembled GitHubData as a
 * package-level fact and compare URLs as version-level facts.
 */
export class GitHubSource implements DataSource {
    readonly name = 'github';
    readonly dependsOn: readonly string[] = [];
    readonly softDependsOn: readonly string[] = [
        'npm-registry',
        'go-proxy-registry',
        'crates-io-registry',
        'pypi-registry',
        'mise-versions',
    ];

    constructor(private githubService: GitHubService) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        // Collect unique repos and build a map of repo -> latest versions needed
        const repos: GitHubRepo[] = [];
        const repoLatestVersions = new Map<
            string,
            Array<{ version: string; packageName: string }>
        >();
        for (const dep of dependencies) {
            const scoped = store.scoped(dep.ecosystem);
            for (const ver of dep.versions) {
                const rawUrl = scoped.getVersionFact<string>(
                    dep.name,
                    ver.version,
                    FactKeys.RAW_REPO_URL,
                );
                const repo = this.githubService.parseRepoUrl(rawUrl);
                if (repo) {
                    repos.push(repo);
                    const key = `${repo.owner}/${repo.repo}`;
                    const entries = repoLatestVersions.get(key) ?? [];
                    entries.push({ version: ver.latestVersion, packageName: dep.name });
                    repoLatestVersions.set(key, entries);
                }
            }
        }

        await this.githubService.prefetchRepoData(repos, repoLatestVersions);

        for (const dep of dependencies) {
            const scoped = store.scoped(dep.ecosystem);
            const firstVersion = dep.versions[0];
            if (!firstVersion) continue;

            const rawUrl = scoped.getVersionFact<string>(
                dep.name,
                firstVersion.version,
                FactKeys.RAW_REPO_URL,
            );
            const githubRepo = this.githubService.parseRepoUrl(rawUrl);
            if (!githubRepo) continue;

            const releases = await this.githubService.getReleases(githubRepo);
            const changelogInfo = await this.githubService.getChangelogUrl(githubRepo);

            const githubData: GitHubData = {
                owner: githubRepo.owner,
                repo: githubRepo.repo,
                releases: releases.map((r) => ({
                    tagName: r.tagName,
                    name: r.name,
                    publishedAt: r.publishedAt,
                    body: r.body,
                    htmlUrl: r.htmlUrl,
                })),
                changelogUrl: changelogInfo?.url,
            };

            scoped.setDependencyFact(dep.name, FactKeys.GITHUB_DATA, githubData);

            for (const ver of dep.versions) {
                if (ver.version !== ver.latestVersion) {
                    const compareUrl = this.githubService.getCompareUrl(
                        githubRepo,
                        ver.version,
                        ver.latestVersion,
                        releases,
                    );
                    scoped.setVersionFact(dep.name, ver.version, FactKeys.COMPARE_URL, compareUrl);
                }
            }
        }
    }
}
