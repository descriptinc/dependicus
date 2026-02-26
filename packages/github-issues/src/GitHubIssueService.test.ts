import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubIssueService } from './GitHubIssueService';

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

describe('GitHubIssueService', () => {
    let service: GitHubIssueService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubIssueService('test-token');
    });

    describe('ensureLabel', () => {
        it('does nothing when label already exists', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            await service.ensureLabel('owner', 'repo');
            expect(mockOctokit.issues.getLabel).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                name: 'dependicus',
            });
            expect(mockOctokit.issues.createLabel).not.toHaveBeenCalled();
        });

        it('creates label if it does not exist', async () => {
            mockOctokit.issues.getLabel.mockRejectedValue({ status: 404 });
            mockOctokit.issues.createLabel.mockResolvedValue({});

            await service.ensureLabel('owner', 'repo');
            expect(mockOctokit.issues.createLabel).toHaveBeenCalledWith({
                owner: 'owner',
                repo: 'repo',
                name: 'dependicus',
                color: '6B7280',
                description: 'Managed by Dependicus',
            });
        });

        it('caches label per owner/repo after first call', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            await service.ensureLabel('owner', 'repo');
            await service.ensureLabel('owner', 'repo');

            expect(mockOctokit.issues.getLabel).toHaveBeenCalledTimes(1);
        });

        it('checks separately for different repos', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            await service.ensureLabel('owner', 'repo1');
            await service.ensureLabel('owner', 'repo2');

            expect(mockOctokit.issues.getLabel).toHaveBeenCalledTimes(2);
        });
    });

    describe('searchDependicusIssues', () => {
        it('fetches and parses issues', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            mockOctokit.issues.listForRepo.mockResolvedValue({
                data: [
                    {
                        number: 42,
                        title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                        updated_at: '2025-01-15T00:00:00Z',
                    },
                ],
            });

            const issues = await service.searchDependicusIssues('owner', 'repo');
            expect(issues).toHaveLength(1);
            expect(issues[0]).toEqual({
                number: 42,
                title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                packageName: 'react',
                isGroup: false,
                updatedAt: '2025-01-15T00:00:00Z',
            });
        });

        it('skips pull requests', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            mockOctokit.issues.listForRepo.mockResolvedValue({
                data: [
                    {
                        number: 42,
                        title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                        updated_at: '2025-01-15T00:00:00Z',
                        pull_request: { url: 'https://...' },
                    },
                ],
            });

            const issues = await service.searchDependicusIssues('owner', 'repo');
            expect(issues).toHaveLength(0);
        });

        it('calls onProgress callback', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            mockOctokit.issues.listForRepo.mockResolvedValue({ data: [] });

            const onProgress = vi.fn();
            await service.searchDependicusIssues('owner', 'repo', onProgress);
            expect(onProgress).toHaveBeenCalledWith(0, 1);
        });

        it('paginates when page is full', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            const page1 = Array.from({ length: 100 }, (_, i) => ({
                number: i + 1,
                title: `[Dependicus] Update pkg-${i} from 1.0.0 to 2.0.0`,
                updated_at: '2025-01-15T00:00:00Z',
            }));

            const page2 = [
                {
                    number: 101,
                    title: '[Dependicus] Update pkg-100 from 1.0.0 to 2.0.0',
                    updated_at: '2025-01-15T00:00:00Z',
                },
            ];

            mockOctokit.issues.listForRepo
                .mockResolvedValueOnce({ data: page1 })
                .mockResolvedValueOnce({ data: page2 });

            const issues = await service.searchDependicusIssues('owner', 'repo');
            expect(issues).toHaveLength(101);
            expect(mockOctokit.issues.listForRepo).toHaveBeenCalledTimes(2);
        });

        it('recognizes group issues', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });

            mockOctokit.issues.listForRepo.mockResolvedValue({
                data: [
                    {
                        number: 42,
                        title: '[Dependicus] Update sentry group (3 packages)',
                        updated_at: '2025-01-15T00:00:00Z',
                    },
                ],
            });

            const issues = await service.searchDependicusIssues('owner', 'repo');
            expect(issues).toHaveLength(1);
            expect(issues[0]!.packageName).toBe('sentry');
            expect(issues[0]!.isGroup).toBe(true);
        });
    });

    describe('createIssue', () => {
        it('creates an issue with correct params', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });
            mockOctokit.issues.create.mockResolvedValue({ data: { number: 42 } });

            const issueNumber = await service.createIssue({
                packageName: 'react',
                title: 'Update react from 18.2.0 to 19.0.0',
                owner: 'myorg',
                repo: 'myrepo',
                description: 'Test description',
            });

            expect(issueNumber).toBe(42);
            expect(mockOctokit.issues.create).toHaveBeenCalledWith({
                owner: 'myorg',
                repo: 'myrepo',
                title: '[Dependicus] Update react from 18.2.0 to 19.0.0',
                body: 'Test description',
                labels: ['dependicus'],
            });
        });

        it('includes extra labels and assignees', async () => {
            mockOctokit.issues.getLabel.mockResolvedValue({ data: { name: 'dependicus' } });
            mockOctokit.issues.create.mockResolvedValue({ data: { number: 43 } });

            await service.createIssue({
                packageName: 'react',
                title: 'Update react',
                owner: 'myorg',
                repo: 'myrepo',
                description: 'desc',
                labels: ['frontend', 'urgent'],
                assignees: ['alice', 'bob'],
            });

            expect(mockOctokit.issues.create).toHaveBeenCalledWith({
                owner: 'myorg',
                repo: 'myrepo',
                title: '[Dependicus] Update react',
                body: 'desc',
                labels: ['dependicus', 'frontend', 'urgent'],
                assignees: ['alice', 'bob'],
            });
        });
    });

    describe('updateIssue', () => {
        it('updates title and description', async () => {
            await service.updateIssue('myorg', 'myrepo', 42, {
                title: 'Update react from 18.2.0 to 19.1.0',
                description: 'Updated description',
            });

            expect(mockOctokit.issues.update).toHaveBeenCalledWith({
                owner: 'myorg',
                repo: 'myrepo',
                issue_number: 42,
                title: '[Dependicus] Update react from 18.2.0 to 19.1.0',
                body: 'Updated description',
            });
        });
    });

    describe('closeIssue', () => {
        it('closes an issue by setting state to closed', async () => {
            await service.closeIssue('myorg', 'myrepo', 42);

            expect(mockOctokit.issues.update).toHaveBeenCalledWith({
                owner: 'myorg',
                repo: 'myrepo',
                issue_number: 42,
                state: 'closed',
            });
        });
    });

    describe('createComment', () => {
        it('creates a comment on an issue', async () => {
            await service.createComment('myorg', 'myrepo', 42, 'New version available');

            expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
                owner: 'myorg',
                repo: 'myrepo',
                issue_number: 42,
                body: 'New version available',
            });
        });
    });

    describe('dry-run mode', () => {
        let dryRunService: GitHubIssueService;

        beforeEach(() => {
            dryRunService = new GitHubIssueService('test-token', { dryRun: true });
        });

        it('createIssue returns -1 without calling API', async () => {
            const issueNumber = await dryRunService.createIssue({
                packageName: 'react',
                title: 'Update react',
                owner: 'myorg',
                repo: 'myrepo',
                description: 'desc',
            });

            expect(issueNumber).toBe(-1);
            expect(mockOctokit.issues.create).not.toHaveBeenCalled();
        });

        it('updateIssue does not call API', async () => {
            await dryRunService.updateIssue('myorg', 'myrepo', 42, {
                title: 'Update react',
                description: 'desc',
            });

            expect(mockOctokit.issues.update).not.toHaveBeenCalled();
        });

        it('closeIssue does not call API', async () => {
            await dryRunService.closeIssue('myorg', 'myrepo', 42);

            expect(mockOctokit.issues.update).not.toHaveBeenCalled();
        });

        it('createComment does not call API', async () => {
            await dryRunService.createComment('myorg', 'myrepo', 42, 'test comment');

            expect(mockOctokit.issues.createComment).not.toHaveBeenCalled();
        });
    });
});
