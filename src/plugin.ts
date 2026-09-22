import type {
    DataSource,
    DependencyDetailContext,
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
    /**
     * Sections for a single dependency's own page. Same shape as the grouping
     * sections, so a plugin holding per-version detail (advisories, sizes,
     * policy history) can render it where someone is looking at that
     * dependency, rather than only as a metadata row.
     */
    getDependencySections?: (ctx: DependencyDetailContext) => GroupingSection[];

    getLinearIssueSpec?: (
        context: VersionContext,
        store: FactStore,
    ) => IssueSpecResult<Partial<LinearIssueSpec>>;

    getGitHubIssueSpec?: (
        context: GitHubVersionContext,
        store: FactStore,
    ) => IssueSpecResult<Partial<GitHubIssueSpec>>;
}

export interface ResolvedPlugins {
    sources: DataSource[];
    groupings: GroupingConfig[];
    columns: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
    getDependencySections?: (ctx: DependencyDetailContext) => GroupingSection[];
    /** Returns unvalidated merged partials — call validateLinearIssueSpec before use. */
    getLinearIssueSpec?: (
        context: VersionContext,
        store: FactStore,
    ) => IssueSpecResult<Partial<LinearIssueSpec>>;
    /** Returns unvalidated merged partials — call validateGitHubIssueSpec before use. */
    getGitHubIssueSpec?: (
        context: GitHubVersionContext,
        store: FactStore,
    ) => IssueSpecResult<Partial<GitHubIssueSpec>>;
}

// ── Merge (no validation) ───────────────────────────────────────────

/**
 * What an issue spec function may return: nothing, one spec, or one spec per
 * scope.
 * @group Issue Creation
 */
export type IssueSpecResult<T> = T | T[] | undefined;

interface MergeableSpec {
    scope?: string;
    descriptionSections?: Array<{ title: string; body: string }>;
    commentSections?: Array<{ title: string; body: string }>;
}

/**
 * Combine partial specs into one spec, concatenating sections rather than
 * letting the last one win.
 */
function combineSpecs<T extends MergeableSpec>(partials: Partial<T>[]): Partial<T> {
    const allSections = partials.flatMap((p) => p.descriptionSections ?? []);
    const allCommentSections = partials.flatMap((p) => p.commentSections ?? []);
    const merged = Object.assign({}, ...partials) as Partial<T>;
    if (allSections.length > 0) merged.descriptionSections = allSections;
    if (allCommentSections.length > 0) merged.commentSections = allCommentSections;
    return merged;
}

/**
 * Merge every plugin's spec for a version.
 *
 * Single specs merge into one, as they always have. When any function returns
 * an array, the result is one spec per scope: array entries sharing a scope
 * merge together, and every single spec is merged into each of them. That way
 * a plugin contributing only description sections, like SecurityPlugin, still
 * reaches each scoped issue.
 */
function mergeIssueSpecs<C, T extends MergeableSpec>(
    fns: Array<(ctx: C, store: FactStore) => IssueSpecResult<Partial<T>>>,
): ((ctx: C, store: FactStore) => IssueSpecResult<Partial<T>>) | undefined {
    if (fns.length === 0) return undefined;
    return (ctx, store) => {
        const results = fns.map((fn) => fn(ctx, store)).filter((r) => r !== undefined);
        if (results.length === 0) return undefined;
        const singles = results.filter((r): r is Partial<T> => !Array.isArray(r));
        const lists = results.filter((r): r is Partial<T>[] => Array.isArray(r));
        if (lists.length === 0) return combineSpecs(singles);

        const byScope = new Map<string | undefined, Partial<T>[]>();
        for (const spec of lists.flat()) {
            const entries = byScope.get(spec.scope) ?? [];
            entries.push(spec);
            byScope.set(spec.scope, entries);
        }
        if (byScope.size === 0) return undefined;
        return [...byScope.values()].map((entries) => combineSpecs([...singles, ...entries]));
    };
}

function mergeLinearIssueSpecs(
    fns: Array<
        (ctx: VersionContext, store: FactStore) => IssueSpecResult<Partial<LinearIssueSpec>>
    >,
) {
    return mergeIssueSpecs<VersionContext, LinearIssueSpec>(fns);
}

function mergeGitHubIssueSpecs(
    fns: Array<
        (ctx: GitHubVersionContext, store: FactStore) => IssueSpecResult<Partial<GitHubIssueSpec>>
    >,
) {
    return mergeIssueSpecs<GitHubVersionContext, GitHubIssueSpec>(fns);
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

    // getDependencySections: same, for a single dependency's page
    const dependencySectionFns = plugins
        .map((p) => p.getDependencySections)
        .filter(
            (fn): fn is (ctx: DependencyDetailContext) => GroupingSection[] => fn !== undefined,
        );
    const getDependencySections =
        dependencySectionFns.length > 0
            ? (ctx: DependencyDetailContext): GroupingSection[] =>
                  dependencySectionFns.flatMap((fn) => fn(ctx))
            : undefined;

    // Merge Linear issue specs: config spec (if any) + plugin specs
    const linearIssueSpecFns: Array<
        (ctx: VersionContext, store: FactStore) => IssueSpecResult<Partial<LinearIssueSpec>>
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
        (ctx: GitHubVersionContext, store: FactStore) => IssueSpecResult<Partial<GitHubIssueSpec>>
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
        getDependencySections,
        getLinearIssueSpec,
        getGitHubIssueSpec,
    };
}
