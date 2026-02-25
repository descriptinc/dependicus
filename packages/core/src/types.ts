import type { SerializedFacts } from './sources/FactStore';
import type { FactStore } from './sources/FactStore';
import { FactKeys } from './sources/FactStore';

export interface PnpmPackageInfo {
    name: string;
    version: string;
    path: string;
    private?: boolean;
    dependencies?: Record<string, PnpmDependencyInfo>;
    devDependencies?: Record<string, PnpmDependencyInfo>;
}

export interface PnpmDependencyInfo {
    from: string;
    version: string;
    resolved: string;
    path: string;
}

export interface DependencyVersion {
    version: string;
    latestVersion: string; // latest version from npm registry
    usedBy: string[]; // package names using this version
    dependencyTypes: ('dev' | 'prod')[]; // whether used as dev and/or prod dependency
    publishDate: string; // ISO date string when this version was published
    inCatalog: boolean; // whether this version is pinned in pnpm-workspace.yaml catalog
}

export interface DirectDependency {
    packageName: string;
    versions: DependencyVersion[];
}

export interface DetailPage {
    filename: string;
    html: string;
}

// ============================================================================
// Types preserved for fact reads
// ============================================================================

/**
 * GitHub release information (matches GitHubService.GitHubRelease)
 */
export interface GitHubRelease {
    tagName: string;
    name: string;
    publishedAt: string;
    body: string; // markdown release notes
    htmlUrl: string;
}

/**
 * Version info for upgrade path (matches RegistryService.PackageVersionInfo)
 * @group Core Types
 */
export interface PackageVersionInfo {
    version: string;
    publishDate: string;
    isPrerelease: boolean;
    npmUrl: string;
    unpackedSize?: number;
}

/**
 * GitHub data for a package (shared across versions)
 */
export interface GitHubData {
    owner: string;
    repo: string;
    releases: GitHubRelease[];
    changelogUrl?: string;
}

// ============================================================================
// Output types
// ============================================================================

/**
 * Full dependicus JSON output format
 */
export interface DependicusOutput {
    metadata: OutputMetadata;
    dependencies: DirectDependency[];
    facts: SerializedFacts;
}

export interface OutputMetadata {
    generatedAt: string;
    totalDependencies: number;
    totalPackages: number;
    deprecatedCount: number;
}

export function computeOutputMetadata(
    dependencies: DirectDependency[],
    store: FactStore,
): OutputMetadata {
    let deprecatedCount = 0;
    for (const dep of dependencies) {
        for (const ver of dep.versions) {
            if (
                store.getVersionFact<boolean>(
                    dep.packageName,
                    ver.version,
                    FactKeys.IS_DEPRECATED,
                )
            ) {
                deprecatedCount++;
            }
        }
    }
    return {
        generatedAt: new Date().toISOString(),
        totalDependencies: dependencies.reduce((sum, d) => sum + d.versions.length, 0),
        totalPackages: dependencies.length,
        deprecatedCount,
    };
}

export type UsedByGroupKeyFn = (
    packageName: string,
    version: DependencyVersion,
    store: FactStore,
) => string;

// ============================================================================
// Grouping types
// ============================================================================

/** @group Plugins */
export interface GroupingStat {
    label: string;
    value: string | number;
    url?: string;
}

/** @group Plugins */
export interface GroupingFlag {
    packageName: string;
    version: string;
    detailLink: string;
    label: string;
}

/** @group Plugins */
export interface GroupingSection {
    title: string;
    stats?: GroupingStat[];
    flaggedPackages?: GroupingFlag[];
    html?: string;
}

/** @group Plugins */
export interface GroupingDetailContext {
    groupValue: string;
    dependencies: DirectDependency[];
    store: FactStore;
}

/** @group Plugins */
export interface GroupingConfig {
    key: string;
    label: string;
    slugPrefix?: string;
    /** Extract the grouping value for a package. Returns undefined to exclude. */
    getValue: (packageName: string, store: FactStore) => string | undefined;
    /** Return sections to display on this grouping's detail pages. */
    getSections?: (context: GroupingDetailContext) => GroupingSection[];
}
