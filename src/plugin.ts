import type {
    DataSource,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    FactStore,
    UsedByGroupKeyFn,
    PluginContext,
} from './core/index';
import type { CustomColumn } from './site-builder/index';
import type { VersionContext, LinearIssueSpec } from './linear/index';
import { linearIssueSpecSchema } from './linear/index';
import type { GitHubIssueSpec } from './github-issues/index';
import type { VersionContext as GitHubVersionContext } from './github-issues/index';
import { gitHubIssueSpecSchema } from './github-issues/index';
import type { DependicusCliConfig } from './cli';

// Re-export for consumers
export type { PluginContext };

/** @group Plugins */
export interface DependicusPlugin {
    name: string;

    /** Called after services are created but before data collection. */
    init?(ctx: PluginContext): void;

    sources?: DataSource[];
    columns?: CustomColumn[];
    groupings?: GroupingConfig[];

    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];

    getLinearIssueSpec?: (
        context: VersionContext,
        store: FactStore,
    ) => Partial<LinearIssueSpec> | undefined;

    getGitHubIssueSpec?: (
        context: GitHubVersionContext,
        store: FactStore,
    ) => Partial<GitHubIssueSpec> | undefined;
}

export interface ResolvedPlugins {
    sources: DataSource[];
    groupings: GroupingConfig[];
    columns: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
    /** Returns unvalidated merged partials — call validateLinearIssueSpec before use. */
    getLinearIssueSpec?: (
        context: VersionContext,
        store: FactStore,
    ) => Partial<LinearIssueSpec> | undefined;
    /** Returns unvalidated merged partials — call validateGitHubIssueSpec before use. */
    getGitHubIssueSpec?: (
        context: GitHubVersionContext,
        store: FactStore,
    ) => Partial<GitHubIssueSpec> | undefined;
}

// ── Merge (no validation) ───────────────────────────────────────────

function mergeLinearIssueSpecs(
    fns: Array<(ctx: VersionContext, store: FactStore) => Partial<LinearIssueSpec> | undefined>,
): ((ctx: VersionContext, store: FactStore) => Partial<LinearIssueSpec> | undefined) | undefined {
    if (fns.length === 0) return undefined;
    return (ctx, store) => {
        const partials = fns.map((fn) => fn(ctx, store)).filter((p) => p !== undefined);
        if (partials.length === 0) return undefined;
        const allSections = partials.flatMap((p) => p.descriptionSections ?? []);
        const merged = Object.assign({}, ...partials) as Partial<LinearIssueSpec>;
        if (allSections.length > 0) merged.descriptionSections = allSections;
        return merged;
    };
}

function mergeGitHubIssueSpecs(
    fns: Array<
        (ctx: GitHubVersionContext, store: FactStore) => Partial<GitHubIssueSpec> | undefined
    >,
):
    | ((ctx: GitHubVersionContext, store: FactStore) => Partial<GitHubIssueSpec> | undefined)
    | undefined {
    if (fns.length === 0) return undefined;
    return (ctx, store) => {
        const partials = fns.map((fn) => fn(ctx, store)).filter((p) => p !== undefined);
        if (partials.length === 0) return undefined;
        const allSections = partials.flatMap((p) => p.descriptionSections ?? []);
        const merged = Object.assign({}, ...partials) as Partial<GitHubIssueSpec>;
        if (allSections.length > 0) merged.descriptionSections = allSections;
        return merged;
    };
}

// ── Validation (called by CLI after flag injection) ─────────────────

export interface SpecDiagnostics {
    skipped: string[];
    summarized: boolean;
}

export function validateLinearIssueSpec(
    partial: Partial<LinearIssueSpec> | undefined,
    depName: string,
    diag: SpecDiagnostics,
): LinearIssueSpec | undefined {
    if (!partial) return undefined;
    const result = linearIssueSpecSchema.safeParse(partial);
    if (!result.success) {
        diag.skipped.push(depName);
        if (!diag.summarized) {
            diag.summarized = true;
            queueMicrotask(() => {
                process.stderr.write(
                    `Skipped ${diag.skipped.length} dependencies with incomplete Linear issue specs: ${diag.skipped.join(', ')}\n`,
                );
            });
        }
        return undefined;
    }
    return result.data;
}

export function validateGitHubIssueSpec(
    partial: Partial<GitHubIssueSpec> | undefined,
    depName: string,
    diag: SpecDiagnostics,
): GitHubIssueSpec | undefined {
    if (!partial) return undefined;
    const result = gitHubIssueSpecSchema.safeParse(partial);
    if (!result.success) {
        diag.skipped.push(depName);
        if (!diag.summarized) {
            diag.summarized = true;
            queueMicrotask(() => {
                process.stderr.write(
                    `Skipped ${diag.skipped.length} dependencies with incomplete GitHub issue specs: ${diag.skipped.join(', ')}\n`,
                );
            });
        }
        return undefined;
    }
    return result.data;
}

// ── Plugin resolution ───────────────────────────────────────────────

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

    // Merge Linear issue specs: config spec (if any) + plugin specs
    const linearIssueSpecFns: Array<
        (ctx: VersionContext, store: FactStore) => Partial<LinearIssueSpec> | undefined
    > = [];
    if (config.linear?.getLinearIssueSpec) {
        const configFn = config.linear.getLinearIssueSpec;
        linearIssueSpecFns.push((ctx, store) => configFn(ctx, store));
    }
    for (const p of plugins) {
        if (p.getLinearIssueSpec) linearIssueSpecFns.push(p.getLinearIssueSpec);
    }
    const getLinearIssueSpec = mergeLinearIssueSpecs(linearIssueSpecFns);

    // Merge GitHub issue specs: config spec (if any) + plugin specs
    const gitHubIssueSpecFns: Array<
        (ctx: GitHubVersionContext, store: FactStore) => Partial<GitHubIssueSpec> | undefined
    > = [];
    if (config.github?.getGitHubIssueSpec) {
        const configFn = config.github.getGitHubIssueSpec;
        gitHubIssueSpecFns.push((ctx, store) => configFn(ctx, store));
    }
    for (const p of plugins) {
        if (p.getGitHubIssueSpec) gitHubIssueSpecFns.push(p.getGitHubIssueSpec);
    }
    const getGitHubIssueSpec = mergeGitHubIssueSpecs(gitHubIssueSpecFns);

    return {
        sources,
        groupings,
        columns,
        getUsedByGroupKey,
        getSections,
        getLinearIssueSpec,
        getGitHubIssueSpec,
    };
}
