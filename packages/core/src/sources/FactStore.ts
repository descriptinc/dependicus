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
    /** Whether the dependency is an internal fork—this value comes only from custom configuration. `boolean` */
    IS_FORKED: 'isForked',
    /** Whether the installed version differs from the pnpm catalog pin. `boolean` */
    HAS_CATALOG_MISMATCH: 'hasCatalogMismatch',
    /** Raw repository URL before normalization (e.g. git+https://...). `string` */
    RAW_REPO_URL: 'rawRepoUrl',

    // ── Dependency-level facts ────────────────────────────────────────────

    /** Map of version string to unpacked size, for all known versions. `Record<string, number>` */
    SIZE_MAP: 'sizeMap',
    /** GitHub metadata: owner, repo, releases, changelog URL. `GitHubData` */
    GITHUB_DATA: 'githubData',
    /** Names of deprecated transitive dependencies. `string[]` */
    DEPRECATED_TRANSITIVE_DEPS: 'deprecatedTransitiveDeps',
    /** URL patterns/links for this dependency. `Record<string, string>` (label -> URL or template with {{name}}/{{version}}) */
    URLS: 'urls',
} as const;

export interface SerializedFacts {
    dependency: Record<string, Record<string, Record<string, unknown>>>;
    version: Record<string, Record<string, Record<string, Record<string, unknown>>>>;
}

/** Read/write interface for fact storage. */
export interface FactStore {
    getDependencyFact<T>(name: string, key: string): T | undefined;
    setDependencyFact(name: string, key: string, value: unknown): void;
    getVersionFact<T>(name: string, version: string, key: string): T | undefined;
    setVersionFact(name: string, version: string, key: string, value: unknown): void;
    scoped(ecosystem: string): FactStore;
}

/** Concrete root store backed by two flat Maps. */
export class RootFactStore implements FactStore {
    private readonly dependencyFacts = new Map<string, unknown>();
    private readonly versionFacts = new Map<string, unknown>();

    setDependencyFact(name: string, key: string, value: unknown): void {
        this.dependencyFacts.set(`${name}::${key}`, value);
    }

    getDependencyFact<T>(name: string, key: string): T | undefined {
        return this.dependencyFacts.get(`${name}::${key}`) as T | undefined;
    }

    setVersionFact(name: string, version: string, key: string, value: unknown): void {
        this.versionFacts.set(`${name}::${version}::${key}`, value);
    }

    getVersionFact<T>(name: string, version: string, key: string): T | undefined {
        return this.versionFacts.get(`${name}::${version}::${key}`) as T | undefined;
    }

    scoped(ecosystem: string): ScopedFactStore {
        return new ScopedFactStore(this.dependencyFacts, this.versionFacts, ecosystem);
    }

    toJSON(): SerializedFacts {
        const pkg: SerializedFacts['dependency'] = {};
        for (const [compositeKey, value] of this.dependencyFacts) {
            // Keys are either "depName::key" (unscoped) or "eco::depName::key" (scoped)
            const firstSep = compositeKey.indexOf('::');
            const secondSep = compositeKey.indexOf('::', firstSep + 2);

            let ecosystem: string, name: string, key: string;
            if (secondSep !== -1) {
                // ecosystem::depName::key
                ecosystem = compositeKey.slice(0, firstSep);
                name = compositeKey.slice(firstSep + 2, secondSep);
                key = compositeKey.slice(secondSep + 2);
            } else {
                // depName::key (unscoped, legacy — store under _root)
                ecosystem = '_root';
                name = compositeKey.slice(0, firstSep);
                key = compositeKey.slice(firstSep + 2);
            }

            const ecoPkg = (pkg[ecosystem] ??= {});
            const depFacts = (ecoPkg[name] ??= {});
            depFacts[key] = value;
        }

        const ver: SerializedFacts['version'] = {};
        for (const [compositeKey, value] of this.versionFacts) {
            // Keys are "depName::ver::key" (unscoped) or "eco::depName::ver::key" (scoped)
            const segments: string[] = [];
            let start = 0;
            let idx = compositeKey.indexOf('::', start);
            while (idx !== -1) {
                segments.push(compositeKey.slice(start, idx));
                start = idx + 2;
                idx = compositeKey.indexOf('::', start);
            }
            segments.push(compositeKey.slice(start));

            let ecosystem: string, name: string, version: string, key: string;
            if (segments.length === 4) {
                [ecosystem, name, version, key] = segments as [string, string, string, string];
            } else {
                ecosystem = '_root';
                [name, version, key] = segments as [string, string, string];
            }

            const ecoVer = (ver[ecosystem] ??= {});
            const depVer = (ecoVer[name] ??= {});
            const verFacts = (depVer[version] ??= {});
            verFacts[key] = value;
        }

        return { dependency: pkg, version: ver };
    }

    static fromJSON(data: unknown): RootFactStore {
        const store = new RootFactStore();
        const d = data as Record<string, unknown>;
        const pkgData = (d.dependency ?? d.package ?? {}) as Record<string, unknown>;
        const verData = (d.version ?? {}) as Record<string, unknown>;

        const isOldPkgFormat = detectOldPackageFormat(pkgData);

        if (isOldPkgFormat) {
            // Old format: { name: { key: value } }
            for (const [name, facts] of Object.entries(pkgData)) {
                for (const [key, value] of Object.entries(facts as Record<string, unknown>)) {
                    store.setDependencyFact(name, key, value);
                }
            }
        } else {
            // New format: { ecosystem: { name: { key: value } } }
            for (const [ecosystem, deps] of Object.entries(pkgData)) {
                for (const [name, facts] of Object.entries(
                    deps as Record<string, Record<string, unknown>>,
                )) {
                    for (const [key, value] of Object.entries(facts)) {
                        if (ecosystem === '_root') {
                            store.setDependencyFact(name, key, value);
                        } else {
                            store.scoped(ecosystem).setDependencyFact(name, key, value);
                        }
                    }
                }
            }
        }

        const isOldVerFormat = detectOldVersionFormat(verData);

        if (isOldVerFormat) {
            // Old format: { name: { version: { key: value } } }
            for (const [name, versions] of Object.entries(verData)) {
                for (const [version, facts] of Object.entries(
                    versions as Record<string, Record<string, unknown>>,
                )) {
                    for (const [key, value] of Object.entries(facts)) {
                        store.setVersionFact(name, version, key, value);
                    }
                }
            }
        } else {
            // New format: { ecosystem: { name: { version: { key: value } } } }
            for (const [ecosystem, deps] of Object.entries(verData)) {
                for (const [name, versions] of Object.entries(
                    deps as Record<string, Record<string, Record<string, unknown>>>,
                )) {
                    for (const [version, facts] of Object.entries(versions)) {
                        for (const [key, value] of Object.entries(facts)) {
                            if (ecosystem === '_root') {
                                store.setVersionFact(name, version, key, value);
                            } else {
                                store.scoped(ecosystem).setVersionFact(name, version, key, value);
                            }
                        }
                    }
                }
            }
        }

        return store;
    }
}

/** Detect whether dependency data uses the old flat format. */
function detectOldPackageFormat(data: Record<string, unknown>): boolean {
    // New format always nests unscoped data under `_root`, so the presence of
    // `_root` is a reliable signal.  For purely scoped data the top-level keys
    // are ecosystem identifiers (e.g. "npm", "pip") which are not valid
    // scoped-package names, so we check for well-known FactKeys at depth-1 as
    // a secondary heuristic.
    if ('_root' in data) return false;

    // If any top-level key maps to an object whose keys include a well-known
    // FactKey value, the data is old format (name -> { factKey: value }).
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
        private readonly dependencyFacts: Map<string, unknown>,
        private readonly versionFacts: Map<string, unknown>,
        private readonly ecosystem: string,
    ) {}

    scoped(ecosystem: string): FactStore {
        return new ScopedFactStore(this.dependencyFacts, this.versionFacts, ecosystem);
    }

    setDependencyFact(name: string, key: string, value: unknown): void {
        this.dependencyFacts.set(`${this.ecosystem}::${name}::${key}`, value);
    }

    getDependencyFact<T>(name: string, key: string): T | undefined {
        return this.dependencyFacts.get(`${this.ecosystem}::${name}::${key}`) as T | undefined;
    }

    setVersionFact(name: string, version: string, key: string, value: unknown): void {
        this.versionFacts.set(`${this.ecosystem}::${name}::${version}::${key}`, value);
    }

    getVersionFact<T>(name: string, version: string, key: string): T | undefined {
        return this.versionFacts.get(`${this.ecosystem}::${name}::${version}::${key}`) as
            | T
            | undefined;
    }
}
