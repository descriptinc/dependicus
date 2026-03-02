import type { DirectDependency, DependencyVersion, PackageInfo, ProviderOutput } from '../types';
import type { DependencyProvider } from '../providers/DependencyProvider';

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

export class DependencyCollector {
    constructor(private providers: DependencyProvider[]) {}

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
                ...(provider.updatePrefix !== undefined && {
                    updatePrefix: provider.updatePrefix,
                }),
                ...(provider.updateSuffix !== undefined && {
                    updateSuffix: provider.updateSuffix,
                }),
                ...(provider.updateInstructions !== undefined && {
                    updateInstructions: provider.updateInstructions,
                }),
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

        const packages = Array.from(dependencyMap.entries()).map(([name, versionMap]) => ({
            name,
            versions: Array.from(versionMap.keys()),
        }));
        const registryDataMap = await provider.resolveVersionMetadata(packages);

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
