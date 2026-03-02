import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { satisfies, validRange } from 'semver';

interface PnpmWorkspace {
    patchedDependencies?: Record<string, string>;
    catalog?: Record<string, string>;
}

export class WorkspaceService {
    private patchedDeps: Set<string>;
    private catalogVersions: Map<string, string>;

    constructor(workspaceFilePath?: string) {
        const { patchedDeps, catalogVersions } = workspaceFilePath
            ? this.loadWorkspaceData(workspaceFilePath)
            : { patchedDeps: new Set<string>(), catalogVersions: new Map<string, string>() };
        this.patchedDeps = patchedDeps;
        this.catalogVersions = catalogVersions;
    }

    /**
     * Load patched dependencies and catalog from pnpm-workspace.yaml.
     */
    private loadWorkspaceData(workspaceFilePath: string): {
        patchedDeps: Set<string>;
        catalogVersions: Map<string, string>;
    } {
        const content = readFileSync(workspaceFilePath, 'utf-8');
        const workspace = load(content) as PnpmWorkspace;

        const patchedDeps = workspace.patchedDependencies
            ? new Set(Object.keys(workspace.patchedDependencies))
            : new Set<string>();

        const catalogVersions = new Map<string, string>();
        if (workspace.catalog) {
            for (const [pkg, version] of Object.entries(workspace.catalog)) {
                // Keep the original version string with ^ or ~ for semver range matching
                catalogVersions.set(pkg, version);
            }
        }

        return { patchedDeps, catalogVersions };
    }

    /**
     * Check if a dependency@version is patched.
     */
    isPatched(name: string, version: string): boolean {
        const key = `${name}@${version}`;
        return this.patchedDeps.has(key);
    }

    /**
     * Check if a dependency is in the catalog (regardless of version).
     */
    hasInCatalog(name: string): boolean {
        return this.catalogVersions.has(name);
    }

    /**
     * Check if a dependency version satisfies the catalog range.
     */
    isInCatalog(name: string, version: string): boolean {
        const catalogRange = this.catalogVersions.get(name);
        if (!catalogRange) {
            return false;
        }
        // If the catalog range isn't a valid semver range, fall back to exact match
        if (!validRange(catalogRange)) {
            return version === catalogRange;
        }
        try {
            return satisfies(version, catalogRange);
        } catch {
            return version === catalogRange;
        }
    }
}
