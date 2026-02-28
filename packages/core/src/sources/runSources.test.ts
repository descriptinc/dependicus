import { describe, it, expect, vi } from 'vitest';
import { runSources } from './runSources';
import { RootFactStore } from './FactStore';
import type { FactStore } from './FactStore';
import type { DataSource } from './types';
import type { DirectDependency } from '../types';

function makeSource(
    name: string,
    dependsOn: string[] = [],
    fetch?: (deps: DirectDependency[], store: FactStore) => Promise<void>,
): DataSource {
    return {
        name,
        dependsOn,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        fetch: fetch ?? vi.fn(async () => {}),
    };
}

const emptyDeps: DirectDependency[] = [];

describe('runSources', () => {
    it('runs a single source with no dependencies', async () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const fetch = vi.fn(async () => {});
        const source = makeSource('registry', [], fetch);
        const store = new RootFactStore();

        await runSources([source], emptyDeps, store);

        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(emptyDeps, store);
    });

    it('runs sources in dependency order', async () => {
        const order: string[] = [];

        const a = makeSource('a', [], async () => {
            order.push('a');
        });
        const b = makeSource('b', ['a'], async () => {
            order.push('b');
        });
        const c = makeSource('c', ['b'], async () => {
            order.push('c');
        });

        await runSources([c, b, a], emptyDeps, new RootFactStore());

        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('runs independent sources in parallel', async () => {
        // Two sources with no mutual dependencies should start together.
        // We verify this by checking that both start before either finishes.
        const timeline: string[] = [];

        const a = makeSource('a', [], async () => {
            timeline.push('a-start');
            await new Promise((r) => setTimeout(r, 10));
            timeline.push('a-end');
        });
        const b = makeSource('b', [], async () => {
            timeline.push('b-start');
            await new Promise((r) => setTimeout(r, 10));
            timeline.push('b-end');
        });

        await runSources([a, b], emptyDeps, new RootFactStore());

        // Both should start before either ends
        const aStartIdx = timeline.indexOf('a-start');
        const bStartIdx = timeline.indexOf('b-start');
        const aEndIdx = timeline.indexOf('a-end');
        const bEndIdx = timeline.indexOf('b-end');

        expect(aStartIdx).toBeLessThan(aEndIdx);
        expect(bStartIdx).toBeLessThan(bEndIdx);
        // Both starts happen before any end
        expect(Math.max(aStartIdx, bStartIdx)).toBeLessThan(Math.min(aEndIdx, bEndIdx));
    });

    it('batches sources correctly in a diamond dependency graph', async () => {
        // Diamond: A -> B, A -> C, B -> D, C -> D
        const order: string[] = [];

        const a = makeSource('a', [], async () => {
            order.push('a');
        });
        const b = makeSource('b', ['a'], async () => {
            order.push('b');
        });
        const c = makeSource('c', ['a'], async () => {
            order.push('c');
        });
        const d = makeSource('d', ['b', 'c'], async () => {
            order.push('d');
        });

        await runSources([d, c, b, a], emptyDeps, new RootFactStore());

        expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
        expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });

    it('passes dependencies and store to each source', async () => {
        const deps: DirectDependency[] = [
            {
                packageName: 'react',
                ecosystem: 'npm',
                versions: [
                    {
                        version: '18.2.0',
                        latestVersion: '19.0.0',
                        usedBy: ['@my/app'],
                        dependencyTypes: ['prod'],
                        publishDate: '2024-01-01',
                        inCatalog: false,
                    },
                ],
            },
        ];
        const store = new RootFactStore();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const fetch = vi.fn(async () => {});
        const source = makeSource('registry', [], fetch);

        await runSources([source], deps, store);

        expect(fetch).toHaveBeenCalledWith(deps, store);
    });

    it('throws on cycle detection', async () => {
        const a = makeSource('a', ['b']);
        const b = makeSource('b', ['a']);

        await expect(runSources([a, b], emptyDeps, new RootFactStore())).rejects.toThrow(
            /cycle detected/i,
        );
    });

    it('throws on self-referential dependency', async () => {
        const a = makeSource('a', ['a']);

        await expect(runSources([a], emptyDeps, new RootFactStore())).rejects.toThrow(
            /cycle detected/i,
        );
    });

    it('throws when dependsOn references an unknown source', async () => {
        const a = makeSource('a', ['nonexistent']);

        await expect(runSources([a], emptyDeps, new RootFactStore())).rejects.toThrow(
            /unknown source "nonexistent"/i,
        );
    });

    it('handles empty source list', async () => {
        await runSources([], emptyDeps, new RootFactStore());
        // Should complete without error
    });
});
