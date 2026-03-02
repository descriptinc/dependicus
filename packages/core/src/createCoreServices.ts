import { readFile } from 'node:fs/promises';
import type { ProviderOutput } from './types';
import { mergeProviderDependencies } from './types';
import { parseDependicusOutput } from './schema';
import { CacheService } from './services/CacheService';
import { GitHubService } from './services/GitHubService';
import { DependencyCollector } from './services/DependencyCollector';
import type { DependencyProvider } from './providers/DependencyProvider';
import type { DataSource } from './sources/types';
import { RootFactStore, FactKeys } from './sources/FactStore';
import { runSources } from './sources/runSources';
import { GitHubSource } from './sources/GitHubSource';
import { WorkspaceSource } from './sources/WorkspaceSource';

export interface CoreServicesConfig {
    repoRoot: string;
    cacheDir: string;
    /** Pre-built provider instances. */
    providers: DependencyProvider[];
    sources?: DataSource[];
}

export interface CoreServices {
    collect(): Promise<{ providers: ProviderOutput[]; store: RootFactStore }>;
}

export function createCoreServices(config: CoreServicesConfig): CoreServices {
    const { repoRoot, cacheDir, providers } = config;
    const cacheService = new CacheService(cacheDir);

    // Use the first provider's lockfile for cache invalidation of shared services
    const lockfilePath = providers[0]!.lockfilePath;

    const githubService = new GitHubService(cacheService, lockfilePath);

    const collector = new DependencyCollector(providers);

    const sourceCtx = { cacheService, githubService, repoRoot };

    return {
        async collect(): Promise<{ providers: ProviderOutput[]; store: RootFactStore }> {
            const providerOutputs = await collector.collectDirectDependencies();
            const store = new RootFactStore();

            // Store URL patterns as package-level facts
            for (const po of providerOutputs) {
                if (Object.keys(po.urlPatterns).length > 0) {
                    const scoped = store.scoped(po.ecosystem);
                    for (const dep of po.dependencies) {
                        scoped.setDependencyFact(dep.name, FactKeys.URLS, {
                            ...po.urlPatterns,
                        });
                    }
                }
            }

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
    const store = RootFactStore.fromJSON(parsed.facts);

    // Restore URL patterns as package-level facts
    for (const po of parsed.providers) {
        if (Object.keys(po.urlPatterns).length > 0) {
            const scoped = store.scoped(po.ecosystem);
            for (const dep of po.dependencies) {
                scoped.setDependencyFact(dep.name, FactKeys.URLS, { ...po.urlPatterns });
            }
        }
    }

    return {
        providers: parsed.providers,
        store,
    };
}
