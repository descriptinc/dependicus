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
import { GitHubIssueService, DependicusIssue } from './GitHubIssueService';
import type {
    OutdatedDependency,
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
    /** Provider info map (ecosystem -> ProviderInfo) for presentation metadata */
    providerInfoMap?: Map<string, ProviderInfo>;
    /** Default rate limit days for notification throttling. Used when per-policy rateLimitDays is not set. */
    rateLimitDays?: number;
}

export interface ReconciliationResult {
    created: number;
    updated: number;
    skipped: number;
    closed: number;
    closedDuplicates: number;
}

/**
 * Check if any package in the list has had a major version published since the given date.
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

/** Extract rate limit days from a policy, falling back to a config-level default. */
function policyRateLimitDays(
    policy: GitHubIssuePolicy,
    configDefault?: number,
): number | undefined {
    if (policy.type === 'skip') return undefined;
    return policy.rateLimitDays ?? configDefault;
}

/** Whether a policy represents a notifications-only / FYI dependency. */
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
    configDefault?: number,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy, configDefault);
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
    deps: OutdatedDependency[],
    store: FactStore,
    configDefault?: number,
): number | undefined {
    const rateLimitDays = policyRateLimitDays(policy, configDefault);
    if (rateLimitDays === undefined) {
        return undefined;
    }

    const hasMajorUpdate = deps.some((dep) => dep.worstCompliance.updateType === 'major');
    if (hasMajorUpdate) {
        return undefined;
    }

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
const DEFAULT_POLICY: GitHubIssuePolicy = { type: 'fyi' };

/** Default assignment when the issue spec doesn't specify one. */
const DEFAULT_ASSIGNMENT: GitHubIssueAssignment = { type: 'unassigned' };

/**
 * Aggregate assignment from multiple versions of the same dependency.
 * If any version returns unassigned, the dependency is unassigned.
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
 * Aggregate policy from multiple versions of the same dependency.
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
    const configRateLimitDays = config.rateLimitDays;
    const dependicusBaseUrl = config.dependicusBaseUrl;
    const getDetailUrl: DetailUrlFn =
        config.getDetailUrl ??
        ((_eco, pkg, ver) => {
            const filename = getDetailFilename(pkg, ver);
            return `${dependicusBaseUrl}/details/${filename}`;
        });

    const githubService = new GitHubIssueService(config.githubToken, { dryRun });

    // Find out-of-date dependencies (group by dependency name)
    const outdatedDeps = new Map<string, OutdatedDependency>();

    for (const dep of dependencies) {
        for (const version of dep.versions) {
            if (version.version === version.latestVersion) continue;

            const updateType = getUpdateType(version.version, version.latestVersion);
            if (!updateType) {
                process.stderr.write(
                    `  Skipping ${dep.name}@${version.version}: cannot parse version or already up-to-date\n`,
                );
                continue;
            }

            const versionContext: VersionContext = {
                name: dep.name,
                ecosystem: dep.ecosystem,
                currentVersion: version.version,
                latestVersion: version.latestVersion,
            };

            const scopedStore = store.scoped(dep.ecosystem);
            const ctx = getGitHubIssueSpec?.(versionContext, scopedStore);
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
        const firstDep = deps[0];
        if (!firstDep) continue;

        let worstCompliance = firstDep.worstCompliance;
        let groupPolicy: GitHubIssuePolicy = firstDep.policy;

        for (const dep of deps.slice(1)) {
            groupPolicy = aggregatePolicy(groupPolicy, dep.policy);

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
            owner: firstDep.owner,
            repo: firstDep.repo,
            policy: groupPolicy,
            worstCompliance,
        });
    }

    process.stderr.write(
        `  Ungrouped: ${ungroupedDeps.size}, Groups: ${outdatedGroups.size} (${dependenciesByGroup.size > 0 ? [...dependenciesByGroup.values()].reduce((sum, d) => sum + d.length, 0) : 0} dependencies)\n`,
    );

    // Determine owner/repo from first outdated dependency (all must be same)
    const firstDep = outdatedDeps.values().next().value as OutdatedDependency | undefined;
    if (!firstDep && ungroupedDeps.size === 0 && outdatedGroups.size === 0) {
        process.stderr.write('No outdated dependencies to reconcile\n');
        return { created: 0, updated: 0, skipped: 0, closed: 0, closedDuplicates: 0 };
    }

    const owner = firstDep?.owner ?? '';
    const repo = firstDep?.repo ?? '';

    if (!owner || !repo) {
        process.stderr.write('No owner/repo found in issue specs\n');
        return { created: 0, updated: 0, skipped: 0, closed: 0, closedDuplicates: 0 };
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
    const existingIssuesByDependency = new Map<string, DependicusIssue>();
    const existingIssuesByTitle = new Set<string>();
    const duplicateIssues: DependicusIssue[] = [];

    for (const issue of existingIssues) {
        if (!existingIssuesByDependency.has(issue.dependencyName)) {
            existingIssuesByDependency.set(issue.dependencyName, issue);
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
                        `Closed duplicate issue for ${duplicate.dependencyName} (#${duplicate.number})\n`,
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

    // Process non-compliant dependencies
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Process ungrouped dependencies
    for (const dep of ungroupedDeps.values()) {
        const existingIssue = existingIssuesByDependency.get(dep.name);
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

        const dueDateStr = dueDate ? formatDueDateForTitle(dueDate) : undefined;

        // Build title and description
        const effectiveLatestVersion = dep.targetVersion ?? version.latestVersion;

        const minVersion = notificationsOnly
            ? effectiveLatestVersion
            : (findFirstVersionOfType(
                  version.version,
                  versionsBetween,
                  dep.worstCompliance.updateType,
              )?.version ?? effectiveLatestVersion);
        let title = buildTicketTitle(
            dep.name,
            version.version,
            minVersion,
            effectiveLatestVersion,
            { notificationsOnly },
        );
        if (dueDateStr && !notificationsOnly) {
            title = `${title} (due ${dueDateStr})`;
        }
        const providerInfo = config.providerInfoMap?.get(dep.ecosystem);
        const description = buildIssueDescription(
            dep,
            scopedStore,
            minVersion,
            effectiveLatestVersion,
            getDetailUrl,
            providerInfo,
            dueDateStr,
        );

        if (existingIssue) {
            // Check if new versions were released since last update
            const oldLatestVersion = extractLatestVersionFromTitle(existingIssue.title);
            const hasNewVersions = oldLatestVersion && oldLatestVersion !== effectiveLatestVersion;

            // For fyi dependencies with rate limits, check if we should skip
            const skipRateLimitDays = shouldSkipUpdateDueToRateLimit(
                dep.policy,
                existingIssue.updatedAt,
                hasMajorVersionSinceLastUpdate(oldLatestVersion, effectiveLatestVersion),
                configRateLimitDays,
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${dep.name} (#${existingIssue.number}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingIssuesByDependency.delete(dep.name);
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

            // Update issue (skip if title and body are unchanged)
            const fullTitle = `[Dependicus] ${title}`;
            const changed = existingIssue.title !== fullTitle || existingIssue.body !== description;
            if (changed) {
                await githubService.updateIssue(owner, repo, existingIssue.number, {
                    title,
                    description,
                });
                updated++;
            } else {
                skipped++;
            }
            if (comment) {
                await githubService.createComment(owner, repo, existingIssue.number, comment);
                if (!dryRun) {
                    process.stderr.write(
                        `Updated ${dep.name} (#${existingIssue.number}) + comment (${newVersions.length} new versions)\n`,
                    );
                }
            } else if (!dryRun) {
                if (changed) {
                    process.stderr.write(`Updated ${dep.name} (#${existingIssue.number})\n`);
                } else {
                    process.stderr.write(
                        `Skipped ${dep.name} (#${existingIssue.number}) - unchanged\n`,
                    );
                }
            }

            existingIssuesByDependency.delete(dep.name);
        } else {
            // No issue exists - only create if allowed
            if (!allowNewIssues) {
                process.stderr.write(
                    `Skipping issue creation for ${dep.name} (new issue creation disabled)\n`,
                );
                continue;
            }

            // For fyi dependencies with rate limits, apply rate limiting
            const skipRateLimitDays = shouldSkipCreateDueToRateLimit(
                dep.policy,
                [dep],
                store,
                configRateLimitDays,
            );
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

            // Determine assignees from assignment
            const assignees =
                dep.assignment.type === 'assign' ? dep.assignment.assignees : undefined;

            // Create issue
            const issueNumber = await githubService.createIssue({
                dependencyName: dep.name,
                title,
                owner,
                repo,
                description,
                labels: dep.labels,
                assignees,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                const assigneeNote = assignees?.length
                    ? ` [assigned to ${assignees.join(', ')}]`
                    : '';
                process.stderr.write(
                    `Created issue for ${dep.name} (#${issueNumber})${assigneeNote}\n`,
                );
            }
            created++;
        }
    }

    // Process grouped dependencies
    for (const group of outdatedGroups.values()) {
        const existingIssue = existingIssuesByDependency.get(group.groupName);
        const groupNotificationsOnly = isFyiPolicy(group.policy);

        // Calculate due date based on worst compliance in the group
        let earliestDueDate: Date | undefined;
        if (group.worstCompliance.thresholdDays !== undefined) {
            for (const dep of group.dependencies) {
                const version = dep.versions[0];
                if (!version) continue;

                const scoped = store.scoped(dep.ecosystem);
                const versionsBetween =
                    scoped.getVersionFact<PackageVersionInfo[]>(
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

        const dueDateStr = earliestDueDate ? formatDueDateForTitle(earliestDueDate) : undefined;

        let title = buildGroupTicketTitle(group.groupName, group.dependencies.length, {
            notificationsOnly: groupNotificationsOnly,
        });
        if (dueDateStr && !groupNotificationsOnly) {
            title = `${title} (due ${dueDateStr})`;
        }
        const description = buildGroupIssueDescription(
            group,
            store,
            getDetailUrl,
            config.providerInfoMap,
            dueDateStr,
        );

        if (existingIssue) {
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
                configRateLimitDays,
            );
            if (skipRateLimitDays !== undefined) {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipping ${group.groupName} group (#${existingIssue.number}) - within ${skipRateLimitDays}-day rate limit\n`,
                    );
                }
                existingIssuesByDependency.delete(group.groupName);
                continue;
            }

            // Update issue (skip if title and body are unchanged)
            const fullTitle = `[Dependicus] ${title}`;
            const changed = existingIssue.title !== fullTitle || existingIssue.body !== description;
            if (changed) {
                await githubService.updateIssue(owner, repo, existingIssue.number, {
                    title,
                    description,
                });
                if (!dryRun) {
                    process.stderr.write(
                        `Updated ${group.groupName} group (#${existingIssue.number}) - ${group.dependencies.length} dependencies\n`,
                    );
                }
                updated++;
            } else {
                if (!dryRun) {
                    process.stderr.write(
                        `Skipped ${group.groupName} group (#${existingIssue.number}) - unchanged\n`,
                    );
                }
                skipped++;
            }

            existingIssuesByDependency.delete(group.groupName);
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
                configRateLimitDays,
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
                dependencyName: group.groupName,
                title,
                owner,
                repo,
                description,
            });

            existingIssuesByTitle.add(fullTitle);

            if (!dryRun) {
                process.stderr.write(
                    `Created issue for ${group.groupName} group (#${issueNumber}) - ${group.dependencies.length} dependencies\n`,
                );
            }
            created++;
        }
    }

    // Close issues for dependencies that are now compliant
    let closed = 0;
    for (const issue of existingIssuesByDependency.values()) {
        await githubService.closeIssue(owner, repo, issue.number);
        if (!dryRun) {
            process.stderr.write(
                `Closed issue for ${issue.dependencyName} (#${issue.number}) - now compliant\n`,
            );
        }
        closed++;
    }

    process.stderr.write(
        `\nSummary: created=${created}, updated=${updated}, skipped=${skipped}, closed=${closed}, closedDuplicates=${closedDuplicates}\n`,
    );

    return { created, updated, skipped, closed, closedDuplicates };
}
