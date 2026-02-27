import type { DirectDependency, DependencyVersion, PackageInfo } from '../types';
import type { DependencyProvider } from '../providers/DependencyProvider';
import type { RegistryService } from './RegistryService';
import { WORKER_COUNT } from '../constants';
import { processInParallel } from '../utils/workerQueue';

interface PackageWithProvider {
    pkg: PackageInfo;
    provider: DependencyProvider;
}

export class DependencyCollector {
    constructor(
        private providers: DependencyProvider[],
        private registryService: RegistryService,
    ) {}

    /**
     * Collect all direct dependencies across the monorepo.
     * Returns a flat, deduplicated list with version tracking.
     */
    async collectDirectDependencies(): Promise<DirectDependency[]> {
        // Collect packages from all providers
        const allPackagesWithProvider: PackageWithProvider[] = [];
        for (const provider of this.providers) {
            const packages = await provider.getPackages();
            for (const pkg of packages) {
                allPackagesWithProvider.push({ pkg, provider });
            }
        }

        // Map: packageName -> Map<version, {usedBy: Set<string>, types: Set<'dev' | 'prod'>, provider: DependencyProvider}>
        const dependencyMap = new Map<
            string,
            Map<
                string,
                {
                    usedBy: Set<string>;
                    types: Set<'dev' | 'prod'>;
                    provider: DependencyProvider;
                }
            >
        >();

        for (const { pkg, provider } of allPackagesWithProvider) {
            this.processPackageDependencies(pkg, provider, dependencyMap);
        }

        return await this.convertToDirectDependencies(dependencyMap);
    }

    private processPackageDependencies(
        pkg: PackageInfo,
        provider: DependencyProvider,
        dependencyMap: Map<
            string,
            Map<
                string,
                {
                    usedBy: Set<string>;
                    types: Set<'dev' | 'prod'>;
                    provider: DependencyProvider;
                }
            >
        >,
    ): void {
        // Process production dependencies
        if (pkg.dependencies) {
            for (const [depName, depInfo] of Object.entries(pkg.dependencies)) {
                // Skip workspace packages (they have "link:" in their version)
                if (depInfo.version.startsWith('link:')) {
                    continue;
                }

                this.addDependencyToMap(
                    dependencyMap,
                    depName,
                    depInfo.version,
                    pkg.name,
                    'prod',
                    provider,
                );
            }
        }

        // Process dev dependencies
        if (pkg.devDependencies) {
            for (const [depName, depInfo] of Object.entries(pkg.devDependencies)) {
                // Skip workspace packages (they have "link:" in their version)
                if (depInfo.version.startsWith('link:')) {
                    continue;
                }

                this.addDependencyToMap(
                    dependencyMap,
                    depName,
                    depInfo.version,
                    pkg.name,
                    'dev',
                    provider,
                );
            }
        }
    }

    private addDependencyToMap(
        dependencyMap: Map<
            string,
            Map<
                string,
                {
                    usedBy: Set<string>;
                    types: Set<'dev' | 'prod'>;
                    provider: DependencyProvider;
                }
            >
        >,
        depName: string,
        version: string,
        packageName: string,
        type: 'dev' | 'prod',
        provider: DependencyProvider,
    ): void {
        // Get or create version map for this dependency
        let versionMap = dependencyMap.get(depName);
        if (!versionMap) {
            versionMap = new Map();
            dependencyMap.set(depName, versionMap);
        }

        // Get or create entry for this version
        let entry = versionMap.get(version);
        if (!entry) {
            entry = { usedBy: new Set(), types: new Set(), provider };
            versionMap.set(version, entry);
        }

        entry.usedBy.add(packageName);
        entry.types.add(type);
    }

    private async convertToDirectDependencies(
        dependencyMap: Map<
            string,
            Map<
                string,
                {
                    usedBy: Set<string>;
                    types: Set<'dev' | 'prod'>;
                    provider: DependencyProvider;
                }
            >
        >,
    ): Promise<DirectDependency[]> {
        const result: DirectDependency[] = [];

        // Fetch all registry metadata in parallel
        process.stderr.write('Fetching package metadata from npm registry...\n');
        const registryDataMap = await this.fetchAllRegistryData(dependencyMap);

        for (const [packageName, versionMap] of dependencyMap.entries()) {
            const versions: DependencyVersion[] = [];

            for (const [version, entry] of versionMap.entries()) {
                // Get publish date and latest version from cached registry data
                const key = `${packageName}@${version}`;
                const registryData = registryDataMap.get(key);
                const publishDate = registryData?.publishDate || '';
                const latestVersion = registryData?.latestVersion || '';

                // Check if this version is in the catalog via the owning provider
                const inCatalog = entry.provider.isInCatalog(packageName, version);

                // Convert dependency types Set to sorted array
                const dependencyTypes = Array.from(entry.types).sort();

                versions.push({
                    version,
                    latestVersion,
                    usedBy: Array.from(entry.usedBy).sort(),
                    dependencyTypes,
                    publishDate,
                    inCatalog,
                });
            }

            // Sort versions by the number of packages using them (descending)
            versions.sort((a, b) => b.usedBy.length - a.usedBy.length);

            result.push({
                packageName,
                versions,
            });
        }

        // Sort by package name alphabetically
        result.sort((a, b) => a.packageName.localeCompare(b.packageName));

        return result;
    }

    private async fetchAllRegistryData(
        dependencyMap: Map<
            string,
            Map<
                string,
                {
                    usedBy: Set<string>;
                    types: Set<'dev' | 'prod'>;
                    provider: DependencyProvider;
                }
            >
        >,
    ): Promise<Map<string, { publishDate: string; latestVersion: string }>> {
        // Fetch full metadata per package (not per version). This is the same
        // data that NpmRegistrySource.prefetchFullMetadata fetches later, so
        // doing it here means the downstream prefetch is a cache hit.
        const packageNames = Array.from(dependencyMap.keys());

        const metadataMap = new Map<
            string,
            Awaited<ReturnType<typeof this.registryService.getFullPackageMetadata>>
        >();
        let completed = 0;

        await processInParallel(
            packageNames,
            async (packageName) => {
                const metadata = await this.registryService.getFullPackageMetadata(packageName);
                metadataMap.set(packageName, metadata);

                completed++;
                if (completed % 50 === 0 || completed === packageNames.length) {
                    process.stderr.write(
                        `  Fetched ${completed}/${packageNames.length} packages\n`,
                    );
                }
            },
            { workerCount: WORKER_COUNT },
        );

        // Build the per-version result map from the full metadata
        const resultMap = new Map<string, { publishDate: string; latestVersion: string }>();
        for (const [packageName, versionMap] of dependencyMap.entries()) {
            const metadata = metadataMap.get(packageName);
            const latestVersion = metadata?.['dist-tags']?.latest || '';
            for (const version of versionMap.keys()) {
                const publishDate = metadata?.time?.[version] || '';
                resultMap.set(`${packageName}@${version}`, { publishDate, latestVersion });
            }
        }

        return resultMap;
    }
}
