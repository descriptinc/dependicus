// Copyright 2026 Descript, Inc
import type {
    DirectDependency,
    PackageVersionInfo,
    GitHubData,
    DetailUrlFn,
    ProviderInfo,
} from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
import {
    FactKeys,
    getUpdateType,
    isNewerThan,
    extractLatestVersionFromTitle,
    buildTicketTitle,
    buildGroupTicketTitle,
    findFirstVersionOfType,
    calculateDueDate,
    isWithinCooldown,
    isWithinNotificationRateLimit,
    hasMajorVersionSinceLastUpdate,
    getDetailFilename,
} from '@dependicus/core';
import { LinearService, DependicusIssue } from './LinearService';
import type {
    OutdatedDependency,
    OutdatedGroup,
    LinearPolicy,
    IssueAssignment,
    VersionContext,
    LinearIssueSpec,
} from './types';
import {
    buildIssueDescription,
    buildGroupIssueDescription,
    buildNewVersionsComment,
} from './issueDescriptions';

export interface IssueReconcilerConfig {
    linearApiKey: string;
    dryRun?: boolean;
    /** Base URL for Dependicus HTML pages (for links in issue descriptions) */
    dependicusBaseUrl: string;
    /** Builds the full detail page URL for a given package version. */
    getDetailUrl?: DetailUrlFn;
    /** Cooldown days before creating issues for newly-published versions */
    cooldownDays?: number;
    /** Whether to restrict new issue creation (e.g., only on main branch) */
    allowNewIssues?: boolean;
    /** Provider info map (ecosystem -> ProviderInfo) for presentation metadata */
    providerInfoMap?: Map<string, ProviderInfo>;
    /** Skip updating issues whose Linear state name (case-insensitive) matches any entry. */
    skipStateNames?: string[];
}

export interface ReconciliationResult {
    created: number;
    updated: number;
    closed: number;
    closedDuplicates: number;
}

/**
 * Check if any package in the list has had a major version published since the given date.
 * Used for groups where we can't compare version numbers from the issue title.
 *
 * Checks ALL major versions in versionsBetween, not just the first one, because
 * there may be multiple major version jumps (e.g., 18.0.0 and 19.0.0) and only
 * a newer one might have been published after the given date.
 */
function hasMajorVersionPublishedSince(
    deps: OutdatedDependency[],
    sinceDate: string,
    store: FactStore,
): boolean {
    const sinceTime = new Date(sinceDate).getTime();

    for (const dep of deps) {
        const version = dep.versions[0];
        if (!version) continue;

        const scoped = store.scoped(dep.ecosystem);
        const versionsBetween =
            scoped.getVersionFact<PackageVersionInfo[]>(
                dep.name,
                version.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];

        const currentMajor = parseInt(version.version.split('.')[0] ?? '0', 10);

        for (const v of versionsBetween) {
            if (v.isPrerelease) continue;

            const vMajor = parseInt(v.version.split('.')[0] ?? '0', 10);
            if (vMajor > currentMajor) {
                if (!v.publishDate) continue;
                const publishTime = new Date(v.publishDate).getTime();
                if (publishTime > sinceTime) {
                    return true;
                }
            }
        }
    }

    return false;
}

/** Extract rate limit days from a policy. */
function policyRateLimitDays(policy: LinearPolicy): number | undefined {
    return policy.type === 'skip' ? undefined : policy.rateLimitDays;
}

/** Whether a policy represents a notifications-only / FYI package. */
function isFyiPolicy(policy: LinearPolicy): boolean {
    return policy.type === 'fyi';
}

/**
 * Check if an issue update should be skipped due to rate limiting.
 * Returns the rate limit days if should skip, undefined if should proceed.
 */
function shouldSkipUpdateDueToRateLimit(
    policy: LinearPolicy,
    issueUpdatedAt: string,
    hasMajorRelease: boolean,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy);
    if (rateLimitDays === undefined) {
        return undefined;
    }

    const withinRateLimit = isWithinNotificationRateLimit(issueUpdatedAt, rateLimitDays);

    if (withinRateLimit && !hasMajorRelease) {
        return rateLimitDays;
    }

    return undefined;
}

/**
 * Check if issue creation should be skipped due to rate limiting.
 * Returns the rate limit days if should skip, undefined if should proceed.
 *
 * For single packages: checks if the first version of the update type was published within rate limit.
 * For groups: checks if ALL packages are within the rate limit period.
 */
function shouldSkipCreateDueToRateLimit(
    policy: LinearPolicy,
    deps: OutdatedDependency[],
    store: FactStore,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy);
    if (rateLimitDays === undefined) {
        return undefined;
    }

    // Check if any dependency has a major update (bypasses rate limit)
    const hasMajorUpdate = deps.some((dep) => dep.worstCompliance.updateType === 'major');
    if (hasMajorUpdate) {
        return undefined;
    }

    // Check if all dependencies are within the rate limit period
    const allWithinRateLimit = deps.every((dep) => {
        const version = dep.versions[0];
        if (!version) return true;
        const scoped = store.scoped(dep.ecosystem);
        const versionsBetween =
            scoped.getVersionFact<PackageVersionInfo[]>(
                dep.name,
                version.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];
        return isWithinCooldown(
            version.version,
            versionsBetween,
            dep.worstCompliance.updateType,
            rateLimitDays,
        );
    });

    if (allWithinRateLimit) {
        return rateLimitDays;
    }

    return undefined;
}

/** Default policy when the issue spec doesn't specify one. */
const DEFAULT_POLICY: LinearPolicy = { type: 'fyi' };

/** Default assignment when the issue spec doesn't specify one. */
const DEFAULT_ASSIGNMENT: IssueAssignment = { type: 'unassigned' };

/**
 * Aggregate assignment from multiple versions of the same package.
 * If any version returns unassigned, the dependency is unassigned.
 * Only if all versions delegate to the same assignee does the dependency get delegated.
 */
function aggregateAssignment(
    existing: IssueAssignment,
    incoming: IssueAssignment,
): IssueAssignment {
    if (existing.type === 'unassigned' || incoming.type === 'unassigned') {
        return { type: 'unassigned' };
    }
    if (existing.assigneeId !== incoming.assigneeId) {
        return { type: 'unassigned' };
    }
    return existing;
}

/**
 * Aggregate policy from multiple versions of the same package.
 * dueDate wins over fyi (it's the "worse" policy requiring action).
 */
function aggregatePolicy(existing: LinearPolicy, incoming: LinearPolicy): LinearPolicy {
    if (existing.type === 'dueDate') return existing;
    if (incoming.type === 'dueDate') return incoming;
    // Both fyi — keep existing (preserves rate limit from first)
    return existing;
}

export async function reconcileIssues(
    dependencies: DirectDependency[],
    store: FactStore,
    config: IssueReconcilerConfig,
    getLinearIssueSpec?: (context: VersionContext, store: FactStore) => LinearIssueSpec | undefined,
): Promise<ReconciliationResult> {
    const dryRun = config.dryRun ?? false;
    const allowNewIssues = config.allowNewIssues ?? true;
    const dependicusBaseUrl = config.dependicusBaseUrl;
    const getDetailUrl: DetailUrlFn =
        config.getDetailUrl ??
        ((_eco, pkg, ver) => {
            const filename = getDetailFilename(pkg, ver);
            return `${dependicusBaseUrl}/details/${filename}`;
        });

    const skipStateNamesSet = new Set((config.skipStateNames ?? []).map((s) => s.toLowerCase()));

    const linearService = new LinearService(config.linearApiKey, { dryRun });

    // Find out-of-date dependencies (group by dependency name)
    const outdatedDeps = new Map<string, OutdatedDependency>();

    for (const dep of dependencies) {
        for (const version of dep.versions) {
            // Skip if already on latest version
            if (version.version === version.latestVersion) continue;

            // Determine update type (major/minor/patch) based on latest version
            const updateType = getUpdateType(version.version, version.latestVersion);
            if (!updateType) {
                process.stderr.write(
                    `  Skipping ${dep.name}@${version.version}: cannot parse version or already up-to-date\n`,
                );
                continue;
            }

            // Build VersionContext and call consumer callback
            const versionContext: VersionContext = {
                name: dep.name,
                currentVersion: version.version,
                latestVersion: version.latestVersion,
            };

            const ctx = getLinearIssueSpec?.(versionContext, store);
            if (!ctx) continue;

            const policy = ctx.policy ?? DEFAULT_POLICY;
            const assignment = ctx.assignment ?? DEFAULT_ASSIGNMENT;

            // skip policy — skip entirely
            if (policy.type === 'skip') continue;

            const isNotificationsOnly = isFyiPolicy(policy);

            const targetVersion = ctx.targetVersion;
            const availableMajorVersion = ctx.availableMajorVersion;

            // Derive effective update type from target version
            const effectiveUpdateType = targetVersion
                ? (getUpdateType(version.version, targetVersion) ?? updateType)
                : updateType;

            const daysOverdue = ctx.daysOverdue ?? 0;
            const thresholdDays = ctx.thresholdDays;

            // Skip if no threshold and not notifications-only (nothing to track)
            if (thresholdDays === undefined && !isNotificationsOnly && targetVersion === undefined)
                continue;

            // Determine the effective policy for this version entry
            const effectivePolicy: LinearPolicy = isNotificationsOnly
                ? { type: 'fyi' as const, rateLimitDays: policyRateLimitDays(policy) }
                : thresholdDays !== undefined
                  ? policy
                  : { type: 'fyi' as const, rateLimitDays: policyRateLimitDays(policy) };

            const existing = outdatedDeps.get(dep.name);

            if (!existing) {
                outdatedDeps.set(dep.name, {
                    name: dep.name,
                    ecosystem: dep.ecosystem,
                    versions: [version],
                    worstCompliance: {
                        updateType: effectiveUpdateType,
                        daysOverdue,
                        thresholdDays,
                    },
                    availableMajorVersion,
                    targetVersion,
                    teamId: ctx.teamId,
                    policy: effectivePolicy,
                    assignment,
                    group: ctx.group,
                    ownerLabel: ctx.ownerLabel,
                    descriptionSections: ctx.descriptionSections,
                });
            } else {
                existing.versions.push(version);

                // Aggregate assignment across versions
                existing.assignment = aggregateAssignment(existing.assignment, assignment);

                // Prefer actionable updates over FYI-only, even when both have daysOverdue=0
                const isCurrentActionable = !isNotificationsOnly && thresholdDays !== undefined;
                const isExistingFyi = isFyiPolicy(existing.policy);
                const shouldReplaceCompliance =
                    daysOverdue > existing.worstCompliance.daysOverdue ||
                    (isCurrentActionable && isExistingFyi);

                if (shouldReplaceCompliance) {
                    existing.worstCompliance = {
                        updateType: effectiveUpdateType,
                        daysOverdue,
                        thresholdDays,
                    };
                    existing.policy = aggregatePolicy(existing.policy, effectivePolicy);
                    existing.targetVersion = targetVersion;
                } else {
                    existing.policy = aggregatePolicy(existing.policy, effectivePolicy);
                }

                // Keep track of major version if available
                if (availableMajorVersion && !existing.availableMajorVersion) {
                    existing.availableMajorVersion = availableMajorVersion;
                }
            }
        }
    }

    process.stderr.write(`Found ${outdatedDeps.size} out-of-date dependencies\n`);

    // Separate dependencies into grouped and ungrouped
    const ungroupedDeps = new Map<string, OutdatedDependency>();
    const dependenciesByGroup = new Map<string, OutdatedDependency[]>();

    for (const dep of outdatedDeps.values()) {
        if (dep.group) {
            const groupDeps = dependenciesByGroup.get(dep.group) ?? [];
            groupDeps.push(dep);
            dependenciesByGroup.set(dep.group, groupDeps);
        } else {
            ungroupedDeps.set(dep.name, dep);
        }
    }

    // Build OutdatedGroup objects from grouped dependencies
    const outdatedGroups = new Map<string, OutdatedGroup>();
    for (const [groupName, deps] of dependenciesByGroup) {
        // Use the first dependency's team info (all dependencies in a group should have the same team)
        const firstDep = deps[0];
        if (!firstDep) continue;

        // Calculate worst compliance across all dependencies in the group
        // Prefer dependencies with actual SLO thresholds over notifications-only dependencies
        let worstCompliance = firstDep.worstCompliance;
        let groupPolicy: LinearPolicy = firstDep.policy;

        for (const dep of deps.slice(1)) {
            // Aggregate policy — dueDate wins over fyi
            groupPolicy = aggregatePolicy(groupPolicy, dep.policy);

            // Determine if this dependency's compliance is "worse" than current worst
            // Priority: 1) Higher daysOverdue, 2) Has actual SLO threshold vs notifications-only
            const currentHasThreshold = worstCompliance.thresholdDays !== undefined;
            const depHasThreshold = dep.worstCompliance.thresholdDays !== undefined;

            const shouldReplace =
                dep.worstCompliance.daysOverdue > worstCompliance.daysOverdue ||
                (dep.worstCompliance.daysOverdue === worstCompliance.daysOverdue &&
                    depHasThreshold &&
                    !currentHasThreshold);

            if (shouldReplace) {
                worstCompliance = dep.worstCompliance;
            }
        }

        outdatedGroups.set(groupName, {
            groupName,
            dependencies: deps,
            teamId: firstDep.teamId,
            policy: groupPolicy,
            worstCompliance,
        });
    }

    process.stderr.write(
        `  Ungrouped: ${ungroupedDeps.size}, Groups: ${outdatedGroups.size} (${dependenciesByGroup.size > 0 ? [...dependenciesByGroup.values()].reduce((sum, d) => sum + d.length, 0) : 0} dependencies)\n`,
    );

    // Search for existing issues (by Dependicus label across all teams)
    process.stderr.write('Searching for existing Dependicus issues...\n');
    const existingIssues = await linearService.searchDependicusIssues((fetched, page) => {
        process.stderr.write(`  Fetched ${fetched} issues (page ${page})...\n`);
    });
    process.stderr.write(`Found ${existingIssues.length} existing issues\n`);

    // Build maps for deduplication
    const existingIssuesByName = new Map<string, DependicusIssue>();
    const existingIssuesByTitle = new Set<string>();
    const duplicateIssues: DependicusIssue[] = [];

    for (const issue of existingIssues) {
        if (!existingIssuesByName.has(issue.dependencyName)) {
            existingIssuesByName.set(issue.dependencyName, issue);
        } else {
            duplicateIssues.push(issue);
        }
        existingIssuesByTitle.add(issue.title);
    }

    // Close duplicate issues proactively
    let closedDuplicates = 0;
    if (duplicateIssues.length > 0) {
        process.stderr.write(`Found ${duplicateIssues.length} duplicate issues to close...\n`);
        for (const duplicate of duplicateIssues) {
            try {
                await linearService.closeIssue(duplicate.id, duplicate.identifier);
                if (!dryRun) {
                    process.stderr.write(
                        `Closed duplicate issue for ${duplicate.dependencyName} (${duplicate.identifier})\n`,
                    );
                }
                closedDuplicates++;
            } catch (error) {
                process.stderr.write(
                    `Warning: Failed to close duplicate ${duplicate.identifier}: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
                );
            }
        }
    }

    // Process non-compliant dependencies
    let created = 0;
    let updated = 0;

    // Process ungrouped dependencies
    for (const dep of ungroupedDeps.values()) {
        const existingIssue = existingIssuesByName.get(dep.name);
        const version = dep.versions[0];
        if (!version) {
            throw new Error(`No versions found for dependency ${dep.name}`);
        }

        const scopedStore = store.scoped(dep.ecosystem);
        const versionsBetween =
            scopedStore.getVersionFact<PackageVersionInfo[]>(
                dep.name,
                version.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];

        const notificationsOnly = isFyiPolicy(dep.policy);

        // Calculate due date (undefined for fyi dependencies)
        const dueDate =
            dep.worstCompliance.thresholdDays !== undefined
                ? calculateDueDate(
                      version.version,
                      versionsBetween,
                      dep.worstCompliance.updateType,
                      dep.worstCompliance.thresholdDays,
                      version.publishDate,
                  )
                : undefined;

        // Build title and description
        const effectiveLatestVersion = dep.targetVersion ?? version.latestVersion;

        const minVersion = notificationsOnly
            ? effectiveLatestVersion
            : (findFirstVersionOfType(
                  version.version,
                  versionsBetween,
                  dep.worstCompliance.updateType,
              )?.version ?? effectiveLatestVersion);
        const title = buildTicketTitle(
            dep.name,
            version.version,
            minVersion,
            effectiveLatestVersion,
            { notificationsOnly },
        );
        const providerInfo = config.providerInfoMap?.get(dep.ecosystem);
        const description = buildIssueDescription(
            dep,
            scopedStore,
            minVersion,
            effectiveLatestVersion,
            getDetailUrl,
            providerInfo,
        );

        if (existingIssue) {
            // Issue exists - check if it's in a state where we should skip updating
            const issueStateName = existingIssue.state.name?.toLowerCase();
            const skipUpdate =
                issueStateName !== undefined && skipStateNamesSet.has(issueStateName);

            if (skipUpdate) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${dep.name} (${existingIssue.identifier}) - issue in ${existingIssue.state.name} state\n`,
                    );
                }
                existingIssuesByName.delete(dep.name);
                continue;
            }

            // Check if new versions were released since last update
            const oldLatestVersion = extractLatestVersionFromTitle(existingIssue.title);
            const hasNewVersions = oldLatestVersion && oldLatestVersion !== effectiveLatestVersion;

            // For fyi dependencies with rate limits, check if we should skip
            const skipRateLimitDays = shouldSkipUpdateDueToRateLimit(
                dep.policy,
                existingIssue.updatedAt,
                hasMajorVersionSinceLastUpdate(oldLatestVersion, effectiveLatestVersion),
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${dep.name} (${existingIssue.identifier}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingIssuesByName.delete(dep.name);
                continue;
            }

            // Calculate new versions for comment
            let newVersions: PackageVersionInfo[] = [];
            let comment: string | undefined;
            if (hasNewVersions && oldLatestVersion) {
                newVersions = versionsBetween.filter((v) =>
                    isNewerThan(v.version, oldLatestVersion),
                );

                if (newVersions.length > 0) {
                    const github = scopedStore.getDependencyFact<GitHubData>(
                        dep.name,
                        FactKeys.GITHUB_DATA,
                    );
                    comment = buildNewVersionsComment(
                        dep.name,
                        oldLatestVersion,
                        newVersions,
                        github,
                    );
                }
            }

            // Update issue
            await linearService.updateIssue(
                existingIssue.id,
                {
                    title,
                    description,
                    dueDate,
                },
                existingIssue.identifier,
            );
            if (comment) {
                await linearService.createComment(
                    existingIssue.id,
                    comment,
                    existingIssue.identifier,
                );
                if (!dryRun) {
                    process.stderr.write(
                        `Updated ${dep.name} (${existingIssue.identifier}) + comment (${newVersions.length} new versions)\n`,
                    );
                }
            } else if (!dryRun) {
                process.stderr.write(`Updated ${dep.name} (${existingIssue.identifier})\n`);
            }
            updated++;

            existingIssuesByName.delete(dep.name);
        } else {
            // No issue exists - only create if allowed
            if (!allowNewIssues) {
                process.stderr.write(
                    `Skipping issue creation for ${dep.name} (new issue creation disabled)\n`,
                );
                continue;
            }

            // For fyi dependencies with rate limits, apply rate limiting
            const skipRateLimitDays = shouldSkipCreateDueToRateLimit(dep.policy, [dep], store);
            if (skipRateLimitDays !== undefined) {
                process.stderr.write(
                    `Skipping ${dep.name} - within ${skipRateLimitDays}-day rate limit (no existing issue)\n`,
                );
                continue;
            }

            // Double-check: skip if an issue with this exact title already exists
            const fullTitle = `[Dependicus] ${title}`;
            if (existingIssuesByTitle.has(fullTitle)) {
                process.stderr.write(
                    `Skipping ${dep.name} - issue with same title already exists\n`,
                );
                continue;
            }

            // Determine delegate from assignment
            const delegateId =
                dep.assignment.type === 'delegate' ? dep.assignment.assigneeId : undefined;

            // Create issue
            const identifier = await linearService.createIssue({
                dependencyName: dep.name,
                title,
                teamId: dep.teamId,
                dueDate,
                description,
                delegateId,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                const delegateNote = delegateId ? ' [delegated]' : '';
                process.stderr.write(
                    `Created issue for ${dep.name} (${identifier})${delegateNote}\n`,
                );
            }
            created++;
        }
    }

    // Process grouped packages
    for (const group of outdatedGroups.values()) {
        const existingIssue = existingIssuesByName.get(group.groupName);
        const groupNotificationsOnly = isFyiPolicy(group.policy);

        // Calculate due date based on worst compliance in the group
        let earliestDueDate: Date | undefined;
        if (group.worstCompliance.thresholdDays !== undefined) {
            for (const dep of group.dependencies) {
                const version = dep.versions[0];
                if (!version) continue;

                const depScopedStore = store.scoped(dep.ecosystem);
                const versionsBetween =
                    depScopedStore.getVersionFact<PackageVersionInfo[]>(
                        dep.name,
                        version.version,
                        FactKeys.VERSIONS_BETWEEN,
                    ) ?? [];

                const depDueDate = calculateDueDate(
                    version.version,
                    versionsBetween,
                    dep.worstCompliance.updateType,
                    dep.worstCompliance.thresholdDays ?? group.worstCompliance.thresholdDays ?? 0,
                    version.publishDate,
                );
                if (!earliestDueDate || depDueDate < earliestDueDate) {
                    earliestDueDate = depDueDate;
                }
            }
        }

        const title = buildGroupTicketTitle(group.groupName, group.dependencies.length, {
            notificationsOnly: groupNotificationsOnly,
        });
        const description = buildGroupIssueDescription(
            group,
            store,
            getDetailUrl,
            config.providerInfoMap,
        );

        if (existingIssue) {
            const issueStateName = existingIssue.state.name?.toLowerCase();
            const skipUpdate =
                issueStateName !== undefined && skipStateNamesSet.has(issueStateName);

            if (skipUpdate) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${group.groupName} group (${existingIssue.identifier}) - issue in ${existingIssue.state.name} state\n`,
                    );
                }
                existingIssuesByName.delete(group.groupName);
                continue;
            }

            // For fyi groups with rate limits, check if we should skip
            const hasMajorRelease = hasMajorVersionPublishedSince(
                group.dependencies,
                existingIssue.updatedAt,
                store,
            );
            const skipRateLimitDays = shouldSkipUpdateDueToRateLimit(
                group.policy,
                existingIssue.updatedAt,
                hasMajorRelease,
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${group.groupName} group (${existingIssue.identifier}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingIssuesByName.delete(group.groupName);
                continue;
            }

            // Update issue
            await linearService.updateIssue(
                existingIssue.id,
                {
                    title,
                    description,
                    dueDate: earliestDueDate,
                },
                existingIssue.identifier,
            );
            if (!dryRun) {
                process.stderr.write(
                    `Updated ${group.groupName} group (${existingIssue.identifier}) - ${group.dependencies.length} dependencies\n`,
                );
            }
            updated++;

            existingIssuesByName.delete(group.groupName);
        } else {
            // No issue exists - only create if allowed
            if (!allowNewIssues) {
                process.stderr.write(
                    `Skipping issue creation for ${group.groupName} group (new issue creation disabled)\n`,
                );
                continue;
            }

            // For fyi groups with rate limits, apply rate limiting
            const skipRateLimitDays = shouldSkipCreateDueToRateLimit(
                group.policy,
                group.dependencies,
                store,
            );
            if (skipRateLimitDays !== undefined) {
                process.stderr.write(
                    `Skipping ${group.groupName} group - within ${skipRateLimitDays}-day rate limit (no existing issue)\n`,
                );
                continue;
            }

            // Double-check: skip if an issue with this exact title already exists
            const fullTitle = `[Dependicus] ${title}`;
            if (existingIssuesByTitle.has(fullTitle)) {
                process.stderr.write(
                    `Skipping ${group.groupName} group - issue with same title already exists\n`,
                );
                continue;
            }

            // Create issue for the group (don't auto-delegate groups - they're more complex)
            const identifier = await linearService.createIssue({
                dependencyName: group.groupName,
                title,
                teamId: group.teamId,
                dueDate: earliestDueDate,
                description,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                process.stderr.write(
                    `Created issue for ${group.groupName} group (${identifier}) - ${group.dependencies.length} dependencies\n`,
                );
            }
            created++;
        }
    }

    // Close issues for packages that are now compliant
    let closed = 0;
    for (const issue of existingIssuesByName.values()) {
        await linearService.closeIssue(issue.id, issue.identifier);
        if (!dryRun) {
            process.stderr.write(
                `Closed issue for ${issue.dependencyName} (${issue.identifier}) - now compliant\n`,
            );
        }
        closed++;
    }

    process.stderr.write(
        `\nSummary: created=${created}, updated=${updated}, closed=${closed}, closedDuplicates=${closedDuplicates}\n`,
    );

    return { created, updated, closed, closedDuplicates };
}
