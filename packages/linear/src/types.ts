import { z } from 'zod';
import type { DependencyVersion } from '@dependicus/core';

export type { DependicusTicket, CreateTicketParams } from './LinearService';

// ── Zod schemas ──────────────────────────────────────────────────────

/**
 * Policy controlling how the reconciler handles a package.
 *
 * - `noTicket` — skip this package entirely
 * - `fyi` — notification ticket, no due date
 * - `dueDate` — mandatory ticket with SLA-derived due date
 *
 * All variants except `noTicket` support an optional `rateLimitDays` to
 * throttle how frequently tickets are created or updated.
 * @group Ticket Creation
 */
export const linearPolicySchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('noTicket') }),
    z.object({ type: z.literal('fyi'), rateLimitDays: z.number().optional() }),
    z.object({ type: z.literal('dueDate'), rateLimitDays: z.number().optional() }),
]);

/**
 * Controls ticket assignment when creating new tickets.
 *
 * - `unassigned` — no assignee
 * - `delegate` — auto-assign to the given user/agent
 * @group Ticket Creation
 */
export const ticketAssignmentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('unassigned') }),
    z.object({ type: z.literal('delegate'), assigneeId: z.string() }),
]);

export const descriptionSectionSchema = z.object({
    title: z.string(),
    body: z.string(),
});

/**
 * Instructions returned by the consumer for a given version: what ticket to create and how.
 * @group Ticket Creation
 */
export const linearIssueSpecSchema = z.object({
    policy: linearPolicySchema.optional(),
    daysOverdue: z.number().optional(),
    thresholdDays: z.number().optional(),
    targetVersion: z.string().optional(),
    availableMajorVersion: z.string().optional(),
    assignment: ticketAssignmentSchema.optional(),
    /** Linear team UUID to assign the ticket to. This is _not_ the 3-letter
     * ticket prefix. To get a team UUID, press Command+Shift+K, type "uuid",
     * select "Copy model UUID…", type "team", and hit Enter. */
    teamId: z.string(),
    group: z.string().optional(),
    ownerLabel: z.string().optional(),
    descriptionSections: z.array(descriptionSectionSchema).optional(),
});

// ── Derived types ────────────────────────────────────────────────────

/** @group Ticket Creation */
export type LinearPolicy = z.infer<typeof linearPolicySchema>;

/** @group Ticket Creation */
export type TicketAssignment = z.infer<typeof ticketAssignmentSchema>;

export type DescriptionSection = z.infer<typeof descriptionSectionSchema>;

/** @group Ticket Creation */
export type LinearIssueSpec = z.infer<typeof linearIssueSpecSchema>;

// ── Context type ─────────────────────────────────────────────────────

/**
 * Context passed to `getLinearIssueSpec` for each outdated package version.
 * The plugin uses this to decide what kind of ticket (if any) to create.
 * @group Ticket Creation
 */
export interface VersionContext {
    /** npm package name (e.g. "react"). */
    packageName: string;
    /** Currently installed version. */
    currentVersion: string;
    /** Latest version available on the registry. */
    latestVersion: string;
}

// ── Internal types (not plugin-facing) ───────────────────────────────

export interface OutdatedPackage {
    packageName: string;
    versions: DependencyVersion[];
    worstCompliance: {
        updateType: 'major' | 'minor' | 'patch';
        daysOverdue: number;
        /** Undefined for fyi packages (no mandatory update threshold) */
        thresholdDays: number | undefined;
    };
    /**
     * For packages where the SLA doesn't cover major updates, if a major version is
     * available but not required by policy, this tracks the latest major version so
     * we can mention it in the ticket.
     */
    availableMajorVersion?: string;
    /**
     * The target version for the ticket (may differ from latestVersion when the SLA
     * targets updates within the current major).
     */
    targetVersion?: string;
    teamId: string;
    policy: LinearPolicy;
    assignment: TicketAssignment;
    /**
     * Group name if this package belongs to a notification group.
     * Packages in the same group will share a single Linear ticket.
     */
    group?: string;
    /** Owner/surface label (shown in ticket descriptions) */
    ownerLabel?: string;
    /** Consumer-provided sections to include in ticket descriptions (e.g., policy info). */
    descriptionSections?: DescriptionSection[];
}

/**
 * A grouped set of outdated packages that share a single Linear ticket.
 */
export interface OutdatedGroup {
    groupName: string;
    packages: OutdatedPackage[];
    teamId: string;
    policy: LinearPolicy;
    /**
     * Worst compliance across all packages in the group.
     * Used to determine due date and ticket priority.
     */
    worstCompliance: {
        updateType: 'major' | 'minor' | 'patch';
        daysOverdue: number;
        thresholdDays: number | undefined;
    };
}
