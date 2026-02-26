// Copyright 2026 Descript, Inc
import type { DirectDependency, PackageVersionInfo, GitHubData } from '@dependicus/core';
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
} from '@dependicus/core';
import { LinearService, DependicusTicket } from './LinearService';
import type {
    OutdatedPackage,
    OutdatedGroup,
    LinearPolicy,
    TicketAssignment,
    VersionContext,
    LinearIssueSpec,
} from './types';
import {
    buildTicketDescription,
    buildGroupTicketDescription,
    buildNewVersionsComment,
} from './ticketDescriptions';

export interface TicketReconcilerConfig {
    linearApiKey: string;
    dryRun?: boolean;
    /** Base URL for Dependicus HTML pages (for links in ticket descriptions) */
    dependicusBaseUrl: string;
    /** Cooldown days before creating tickets for newly-published versions */
    cooldownDays?: number;
    /** Whether to restrict new ticket creation (e.g., only on main branch) */
    allowNewTickets?: boolean;
}

export interface ReconciliationResult {
    created: number;
    updated: number;
    closed: number;
    closedDuplicates: number;
}

/**
 * Check if any package in the list has had a major version published since the given date.
 * Used for groups where we can't compare version numbers from the ticket title.
 *
 * Checks ALL major versions in versionsBetween, not just the first one, because
 * there may be multiple major version jumps (e.g., 18.0.0 and 19.0.0) and only
 * a newer one might have been published after the given date.
 */
function hasMajorVersionPublishedSince(
    packages: OutdatedPackage[],
    sinceDate: string,
    store: FactStore,
): boolean {
    const sinceTime = new Date(sinceDate).getTime();

    for (const pkg of packages) {
        const version = pkg.versions[0];
        if (!version) continue;

        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(
                pkg.packageName,
                version.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];

        const currentMajor = parseInt(version.version.split('.')[0] ?? '0', 10);

        for (const v of versionsBetween) {
            if (v.isPrerelease) continue;

            const vMajor = parseInt(v.version.split('.')[0] ?? '0', 10);
            if (vMajor > currentMajor) {
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
    return policy.type === 'noTicket' ? undefined : policy.rateLimitDays;
}

/** Whether a policy represents a notifications-only / FYI package. */
function isFyiPolicy(policy: LinearPolicy): boolean {
    return policy.type === 'fyi';
}

/**
 * Check if a ticket update should be skipped due to rate limiting.
 * Returns the rate limit days if should skip, undefined if should proceed.
 */
function shouldSkipUpdateDueToRateLimit(
    policy: LinearPolicy,
    ticketUpdatedAt: string,
    hasMajorRelease: boolean,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy);
    if (rateLimitDays === undefined) {
        return undefined;
    }

    const withinRateLimit = isWithinNotificationRateLimit(ticketUpdatedAt, rateLimitDays);

    if (withinRateLimit && !hasMajorRelease) {
        return rateLimitDays;
    }

    return undefined;
}

/**
 * Check if ticket creation should be skipped due to rate limiting.
 * Returns the rate limit days if should skip, undefined if should proceed.
 *
 * For single packages: checks if the first version of the update type was published within rate limit.
 * For groups: checks if ALL packages are within the rate limit period.
 */
function shouldSkipCreateDueToRateLimit(
    policy: LinearPolicy,
    packages: OutdatedPackage[],
    store: FactStore,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy);
    if (rateLimitDays === undefined) {
        return undefined;
    }

    // Check if any package has a major update (bypasses rate limit)
    const hasMajorUpdate = packages.some((pkg) => pkg.worstCompliance.updateType === 'major');
    if (hasMajorUpdate) {
        return undefined;
    }

    // Check if all packages are within the rate limit period
    const allWithinRateLimit = packages.every((pkg) => {
        const version = pkg.versions[0];
        if (!version) return true;
        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(
                pkg.packageName,
                version.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];
        return isWithinCooldown(
            version.version,
            versionsBetween,
            pkg.worstCompliance.updateType,
            rateLimitDays,
        );
    });

    if (allWithinRateLimit) {
        return rateLimitDays;
    }

    return undefined;
}

/** Default policy when the ticket spec doesn't specify one. */
const DEFAULT_POLICY: LinearPolicy = { type: 'fyi' };

/** Default assignment when the ticket spec doesn't specify one. */
const DEFAULT_ASSIGNMENT: TicketAssignment = { type: 'unassigned' };

/**
 * Aggregate assignment from multiple versions of the same package.
 * If any version returns unassigned, the package is unassigned.
 * Only if all versions delegate to the same assignee does the package get delegated.
 */
function aggregateAssignment(
    existing: TicketAssignment,
    incoming: TicketAssignment,
): TicketAssignment {
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

export async function reconcileTickets(
    dependencies: DirectDependency[],
    store: FactStore,
    config: TicketReconcilerConfig,
    getLinearIssueSpec?: (context: VersionContext, store: FactStore) => LinearIssueSpec | undefined,
): Promise<ReconciliationResult> {
    const dryRun = config.dryRun ?? false;
    const allowNewTickets = config.allowNewTickets ?? true;
    const dependicusBaseUrl = config.dependicusBaseUrl;

    const linearService = new LinearService(config.linearApiKey, { dryRun });

    // Find out-of-date packages (group by package name)
    const outdatedPackages = new Map<string, OutdatedPackage>();

    for (const dep of dependencies) {
        for (const version of dep.versions) {
            // Skip if already on latest version
            if (version.version === version.latestVersion) continue;

            // Determine update type (major/minor/patch) based on latest version
            const updateType = getUpdateType(version.version, version.latestVersion);
            if (!updateType) {
                process.stderr.write(
                    `  Skipping ${dep.packageName}@${version.version}: cannot parse version or already up-to-date\n`,
                );
                continue;
            }

            // Build VersionContext and call consumer callback
            const versionContext: VersionContext = {
                packageName: dep.packageName,
                currentVersion: version.version,
                latestVersion: version.latestVersion,
            };

            const ctx = getLinearIssueSpec?.(versionContext, store);
            if (!ctx) continue;

            const policy = ctx.policy ?? DEFAULT_POLICY;
            const assignment = ctx.assignment ?? DEFAULT_ASSIGNMENT;

            // noTicket policy — skip entirely
            if (policy.type === 'noTicket') continue;

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

            const existing = outdatedPackages.get(dep.packageName);

            if (!existing) {
                outdatedPackages.set(dep.packageName, {
                    packageName: dep.packageName,
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

    process.stderr.write(`Found ${outdatedPackages.size} out-of-date packages\n`);

    // Separate packages into grouped and ungrouped
    const ungroupedPackages = new Map<string, OutdatedPackage>();
    const packagesByGroup = new Map<string, OutdatedPackage[]>();

    for (const pkg of outdatedPackages.values()) {
        if (pkg.group) {
            const groupPackages = packagesByGroup.get(pkg.group) ?? [];
            groupPackages.push(pkg);
            packagesByGroup.set(pkg.group, groupPackages);
        } else {
            ungroupedPackages.set(pkg.packageName, pkg);
        }
    }

    // Build OutdatedGroup objects from grouped packages
    const outdatedGroups = new Map<string, OutdatedGroup>();
    for (const [groupName, packages] of packagesByGroup) {
        // Use the first package's team info (all packages in a group should have the same team)
        const firstPkg = packages[0];
        if (!firstPkg) continue;

        // Calculate worst compliance across all packages in the group
        // Prefer packages with actual SLO thresholds over notifications-only packages
        let worstCompliance = firstPkg.worstCompliance;
        let groupPolicy: LinearPolicy = firstPkg.policy;

        for (const pkg of packages.slice(1)) {
            // Aggregate policy — dueDate wins over fyi
            groupPolicy = aggregatePolicy(groupPolicy, pkg.policy);

            // Determine if this package's compliance is "worse" than current worst
            // Priority: 1) Higher daysOverdue, 2) Has actual SLO threshold vs notifications-only
            const currentHasThreshold = worstCompliance.thresholdDays !== undefined;
            const pkgHasThreshold = pkg.worstCompliance.thresholdDays !== undefined;

            const shouldReplace =
                pkg.worstCompliance.daysOverdue > worstCompliance.daysOverdue ||
                (pkg.worstCompliance.daysOverdue === worstCompliance.daysOverdue &&
                    pkgHasThreshold &&
                    !currentHasThreshold);

            if (shouldReplace) {
                worstCompliance = pkg.worstCompliance;
            }
        }

        outdatedGroups.set(groupName, {
            groupName,
            packages,
            teamId: firstPkg.teamId,
            policy: groupPolicy,
            worstCompliance,
        });
    }

    process.stderr.write(
        `  Ungrouped: ${ungroupedPackages.size}, Groups: ${outdatedGroups.size} (${packagesByGroup.size > 0 ? [...packagesByGroup.values()].reduce((sum, pkgs) => sum + pkgs.length, 0) : 0} packages)\n`,
    );

    // Search for existing tickets (by Dependicus label across all teams)
    process.stderr.write('Searching for existing Dependicus tickets...\n');
    const existingTickets = await linearService.searchDependicusTickets((fetched, page) => {
        process.stderr.write(`  Fetched ${fetched} tickets (page ${page})...\n`);
    });
    process.stderr.write(`Found ${existingTickets.length} existing tickets\n`);

    // Build maps for deduplication
    const existingTicketsByPackage = new Map<string, DependicusTicket>();
    const existingTicketsByTitle = new Set<string>();
    const duplicateTickets: DependicusTicket[] = [];

    for (const ticket of existingTickets) {
        if (!existingTicketsByPackage.has(ticket.packageName)) {
            existingTicketsByPackage.set(ticket.packageName, ticket);
        } else {
            duplicateTickets.push(ticket);
        }
        existingTicketsByTitle.add(ticket.title);
    }

    // Close duplicate tickets proactively
    let closedDuplicates = 0;
    if (duplicateTickets.length > 0) {
        process.stderr.write(`Found ${duplicateTickets.length} duplicate tickets to close...\n`);
        for (const duplicate of duplicateTickets) {
            try {
                await linearService.closeTicket(duplicate.id, duplicate.identifier);
                if (!dryRun) {
                    process.stderr.write(
                        `Closed duplicate ticket for ${duplicate.packageName} (${duplicate.identifier})\n`,
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

    // Process non-compliant packages
    let created = 0;
    let updated = 0;

    // Process ungrouped packages
    for (const pkg of ungroupedPackages.values()) {
        const existingTicket = existingTicketsByPackage.get(pkg.packageName);
        const version = pkg.versions[0];
        if (!version) {
            throw new Error(`No versions found for package ${pkg.packageName}`);
        }

        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(
                pkg.packageName,
                version.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];

        const notificationsOnly = isFyiPolicy(pkg.policy);

        // Calculate due date (undefined for fyi packages)
        const dueDate =
            pkg.worstCompliance.thresholdDays !== undefined
                ? calculateDueDate(
                      version.version,
                      versionsBetween,
                      pkg.worstCompliance.updateType,
                      pkg.worstCompliance.thresholdDays,
                      version.publishDate,
                  )
                : undefined;

        // Build title and description
        const effectiveLatestVersion = pkg.targetVersion ?? version.latestVersion;

        const minVersion = notificationsOnly
            ? effectiveLatestVersion
            : (findFirstVersionOfType(
                  version.version,
                  versionsBetween,
                  pkg.worstCompliance.updateType,
              )?.version ?? effectiveLatestVersion);
        const title = buildTicketTitle(
            pkg.packageName,
            version.version,
            minVersion,
            effectiveLatestVersion,
            { notificationsOnly },
        );
        const description = buildTicketDescription(
            pkg,
            store,
            minVersion,
            effectiveLatestVersion,
            dependicusBaseUrl,
        );

        if (existingTicket) {
            // Ticket exists - check if it's in a state where we should skip updating
            const ticketStateName = existingTicket.state.name?.toLowerCase();
            const skipUpdate = ticketStateName === 'pr' || ticketStateName === 'verify';

            if (skipUpdate) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${pkg.packageName} (${existingTicket.identifier}) - ticket in ${existingTicket.state.name} state\n`,
                    );
                }
                existingTicketsByPackage.delete(pkg.packageName);
                continue;
            }

            // Check if new versions were released since last update
            const oldLatestVersion = extractLatestVersionFromTitle(existingTicket.title);
            const hasNewVersions = oldLatestVersion && oldLatestVersion !== effectiveLatestVersion;

            // For fyi packages with rate limits, check if we should skip
            const skipRateLimitDays = shouldSkipUpdateDueToRateLimit(
                pkg.policy,
                existingTicket.updatedAt,
                hasMajorVersionSinceLastUpdate(oldLatestVersion, effectiveLatestVersion),
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${pkg.packageName} (${existingTicket.identifier}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingTicketsByPackage.delete(pkg.packageName);
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
                    const github = store.getPackageFact<GitHubData>(
                        pkg.packageName,
                        FactKeys.GITHUB_DATA,
                    );
                    comment = buildNewVersionsComment(
                        pkg.packageName,
                        oldLatestVersion,
                        newVersions,
                        github,
                    );
                }
            }

            // Update ticket
            await linearService.updateTicket(
                existingTicket.id,
                {
                    title,
                    description,
                    dueDate,
                },
                existingTicket.identifier,
            );
            if (comment) {
                await linearService.createComment(
                    existingTicket.id,
                    comment,
                    existingTicket.identifier,
                );
                if (!dryRun) {
                    process.stderr.write(
                        `Updated ${pkg.packageName} (${existingTicket.identifier}) + comment (${newVersions.length} new versions)\n`,
                    );
                }
            } else if (!dryRun) {
                process.stderr.write(`Updated ${pkg.packageName} (${existingTicket.identifier})\n`);
            }
            updated++;

            existingTicketsByPackage.delete(pkg.packageName);
        } else {
            // No ticket exists - only create if allowed
            if (!allowNewTickets) {
                process.stderr.write(
                    `Skipping ticket creation for ${pkg.packageName} (new ticket creation disabled)\n`,
                );
                continue;
            }

            // For fyi packages with rate limits, apply rate limiting
            const skipRateLimitDays = shouldSkipCreateDueToRateLimit(pkg.policy, [pkg], store);
            if (skipRateLimitDays !== undefined) {
                process.stderr.write(
                    `Skipping ${pkg.packageName} - within ${skipRateLimitDays}-day rate limit (no existing ticket)\n`,
                );
                continue;
            }

            // Double-check: skip if a ticket with this exact title already exists
            const fullTitle = `[Dependicus] ${title}`;
            if (existingTicketsByTitle.has(fullTitle)) {
                process.stderr.write(
                    `Skipping ${pkg.packageName} - ticket with same title already exists\n`,
                );
                continue;
            }

            // Determine delegate from assignment
            const delegateId =
                pkg.assignment.type === 'delegate' ? pkg.assignment.assigneeId : undefined;

            // Create ticket
            const identifier = await linearService.createTicket({
                packageName: pkg.packageName,
                title,
                teamId: pkg.teamId,
                dueDate,
                description,
                delegateId,
            });

            existingTicketsByTitle.add(fullTitle);

            if (!dryRun) {
                const delegateNote = delegateId ? ' [delegated]' : '';
                process.stderr.write(
                    `Created ticket for ${pkg.packageName} (${identifier})${delegateNote}\n`,
                );
            }
            created++;
        }
    }

    // Process grouped packages
    for (const group of outdatedGroups.values()) {
        const existingTicket = existingTicketsByPackage.get(group.groupName);
        const groupNotificationsOnly = isFyiPolicy(group.policy);

        // Calculate due date based on worst compliance in the group
        let earliestDueDate: Date | undefined;
        if (group.worstCompliance.thresholdDays !== undefined) {
            for (const pkg of group.packages) {
                const version = pkg.versions[0];
                if (!version) continue;

                const versionsBetween =
                    store.getVersionFact<PackageVersionInfo[]>(
                        pkg.packageName,
                        version.version,
                        FactKeys.VERSIONS_BETWEEN,
                    ) ?? [];

                const pkgDueDate = calculateDueDate(
                    version.version,
                    versionsBetween,
                    pkg.worstCompliance.updateType,
                    pkg.worstCompliance.thresholdDays ?? group.worstCompliance.thresholdDays ?? 0,
                    version.publishDate,
                );
                if (!earliestDueDate || pkgDueDate < earliestDueDate) {
                    earliestDueDate = pkgDueDate;
                }
            }
        }

        const title = buildGroupTicketTitle(group.groupName, group.packages.length, {
            notificationsOnly: groupNotificationsOnly,
        });
        const description = buildGroupTicketDescription(group, store, dependicusBaseUrl);

        if (existingTicket) {
            const ticketStateName = existingTicket.state.name?.toLowerCase();
            const skipUpdate = ticketStateName === 'pr' || ticketStateName === 'verify';

            if (skipUpdate) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${group.groupName} group (${existingTicket.identifier}) - ticket in ${existingTicket.state.name} state\n`,
                    );
                }
                existingTicketsByPackage.delete(group.groupName);
                continue;
            }

            // For fyi groups with rate limits, check if we should skip
            const hasMajorRelease = hasMajorVersionPublishedSince(
                group.packages,
                existingTicket.updatedAt,
                store,
            );
            const skipRateLimitDays = shouldSkipUpdateDueToRateLimit(
                group.policy,
                existingTicket.updatedAt,
                hasMajorRelease,
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${group.groupName} group (${existingTicket.identifier}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingTicketsByPackage.delete(group.groupName);
                continue;
            }

            // Update ticket
            await linearService.updateTicket(
                existingTicket.id,
                {
                    title,
                    description,
                    dueDate: earliestDueDate,
                },
                existingTicket.identifier,
            );
            if (!dryRun) {
                process.stderr.write(
                    `Updated ${group.groupName} group (${existingTicket.identifier}) - ${group.packages.length} packages\n`,
                );
            }
            updated++;

            existingTicketsByPackage.delete(group.groupName);
        } else {
            // No ticket exists - only create if allowed
            if (!allowNewTickets) {
                process.stderr.write(
                    `Skipping ticket creation for ${group.groupName} group (new ticket creation disabled)\n`,
                );
                continue;
            }

            // For fyi groups with rate limits, apply rate limiting
            const skipRateLimitDays = shouldSkipCreateDueToRateLimit(
                group.policy,
                group.packages,
                store,
            );
            if (skipRateLimitDays !== undefined) {
                process.stderr.write(
                    `Skipping ${group.groupName} group - within ${skipRateLimitDays}-day rate limit (no existing ticket)\n`,
                );
                continue;
            }

            // Double-check: skip if a ticket with this exact title already exists
            const fullTitle = `[Dependicus] ${title}`;
            if (existingTicketsByTitle.has(fullTitle)) {
                process.stderr.write(
                    `Skipping ${group.groupName} group - ticket with same title already exists\n`,
                );
                continue;
            }

            // Create ticket for the group (don't auto-delegate groups - they're more complex)
            const identifier = await linearService.createTicket({
                packageName: group.groupName,
                title,
                teamId: group.teamId,
                dueDate: earliestDueDate,
                description,
            });

            existingTicketsByTitle.add(fullTitle);

            if (!dryRun) {
                process.stderr.write(
                    `Created ticket for ${group.groupName} group (${identifier}) - ${group.packages.length} packages\n`,
                );
            }
            created++;
        }
    }

    // Close tickets for packages that are now compliant
    let closed = 0;
    for (const ticket of existingTicketsByPackage.values()) {
        await linearService.closeTicket(ticket.id, ticket.identifier);
        if (!dryRun) {
            process.stderr.write(
                `Closed ticket for ${ticket.packageName} (${ticket.identifier}) - now compliant\n`,
            );
        }
        closed++;
    }

    process.stderr.write(
        `\nSummary: created=${created}, updated=${updated}, closed=${closed}, closedDuplicates=${closedDuplicates}\n`,
    );

    return { created, updated, closed, closedDuplicates };
}
