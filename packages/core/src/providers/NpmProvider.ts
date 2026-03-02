import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PackageInfo, DependencyInfo } from '../types';
import type { CacheService } from '../services/CacheService';
import type { DependencyProvider, SourceContext } from './DependencyProvider';
import type { DataSource } from '../sources/types';
import { NpmRegistryService } from '../services/NpmRegistryService';
import { NpmRegistrySource } from '../sources/NpmRegistrySource';
import { NpmSizeSource } from '../sources/NpmSizeSource';

/**
 * Shape of a package-lock.json (lockfileVersion 3, npm v7+).
 * `packages[""]` is the root workspace.
 * `packages["packages/foo"]` are workspace entries.
 * `packages["node_modules/foo"]` are resolved registry packages.
 * Workspace symlinks have `"link": true`.
 */
interface NpmLockfile {
    lockfileVersion: number;
    packages: Record<
        string,
        {
            name?: string;
            version?: string;
            link?: boolean;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            workspaces?: string[];
        }
    >;
}

/**
 * Extract the package name from a node_modules/ key.
 * Handles nested node_modules (takes the portion after the last `node_modules/`).
 *   "node_modules/@scope/name" → "@scope/name"
 *   "node_modules/name" → "name"
 *   "node_modules/foo/node_modules/bar" → "bar"
 */
function extractPackageName(key: string): string {
    const lastIdx = key.lastIndexOf('node_modules/');
    return key.slice(lastIdx + 'node_modules/'.length);
}

export class NpmProvider implements DependencyProvider {
    readonly name = 'npm';
    readonly ecosystem = 'npm';
    readonly supportsCatalog = false;
    readonly installCommand = 'npm install';
    readonly urlPatterns = {
        'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
        Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
    };
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;

    constructor(_cacheService: CacheService, rootDir: string) {
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'package-lock.json');
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) {
            return this.cachedPackages;
        }

        process.stderr.write('Reading package-lock.json...\n');
        const lockfileContent = readFileSync(this.lockfilePath, 'utf-8');
        const lockfile = JSON.parse(lockfileContent) as NpmLockfile;

        // Build a map from package name to resolved version
        const resolvedVersions = new Map<string, string>();
        for (const [key, entry] of Object.entries(lockfile.packages)) {
            if (!key.includes('node_modules/')) continue;
            if (entry.link) continue;
            if (!entry.version) continue;
            const pkgName = extractPackageName(key);
            resolvedVersions.set(pkgName, entry.version);
        }

        const packages: PackageInfo[] = [];

        for (const [wsPath, ws] of Object.entries(lockfile.packages)) {
            // Skip node_modules entries — we only want root and workspace packages
            if (wsPath.includes('node_modules/')) continue;

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
            if (specifier === '*' || specifier.startsWith('workspace:')) continue;

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

    isInCatalog(_name: string, _version: string): boolean {
        return false;
    }

    hasInCatalog(_name: string): boolean {
        return false;
    }

    isPatched(_name: string, _version: string): boolean {
        return false;
    }

    createSources(ctx: SourceContext): DataSource[] {
        const registryService = new NpmRegistryService(ctx.cacheService, this.lockfilePath);
        return [new NpmRegistrySource(registryService), new NpmSizeSource(registryService)];
    }
}
