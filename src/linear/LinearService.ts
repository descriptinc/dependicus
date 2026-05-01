import { LinearClient, LinearDocument } from '@linear/sdk';
import { extractDependencyNameFromTitle, extractGroupNameFromTitle } from '../core/index';

type IssueCreateInput = LinearDocument.IssueCreateInput;

const DEPENDICUS_LABEL_NAME = 'Dependicus';
const TITLE_PREFIX = '[Dependicus]';

export interface DependicusIssue {
    id: string;
    identifier: string; // e.g., "CORE-123"
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
    dueDate: string | undefined;
    /** ISO date string when the issue was last updated */
    updatedAt: string;
    state: {
        type: string; // 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
        name: string | undefined; // e.g., "PR", "Verify", "In Progress"
    };
}

export interface CreateIssueParams {
    dependencyName: string;
    title: string;
    teamId: string;
    /** Optional - if omitted, issue is created without a project (just team + label) */
    projectId?: string;
    /** Optional - notifications-only packages don't have due dates */
    dueDate?: Date;
    description: string;
    /** Optional - delegate to a Linear user or bot for automatic handling */
    delegateId?: string;
}

export class LinearService {
    private client: LinearClient;
    private labelId: string | undefined;
    private dryRun: boolean;

    constructor(apiKey: string, options?: { dryRun?: boolean }) {
        if (!apiKey) {
            throw new Error('LINEAR_API_KEY is required');
        }
        this.client = new LinearClient({ apiKey });
        this.dryRun = options?.dryRun ?? false;
    }

    /**
     * Get or create the "Dependicus" label (workspace-level).
     */
    async ensureLabel(): Promise<string> {
        if (this.labelId) {
            return this.labelId;
        }

        // Search for existing label
        const labels = await this.client.issueLabels({
            filter: { name: { eq: DEPENDICUS_LABEL_NAME } },
        });

        const existingLabel = labels.nodes.find(
            (l) => l.name.toLowerCase() === DEPENDICUS_LABEL_NAME.toLowerCase(),
        );

        if (existingLabel) {
            this.labelId = existingLabel.id;
            return this.labelId;
        }

        // Create new label
        const result = await this.client.createIssueLabel({
            name: DEPENDICUS_LABEL_NAME,
            color: '#6B7280', // gray
        });

        const newLabel = await result.issueLabel;
        if (!newLabel) {
            throw new Error('Failed to create Dependicus label');
        }

        this.labelId = newLabel.id;
        return this.labelId;
    }

    /**
     * Search for all open Dependicus issues across all teams.
     * Finds issues by the Dependicus label (no project filter).
     * Handles pagination to ensure ALL issues are fetched.
     *
     * @param onProgress - Optional callback to report progress during pagination
     */
    async searchDependicusIssues(
        onProgress?: (fetched: number, page: number) => void,
    ): Promise<DependicusIssue[]> {
        const labelId = await this.ensureLabel();

        const existingIssues: DependicusIssue[] = [];
        let hasNextPage = true;
        let afterCursor: string | undefined;
        let pageNumber = 0;

        // Paginate through all issues with the Dependicus label
        // Include issues in all non-closed states (including PR/Verify) to avoid creating
        // duplicates when issues are in progress
        while (hasNextPage) {
            pageNumber++;
            const issues = await this.client.issues({
                filter: {
                    labels: { id: { eq: labelId } },
                    state: {
                        type: { nin: ['completed', 'canceled'] },
                    },
                },
                first: 100, // Max page size for efficiency
                after: afterCursor,
            });

            for (const issue of issues.nodes) {
                // Try to extract group name first, then fall back to package name
                const groupName = extractGroupNameFromTitle(issue.title);
                const dependencyName = groupName ?? extractDependencyNameFromTitle(issue.title);
                if (!dependencyName) continue;

                const state = await issue.state;

                existingIssues.push({
                    id: issue.id,
                    identifier: issue.identifier,
                    title: issue.title,
                    dependencyName,
                    isGroup: groupName !== undefined,
                    dueDate: issue.dueDate ?? undefined,
                    updatedAt: issue.updatedAt.toISOString(),
                    state: {
                        type: state?.type ?? 'backlog',
                        name: state?.name,
                    },
                });
            }

            // Report progress if callback provided
            if (onProgress) {
                onProgress(existingIssues.length, pageNumber);
            }

            hasNextPage = issues.pageInfo.hasNextPage;
            afterCursor = issues.pageInfo.endCursor ?? undefined;
        }

        return existingIssues;
    }

    /**
     * Create a new Dependicus issue.
     * Returns the issue identifier (e.g., "ENG-1234") or "DRY-RUN" in dry-run mode.
     */
    async createIssue(params: CreateIssueParams): Promise<string> {
        const { dependencyName, title, teamId, projectId, dueDate, description, delegateId } =
            params;

        if (this.dryRun) {
            process.stderr.write('\n');
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`[DRY RUN] Would CREATE issue for ${dependencyName}\n`);
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`\nTitle: ${TITLE_PREFIX} ${title}\n\n`);
            process.stderr.write(`Description:\n${description}\n`);
            if (dueDate) {
                process.stderr.write(`\nDue Date: ${dueDate.toISOString().split('T')[0]}\n`);
            } else {
                process.stderr.write(`\nDue Date: (none - notifications only)\n`);
            }
            if (delegateId) {
                process.stderr.write(`\nDelegate: ${delegateId}\n`);
            }
            process.stderr.write('\n' + '='.repeat(80) + '\n');
            return 'DRY-RUN';
        }

        const labelId = await this.ensureLabel();

        const issueData: IssueCreateInput = {
            teamId,
            title: `${TITLE_PREFIX} ${title}`,
            description,
            labelIds: [labelId],
            ...(projectId && { projectId }),
            ...(dueDate && { dueDate: dueDate.toISOString().split('T')[0] }),
            ...(delegateId && { delegateId }),
        };

        const result = await this.client.createIssue(issueData);
        const issue = await result.issue;

        if (!issue) {
            throw new Error(`Failed to create issue for ${dependencyName}`);
        }

        return issue.identifier;
    }

    /**
     * Update an existing issue's due date.
     */
    async updateIssueDueDate(issueId: string, dueDate: Date): Promise<void> {
        await this.client.updateIssue(issueId, {
            dueDate: dueDate.toISOString().split('T')[0],
        });
    }

    /**
     * Update an existing issue's title, description, and optionally due date.
     */
    async updateIssue(
        issueId: string,
        params: { title: string; description: string; dueDate?: Date },
        identifier?: string,
    ): Promise<void> {
        if (this.dryRun) {
            const issueLabel = identifier || issueId;
            process.stderr.write('\n');
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`[DRY RUN] Would UPDATE issue ${issueLabel}\n`);
            process.stderr.write('='.repeat(80) + '\n');
            process.stderr.write(`\nTitle: ${TITLE_PREFIX} ${params.title}\n\n`);
            process.stderr.write(`Description:\n${params.description}\n`);
            if (params.dueDate) {
                process.stderr.write(`\nDue Date: ${params.dueDate.toISOString().split('T')[0]}\n`);
            } else {
                process.stderr.write(`\nDue Date: (none - notifications only)\n`);
            }
            process.stderr.write('\n' + '='.repeat(80) + '\n');
            return;
        }

        await this.client.updateIssue(issueId, {
            title: `${TITLE_PREFIX} ${params.title}`,
            description: params.description,
            // eslint-disable-next-line no-null/no-null
            dueDate: params.dueDate ? params.dueDate.toISOString().split('T')[0] : null,
        });
    }

    /**
     * Create a comment on an issue.
     */
    async createComment(issueId: string, body: string, identifier?: string): Promise<void> {
        if (this.dryRun) {
            const issueLabel = identifier || issueId;
            process.stderr.write(`\n[DRY RUN] Would add comment to ${issueLabel}:\n${body}\n`);
            return;
        }

        await this.client.createComment({
            issueId,
            body,
        });
    }

    /**
     * Close an issue by setting its state to "Done".
     */
    async closeIssue(issueId: string, identifier?: string): Promise<void> {
        if (this.dryRun) {
            const issueLabel = identifier || issueId;
            process.stderr.write(`[DRY RUN] Would close issue ${issueLabel}\n`);
            return;
        }

        const issue = await this.client.issue(issueId);
        const team = await issue.team;

        if (!team) {
            throw new Error(`Cannot close issue ${issueId}: no team found`);
        }

        const states = await team.states();
        const doneState = states.nodes.find(
            (state) => state.type === 'completed' || state.name?.toLowerCase() === 'done',
        );

        if (!doneState) {
            throw new Error(`Cannot close issue ${issueId}: no completed state found`);
        }

        await this.client.updateIssue(issueId, {
            stateId: doneState.id,
        });
    }
}
