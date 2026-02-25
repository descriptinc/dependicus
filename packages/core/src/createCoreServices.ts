import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DirectDependency } from './types';
import { parseDependicusOutput } from './schema';
import { CacheService } from './services/CacheService';
import { PnpmService } from './services/PnpmService';
import { WorkspaceService } from './services/WorkspaceService';
import { DeprecationService } from './services/DeprecationService';
import { RegistryService } from './services/RegistryService';
import { GitHubService } from './services/GitHubService';
import { DependencyCollector } from './services/DependencyCollector';
import type { DataSource } from './sources/types';
import { FactStore } from './sources/FactStore';
import { runSources } from './sources/runSources';
import { NpmRegistrySource } from './sources/NpmRegistrySource';
import { NpmSizeSource } from './sources/NpmSizeSource';
import { GitHubSource } from './sources/GitHubSource';
import { DeprecationSource } from './sources/DeprecationSource';
import { WorkspaceSource } from './sources/WorkspaceSource';

export interface CoreServicesConfig {
    repoRoot: string;
    cacheDir: string;
    sources?: DataSource[];
}

export interface CoreServices {
    collect(): Promise<{ dependencies: DirectDependency[]; store: FactStore }>;
}

export function createCoreServices(config: CoreServicesConfig): CoreServices {
    const { repoRoot, cacheDir } = config;
    const lockfilePath = join(repoRoot, 'pnpm-lock.yaml');
    const workspacePath = join(repoRoot, 'pnpm-workspace.yaml');

    const cacheService = new CacheService(cacheDir);
    const pnpmService = new PnpmService(cacheService, repoRoot);
    const workspaceService = new WorkspaceService(
        existsSync(workspacePath) ? workspacePath : undefined,
    );
    const deprecationService = new DeprecationService(cacheService, repoRoot);
    const registryService = new RegistryService(cacheService, repoRoot, lockfilePath);
    const githubService = new GitHubService(cacheService, lockfilePath);

    const builtinSources: DataSource[] = [
        new NpmRegistrySource(registryService),
        new NpmSizeSource(registryService),
        new GitHubSource(githubService),
        new DeprecationSource(deprecationService),
        new WorkspaceSource(workspaceService),
    ];
    const allSources = [...builtinSources, ...(config.sources ?? [])];

    const collector = new DependencyCollector(pnpmService, workspaceService, registryService);

    return {
        async collect(): Promise<{ dependencies: DirectDependency[]; store: FactStore }> {
            const dependencies = await collector.collectDirectDependencies();
            const store = new FactStore();
            await runSources(allSources, dependencies, store);
            return { dependencies, store };
        },
    };
}

export async function readDependicusJson(
    path: string,
): Promise<{ dependencies: DirectDependency[]; store: FactStore }> {
    const content = await readFile(path, 'utf-8');
    const parsed = parseDependicusOutput(JSON.parse(content));
    return {
        dependencies: parsed.dependencies,
        store: FactStore.fromJSON(parsed.facts),
    };
}
