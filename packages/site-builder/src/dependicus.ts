import { join, dirname } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
    DependicusOutput,
    DirectDependency,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    DataSource,
    FactStore,
    UsedByGroupKeyFn,
} from '@dependicus/core';
import { createCoreServices, computeOutputMetadata } from '@dependicus/core';
import { HtmlWriter } from './services/HtmlWriter';
import type { CustomColumn } from './services/HtmlWriter';
import { getCssContent } from './paths';

export interface DependicusConfig {
    repoRoot: string;
    outputDir?: string;
    cacheDir?: string;
    sources?: DataSource[];
    groupings?: GroupingConfig[];
    siteName?: string;
    columns?: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
}

export interface CollectResult extends DependicusOutput {
    store: FactStore;
}

export interface DependicusInstance {
    collectData(): Promise<CollectResult>;
    refreshLocal(dependencies: DirectDependency[], store: FactStore): void;
    generateSite(dependencies: DirectDependency[], store: FactStore): Promise<void>;
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
            const { dependencies, store } = await core.collect();
            return {
                metadata: computeOutputMetadata(dependencies, store),
                dependencies,
                facts: store.toJSON(),
                store,
            };
        },

        refreshLocal(dependencies: DirectDependency[], store: FactStore): void {
            for (const source of config.sources ?? []) {
                source.refreshLocal?.(dependencies, store);
            }
        },

        async generateSite(dependencies: DirectDependency[], store: FactStore): Promise<void> {
            await mkdir(outputDir, { recursive: true });

            // Generate index
            const html = htmlWriter.toHtml(dependencies, store);
            await writeFile(join(outputDir, 'index.html'), html, 'utf-8');

            // Write bundled CSS for detail and grouping pages
            await writeFile(join(outputDir, 'styles.css'), getCssContent(), 'utf-8');

            // Generate detail pages
            const detailsDir = join(outputDir, 'details');
            await mkdir(detailsDir, { recursive: true });
            const detailPages = htmlWriter.toDetailPages(dependencies, store);
            for (const page of detailPages) {
                await writeFile(join(detailsDir, page.filename), page.html, 'utf-8');
            }

            // Generate grouping pages
            const groupingPages = htmlWriter.toAllGroupingPages(dependencies, store);
            for (const page of groupingPages) {
                const pagePath = join(outputDir, page.filename);
                await mkdir(dirname(pagePath), { recursive: true });
                await writeFile(pagePath, page.html, 'utf-8');
            }
        },
    };
}
