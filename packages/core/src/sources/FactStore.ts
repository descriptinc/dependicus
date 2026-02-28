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
    package: Record<string, Record<string, Record<string, unknown>>>;
    version: Record<string, Record<string, Record<string, Record<string, unknown>>>>;
}

/** Read/write interface for fact storage. */
export interface FactStore {
    getPackageFact<T>(packageName: string, key: string): T | undefined;
    setPackageFact(packageName: string, key: string, value: unknown): void;
    getVersionFact<T>(packageName: string, version: string, key: string): T | undefined;
    setVersionFact(packageName: string, version: string, key: string, value: unknown): void;
    scoped(ecosystem: string): FactStore;
}

/** Concrete root store backed by two flat Maps. */
export class RootFactStore implements FactStore {
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

    scoped(ecosystem: string): ScopedFactStore {
        return new ScopedFactStore(this.packageFacts, this.versionFacts, ecosystem);
    }

    toJSON(): SerializedFacts {
        const pkg: SerializedFacts['package'] = {};
        for (const [compositeKey, value] of this.packageFacts) {
            // Keys are either "pkgName::key" (unscoped) or "eco::pkgName::key" (scoped)
            const firstSep = compositeKey.indexOf('::');
            const secondSep = compositeKey.indexOf('::', firstSep + 2);

            let ecosystem: string, packageName: string, key: string;
            if (secondSep !== -1) {
                // ecosystem::packageName::key
                ecosystem = compositeKey.slice(0, firstSep);
                packageName = compositeKey.slice(firstSep + 2, secondSep);
                key = compositeKey.slice(secondSep + 2);
            } else {
                // packageName::key (unscoped, legacy — store under _root)
                ecosystem = '_root';
                packageName = compositeKey.slice(0, firstSep);
                key = compositeKey.slice(firstSep + 2);
            }

            const ecoPkg = (pkg[ecosystem] ??= {});
            const pkgFacts = (ecoPkg[packageName] ??= {});
            pkgFacts[key] = value;
        }

        const ver: SerializedFacts['version'] = {};
        for (const [compositeKey, value] of this.versionFacts) {
            // Keys are "pkgName::ver::key" (unscoped) or "eco::pkgName::ver::key" (scoped)
            const segments: string[] = [];
            let start = 0;
            let idx = compositeKey.indexOf('::', start);
            while (idx !== -1) {
                segments.push(compositeKey.slice(start, idx));
                start = idx + 2;
                idx = compositeKey.indexOf('::', start);
            }
            segments.push(compositeKey.slice(start));

            let ecosystem: string, packageName: string, version: string, key: string;
            if (segments.length === 4) {
                [ecosystem, packageName, version, key] = segments as [
                    string,
                    string,
                    string,
                    string,
                ];
            } else {
                ecosystem = '_root';
                [packageName, version, key] = segments as [string, string, string];
            }

            const ecoVer = (ver[ecosystem] ??= {});
            const pkgVer = (ecoVer[packageName] ??= {});
            const verFacts = (pkgVer[version] ??= {});
            verFacts[key] = value;
        }

        return { package: pkg, version: ver };
    }

    static fromJSON(data: unknown): RootFactStore {
        const store = new RootFactStore();
        const d = data as Record<string, unknown>;
        const pkgData = (d.package ?? {}) as Record<string, unknown>;
        const verData = (d.version ?? {}) as Record<string, unknown>;

        const isOldPkgFormat = detectOldPackageFormat(pkgData);

        if (isOldPkgFormat) {
            // Old format: { packageName: { key: value } }
            for (const [packageName, facts] of Object.entries(pkgData)) {
                for (const [key, value] of Object.entries(facts as Record<string, unknown>)) {
                    store.setPackageFact(packageName, key, value);
                }
            }
        } else {
            // New format: { ecosystem: { packageName: { key: value } } }
            for (const [ecosystem, packages] of Object.entries(pkgData)) {
                for (const [packageName, facts] of Object.entries(
                    packages as Record<string, Record<string, unknown>>,
                )) {
                    for (const [key, value] of Object.entries(facts)) {
                        if (ecosystem === '_root') {
                            store.setPackageFact(packageName, key, value);
                        } else {
                            store.scoped(ecosystem).setPackageFact(packageName, key, value);
                        }
                    }
                }
            }
        }

        const isOldVerFormat = detectOldVersionFormat(verData);

        if (isOldVerFormat) {
            // Old format: { packageName: { version: { key: value } } }
            for (const [packageName, versions] of Object.entries(verData)) {
                for (const [version, facts] of Object.entries(
                    versions as Record<string, Record<string, unknown>>,
                )) {
                    for (const [key, value] of Object.entries(facts)) {
                        store.setVersionFact(packageName, version, key, value);
                    }
                }
            }
        } else {
            // New format: { ecosystem: { packageName: { version: { key: value } } } }
            for (const [ecosystem, packages] of Object.entries(verData)) {
                for (const [packageName, versions] of Object.entries(
                    packages as Record<string, Record<string, Record<string, unknown>>>,
                )) {
                    for (const [version, facts] of Object.entries(versions)) {
                        for (const [key, value] of Object.entries(facts)) {
                            if (ecosystem === '_root') {
                                store.setVersionFact(packageName, version, key, value);
                            } else {
                                store
                                    .scoped(ecosystem)
                                    .setVersionFact(packageName, version, key, value);
                            }
                        }
                    }
                }
            }
        }

        return store;
    }
}

/** Detect whether package data uses the old flat format. */
function detectOldPackageFormat(data: Record<string, unknown>): boolean {
    // New format always nests unscoped data under `_root`, so the presence of
    // `_root` is a reliable signal.  For purely scoped data the top-level keys
    // are ecosystem identifiers (e.g. "npm", "pip") which are not valid
    // scoped-package names, so we check for well-known FactKeys at depth-1 as
    // a secondary heuristic.
    if ('_root' in data) return false;

    // If any top-level key maps to an object whose keys include a well-known
    // FactKey value, the data is old format (packageName -> { factKey: value }).
    const knownKeys: Set<string> = new Set(Object.values(FactKeys));
    for (const val of Object.values(data)) {
        if (typeof val !== 'object' || val === null || Array.isArray(val)) return true;
        for (const k of Object.keys(val as Record<string, unknown>)) {
            if (knownKeys.has(k)) return true;
        }
        break;
    }
    // Empty or can't determine — default to new (only reached for purely scoped data)
    return false;
}

/** Detect whether version data uses the old flat format. */
function detectOldVersionFormat(data: Record<string, unknown>): boolean {
    // Same primary signal as detectOldPackageFormat.
    if ('_root' in data) return false;

    // In old format, depth-1 keys are semver-like version strings (e.g. "18.2.0").
    // In new format, depth-1 keys are package names (e.g. "react", "@scope/pkg").
    // We use this to distinguish the two.
    const semverish = /^\d+\.\d+/;
    for (const l1 of Object.values(data)) {
        if (typeof l1 !== 'object' || l1 === null) return true;
        for (const k of Object.keys(l1 as Record<string, unknown>)) {
            if (semverish.test(k)) return true;
            // Non-semver key at depth-1 implies new format (package name)
            return false;
        }
        break;
    }
    return false;
}

/** Ecosystem-scoped view into a RootFactStore's backing maps. */
export class ScopedFactStore implements FactStore {
    constructor(
        private readonly packageFacts: Map<string, unknown>,
        private readonly versionFacts: Map<string, unknown>,
        private readonly ecosystem: string,
    ) {}

    scoped(ecosystem: string): FactStore {
        return new ScopedFactStore(this.packageFacts, this.versionFacts, ecosystem);
    }

    setPackageFact(packageName: string, key: string, value: unknown): void {
        this.packageFacts.set(`${this.ecosystem}::${packageName}::${key}`, value);
    }

    getPackageFact<T>(packageName: string, key: string): T | undefined {
        return this.packageFacts.get(`${this.ecosystem}::${packageName}::${key}`) as T | undefined;
    }

    setVersionFact(packageName: string, version: string, key: string, value: unknown): void {
        this.versionFacts.set(`${this.ecosystem}::${packageName}::${version}::${key}`, value);
    }

    getVersionFact<T>(packageName: string, version: string, key: string): T | undefined {
        return this.versionFacts.get(`${this.ecosystem}::${packageName}::${version}::${key}`) as
            | T
            | undefined;
    }
}
