import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import type {
    PackageInfo,
    DependencyInfo,
    DependencyProvider,
    DataSource,
    CacheService,
} from '@dependicus/core';
import { CratesIoRegistrySource } from './CratesIoRegistrySource';

/**
 * Top-level output of `cargo metadata --format-version 1`.
 */
interface CargoMetadata {
    packages: CargoPackage[];
    workspace_members: string[];
    resolve: {
        nodes: CargoResolveNode[];
    };
}

interface CargoPackage {
    id: string;
    name: string;
    version: string;
    source: string | null;
    manifest_path: string;
    description?: string | null;
    homepage?: string | null;
    repository?: string | null;
}

interface CargoResolveNode {
    id: string;
    deps: CargoResolveDep[];
}

interface CargoResolveDep {
    name: string;
    pkg: string;
    dep_kinds: CargoDepKind[];
}

interface CargoDepKind {
    kind: null | 'dev' | 'build';
    target: string | null;
}

/**
 * Response from the crates.io API `/api/v1/crates/{name}`.
 */
interface CratesIoResponse {
    crate: {
        name: string;
        newest_version: string;
        description: string | null;
        homepage: string | null;
        repository: string | null;
    };
    versions: CratesIoVersion[];
}

interface CratesIoVersion {
    num: string;
    created_at: string;
    yanked: boolean;
}

/**
 * Parse a Cargo package ID to extract the crate name and version.
 *
 * Package IDs look like:
 *   `registry+https://github.com/rust-lang/crates.io-index#serde@1.0.210`
 *   `path+file:///home/user/project#my-crate@0.1.0`
 *
 * The name and version come after `#`, split on the last `@`.
 */
export function parsePackageId(id: string): { name: string; version: string } | undefined {
    const hashIdx = id.indexOf('#');
    if (hashIdx < 0) return undefined;

    const fragment = id.slice(hashIdx + 1);
    const atIdx = fragment.lastIndexOf('@');
    if (atIdx < 0) return undefined;

    return {
        name: fragment.slice(0, atIdx),
        version: fragment.slice(atIdx + 1),
    };
}

export class CargoProvider implements DependencyProvider {
    readonly name = 'rust';
    readonly ecosystem = 'cargo';
    readonly supportsCatalog = false;
    readonly installCommand = 'cargo update';
    readonly urlPatterns = {
        'crates.io': 'https://crates.io/crates/{{name}}',
    };
    readonly updateInstructions =
        'Update each dependency in the appropriate Cargo.toml, then run `cargo update`.';
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
        return join(this.rootDir, dirs[0] ?? '.', 'Cargo.lock');
    }

    /**
     * Find all directories under rootDir that contain a Cargo.lock file.
     * Cargo.lock exists once per workspace root, naturally deduplicating.
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
            const lockFiles = files.filter((f) => f === 'Cargo.lock' || f.endsWith('/Cargo.lock'));
            this.cachedProjectDirs = lockFiles.map((f) => dirname(f)).sort();
        } catch {
            this.cachedProjectDirs = ['.'];
        }

        return this.cachedProjectDirs;
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) return this.cachedPackages;

        process.stderr.write('Reading Rust dependencies via cargo metadata...\n');

        const projectDirs = this.discoverProjectDirs();
        const allPackages: PackageInfo[] = [];
        let totalDepCount = 0;

        for (const dir of projectDirs) {
            const projectPath = dir === '.' ? this.rootDir : join(this.rootDir, dir);
            const { packages, depCount } = this.parseCargoMetadata(projectPath, dir);
            allPackages.push(...packages);
            totalDepCount += depCount;
        }

        this.cachedPackages = allPackages;
        process.stderr.write(
            `Found ${totalDepCount} Rust dependencies across ${allPackages.length} workspace member(s)\n`,
        );
        return allPackages;
    }

    private parseCargoMetadata(
        projectPath: string,
        relativeDir: string,
    ): { packages: PackageInfo[]; depCount: number } {
        let output: string;
        try {
            output = execSync('cargo metadata --format-version 1', {
                encoding: 'utf-8',
                cwd: projectPath,
                maxBuffer: 50 * 1024 * 1024,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch {
            process.stderr.write(`Failed to run cargo metadata in ${projectPath}\n`);
            return { packages: [], depCount: 0 };
        }

        let metadata: CargoMetadata;
        try {
            metadata = JSON.parse(output) as CargoMetadata;
        } catch {
            process.stderr.write(`Failed to parse cargo metadata output in ${projectPath}\n`);
            return { packages: [], depCount: 0 };
        }

        const workspaceMembers = new Set(metadata.workspace_members);

        // Build a lookup from package ID to package info
        const packageById = new Map<string, CargoPackage>();
        for (const pkg of metadata.packages) {
            packageById.set(pkg.id, pkg);
        }

        const allPackages: PackageInfo[] = [];
        let totalDepCount = 0;

        for (const memberId of workspaceMembers) {
            const memberPkg = packageById.get(memberId);
            if (!memberPkg) continue;

            // Find the resolve node for this member
            const node = metadata.resolve.nodes.find((n) => n.id === memberId);
            if (!node) continue;

            const dependencies: Record<string, DependencyInfo> = {};
            const devDependencies: Record<string, DependencyInfo> = {};

            for (const dep of node.deps) {
                const depPkg = packageById.get(dep.pkg);
                if (!depPkg) continue;

                // Skip path dependencies (workspace-local crates have source === null)
                if (depPkg.source === null) continue;

                const parsed = parsePackageId(dep.pkg);
                if (!parsed) continue;

                const depInfo: DependencyInfo = {
                    from: parsed.name,
                    version: parsed.version,
                    resolved: parsed.version,
                    path: projectPath,
                };

                // Classify: if ALL dep_kinds have kind === 'dev', it's a dev dependency
                const isDevOnly =
                    dep.dep_kinds.length > 0 && dep.dep_kinds.every((dk) => dk.kind === 'dev');

                if (isDevOnly) {
                    devDependencies[parsed.name] = depInfo;
                } else {
                    dependencies[parsed.name] = depInfo;
                }

                totalDepCount++;
            }

            // Use workspace-relative directory path for package name (like Go provider)
            const manifestDir = dirname(memberPkg.manifest_path);
            const relManifest = manifestDir.startsWith(projectPath)
                ? manifestDir.slice(projectPath.length).replace(/^\//, '')
                : '';
            let packageName: string;
            if (relManifest && relativeDir !== '.') {
                packageName = join(relativeDir, relManifest);
            } else if (relManifest) {
                packageName = relManifest;
            } else if (relativeDir === '.') {
                packageName = basename(projectPath);
            } else {
                packageName = relativeDir;
            }

            allPackages.push({
                name: packageName,
                version: memberPkg.version,
                path: projectPath,
                dependencies: Object.keys(dependencies).length > 0 ? dependencies : undefined,
                devDependencies:
                    Object.keys(devDependencies).length > 0 ? devDependencies : undefined,
            });
        }

        return { packages: allPackages, depCount: totalDepCount };
    }

    async resolveVersionMetadata(
        packages: Array<{ name: string; versions: string[] }>,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
        process.stderr.write('Checking crates.io for latest versions...\n');

        const result = new Map<
            string,
            { publishDate: string | undefined; latestVersion: string }
        >();

        for (const pkg of packages) {
            const crateInfo = await this.fetchCrateInfo(pkg.name);

            for (const version of pkg.versions) {
                const key = `${pkg.name}@${version}`;

                if (!crateInfo) {
                    result.set(key, { publishDate: undefined, latestVersion: version });
                    continue;
                }

                const latestVersion = crateInfo.crate.newest_version;
                const versionEntry = crateInfo.versions.find((v) => v.num === version);
                const publishDate = versionEntry?.created_at ?? undefined;

                result.set(key, { publishDate, latestVersion });
            }
        }

        return result;
    }

    private async fetchCrateInfo(name: string): Promise<CratesIoResponse | undefined> {
        const cacheKey = `crates-io-${name}`;
        const lockfile = this.lockfilePath;

        if (await this.cacheService.isCacheValid(cacheKey, lockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as CratesIoResponse;
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'dependicus (https://github.com/nicolo-ribaudo/dependicus)',
                },
            });
            if (!response.ok) return undefined;

            const data = (await response.json()) as CratesIoResponse;
            await this.cacheService.writeCache(cacheKey, JSON.stringify(data), lockfile);
            return data;
        } catch {
            return undefined;
        }
    }

    createSources(ctx: { cacheService: CacheService }): DataSource[] {
        const lockPaths = this.discoverProjectDirs().map((d) =>
            join(this.rootDir, d, 'Cargo.lock'),
        );
        return [new CratesIoRegistrySource(ctx.cacheService, lockPaths)];
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
