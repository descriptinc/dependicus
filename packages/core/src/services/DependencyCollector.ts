import type { DirectDependency, DependencyVersion, PackageInfo, ProviderOutput } from '../types';
import type { DependencyProvider } from '../providers/DependencyProvider';
import type { NpmRegistryService } from './NpmRegistryService';
import { WORKER_COUNT } from '../constants';
import { processInParallel } from '../utils/workerQueue';

export interface MetadataResolver {
    resolve(
        packageNames: string[],
        dependencyMap: DependencyMap,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>>;
}

type DependencyMap = Map<
    string,
    Map<
        string,
        {
            usedBy: Set<string>;
            types: Set<'dev' | 'prod'>;
            provider: DependencyProvider;
        }
    >
>;

export class NpmMetadataResolver implements MetadataResolver {
    constructor(private registryService: NpmRegistryService) {}

    async resolve(
        packageNames: string[],
        dependencyMap: DependencyMap,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
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

        const resultMap = new Map<
            string,
            { publishDate: string | undefined; latestVersion: string }
        >();
        for (const [depName, versionMap] of dependencyMap.entries()) {
            const metadata = metadataMap.get(depName);
            const latestVersion = metadata?.['dist-tags']?.latest || '';
            for (const version of versionMap.keys()) {
                const publishDate = metadata?.time?.[version];
                resultMap.set(`${depName}@${version}`, { publishDate, latestVersion });
            }
        }
        return resultMap;
    }
}

export class DependencyCollector {
    constructor(
        private providers: DependencyProvider[],
        private defaultResolver: MetadataResolver,
    ) {}

    /**
     * Collect direct dependencies per provider.
     * Each provider gets its own ProviderOutput entry.
     */
    async collectDirectDependencies(): Promise<ProviderOutput[]> {
        const results: ProviderOutput[] = [];

        for (const provider of this.providers) {
            const packages = await provider.getPackages();

            const dependencyMap: DependencyMap = new Map();
            for (const pkg of packages) {
                this.processPackageDependencies(pkg, provider, dependencyMap);
            }

            const dependencies = await this.convertToDirectDependencies(dependencyMap, provider);
            results.push({
                name: provider.name,
                ecosystem: provider.ecosystem,
                supportsCatalog: provider.supportsCatalog,
                installCommand: provider.installCommand,
                urlPatterns: provider.urlPatterns,
                dependencies,
            });
        }

        return results;
    }

    private processPackageDependencies(
        pkg: PackageInfo,
        provider: DependencyProvider,
        dependencyMap: DependencyMap,
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
        dependencyMap: DependencyMap,
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
        dependencyMap: DependencyMap,
        provider: DependencyProvider,
    ): Promise<DirectDependency[]> {
        const result: DirectDependency[] = [];

        // Use provider's resolver if available, otherwise use default (npm)
        let registryDataMap: Map<
            string,
            { publishDate: string | undefined; latestVersion: string }
        >;
        if (provider.resolveVersionMetadata) {
            const packageNames = Array.from(dependencyMap.keys());
            registryDataMap = await provider.resolveVersionMetadata(packageNames);
        } else {
            process.stderr.write('Fetching package metadata from npm registry...\n');
            registryDataMap = await this.defaultResolver.resolve(
                Array.from(dependencyMap.keys()),
                dependencyMap,
            );
        }

        for (const [depName, versionMap] of dependencyMap.entries()) {
            const versions: DependencyVersion[] = [];

            for (const [version, entry] of versionMap.entries()) {
                const key = `${depName}@${version}`;
                const registryData = registryDataMap.get(key);
                const publishDate = registryData?.publishDate;
                const latestVersion = registryData?.latestVersion ?? '';

                const inCatalog = entry.provider.isInCatalog(depName, version);
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

            versions.sort((a, b) => b.usedBy.length - a.usedBy.length);
            result.push({
                name: depName,
                ecosystem: provider.ecosystem,
                versions,
            });
        }

        result.sort((a, b) => a.name.localeCompare(b.name));
        return result;
    }
}
