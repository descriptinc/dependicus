import type { DirectDependency, PackageVersionInfo } from '../types';
import type { RegistryService } from '../services/RegistryService';
import type { DataSource, FactStore } from './types';
import { FactKeys } from './FactStore';

/**
 * Fetches unpacked-size maps for every package from the npm registry,
 * then augments version-level facts with size data:
 *
 * - Stores the full SIZE_MAP as a package-level fact
 * - Sets UNPACKED_SIZE for each installed version (fallback if NpmRegistrySource
 *   didn't get a size from the full metadata)
 * - Augments each entry in VERSIONS_BETWEEN with its unpackedSize from the map
 *
 * Must run after NpmRegistrySource so that VERSIONS_BETWEEN is already populated.
 */
export class NpmSizeSource implements DataSource {
    readonly name = 'npm-sizes';
    readonly dependsOn: readonly string[] = ['npm-registry'];

    constructor(private registryService: RegistryService) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const packageNames = dependencies.map((d) => d.packageName);
        await this.registryService.prefetchUnpackedSizes(packageNames);

        for (const dep of dependencies) {
            const sizeMap = await this.registryService.getUnpackedSizes(dep.packageName);
            const record: Record<string, number | undefined> = Object.fromEntries(sizeMap);
            store.setPackageFact(dep.packageName, FactKeys.SIZE_MAP, record);

            for (const ver of dep.versions) {
                // Fallback: set UNPACKED_SIZE from sizeMap if not already set by NpmRegistrySource
                const existing = store.getVersionFact<number>(
                    dep.packageName,
                    ver.version,
                    FactKeys.UNPACKED_SIZE,
                );
                if (existing === undefined) {
                    const size = sizeMap.get(ver.version);
                    if (size !== undefined) {
                        store.setVersionFact(
                            dep.packageName,
                            ver.version,
                            FactKeys.UNPACKED_SIZE,
                            size,
                        );
                    }
                }

                // Augment VERSIONS_BETWEEN entries with unpackedSize from the sizeMap
                const versionsBetween = store.getVersionFact<PackageVersionInfo[]>(
                    dep.packageName,
                    ver.version,
                    FactKeys.VERSIONS_BETWEEN,
                );
                if (versionsBetween) {
                    const augmented = versionsBetween.map((v) => ({
                        ...v,
                        unpackedSize: v.unpackedSize ?? sizeMap.get(v.version),
                    }));
                    store.setVersionFact(
                        dep.packageName,
                        ver.version,
                        FactKeys.VERSIONS_BETWEEN,
                        augmented,
                    );
                }
            }
        }
    }
}
