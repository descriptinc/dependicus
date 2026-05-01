import slugify from 'slugify';
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
    inCatalog: boolean; // whether this version is managed via a provider catalog (e.g. pnpm catalog, bun workspace)
}

export interface DirectDependency {
    name: string;
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
 * GitHub data for a dependency (shared across versions)
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
 * Provider identity and presentation metadata (everything except dependencies).
 */
export interface ProviderInfo {
    name: string;
    ecosystem: string;
    supportsCatalog: boolean;
    installCommand: string;
    urlPatterns: Record<string, string>; // label -> URL template with {{name}}, {{version}}
    updatePrefix?: string; // markdown shown before the usedBy list in issue templates
    updateSuffix?: string; // markdown shown after the usedBy list in issue templates
    updateInstructions?: string; // standalone update instructions for group issues (no usedBy list)
    catalogFile?: string; // file that holds the catalog (e.g. "pnpm-workspace.yaml", "package.json")
    patchHint?: string; // free-form markdown shown when a dependency has local patches applied
}

/**
 * Per-provider dependency output.
 */
export interface ProviderOutput extends ProviderInfo {
    dependencies: DirectDependency[];
}

/**
 * Build a map from ecosystem to ProviderInfo, using the first provider per ecosystem.
 */
export function buildProviderInfoMap(providers: ProviderOutput[]): Map<string, ProviderInfo> {
    const map = new Map<string, ProviderInfo>();
    for (const p of providers) {
        if (!map.has(p.ecosystem)) {
            const { dependencies: _deps, ...info } = p;
            map.set(p.ecosystem, info);
        }
    }
    return map;
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
 * Merges by (name, version), unioning usedBy and dependencyTypes.
 * Useful for consumers that don't care about provider identity (tickets, issues).
 */
export function mergeProviderDependencies(providers: ProviderOutput[]): DirectDependency[] {
    // Map: "ecosystem::name" -> Map<version, merged entry>
    const depMap = new Map<
        string,
        {
            ecosystem: string;
            name: string;
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
            const key = `${ecosystem}::${dep.name}`;
            let entry = depMap.get(key);
            if (!entry) {
                entry = { ecosystem, name: dep.name, versionMap: new Map() };
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
    for (const { ecosystem, name, versionMap } of depMap.values()) {
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
        result.push({ name, ecosystem, versions });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

/** Build the filename for a dependency detail page (e.g., "scope-pkg@1.0.0.html"). */
export function getDetailFilename(name: string, version: string): string {
    const safeName = name
        .replace(/^@/, '')
        .replace(/[/:"<>|*?]/g, '-')
        .replace(/\.\./g, '_');
    const safeVersion = version.replace(/[/:"<>|*?]/g, '-').replace(/\.\./g, '_');
    return `${safeName}@${safeVersion}.html`;
}

/** Build the filename for a grouping detail page (e.g., "Media-Asset-Management-GAT.html"). */
export function getGroupingFilename(value: string): string {
    const slug = slugify(value, { strict: true });
    return `${slug || 'unknown'}.html`;
}

export type DetailUrlFn = (ecosystem: string, name: string, version: string) => string;

/** Build a function that returns the full detail page URL for a given dependency version. */
export function createDetailUrlBuilder(
    dependicusBaseUrl: string,
    providers: ProviderOutput[],
): DetailUrlFn {
    const ecosystemToProvider = new Map<string, string>();
    for (const p of providers) {
        if (!ecosystemToProvider.has(p.ecosystem)) {
            ecosystemToProvider.set(p.ecosystem, p.name);
        }
    }
    return (ecosystem, name, version) => {
        const provider = ecosystemToProvider.get(ecosystem);
        const filename = getDetailFilename(name, version);
        return provider
            ? `${dependicusBaseUrl}/${provider}/details/${filename}`
            : `${dependicusBaseUrl}/details/${filename}`;
    };
}

/**
 * Context passed to column and grouping callbacks that operate on a single
 * dependency version within a known ecosystem.
 */
export interface ColumnContext {
    name: string;
    version: DependencyVersion;
    store: FactStore;
    ecosystem: string;
}

export type UsedByGroupKeyFn = (ctx: ColumnContext) => string;

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
    name: string;
    version: string;
    detailLink: string;
    label: string;
}

/** @group Plugins */
export interface GroupingSection {
    title: string;
    stats?: GroupingStat[];
    flaggedDependencies?: GroupingFlag[];
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
    /** Extract the grouping value for a dependency. Returns undefined to exclude. */
    getValue: (name: string, store: FactStore) => string | undefined;
    /** Return sections to display on this grouping's detail pages. */
    getSections?: (context: GroupingDetailContext) => GroupingSection[];
}
