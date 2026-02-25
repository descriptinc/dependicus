import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type {
    PackageInfo,
    DependencyInfo,
    DependencyProvider,
    DataSource,
    CacheService,
} from '@dependicus/core';
import { PyPiRegistrySource } from './PyPiRegistrySource';

// Subset of CycloneDX 1.5 types used by `uv export --format cyclonedx1.5`.
// Full schema: https://cyclonedx.org/schema/bom-1.5.schema.json

interface CycloneDxProperty {
    name: string;
    value: string;
}

interface CycloneDxComponent {
    type: string;
    'bom-ref': string;
    name: string;
    version?: string;
    purl?: string;
    properties?: CycloneDxProperty[];
}

interface CycloneDxDependency {
    ref: string;
    dependsOn: string[];
}

interface CycloneDxBom {
    metadata: {
        component: CycloneDxComponent;
    };
    components: CycloneDxComponent[];
    dependencies: CycloneDxDependency[];
}

function hasProperty(component: CycloneDxComponent, propName: string): boolean {
    return component.properties?.some((p) => p.name === propName && p.value === 'true') ?? false;
}

export class UvProvider implements DependencyProvider {
    readonly name = 'uv';
    readonly ecosystem = 'pypi';
    readonly supportsCatalog = false;
    readonly installCommand = 'uv sync';
    readonly urlPatterns = {
        PyPI: 'https://pypi.org/project/{{name}}/',
    };
    readonly updatePrefix = 'Update the version constraint in:';
    readonly updateSuffix = 'Then run `uv lock && uv sync`.';
    readonly updateInstructions =
        'Update each dependency in the appropriate pyproject.toml, then run `uv lock && uv sync`.';
    readonly rootDir: string;
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private cachedProjectDirs: string[] | undefined = undefined;

    constructor(
        private cacheService: CacheService,
        rootDir: string,
    ) {
        this.rootDir = rootDir;
    }

    get lockfilePath(): string {
        const dirs = this.discoverProjectDirs();
        return join(this.rootDir, dirs[0] ?? '.', 'uv.lock');
    }

    /**
     * Find all directories under rootDir that contain a uv.lock file.
     * Uses git ls-files to avoid traversing node_modules and build artifacts.
     */
    discoverProjectDirs(): string[] {
        if (this.cachedProjectDirs) return this.cachedProjectDirs;

        try {
            const output = execSync('git ls-files', {
                encoding: 'utf-8',
                cwd: this.rootDir,
                maxBuffer: 10 * 1024 * 1024,
            });
            const files = output.trim().split('\n').filter(Boolean);
            const lockfiles = files.filter((f) => f === 'uv.lock' || f.endsWith('/uv.lock'));
            this.cachedProjectDirs = lockfiles.map((f) => dirname(f)).sort();
        } catch {
            this.cachedProjectDirs = ['.'];
        }

        return this.cachedProjectDirs;
    }

    async getPackages(): Promise<PackageInfo[]> {
        if (this.cachedPackages) return this.cachedPackages;

        process.stderr.write('Reading Python dependencies via uv export...\n');

        const projectDirs = this.discoverProjectDirs();
        const allPackages: PackageInfo[] = [];
        let totalDepCount = 0;

        for (const dir of projectDirs) {
            const projectPath = dir === '.' ? this.rootDir : join(this.rootDir, dir);
            const { packages, depCount } = this.exportProject(projectPath);
            allPackages.push(...packages);
            totalDepCount += depCount;
        }

        this.cachedPackages = allPackages;
        process.stderr.write(
            `Found ${totalDepCount} Python dependencies across ${allPackages.length} package(s)\n`,
        );
        return allPackages;
    }

    private exportProject(projectPath: string): { packages: PackageInfo[]; depCount: number } {
        let output: string;
        try {
            output = execSync(
                'uv export --format cyclonedx1.5 --frozen --no-dev --all-packages --preview-features sbom-export',
                {
                    encoding: 'utf-8',
                    cwd: projectPath,
                    maxBuffer: 10 * 1024 * 1024,
                    stdio: ['pipe', 'pipe', 'pipe'],
                },
            );
        } catch {
            process.stderr.write(`Failed to run uv export in ${projectPath}\n`);
            return { packages: [], depCount: 0 };
        }

        const bom: CycloneDxBom = JSON.parse(output);

        // Build bom-ref → {name, version} map from components
        const refMap = new Map<string, { name: string; version: string }>();
        for (const comp of bom.components) {
            if (comp.version) {
                refMap.set(comp['bom-ref'], { name: comp.name, version: comp.version });
            }
        }

        // Identify workspace members: components with is_project_root property
        const members = bom.components.filter((c) => hasProperty(c, 'uv:package:is_project_root'));

        // Build dependency lookup: ref → dependsOn[]
        const depLookup = new Map<string, string[]>();
        for (const dep of bom.dependencies) {
            depLookup.set(dep.ref, dep.dependsOn);
        }

        const packages: PackageInfo[] = [];
        let depCount = 0;

        for (const member of members) {
            const memberRef = member['bom-ref'];
            const directDepRefs = depLookup.get(memberRef) ?? [];
            const dependencies: Record<string, DependencyInfo> = {};

            for (const depRef of directDepRefs) {
                const resolved = refMap.get(depRef);
                if (!resolved) continue;

                dependencies[resolved.name] = {
                    from: resolved.name,
                    version: resolved.version,
                    resolved: resolved.version,
                    path: projectPath,
                };
                depCount++;
            }

            packages.push({
                name: member.name,
                version: member.version ?? '0.0.0',
                path: projectPath,
                dependencies,
            });
        }

        return { packages, depCount };
    }

    async resolveVersionMetadata(
        packages: Array<{ name: string; versions: string[] }>,
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
        process.stderr.write('Checking PyPI for latest versions...\n');

        const result = new Map<
            string,
            { publishDate: string | undefined; latestVersion: string }
        >();

        for (const pkg of packages) {
            for (const version of pkg.versions) {
                const key = `${pkg.name}@${version}`;
                try {
                    const data = await this.fetchPyPiMetadata(pkg.name);
                    if (!data) {
                        result.set(key, { publishDate: undefined, latestVersion: version });
                        continue;
                    }

                    const latestVersion: string = data.info.version;
                    const releases = data.releases as Record<string, PyPiReleaseEntry[]>;
                    const currentRelease = releases[version];
                    const publishDate = currentRelease?.[0]?.upload_time_iso_8601 ?? undefined;

                    result.set(key, { publishDate, latestVersion });
                } catch {
                    result.set(key, { publishDate: undefined, latestVersion: version });
                }
            }
        }

        return result;
    }

    private async fetchPyPiMetadata(name: string): Promise<PyPiPackageData | undefined> {
        const cacheKey = `pypi-meta-${name}`;
        const lockfile = this.lockfilePath;

        if (await this.cacheService.isCacheValid(cacheKey, lockfile)) {
            try {
                const cached = await this.cacheService.readCache(cacheKey);
                return JSON.parse(cached) as PyPiPackageData;
            } catch {
                // Corrupt cache — fall through
            }
        }

        try {
            const url = `https://pypi.org/pypi/${name}/json`;
            const response = await fetch(url);
            if (!response.ok) return undefined;

            const data = (await response.json()) as PyPiPackageData;
            await this.cacheService.writeCache(cacheKey, JSON.stringify(data), lockfile);
            return data;
        } catch {
            return undefined;
        }
    }

    createSources(ctx: { cacheService: CacheService }): DataSource[] {
        const lockfilePaths = this.discoverProjectDirs().map((d) =>
            join(this.rootDir, d, 'uv.lock'),
        );
        return [new PyPiRegistrySource(ctx.cacheService, lockfilePaths)];
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
}

interface PyPiReleaseEntry {
    upload_time_iso_8601: string;
    yanked: boolean;
}

interface PyPiPackageData {
    info: {
        version: string;
        summary: string;
        home_page: string | null;
        project_urls: Record<string, string> | null;
    };
    releases: Record<string, PyPiReleaseEntry[]>;
}
