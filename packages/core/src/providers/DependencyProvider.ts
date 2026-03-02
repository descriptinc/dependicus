import type { PackageInfo } from '../types';
import type { DataSource } from '../sources/types';
import type { CacheService } from '../services/CacheService';
import type { GitHubService } from '../services/GitHubService';

export interface SourceContext {
    cacheService: CacheService;
    githubService: GitHubService;
    repoRoot: string;
}

export interface DependencyProvider {
    readonly name: string;
    readonly ecosystem: string;
    readonly rootDir: string;
    readonly lockfilePath: string;
    readonly supportsCatalog: boolean;
    readonly installCommand: string;
    readonly urlPatterns: Record<string, string>;
    readonly updatePrefix?: string;
    readonly updateSuffix?: string;
    readonly updateInstructions?: string;
    getPackages(): Promise<PackageInfo[]>;
    isInCatalog(name: string, version: string): boolean;
    hasInCatalog(name: string): boolean;
    isPatched(name: string, version: string): boolean;
    createSources(ctx: SourceContext): DataSource[];
    resolveVersionMetadata?(
        packageNames: string[],
    ): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>>;
}
