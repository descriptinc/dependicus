import { Octokit } from '@octokit/rest';
import { extractDependencyNameFromTitle, extractGroupNameFromTitle } from '../core/index';

const DEPENDICUS_LABEL_NAME = 'dependicus';
const TITLE_PREFIX = '[Dependicus]';

export interface DependicusIssue {
    /** GitHub issue number */
    number: number;
    title: string;
    /** Issue body (markdown description) */
    body: string;
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
     * Search for all open Dependicus items in a repo.
     * Filters by the "dependicus" label and state=open.
     * Handles pagination to ensure ALL items are fetched.
     *
     * GitHub's issues endpoint returns both issues and pull requests when
     * filtered by label. Issues are always included; pull requests are
     * included only when they are ready for review (drafts are skipped) so
     * that downstream consumers — including bots that yell about the open
     * count — don't get noise from in-progress work.
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
                // GitHub returns PRs in the issues endpoint. Skip draft PRs;
                // ready-to-review PRs and regular issues are both included.
                if (issue.pull_request && issue.draft) continue;

                const groupName = extractGroupNameFromTitle(issue.title);
                const dependencyName = groupName ?? extractDependencyNameFromTitle(issue.title);
                if (!dependencyName) continue;

                issues.push({
                    number: issue.number,
                    title: issue.title,
                    body: issue.body ?? '',
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
     * Find a closed Dependicus issue with an exactly matching title.
     * Uses the GitHub search API with the dependency name as a pre-filter,
     * then verifies the full title locally.
     *
     * Returns the matching issue, or undefined if none found.
     */
    async findClosedIssue(
        owner: string,
        repo: string,
        dependencyName: string,
        fullTitle: string,
    ): Promise<DependicusIssue | undefined> {
        const response = await this.octokit.search.issuesAndPullRequests({
            q: `repo:${owner}/${repo} label:${DEPENDICUS_LABEL_NAME} is:closed "${dependencyName}" in:title`,
            per_page: 10,
            sort: 'updated',
            order: 'desc',
        });

        for (const item of response.data.items) {
            if (item.pull_request) continue;
            if (item.title !== fullTitle) continue;

            const groupName = extractGroupNameFromTitle(item.title);
            const extractedName = groupName ?? extractDependencyNameFromTitle(item.title);
            if (!extractedName) continue;

            return {
                number: item.number,
                title: item.title,
                body: item.body ?? '',
                dependencyName: extractedName,
                isGroup: groupName !== undefined,
                updatedAt: item.updated_at,
            };
        }

        return undefined;
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
     * Reopen a closed issue and update its title and description.
     */
    async reopenIssue(
        owner: string,
        repo: string,
        issueNumber: number,
        params: { title: string; description: string },
    ): Promise<void> {
        if (this.dryRun) {
            process.stderr.write('\n');
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`[DRY RUN] Would REOPEN issue #${issueNumber}\n`);
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
            state: 'open',
            title: `${TITLE_PREFIX} ${params.title}`,
            body: params.description,
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
