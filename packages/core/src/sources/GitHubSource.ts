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
    readonly dependsOn: readonly string[] = ['npm-registry'];

    constructor(private githubService: GitHubService) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        // Collect unique repos from all version-level rawRepoUrl facts
        const repos: GitHubRepo[] = [];
        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const rawUrl = store.getVersionFact<string>(
                    dep.packageName,
                    ver.version,
                    FactKeys.RAW_REPO_URL,
                );
                const repo = this.githubService.parseRepoUrl(rawUrl);
                if (repo) {
                    repos.push(repo);
                }
            }
        }

        await this.githubService.prefetchRepoData(repos);

        for (const dep of dependencies) {
            // Use the first version's repo URL as the canonical repo for the package
            const firstVersion = dep.versions[0];
            if (!firstVersion) continue;

            const rawUrl = store.getVersionFact<string>(
                dep.packageName,
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

            store.setPackageFact(dep.packageName, FactKeys.GITHUB_DATA, githubData);

            // Store compare URLs for versions that aren't at latest
            for (const ver of dep.versions) {
                if (ver.version !== ver.latestVersion) {
                    const compareUrl = this.githubService.getCompareUrl(
                        githubRepo,
                        ver.version,
                        ver.latestVersion,
                        releases,
                    );
                    store.setVersionFact(
                        dep.packageName,
                        ver.version,
                        FactKeys.COMPARE_URL,
                        compareUrl,
                    );
                }
            }
        }
    }
}
