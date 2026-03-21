import { join, dirname } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
    DirectDependency,
    ProviderOutput,
    SerializedFacts,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    DataSource,
    DependencyProvider,
    FactStore,
    UsedByGroupKeyFn,
    RootFactStore,
} from '@dependicus/core';
import { createCoreServices } from '@dependicus/core';
import { HtmlWriter } from './services/HtmlWriter';
import type { CustomColumn } from './services/HtmlWriter';
import { getCssContent } from './paths';

export interface DependicusConfig {
    repoRoot: string;
    outputDir?: string;
    cacheDir?: string;
    providers: DependencyProvider[];
    sources?: DataSource[];
    groupings?: GroupingConfig[];
    siteName?: string;
    columns?: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
}

export interface CollectResult {
    metadata: { generatedAt: string };
    providers: ProviderOutput[];
    facts: SerializedFacts;
    store: RootFactStore;
}

export interface DependicusInstance {
    collectData(): Promise<CollectResult>;
    refreshLocal(dependencies: DirectDependency[], store: FactStore): void;
    generateSite(providers: ProviderOutput[], store: FactStore): Promise<void>;
}

export async function createDependicus(config: DependicusConfig): Promise<DependicusInstance> {
    const {
        repoRoot,
        outputDir = join(repoRoot, 'dependicus-out'),
        cacheDir = join(repoRoot, '.dependicus-cache'),
        sources,
    } = config;

    const core = createCoreServices({
        repoRoot,
        cacheDir,
        providers: config.providers,
        sources,
    });
    const htmlWriter = new HtmlWriter({
        groupings: config.groupings,
        siteName: config.siteName,
        columns: config.columns,
        getUsedByGroupKey: config.getUsedByGroupKey,
        getSections: config.getSections,
    });

    return {
        async collectData(): Promise<CollectResult> {
            const { providers, store } = await core.collect();
            return {
                metadata: { generatedAt: new Date().toISOString() },
                providers,
                facts: store.toJSON(),
                store,
            };
        },

        refreshLocal(dependencies: DirectDependency[], store: FactStore): void {
            // Group by ecosystem and run with scoped stores so plugin
            // sources write to the correct namespace.
            const byEcosystem = new Map<string, DirectDependency[]>();
            for (const dep of dependencies) {
                const list = byEcosystem.get(dep.ecosystem) ?? [];
                list.push(dep);
                byEcosystem.set(dep.ecosystem, list);
            }
            for (const [ecosystem, deps] of byEcosystem) {
                const scoped = store.scoped(ecosystem);
                for (const source of config.sources ?? []) {
                    source.refreshLocal?.(deps, scoped);
                }
            }
        },

        async generateSite(providers: ProviderOutput[], store: FactStore): Promise<void> {
            await mkdir(outputDir, { recursive: true });

            // Generate index
            const html = await htmlWriter.toHtml(providers, store);
            await writeFile(join(outputDir, 'index.html'), html, 'utf-8');

            // Write bundled CSS for detail and grouping pages
            await writeFile(join(outputDir, 'styles.css'), await getCssContent(), 'utf-8');

            // Generate detail pages (returns provider-scoped paths)
            const detailPages = htmlWriter.toDetailPages(providers, store);
            for (const page of detailPages) {
                const pagePath = join(outputDir, page.filename);
                await mkdir(dirname(pagePath), { recursive: true });
                await writeFile(pagePath, page.html, 'utf-8');
            }

            // Generate grouping pages (returns provider-scoped paths)
            const groupingPages = htmlWriter.toAllGroupingPages(providers, store);
            for (const page of groupingPages) {
                const pagePath = join(outputDir, page.filename);
                await mkdir(dirname(pagePath), { recursive: true });
                await writeFile(pagePath, page.html, 'utf-8');
            }
        },
    };
}
