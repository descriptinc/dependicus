import type { DirectDependency } from '../types';
import type { DependencyProvider } from '../providers/DependencyProvider';
import type { DataSource, FactStore } from './types';
import { FactKeys } from './FactStore';

/**
 * Sets workspace-related version facts: patched and catalog mismatch status.
 */
export class WorkspaceSource implements DataSource {
    readonly name = 'workspace';
    readonly dependsOn: readonly string[] = [];

    constructor(private providers: DependencyProvider[]) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const isPatched = this.providers.some((p) =>
                    p.isPatched(dep.packageName, ver.version),
                );
                store.setVersionFact(dep.packageName, ver.version, FactKeys.IS_PATCHED, isPatched);

                const catalogProvider = this.providers.find((p) =>
                    p.hasPackageInCatalog(dep.packageName),
                );
                store.setVersionFact(
                    dep.packageName,
                    ver.version,
                    FactKeys.HAS_CATALOG_MISMATCH,
                    catalogProvider !== undefined &&
                        !catalogProvider.isInCatalog(dep.packageName, ver.version),
                );
            }
        }
    }
}
