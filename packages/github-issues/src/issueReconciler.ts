// Copyright 2026 Descript, Inc
import type {
    DirectDependency,
    PackageVersionInfo,
    GitHubData,
    DetailUrlFn,
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
import { GitHubIssueService, DependicusIssue } from './GitHubIssueService';
import type {
    OutdatedPackage,
    OutdatedGroup,
    GitHubIssuePolicy,
    GitHubIssueAssignment,
    VersionContext,
    GitHubIssueSpec,
} from './types';
import {
    buildIssueDescription,
    buildGroupIssueDescription,
    buildNewVersionsComment,
} from './issueDescriptions';

export interface IssueReconcilerConfig {
    githubToken: string;
    dryRun?: boolean;
    /** Base URL for Dependicus HTML pages (for links in issue descriptions) */
    dependicusBaseUrl: string;
    /** Builds the full detail page URL for a given package version. */
    getDetailUrl?: DetailUrlFn;
    /** Cooldown days before creating issues for newly-published versions */
    cooldownDays?: number;
    /** Whether to restrict new issue creation (e.g., only on main branch) */
    allowNewIssues?: boolean;
}

export interface ReconciliationResult {
    created: number;
    updated: number;
    closed: number;
    closedDuplicates: number;
}

/**
 * Check if any package in the list has had a major version published since the given date.
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
function policyRateLimitDays(policy: GitHubIssuePolicy): number | undefined {
    return policy.type === 'skip' ? undefined : policy.rateLimitDays;
}

/** Whether a policy represents a notifications-only / FYI package. */
function isFyiPolicy(policy: GitHubIssuePolicy): boolean {
    return policy.type === 'fyi';
}

/**
 * Check if an issue update should be skipped due to rate limiting.
 */
function shouldSkipUpdateDueToRateLimit(
    policy: GitHubIssuePolicy,
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
 */
function shouldSkipCreateDueToRateLimit(
    policy: GitHubIssuePolicy,
    packages: OutdatedPackage[],
    store: FactStore,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy);
    if (rateLimitDays === undefined) {
        return undefined;
    }

    const hasMajorUpdate = packages.some((pkg) => pkg.worstCompliance.updateType === 'major');
    if (hasMajorUpdate) {
        return undefined;
    }

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
const DEFAULT_POLICY: GitHubIssuePolicy = { type: 'fyi' };

/** Default assignment when the issue spec doesn't specify one. */
const DEFAULT_ASSIGNMENT: GitHubIssueAssignment = { type: 'unassigned' };

/**
 * Aggregate assignment from multiple versions of the same package.
 * If any version returns unassigned, the package is unassigned.
 */
function aggregateAssignment(
    existing: GitHubIssueAssignment,
    incoming: GitHubIssueAssignment,
): GitHubIssueAssignment {
    if (existing.type === 'unassigned' || incoming.type === 'unassigned') {
        return { type: 'unassigned' };
    }
    // Merge assignees from both
    const merged = [...new Set([...existing.assignees, ...incoming.assignees])];
    return { type: 'assign', assignees: merged };
}

/**
 * Aggregate policy from multiple versions of the same package.
 * dueDate wins over fyi (it's the "worse" policy requiring action).
 */
function aggregatePolicy(
    existing: GitHubIssuePolicy,
    incoming: GitHubIssuePolicy,
): GitHubIssuePolicy {
    if (existing.type === 'dueDate') return existing;
    if (incoming.type === 'dueDate') return incoming;
    return existing;
}

/** Format a due date for inclusion in an issue title. */
function formatDueDateForTitle(dueDate: Date): string {
    return dueDate.toISOString().split('T')[0]!;
}

export async function reconcileGitHubIssues(
    dependencies: DirectDependency[],
    store: FactStore,
    config: IssueReconcilerConfig,
    getGitHubIssueSpec?: (context: VersionContext, store: FactStore) => GitHubIssueSpec | undefined,
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

    const githubService = new GitHubIssueService(config.githubToken, { dryRun });

    // Find out-of-date packages (group by package name)
    const outdatedPackages = new Map<string, OutdatedPackage>();

    for (const dep of dependencies) {
        for (const version of dep.versions) {
            if (version.version === version.latestVersion) continue;

            const updateType = getUpdateType(version.version, version.latestVersion);
            if (!updateType) {
                process.stderr.write(
                    `  Skipping ${dep.packageName}@${version.version}: cannot parse version or already up-to-date\n`,
                );
                continue;
            }

            const versionContext: VersionContext = {
                packageName: dep.packageName,
                currentVersion: version.version,
                latestVersion: version.latestVersion,
            };

            const ctx = getGitHubIssueSpec?.(versionContext, store);
            if (!ctx) continue;

            const policy = ctx.policy ?? DEFAULT_POLICY;
            const assignment = ctx.assignment ?? DEFAULT_ASSIGNMENT;

            if (policy.type === 'skip') continue;

            const isNotificationsOnly = isFyiPolicy(policy);

            const targetVersion = ctx.targetVersion;
            const availableMajorVersion = ctx.availableMajorVersion;

            const effectiveUpdateType = targetVersion
                ? (getUpdateType(version.version, targetVersion) ?? updateType)
                : updateType;

            const daysOverdue = ctx.daysOverdue ?? 0;
            const thresholdDays = ctx.thresholdDays;

            if (thresholdDays === undefined && !isNotificationsOnly && targetVersion === undefined)
                continue;

            const effectivePolicy: GitHubIssuePolicy = isNotificationsOnly
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
                    owner: ctx.owner,
                    repo: ctx.repo,
                    policy: effectivePolicy,
                    assignment,
                    group: ctx.group,
                    ownerLabel: ctx.ownerLabel,
                    labels: ctx.labels,
                    descriptionSections: ctx.descriptionSections,
                });
            } else {
                existing.versions.push(version);

                existing.assignment = aggregateAssignment(existing.assignment, assignment);

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
        const firstPkg = packages[0];
        if (!firstPkg) continue;

        let worstCompliance = firstPkg.worstCompliance;
        let groupPolicy: GitHubIssuePolicy = firstPkg.policy;

        for (const pkg of packages.slice(1)) {
            groupPolicy = aggregatePolicy(groupPolicy, pkg.policy);

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
            owner: firstPkg.owner,
            repo: firstPkg.repo,
            policy: groupPolicy,
            worstCompliance,
        });
    }

    process.stderr.write(
        `  Ungrouped: ${ungroupedPackages.size}, Groups: ${outdatedGroups.size} (${packagesByGroup.size > 0 ? [...packagesByGroup.values()].reduce((sum, pkgs) => sum + pkgs.length, 0) : 0} packages)\n`,
    );

    // Determine owner/repo from first outdated package (all must be same)
    const firstPkg = outdatedPackages.values().next().value as OutdatedPackage | undefined;
    if (!firstPkg && ungroupedPackages.size === 0 && outdatedGroups.size === 0) {
        process.stderr.write('No outdated packages to reconcile\n');
        return { created: 0, updated: 0, closed: 0, closedDuplicates: 0 };
    }

    const owner = firstPkg?.owner ?? '';
    const repo = firstPkg?.repo ?? '';

    if (!owner || !repo) {
        process.stderr.write('No owner/repo found in issue specs\n');
        return { created: 0, updated: 0, closed: 0, closedDuplicates: 0 };
    }

    // Search for existing issues
    process.stderr.write(`Searching for existing Dependicus issues in ${owner}/${repo}...\n`);
    const existingIssues = await githubService.searchDependicusIssues(
        owner,
        repo,
        (fetched, page) => {
            process.stderr.write(`  Fetched ${fetched} issues (page ${page})...\n`);
        },
    );
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
                await githubService.closeIssue(owner, repo, duplicate.number);
                if (!dryRun) {
                    process.stderr.write(
                        `Closed duplicate issue for ${duplicate.packageName} (#${duplicate.number})\n`,
                    );
                }
                closedDuplicates++;
            } catch (error) {
                process.stderr.write(
                    `Warning: Failed to close duplicate #${duplicate.number}: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
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

        const dueDateStr = dueDate ? formatDueDateForTitle(dueDate) : undefined;

        // Build title and description
        const effectiveLatestVersion = pkg.targetVersion ?? version.latestVersion;

        const minVersion = notificationsOnly
            ? effectiveLatestVersion
            : (findFirstVersionOfType(
                  version.version,
                  versionsBetween,
                  pkg.worstCompliance.updateType,
              )?.version ?? effectiveLatestVersion);
        let title = buildTicketTitle(
            pkg.packageName,
            version.version,
            minVersion,
            effectiveLatestVersion,
            { notificationsOnly },
        );
        if (dueDateStr && !notificationsOnly) {
            title = `${title} (due ${dueDateStr})`;
        }
        const description = buildIssueDescription(
            pkg,
            scopedStore,
            minVersion,
            effectiveLatestVersion,
            getDetailUrl,
            dueDateStr,
        );

        if (existingIssue) {
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
                        `Skipping ${pkg.packageName} (#${existingIssue.number}) - within ${skipRateLimitDays}-day rate limit\n`,
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
            await githubService.updateIssue(owner, repo, existingIssue.number, {
                title,
                description,
            });
            if (comment) {
                await githubService.createComment(owner, repo, existingIssue.number, comment);
                if (!dryRun) {
                    process.stderr.write(
                        `Updated ${pkg.packageName} (#${existingIssue.number}) + comment (${newVersions.length} new versions)\n`,
                    );
                }
            } else if (!dryRun) {
                process.stderr.write(`Updated ${pkg.packageName} (#${existingIssue.number})\n`);
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

            // Determine assignees from assignment
            const assignees =
                pkg.assignment.type === 'assign' ? pkg.assignment.assignees : undefined;

            // Create issue
            const issueNumber = await githubService.createIssue({
                packageName: pkg.packageName,
                title,
                owner,
                repo,
                description,
                labels: pkg.labels,
                assignees,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                const assigneeNote = assignees?.length
                    ? ` [assigned to ${assignees.join(', ')}]`
                    : '';
                process.stderr.write(
                    `Created issue for ${pkg.packageName} (#${issueNumber})${assigneeNote}\n`,
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

                const scoped = store.scoped(pkg.ecosystem);
                const versionsBetween =
                    scoped.getVersionFact<PackageVersionInfo[]>(
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

        const dueDateStr = earliestDueDate ? formatDueDateForTitle(earliestDueDate) : undefined;

        let title = buildGroupTicketTitle(group.groupName, group.packages.length, {
            notificationsOnly: groupNotificationsOnly,
        });
        if (dueDateStr && !groupNotificationsOnly) {
            title = `${title} (due ${dueDateStr})`;
        }
        const description = buildGroupIssueDescription(group, store, getDetailUrl, dueDateStr);

        if (existingIssue) {
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
                        `Skipping ${group.groupName} group (#${existingIssue.number}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingIssuesByPackage.delete(group.groupName);
                continue;
            }

            // Update issue
            await githubService.updateIssue(owner, repo, existingIssue.number, {
                title,
                description,
            });
            if (!dryRun) {
                process.stderr.write(
                    `Updated ${group.groupName} group (#${existingIssue.number}) - ${group.packages.length} packages\n`,
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

            // Create issue for the group
            const issueNumber = await githubService.createIssue({
                packageName: group.groupName,
                title,
                owner,
                repo,
                description,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                process.stderr.write(
                    `Created issue for ${group.groupName} group (#${issueNumber}) - ${group.packages.length} packages\n`,
                );
            }
            created++;
        }
    }

    // Close issues for packages that are now compliant
    let closed = 0;
    for (const issue of existingIssuesByPackage.values()) {
        await githubService.closeIssue(owner, repo, issue.number);
        if (!dryRun) {
            process.stderr.write(
                `Closed issue for ${issue.packageName} (#${issue.number}) - now compliant\n`,
            );
        }
        closed++;
    }

    process.stderr.write(
        `\nSummary: created=${created}, updated=${updated}, closed=${closed}, closedDuplicates=${closedDuplicates}\n`,
    );

    return { created, updated, closed, closedDuplicates };
}
