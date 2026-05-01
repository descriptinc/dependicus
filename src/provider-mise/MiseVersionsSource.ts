import type {
    DirectDependency,
    PackageVersionInfo,
    DataSource,
    FactStore,
    CacheService,
} from '../core/index';
import { FactKeys } from '../core/index';
import * as semver from 'semver';

/**
 * Fetches version lists from mise-versions.jdx.dev for mise-managed tools.
 * Builds PackageVersionInfo arrays for versions between current and latest.
 * No publish dates, registry URLs, or sizes — mise tools don't have those.
 */
export class MiseVersionsSource implements DataSource {
    readonly name = 'mise-versions';
    readonly dependsOn: readonly string[] = [];

    constructor(
        private cacheService: CacheService,
        private lockfilePaths: string | string[],
    ) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                if (ver.version === ver.latestVersion) continue;

                const versionsBetween = await this.getVersionsBetween(
                    dep.name,
                    ver.version,
                    ver.latestVersion,
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

    private async getVersionsBetween(
        toolName: string,
        currentVersion: string,
        latestVersion: string,
    ): Promise<PackageVersionInfo[]> {
        if (!currentVersion || !latestVersion) return [];
        if (currentVersion === latestVersion) return [];

        const allVersions = await this.fetchToolVersions(toolName);
        if (allVersions.length === 0) return [];

        const versions: PackageVersionInfo[] = [];

        for (const version of allVersions) {
            // Only include valid semver versions
            if (!semver.valid(version)) continue;
            // Skip prereleases
            if (semver.prerelease(version)) continue;

            // Only versions > current and <= latest
            try {
                if (semver.gt(version, currentVersion) && semver.lte(version, latestVersion)) {
                    versions.push({
                        version,
                        publishDate: undefined,
                        isPrerelease: false,
                    });
                }
            } catch {
                // Invalid semver comparison — skip
                continue;
            }
        }

        // Sort by semver ascending
        versions.sort((a, b) => semver.compare(a.version, b.version));
        return versions;
    }

    private async fetchToolVersions(toolName: string): Promise<string[]> {
        const cacheKey = `mise-versions-${toolName}`;
        const primaryLockfile = Array.isArray(this.lockfilePaths)
            ? this.lockfilePaths[0]!
            : this.lockfilePaths;

        if (await this.cacheService.isCacheValid(cacheKey, primaryLockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as string[];
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://mise-versions.jdx.dev/${toolName}`;
            const response = await fetch(url);
            if (!response.ok) return [];

            const text = await response.text();
            const versions = text.trim().split('\n').filter(Boolean);

            await this.cacheService.writeCache(cacheKey, JSON.stringify(versions), primaryLockfile);

            return versions;
        } catch {
            return [];
        }
    }
}
