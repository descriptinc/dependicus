import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as semver from 'semver';
import type { CacheService } from './CacheService';
import { BUFFER_SIZES, WORKER_COUNT } from '../constants';

const execFileAsync = promisify(execFile);
import { sanitizeCacheKey } from '../utils/formatters';
import { processInParallel } from '../utils/workerQueue';
import type { PackageVersionInfo } from '../types';

export interface PackageMetadata {
    name: string;
    version: string;
    description?: string;
    homepage?: string;
    repository?: {
        type?: string;
        url?: string;
    };
    bugs?: {
        url?: string;
    };
    dist?: {
        unpackedSize?: number;
        fileCount?: number;
        tarball?: string;
    };
    'dist-tags'?: {
        latest?: string;
        [tag: string]: string | undefined;
    };
    time?: {
        [version: string]: string; // ISO date strings
    };
    versions?: string[]; // All available versions
    /** Preserve any other fields returned by `pnpm view`. */
    [key: string]: unknown;
}

export class RegistryService {
    private readonly repoRoot: string;
    private readonly lockfilePath: string;

    constructor(
        private cacheService: CacheService,
        repoRoot: string,
        lockfilePath: string,
    ) {
        this.repoRoot = repoRoot;
        this.lockfilePath = lockfilePath;
    }

    /**
     * Get package metadata from npm registry.
     * @param packageName - Package name
     * @param version - Package version
     * @returns Package metadata including publish date
     */
    async getPackageMetadata(
        packageName: string,
        version: string,
    ): Promise<PackageMetadata | undefined> {
        const cacheKey = `pnpm-view-${sanitizeCacheKey(packageName)}-${sanitizeCacheKey(version)}`;

        let output: string;

        // Registry metadata for a specific package@version never changes, cache permanently
        if (this.cacheService.hasPermanentCache(cacheKey)) {
            output = await this.cacheService.readCache(cacheKey);
        } else {
            try {
                const result = await execFileAsync(
                    'pnpm',
                    ['view', `${packageName}@${version}`, '--json'],
                    { encoding: 'utf-8', maxBuffer: BUFFER_SIZES.LARGE, cwd: this.repoRoot },
                );
                output = result.stdout;
                await this.cacheService.writePermanentCache(cacheKey, output);
            } catch {
                // Package might not exist in registry
                return undefined;
            }
        }

        try {
            return JSON.parse(output) as PackageMetadata;
        } catch {
            return undefined;
        }
    }

    /**
     * Get the publish date for a specific package version.
     * @param packageName - Package name
     * @param version - Package version
     * @returns ISO date string or empty string if not available
     */
    async getPublishDate(packageName: string, version: string): Promise<string> {
        const metadata = await this.getPackageMetadata(packageName, version);
        if (!metadata || !metadata.time) {
            return '';
        }

        return metadata.time[version] || '';
    }

    /**
     * Get the latest version for a package.
     * @param packageName - Package name
     * @param version - Any version of the package (used for cache lookup)
     * @returns Latest version string or empty string if not available
     */
    async getLatestVersion(packageName: string, version: string): Promise<string> {
        const metadata = await this.getPackageMetadata(packageName, version);
        return metadata?.['dist-tags']?.latest || '';
    }

    /**
     * Get full package metadata including all versions.
     * This fetches the package without a version specifier to get the full list.
     * Cache is invalidated when the lockfile changes.
     * @param packageName - Package name
     * @returns Full package metadata including versions array and time object
     */
    async getFullPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
        const cacheKey = `pnpm-view-full-${sanitizeCacheKey(packageName)}`;

        let output: string;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            output = await this.cacheService.readCache(cacheKey);
        } else {
            try {
                const result = await execFileAsync('pnpm', ['view', packageName, '--json'], {
                    encoding: 'utf-8',
                    maxBuffer: BUFFER_SIZES.LARGE,
                    cwd: this.repoRoot,
                });
                output = result.stdout;
                await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
            } catch {
                return undefined;
            }
        }

        try {
            return JSON.parse(output) as PackageMetadata;
        } catch {
            return undefined;
        }
    }

    /**
     * Get all non-prerelease versions between the current version and latest (exclusive of current, inclusive of latest).
     * @param packageName - Package name
     * @param currentVersion - Currently used version
     * @param latestVersion - Latest available version
     * @returns Array of version info objects, sorted from oldest to newest
     */
    async getVersionsBetween(
        packageName: string,
        currentVersion: string,
        latestVersion: string,
    ): Promise<PackageVersionInfo[]> {
        if (!currentVersion || !latestVersion) return [];
        if (currentVersion === latestVersion) return [];

        const metadata = await this.getFullPackageMetadata(packageName);
        if (!metadata?.versions || !metadata?.time) return [];

        const versions: PackageVersionInfo[] = [];

        for (const version of metadata.versions) {
            // Skip if not a valid semver
            if (!semver.valid(version)) continue;

            // Skip prereleases
            if (semver.prerelease(version)) continue;

            // Only include versions > current and <= latest
            if (semver.gt(version, currentVersion) && semver.lte(version, latestVersion)) {
                const publishDate = metadata.time[version] || '';
                versions.push({
                    version,
                    publishDate,
                    isPrerelease: false,
                    npmUrl: `https://www.npmjs.com/package/${packageName}/v/${version}`,
                });
            }
        }

        // Sort by semver ascending (oldest first)
        versions.sort((a, b) => semver.compare(a.version, b.version));

        return versions;
    }

    /**
     * Check if full package metadata is cached (and cache is still valid).
     */
    async hasFullMetadataCache(packageName: string): Promise<boolean> {
        const cacheKey = `pnpm-view-full-${sanitizeCacheKey(packageName)}`;
        return await this.cacheService.isCacheValid(cacheKey, this.lockfilePath);
    }

    /**
     * Get unpacked sizes for all versions of a package using the abbreviated packument.
     * One HTTP request per package returns dist.unpackedSize for every published version.
     * Cache is invalidated when the lockfile changes (same lifecycle as full metadata).
     */
    async getUnpackedSizes(packageName: string): Promise<Map<string, number | undefined>> {
        const cacheKey = `npm-sizes-${sanitizeCacheKey(packageName)}`;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                const entries: Array<[string, number]> = JSON.parse(cached);
                return new Map(entries);
            } catch {
                // Corrupt cache; fall through to fetch
            }
        }

        try {
            const encodedName = packageName.startsWith('@')
                ? `@${encodeURIComponent(packageName.slice(1))}`
                : encodeURIComponent(packageName);
            const response = await fetch(`https://registry.npmjs.org/${encodedName}`, {
                headers: { Accept: 'application/vnd.npm.install-v1+json' },
            });

            if (!response.ok) {
                return new Map();
            }

            const data = (await response.json()) as {
                versions?: Record<string, { dist?: { unpackedSize?: number } }>;
            };

            const sizeMap = new Map<string, number | undefined>();
            if (data.versions) {
                for (const [version, info] of Object.entries(data.versions)) {
                    sizeMap.set(version, info.dist?.unpackedSize);
                }
            }

            // Only cache entries with known sizes; undefined values serialize
            // as null in JSON, which downstream code can't distinguish from undefined.
            const definedEntries = [...sizeMap.entries()].filter(
                (entry): entry is [string, number] => entry[1] !== undefined,
            );
            await this.cacheService.writeCache(
                cacheKey,
                JSON.stringify(definedEntries),
                this.lockfilePath,
            );

            return sizeMap;
        } catch {
            return new Map();
        }
    }

    /**
     * Prefetch unpacked sizes for a list of packages, fetching uncached ones in parallel.
     */
    async prefetchUnpackedSizes(packageNames: string[]): Promise<void> {
        const toFetch: string[] = [];
        for (const name of packageNames) {
            const cacheKey = `npm-sizes-${sanitizeCacheKey(name)}`;
            if (!(await this.cacheService.isCacheValid(cacheKey, this.lockfilePath))) {
                toFetch.push(name);
            }
        }

        if (toFetch.length === 0) {
            return;
        }

        process.stderr.write(`Fetching size data for ${toFetch.length} packages...\n`);

        let completed = 0;
        await processInParallel(
            toFetch,
            async (name) => {
                await this.getUnpackedSizes(name);
                completed++;
                if (completed % 50 === 0 || completed === toFetch.length) {
                    process.stderr.write(`  Fetched ${completed}/${toFetch.length} packages\n`);
                }
            },
            { workerCount: WORKER_COUNT },
        );
    }

    /**
     * Prefetch full metadata for a list of packages, with progress logging.
     */
    async prefetchFullMetadata(packageNames: string[]): Promise<void> {
        // Filter to packages that need fetching
        const toFetch: string[] = [];
        for (const name of packageNames) {
            if (!(await this.hasFullMetadataCache(name))) {
                toFetch.push(name);
            }
        }

        if (toFetch.length === 0) {
            process.stderr.write('npm version data already cached for all packages\n');
            return;
        }

        process.stderr.write(`Fetching npm version data for ${toFetch.length} packages...\n`);

        let completed = 0;
        await processInParallel(
            toFetch,
            async (name) => {
                await this.getFullPackageMetadata(name);
                completed++;
                if (completed % 50 === 0 || completed === toFetch.length) {
                    process.stderr.write(`  Fetched ${completed}/${toFetch.length} packages\n`);
                }
            },
            { workerCount: WORKER_COUNT },
        );
    }
}
