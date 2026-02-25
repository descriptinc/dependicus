import { describe, it, expect } from 'vitest';
import type {
    DataSource,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
} from '@dependicus/core';
import { FactStore } from '@dependicus/core';
import type { VersionContext } from '@dependicus/linear';
import type { CustomColumn } from '@dependicus/site-builder';
import { resolvePlugins } from './plugin';
import type { DependicusPlugin } from './plugin';
import type { DependicusCliConfig } from './cli';

const mockStore = new FactStore();

function makeSource(name: string): DataSource {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return { name, dependsOn: [], fetch: async () => {} };
}

function makeColumn(key: string): CustomColumn {
    return { key, header: key, getValue: () => '' };
}

function makeGrouping(key: string): GroupingConfig {
    return { key, label: key, getValue: () => undefined };
}

function baseConfig(overrides?: Partial<DependicusCliConfig>): DependicusCliConfig {
    return { repoRoot: '/repo', dependicusBaseUrl: 'https://example.com', ...overrides };
}

describe('resolvePlugins', () => {
    describe('empty plugins', () => {
        it('returns empty arrays and undefined callbacks', () => {
            const result = resolvePlugins([], baseConfig());
            expect(result.sources).toEqual([]);
            expect(result.columns).toEqual([]);
            expect(result.groupings).toEqual([]);
            expect(result.getSections).toBeUndefined();
            expect(result.getUsedByGroupKey).toBeUndefined();
            expect(result.getTicketSpec).toBeUndefined();
        });
    });

    describe('array concatenation', () => {
        it('concatenates sources from plugins', () => {
            const src1 = makeSource('src-1');
            const src2 = makeSource('src-2');

            const p1: DependicusPlugin = { name: 'p1', sources: [src1] };
            const p2: DependicusPlugin = { name: 'p2', sources: [src2] };

            const result = resolvePlugins([p1, p2], baseConfig());
            expect(result.sources).toEqual([src1, src2]);
        });

        it('collects columns from plugins', () => {
            const pluginCol = makeColumn('plugin-col');

            const plugin: DependicusPlugin = { name: 'p1', columns: [pluginCol] };

            const result = resolvePlugins([plugin], baseConfig());
            expect(result.columns).toEqual([pluginCol]);
        });

        it('collects groupings from plugins', () => {
            const pluginGrouping = makeGrouping('plugin-grp');

            const plugin: DependicusPlugin = { name: 'p1', groupings: [pluginGrouping] };

            const result = resolvePlugins([plugin], baseConfig());
            expect(result.groupings).toEqual([pluginGrouping]);
        });

        it('handles plugins with no arrays gracefully', () => {
            const plugin: DependicusPlugin = { name: 'empty' };

            const result = resolvePlugins([plugin], baseConfig());
            expect(result.sources).toEqual([]);
        });
    });

    describe('getUsedByGroupKey', () => {
        it('uses first plugin with getUsedByGroupKey', () => {
            const fn1 = () => 'group-a';
            const fn2 = () => 'group-b';

            const p1: DependicusPlugin = { name: 'p1', getUsedByGroupKey: fn1 };
            const p2: DependicusPlugin = { name: 'p2', getUsedByGroupKey: fn2 };

            const result = resolvePlugins([p1, p2], baseConfig());
            expect(result.getUsedByGroupKey).toBe(fn1);
        });

        it('skips plugins without getUsedByGroupKey', () => {
            const fn2 = () => 'group-b';

            const p1: DependicusPlugin = { name: 'p1' };
            const p2: DependicusPlugin = { name: 'p2', getUsedByGroupKey: fn2 };

            const result = resolvePlugins([p1, p2], baseConfig());
            expect(result.getUsedByGroupKey).toBe(fn2);
        });

        it('is undefined when no source provides getUsedByGroupKey', () => {
            const plugin: DependicusPlugin = { name: 'p1' };

            const result = resolvePlugins([plugin], baseConfig());
            expect(result.getUsedByGroupKey).toBeUndefined();
        });
    });

    describe('getSections', () => {
        it('concatenates sections from multiple plugins', () => {
            const section1: GroupingSection = {
                title: 'From P1',
                stats: [{ label: 'A', value: 1 }],
            };
            const section2: GroupingSection = {
                title: 'From P2',
                stats: [{ label: 'B', value: 2 }],
            };

            const p1: DependicusPlugin = {
                name: 'p1',
                getSections: () => [section1],
            };
            const p2: DependicusPlugin = {
                name: 'p2',
                getSections: () => [section2],
            };

            const result = resolvePlugins([p1, p2], baseConfig());
            const sections = result.getSections?.({} as GroupingDetailContext);
            expect(sections).toEqual([section1, section2]);
        });

        it('is undefined when no plugin provides getSections', () => {
            const plugin: DependicusPlugin = { name: 'p1' };

            const result = resolvePlugins([plugin], baseConfig());
            expect(result.getSections).toBeUndefined();
        });
    });

    describe('linear callbacks', () => {
        it('direct config getTicketSpec wins over plugin', () => {
            const directFn = () => ({ teamId: 'team', group: 'direct-group' });
            const pluginFn = () => ({ teamId: 'team', group: 'plugin-group' });

            const plugin: DependicusPlugin = { name: 'p1', getTicketSpec: pluginFn };
            const config = baseConfig({
                linear: {
                    getTicketSpec: directFn,
                },
            });

            const result = resolvePlugins([plugin], config);
            expect(result.getTicketSpec?.({} as VersionContext, mockStore)).toEqual({
                teamId: 'team',
                group: 'direct-group',
            });
        });

        it('getTicketSpec is undefined when no source provides it', () => {
            const plugin: DependicusPlugin = { name: 'p1' };

            const result = resolvePlugins([plugin], baseConfig());
            expect(result.getTicketSpec).toBeUndefined();
        });

        it('merges getTicketSpec results from multiple plugins', () => {
            const fn1 = (ctx: VersionContext) =>
                ctx.packageName === 'react'
                    ? { teamId: 'team', group: 'react-group' }
                    : undefined;
            const fn2 = () => ({ teamId: 'team', group: 'default-group' });

            const p1: DependicusPlugin = { name: 'p1', getTicketSpec: fn1 };
            const p2: DependicusPlugin = { name: 'p2', getTicketSpec: fn2 };

            const result = resolvePlugins([p1, p2], baseConfig());
            // Both plugins contribute for 'react': fn2 overrides fn1's group
            expect(
                result.getTicketSpec?.({ packageName: 'react' } as VersionContext, mockStore),
            ).toEqual({ teamId: 'team', group: 'default-group' });
            // Only fn2 contributes for 'vue'
            expect(
                result.getTicketSpec?.({ packageName: 'vue' } as VersionContext, mockStore),
            ).toEqual({ teamId: 'team', group: 'default-group' });
        });

        it('two plugins contribute different fields and are merged', () => {
            const fn1 = () => ({ teamId: 'team-a', ownerLabel: 'Team A' });
            const fn2 = () => ({
                policy: { type: 'dueDate' as const },
                daysOverdue: 5,
                thresholdDays: 30,
            });

            const p1: DependicusPlugin = { name: 'p1', getTicketSpec: fn1 };
            const p2: DependicusPlugin = { name: 'p2', getTicketSpec: fn2 };

            const result = resolvePlugins([p1, p2], baseConfig());
            expect(result.getTicketSpec?.({} as VersionContext, mockStore)).toEqual({
                teamId: 'team-a',
                ownerLabel: 'Team A',
                policy: { type: 'dueDate' },
                daysOverdue: 5,
                thresholdDays: 30,
            });
        });

        it('concatenates descriptionSections from multiple plugins', () => {
            const fn1 = () => ({
                teamId: 'team',
                descriptionSections: [{ title: 'Policy', body: 'Tier 1' }],
            });
            const fn2 = () => ({
                descriptionSections: [{ title: 'Notes', body: 'Extra info' }],
            });

            const p1: DependicusPlugin = { name: 'p1', getTicketSpec: fn1 };
            const p2: DependicusPlugin = { name: 'p2', getTicketSpec: fn2 };

            const result = resolvePlugins([p1, p2], baseConfig());
            const spec = result.getTicketSpec?.({} as VersionContext, mockStore);
            expect(spec?.descriptionSections).toEqual([
                { title: 'Policy', body: 'Tier 1' },
                { title: 'Notes', body: 'Extra info' },
            ]);
        });

        it('returns undefined when merged result is missing teamId', () => {
            const fn1 = () => ({ policy: { type: 'fyi' as const } });

            const p1: DependicusPlugin = { name: 'p1', getTicketSpec: fn1 };

            const result = resolvePlugins([p1], baseConfig());
            expect(result.getTicketSpec?.({} as VersionContext, mockStore)).toBeUndefined();
        });

        it('single plugin returning full spec works as before', () => {
            const fn1 = () => ({
                teamId: 'team',
                policy: { type: 'dueDate' as const },
                daysOverdue: 10,
                thresholdDays: 30,
                assignment: { type: 'unassigned' as const },
            });

            const p1: DependicusPlugin = { name: 'p1', getTicketSpec: fn1 };

            const result = resolvePlugins([p1], baseConfig());
            expect(result.getTicketSpec?.({} as VersionContext, mockStore)).toEqual({
                teamId: 'team',
                policy: { type: 'dueDate' },
                daysOverdue: 10,
                thresholdDays: 30,
                assignment: { type: 'unassigned' },
            });
        });
    });

    describe('multiple plugins contributing arrays', () => {
        it('merges columns and groupings from multiple plugins', () => {
            const col1 = makeColumn('col-1');
            const col2 = makeColumn('col-2');
            const grp1 = makeGrouping('grp-1');
            const grp2 = makeGrouping('grp-2');

            const p1: DependicusPlugin = { name: 'p1', columns: [col1], groupings: [grp1] };
            const p2: DependicusPlugin = { name: 'p2', columns: [col2], groupings: [grp2] };

            const result = resolvePlugins([p1, p2], baseConfig());
            expect(result.columns).toEqual([col1, col2]);
            expect(result.groupings).toEqual([grp1, grp2]);
        });
    });
});
