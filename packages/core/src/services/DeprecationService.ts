import { execFile, execSync } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CacheService } from './CacheService';
import { BUFFER_SIZES, WORKER_COUNT } from '../constants';

const execFileAsync = promisify(execFile);
import { processInParallel } from '../utils/workerQueue';
import { sanitizeCacheKey } from '../utils/formatters';

export class DeprecationService {
    private deprecatedPackages: Set<string> | undefined = undefined;
    private deprecationMap: Map<string, string[]> | undefined = undefined; // package@version -> direct deps
    private readonly lockfilePath: string;
    private readonly repoRoot: string;

    constructor(
        private cacheService: CacheService,
        repoRoot: string,
    ) {
        this.lockfilePath = join(repoRoot, 'pnpm-lock.yaml');
        this.repoRoot = repoRoot;
    }

    /**
     * Get the set of deprecated packages (format: "package-name@version").
     */
    async getDeprecatedPackages(): Promise<Set<string>> {
        if (this.deprecatedPackages) {
            return this.deprecatedPackages;
        }

        const cacheKey = 'pnpm-install-resolution';
        let output: string;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            process.stderr.write('Using cached pnpm install --resolution-only output\n');
            output = await this.cacheService.readCache(cacheKey);
        } else {
            process.stderr.write('Running: pnpm install --resolution-only --no-frozen-lockfile\n');

            // Backup lockfile before modifying
            const lockfileBackup = `${this.lockfilePath}.bak`;
            if (existsSync(this.lockfilePath)) {
                copyFileSync(this.lockfilePath, lockfileBackup);
            }

            try {
                output = execSync('pnpm install --resolution-only --no-frozen-lockfile', {
                    encoding: 'utf-8',
                    maxBuffer: BUFFER_SIZES.SMALL,
                    cwd: join(this.lockfilePath, '..'), // Run in repo root
                    stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr
                });
                await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
            } catch (error) {
                const err = error as Error & { stderr?: Buffer };
                process.stderr.write(
                    `Error running pnpm install --resolution-only --no-frozen-lockfile:\n${
                        err.stderr?.toString() || err.message
                    }\n`,
                );
                throw error;
            } finally {
                // Restore lockfile from backup
                if (existsSync(lockfileBackup)) {
                    copyFileSync(lockfileBackup, this.lockfilePath);
                    unlinkSync(lockfileBackup);
                }
            }
        }

        this.deprecatedPackages = this.parseDeprecatedPackages(output);
        return this.deprecatedPackages;
    }

    /**
     * Parse pnpm install output to extract deprecated packages.
     */
    private parseDeprecatedPackages(output: string): Set<string> {
        const deprecated = new Set<string>();
        const lines = output.split('\n');

        for (const line of lines) {
            // Direct deprecated dependencies: "services/api                             |  WARN  deprecated elevenlabs@1.59.0"
            const directMatch = line.match(/\|\s+WARN\s+deprecated\s+([^@\s]+@[\d.]+[^\s]*)/);
            if (directMatch && directMatch[1]) {
                deprecated.add(directMatch[1]);
            }

            // Transitive deprecated dependencies: " WARN  56 deprecated subdependencies found: pkg@version, ..."
            const transitiveMatch = line.match(
                /WARN\s+\d+\s+deprecated subdependencies found:\s+(.+)/,
            );
            if (transitiveMatch && transitiveMatch[1]) {
                const packages = transitiveMatch[1].split(',').map((p) => p.trim());
                for (const pkg of packages) {
                    if (pkg) {
                        deprecated.add(pkg);
                    }
                }
            }
        }

        return deprecated;
    }

    /**
     * Warm internal caches so downstream callers don't pay setup cost.
     */
    async warmCaches(): Promise<void> {
        await this.getDeprecatedPackages();
        await this.getDeprecationMap();
    }

    /**
     * Check if a dependency@version is deprecated.
     */
    async isDeprecated(packageName: string, version: string): Promise<boolean> {
        const deprecatedPackages = await this.getDeprecatedPackages();
        const key = `${packageName}@${version}`;
        return deprecatedPackages.has(key);
    }

    /**
     * Get the deprecation map (deprecated pkg@version -> array of direct dependencies that pull it in).
     * This runs pnpm -r why for each deprecated package to trace the dependency chain.
     */
    async getDeprecationMap(): Promise<Map<string, string[]>> {
        if (this.deprecationMap) {
            return this.deprecationMap;
        }

        const deprecatedPackages = await this.getDeprecatedPackages();
        const resultMap = new Map<string, string[]>();

        process.stderr.write(`Tracing ${deprecatedPackages.size} deprecated packages...\n`);

        const packages = Array.from(deprecatedPackages);
        let completed = 0;

        await processInParallel(
            packages,
            async (pkgWithVersion) => {
                // Extract package name and version
                const atIndex = pkgWithVersion.lastIndexOf('@');
                if (atIndex <= 0) {
                    return; // Skip malformed entries
                }

                const packageName = pkgWithVersion.substring(0, atIndex);
                const version = pkgWithVersion.substring(atIndex + 1);

                const directDeps = await this.runPnpmWhy(
                    packageName,
                    version,
                    pkgWithVersion,
                    ++completed,
                    packages.length,
                );

                if (directDeps.length > 0) {
                    resultMap.set(pkgWithVersion, directDeps);
                }
            },
            { workerCount: WORKER_COUNT },
        );

        this.deprecationMap = resultMap;
        return this.deprecationMap;
    }

    /**
     * Run pnpm -r why for a dependency and extract direct dependencies.
     * Returns an array of dependency names that directly depend on this dependency.
     * @param packageName - Package name (without version)
     * @param version - Package version (for cache key uniqueness)
     * @param pkgWithVersion - Full package@version string for progress reporting
     * @param completed - Count of completed packages
     * @param total - Total number of packages
     */
    private async runPnpmWhy(
        packageName: string,
        version: string,
        pkgWithVersion: string,
        completed: number,
        total: number,
    ): Promise<string[]> {
        const cacheKey = `pnpm-why-${sanitizeCacheKey(packageName)}-${sanitizeCacheKey(version)}`;

        let output: string;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            process.stderr.write(`  [${completed}/${total}] ${pkgWithVersion} (cached)\n`);
            output = await this.cacheService.readCache(cacheKey);
        } else {
            process.stderr.write(`  [${completed}/${total}] ${pkgWithVersion} (fetching...)\n`);

            try {
                const result = await execFileAsync(
                    'pnpm',
                    ['-r', 'why', pkgWithVersion, '--json'],
                    { encoding: 'utf-8', maxBuffer: BUFFER_SIZES.LARGE, cwd: this.repoRoot },
                );
                output = result.stdout;
                await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
            } catch {
                // Package might not be found or other errors
                return [];
            }
        }

        return this.parsePnpmWhyOutput(output);
    }

    /**
     * Parse pnpm -r why JSON output to extract direct dependencies.
     * The output shows which packages have the queried package in their dependency tree.
     * We extract the top-level dependencies from each package that reference the queried package.
     */
    private parsePnpmWhyOutput(output: string): string[] {
        try {
            const packages = JSON.parse(output);
            const directDeps = new Set<string>();

            for (const pkg of packages) {
                // Look at direct dependencies and devDependencies
                const allDeps = {
                    ...pkg.dependencies,
                    ...pkg.devDependencies,
                };

                // Extract all top-level dependency names
                for (const depName of Object.keys(allDeps)) {
                    directDeps.add(depName);
                }
            }

            return Array.from(directDeps);
        } catch {
            // Invalid JSON or empty output
            return [];
        }
    }

    /**
     * Get deprecated transitive dependencies that a direct dependency brings in.
     * Excludes deprecated packages that are themselves direct dependencies.
     * @param directDepName - Name of the direct dependency
     * @param allDirectDeps - Set of all direct dependency names in the monorepo
     */
    async getDeprecatedTransitiveDeps(
        directDepName: string,
        allDirectDeps: Set<string>,
    ): Promise<string[]> {
        const map = await this.getDeprecationMap();
        const deprecated: string[] = [];

        // Look through all deprecated packages to see which ones list this direct dep
        for (const [deprecatedPkg, pulledInBy] of map.entries()) {
            if (pulledInBy.includes(directDepName)) {
                // Extract package name (without version) to check if it's a direct dep
                const atIndex = deprecatedPkg.lastIndexOf('@');
                if (atIndex > 0) {
                    const pkgName = deprecatedPkg.substring(0, atIndex);
                    // Only include if it's NOT a direct dependency somewhere
                    if (!allDirectDeps.has(pkgName)) {
                        deprecated.push(deprecatedPkg);
                    }
                }
            }
        }

        return deprecated;
    }
}
