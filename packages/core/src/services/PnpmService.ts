import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { PnpmPackageInfo } from '../types';
import type { CacheService } from './CacheService';
import { BUFFER_SIZES } from '../constants';

export class PnpmService {
    private cachedPackages: PnpmPackageInfo[] | undefined = undefined;
    private readonly lockfilePath: string;

    constructor(
        private cacheService: CacheService,
        repoRoot: string,
    ) {
        this.lockfilePath = join(repoRoot, 'pnpm-lock.yaml');
    }

    /**
     * Get all packages in the monorepo with their direct dependencies.
     * Uses disk cache based on lockfile hash to avoid re-running pnpm.
     */
    async getPackages(): Promise<PnpmPackageInfo[]> {
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

        this.cachedPackages = JSON.parse(output) as PnpmPackageInfo[];
        process.stderr.write(`Found ${this.cachedPackages.length} packages\n`);

        return this.cachedPackages;
    }
}
