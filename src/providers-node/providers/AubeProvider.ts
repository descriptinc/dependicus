import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { satisfies, validRange } from 'semver';
import type {
    PackageInfo,
    DependencyInfo,
    DependencyProvider,
    SourceContext,
    DataSource,
    CacheService,
} from '../../core/index';
import { BUFFER_SIZES } from '../../core/index';
import { NpmRegistryService } from '../services/NpmRegistryService';
import { NpmRegistrySource } from '../sources/NpmRegistrySource';
import { NpmSizeSource } from '../sources/NpmSizeSource';
import { DeprecationSource } from '../sources/DeprecationSource';
import { DeprecationService } from '../services/DeprecationService';
import { resolveNpmMetadata } from '../resolveNpmMetadata';

interface PnpmWorkspace {
    patchedDependencies?: Record<string, string>;
    catalog?: Record<string, string>;
}

export class AubeProvider implements DependencyProvider {
    readonly name = 'aube';
    readonly ecosystem = 'npm';
    readonly supportsCatalog = true;
    readonly installCommand = 'aube install';
    readonly urlPatterns = {
        'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
        Registry: 'https://www.npmjs.com/package/{{name}}/v/{{version}}',
        npmx: 'https://npmx.dev/package/{{name}}',
    };
    readonly catalogFile = 'pnpm-workspace.yaml';
    readonly patchHint =
        'This dependency has a patch applied in `pnpm-workspace.yaml`. When upgrading, check if the patch is still needed or should be removed.';
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private patchedDeps: Set<string>;
    private catalogVersions: Map<string, string>;
    private cacheService: CacheService;

    constructor(cacheService: CacheService, rootDir: string) {
        this.cacheService = cacheService;
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'aube-lock.yaml');

        const workspacePath = join(rootDir, 'pnpm-workspace.yaml');
        try {
            const content = readFileSync(workspacePath, 'utf-8');
            const workspace = load(content) as PnpmWorkspace;
            this.patchedDeps = workspace.patchedDependencies
                ? new Set(Object.keys(workspace.patchedDependencies))
                : new Set<string>();
            this.catalogVersions = new Map<string, string>();
            if (workspace.catalog) {
                for (const [pkg, version] of Object.entries(workspace.catalog)) {
                    this.catalogVersions.set(pkg, version);
                }
            }
        } catch {
            this.patchedDeps = new Set<string>();
            this.catalogVersions = new Map<string, string>();
        }
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) {
            return this.cachedPackages;
        }

        // `aube -r list` covers workspace packages but omits the root importer,
        // and its JSON does not mark workspace-to-workspace links as such —
        // the linked package's actual version is inlined, making them
        // indistinguishable from registry deps. We therefore:
        //   1. Run both `aube list` (root only) and `aube -r list` (workspaces)
        //      and concatenate them so root devDeps aren't lost.
        //   2. Build the set of workspace package names from the combined
        //      output, and drop any dep whose name is in that set (those are
        //      the workspace links aube inlined).
        const rootOutput = await this.runAubeList([]);
        const workspaceOutput = await this.runAubeList(['-r']);

        const rootPackages = JSON.parse(rootOutput) as PackageInfo[];
        const workspacePackages = JSON.parse(workspaceOutput) as PackageInfo[];

        // The root importer shows up in `aube list` as a single entry. Dedupe
        // by path in case a future aube version includes the root in -r output.
        const byPath = new Map<string, PackageInfo>();
        for (const pkg of [...rootPackages, ...workspacePackages]) {
            byPath.set(pkg.path, pkg);
        }
        const combined = Array.from(byPath.values());

        const workspaceNames = new Set(combined.map((p) => p.name));
        this.cachedPackages = combined.map((pkg) => ({
            ...pkg,
            dependencies: stripWorkspaceDeps(pkg.dependencies, workspaceNames),
            devDependencies: stripWorkspaceDeps(pkg.devDependencies, workspaceNames),
        }));

        process.stderr.write(`Found ${this.cachedPackages.length} packages\n`);
        return this.cachedPackages;
    }

    private installStateEnsured = false;

    /**
     * Symmetric to PnpmProvider: `aube list` reads from the aube store
     * under node_modules/.aube/. If another PM populated node_modules
     * (or PnpmProvider reinstalled on top of an aube tree earlier in
     * this run), the install state can drift from aube-lock.yaml. When
     * DEPENDICUS_ALLOW_INSTALL=1 is set, reinstall with aube so the
     * list command always reads from fresh, aube-owned state. Without
     * the env var, warn and proceed. Only invoked on cache miss so
     * fully-cached runs never touch the working tree.
     */
    private ensureInstallState(): void {
        if (this.installStateEnsured) return;
        this.installStateEnsured = true;

        if (existsSync(join(this.rootDir, 'node_modules', '.aube'))) {
            return;
        }
        if (process.env.DEPENDICUS_ALLOW_INSTALL === '1') {
            process.stderr.write(
                'node_modules/.aube not found; running `aube install --frozen-lockfile` (DEPENDICUS_ALLOW_INSTALL=1)\n',
            );
            execSync('aube install --frozen-lockfile', {
                stdio: 'inherit',
                cwd: this.rootDir,
            });
        } else {
            process.stderr.write(
                'Warning: node_modules/.aube not found. `aube list` may report stale data. ' +
                    'Run `aube install` first, or set DEPENDICUS_ALLOW_INSTALL=1 to let dependicus reinstall automatically.\n',
            );
        }
    }

    private async runAubeList(extraFlags: readonly string[]): Promise<string> {
        const cmd = `aube ${extraFlags.join(' ')} list --json --depth=0`
            .replace(/\s+/g, ' ')
            .trim();
        const cacheKey = `aube-list${extraFlags.length ? '-' + extraFlags.join('') : ''}`;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            process.stderr.write(
                `Using cached aube list output (lockfile unchanged): ${cacheKey}\n`,
            );
            return this.cacheService.readCache(cacheKey);
        }

        this.ensureInstallState();

        process.stderr.write(`Running: ${cmd}\n`);
        const output = execSync(cmd, {
            encoding: 'utf-8',
            maxBuffer: BUFFER_SIZES.SMALL,
            cwd: this.rootDir,
        });
        await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
        return output;
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

    isPatched(name: string, version: string): boolean {
        return this.patchedDeps.has(`${name}@${version}`);
    }

    createSources(ctx: SourceContext): DataSource[] {
        const registryService = new NpmRegistryService(ctx.cacheService, this.lockfilePath);
        const deprecationService = new DeprecationService(ctx.cacheService, this.rootDir);
        return [
            new NpmRegistrySource(registryService),
            new NpmSizeSource(registryService),
            new DeprecationSource(deprecationService),
        ];
    }

    async resolveVersionMetadata(
        packages: Array<{ name: string; versions: string[] }>,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
        const registryService = new NpmRegistryService(this.cacheService, this.lockfilePath);
        return resolveNpmMetadata(registryService, packages);
    }
}

function stripWorkspaceDeps(
    deps: Record<string, DependencyInfo> | undefined,
    workspaceNames: Set<string>,
): Record<string, DependencyInfo> | undefined {
    if (!deps) return undefined;
    const filtered: Record<string, DependencyInfo> = {};
    for (const [name, info] of Object.entries(deps)) {
        if (workspaceNames.has(name)) continue;
        filtered[name] = info;
    }
    return Object.keys(filtered).length > 0 ? filtered : undefined;
}
