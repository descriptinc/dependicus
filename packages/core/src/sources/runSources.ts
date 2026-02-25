import type { DirectDependency } from '../types';
import type { DataSource, FactStore } from './types';

/**
 * Runs data sources in topological order, batching independent sources for parallel execution.
 *
 * Sources declare their dependencies via `dependsOn`. The executor validates that all
 * referenced dependencies exist, detects cycles, and runs each batch with `Promise.all`.
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

    // Validate that all dependsOn references point to known sources
    for (const source of sources) {
        for (const dep of source.dependsOn) {
            if (!sourcesByName.has(dep)) {
                throw new Error(`Source "${source.name}" depends on unknown source "${dep}"`);
            }
        }
    }

    const completed = new Set<string>();
    const remaining = new Set(sources.map((s) => s.name));

    while (remaining.size > 0) {
        const ready: DataSource[] = [];
        for (const name of remaining) {
            const source = sourcesByName.get(name);
            if (source && source.dependsOn.every((dep) => completed.has(dep))) {
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
