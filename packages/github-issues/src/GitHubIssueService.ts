import { Octokit } from '@octokit/rest';
import { extractDependencyNameFromTitle, extractGroupNameFromTitle } from '@dependicus/core';

const DEPENDICUS_LABEL_NAME = 'dependicus';
const TITLE_PREFIX = '[Dependicus]';

export interface DependicusIssue {
    /** GitHub issue number */
    number: number;
    title: string;
    /**
     * For single-dependency issues: the dependency name (e.g., "react")
     * For group issues: the group name (e.g., "sentry")
     */
    dependencyName: string;
    /**
     * True if this issue is for a group of dependencies rather than a single dependency.
     */
    isGroup: boolean;
    /** ISO date string when the issue was last updated */
    updatedAt: string;
}

export interface CreateIssueParams {
    dependencyName: string;
    title: string;
    owner: string;
    repo: string;
    description: string;
    /** Additional labels beyond "dependicus" */
    labels?: string[];
    /** GitHub usernames to assign */
    assignees?: string[];
}

export class GitHubIssueService {
    private octokit: Octokit;
    private labelEnsured = new Set<string>();
    private dryRun: boolean;

    constructor(token: string, options?: { dryRun?: boolean }) {
        if (!token) {
            throw new Error('GITHUB_TOKEN is required');
        }
        this.octokit = new Octokit({ auth: token });
        this.dryRun = options?.dryRun ?? false;
    }

    /**
     * Ensure the "dependicus" label exists on a repo. Creates it if missing.
     * Caches per owner/repo to avoid redundant API calls.
     */
    async ensureLabel(owner: string, repo: string): Promise<void> {
        const key = `${owner}/${repo}`;
        if (this.labelEnsured.has(key)) {
            return;
        }

        try {
            await this.octokit.issues.getLabel({ owner, repo, name: DEPENDICUS_LABEL_NAME });
        } catch (error: unknown) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                await this.octokit.issues.createLabel({
                    owner,
                    repo,
                    name: DEPENDICUS_LABEL_NAME,
                    color: '6B7280',
                    description: 'Managed by Dependicus',
                });
            } else {
                throw error;
            }
        }

        this.labelEnsured.add(key);
    }

    /**
     * Search for all open Dependicus issues in a repo.
     * Filters by the "dependicus" label and state=open.
     * Handles pagination to ensure ALL issues are fetched.
     */
    async searchDependicusIssues(
        owner: string,
        repo: string,
        onProgress?: (fetched: number, page: number) => void,
    ): Promise<DependicusIssue[]> {
        await this.ensureLabel(owner, repo);

        const issues: DependicusIssue[] = [];
        let page = 1;

        while (true) {
            const response = await this.octokit.issues.listForRepo({
                owner,
                repo,
                labels: DEPENDICUS_LABEL_NAME,
                state: 'open',
                per_page: 100,
                page,
            });

            for (const issue of response.data) {
                // Skip pull requests (GitHub API returns PRs in issues endpoint)
                if (issue.pull_request) continue;

                const groupName = extractGroupNameFromTitle(issue.title);
                const dependencyName = groupName ?? extractDependencyNameFromTitle(issue.title);
                if (!dependencyName) continue;

                issues.push({
                    number: issue.number,
                    title: issue.title,
                    dependencyName,
                    isGroup: groupName !== undefined,
                    updatedAt: issue.updated_at,
                });
            }

            if (onProgress) {
                onProgress(issues.length, page);
            }

            if (response.data.length < 100) break;
            page++;
        }

        return issues;
    }

    /**
     * Create a new Dependicus issue.
     * Returns the issue number or -1 in dry-run mode.
     */
    async createIssue(params: CreateIssueParams): Promise<number> {
        const { dependencyName, title, owner, repo, description, labels, assignees } = params;

        if (this.dryRun) {
            process.stderr.write('\n');
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`[DRY RUN] Would CREATE issue for ${dependencyName}\n`);
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`\nTitle: ${TITLE_PREFIX} ${title}\n\n`);
            process.stderr.write(`Description:\n${description}\n`);
            if (assignees?.length) {
                process.stderr.write(`\nAssignees: ${assignees.join(', ')}\n`);
            }
            if (labels?.length) {
                process.stderr.write(`\nExtra labels: ${labels.join(', ')}\n`);
            }
            process.stderr.write('\n' + '='.repeat(80) + '\n');
            return -1;
        }

        await this.ensureLabel(owner, repo);

        const allLabels = [DEPENDICUS_LABEL_NAME, ...(labels ?? [])];

        const response = await this.octokit.issues.create({
            owner,
            repo,
            title: `${TITLE_PREFIX} ${title}`,
            body: description,
            labels: allLabels,
            ...(assignees?.length ? { assignees } : {}),
        });

        return response.data.number;
    }

    /**
     * Update an existing issue's title and description.
     */
    async updateIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        params: { title: string; description: string },
    ): Promise<void> {
        if (this.dryRun) {
            process.stderr.write('\n');
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`[DRY RUN] Would UPDATE issue #${issueNumber}\n`);
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`\nTitle: ${TITLE_PREFIX} ${params.title}\n\n`);
            process.stderr.write(`Description:\n${params.description}\n`);
            process.stderr.write('\n' + '='.repeat(80) + '\n');
            return;
        }

        await this.octokit.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            title: `${TITLE_PREFIX} ${params.title}`,
            body: params.description,
        });
    }

    /**
     * Create a comment on an issue.
     */
    async createComment(
        owner: string,
        repo: string,
        issueNumber: number,
        body: string,
    ): Promise<void> {
        if (this.dryRun) {
            process.stderr.write(`\n[DRY RUN] Would add comment to #${issueNumber}:\n${body}\n`);
            return;
        }

        await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body,
        });
    }

    /**
     * Close an issue.
     */
    async closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
        if (this.dryRun) {
            process.stderr.write(`[DRY RUN] Would close issue #${issueNumber}\n`);
            return;
        }

        await this.octokit.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            state: 'closed',
        });
    }
}
