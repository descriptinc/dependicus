import type { DirectDependency, DataSource, FactStore } from '@dependicus/core';
import { FactKeys } from '@dependicus/core';
import type { DeprecationService } from '../services/DeprecationService';

/**
 * Marks versions as deprecated and computes deprecated transitive dependencies
 * for each direct dependency.
 *
 * Uses the DeprecationService to determine which name@version strings are
 * deprecated, and traces the dependency graph to find deprecated transitives
 * pulled in by each direct dependency.
 */
export class DeprecationSource implements DataSource {
    readonly name = 'deprecation';
    readonly dependsOn: readonly string[] = [];

    constructor(private deprecationService: DeprecationService) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const deprecatedPackages = await this.deprecationService.getDeprecatedPackages();

        // Mark each version as deprecated or not
        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const key = `${dep.name}@${ver.version}`;
                store.setVersionFact(
                    dep.name,
                    ver.version,
                    FactKeys.IS_DEPRECATED,
                    deprecatedPackages.has(key),
                );
            }
        }

        // Build the set of all direct dependency names for filtering
        const allDirectDeps = new Set(dependencies.map((d) => d.name));

        const deprecationMap = await this.deprecationService.getDeprecationMap();

        // For each direct dependency, find deprecated transitive deps it pulls in
        for (const dep of dependencies) {
            const transitiveDeps: string[] = [];

            for (const [deprecatedPkg, pulledInBy] of deprecationMap.entries()) {
                if (pulledInBy.includes(dep.name)) {
                    // Extract the package name (without version) to check if it's direct
                    const atIndex = deprecatedPkg.lastIndexOf('@');
                    if (atIndex > 0) {
                        const pkgName = deprecatedPkg.substring(0, atIndex);
                        if (!allDirectDeps.has(pkgName)) {
                            transitiveDeps.push(deprecatedPkg);
                        }
                    }
                }
            }

            store.setDependencyFact(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS, transitiveDeps);
        }
    }
}
