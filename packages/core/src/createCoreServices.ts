import { readFile } from 'node:fs/promises';
import type { ProviderOutput } from './types';
import { mergeProviderDependencies } from './types';
import { parseDependicusOutput } from './schema';
import { CacheService } from './services/CacheService';
import { NpmRegistryService } from './services/NpmRegistryService';
import { GitHubService } from './services/GitHubService';
import { DependencyCollector, NpmMetadataResolver } from './services/DependencyCollector';
import type { DependencyProvider } from './providers/DependencyProvider';
import { detectProviders, createProvidersByName } from './providers';
import type { DataSource } from './sources/types';
import { RootFactStore } from './sources/FactStore';
import { runSources } from './sources/runSources';
import { GitHubSource } from './sources/GitHubSource';
import { WorkspaceSource } from './sources/WorkspaceSource';

export interface CoreServicesConfig {
    repoRoot: string;
    cacheDir: string;
    /** Explicit provider instances (takes precedence over providerNames). */
    providers?: DependencyProvider[];
    /** Provider names to use, e.g. ['pnpm'], ['bun'], ['pnpm', 'bun']. Auto-detects if omitted. */
    providerNames?: string[];
    sources?: DataSource[];
}

export interface CoreServices {
    collect(): Promise<{ providers: ProviderOutput[]; store: RootFactStore }>;
}

export function createCoreServices(config: CoreServicesConfig): CoreServices {
    const { repoRoot, cacheDir } = config;
    const cacheService = new CacheService(cacheDir);

    const providers =
        config.providers ??
        (config.providerNames
            ? createProvidersByName(config.providerNames, cacheService, repoRoot)
            : detectProviders(cacheService, repoRoot));
    // Use the first provider's lockfile for cache invalidation of shared services
    const lockfilePath = providers[0]!.lockfilePath;

    const registryService = new NpmRegistryService(cacheService, lockfilePath);
    const githubService = new GitHubService(cacheService, lockfilePath);

    const npmResolver = new NpmMetadataResolver(registryService);
    const collector = new DependencyCollector(providers, npmResolver);

    const sourceCtx = { cacheService, githubService, repoRoot };

    return {
        async collect(): Promise<{ providers: ProviderOutput[]; store: RootFactStore }> {
            const providerOutputs = await collector.collectDirectDependencies();
            const store = new RootFactStore();

            // Per-ecosystem enrichment: each ecosystem's sources run with a scoped store
            const byEcosystem = new Map<string, ProviderOutput[]>();
            for (const po of providerOutputs) {
                const list = byEcosystem.get(po.ecosystem) ?? [];
                list.push(po);
                byEcosystem.set(po.ecosystem, list);
            }

            const seenSourceNames = new Set<string>();
            for (const [ecosystem, outputs] of byEcosystem) {
                const ecosystemDeps = mergeProviderDependencies(outputs);
                const scopedStore = store.scoped(ecosystem);

                // Collect sources from providers, deduplicate by name
                const ecosystemSources: DataSource[] = [];
                for (const po of outputs) {
                    const provider = providers.find((p) => p.name === po.name);
                    if (!provider) continue;
                    for (const src of provider.createSources(sourceCtx)) {
                        const key = `${ecosystem}::${src.name}`;
                        if (!seenSourceNames.has(key)) {
                            seenSourceNames.add(key);
                            ecosystemSources.push(src);
                        }
                    }
                }

                await runSources(ecosystemSources, ecosystemDeps, scopedStore);
            }

            // Universal enrichment: GitHub, Workspace, and user plugin sources
            const mergedDeps = mergeProviderDependencies(providerOutputs);
            const universalSources: DataSource[] = [
                new GitHubSource(githubService),
                new WorkspaceSource(providers),
                ...(config.sources ?? []),
            ];
            await runSources(universalSources, mergedDeps, store);

            return { providers: providerOutputs, store };
        },
    };
}

export async function readDependicusJson(
    path: string,
): Promise<{ providers: ProviderOutput[]; store: RootFactStore }> {
    const content = await readFile(path, 'utf-8');
    const parsed = parseDependicusOutput(JSON.parse(content));
    return {
        providers: parsed.providers,
        store: RootFactStore.fromJSON(parsed.facts),
    };
}
