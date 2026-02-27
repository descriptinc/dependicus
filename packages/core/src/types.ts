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
 * Per-provider dependency output.
 */
export interface ProviderOutput {
    name: string;
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
    // Map: packageName -> Map<version, merged entry>
    const depMap = new Map<
        string,
        Map<
            string,
            {
                usedBy: Set<string>;
                types: Set<'dev' | 'prod'>;
                latestVersion: string;
                publishDate: string;
                inCatalog: boolean;
            }
        >
    >();

    for (const provider of providers) {
        for (const dep of provider.dependencies) {
            let versionMap = depMap.get(dep.packageName);
            if (!versionMap) {
                versionMap = new Map();
                depMap.set(dep.packageName, versionMap);
            }
            for (const ver of dep.versions) {
                let entry = versionMap.get(ver.version);
                if (!entry) {
                    entry = {
                        usedBy: new Set(),
                        types: new Set(),
                        latestVersion: ver.latestVersion,
                        publishDate: ver.publishDate,
                        inCatalog: ver.inCatalog,
                    };
                    versionMap.set(ver.version, entry);
                }
                for (const u of ver.usedBy) entry.usedBy.add(u);
                for (const t of ver.dependencyTypes) entry.types.add(t);
                if (ver.inCatalog) entry.inCatalog = true;
            }
        }
    }

    const result: DirectDependency[] = [];
    for (const [packageName, versionMap] of depMap) {
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
        result.push({ packageName, versions });
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
