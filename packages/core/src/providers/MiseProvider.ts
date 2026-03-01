import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import type { PackageInfo, DependencyInfo } from '../types';
import type { CacheService } from '../services/CacheService';
import type { DependencyProvider } from './DependencyProvider';
import type { DataSource } from '../sources/types';
import { MiseVersionsSource } from '../sources/MiseVersionsSource';

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
    readonly rootDir: string;
    readonly lockfilePath: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;

    constructor(_cacheService: CacheService, rootDir: string) {
        this.rootDir = rootDir;
        this.lockfilePath = join(rootDir, 'mise.toml');
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) {
            return this.cachedPackages;
        }

        process.stderr.write('Reading mise tool versions...\n');

        // Get installed tools scoped to this project
        const output = execSync('mise ls --json', {
            encoding: 'utf-8',
            cwd: this.rootDir,
            maxBuffer: 10 * 1024 * 1024,
        });

        const tools: Record<string, MiseToolEntry[]> = JSON.parse(output);

        // Group tools by their config file path (e.g. mise.toml, backend/.mise.toml)
        const byConfigFile = new Map<string, Record<string, DependencyInfo>>();
        let toolCount = 0;
        for (const [toolName, entries] of Object.entries(tools)) {
            for (const entry of entries) {
                if (!entry.source?.path) continue;
                if (!entry.source.path.startsWith(this.rootDir)) continue;

                const relPath = relative(this.rootDir, entry.source.path);
                let deps = byConfigFile.get(relPath);
                if (!deps) {
                    deps = {};
                    byConfigFile.set(relPath, deps);
                }
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

        let outdatedRecord: Record<string, MiseOutdatedEntry> = {};
        try {
            const output = execSync('mise outdated --json --bump', {
                encoding: 'utf-8',
                cwd: this.rootDir,
                maxBuffer: 10 * 1024 * 1024,
            });
            outdatedRecord = JSON.parse(output) as Record<string, MiseOutdatedEntry>;
        } catch {
            // mise outdated may fail or return empty — treat all as up-to-date
        }

        const outdatedMap = new Map<string, string>();
        for (const [toolName, entry] of Object.entries(outdatedRecord)) {
            outdatedMap.set(toolName, entry.bump ?? entry.latest);
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
        return [new MiseVersionsSource(ctx.cacheService, this.lockfilePath)];
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
