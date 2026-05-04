import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinearService } from './LinearService';

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

describe('LinearService', () => {
    let service: LinearService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new LinearService('test-api-key');
    });

    describe('ensureLabel', () => {
        it('returns existing label id', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });

            const labelId = await service.ensureLabel();
            expect(labelId).toBe('label-123');
        });

        it('creates label if it does not exist', async () => {
            mockClient.issueLabels.mockResolvedValue({ nodes: [] });
            mockClient.createIssueLabel.mockResolvedValue({
                issueLabel: Promise.resolve({ id: 'new-label-456' }),
            });

            const labelId = await service.ensureLabel();
            expect(labelId).toBe('new-label-456');
            expect(mockClient.createIssueLabel).toHaveBeenCalledWith({
                name: 'Dependicus',
                color: '#6B7280',
            });
        });

        it('caches label id after first call', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });

            await service.ensureLabel();
            await service.ensureLabel();

            expect(mockClient.issueLabels).toHaveBeenCalledTimes(1);
        });
    });

    describe('searchDependicusIssues', () => {
        it('fetches and parses issues with pagination', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });

            const mockState = { type: 'unstarted', name: 'Todo' };
            mockClient.issues.mockResolvedValue({
                nodes: [
                    {
                        id: 'issue-1',
                        identifier: 'CORE-100',
                        title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                        dueDate: '2025-06-01',
                        updatedAt: new Date('2025-01-15'),
                        state: Promise.resolve(mockState),
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const issues = await service.searchDependicusIssues();
            expect(issues).toHaveLength(1);
            expect(issues[0]).toEqual({
                id: 'issue-1',
                identifier: 'CORE-100',
                title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                dependencyName: 'react',
                isGroup: false,
                dueDate: '2025-06-01',
                updatedAt: '2025-01-15T00:00:00.000Z',
                state: { type: 'unstarted', name: 'Todo' },
            });
        });

        it('calls onProgress callback', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });

            mockClient.issues.mockResolvedValue({
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const onProgress = vi.fn();
            await service.searchDependicusIssues(onProgress);
            expect(onProgress).toHaveBeenCalledWith(0, 1);
        });
    });

    describe('createIssue', () => {
        it('creates an issue with correct params', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            mockClient.createIssue.mockResolvedValue({
                issue: Promise.resolve({ id: 'issue-uuid-200', identifier: 'CORE-200' }),
            });

            const result = await service.createIssue({
                dependencyName: 'react',
                title: 'Update react from 18.2.0 to 19.0.0',
                teamId: 'team-1',
                description: 'Test description',
                dueDate: new Date('2025-06-01'),
            });

            expect(result).toEqual({ id: 'issue-uuid-200', identifier: 'CORE-200' });
            expect(mockClient.createIssue).toHaveBeenCalledWith({
                teamId: 'team-1',
                title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                description: 'Test description',
                labelIds: ['label-123'],
                dueDate: '2025-06-01',
            });
        });
    });

    describe('updateIssue', () => {
        it('updates title, description, and due date', async () => {
            await service.updateIssue('issue-1', {
                title: 'Update react from 18.2.0 to 19.1.0',
                description: 'Updated description',
                dueDate: new Date('2025-07-01'),
            });

            expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', {
                title: '[Dependicus] Update react from 18.2.0 to 19.1.0',
                description: 'Updated description',
                dueDate: '2025-07-01',
            });
        });

        it('sets dueDate to null when not provided', async () => {
            await service.updateIssue('issue-1', {
                title: 'Update react',
                description: 'desc',
            });

            expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', {
                title: '[Dependicus] Update react',
                description: 'desc',
                dueDate: null,
            });
        });
    });

    describe('closeIssue', () => {
        it('closes an issue by finding completed state', async () => {
            mockClient.issue.mockResolvedValue({
                team: Promise.resolve({
                    states: () =>
                        Promise.resolve({
                            nodes: [
                                { id: 'state-1', type: 'completed', name: 'Done' },
                                { id: 'state-2', type: 'unstarted', name: 'Todo' },
                            ],
                        }),
                }),
            });

            await service.closeIssue('issue-1');

            expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', {
                stateId: 'state-1',
            });
        });

        it('throws if no completed state found', async () => {
            mockClient.issue.mockResolvedValue({
                team: Promise.resolve({
                    states: () =>
                        Promise.resolve({
                            nodes: [{ id: 'state-2', type: 'unstarted', name: 'Todo' }],
                        }),
                }),
            });

            await expect(service.closeIssue('issue-1')).rejects.toThrow('no completed state found');
        });
    });

    describe('createComment', () => {
        it('creates a comment on an issue', async () => {
            await service.createComment('issue-1', 'New version available');

            expect(mockClient.createComment).toHaveBeenCalledWith({
                issueId: 'issue-1',
                body: 'New version available',
            });
        });
    });

    describe('updateIssueDueDate', () => {
        it('updates the due date on an issue', async () => {
            await service.updateIssueDueDate('issue-1', new Date('2025-09-15'));

            expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', {
                dueDate: '2025-09-15',
            });
        });
    });

    describe('ensureLabel edge cases', () => {
        it('throws when label creation fails', async () => {
            mockClient.issueLabels.mockResolvedValue({ nodes: [] });
            mockClient.createIssueLabel.mockResolvedValue({
                issueLabel: Promise.resolve(undefined),
            });

            await expect(service.ensureLabel()).rejects.toThrow(
                'Failed to create Dependicus label',
            );
        });
    });

    describe('createIssue edge cases', () => {
        it('throws when issue creation fails', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            mockClient.createIssue.mockResolvedValue({
                issue: Promise.resolve(undefined),
            });

            await expect(
                service.createIssue({
                    dependencyName: 'react',
                    title: 'Update react',
                    teamId: 'team-1',
                    description: 'desc',
                }),
            ).rejects.toThrow('Failed to create issue for react');
        });

        it('includes projectId when provided', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            mockClient.createIssue.mockResolvedValue({
                issue: Promise.resolve({ id: 'issue-uuid-300', identifier: 'CORE-300' }),
            });

            await service.createIssue({
                dependencyName: 'react',
                title: 'Update react',
                teamId: 'team-1',
                projectId: 'project-1',
                description: 'desc',
                dueDate: new Date('2025-06-01'),
            });

            expect(mockClient.createIssue).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectId: 'project-1',
                }),
            );
        });

        it('includes delegateId when provided', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            mockClient.createIssue.mockResolvedValue({
                issue: Promise.resolve({ id: 'issue-uuid-300', identifier: 'CORE-300' }),
            });

            await service.createIssue({
                dependencyName: 'react',
                title: 'Update react',
                teamId: 'team-1',
                description: 'desc',
                delegateId: 'agent-1',
            });

            expect(mockClient.createIssue).toHaveBeenCalledWith(
                expect.objectContaining({
                    delegateId: 'agent-1',
                }),
            );
        });
    });

    describe('findClosedIssue', () => {
        it('returns issue when title matches exactly', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            const closedState = { type: 'completed', name: 'Done' };
            mockClient.issues.mockResolvedValue({
                nodes: [
                    {
                        id: 'issue-uuid-1',
                        identifier: 'TEST-50',
                        title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                        dueDate: undefined,
                        updatedAt: new Date('2024-06-01'),
                        state: Promise.resolve(closedState),
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const result = await service.findClosedIssue(
                'react',
                '[Dependicus] Update react from 18.2.0 to 19.0.0',
            );
            expect(result).toBeDefined();
            expect(result!.id).toBe('issue-uuid-1');
            expect(result!.dependencyName).toBe('react');
        });

        it('returns undefined when title does not match', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            mockClient.issues.mockResolvedValue({
                nodes: [
                    {
                        id: 'issue-uuid-1',
                        identifier: 'TEST-50',
                        title: '[Dependicus] Update react from 18.2.0 to 18.3.0',
                        dueDate: undefined,
                        updatedAt: new Date('2024-06-01'),
                        state: Promise.resolve({ type: 'completed', name: 'Done' }),
                    },
                ],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const result = await service.findClosedIssue(
                'react',
                '[Dependicus] Update react from 18.2.0 to 19.0.0',
            );
            expect(result).toBeUndefined();
        });

        it('returns undefined when no closed issues exist', async () => {
            mockClient.issueLabels.mockResolvedValue({
                nodes: [{ id: 'label-123', name: 'Dependicus' }],
            });
            mockClient.issues.mockResolvedValue({
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: undefined },
            });

            const result = await service.findClosedIssue(
                'react',
                '[Dependicus] Update react from 18.2.0 to 19.0.0',
            );
            expect(result).toBeUndefined();
        });
    });

    describe('reopenIssue', () => {
        it('sets state to backlog and updates title/description', async () => {
            const backlogState = { id: 'backlog-state', type: 'backlog', name: 'Backlog' };
            mockClient.issue.mockResolvedValue({
                team: Promise.resolve({
                    states: () => Promise.resolve({ nodes: [backlogState] }),
                }),
            });

            await service.reopenIssue('issue-1', {
                title: 'Update react from 18.2.0 to 19.0.0',
                description: 'Updated description',
                dueDate: new Date('2025-06-01'),
            });

            expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-1', {
                stateId: 'backlog-state',
                title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                description: 'Updated description',
                dueDate: '2025-06-01',
            });
        });

        it('throws when no team found', async () => {
            mockClient.issue.mockResolvedValue({
                team: Promise.resolve(undefined),
            });

            await expect(
                service.reopenIssue('issue-1', { title: 'x', description: 'y' }),
            ).rejects.toThrow('no team found');
        });

        it('throws when no backlog/unstarted state found', async () => {
            mockClient.issue.mockResolvedValue({
                team: Promise.resolve({
                    states: () =>
                        Promise.resolve({
                            nodes: [{ id: 'done-state', type: 'completed', name: 'Done' }],
                        }),
                }),
            });

            await expect(
                service.reopenIssue('issue-1', { title: 'x', description: 'y' }),
            ).rejects.toThrow('no backlog/unstarted state found');
        });
    });

    describe('closeIssue edge cases', () => {
        it('throws when no team found', async () => {
            mockClient.issue.mockResolvedValue({
                team: Promise.resolve(undefined),
            });

            await expect(service.closeIssue('issue-1')).rejects.toThrow('no team found');
        });
    });

    describe('dry-run mode', () => {
        let dryRunService: LinearService;

        beforeEach(() => {
            dryRunService = new LinearService('test-api-key', { dryRun: true });
        });

        it('createIssue returns DRY-RUN without calling API', async () => {
            const result = await dryRunService.createIssue({
                dependencyName: 'react',
                title: 'Update react',
                teamId: 'team-1',
                description: 'desc',
            });

            expect(result).toEqual({ id: 'DRY-RUN', identifier: 'DRY-RUN' });
            expect(mockClient.createIssue).not.toHaveBeenCalled();
        });

        it('updateIssue does not call API', async () => {
            await dryRunService.updateIssue('issue-1', {
                title: 'Update react',
                description: 'desc',
            });

            expect(mockClient.updateIssue).not.toHaveBeenCalled();
        });

        it('closeIssue does not call API', async () => {
            await dryRunService.closeIssue('issue-1');

            expect(mockClient.issue).not.toHaveBeenCalled();
            expect(mockClient.updateIssue).not.toHaveBeenCalled();
        });

        it('createComment does not call API', async () => {
            await dryRunService.createComment('issue-1', 'test comment');

            expect(mockClient.createComment).not.toHaveBeenCalled();
        });
    });
});
