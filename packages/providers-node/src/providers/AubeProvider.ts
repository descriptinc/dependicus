import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { satisfies, validRange } from 'semver';
import type {
    PackageInfo,
    DependencyProvider,
    SourceContext,
    DataSource,
    CacheService,
} from '@dependicus/core';
import { BUFFER_SIZES } from '@dependicus/core';
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

        const cacheKey = 'aube-list';
        let output: string;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            process.stderr.write('Using cached aube list output (lockfile unchanged)\n');
            output = await this.cacheService.readCache(cacheKey);
        } else {
            process.stderr.write('Running: aube -r list --json --depth=0\n');
            output = execSync('aube -r list --json --depth=0', {
                encoding: 'utf-8',
                maxBuffer: BUFFER_SIZES.SMALL,
                cwd: this.rootDir,
            });
            await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
        }

        this.cachedPackages = JSON.parse(output) as PackageInfo[];
        process.stderr.write(`Found ${this.cachedPackages.length} packages\n`);
        return this.cachedPackages;
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
