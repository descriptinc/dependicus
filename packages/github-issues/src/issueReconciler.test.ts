import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectDependency, DependencyVersion, PackageVersionInfo } from '@dependicus/core';
import { FactStore, FactKeys } from '@dependicus/core';
import { reconcileGitHubIssues, type IssueReconcilerConfig } from './issueReconciler';
import type { GitHubIssueSpec } from './types';

const mockOctokit = {
    issues: {
        getLabel: vi.fn(),
        createLabel: vi.fn(),
        listForRepo: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        createComment: vi.fn(),
    },
};

// Mock @octokit/rest
vi.mock('@octokit/rest', () => ({
    Octokit: function () {
        return mockOctokit;
    },
}));

const defaultVersionsBetween: PackageVersionInfo[] = [
    {
        version: '1.1.0',
        publishDate: '2024-03-01',
        isPrerelease: false,
        npmUrl: 'https://www.npmjs.com/package/test-pkg/v/1.1.0',
    },
    {
        version: '2.0.0',
        publishDate: '2024-06-01',
        isPrerelease: false,
        npmUrl: 'https://www.npmjs.com/package/test-pkg/v/2.0.0',
    },
];

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

function makeStore(packageName: string = 'test-pkg', version: string = '1.0.0'): FactStore {
    const store = new FactStore();
    store.setVersionFact(packageName, version, FactKeys.VERSIONS_BETWEEN, defaultVersionsBetween);
    store.setVersionFact(packageName, version, FactKeys.DESCRIPTION, 'A test package');
    return store;
}

const baseConfig: IssueReconcilerConfig = {
    githubToken: 'test-token',
    dryRun: false,
    dependicusBaseUrl: 'https://example.com/dependicus',
};

function makeSpec(overrides: Partial<GitHubIssueSpec> = {}): GitHubIssueSpec {
    return {
        owner: 'myorg',
        repo: 'myrepo',
        policy: { type: 'fyi' },
        ...overrides,
    };
}

function setupMocks(
    existingIssues: Array<{ number: number; title: string; updated_at: string }> = [],
) {
    mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });
    mockOctokit.issues.listForRepo.mockResolvedValue({ data: existingIssues });
    mockOctokit.issues.create.mockResolvedValue({ data: { number: 999 } });
    mockOctokit.issues.update.mockResolvedValue({});
    mockOctokit.issues.createComment.mockResolvedValue({});
}

describe('reconcileGitHubIssues', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates issues for outdated packages', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'fyi' } }),
        );

        expect(result.created).toBe(1);
        expect(mockOctokit.issues.create).toHaveBeenCalledTimes(1);
        expect(mockOctokit.issues.create).toHaveBeenCalledWith(
            expect.objectContaining({
                owner: 'myorg',
                repo: 'myrepo',
                labels: ['dependicus'],
            }),
        );
    });

    it('updates existing issues', async () => {
        setupMocks([
            {
                number: 42,
                title: '[Dependicus] FYI: test-pkg 1.0.0 → 2.0.0 (latest: 2.0.0)',
                updated_at: '2024-01-01T00:00:00Z',
            },
        ]);

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'fyi' } }),
        );

        expect(result.updated).toBe(1);
        expect(result.created).toBe(0);
        expect(mockOctokit.issues.update).toHaveBeenCalled();
    });

    it('closes issues for now-compliant packages', async () => {
        setupMocks([
            {
                number: 42,
                title: '[Dependicus] Update old-pkg from 1.0.0 to 2.0.0',
                updated_at: '2024-01-01T00:00:00Z',
            },
        ]);

        // No outdated packages — the existing issue should be closed
        const deps: DirectDependency[] = [];
        const store = new FactStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'fyi' } }),
        );

        // No packages found, so no owner/repo - early return
        expect(result.closed).toBe(0);
    });

    it('skips packages when getGitHubIssueSpec returns undefined', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () => undefined);

        expect(result.created).toBe(0);
        expect(mockOctokit.issues.create).not.toHaveBeenCalled();
    });

    it('skips packages with noTicket policy', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'noTicket' } }),
        );

        expect(result.created).toBe(0);
    });

    it('respects allowNewIssues=false', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(
            deps,
            store,
            { ...baseConfig, allowNewIssues: false },
            () => makeSpec({ policy: { type: 'fyi' } }),
        );

        expect(result.created).toBe(0);
    });

    it('closes duplicate issues', async () => {
        setupMocks([
            {
                number: 42,
                title: '[Dependicus] FYI: test-pkg 1.0.0 → 2.0.0 (latest: 2.0.0)',
                updated_at: '2024-01-01T00:00:00Z',
            },
            {
                number: 43,
                title: '[Dependicus] FYI: test-pkg 1.0.0 → 2.0.0 (latest: 2.0.0)',
                updated_at: '2024-01-02T00:00:00Z',
            },
        ]);

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'fyi' } }),
        );

        expect(result.closedDuplicates).toBe(1);
    });

    it('appends due date to title for dueDate policy', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({
                policy: { type: 'dueDate' },
                daysOverdue: 10,
                thresholdDays: 360,
            }),
        );

        expect(result.created).toBe(1);
        const createCall = mockOctokit.issues.create.mock.calls[0]![0];
        expect(createCall.title).toContain('(due ');
    });

    it('includes assignees when assignment is assign type', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({
                policy: { type: 'fyi' },
                assignment: { type: 'assign', assignees: ['alice'] },
            }),
        );

        expect(result.created).toBe(1);
        expect(mockOctokit.issues.create).toHaveBeenCalledWith(
            expect.objectContaining({
                assignees: ['alice'],
            }),
        );
    });

    it('handles grouped packages', async () => {
        setupMocks();

        const deps: DirectDependency[] = [
            { packageName: 'pkg-a', versions: [makeVersion()] },
            { packageName: 'pkg-b', versions: [makeVersion()] },
        ];
        const store = makeStore('pkg-a');
        store.setVersionFact('pkg-b', '1.0.0', FactKeys.VERSIONS_BETWEEN, defaultVersionsBetween);
        store.setVersionFact('pkg-b', '1.0.0', FactKeys.DESCRIPTION, 'Package B');

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'fyi' }, group: 'test-group' }),
        );

        expect(result.created).toBe(1);
        const createCall = mockOctokit.issues.create.mock.calls[0]![0];
        expect(createCall.title).toContain('group');
    });

    it('dry-run mode does not call create/update APIs', async () => {
        setupMocks();

        const deps: DirectDependency[] = [{ packageName: 'test-pkg', versions: [makeVersion()] }];
        const store = makeStore();

        const result = await reconcileGitHubIssues(
            deps,
            store,
            { ...baseConfig, dryRun: true },
            () => makeSpec({ policy: { type: 'fyi' } }),
        );

        expect(result.created).toBe(1);
        expect(mockOctokit.issues.create).not.toHaveBeenCalled();
    });

    it('returns zeros when no outdated packages', async () => {
        setupMocks();

        const deps: DirectDependency[] = [
            {
                packageName: 'test-pkg',
                versions: [makeVersion({ version: '2.0.0', latestVersion: '2.0.0' })],
            },
        ];
        const store = new FactStore();

        const result = await reconcileGitHubIssues(deps, store, baseConfig, () =>
            makeSpec({ policy: { type: 'fyi' } }),
        );

        expect(result).toEqual({ created: 0, updated: 0, closed: 0, closedDuplicates: 0 });
    });
});
