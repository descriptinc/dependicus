import type {
    DirectDependency,
    PackageVersionInfo,
    DataSource,
    FactStore,
    CacheService,
} from '../core/index';
import { FactKeys } from '../core/index';
import * as semver from 'semver';
import { encodeModulePath } from './GoProvider';

/**
 * Derive a repository URL from a Go module path.
 * For well-known hosts (github.com, gitlab.com, bitbucket.org),
 * the repo is the first three path segments. Otherwise fall back to pkg.go.dev.
 */
function deriveRepoUrl(modulePath: string): string {
    const parts = modulePath.split('/');
    if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(parts[0]!)) {
        return `https://${parts.slice(0, 3).join('/')}`;
    }
    return `https://pkg.go.dev/${modulePath}`;
}

/**
 * Fetches package metadata from the Go module proxy and stores
 * HOMEPAGE, REPOSITORY_URL, and VERSIONS_BETWEEN facts.
 */
export class GoProxyRegistrySource implements DataSource {
    readonly name = 'go-proxy-registry';
    readonly dependsOn: readonly string[] = [];

    constructor(
        private cacheService: CacheService,
        private goSumPaths: string | string[],
    ) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const seen = new Set<string>();

        for (const dep of dependencies) {
            if (seen.has(dep.name)) continue;
            seen.add(dep.name);

            // Skip packages already at latest
            const needsFetch = dep.versions.some((v) => v.version !== v.latestVersion);
            if (!needsFetch) continue;

            // Store dependency-level facts
            store.setDependencyFact(dep.name, FactKeys.HOMEPAGE, `https://pkg.go.dev/${dep.name}`);
            store.setDependencyFact(dep.name, FactKeys.REPOSITORY_URL, deriveRepoUrl(dep.name));

            // Store version-level facts
            for (const ver of dep.versions) {
                if (ver.version === ver.latestVersion) continue;

                const versionsBetween = await this.fetchVersionsBetween(
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

    private async fetchVersionsBetween(
        modulePath: string,
        currentVersion: string,
        latestVersion: string,
    ): Promise<PackageVersionInfo[]> {
        if (!currentVersion || !latestVersion) return [];
        if (currentVersion === latestVersion) return [];

        const versionList = await this.fetchVersionList(modulePath);
        if (!versionList) return [];

        const versions: PackageVersionInfo[] = [];

        for (const rawVersion of versionList) {
            const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
            if (!semver.valid(version)) continue;
            if (semver.prerelease(version)) continue;

            try {
                if (semver.gt(version, currentVersion) && semver.lte(version, latestVersion)) {
                    const info = await this.fetchVersionInfo(modulePath, rawVersion);
                    versions.push({
                        version,
                        publishDate: info?.Time ?? undefined,
                        isPrerelease: false,
                        registryUrl: `https://pkg.go.dev/${modulePath}@${rawVersion}`,
                    });
                }
            } catch {
                continue;
            }
        }

        versions.sort((a, b) => semver.compare(a.version, b.version));
        return versions;
    }

    private async fetchVersionList(modulePath: string): Promise<string[] | undefined> {
        const encoded = encodeModulePath(modulePath);
        const cacheKey = `go-proxy-versions-${modulePath}`;
        const primaryLockfile = Array.isArray(this.goSumPaths)
            ? this.goSumPaths[0]!
            : this.goSumPaths;

        if (await this.cacheService.isCacheValid(cacheKey, primaryLockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as string[];
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://proxy.golang.org/${encoded}/@v/list`;
            const response = await fetch(url);
            if (!response.ok) return undefined;

            const text = await response.text();
            const versions = text.trim().split('\n').filter(Boolean);
            await this.cacheService.writeCache(cacheKey, JSON.stringify(versions), primaryLockfile);
            return versions;
        } catch {
            return undefined;
        }
    }

    private async fetchVersionInfo(
        modulePath: string,
        version: string,
    ): Promise<{ Version: string; Time: string } | undefined> {
        const encoded = encodeModulePath(modulePath);
        const cacheKey = `go-proxy-vinfo-${modulePath}-${version}`;
        const primaryLockfile = Array.isArray(this.goSumPaths)
            ? this.goSumPaths[0]!
            : this.goSumPaths;

        if (await this.cacheService.isCacheValid(cacheKey, primaryLockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as { Version: string; Time: string };
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://proxy.golang.org/${encoded}/@v/${version}.info`;
            const response = await fetch(url);
            if (!response.ok) return undefined;

            const data = (await response.json()) as { Version: string; Time: string };
            await this.cacheService.writeCache(cacheKey, JSON.stringify(data), primaryLockfile);
            return data;
        } catch {
            return undefined;
        }
    }
}
