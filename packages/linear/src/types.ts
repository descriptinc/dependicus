import { z } from 'zod';
import type { DependencyVersion } from '@dependicus/core';

export type { DependicusIssue, CreateIssueParams } from './LinearService';

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
export const linearPolicySchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('skip') }),
    z.object({ type: z.literal('fyi'), rateLimitDays: z.number().optional() }),
    z.object({ type: z.literal('dueDate'), rateLimitDays: z.number().optional() }),
]);

/**
 * Controls issue assignment when creating new issues.
 *
 * - `unassigned` — no assignee
 * - `delegate` — auto-assign to the given user/agent
 * @group Issue Creation
 */
export const issueAssignmentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('unassigned') }),
    z.object({ type: z.literal('delegate'), assigneeId: z.string() }),
]);

export const descriptionSectionSchema = z.object({
    title: z.string(),
    body: z.string(),
});

/**
 * Instructions returned by the consumer for a given version: what issue to create and how.
 * @group Issue Creation
 */
export const linearIssueSpecSchema = z.object({
    policy: linearPolicySchema.optional(),
    daysOverdue: z.number().optional(),
    thresholdDays: z.number().optional(),
    targetVersion: z.string().optional(),
    availableMajorVersion: z.string().optional(),
    assignment: issueAssignmentSchema.optional(),
    /** Linear team UUID to assign the issue to. This is _not_ the 3-letter
     * issue prefix. To get a team UUID, press Command+Shift+K, type "uuid",
     * select "Copy model UUID…", type "team", and hit Enter. */
    teamId: z.string(),
    group: z.string().optional(),
    ownerLabel: z.string().optional(),
    descriptionSections: z.array(descriptionSectionSchema).optional(),
});

// ── Derived types ────────────────────────────────────────────────────

/** @group Issue Creation */
export type LinearPolicy = z.infer<typeof linearPolicySchema>;

/** @group Issue Creation */
export type IssueAssignment = z.infer<typeof issueAssignmentSchema>;

export type DescriptionSection = z.infer<typeof descriptionSectionSchema>;

/** @group Issue Creation */
export type LinearIssueSpec = z.infer<typeof linearIssueSpecSchema>;

// ── Context type ─────────────────────────────────────────────────────

/**
 * Context passed to `getLinearIssueSpec` for each outdated dependency version.
 * The plugin uses this to decide what kind of issue (if any) to create.
 * @group Issue Creation
 */
export interface VersionContext {
    /** Dependency name (e.g. "react"). */
    name: string;
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
    /**
     * For dependencies where the SLA doesn't cover major updates, if a major version is
     * available but not required by policy, this tracks the latest major version so
     * we can mention it in the issue.
     */
    availableMajorVersion?: string;
    /**
     * The target version for the issue (may differ from latestVersion when the SLA
     * targets updates within the current major).
     */
    targetVersion?: string;
    teamId: string;
    policy: LinearPolicy;
    assignment: IssueAssignment;
    /**
     * Group name if this dependency belongs to a notification group.
     * Dependencies in the same group will share a single Linear issue.
     */
    group?: string;
    /** Owner/surface label (shown in issue descriptions) */
    ownerLabel?: string;
    /** Consumer-provided sections to include in issue descriptions (e.g., policy info). */
    descriptionSections?: DescriptionSection[];
}

/**
 * A grouped set of outdated dependencies that share a single Linear issue.
 */
export interface OutdatedGroup {
    groupName: string;
    dependencies: OutdatedDependency[];
    teamId: string;
    policy: LinearPolicy;
    /**
     * Worst compliance across all dependencies in the group.
     * Used to determine due date and issue priority.
     */
    worstCompliance: {
        updateType: 'major' | 'minor' | 'patch';
        daysOverdue: number;
        thresholdDays: number | undefined;
    };
}
