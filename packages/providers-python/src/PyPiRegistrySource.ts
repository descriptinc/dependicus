import type {
    DirectDependency,
    PackageVersionInfo,
    DataSource,
    FactStore,
    CacheService,
} from '@dependicus/core';
import { FactKeys } from '@dependicus/core';
import * as semver from 'semver';

interface PyPiReleaseEntry {
    upload_time_iso_8601: string;
    yanked: boolean;
}

interface PyPiPackageData {
    info: {
        version: string;
        summary: string;
        home_page: string | null;
        project_urls: Record<string, string> | null;
    };
    releases: Record<string, PyPiReleaseEntry[]>;
}

/**
 * Fetches package metadata from the PyPI JSON API and stores
 * DESCRIPTION, HOMEPAGE, REPOSITORY_URL, and VERSIONS_BETWEEN facts.
 */
export class PyPiRegistrySource implements DataSource {
    readonly name = 'pypi-registry';
    readonly dependsOn: readonly string[] = [];

    constructor(
        private cacheService: CacheService,
        private lockfilePaths: string | string[],
    ) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        // Deduplicate package names across all dependency versions
        const seen = new Set<string>();

        for (const dep of dependencies) {
            if (seen.has(dep.name)) continue;
            seen.add(dep.name);

            // Skip packages already at latest (all versions match)
            const needsFetch = dep.versions.some((v) => v.version !== v.latestVersion);
            if (!needsFetch) continue;

            const data = await this.fetchPyPiData(dep.name);
            if (!data) continue;

            // Store dependency-level facts
            if (data.info.summary) {
                store.setDependencyFact(dep.name, FactKeys.DESCRIPTION, data.info.summary);
            }

            const homepage =
                data.info.home_page || findProjectUrl(data.info.project_urls, ['Homepage', 'Home']);
            if (homepage) {
                store.setDependencyFact(dep.name, FactKeys.HOMEPAGE, homepage);
            }

            const repoUrl = findProjectUrl(data.info.project_urls, [
                'Source',
                'Source Code',
                'Repository',
                'GitHub',
                'Code',
            ]);
            if (repoUrl) {
                store.setDependencyFact(dep.name, FactKeys.REPOSITORY_URL, repoUrl);
            }

            // Store version-level facts
            for (const ver of dep.versions) {
                if (ver.version === ver.latestVersion) continue;

                const versionsBetween = buildVersionsBetween(
                    data.releases,
                    ver.version,
                    ver.latestVersion,
                    dep.name,
                );
                store.setVersionFact(
                    dep.name,
                    ver.version,
                    FactKeys.VERSIONS_BETWEEN,
                    versionsBetween,
                );
            }
        }
    }

    private async fetchPyPiData(name: string): Promise<PyPiPackageData | undefined> {
        const cacheKey = `pypi-registry-${name}`;
        const primaryLockfile = Array.isArray(this.lockfilePaths)
            ? this.lockfilePaths[0]!
            : this.lockfilePaths;

        if (await this.cacheService.isCacheValid(cacheKey, primaryLockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as PyPiPackageData;
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://pypi.org/pypi/${name}/json`;
            const response = await fetch(url);
            if (!response.ok) return undefined;

            const data = (await response.json()) as PyPiPackageData;
            await this.cacheService.writeCache(cacheKey, JSON.stringify(data), primaryLockfile);
            return data;
        } catch {
            return undefined;
        }
    }
}

function findProjectUrl(
    urls: Record<string, string> | null,
    keywords: string[],
): string | undefined {
    if (!urls) return undefined;
    for (const keyword of keywords) {
        for (const [key, value] of Object.entries(urls)) {
            if (key.toLowerCase().includes(keyword.toLowerCase())) {
                return value;
            }
        }
    }
    return undefined;
}

function buildVersionsBetween(
    releases: Record<string, PyPiReleaseEntry[]>,
    currentVersion: string,
    latestVersion: string,
    packageName: string,
): PackageVersionInfo[] {
    if (!currentVersion || !latestVersion) return [];
    if (currentVersion === latestVersion) return [];

    const versions: PackageVersionInfo[] = [];

    for (const [version, entries] of Object.entries(releases)) {
        if (!semver.valid(version)) continue;
        if (semver.prerelease(version)) continue;

        // Skip yanked releases
        if (entries.length > 0 && entries.every((e) => e.yanked)) continue;

        try {
            if (semver.gt(version, currentVersion) && semver.lte(version, latestVersion)) {
                const publishDate = entries[0]?.upload_time_iso_8601 ?? undefined;
                versions.push({
                    version,
                    publishDate,
                    isPrerelease: false,
                    registryUrl: `https://pypi.org/project/${packageName}/${version}/`,
                });
            }
        } catch {
            continue;
        }
    }

    versions.sort((a, b) => semver.compare(a.version, b.version));
    return versions;
}
