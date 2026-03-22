import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectDependency, DependencyVersion, PackageVersionInfo } from '@dependicus/core';
import { RootFactStore, FactKeys, getUpdateType } from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
import { reconcileIssues, type IssueReconcilerConfig } from './issueReconciler';
import type { VersionContext, LinearIssueSpec } from './types';

const mockClient = {
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
    issues: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    createComment: vi.fn(),
    issue: vi.fn(),
};

// Mock @linear/sdk
vi.mock('@linear/sdk', () => ({
    LinearClient: function () {
        return mockClient;
    },
    LinearDocument: {},
}));

interface TestMeta {
    surfaceId: string;
    teamName: string;
    policyId: string;
    notificationOptOut: boolean;
    group?: string;
}

const defaultMeta: TestMeta = {
    surfaceId: 'TestSurface',
    teamName: 'TestTeam',
    policyId: 'mandatory',
    notificationOptOut: false,
};

const defaultVersionsBetween: PackageVersionInfo[] = [
    {
        version: '1.1.0',
        publishDate: '2024-03-01',
        isPrerelease: false,
        registryUrl: 'https://www.npmjs.com/package/test-pkg/v/1.1.0',
    },
    {
        version: '2.0.0',
        publishDate: '2024-06-01',
        isPrerelease: false,
        registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.0.0',
    },
];

function testTeamId(dependencyName: string): string | undefined {
    if (dependencyName.includes('unknown-team')) return undefined;
    return 'linear-team-123';
}

const testGetLinearIssueSpec = (
    context: VersionContext,
    store: FactStore,
): LinearIssueSpec | undefined => {
    const m = store.getDependencyFact<TestMeta>(context.name, 'testMeta');
    if (!m || m.notificationOptOut) return undefined;
    const teamId = testTeamId(context.name);
    if (!teamId) return undefined;
    if (m.policyId === 'awareness') {
        return {
            policy: { type: 'fyi', rateLimitDays: 30 },
            assignment: { type: 'unassigned' },
            teamId,
            group: m.group,
            ownerLabel: `${m.surfaceId} (${m.teamName})`,
        };
    }
    // Mandatory policy: pre-compute compliance based on update type
    const thresholdDaysMap: Record<string, number> = {
        major: 360,
        minor: 180,
        patch: 90,
    };
    const thresholdDays =
        thresholdDaysMap[getUpdateType(context.currentVersion, context.latestVersion)!] ?? 360;
    return {
        policy: { type: 'dueDate' },
        daysOverdue: 30,
        thresholdDays,
        targetVersion: context.latestVersion,
        assignment: { type: 'delegate', assigneeId: 'agent-123' },
        teamId,
        group: m.group,
        ownerLabel: `${m.surfaceId} (${m.teamName})`,
    };
};

function makeVersion(overrides: Partial<DependencyVersion> = {}): DependencyVersion {
    return {
        version: '1.0.0',
        latestVersion: '2.0.0',
        usedBy: ['@app/web'],
        dependencyTypes: ['prod'],
        publishDate: '2024-01-01',
        inCatalog: true,
        ...overrides,
    };
}

function makeDep(name: string, versions: DependencyVersion[]): DirectDependency {
    return { name, ecosystem: 'npm', versions };
}

/** Populate the FactStore with facts matching the old EnrichedVersion shape. */
function populateFacts(
    store: FactStore,
    dependencyName: string,
    version: DependencyVersion,
    opts: {
        meta?: TestMeta;
        versionsBetween?: PackageVersionInfo[];
        description?: string;
    } = {},
): void {
    const scoped = store.scoped('npm');
    const vb = opts.versionsBetween ?? defaultVersionsBetween;
    scoped.setVersionFact(dependencyName, version.version, FactKeys.VERSIONS_BETWEEN, vb);
    if (opts.description !== undefined) {
        scoped.setVersionFact(
            dependencyName,
            version.version,
            FactKeys.DESCRIPTION,
            opts.description,
        );
    } else {
        scoped.setVersionFact(
            dependencyName,
            version.version,
            FactKeys.DESCRIPTION,
            'A test package',
        );
    }
    // testMeta is consumer-facing metadata read by the getLinearIssueSpec callback.
    if (opts.meta !== undefined) {
        scoped.setDependencyFact(dependencyName, 'testMeta', opts.meta);
    } else {
        scoped.setDependencyFact(dependencyName, 'testMeta', defaultMeta);
    }
}

const defaultConfig: IssueReconcilerConfig = {
    linearApiKey: 'test-key',
    dryRun: true,
    dependicusBaseUrl: 'https://example.com/dependicus',
    cooldownDays: 7,
    allowNewIssues: true,
};

describe('reconcileIssues', () => {
    let store: FactStore;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new RootFactStore();

        // Default mock: label exists, no existing issues
        mockClient.issueLabels.mockResolvedValue({
            nodes: [{ id: 'label-123', name: 'Dependicus' }],
        });
        mockClient.issues.mockResolvedValue({
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });
        mockClient.createIssue.mockResolvedValue({
            issue: Promise.resolve({ identifier: 'TEST-100' }),
        });
    });

    it('creates issues for outdated packages', async () => {
        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(1);
        expect(result.updated).toBe(0);
        expect(result.closed).toBe(0);
    });

    it('skips packages already on latest version', async () => {
        const v = makeVersion({ version: '2.0.0', latestVersion: '2.0.0' });
        populateFacts(store, 'up-to-date-pkg', v, { versionsBetween: [] });
        const deps: DirectDependency[] = [makeDep('up-to-date-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(0);
    });

    it('skips packages when getLinearIssueSpec returns undefined (no team mapping)', async () => {
        const v = makeVersion();
        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'NonexistentTeam',
            policyId: 'mandatory',
            notificationOptOut: false,
        };
        populateFacts(store, 'unknown-team-pkg', v, { meta });
        const deps: DirectDependency[] = [makeDep('unknown-team-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(0);
    });

    it('does not create issues when allowNewIssues is false', async () => {
        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const result = await reconcileIssues(
            deps,
            store,
            { ...defaultConfig, allowNewIssues: false },
            testGetLinearIssueSpec,
        );
        expect(result.created).toBe(0);
    });

    it('updates existing issues when package is still outdated', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.updated).toBe(1);
        expect(result.created).toBe(0);
    });

    it('closes issues for packages that are now compliant', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update old-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        // Close issue mock
        mockClient.issue.mockResolvedValue({
            team: Promise.resolve({
                states: () =>
                    Promise.resolve({
                        nodes: [{ id: 'done-state', type: 'completed', name: 'Done' }],
                    }),
            }),
        });

        // No outdated packages - the existing issue should be closed
        const deps: DirectDependency[] = [];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.closed).toBe(1);
    });

    it('skips updating issues in PR state', async () => {
        const mockState = { type: 'started', name: 'PR' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const configWithSkip = { ...defaultConfig, skipStateNames: ['pr', 'verify'] };
        const result = await reconcileIssues(deps, store, configWithSkip, testGetLinearIssueSpec);
        expect(result.updated).toBe(0);
        expect(result.closed).toBe(0);
    });

    it('closes duplicate issues', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
                {
                    id: 'issue-2',
                    identifier: 'TEST-51',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-02'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        // Close issue mock
        mockClient.issue.mockResolvedValue({
            team: Promise.resolve({
                states: () =>
                    Promise.resolve({
                        nodes: [{ id: 'done-state', type: 'completed', name: 'Done' }],
                    }),
            }),
        });

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.closedDuplicates).toBe(1);
    });

    it('handles notifications-only packages', async () => {
        const v = makeVersion();
        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'TestTeam',
            policyId: 'awareness',
            notificationOptOut: false,
        };
        populateFacts(store, 'notify-pkg', v, { meta });
        const deps: DirectDependency[] = [makeDep('notify-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(1);
    });

    it('handles grouped packages', async () => {
        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'TestTeam',
            policyId: 'mandatory',
            notificationOptOut: false,
            group: 'test-group',
        };

        const vA = makeVersion();
        const vB = makeVersion();
        populateFacts(store, 'group-pkg-a', vA, { meta });
        populateFacts(store, 'group-pkg-b', vB, { meta });
        const deps: DirectDependency[] = [
            makeDep('group-pkg-a', [vA]),
            makeDep('group-pkg-b', [vB]),
        ];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        // Should create 1 issue for the group, not 2 individual ones
        expect(result.created).toBe(1);
    });

    it('skips updating issues in Verify state', async () => {
        const mockState = { type: 'started', name: 'Verify' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const configWithSkip = { ...defaultConfig, skipStateNames: ['pr', 'verify'] };
        const result = await reconcileIssues(deps, store, configWithSkip, testGetLinearIssueSpec);
        expect(result.updated).toBe(0);
        // Should not close either — issue is in progress
        expect(result.closed).toBe(0);
    });

    it('adds comment when existing issue has older version in title', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        // Existing issue tracks up to version 1.5.0
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 1.5.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const vb: PackageVersionInfo[] = [
            {
                version: '1.5.0',
                publishDate: '2024-03-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/1.5.0',
            },
            {
                version: '1.6.0',
                publishDate: '2024-04-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/1.6.0',
            },
            {
                version: '2.0.0',
                publishDate: '2024-06-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/2.0.0',
            },
        ];

        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '2.0.0',
        });
        populateFacts(store, 'test-pkg', v, { versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const config = { ...defaultConfig, dryRun: false };
        const result = await reconcileIssues(deps, store, config, testGetLinearIssueSpec);
        expect(result.updated).toBe(1);
        expect(mockClient.createComment).toHaveBeenCalled();
    });

    it('does not add comment when version has not changed', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.updated).toBe(1);
        expect(mockClient.createComment).not.toHaveBeenCalled();
    });

    it('delegates when assignment is delegate', async () => {
        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '1.0.1',
        });
        const vb: PackageVersionInfo[] = [
            {
                version: '1.0.1',
                publishDate: '2024-01-15',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/1.0.1',
            },
        ];
        populateFacts(store, 'test-pkg', v, { versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const config: IssueReconcilerConfig = {
            ...defaultConfig,
            dryRun: false,
        };

        await reconcileIssues(deps, store, config, testGetLinearIssueSpec);
        expect(mockClient.createIssue).toHaveBeenCalled();
        const createArg = mockClient.createIssue.mock.calls[0]![0];
        expect(createArg.delegateId).toBe('agent-123');
    });

    it('does not delegate non-patch updates', async () => {
        const conditionalGetLinearIssueSpec = (
            context: VersionContext,
            s: FactStore,
        ): LinearIssueSpec | undefined => {
            const m = s.getDependencyFact<TestMeta>(context.name, 'testMeta');
            if (!m || m.notificationOptOut) return undefined;
            const thresholdDaysMap: Record<string, number> = {
                major: 360,
                minor: 180,
                patch: 90,
            };
            return {
                policy: { type: 'dueDate' },
                daysOverdue: 30,
                thresholdDays:
                    thresholdDaysMap[
                        getUpdateType(context.currentVersion, context.latestVersion)!
                    ] ?? 360,
                targetVersion: context.latestVersion,
                assignment:
                    getUpdateType(context.currentVersion, context.latestVersion)! === 'patch'
                        ? { type: 'delegate', assigneeId: 'agent-123' }
                        : { type: 'unassigned' },
                teamId: 'linear-team-123',
                ownerLabel: `${m.surfaceId} (${m.teamName})`,
            };
        };

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const config: IssueReconcilerConfig = {
            ...defaultConfig,
            dryRun: false,
        };

        await reconcileIssues(deps, store, config, conditionalGetLinearIssueSpec);
        expect(mockClient.createIssue).toHaveBeenCalled();
        const createArg = mockClient.createIssue.mock.calls[0]![0];
        expect(createArg.delegateId).toBeUndefined();
    });

    it('does not delegate when assignment is unassigned', async () => {
        const noDelegateGetLinearIssueSpec = (
            context: VersionContext,
            s: FactStore,
        ): LinearIssueSpec | undefined => {
            const m = s.getDependencyFact<TestMeta>(context.name, 'testMeta');
            if (!m || m.notificationOptOut) return undefined;
            return {
                policy: { type: 'dueDate' },
                daysOverdue: 30,
                thresholdDays: 90,
                targetVersion: context.latestVersion,
                assignment: { type: 'unassigned' },
                teamId: 'linear-team-123',
                ownerLabel: `${m.surfaceId} (${m.teamName})`,
            };
        };

        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '1.0.1',
        });
        const vb: PackageVersionInfo[] = [
            {
                version: '1.0.1',
                publishDate: '2024-01-15',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/test-pkg/v/1.0.1',
            },
        ];
        populateFacts(store, 'test-pkg', v, { versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const config: IssueReconcilerConfig = {
            ...defaultConfig,
            dryRun: false,
        };

        await reconcileIssues(deps, store, config, noDelegateGetLinearIssueSpec);
        expect(mockClient.createIssue).toHaveBeenCalled();
        const createArg = mockClient.createIssue.mock.calls[0]![0];
        expect(createArg.delegateId).toBeUndefined();
    });

    it('aggregates assignment: any unassigned makes package unassigned', async () => {
        // Two versions of same package — one delegates, one unassigned
        const mixedGetLinearIssueSpec = (
            context: VersionContext,
            s: FactStore,
        ): LinearIssueSpec | undefined => {
            const m = s.getDependencyFact<TestMeta>(context.name, 'testMeta');
            if (!m || m.notificationOptOut) return undefined;
            const thresholdDaysMap: Record<string, number> = {
                major: 360,
                minor: 180,
                patch: 90,
            };
            return {
                policy: { type: 'dueDate' },
                daysOverdue: 30,
                thresholdDays:
                    thresholdDaysMap[
                        getUpdateType(context.currentVersion, context.latestVersion)!
                    ] ?? 360,
                targetVersion: context.latestVersion,
                assignment:
                    context.currentVersion === '1.0.0'
                        ? { type: 'delegate', assigneeId: 'agent-123' }
                        : { type: 'unassigned' },
                teamId: 'linear-team-123',
                ownerLabel: `${m.surfaceId} (${m.teamName})`,
            };
        };

        const v1 = makeVersion({ version: '1.0.0' });
        const v2 = makeVersion({ version: '0.9.0' });
        populateFacts(store, 'test-pkg', v1);
        populateFacts(store, 'test-pkg', v2);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v1, v2])];

        const config: IssueReconcilerConfig = {
            ...defaultConfig,
            dryRun: false,
        };

        await reconcileIssues(deps, store, config, mixedGetLinearIssueSpec);
        expect(mockClient.createIssue).toHaveBeenCalled();
        const createArg = mockClient.createIssue.mock.calls[0]![0];
        // Any unassigned should win
        expect(createArg.delegateId).toBeUndefined();
    });

    it('skips creation when rate limit applies to fyi package', async () => {
        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'TestTeam',
            policyId: 'awareness',
            notificationOptOut: false,
        };
        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '1.1.0',
        });
        const vb: PackageVersionInfo[] = [
            {
                version: '1.1.0',
                publishDate: new Date().toISOString(),
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/notify-pkg/v/1.1.0',
            },
        ];
        populateFacts(store, 'notify-pkg', v, { meta, versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('notify-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(0);
    });

    it('skips update when fyi issue is within rate limit', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        // Issue was updated very recently
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] FYI: notify-pkg 1.1.0 is available (currently on 1.0.0)',
                    dueDate: undefined,
                    updatedAt: new Date(), // Updated just now
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'TestTeam',
            policyId: 'awareness',
            notificationOptOut: false,
        };
        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '1.2.0',
        });
        const vb: PackageVersionInfo[] = [
            {
                version: '1.1.0',
                publishDate: '2024-03-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/notify-pkg/v/1.1.0',
            },
            {
                version: '1.2.0',
                publishDate: '2024-06-01',
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/notify-pkg/v/1.2.0',
            },
        ];
        populateFacts(store, 'notify-pkg', v, { meta, versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('notify-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.updated).toBe(0);
        // Should not close — still needs an update, just rate limited
        expect(result.closed).toBe(0);
    });

    it('skips duplicate title on creation', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        // An existing issue has the same title as what we'd create
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    // This issue has a different dependencyName extraction but same title
                    title: '[Dependicus] Update other-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        const v = makeVersion();
        populateFacts(store, 'other-pkg', v);
        const deps: DirectDependency[] = [makeDep('other-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        // Should update the existing issue, not create a new one
        expect(result.updated).toBe(1);
        expect(result.created).toBe(0);
    });

    it('skips when issue spec returns undefined', async () => {
        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'TestTeam',
            policyId: 'mandatory',
            notificationOptOut: true,
        };
        const v = makeVersion();
        populateFacts(store, 'opted-out-pkg', v, { meta });
        const deps: DirectDependency[] = [makeDep('opted-out-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(0);
    });

    it('skips packages within cooldown period (plugin returns undefined)', async () => {
        // Cooldown is now the plugin's responsibility. The plugin returns
        // undefined from getLinearIssueSpec for packages within the cooldown period,
        // signaling the reconciler to skip them entirely.
        const cooldownGetLinearIssueSpec = (
            context: VersionContext,
            s: FactStore,
        ): LinearIssueSpec | undefined => {
            const m = s.getDependencyFact<TestMeta>(context.name, 'testMeta');
            if (!m || m.notificationOptOut) return undefined;
            // Simulate cooldown: plugin decides to skip this version
            return undefined;
        };

        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '1.0.1',
        });
        const vb: PackageVersionInfo[] = [
            {
                // Published just 2 days ago (within default 7-day cooldown)
                version: '1.0.1',
                publishDate: new Date(Date.now() - 2 * 86400000).toISOString(),
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/cool-pkg/v/1.0.1',
            },
        ];
        populateFacts(store, 'cool-pkg', v, { versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('cool-pkg', [v])];

        const result = await reconcileIssues(
            deps,
            store,
            defaultConfig,
            cooldownGetLinearIssueSpec,
        );
        expect(result.created).toBe(0);
    });

    it('does not apply cooldown to fyi packages', async () => {
        const meta: TestMeta = {
            surfaceId: 'Surf',
            teamName: 'TestTeam',
            policyId: 'awareness',
            notificationOptOut: false,
        };
        const v = makeVersion({
            version: '1.0.0',
            latestVersion: '2.0.0',
        });
        const vb: PackageVersionInfo[] = [
            {
                // Published 2 days ago — would be within cooldown for mandatory
                version: '2.0.0',
                publishDate: new Date(Date.now() - 2 * 86400000).toISOString(),
                isPrerelease: false,
                registryUrl: 'https://www.npmjs.com/package/notify-major-pkg/v/2.0.0',
            },
        ];
        populateFacts(store, 'notify-major-pkg', v, { meta, versionsBetween: vb });
        const deps: DirectDependency[] = [makeDep('notify-major-pkg', [v])];

        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        // fyi packages bypass the cooldown
        expect(result.created).toBe(1);
    });

    it('uses default fyi policy when getLinearIssueSpec returns only teamId', async () => {
        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const config: IssueReconcilerConfig = {
            ...defaultConfig,
            dryRun: false,
        };

        // Minimal getLinearIssueSpec — only teamId, everything else defaults (fyi, unassigned)
        const result = await reconcileIssues(deps, store, config, () => ({
            teamId: 'linear-team-123',
        }));
        expect(result.created).toBe(1);
        // Default is fyi, so no due date — verify no delegateId
        expect(mockClient.createIssue).toHaveBeenCalled();
        const createArg = mockClient.createIssue.mock.calls[0]![0];
        expect(createArg.delegateId).toBeUndefined();
        expect(createArg.dueDate).toBeUndefined();
    });

    describe('grouped package reconciliation', () => {
        function makeGroupVersion(groupName: string): {
            version: DependencyVersion;
            meta: TestMeta;
        } {
            return {
                version: makeVersion(),
                meta: {
                    surfaceId: 'Surf',
                    teamName: 'TestTeam',
                    policyId: 'mandatory',
                    notificationOptOut: false,
                    group: groupName,
                },
            };
        }

        it('skips updating group issue in PR state', async () => {
            const mockState = { type: 'started', name: 'PR' };
            mockClient.issues.mockResolvedValue({
                nodes: [
                    {
                        id: 'issue-1',
                        identifier: 'TEST-50',
                        title: '[Dependicus] Update my-group group (2 packages)',
                        dueDate: '2025-06-01',
                        updatedAt: new Date('2024-01-01'),
                        state: Promise.resolve(mockState),
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const gA = makeGroupVersion('my-group');
            const gB = makeGroupVersion('my-group');
            populateFacts(store, 'group-a', gA.version, { meta: gA.meta });
            populateFacts(store, 'group-b', gB.version, { meta: gB.meta });
            const deps: DirectDependency[] = [
                makeDep('group-a', [gA.version]),
                makeDep('group-b', [gB.version]),
            ];

            const configWithSkip = { ...defaultConfig, skipStateNames: ['pr', 'verify'] };
            const result = await reconcileIssues(
                deps,
                store,
                configWithSkip,
                testGetLinearIssueSpec,
            );
            expect(result.updated).toBe(0);
            expect(result.closed).toBe(0);
        });

        it('updates existing group issue', async () => {
            const mockState = { type: 'unstarted', name: 'Todo' };
            mockClient.issues.mockResolvedValue({
                nodes: [
                    {
                        id: 'issue-1',
                        identifier: 'TEST-50',
                        title: '[Dependicus] Update my-group group (2 packages)',
                        dueDate: '2025-06-01',
                        updatedAt: new Date('2024-01-01'),
                        state: Promise.resolve(mockState),
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const gA = makeGroupVersion('my-group');
            const gB = makeGroupVersion('my-group');
            populateFacts(store, 'group-a', gA.version, { meta: gA.meta });
            populateFacts(store, 'group-b', gB.version, { meta: gB.meta });
            const deps: DirectDependency[] = [
                makeDep('group-a', [gA.version]),
                makeDep('group-b', [gB.version]),
            ];

            const result = await reconcileIssues(
                deps,
                store,
                defaultConfig,
                testGetLinearIssueSpec,
            );
            expect(result.updated).toBe(1);
            expect(result.created).toBe(0);
        });

        it('closes group issue when all packages are compliant', async () => {
            const mockState = { type: 'unstarted', name: 'Todo' };
            mockClient.issues.mockResolvedValue({
                nodes: [
                    {
                        id: 'issue-1',
                        identifier: 'TEST-50',
                        title: '[Dependicus] Update my-group group (2 packages)',
                        dueDate: '2025-06-01',
                        updatedAt: new Date('2024-01-01'),
                        state: Promise.resolve(mockState),
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            mockClient.issue.mockResolvedValue({
                team: Promise.resolve({
                    states: () =>
                        Promise.resolve({
                            nodes: [{ id: 'done-state', type: 'completed', name: 'Done' }],
                        }),
                }),
            });

            // No packages in the group are outdated
            const deps: DirectDependency[] = [];

            const result = await reconcileIssues(
                deps,
                store,
                defaultConfig,
                testGetLinearIssueSpec,
            );
            expect(result.closed).toBe(1);
        });

        it('does not create group issue when allowNewIssues is false', async () => {
            const gA = makeGroupVersion('my-group');
            const gB = makeGroupVersion('my-group');
            populateFacts(store, 'group-a', gA.version, { meta: gA.meta });
            populateFacts(store, 'group-b', gB.version, { meta: gB.meta });
            const deps: DirectDependency[] = [
                makeDep('group-a', [gA.version]),
                makeDep('group-b', [gB.version]),
            ];

            const result = await reconcileIssues(
                deps,
                store,
                { ...defaultConfig, allowNewIssues: false },
                testGetLinearIssueSpec,
            );
            expect(result.created).toBe(0);
        });
    });

    describe('partial SLA handling', () => {
        // Partial SLA: plugin pre-computes compliance targeting within-major for minor/patch,
        // and returns targetVersion + availableMajorVersion as appropriate.

        it('targets latest within major when major has no SLA threshold', async () => {
            const v = makeVersion({
                version: '1.0.0',
                latestVersion: '2.0.0',
            });
            const vb: PackageVersionInfo[] = [
                {
                    version: '1.1.0',
                    publishDate: '2024-03-01',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/partial-pkg/v/1.1.0',
                },
                {
                    version: '1.2.0',
                    publishDate: '2024-05-01',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/partial-pkg/v/1.2.0',
                },
                {
                    version: '2.0.0',
                    publishDate: '2024-06-01',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/partial-pkg/v/2.0.0',
                },
            ];
            populateFacts(store, 'partial-pkg', v, { versionsBetween: vb });
            const deps: DirectDependency[] = [makeDep('partial-pkg', [v])];

            // Plugin pre-computes: target 1.2.0 (within major), minor compliance
            const partialSlaGetLinearIssueSpec = (
                context: VersionContext,
                s: FactStore,
            ): LinearIssueSpec | undefined => {
                const m = s.getDependencyFact<TestMeta>(context.name, 'testMeta');
                if (!m || m.notificationOptOut) return undefined;
                return {
                    policy: { type: 'dueDate' },
                    daysOverdue: 30,
                    thresholdDays: 180,
                    targetVersion: '1.2.0',
                    availableMajorVersion: '2.0.0',
                    assignment: { type: 'delegate', assigneeId: 'agent-123' },
                    teamId: 'linear-team-123',
                    ownerLabel: `${m.surfaceId} (${m.teamName})`,
                };
            };

            const config = { ...defaultConfig, dryRun: false };
            const result = await reconcileIssues(deps, store, config, partialSlaGetLinearIssueSpec);
            expect(result.created).toBe(1);
            // The issue title should target the latest within current major (1.2.0), not 2.0.0
            const createCall = mockClient.createIssue.mock.calls[0]![0];
            expect(createCall.title).toContain('1.2.0');
        });

        it('creates FYI issue when only major update available and no minor/patch within major', async () => {
            const v = makeVersion({
                version: '1.0.0',
                latestVersion: '2.0.0',
            });
            const vb: PackageVersionInfo[] = [
                {
                    version: '2.0.0',
                    publishDate: '2024-06-01',
                    isPrerelease: false,
                    registryUrl: 'https://www.npmjs.com/package/major-only-pkg/v/2.0.0',
                },
            ];
            populateFacts(store, 'major-only-pkg', v, { versionsBetween: vb });
            const deps: DirectDependency[] = [makeDep('major-only-pkg', [v])];

            // Plugin pre-computes: only major available, no SLA threshold -> FYI
            const majorOnlyGetLinearIssueSpec = (
                context: VersionContext,
                s: FactStore,
            ): LinearIssueSpec | undefined => {
                const m = s.getDependencyFact<TestMeta>(context.name, 'testMeta');
                if (!m || m.notificationOptOut) return undefined;
                return {
                    policy: { type: 'dueDate' },
                    targetVersion: '2.0.0',
                    assignment: { type: 'delegate', assigneeId: 'agent-123' },
                    teamId: 'linear-team-123',
                    ownerLabel: `${m.surfaceId} (${m.teamName})`,
                };
            };

            const config = { ...defaultConfig, dryRun: false };
            const result = await reconcileIssues(deps, store, config, majorOnlyGetLinearIssueSpec);
            expect(result.created).toBe(1);
            // FYI issue should not have a due date
            const createCall = mockClient.createIssue.mock.calls[0]![0];
            expect(createCall.dueDate).toBeUndefined();
        });
    });

    it('handles empty dependencies list', async () => {
        const deps: DirectDependency[] = [];
        const result = await reconcileIssues(deps, store, defaultConfig, testGetLinearIssueSpec);
        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);
        expect(result.closed).toBe(0);
        expect(result.closedDuplicates).toBe(0);
    });

    it('handles duplicate close failure gracefully', async () => {
        const mockState = { type: 'unstarted', name: 'Todo' };
        mockClient.issues.mockResolvedValue({
            nodes: [
                {
                    id: 'issue-1',
                    identifier: 'TEST-50',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-01'),
                    state: Promise.resolve(mockState),
                },
                {
                    id: 'issue-2',
                    identifier: 'TEST-51',
                    title: '[Dependicus] Update test-pkg from 1.0.0 to 2.0.0',
                    dueDate: '2025-06-01',
                    updatedAt: new Date('2024-01-02'),
                    state: Promise.resolve(mockState),
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: undefined },
        });

        // closeTicket will fail for the duplicate (need non-dry-run for it to call the client)
        mockClient.issue.mockRejectedValue(new Error('API error'));

        const v = makeVersion();
        populateFacts(store, 'test-pkg', v);
        const deps: DirectDependency[] = [makeDep('test-pkg', [v])];

        const config = { ...defaultConfig, dryRun: false };
        // Should not throw — failure to close duplicate is logged but non-fatal
        const result = await reconcileIssues(deps, store, config, testGetLinearIssueSpec);
        // closedDuplicates should be 0 since the close failed
        expect(result.closedDuplicates).toBe(0);
    });
});
