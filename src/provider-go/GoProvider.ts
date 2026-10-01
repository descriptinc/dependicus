import { execSync } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';
import type {
    PackageInfo,
    DependencyInfo,
    DependencyProvider,
    DataSource,
    CacheService,
} from '../core/index';
import { GoProxyRegistrySource } from './GoProxyRegistrySource';

/**
 * A single module entry from `go list -m -json all`.
 * The command emits a concatenated JSON stream (not a JSON array).
 */
interface GoModuleEntry {
    Path: string;
    Version?: string;
    Main?: boolean;
    Indirect?: boolean;
    Replace?: {
        Path: string;
        Version?: string;
    };
}

/**
 * A single package entry from `go list -json=... ./...`, also a concatenated
 * JSON stream.
 */
interface GoPackageEntry {
    ImportPath: string;
    Dir?: string;
    Imports?: string[];
    TestImports?: string[];
    XTestImports?: string[];
}

/** @group Providers */
export interface GoProviderOptions {
    /**
     * Name the consumer a package directory belongs to, given its path
     * relative to the module root (`cmd/billing-api`, `internal/auth`).
     *
     * A Go module is one unit to `go list -m`, so by default every dependency
     * is attributed to the module and the whole backend reads as a single
     * consumer. Supplying this splits that up the way a layout actually works:
     * return the owning service for a directory, so dependencies land against
     * it the way the Node providers attribute to workspace packages.
     *
     * Return undefined to leave a directory's imports attributed to the module
     * itself, which is also what happens to every directory when this is
     * omitted.
     *
     * Reading imports needs the module's sources in `GOMODCACHE`, not just the
     * `go.mod` files that `go list -m all` fetches, so this is opt-in.
     */
    consumerOf?: (relativeDir: string) => string | undefined;
}

/**
 * Response from the Go module proxy `/@latest` or `/@v/<version>.info` endpoints.
 */
interface GoProxyVersionInfo {
    Version: string;
    Time: string;
}

/**
 * Encode a Go module path for the module proxy.
 * Uppercase letters become `!` + lowercase.
 * e.g. `github.com/Azure/sdk` -> `github.com/!azure/sdk`
 */
export function encodeModulePath(path: string): string {
    return path.replace(/[A-Z]/g, (ch) => '!' + ch.toLowerCase());
}

export class GoProvider implements DependencyProvider {
    readonly name = 'go';
    readonly ecosystem = 'gomod';
    readonly supportsCatalog = false;
    readonly installCommand = 'go mod tidy';
    readonly urlPatterns = {
        'Go Packages': 'https://pkg.go.dev/{{name}}',
    };
    readonly updatePrefix = 'Update the dependency version in:';
    readonly updateSuffix = 'Then run `go mod tidy`.';
    readonly updateInstructions =
        'Run `go get <module>@<version>` for each dependency, then run `go mod tidy`.';
    readonly rootDir: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private cachedProjectDirs: string[] | undefined = undefined;

    private readonly options: GoProviderOptions;

    constructor(
        private cacheService: CacheService,
        rootDir: string,
        options: GoProviderOptions = {},
    ) {
        this.rootDir = rootDir;
        this.options = options;
    }

    get lockfilePath(): string {
        const dirs = this.discoverProjectDirs();
        return join(this.rootDir, dirs[0] ?? '.', 'go.sum');
    }

    /**
     * Find all directories under rootDir that contain a go.mod file.
     * Uses git ls-files to avoid traversing node_modules and build artifacts.
     */
    discoverProjectDirs(): string[] {
        if (this.cachedProjectDirs) return this.cachedProjectDirs;

        try {
            const output = execSync('git ls-files', {
                encoding: 'utf-8',
                cwd: this.rootDir,
                maxBuffer: 10 * 1024 * 1024,
            });
            const files = output.trim().split('\n').filter(Boolean);
            const goModFiles = files.filter((f) => f === 'go.mod' || f.endsWith('/go.mod'));
            this.cachedProjectDirs = goModFiles.map((f) => dirname(f)).sort();
        } catch {
            this.cachedProjectDirs = ['.'];
        }

        return this.cachedProjectDirs;
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) return this.cachedPackages;

        process.stderr.write('Reading Go dependencies via go list...\n');

        const projectDirs = this.discoverProjectDirs();
        const allPackages: PackageInfo[] = [];
        let totalDepCount = 0;

        for (const dir of projectDirs) {
            const projectPath = dir === '.' ? this.rootDir : join(this.rootDir, dir);
            const { packages, depCount } = this.listModules(projectPath, dir);
            allPackages.push(...packages);
            totalDepCount += depCount;
        }

        this.cachedPackages = allPackages;
        process.stderr.write(
            `Found ${totalDepCount} Go dependencies across ${allPackages.length} module(s)\n`,
        );
        return allPackages;
    }

    private listModules(
        projectPath: string,
        relativeDir: string,
    ): { packages: PackageInfo[]; depCount: number } {
        let output: string;
        try {
            output = execSync('go list -m -json all', {
                encoding: 'utf-8',
                cwd: projectPath,
                maxBuffer: 10 * 1024 * 1024,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch {
            process.stderr.write(`Failed to run go list in ${projectPath}\n`);
            return { packages: [], depCount: 0 };
        }

        const entries = parseJsonStream(output);
        if (entries.length === 0) return { packages: [], depCount: 0 };

        // The main module has Main: true
        const mainModule = entries.find((e) => e.Main);
        if (!mainModule) return { packages: [], depCount: 0 };

        const dependencies: Record<string, DependencyInfo> = {};
        let depCount = 0;

        for (const entry of entries) {
            if (entry.Main) continue;
            if (entry.Indirect) continue;

            // If replaced with a local directory (no version), skip
            if (entry.Replace && !entry.Replace.Version) continue;

            const version = entry.Replace?.Version ?? entry.Version;
            if (!version) continue;

            dependencies[entry.Path] = {
                from: entry.Path,
                version: cleanGoVersion(version),
                resolved: cleanGoVersion(version),
                path: projectPath,
            };
            depCount++;
        }

        // Use the monorepo-relative directory as the package name for readable "Used By" values
        const packageName = relativeDir === '.' ? basename(projectPath) : relativeDir;
        const version = mainModule.Version ? cleanGoVersion(mainModule.Version) : '0.0.0';

        const attributed = this.options.consumerOf
            ? this.attributeToConsumers(projectPath, entries, dependencies, version)
            : undefined;
        if (attributed) {
            // Whatever nothing imports (a tools.go behind a build tag, say)
            // stays on the module, so it isn't dropped from the report.
            const packages = [...attributed.consumers];
            if (Object.keys(attributed.unattributed).length > 0 || packages.length === 0) {
                packages.push({
                    name: packageName,
                    version,
                    path: projectPath,
                    dependencies: attributed.unattributed,
                });
            }
            return { packages, depCount };
        }

        const packages: PackageInfo[] = [
            {
                name: packageName,
                version,
                path: projectPath,
                dependencies,
            },
        ];

        return { packages, depCount };
    }

    /**
     * Split a module's direct dependencies across the consumers that import
     * them, by reading each Go package's imports and resolving them back to
     * the module that provides them.
     *
     * Returns undefined when the package list can't be read, which leaves the
     * caller on the whole-module attribution.
     */
    private attributeToConsumers(
        projectPath: string,
        modules: GoModuleEntry[],
        directDeps: Record<string, DependencyInfo>,
        version: string,
    ): { consumers: PackageInfo[]; unattributed: Record<string, DependencyInfo> } | undefined {
        const consumerOf = this.options.consumerOf;
        if (!consumerOf) return undefined;

        let output: string;
        try {
            output = execSync(
                'go list -json=ImportPath,Dir,Imports,TestImports,XTestImports ./...',
                {
                    encoding: 'utf-8',
                    cwd: projectPath,
                    maxBuffer: 64 * 1024 * 1024,
                    stdio: ['pipe', 'pipe', 'pipe'],
                },
            );
        } catch {
            process.stderr.write(
                `Could not list Go packages in ${projectPath}; attributing dependencies to the module. ` +
                    'Reading imports needs the module sources, not only its go.mod files.\n',
            );
            return undefined;
        }

        const entries = parseJsonStream<GoPackageEntry>(output);
        if (entries.length === 0) return undefined;

        // Every module, not just the direct ones, so the longest match wins:
        // an import of `example.com/a/b/c` belongs to that module rather than
        // to `example.com/a/b`. Non-direct matches are dropped afterwards.
        const modulePaths = new Set(modules.filter((m) => !m.Main).map((m) => m.Path));

        const byConsumer = new Map<
            string,
            {
                dependencies: Record<string, DependencyInfo>;
                devDependencies: Record<string, DependencyInfo>;
            }
        >();
        const unattributed: Record<string, DependencyInfo> = {};
        const attributedNames = new Set<string>();

        const record = (
            consumer: string | undefined,
            importPaths: readonly string[] | undefined,
            kind: 'dependencies' | 'devDependencies',
        ) => {
            for (const importPath of importPaths ?? []) {
                const modulePath = moduleForImport(importPath, modulePaths);
                if (!modulePath) continue;
                const dep = directDeps[modulePath];
                if (!dep) continue;
                attributedNames.add(modulePath);
                if (!consumer) {
                    unattributed[modulePath] = dep;
                    continue;
                }
                let bucket = byConsumer.get(consumer);
                if (!bucket) {
                    bucket = { dependencies: {}, devDependencies: {} };
                    byConsumer.set(consumer, bucket);
                }
                bucket[kind][modulePath] = dep;
            }
        };

        for (const entry of entries) {
            const relativeDir = entry.Dir ? relative(projectPath, entry.Dir) || '.' : '.';
            const consumer = consumerOf(relativeDir);
            record(consumer, entry.Imports, 'dependencies');
            record(consumer, entry.TestImports, 'devDependencies');
            record(consumer, entry.XTestImports, 'devDependencies');
        }

        for (const [name, dep] of Object.entries(directDeps)) {
            if (!attributedNames.has(name)) unattributed[name] = dep;
        }

        const consumers: PackageInfo[] = [...byConsumer.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, buckets]) => {
                const pkg: PackageInfo = { name, version, path: projectPath };
                if (Object.keys(buckets.dependencies).length > 0) {
                    pkg.dependencies = buckets.dependencies;
                }
                // A module used only by tests is a dev dependency of that
                // consumer, the same as it would be on the Node side.
                const devOnly = Object.fromEntries(
                    Object.entries(buckets.devDependencies).filter(
                        ([depName]) => !buckets.dependencies[depName],
                    ),
                );
                if (Object.keys(devOnly).length > 0) pkg.devDependencies = devOnly;
                return pkg;
            });

        return { consumers, unattributed };
    }

    async resolveVersionMetadata(
        packages: Array<{ name: string; versions: string[] }>,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
        process.stderr.write('Checking Go module proxy for latest versions...\n');

        const result = new Map<
            string,
            { publishDate: string | undefined; latestVersion: string }
        >();

        for (const pkg of packages) {
            for (const version of pkg.versions) {
                const key = `${pkg.name}@${version}`;
                try {
                    const [latestInfo, currentInfo] = await Promise.all([
                        this.fetchProxyInfo(pkg.name, undefined),
                        this.fetchProxyInfo(pkg.name, 'v' + version),
                    ]);

                    const latestVersion = latestInfo ? cleanGoVersion(latestInfo.Version) : version;
                    const publishDate = currentInfo?.Time ?? undefined;

                    result.set(key, { publishDate, latestVersion });
                } catch {
                    result.set(key, { publishDate: undefined, latestVersion: version });
                }
            }
        }

        return result;
    }

    private async fetchProxyInfo(
        modulePath: string,
        version: string | undefined,
    ): Promise<GoProxyVersionInfo | undefined> {
        const encoded = encodeModulePath(modulePath);
        const suffix = version ? `@v/${version}.info` : '@latest';
        const cacheKey = `go-proxy-${version ?? 'latest'}-${modulePath}`;
        const lockfile = this.lockfilePath;

        if (await this.cacheService.isCacheValid(cacheKey, lockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as GoProxyVersionInfo;
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://proxy.golang.org/${encoded}/${suffix}`;
            const response = await fetch(url);
            if (!response.ok) return undefined;

            const data = (await response.json()) as GoProxyVersionInfo;
            await this.cacheService.writeCache(cacheKey, JSON.stringify(data), lockfile);
            return data;
        } catch {
            return undefined;
        }
    }

    createSources(ctx: { cacheService: CacheService }): DataSource[] {
        const goSumPaths = this.discoverProjectDirs().map((d) => join(this.rootDir, d, 'go.sum'));
        return [new GoProxyRegistrySource(ctx.cacheService, goSumPaths)];
    }

    isInCatalog(_name: string, _version: string): boolean {
        return false;
    }

    hasInCatalog(_name: string): boolean {
        return false;
    }

    isPatched(_name: string, _version: string): boolean {
        return false;
    }
}

/**
 * Resolve a Go import path to the module that provides it, preferring the
 * longest match: `example.com/a/b/c` belongs to module `example.com/a/b/c` if
 * that exists, otherwise `example.com/a/b`, and so on. Standard library
 * imports match nothing and return undefined.
 */
function moduleForImport(importPath: string, modulePaths: ReadonlySet<string>): string | undefined {
    const parts = importPath.split('/');
    for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join('/');
        if (modulePaths.has(candidate)) return candidate;
    }
    return undefined;
}

/**
 * Parse a concatenated JSON stream (objects separated by whitespace) into an array.
 * `go list -m -json all` emits `{...}{...}{...}` rather than a JSON array.
 */
function parseJsonStream<T = GoModuleEntry>(raw: string): T[] {
    const entries: T[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                try {
                    entries.push(JSON.parse(raw.slice(start, i + 1)) as T);
                } catch {
                    // skip malformed entries
                }
                start = -1;
            }
        }
    }

    return entries;
}

/**
 * Strip the leading `v` from Go semver tags so Dependicus stores plain semver.
 * e.g. `v1.8.1` -> `1.8.1`
 */
function cleanGoVersion(version: string): string {
    return version.startsWith('v') ? version.slice(1) : version;
}
