// Copyright 2026 Descript, Inc
/**
 * Well-known fact keys used by data sources and consumers.
 * @group Data Collection
 */
export const FactKeys = {
    // ── Version-level facts ──────────────────────────────────────────────

    /** npm package description. `string` */
    DESCRIPTION: 'description',
    /** npm homepage URL. `string` */
    HOMEPAGE: 'homepage',
    /** Source repository URL (normalized). `string` */
    REPOSITORY_URL: 'repositoryUrl',
    /** Bug tracker URL. `string` */
    BUGS_URL: 'bugsUrl',
    /** Unpacked tarball size in bytes. `number` */
    UNPACKED_SIZE: 'unpackedSize',
    /** All versions between current and latest, oldest first. `PackageVersionInfo[]` */
    VERSIONS_BETWEEN: 'versionsBetween',
    /** GitHub compare URL from the installed version to latest. `string` */
    COMPARE_URL: 'compareUrl',
    /** Whether this specific version is deprecated on npm. `boolean` */
    IS_DEPRECATED: 'isDeprecated',
    /** Whether the installed version has local patches (e.g. pnpm patch). `boolean` */
    IS_PATCHED: 'isPatched',
    /** Whether the package is an internal fork—this value comes only from custom configuration. `boolean` */
    IS_FORKED: 'isForked',
    /** Whether the installed version differs from the pnpm catalog pin. `boolean` */
    HAS_CATALOG_MISMATCH: 'hasCatalogMismatch',
    /** Raw repository URL before normalization (e.g. git+https://...). `string` */
    RAW_REPO_URL: 'rawRepoUrl',

    // ── Package-level facts ──────────────────────────────────────────────

    /** Map of version string to unpacked size, for all known versions. `Record<string, number>` */
    SIZE_MAP: 'sizeMap',
    /** GitHub metadata: owner, repo, releases, changelog URL. `GitHubData` */
    GITHUB_DATA: 'githubData',
    /** Names of deprecated transitive dependencies. `string[]` */
    DEPRECATED_TRANSITIVE_DEPS: 'deprecatedTransitiveDeps',
} as const;

export interface SerializedFacts {
    package: Record<string, Record<string, unknown>>;
    version: Record<string, Record<string, Record<string, unknown>>>;
}

export class FactStore {
    private readonly packageFacts = new Map<string, unknown>();
    private readonly versionFacts = new Map<string, unknown>();

    setPackageFact(packageName: string, key: string, value: unknown): void {
        this.packageFacts.set(`${packageName}::${key}`, value);
    }

    getPackageFact<T>(packageName: string, key: string): T | undefined {
        return this.packageFacts.get(`${packageName}::${key}`) as T | undefined;
    }

    setVersionFact(packageName: string, version: string, key: string, value: unknown): void {
        this.versionFacts.set(`${packageName}::${version}::${key}`, value);
    }

    getVersionFact<T>(packageName: string, version: string, key: string): T | undefined {
        return this.versionFacts.get(`${packageName}::${version}::${key}`) as T | undefined;
    }

    toJSON(): SerializedFacts {
        const pkg: Record<string, Record<string, unknown>> = {};
        for (const [compositeKey, value] of this.packageFacts) {
            const sepIdx = compositeKey.indexOf('::');
            const packageName = compositeKey.slice(0, sepIdx);
            const key = compositeKey.slice(sepIdx + 2);
            if (!pkg[packageName]) {
                pkg[packageName] = {};
            }
            pkg[packageName][key] = value;
        }

        const ver: Record<string, Record<string, Record<string, unknown>>> = {};
        for (const [compositeKey, value] of this.versionFacts) {
            const firstSep = compositeKey.indexOf('::');
            const secondSep = compositeKey.indexOf('::', firstSep + 2);
            const packageName = compositeKey.slice(0, firstSep);
            const version = compositeKey.slice(firstSep + 2, secondSep);
            const key = compositeKey.slice(secondSep + 2);
            if (!ver[packageName]) {
                ver[packageName] = {};
            }
            if (!ver[packageName][version]) {
                ver[packageName][version] = {};
            }
            ver[packageName][version][key] = value;
        }

        return { package: pkg, version: ver };
    }

    static fromJSON(data: SerializedFacts): FactStore {
        const store = new FactStore();

        for (const [packageName, facts] of Object.entries(data.package)) {
            for (const [key, value] of Object.entries(facts)) {
                store.setPackageFact(packageName, key, value);
            }
        }

        for (const [packageName, versions] of Object.entries(data.version)) {
            for (const [version, facts] of Object.entries(versions)) {
                for (const [key, value] of Object.entries(facts)) {
                    store.setVersionFact(packageName, version, key, value);
                }
            }
        }

        return store;
    }
}
