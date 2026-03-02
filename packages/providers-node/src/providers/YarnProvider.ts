import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import type {
    PackageInfo,
    DependencyInfo,
    DependencyProvider,
    SourceContext,
    DataSource,
    CacheService,
} from '@dependicus/core';
import { NpmRegistryService } from '../services/NpmRegistryService';
import { NpmRegistrySource } from '../sources/NpmRegistrySource';
import { NpmSizeSource } from '../sources/NpmSizeSource';
import { resolveNpmMetadata } from '../resolveNpmMetadata';

/**
 * Shape of a parsed yarn.lock entry (Yarn Berry v3/v4).
 * Only the fields we need are typed here.
 */
interface YarnLockEntry {
    version: string;
    resolution: string;
    dependencies?: Record<string, string>;
}

export class YarnProvider implements DependencyProvider {
    readonly name = 'yarn';
    readonly ecosystem = 'npm';
    readonly supportsCatalog = false;
    readonly installCommand = 'yarn install';
    readonly urlPatterns = {
        'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
        Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
    };
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private patchedPackages: Set<string>;
    private cacheService: CacheService;

    constructor(cacheService: CacheService, rootDir: string) {
        this.cacheService = cacheService;
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'yarn.lock');

        // Pre-scan lockfile for patch: protocol entries to build the patched set
        this.patchedPackages = this.buildPatchedSet();
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) {
            return this.cachedPackages;
        }

        process.stderr.write('Reading yarn.lock...\n');
        const lockfileContent = readFileSync(this.lockfilePath, 'utf-8');
        const lockfile = load(lockfileContent) as Record<string, YarnLockEntry>;

        // Build resolved version map: package name → resolved version
        const resolvedVersions = new Map<string, string>();
        for (const [key, entry] of Object.entries(lockfile)) {
            if (key === '__metadata') continue;
            if (!entry || typeof entry !== 'object' || !entry.version) continue;

            // Skip workspace entries
            if (entry.resolution?.includes('@workspace:')) continue;

            // The key may contain multiple specifiers separated by ", "
            // e.g. "semver@npm:^7.3.5, semver@npm:^7.7.3, semver@npm:^7.7.4"
            // Extract the package name from the first specifier
            const packageName = extractPackageName(key);
            if (packageName) {
                resolvedVersions.set(packageName, entry.version);
            }
        }

        // Discover workspaces from root package.json
        const rootPkg = this.readPackageJson(this.rootDir);
        const workspaceGlobs = this.getWorkspaceGlobs(rootPkg);
        const workspacePaths = this.resolveWorkspacePaths(workspaceGlobs);

        const packages: PackageInfo[] = [];

        // Add root package
        packages.push(this.buildPackageInfo(rootPkg, this.rootDir, resolvedVersions));

        // Add workspace packages
        for (const wsPath of workspacePaths) {
            const fullPath = resolve(this.rootDir, wsPath);
            const pkgJsonPath = join(fullPath, 'package.json');
            if (!existsSync(pkgJsonPath)) continue;

            const wsPkg = this.readPackageJson(fullPath);
            packages.push(this.buildPackageInfo(wsPkg, fullPath, resolvedVersions));
        }

        this.cachedPackages = packages;
        process.stderr.write(`Found ${packages.length} packages\n`);
        return packages;
    }

    isInCatalog(_name: string, _version: string): boolean {
        // Yarn has no catalog feature
        return false;
    }

    hasInCatalog(_name: string): boolean {
        // Yarn has no catalog feature
        return false;
    }

    isPatched(name: string, version: string): boolean {
        return this.patchedPackages.has(`${name}@${version}`);
    }

    private buildPatchedSet(): Set<string> {
        const patched = new Set<string>();
        try {
            const lockfileContent = readFileSync(this.lockfilePath, 'utf-8');
            const lockfile = load(lockfileContent) as Record<string, YarnLockEntry>;

            for (const [key, entry] of Object.entries(lockfile)) {
                if (key === '__metadata') continue;
                if (!entry || typeof entry !== 'object') continue;

                // Detect user-applied patches (not yarn's builtin optional patches)
                // User patches look like: "pkg@patch:pkg@npm%3Aversion#./path/to/patch"
                // Builtin patches look like: "pkg@patch:pkg@npm%3Aversion#optional!builtin<compat/...>"
                if (key.includes('patch:') && !key.includes('#optional!builtin<')) {
                    const packageName = extractPackageName(key);
                    if (packageName && entry.version) {
                        patched.add(`${packageName}@${entry.version}`);
                    }
                }
            }
        } catch {
            // Lockfile may not exist yet
        }
        return patched;
    }

    private readPackageJson(dir: string): Record<string, unknown> {
        const content = readFileSync(join(dir, 'package.json'), 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
    }

    private getWorkspaceGlobs(rootPkg: Record<string, unknown>): string[] {
        const workspaces = rootPkg.workspaces;
        if (Array.isArray(workspaces)) {
            return workspaces as string[];
        }
        if (workspaces && typeof workspaces === 'object' && 'packages' in workspaces) {
            return (workspaces as { packages: string[] }).packages;
        }
        return [];
    }

    private resolveWorkspacePaths(globs: string[]): string[] {
        const paths: string[] = [];
        for (const glob of globs) {
            // Handle simple "packages/*" style globs
            const base = glob.replace(/\/?\*$/, '');
            const fullBase = resolve(this.rootDir, base);
            if (!existsSync(fullBase)) continue;

            const entries = readdirSync(fullBase, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const pkgPath = join(fullBase, entry.name, 'package.json');
                    if (existsSync(pkgPath)) {
                        paths.push(join(base, entry.name));
                    }
                }
            }
        }
        return paths;
    }

    private buildPackageInfo(
        pkg: Record<string, unknown>,
        fullPath: string,
        resolvedVersions: Map<string, string>,
    ): PackageInfo {
        const name = (pkg.name as string) ?? 'root';
        const version = (pkg.version as string) ?? '0.0.0';

        const deps = this.resolveDeps(
            pkg.dependencies as Record<string, string> | undefined,
            resolvedVersions,
        );
        const devDeps = this.resolveDeps(
            pkg.devDependencies as Record<string, string> | undefined,
            resolvedVersions,
        );

        return {
            name,
            version,
            path: fullPath,
            dependencies: Object.keys(deps).length > 0 ? deps : undefined,
            devDependencies: Object.keys(devDeps).length > 0 ? devDeps : undefined,
        };
    }

    private resolveDeps(
        specifiers: Record<string, string> | undefined,
        resolvedVersions: Map<string, string>,
    ): Record<string, DependencyInfo> {
        const result: Record<string, DependencyInfo> = {};
        if (!specifiers) return result;

        for (const [name, specifier] of Object.entries(specifiers)) {
            // Skip workspace references
            if (specifier.startsWith('workspace:')) continue;

            const version = resolvedVersions.get(name);
            if (!version) continue;

            result[name] = {
                from: name,
                version,
                resolved: '',
                path: '',
            };
        }
        return result;
    }

    createSources(ctx: SourceContext): DataSource[] {
        const registryService = new NpmRegistryService(ctx.cacheService, this.lockfilePath);
        return [new NpmRegistrySource(registryService), new NpmSizeSource(registryService)];
    }

    async resolveVersionMetadata(
        packages: Array<{ name: string; versions: string[] }>,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
        const registryService = new NpmRegistryService(this.cacheService, this.lockfilePath);
        return resolveNpmMetadata(registryService, packages);
    }
}

/**
 * Extract the package name from a yarn.lock entry key.
 * Keys look like:
 *   "semver@npm:^7.7.4"
 *   "@octokit/rest@npm:^22.0.1"
 *   "semver@npm:^7.3.5, semver@npm:^7.7.3"
 *   "typescript@patch:typescript@npm%3A^5.9.3#optional!builtin<compat/typescript>"
 *
 * Returns the bare package name (e.g. "semver", "@octokit/rest").
 */
function extractPackageName(key: string): string | undefined {
    // Take the first specifier if multiple are comma-separated
    const firstSpec = key.split(',')[0]!.trim();

    // Remove surrounding quotes if present
    const spec = firstSpec.replace(/^"|"$/g, '');

    // Find the @npm: or @patch: or @workspace: delimiter
    // For scoped packages like @scope/name@npm:..., we need the last @ before the protocol
    const protocolIdx = spec.search(/@(?:npm|patch|workspace):/);
    if (protocolIdx <= 0) return undefined;

    return spec.slice(0, protocolIdx);
}
