import { z } from 'zod';
import type { DependencyVersion } from '@dependicus/core';

export type { DependicusIssue, CreateIssueParams } from './GitHubIssueService';

// ── Zod schemas ──────────────────────────────────────────────────────

/**
 * Policy controlling how the reconciler handles a dependency.
 *
 * - `skip` — skip this dependency entirely
 * - `fyi` — notification issue, no due date
 * - `dueDate` — mandatory issue with SLA-derived due date
 *
 * All variants except `skip` support an optional `rateLimitDays` to
 * throttle how frequently issues are created or updated.
 * @group Issue Creation
 */
export const gitHubIssuePolicySchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('skip') }),
    z.object({ type: z.literal('fyi'), rateLimitDays: z.number().optional() }),
    z.object({ type: z.literal('dueDate'), rateLimitDays: z.number().optional() }),
]);

/**
 * Controls issue assignment when creating new issues.
 *
 * - `unassigned` — no assignees
 * - `assign` — assign to GitHub usernames
 * @group Issue Creation
 */
export const gitHubIssueAssignmentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('unassigned') }),
    z.object({ type: z.literal('assign'), assignees: z.array(z.string()) }),
]);

export const descriptionSectionSchema = z.object({
    title: z.string(),
    body: z.string(),
});

/**
 * Instructions returned by the consumer for a given version: what issue to create and how.
 * @group Issue Creation
 */
export const gitHubIssueSpecSchema = z.object({
    policy: gitHubIssuePolicySchema.optional(),
    daysOverdue: z.number().optional(),
    thresholdDays: z.number().optional(),
    targetVersion: z.string().optional(),
    availableMajorVersion: z.string().optional(),
    assignment: gitHubIssueAssignmentSchema.optional(),
    /** GitHub repository owner (user or organization). */
    owner: z.string(),
    /** GitHub repository name. */
    repo: z.string(),
    group: z.string().optional(),
    ownerLabel: z.string().optional(),
    /** Additional labels to apply to the issue (beyond the "dependicus" label). */
    labels: z.array(z.string()).optional(),
    descriptionSections: z.array(descriptionSectionSchema).optional(),
});

// ── Derived types ────────────────────────────────────────────────────

/** @group Issue Creation */
export type GitHubIssuePolicy = z.infer<typeof gitHubIssuePolicySchema>;

/** @group Issue Creation */
export type GitHubIssueAssignment = z.infer<typeof gitHubIssueAssignmentSchema>;

export type DescriptionSection = z.infer<typeof descriptionSectionSchema>;

/** @group Issue Creation */
export type GitHubIssueSpec = z.infer<typeof gitHubIssueSpecSchema>;

// ── Context type ─────────────────────────────────────────────────────

/**
 * Context passed to `getGitHubIssueSpec` for each outdated dependency version.
 * The plugin uses this to decide what kind of issue (if any) to create.
 * @group Issue Creation
 */
export interface VersionContext {
    /** Dependency name (e.g. "react"). */
    name: string;
    /** Ecosystem identifier (e.g. "npm", "go"). */
    ecosystem: string;
    /** Currently installed version. */
    currentVersion: string;
    /** Latest version available on the registry. */
    latestVersion: string;
}

// ── Internal types (not plugin-facing) ───────────────────────────────

export interface OutdatedDependency {
    name: string;
    ecosystem: string;
    versions: DependencyVersion[];
    worstCompliance: {
        updateType: 'major' | 'minor' | 'patch';
        daysOverdue: number;
        /** Undefined for fyi dependencies (no mandatory update threshold) */
        thresholdDays: number | undefined;
    };
    availableMajorVersion?: string;
    targetVersion?: string;
    owner: string;
    repo: string;
    policy: GitHubIssuePolicy;
    assignment: GitHubIssueAssignment;
    group?: string;
    ownerLabel?: string;
    /** Additional labels beyond "dependicus". */
    labels?: string[];
    descriptionSections?: DescriptionSection[];
}

export interface OutdatedGroup {
    groupName: string;
    dependencies: OutdatedDependency[];
    owner: string;
    repo: string;
    policy: GitHubIssuePolicy;
    worstCompliance: {
        updateType: 'major' | 'minor' | 'patch';
        daysOverdue: number;
        thresholdDays: number | undefined;
    };
}
