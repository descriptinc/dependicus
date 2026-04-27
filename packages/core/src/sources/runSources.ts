import type { DirectDependency } from '../types';
import type { DataSource, FactStore } from './types';

/**
 * Runs data sources in topological order, batching independent sources for parallel execution.
 *
 * Sources declare their dependencies via `dependsOn`. The executor validates that all
 * hard dependencies exist, detects cycles, and runs each batch with `Promise.all`.
 *
 * Sources may also declare `softDependsOn` — these are waited for when present in the
 * pool but silently ignored when absent.
 */
export async function runSources(
    sources: readonly DataSource[],
    dependencies: DirectDependency[],
    store: FactStore,
): Promise<void> {
    const sourcesByName = new Map<string, DataSource>();
    for (const source of sources) {
        sourcesByName.set(source.name, source);
    }

    // Validate that all hard dependsOn references point to known sources
    for (const source of sources) {
        for (const dep of source.dependsOn) {
            if (!sourcesByName.has(dep)) {
                throw new Error(`Source "${source.name}" depends on unknown source "${dep}"`);
            }
        }
        // softDependsOn: no validation — unknown entries are silently ignored
    }

    /** Hard deps + soft deps that exist in the pool. */
    function effectiveDeps(source: DataSource): string[] {
        const hard = [...source.dependsOn];
        const soft = (source.softDependsOn ?? []).filter((d) => sourcesByName.has(d));
        return [...hard, ...soft];
    }

    const completed = new Set<string>();
    const remaining = new Set(sources.map((s) => s.name));

    while (remaining.size > 0) {
        const ready: DataSource[] = [];
        for (const name of remaining) {
            const source = sourcesByName.get(name);
            if (source && effectiveDeps(source).every((dep) => completed.has(dep))) {
                ready.push(source);
            }
        }

        if (ready.length === 0) {
            const cycle = Array.from(remaining).join(', ');
            throw new Error(`Cycle detected among sources: ${cycle}`);
        }

        await Promise.all(ready.map((source) => source.fetch(dependencies, store)));

        for (const source of ready) {
            completed.add(source.name);
            remaining.delete(source.name);
        }
    }
}
