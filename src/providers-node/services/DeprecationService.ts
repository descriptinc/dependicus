import { execFile, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
    CacheService,
    BUFFER_SIZES,
    WORKER_COUNT,
    sanitizeCacheKey,
    processInParallel,
} from '../../core/index';

const execFileAsync = promisify(execFile);

/**
 * Arguments to the pnpm install that surfaces deprecation warnings. pnpm 10,
 * 11 and 12 all accept them; pnpm 12 dropped the older `--resolution-only`.
 *
 * `--lockfile-only` resolves the dependency graph without downloading packages
 * or writing `node_modules`. `--no-prefer-frozen-lockfile` and
 * `optimistic-repeat-install=false` together stop pnpm from short-circuiting
 * when the lockfile and `node_modules` are already in sync, which it otherwise
 * does without fetching the registry metadata the warnings come from.
 *
 * `--reporter=ndjson` turns the warnings into structured `pnpm:deprecation`
 * events instead of human-readable text whose format shifts between releases.
 */
const RESOLUTION_ARGS = [
    'install',
    '--lockfile-only',
    '--no-frozen-lockfile',
    '--no-prefer-frozen-lockfile',
    '--config.optimistic-repeat-install=false',
    '--reporter=ndjson',
];

/** A `pnpm:deprecation` event from pnpm's ndjson reporter. */
interface PnpmDeprecationEvent {
    name?: string;
    pkgName?: string;
    pkgVersion?: string;
    pkgId?: string;
}

/**
 * A node in the dependents tree that pnpm 12's `why --json` returns. Entries
 * carrying a `depField` are workspace projects rather than packages.
 */
interface PnpmWhyDependent {
    name?: string;
    depField?: string;
    dependents?: PnpmWhyDependent[];
}

/** A top-level entry in `pnpm why --json` output, in either supported shape. */
interface PnpmWhyEntry extends PnpmWhyDependent {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
}

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

        const cacheKey = 'pnpm-install-deprecations';
        const command = `pnpm ${RESOLUTION_ARGS.join(' ')}`;
        let output: string;

        if (await this.cacheService.isCacheValid(cacheKey, this.lockfilePath)) {
            process.stderr.write('Using cached pnpm deprecation output\n');
            output = await this.cacheService.readCache(cacheKey);
        } else {
            process.stderr.write(`Running: ${command}\n`);

            // Backup lockfile before modifying
            const lockfileBackup = `${this.lockfilePath}.bak`;
            if (existsSync(this.lockfilePath)) {
                copyFileSync(this.lockfilePath, lockfileBackup);
            }

            try {
                const result = spawnSync('pnpm', RESOLUTION_ARGS, {
                    encoding: 'utf-8',
                    // The ndjson reporter emits a line per resolved package, so
                    // this runs to tens of megabytes on a large monorepo.
                    maxBuffer: BUFFER_SIZES.LARGE,
                    cwd: this.repoRoot,
                });

                if (result.error) {
                    throw result.error;
                }

                // pnpm 10 and 11 write the ndjson stream to stdout, pnpm 12
                // writes it to stderr, so read both.
                output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

                if (result.status !== 0) {
                    const failure = (result.stderr || result.stdout || '').trim().slice(-2000);
                    throw new Error(`${command} exited with code ${result.status}:\n${failure}`);
                }
            } catch (error) {
                process.stderr.write(`Error running ${command}:\n${(error as Error).message}\n`);
                throw error;
            } finally {
                // Restore lockfile from backup (rename is atomic on the same filesystem)
                if (existsSync(lockfileBackup)) {
                    renameSync(lockfileBackup, this.lockfilePath);
                }
            }

            // Cache after restoring the lockfile so the stored hash describes
            // the lockfile the next run will see, not the one pnpm just wrote.
            await this.cacheService.writeCache(cacheKey, output, this.lockfilePath);
        }

        this.deprecatedPackages = this.parseDeprecatedPackages(output);
        return this.deprecatedPackages;
    }

    /**
     * Parse pnpm install output to extract deprecated packages.
     */
    private parseDeprecatedPackages(output: string): Set<string> {
        const fromEvents = this.parseDeprecationEvents(output);
        if (fromEvents.size > 0) {
            return fromEvents;
        }
        // The ndjson reporter can be overridden by pnpm config, so fall back to
        // reading the warnings the human-readable reporter prints.
        return this.parseDeprecationWarnings(output);
    }

    /**
     * Extract deprecated packages from `pnpm:deprecation` ndjson reporter events.
     */
    private parseDeprecationEvents(output: string): Set<string> {
        const deprecated = new Set<string>();

        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{') || !trimmed.includes('pnpm:deprecation')) {
                continue;
            }

            let event: PnpmDeprecationEvent;
            try {
                event = JSON.parse(trimmed) as PnpmDeprecationEvent;
            } catch {
                continue;
            }

            if (event.name !== 'pnpm:deprecation') {
                continue;
            }
            if (event.pkgName && event.pkgVersion) {
                deprecated.add(`${event.pkgName}@${event.pkgVersion}`);
            } else if (event.pkgId) {
                deprecated.add(event.pkgId);
            }
        }

        return deprecated;
    }

    /**
     * Extract deprecated packages from pnpm's human-readable install warnings.
     * pnpm 12 brackets the level ("[WARN]") where earlier versions didn't.
     */
    private parseDeprecationWarnings(output: string): Set<string> {
        const deprecated = new Set<string>();
        const lines = output.split('\n');

        for (const line of lines) {
            // Direct deprecated dependencies: "services/api                             |  WARN  deprecated elevenlabs@1.59.0"
            const directMatch = line.match(
                /\|\s+\[?WARN\]?\s+deprecated\s+(@?[^@\s]+@[\d.]+[^\s]*)/,
            );
            if (directMatch && directMatch[1]) {
                deprecated.add(directMatch[1]);
            }

            // Transitive deprecated dependencies: " WARN  56 deprecated subdependencies found: pkg@version, ..."
            const transitiveMatch = line.match(
                /\[?WARN\]?\s+\d+\s+deprecated subdependencies found:\s+(.+)/,
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
     *
     * pnpm 10 and 11 return one entry per workspace project, each holding a
     * dependency tree pruned to the paths that reach the queried package, so
     * the top-level keys are the direct dependencies we want.
     *
     * pnpm 12 returns one entry per matched package with a `dependents` tree
     * pointing back up toward the workspace projects, so the direct dependency
     * is whichever node a workspace project depends on.
     */
    private parsePnpmWhyOutput(output: string): string[] {
        try {
            const entries = JSON.parse(output) as PnpmWhyEntry[];
            if (!Array.isArray(entries)) {
                return [];
            }
            const directDeps = new Set<string>();

            for (const entry of entries) {
                if (Array.isArray(entry?.dependents)) {
                    this.collectDirectDependents(entry, directDeps);
                    continue;
                }

                // Look at direct dependencies and devDependencies
                const allDeps = {
                    ...entry?.dependencies,
                    ...entry?.devDependencies,
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
     * Walk a pnpm 12 dependents tree, collecting the name of every node that a
     * workspace project depends on directly.
     */
    private collectDirectDependents(node: PnpmWhyDependent, directDeps: Set<string>): void {
        for (const dependent of node.dependents ?? []) {
            // A dependent with a `depField` is a workspace project listing this
            // node in its manifest, which makes this node a direct dependency.
            if (dependent.depField && node.name) {
                directDeps.add(node.name);
            }
            if (dependent.dependents?.length) {
                this.collectDirectDependents(dependent, directDeps);
            }
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
