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
 * Response from the crates.io API `/api/v1/crates/{name}`.
 */
interface CratesIoResponse {
    crate: {
        name: string;
        newest_version: string;
        description: string | null;
        homepage: string | null;
        repository: string | null;
    };
    versions: CratesIoVersion[];
}

interface CratesIoVersion {
    num: string;
    created_at: string;
    yanked: boolean;
}

/**
 * Fetches crate metadata from crates.io and stores
 * DESCRIPTION, HOMEPAGE, REPOSITORY_URL, and VERSIONS_BETWEEN facts.
 */
export class CratesIoRegistrySource implements DataSource {
    readonly name = 'crates-io-registry';
    readonly dependsOn: readonly string[] = [];

    constructor(
        private cacheService: CacheService,
        private lockfilePaths: string | string[],
    ) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const seen = new Set<string>();

        for (const dep of dependencies) {
            if (seen.has(dep.name)) continue;
            seen.add(dep.name);

            // Skip packages already at latest
            const needsFetch = dep.versions.some((v) => v.version !== v.latestVersion);
            if (!needsFetch) continue;

            const crateInfo = await this.fetchCrateInfo(dep.name);

            // Store dependency-level facts
            if (crateInfo?.crate.description) {
                store.setDependencyFact(
                    dep.name,
                    FactKeys.DESCRIPTION,
                    crateInfo.crate.description,
                );
            }
            if (crateInfo?.crate.homepage) {
                store.setDependencyFact(dep.name, FactKeys.HOMEPAGE, crateInfo.crate.homepage);
            }
            if (crateInfo?.crate.repository) {
                store.setDependencyFact(
                    dep.name,
                    FactKeys.REPOSITORY_URL,
                    crateInfo.crate.repository,
                );
            }

            // Store version-level facts
            for (const ver of dep.versions) {
                if (ver.version === ver.latestVersion) continue;

                const versionsBetween = this.computeVersionsBetween(
                    dep.name,
                    ver.version,
                    ver.latestVersion,
                    crateInfo,
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

    private computeVersionsBetween(
        crateName: string,
        currentVersion: string,
        latestVersion: string,
        crateInfo: CratesIoResponse | undefined,
    ): PackageVersionInfo[] {
        if (!currentVersion || !latestVersion) return [];
        if (currentVersion === latestVersion) return [];
        if (!crateInfo) return [];

        const versions: PackageVersionInfo[] = [];

        for (const v of crateInfo.versions) {
            if (v.yanked) continue;

            const version = v.num;
            if (!semver.valid(version)) continue;
            if (semver.prerelease(version)) continue;

            try {
                if (semver.gt(version, currentVersion) && semver.lte(version, latestVersion)) {
                    versions.push({
                        version,
                        publishDate: v.created_at,
                        isPrerelease: false,
                        registryUrl: `https://crates.io/crates/${crateName}/${version}`,
                    });
                }
            } catch {
                continue;
            }
        }

        versions.sort((a, b) => semver.compare(a.version, b.version));
        return versions;
    }

    private async fetchCrateInfo(name: string): Promise<CratesIoResponse | undefined> {
        const cacheKey = `crates-io-${name}`;
        const primaryLockfile = Array.isArray(this.lockfilePaths)
            ? this.lockfilePaths[0]!
            : this.lockfilePaths;

        if (await this.cacheService.isCacheValid(cacheKey, primaryLockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as CratesIoResponse;
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'dependicus (https://github.com/nicolo-ribaudo/dependicus)',
                },
            });
            if (!response.ok) return undefined;

            const data = (await response.json()) as CratesIoResponse;
            await this.cacheService.writeCache(cacheKey, JSON.stringify(data), primaryLockfile);
            return data;
        } catch {
            return undefined;
        }
    }
}
