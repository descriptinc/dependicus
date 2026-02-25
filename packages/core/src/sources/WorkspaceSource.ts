import type { DirectDependency } from '../types';
import type { WorkspaceService } from '../services/WorkspaceService';
import type { DataSource, FactStore } from './types';
import { FactKeys } from './FactStore';

/**
 * Sets workspace-related version facts: patched and catalog mismatch status.
 */
export class WorkspaceSource implements DataSource {
    readonly name = 'workspace';
    readonly dependsOn: readonly string[] = [];

    constructor(private workspaceService: WorkspaceService) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                store.setVersionFact(
                    dep.packageName,
                    ver.version,
                    FactKeys.IS_PATCHED,
                    this.workspaceService.isPatched(dep.packageName, ver.version),
                );
                store.setVersionFact(
                    dep.packageName,
                    ver.version,
                    FactKeys.HAS_CATALOG_MISMATCH,
                    this.workspaceService.hasPackageInCatalog(dep.packageName) &&
                        !this.workspaceService.isInCatalog(dep.packageName, ver.version),
                );
            }
        }
    }
}
