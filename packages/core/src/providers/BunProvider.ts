import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { satisfies, validRange } from 'semver';
import type { PackageInfo, DependencyInfo } from '../types';
import type { CacheService } from '../services/CacheService';
import type { DependencyProvider, SourceContext } from './DependencyProvider';
import type { DataSource } from '../sources/types';
import { NpmRegistryService } from '../services/NpmRegistryService';
import { NpmRegistrySource } from '../sources/NpmRegistrySource';
import { NpmSizeSource } from '../sources/NpmSizeSource';

/**
 * Shape of the bun.lock JSONC file (bun >= 1.2).
 * The packages map values are tuples: [resolvedId, registryUrl, metadata, integrity?]
 */
interface BunLockfile {
    workspaces: Record<
        string,
        {
            name?: string;
            version?: string;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
        }
    >;
    packages: Record<string, [string, ...unknown[]]>;
}

/**
 * Strip trailing commas from JSONC so it can be parsed with JSON.parse().
 * Handles commas before } and ] (the only non-standard syntax bun.lock uses).
 */
function stripTrailingCommas(text: string): string {
    return text.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Extract the version from a bun.lock resolved package id like "react@18.2.0"
 * or "@octokit/rest@22.0.1". Returns undefined for workspace entries.
 */
function extractVersion(resolvedId: string): string | undefined {
    if (resolvedId.includes('@workspace:')) {
        return undefined;
    }
    // Handle scoped packages: @scope/name@version
    const atIdx = resolvedId.lastIndexOf('@');
    if (atIdx <= 0) {
        return undefined;
    }
    return resolvedId.slice(atIdx + 1);
}

export class BunProvider implements DependencyProvider {
    readonly name = 'bun';
    readonly ecosystem = 'npm';
    readonly supportsCatalog = true;
    readonly installCommand = 'bun install';
    readonly urlPatterns = {
        'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
        Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
    };
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private catalogVersions: Map<string, string>;

    constructor(_cacheService: CacheService, rootDir: string) {
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'bun.lock');

        // Bun reads catalog from root package.json
        try {
            const packageJson = JSON.parse(
                readFileSync(join(rootDir, 'package.json'), 'utf-8'),
            ) as { catalog?: Record<string, string> };
            this.catalogVersions = new Map<string, string>();
            if (packageJson.catalog) {
                for (const [pkg, version] of Object.entries(packageJson.catalog)) {
                    this.catalogVersions.set(pkg, version);
                }
            }
        } catch {
            this.catalogVersions = new Map<string, string>();
        }
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) {
            return this.cachedPackages;
        }

        process.stderr.write('Reading bun.lock...\n');
        const lockfileContent = readFileSync(this.lockfilePath, 'utf-8');
        const lockfile = JSON.parse(stripTrailingCommas(lockfileContent)) as BunLockfile;

        // Build a map from package name to resolved version
        const resolvedVersions = new Map<string, string>();
        for (const [name, tuple] of Object.entries(lockfile.packages)) {
            const version = extractVersion(tuple[0]);
            if (version) {
                resolvedVersions.set(name, version);
            }
        }

        const packages: PackageInfo[] = [];

        for (const [wsPath, ws] of Object.entries(lockfile.workspaces)) {
            const name = ws.name ?? (wsPath === '' ? 'root' : wsPath);
            const version = ws.version ?? '0.0.0';
            const fullPath = wsPath === '' ? this.rootDir : resolve(this.rootDir, wsPath);

            const deps = this.resolveDeps(ws.dependencies, resolvedVersions);
            const devDeps = this.resolveDeps(ws.devDependencies, resolvedVersions);

            packages.push({
                name,
                version,
                path: fullPath,
                dependencies: Object.keys(deps).length > 0 ? deps : undefined,
                devDependencies: Object.keys(devDeps).length > 0 ? devDeps : undefined,
            });
        }

        this.cachedPackages = packages;
        process.stderr.write(`Found ${packages.length} packages\n`);
        return packages;
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

    isInCatalog(name: string, version: string): boolean {
        const catalogRange = this.catalogVersions.get(name);
        if (!catalogRange) {
            return false;
        }
        if (!validRange(catalogRange)) {
            return version === catalogRange;
        }
        try {
            return satisfies(version, catalogRange);
        } catch {
            return version === catalogRange;
        }
    }

    hasInCatalog(name: string): boolean {
        return this.catalogVersions.has(name);
    }

    isPatched(name: string, _version: string): boolean {
        // Bun doesn't have a standard patch mechanism like pnpm
        void _version;
        void name;
        return false;
    }

    createSources(ctx: SourceContext): DataSource[] {
        const registryService = new NpmRegistryService(ctx.cacheService, this.lockfilePath);
        return [new NpmRegistrySource(registryService), new NpmSizeSource(registryService)];
    }
}
