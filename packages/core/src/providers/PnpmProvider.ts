import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { satisfies, validRange } from 'semver';
import type { PackageInfo } from '../types';
import type { CacheService } from '../services/CacheService';
import type { DependencyProvider, SourceContext } from './DependencyProvider';
import type { DataSource } from '../sources/types';
import { NpmRegistryService } from '../services/NpmRegistryService';
import { NpmRegistrySource } from '../sources/NpmRegistrySource';
import { NpmSizeSource } from '../sources/NpmSizeSource';
import { DeprecationSource } from '../sources/DeprecationSource';
import { DeprecationService } from '../services/DeprecationService';
import { BUFFER_SIZES } from '../constants';

interface PnpmWorkspace {
    patchedDependencies?: Record<string, string>;
    catalog?: Record<string, string>;
}

export class PnpmProvider implements DependencyProvider {
    readonly name = 'pnpm';
    readonly ecosystem = 'npm';
    readonly supportsCatalog = true;
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private patchedDeps: Set<string>;
    private catalogVersions: Map<string, string>;

    constructor(
        private cacheService: CacheService,
        rootDir: string,
    ) {
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'pnpm-lock.yaml');

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

        const cacheKey = 'pnpm-list';
        let output: string;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            process.stderr.write('Using cached pnpm list output (lockfile unchanged)\n');
            output = await this.cacheService.readCache(cacheKey);
        } else {
            process.stderr.write('Running: pnpm -r list --json --depth=0\n');
            output = execSync('pnpm -r list --json --depth=0', {
                encoding: 'utf-8',
                maxBuffer: BUFFER_SIZES.SMALL,
            });
            await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
        }

        this.cachedPackages = JSON.parse(output) as PackageInfo[];
        process.stderr.write(`Found ${this.cachedPackages.length} packages\n`);
        return this.cachedPackages;
    }

    isInCatalog(packageName: string, version: string): boolean {
        const catalogRange = this.catalogVersions.get(packageName);
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

    hasPackageInCatalog(packageName: string): boolean {
        return this.catalogVersions.has(packageName);
    }

    isPatched(packageName: string, version: string): boolean {
        return this.patchedDeps.has(`${packageName}@${version}`);
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
}
