import type {
    FactStore,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    PackageVersionInfo,
} from '@dependicus/core';
import {
    getAgeDays,
    getDetailFilename,
    getUpdateType,
    findFirstVersionOfType,
    FactKeys,
    findLatestWithinMajor,
    findLatestWithinMinor,
} from '@dependicus/core';
import type { VersionContext, LinearIssueSpec } from '@dependicus/linear';
import type { CustomColumn } from '@dependicus/site-builder';
import type { DependicusPlugin } from './plugin';

/**
 * A compliance policy defines how urgently a dependency should be updated.
 *
 * Policies are entirely user-defined — Dependicus does not ship any built-in
 * policies. You provide them via {@link BasicComplianceConfig.policies}.
 *
 * A policy with `thresholdDays` enforces SLA-style compliance: if an update
 * of a given type (major/minor/patch) has been available longer than the
 * threshold, the dependency is marked non-compliant.
 *
 * A policy with `notificationsOnly: true` creates awareness tickets without
 * enforcement. `notificationRateLimitDays` prevents ticket noise by spacing
 * out notifications.
 *
 * @group Compliance
 */
export interface CompliancePolicy {
    /** Display name shown in tickets and on the site. */
    name: string;
    /** Optional description shown in ticket body and column tooltips. */
    description?: string;
    /**
     * Maximum days an update can be available before the dependency is non-compliant.
     * Omit an update type to skip compliance checking for it (the column shows N/A).
     */
    thresholdDays?: { major?: number; minor?: number; patch?: number };
    /** If true, tickets are informational (FYI) with no due date. */
    notificationsOnly?: boolean;
    /** Minimum days between notification tickets for `notificationsOnly` policies. */
    notificationRateLimitDays?: number;
}

/**
 * Configuration for {@link BasicCompliancePlugin}.
 *
 * The plugin is intentionally agnostic about how you assign policies to
 * dependencies. You bring the policy definitions and a lookup function; the
 * plugin handles columns, sections, and issue spec generation.
 *
 * @group Compliance
 */
export interface BasicComplianceConfig {
    /** Map of policy ID to policy definition. IDs are opaque strings you define. */
    policies: Record<string, CompliancePolicy>;
    /**
     * Given a dependency name, return its policy ID (a key into `policies`).
     * Return `undefined` if the dependency has no policy — it will show as N/A.
     *
     * The `store` parameter gives access to facts populated by data sources,
     * which is useful when the policy assignment lives in a custom data source
     * rather than a static lookup table.
     */
    getPolicy: (name: string, store: FactStore) => string | undefined;
}

// ── Compliance evaluation ───────────────────────────────────────────

/**
 * Whether a dependency version meets its update threshold.
 *
 * - `compliant` — the version is current, or the update hasn't exceeded its threshold yet.
 * - `not-applicable` — no threshold was provided, or the version can't be evaluated
 *   (e.g. malformed version, prerelease latest).
 * - `non-compliant` — an update has been available longer than the threshold allows.
 *   Includes the update type, days overdue, and the threshold that was exceeded.
 *
 * @group Compliance
 */
export type ComplianceStatus =
    | { status: 'compliant' }
    | { status: 'not-applicable' }
    | {
          status: 'non-compliant';
          updateType: 'major' | 'minor' | 'patch';
          daysOverdue: number;
          thresholdDays: number;
      };

/**
 * Calculate compliance status for a dependency version.
 *
 * @param currentVersion - The currently installed version
 * @param latestVersion - The latest available version
 * @param versionsBetween - Versions between current and latest (oldest to newest)
 * @param thresholdDays - Threshold in days for this update
 */
export function getComplianceStatus(
    currentVersion: string,
    latestVersion: string,
    versionsBetween: PackageVersionInfo[],
    thresholdDays: number | undefined,
): ComplianceStatus {
    // No threshold means compliance is not applicable
    if (thresholdDays === undefined) {
        return { status: 'not-applicable' };
    }

    // Already at latest version
    if (currentVersion === latestVersion) {
        return { status: 'compliant' };
    }

    // Determine what type of update is needed
    const updateType = getUpdateType(currentVersion, latestVersion);
    if (!updateType) {
        return { status: 'not-applicable' };
    }

    // Find when this update type first became available
    const firstVersion = findFirstVersionOfType(currentVersion, versionsBetween, updateType);
    if (!firstVersion) {
        // Can't determine when update became available, assume compliant
        return { status: 'compliant' };
    }

    // Calculate how long the update has been available
    const daysAvailable = getAgeDays(firstVersion.publishDate);
    if (daysAvailable === undefined) {
        return { status: 'not-applicable' };
    }

    if (daysAvailable > thresholdDays) {
        return {
            status: 'non-compliant',
            updateType,
            daysOverdue: daysAvailable - thresholdDays,
            thresholdDays,
        };
    }

    return { status: 'compliant' };
}

/**
 * Format compliance result as human-readable detail string.
 */
export function formatComplianceDetail(result: ComplianceStatus): string {
    if (result.status !== 'non-compliant') {
        return '';
    }

    const updateTypeLabel =
        result.updateType === 'major' ? 'Major' : result.updateType === 'minor' ? 'Minor' : 'Patch';

    const months = Math.floor(result.daysOverdue / 30);
    if (months > 0) {
        return `${updateTypeLabel} update ${months} month${months > 1 ? 's' : ''} overdue`;
    }
    return `${updateTypeLabel} update ${result.daysOverdue} day${result.daysOverdue !== 1 ? 's' : ''} overdue`;
}

// ── Static helpers ──────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
    compliant: 'Compliant',
    'non-compliant': 'Non-Compliant',
    'not-applicable': 'N/A',
};

function formatThreshold(days: number): string {
    if (days % 30 === 0) {
        const months = days / 30;
        return months === 1 ? '1 month' : `${months} months`;
    }
    return days === 1 ? '1 day' : `${days} days`;
}

// ── Plugin class ────────────────────────────────────────────────────

/**
 * Threshold-based compliance plugin.
 *
 * You provide policy definitions and a function that maps dependencies to policy
 * IDs; the plugin handles columns, sections, and issue spec generation.
 * It composes with ownership plugins — each plugin contributes its own
 * fields to the merged `LinearIssueSpec`.
 *
 * See the [Compliance docs](https://descriptinc.github.io/dependicus/compliance/) for usage examples.
 *
 * @group Compliance
 */
export class BasicCompliancePlugin implements DependicusPlugin {
    readonly name = 'basic-compliance';
    readonly columns: CustomColumn[];
    readonly groupings: GroupingConfig[];

    constructor(private readonly config: BasicComplianceConfig) {
        this.columns = this.buildColumns();
        this.groupings = this.buildGroupings();
    }

    // ── DependicusPlugin methods ────────────────────────────────────

    getSections = (ctx: GroupingDetailContext): GroupingSection[] => {
        const { dependencies, store } = ctx;
        let compliantCount = 0;
        let nonCompliantCount = 0;
        let noPolicyCount = 0;
        const flaggedDependencies: NonNullable<GroupingSection['flaggedDependencies']> = [];

        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const policy = this.resolvePolicy(dep.name, store);
                if (!policy) {
                    noPolicyCount++;
                    continue;
                }
                const result = this.computeStatus(dep.name, ver.version, ver.latestVersion, store);
                if (result.status === 'non-compliant') {
                    nonCompliantCount++;
                    const detail = formatComplianceDetail(result);
                    flaggedDependencies.push({
                        name: dep.name,
                        version: ver.version,
                        detailLink: `../details/${getDetailFilename(dep.name, ver.version)}`,
                        label: detail,
                    });
                } else {
                    // Both 'compliant' and 'not-applicable' count as compliant
                    // when the dependency has a policy assigned.
                    compliantCount++;
                }
            }
        }

        const sections: GroupingSection[] = [];
        if (compliantCount + nonCompliantCount + noPolicyCount > 0) {
            sections.push({
                title: 'Compliance',
                stats: [
                    { label: 'Compliant', value: compliantCount },
                    { label: 'Out of Compliance', value: nonCompliantCount },
                    { label: 'No Policy Set', value: noPolicyCount },
                ],
            });
        }
        if (flaggedDependencies.length > 0) {
            sections.push({
                title: 'Non-Compliant Dependencies',
                flaggedDependencies,
            });
        }
        return sections;
    };

    /**
     * Produce compliance-related fields for a Linear issue.
     *
     * Target version selection:
     *   If the policy has a `major` threshold, target is the absolute latest.
     *   If only `minor`, target is the latest within the current major.
     *   If only `patch`, target is the latest within the current minor.
     * This prevents the issue from asking teams to jump to a new major when
     * their policy only covers minor/patch updates. When a newer major exists
     * beyond the target, `availableMajorVersion` is set so the issue can
     * mention it informatively.
     *
     * Returns a partial LinearIssueSpec (no teamId/assignment/group/ownerLabel —
     * those come from a separate ownership plugin).
     */
    getLinearIssueSpec = (
        context: VersionContext,
        store: FactStore,
    ): Partial<LinearIssueSpec> | undefined => {
        const policy = this.resolvePolicy(context.name, store);
        if (!policy) return undefined;

        const isNotificationsOnly = policy.notificationsOnly ?? false;
        const thresholds = policy.thresholdDays;
        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(
                context.name,
                context.currentVersion,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];

        let daysOverdue: number | undefined;
        let thresholdDaysValue: number | undefined;
        let targetVersion: string | undefined;
        let availableMajorVersion: string | undefined;

        if (!isNotificationsOnly && thresholds) {
            if (thresholds.major !== undefined) {
                targetVersion = context.latestVersion;
            } else if (thresholds.minor !== undefined) {
                targetVersion =
                    findLatestWithinMajor(context.currentVersion, versionsBetween)?.version ??
                    context.latestVersion;
            } else {
                targetVersion =
                    findLatestWithinMinor(context.currentVersion, versionsBetween)?.version ??
                    context.latestVersion;
            }

            const effectiveUpdateType = getUpdateType(context.currentVersion, targetVersion);
            const computedThresholdDays = effectiveUpdateType
                ? thresholds[effectiveUpdateType]
                : undefined;

            const compliance = getComplianceStatus(
                context.currentVersion,
                targetVersion,
                versionsBetween,
                computedThresholdDays,
            );

            if (compliance.status === 'non-compliant') {
                daysOverdue = compliance.daysOverdue;
                thresholdDaysValue = compliance.thresholdDays;
            }

            if (
                targetVersion !== context.latestVersion &&
                getUpdateType(context.currentVersion, context.latestVersion) === 'major'
            ) {
                availableMajorVersion = context.latestVersion;
            }
        }

        return {
            policy: isNotificationsOnly
                ? { type: 'fyi', rateLimitDays: policy.notificationRateLimitDays }
                : thresholds
                  ? { type: 'dueDate' }
                  : { type: 'skip' },
            daysOverdue,
            thresholdDays: thresholdDaysValue,
            targetVersion,
            availableMajorVersion,
            descriptionSections: [
                {
                    title: 'Policy',
                    body: [
                        `This dependency is managed under **${policy.name}** policy:`,
                        '',
                        ...(policy.thresholdDays?.major !== undefined
                            ? [`- Major updates: ${formatThreshold(policy.thresholdDays.major)}`]
                            : []),
                        ...(policy.thresholdDays?.minor !== undefined
                            ? [`- Minor updates: ${formatThreshold(policy.thresholdDays.minor)}`]
                            : []),
                        ...(policy.thresholdDays?.patch !== undefined
                            ? [`- Patch updates: ${formatThreshold(policy.thresholdDays.patch)}`]
                            : []),
                        ...(policy.notificationsOnly
                            ? ['- Notifications only (no mandatory updates)']
                            : []),
                        ...(policy.description ? [`- *${policy.description}*`] : []),
                    ].join('\n'),
                },
            ],
        };
    };

    // ── Private helpers ─────────────────────────────────────────────
    //
    // Pipeline: resolvePolicy → resolveThreshold → computeStatus

    /** Look up the CompliancePolicy for a dependency via the consumer's getPolicy callback. */
    private resolvePolicy(name: string, store: FactStore): CompliancePolicy | undefined {
        const policyId = this.config.getPolicy(name, store);
        if (!policyId) return undefined;
        return this.config.policies[policyId];
    }

    /**
     * Determine the threshold in days for a specific version pair.
     * Returns undefined when no policy exists or the policy has no threshold
     * for the relevant update type.
     */
    private resolveThreshold(
        name: string,
        version: string,
        latestVersion: string,
        store: FactStore,
    ): number | undefined {
        const policy = this.resolvePolicy(name, store);
        if (!policy) return undefined;
        const updateType = getUpdateType(version, latestVersion);
        if (!updateType) return undefined;
        return policy.thresholdDays?.[updateType];
    }

    /** Full compliance evaluation for one dependency version. */
    private computeStatus(name: string, version: string, latestVersion: string, store: FactStore) {
        const threshold = this.resolveThreshold(name, version, latestVersion, store);
        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(name, version, FactKeys.VERSIONS_BETWEEN) ??
            [];
        return getComplianceStatus(version, latestVersion, versionsBetween, threshold);
    }

    /** Build a grouping page per compliance policy. */
    private buildGroupings(): GroupingConfig[] {
        return [
            {
                key: 'compliance-policy',
                label: 'Compliance Policies',
                slugPrefix: 'policies',
                getValue: (name, store) => {
                    const policy = this.resolvePolicy(name, store);
                    return policy?.name;
                },
                getSections: this.getSections,
            },
        ];
    }

    /** Build the two compliance columns (status badge + detail text). */
    private buildColumns(): CustomColumn[] {
        return [
            {
                key: 'compliance',
                header: 'Compliance',
                width: 140,
                filter: 'list',
                filterValues: STATUS_LABELS,
                getValue: (name, version, store) => {
                    const { status } = this.computeStatus(
                        name,
                        version.version,
                        version.latestVersion,
                        store,
                    );
                    return STATUS_LABELS[status] ?? status;
                },
                getFilterValue: (name, version, store) =>
                    this.computeStatus(name, version.version, version.latestVersion, store).status,
            },
            {
                key: 'complianceDetail',
                header: 'Compliance Detail',
                width: 200,
                getValue: (name, version, store) =>
                    formatComplianceDetail(
                        this.computeStatus(name, version.version, version.latestVersion, store),
                    ),
            },
        ];
    }
}
