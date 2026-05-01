import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
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

    constructor(
        private cacheService: CacheService,
        rootDir: string,
    ) {
        this.rootDir = rootDir;
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
        const packages: PackageInfo[] = [
            {
                name: packageName,
                version: mainModule.Version ? cleanGoVersion(mainModule.Version) : '0.0.0',
                path: projectPath,
                dependencies,
            },
        ];

        return { packages, depCount };
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
 * Parse a concatenated JSON stream (objects separated by whitespace) into an array.
 * `go list -m -json all` emits `{...}{...}{...}` rather than a JSON array.
 */
function parseJsonStream(raw: string): GoModuleEntry[] {
    const entries: GoModuleEntry[] = [];
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
                    entries.push(JSON.parse(raw.slice(start, i + 1)) as GoModuleEntry);
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
