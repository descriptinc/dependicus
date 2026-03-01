import { execSync } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';
import type { PackageInfo, DependencyInfo } from '../types';
import type { CacheService } from '../services/CacheService';
import type { DependencyProvider } from './DependencyProvider';
import type { DataSource } from '../sources/types';
import { MiseVersionsSource } from '../sources/MiseVersionsSource';

/** Test whether a repo-relative path is a mise config file. */
export function isMiseConfigFile(relPath: string): boolean {
    const base = basename(relPath);
    const dir = dirname(relPath);
    const parentBase = basename(dir);
    const grandparentBase = basename(dirname(dir));

    // Direct config files: mise.toml, .mise.toml, mise.local.toml, .mise.local.toml, .tool-versions
    if (
        base === 'mise.toml' ||
        base === '.mise.toml' ||
        base === 'mise.local.toml' ||
        base === '.mise.local.toml' ||
        base === '.tool-versions'
    ) {
        // Exclude .config/mise/conf.d/*.toml — handled below
        if (parentBase === 'conf.d')
            return grandparentBase === 'mise' || grandparentBase === '.mise';
        return true;
    }

    // mise/config.toml or .mise/config.toml
    if (base === 'config.toml' && (parentBase === 'mise' || parentBase === '.mise')) {
        return true;
    }

    // .config/mise/conf.d/*.toml
    if (base.endsWith('.toml') && parentBase === 'conf.d' && grandparentBase === 'mise') {
        const ggBase = basename(dirname(dirname(dir)));
        return ggBase === '.config';
    }

    return false;
}

// Shape of a single tool from `mise ls --json`
interface MiseToolEntry {
    version: string;
    requested_version?: string;
    install_path: string;
    source?: {
        type: string;
        path: string;
    };
}

// Shape of a single entry from `mise outdated --json --bump`
interface MiseOutdatedEntry {
    name: string;
    current: string;
    requested: string;
    latest: string;
    bump?: string;
    source?: {
        type: string;
        path: string;
    };
}

export class MiseProvider implements DependencyProvider {
    readonly name = 'mise';
    readonly ecosystem = 'mise';
    readonly supportsCatalog = false;
    readonly installCommand = 'mise install';
    readonly urlPatterns = {
        Registry: 'https://mise-versions.jdx.dev/tools/{{name}}',
    };
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private cachedConfigDirs: string[] | undefined = undefined;

    constructor(_cacheService: CacheService, rootDir: string) {
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'mise.toml');
    }

    /**
     * Find all directories under rootDir that contain mise config files.
     * Uses git ls-files to avoid traversing node_modules and build artifacts.
     */
    discoverConfigDirs(): string[] {
        if (this.cachedConfigDirs) return this.cachedConfigDirs;

        try {
            const output = execSync('git ls-files', {
                encoding: 'utf-8',
                cwd: this.rootDir,
                maxBuffer: 10 * 1024 * 1024,
            });
            const files = output.trim().split('\n').filter(Boolean);
            const configFiles = files.filter((f) => isMiseConfigFile(f));
            const dirs = new Set(configFiles.map((f) => dirname(f)));
            this.cachedConfigDirs = [...dirs].sort();
        } catch {
            // Not a git repo or git not available — just use rootDir
            this.cachedConfigDirs = ['.'];
        }

        return this.cachedConfigDirs;
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) {
            return this.cachedPackages;
        }

        process.stderr.write('Reading mise tool versions...\n');

        const configDirs = this.discoverConfigDirs();
        const byConfigFile = new Map<string, Record<string, DependencyInfo>>();
        let toolCount = 0;

        for (const dir of configDirs) {
            const args = dir === '.' ? [] : ['-C', dir];
            let output: string;
            try {
                output = execSync(['mise', 'ls', '--json', ...args].join(' '), {
                    encoding: 'utf-8',
                    cwd: this.rootDir,
                    maxBuffer: 10 * 1024 * 1024,
                });
            } catch {
                continue; // Skip directories where mise ls fails
            }

            const tools: Record<string, MiseToolEntry[]> = JSON.parse(output);

            for (const [toolName, entries] of Object.entries(tools)) {
                for (const entry of entries) {
                    if (!entry.source?.path) continue;
                    if (!entry.source.path.startsWith(this.rootDir)) continue;

                    const relPath = relative(this.rootDir, entry.source.path);
                    const relDir = dirname(relPath);
                    // Only keep tools sourced from a config file in THIS directory,
                    // not inherited from parent configs
                    if (relDir !== dir && !(dir === '.' && relDir === '.')) continue;

                    let deps = byConfigFile.get(relPath);
                    if (!deps) {
                        deps = {};
                        byConfigFile.set(relPath, deps);
                    }
                    // Don't overwrite if we already have this tool from an earlier dir
                    if (deps[toolName]) continue;
                    deps[toolName] = {
                        from: toolName,
                        version: entry.version,
                        resolved: entry.install_path,
                        path: entry.install_path,
                    };
                    toolCount++;
                    break; // Take the first matching entry per tool
                }
            }
        }

        // Create one package per config file
        const packages: PackageInfo[] = [];
        for (const [configPath, dependencies] of byConfigFile) {
            packages.push({
                name: configPath,
                version: '0.0.0',
                path: this.rootDir,
                dependencies,
            });
        }

        this.cachedPackages = packages;
        process.stderr.write(`Found ${toolCount} mise tools\n`);
        return packages;
    }

    /**
     * Resolve latest versions for mise tools using `mise outdated --json --bump`.
     * Tools already at latest (not in outdated output) get latestVersion = currentVersion.
     */
    async resolveVersionMetadata(
        packageNames: string[],
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
        process.stderr.write('Checking mise tool versions...\n');

        const configDirs = this.discoverConfigDirs();
        const outdatedMap = new Map<string, string>();

        for (const dir of configDirs) {
            const args = dir === '.' ? [] : ['-C', dir];
            try {
                const output = execSync(
                    ['mise', 'outdated', '--json', '--bump', ...args].join(' '),
                    {
                        encoding: 'utf-8',
                        cwd: this.rootDir,
                        maxBuffer: 10 * 1024 * 1024,
                    },
                );
                const record = JSON.parse(output) as Record<string, MiseOutdatedEntry>;
                for (const [toolName, entry] of Object.entries(record)) {
                    if (!outdatedMap.has(toolName)) {
                        outdatedMap.set(toolName, entry.bump ?? entry.latest);
                    }
                }
            } catch {
                // mise outdated may fail or return empty — treat as up-to-date
            }
        }

        // Build the packages we were asked about from cached data
        const packages = await this.getPackages();
        const depMap = new Map<string, string>();
        for (const pkg of packages) {
            if (pkg.dependencies) {
                for (const [name, info] of Object.entries(pkg.dependencies)) {
                    depMap.set(name, info.version);
                }
            }
        }

        const result = new Map<
            string,
            { publishDate: string | undefined; latestVersion: string }
        >();
        for (const name of packageNames) {
            const currentVersion = depMap.get(name);
            const latestVersion = outdatedMap.get(name) ?? currentVersion ?? '';
            result.set(`${name}@${currentVersion}`, {
                publishDate: undefined, // mise doesn't track publish dates
                latestVersion,
            });
        }

        return result;
    }

    createSources(ctx: { cacheService: CacheService }): DataSource[] {
        const configDirs = this.discoverConfigDirs();
        const configPaths = configDirs.map((dir) => join(this.rootDir, dir, 'mise.toml'));
        return [new MiseVersionsSource(ctx.cacheService, configPaths)];
    }

    isInCatalog(_packageName: string, _version: string): boolean {
        return false;
    }

    hasPackageInCatalog(_packageName: string): boolean {
        return false;
    }

    isPatched(_packageName: string, _version: string): boolean {
        return false;
    }
}
