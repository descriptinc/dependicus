import type {
    DataSource,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    FactStore,
    UsedByGroupKeyFn,
} from '@dependicus/core';
import type { CustomColumn } from '@dependicus/site-builder';
import type { VersionContext, TicketSpec } from '@dependicus/linear';
import { ticketSpecSchema } from '@dependicus/linear';
import type { DependicusCliConfig } from './cli';

/** @group Plugins */
export interface DependicusPlugin {
    name: string;

    sources?: DataSource[];
    columns?: CustomColumn[];
    groupings?: GroupingConfig[];

    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];

    getTicketSpec?: (context: VersionContext, store: FactStore) => Partial<TicketSpec> | undefined;
}

export interface ResolvedPlugins {
    sources: DataSource[];
    groupings: GroupingConfig[];
    columns: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
    getTicketSpec?: (context: VersionContext, store: FactStore) => TicketSpec | undefined;
}

function mergeTicketSpecs(
    fns: Array<(ctx: VersionContext, store: FactStore) => Partial<TicketSpec> | undefined>,
): ((ctx: VersionContext, store: FactStore) => TicketSpec | undefined) | undefined {
    if (fns.length === 0) return undefined;
    return (ctx, store) => {
        const partials = fns.map((fn) => fn(ctx, store)).filter((p) => p !== undefined);
        if (partials.length === 0) return undefined;
        const allSections = partials.flatMap((p) => p.descriptionSections ?? []);
        const merged = Object.assign({}, ...partials);
        if (allSections.length > 0) merged.descriptionSections = allSections;
        const result = ticketSpecSchema.safeParse(merged);
        if (!result.success) {
            process.stderr.write(
                `Warning: merged ticket spec failed validation: ${result.error.message}\n`,
            );
            return undefined;
        }
        return result.data;
    };
}

export function resolvePlugins(
    plugins: DependicusPlugin[],
    config: DependicusCliConfig,
): ResolvedPlugins {
    const sources = plugins.flatMap((p) => p.sources ?? []);
    const columns = plugins.flatMap((p) => p.columns ?? []);
    const groupings = plugins.flatMap((p) => p.groupings ?? []);

    const getUsedByGroupKey = plugins.find((p) => p.getUsedByGroupKey)?.getUsedByGroupKey;

    // getSections: concatenate across all plugins
    const sectionFns = plugins
        .map((p) => p.getSections)
        .filter((fn): fn is (ctx: GroupingDetailContext) => GroupingSection[] => fn !== undefined);
    const getSections =
        sectionFns.length > 0
            ? (ctx: GroupingDetailContext): GroupingSection[] => sectionFns.flatMap((fn) => fn(ctx))
            : undefined;

    // Merge plugin ticket specs; direct config override bypasses merging
    const pluginTicketSpecFns = plugins
        .map((p) => p.getTicketSpec)
        .filter(
            (
                fn,
            ): fn is (
                context: VersionContext,
                store: FactStore,
            ) => Partial<TicketSpec> | undefined => fn !== undefined,
        );

    const getTicketSpec = config.linear?.getTicketSpec ?? mergeTicketSpecs(pluginTicketSpecFns);

    return {
        sources,
        groupings,
        columns,
        getUsedByGroupKey,
        getSections,
        getTicketSpec,
    };
}
