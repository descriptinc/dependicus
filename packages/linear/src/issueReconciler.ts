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
    OutdatedPackage,
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
    packages: OutdatedPackage[],
    sinceDate: string,
    store: FactStore,
): boolean {
    const sinceTime = new Date(sinceDate).getTime();

    for (const pkg of packages) {
        const version = pkg.versions[0];
        if (!version) continue;

        const scoped = store.scoped(pkg.ecosystem);
        const versionsBetween =
            scoped.getVersionFact<PackageVersionInfo[]>(
                pkg.packageName,
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
        const scoped = store.scoped(pkg.ecosystem);
        const versionsBetween =
            scoped.getVersionFact<PackageVersionInfo[]>(
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

/** Default policy when the issue spec doesn't specify one. */
const DEFAULT_POLICY: LinearPolicy = { type: 'fyi' };

/** Default assignment when the issue spec doesn't specify one. */
const DEFAULT_ASSIGNMENT: IssueAssignment = { type: 'unassigned' };

/**
 * Aggregate assignment from multiple versions of the same package.
 * If any version returns unassigned, the package is unassigned.
 * Only if all versions delegate to the same assignee does the package get delegated.
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

            const existing = outdatedPackages.get(dep.packageName);

            if (!existing) {
                outdatedPackages.set(dep.packageName, {
                    packageName: dep.packageName,
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

    // Search for existing issues (by Dependicus label across all teams)
    process.stderr.write('Searching for existing Dependicus issues...\n');
    const existingIssues = await linearService.searchDependicusIssues((fetched, page) => {
        process.stderr.write(`  Fetched ${fetched} issues (page ${page})...\n`);
    });
    process.stderr.write(`Found ${existingIssues.length} existing issues\n`);

    // Build maps for deduplication
    const existingIssuesByPackage = new Map<string, DependicusIssue>();
    const existingIssuesByTitle = new Set<string>();
    const duplicateIssues: DependicusIssue[] = [];

    for (const issue of existingIssues) {
        if (!existingIssuesByPackage.has(issue.packageName)) {
            existingIssuesByPackage.set(issue.packageName, issue);
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
                        `Closed duplicate issue for ${duplicate.packageName} (${duplicate.identifier})\n`,
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
        const existingIssue = existingIssuesByPackage.get(pkg.packageName);
        const version = pkg.versions[0];
        if (!version) {
            throw new Error(`No versions found for package ${pkg.packageName}`);
        }

        const scopedStore = store.scoped(pkg.ecosystem);
        const versionsBetween =
            scopedStore.getVersionFact<PackageVersionInfo[]>(
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
        const providerInfo = config.providerInfoMap?.get(pkg.ecosystem);
        const description = buildIssueDescription(
            pkg,
            scopedStore,
            minVersion,
            effectiveLatestVersion,
            getDetailUrl,
            providerInfo,
        );

        if (existingIssue) {
            // Issue exists - check if it's in a state where we should skip updating
            const issueStateName = existingIssue.state.name?.toLowerCase();
            const skipUpdate = issueStateName === 'pr' || issueStateName === 'verify';

            if (skipUpdate) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${pkg.packageName} (${existingIssue.identifier}) - issue in ${existingIssue.state.name} state\n`,
                    );
                }
                existingIssuesByPackage.delete(pkg.packageName);
                continue;
            }

            // Check if new versions were released since last update
            const oldLatestVersion = extractLatestVersionFromTitle(existingIssue.title);
            const hasNewVersions = oldLatestVersion && oldLatestVersion !== effectiveLatestVersion;

            // For fyi packages with rate limits, check if we should skip
            const skipRateLimitDays = shouldSkipUpdateDueToRateLimit(
                pkg.policy,
                existingIssue.updatedAt,
                hasMajorVersionSinceLastUpdate(oldLatestVersion, effectiveLatestVersion),
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${pkg.packageName} (${existingIssue.identifier}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingIssuesByPackage.delete(pkg.packageName);
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
                    const github = scopedStore.getPackageFact<GitHubData>(
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
                        `Updated ${pkg.packageName} (${existingIssue.identifier}) + comment (${newVersions.length} new versions)\n`,
                    );
                }
            } else if (!dryRun) {
                process.stderr.write(`Updated ${pkg.packageName} (${existingIssue.identifier})\n`);
            }
            updated++;

            existingIssuesByPackage.delete(pkg.packageName);
        } else {
            // No issue exists - only create if allowed
            if (!allowNewIssues) {
                process.stderr.write(
                    `Skipping issue creation for ${pkg.packageName} (new issue creation disabled)\n`,
                );
                continue;
            }

            // For fyi packages with rate limits, apply rate limiting
            const skipRateLimitDays = shouldSkipCreateDueToRateLimit(pkg.policy, [pkg], store);
            if (skipRateLimitDays !== undefined) {
                process.stderr.write(
                    `Skipping ${pkg.packageName} - within ${skipRateLimitDays}-day rate limit (no existing issue)\n`,
                );
                continue;
            }

            // Double-check: skip if an issue with this exact title already exists
            const fullTitle = `[Dependicus] ${title}`;
            if (existingIssuesByTitle.has(fullTitle)) {
                process.stderr.write(
                    `Skipping ${pkg.packageName} - issue with same title already exists\n`,
                );
                continue;
            }

            // Determine delegate from assignment
            const delegateId =
                pkg.assignment.type === 'delegate' ? pkg.assignment.assigneeId : undefined;

            // Create issue
            const identifier = await linearService.createIssue({
                packageName: pkg.packageName,
                title,
                teamId: pkg.teamId,
                dueDate,
                description,
                delegateId,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                const delegateNote = delegateId ? ' [delegated]' : '';
                process.stderr.write(
                    `Created issue for ${pkg.packageName} (${identifier})${delegateNote}\n`,
                );
            }
            created++;
        }
    }

    // Process grouped packages
    for (const group of outdatedGroups.values()) {
        const existingIssue = existingIssuesByPackage.get(group.groupName);
        const groupNotificationsOnly = isFyiPolicy(group.policy);

        // Calculate due date based on worst compliance in the group
        let earliestDueDate: Date | undefined;
        if (group.worstCompliance.thresholdDays !== undefined) {
            for (const pkg of group.packages) {
                const version = pkg.versions[0];
                if (!version) continue;

                const pkgScopedStore = store.scoped(pkg.ecosystem);
                const versionsBetween =
                    pkgScopedStore.getVersionFact<PackageVersionInfo[]>(
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
        const description = buildGroupIssueDescription(
            group,
            store,
            getDetailUrl,
            config.providerInfoMap,
        );

        if (existingIssue) {
            const issueStateName = existingIssue.state.name?.toLowerCase();
            const skipUpdate = issueStateName === 'pr' || issueStateName === 'verify';

            if (skipUpdate) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${group.groupName} group (${existingIssue.identifier}) - issue in ${existingIssue.state.name} state\n`,
                    );
                }
                existingIssuesByPackage.delete(group.groupName);
                continue;
            }

            // For fyi groups with rate limits, check if we should skip
            const hasMajorRelease = hasMajorVersionPublishedSince(
                group.packages,
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
                existingIssuesByPackage.delete(group.groupName);
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
                    `Updated ${group.groupName} group (${existingIssue.identifier}) - ${group.packages.length} packages\n`,
                );
            }
            updated++;

            existingIssuesByPackage.delete(group.groupName);
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
                group.packages,
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
                packageName: group.groupName,
                title,
                teamId: group.teamId,
                dueDate: earliestDueDate,
                description,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                process.stderr.write(
                    `Created issue for ${group.groupName} group (${identifier}) - ${group.packages.length} packages\n`,
                );
            }
            created++;
        }
    }

    // Close issues for packages that are now compliant
    let closed = 0;
    for (const issue of existingIssuesByPackage.values()) {
        await linearService.closeIssue(issue.id, issue.identifier);
        if (!dryRun) {
            process.stderr.write(
                `Closed issue for ${issue.packageName} (${issue.identifier}) - now compliant\n`,
            );
        }
        closed++;
    }

    process.stderr.write(
        `\nSummary: created=${created}, updated=${updated}, closed=${closed}, closedDuplicates=${closedDuplicates}\n`,
    );

    return { created, updated, closed, closedDuplicates };
}
