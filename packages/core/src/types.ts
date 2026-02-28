import type { SerializedFacts } from './sources/FactStore';
import type { FactStore } from './sources/FactStore';

export interface PackageInfo {
    name: string;
    version: string;
    path: string;
    private?: boolean;
    dependencies?: Record<string, DependencyInfo>;
    devDependencies?: Record<string, DependencyInfo>;
}

export interface DependencyInfo {
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
    publishDate: string | undefined; // ISO date string when this version was published
    inCatalog: boolean; // whether this version is pinned in pnpm-workspace.yaml catalog
}

export interface DirectDependency {
    packageName: string;
    ecosystem: string;
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
 * Version info for upgrade path (matches NpmRegistryService.PackageVersionInfo)
 * @group Core Types
 */
export interface PackageVersionInfo {
    version: string;
    publishDate: string | undefined;
    isPrerelease: boolean;
    registryUrl?: string;
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
 * Per-provider dependency output.
 */
export interface ProviderOutput {
    name: string;
    ecosystem: string;
    supportsCatalog: boolean;
    dependencies: DirectDependency[];
}

/**
 * Full dependicus JSON output format
 */
export interface DependicusOutput {
    metadata: OutputMetadata;
    providers: ProviderOutput[];
    facts: SerializedFacts;
}

export interface OutputMetadata {
    generatedAt: string;
}

/**
 * Merge dependencies from multiple providers into a single deduplicated list.
 * Merges by (packageName, version), unioning usedBy and dependencyTypes.
 * Useful for consumers that don't care about provider identity (tickets, issues).
 */
export function mergeProviderDependencies(providers: ProviderOutput[]): DirectDependency[] {
    // Map: "ecosystem::packageName" -> Map<version, merged entry>
    const depMap = new Map<
        string,
        {
            ecosystem: string;
            packageName: string;
            versionMap: Map<
                string,
                {
                    usedBy: Set<string>;
                    types: Set<'dev' | 'prod'>;
                    latestVersion: string;
                    publishDate: string | undefined;
                    inCatalog: boolean;
                }
            >;
        }
    >();

    for (const provider of providers) {
        for (const dep of provider.dependencies) {
            const ecosystem = dep.ecosystem ?? provider.ecosystem;
            const key = `${ecosystem}::${dep.packageName}`;
            let entry = depMap.get(key);
            if (!entry) {
                entry = { ecosystem, packageName: dep.packageName, versionMap: new Map() };
                depMap.set(key, entry);
            }
            for (const ver of dep.versions) {
                let vEntry = entry.versionMap.get(ver.version);
                if (!vEntry) {
                    vEntry = {
                        usedBy: new Set(),
                        types: new Set(),
                        latestVersion: ver.latestVersion,
                        publishDate: ver.publishDate,
                        inCatalog: ver.inCatalog,
                    };
                    entry.versionMap.set(ver.version, vEntry);
                }
                for (const u of ver.usedBy) vEntry.usedBy.add(u);
                for (const t of ver.dependencyTypes) vEntry.types.add(t);
                if (ver.inCatalog) vEntry.inCatalog = true;
            }
        }
    }

    const result: DirectDependency[] = [];
    for (const { ecosystem, packageName, versionMap } of depMap.values()) {
        const versions: DependencyVersion[] = [];
        for (const [version, entry] of versionMap) {
            versions.push({
                version,
                latestVersion: entry.latestVersion,
                usedBy: Array.from(entry.usedBy).sort(),
                dependencyTypes: Array.from(entry.types).sort(),
                publishDate: entry.publishDate,
                inCatalog: entry.inCatalog,
            });
        }
        versions.sort((a, b) => b.usedBy.length - a.usedBy.length);
        result.push({ packageName, ecosystem, versions });
    }
    result.sort((a, b) => a.packageName.localeCompare(b.packageName));
    return result;
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
