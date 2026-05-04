import {
    parse as parseSemver,
    coerce as coerceSemver,
    diff as diffSemver,
    compare as compareSemver,
} from 'semver';
import type { PackageVersionInfo } from '../types';

/**
 * Check if a version string is a prerelease.
 */
export function isPrerelease(version: string): boolean {
    const parsed = parseSemver(version);
    return parsed ? parsed.prerelease.length > 0 : false;
}

/**
 * Parse a semantic version string into parts.
 * Returns undefined for malformed versions.
 */
export function parseVersion(version: string): [number, number, number] | undefined {
    const parsed = parseSemver(version);
    if (!parsed) return undefined;
    return [parsed.major, parsed.minor, parsed.patch];
}

/**
 * Compare two versions numerically.
 * Returns negative if a < b, positive if a > b, zero if equal.
 * Returns undefined if either version is malformed.
 */
export function compareVersions(a: string, b: string): number | undefined {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) return undefined;
    return compareSemver(a, b);
}

/**
 * Determine the update type (major/minor/patch) between two versions.
 * Returns undefined if either version is malformed, current >= latest, or latest is a prerelease.
 */
export function getUpdateType(
    currentVersion: string,
    latestVersion: string,
): 'major' | 'minor' | 'patch' | undefined {
    const current = parseSemver(currentVersion) ?? coerceSemver(currentVersion);
    const latest = parseSemver(latestVersion) ?? coerceSemver(latestVersion);

    if (!current || !latest) {
        return undefined;
    }

    // Don't suggest updating a stable version to a prerelease
    if (latest.prerelease.length > 0 && current.prerelease.length === 0) {
        return undefined;
    }

    // Check if current >= latest (no update needed)
    if (compareSemver(current, latest) >= 0) {
        return undefined;
    }

    const diffType = diffSemver(current, latest);

    if (diffType === 'major' || diffType === 'premajor') {
        return 'major';
    }
    if (diffType === 'minor' || diffType === 'preminor') {
        // Check if it's actually a major update
        if (latest.major !== current.major) {
            return 'major';
        }
        return 'minor';
    }
    if (diffType === 'patch') {
        return 'patch';
    }
    if (diffType === 'prepatch' || diffType === 'prerelease') {
        return 'patch';
    }

    return undefined;
}

/**
 * Check if version `a` is newer than version `b`.
 */
export function isNewerThan(a: string, b: string): boolean {
    const cmp = compareVersions(a, b);
    return cmp !== undefined && cmp > 0;
}

/**
 * Extract the latest version from a ticket title.
 * Handles multiple formats:
 * - "Update react from 18.2.0 to at least 19.0.0 (latest: 19.2.3)" -> "19.2.3"
 * - "Update react from 18.2.0 to 19.2.3" -> "19.2.3"
 * - "FYI: stytch 13.0.0 is available (currently on 12.19.0)" -> "13.0.0"
 */
export function extractLatestVersionFromTitle(title: string): string | undefined {
    // Try format with explicit "latest: X.Y.Z"
    const latestMatch = title.match(/\(latest:\s+(\S+)\)/);
    if (latestMatch) {
        return latestMatch[1];
    }

    // Try FYI format: "FYI: package X.Y.Z is available"
    const fyiMatch = title.match(/FYI:\s+\S+\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)\s+is available/);
    if (fyiMatch) {
        return fyiMatch[1];
    }

    // Try format "to X.Y.Z" (when min === latest)
    const toMatch = title.match(/to\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/);
    if (toMatch) {
        return toMatch[1];
    }

    return undefined;
}

/**
 * Extract dependency name from a Dependicus ticket title.
 * Expected formats:
 * - "[Dependicus] Update <dependency> from X to Y"
 * - "[Dependicus] FYI: <dependency> X.Y.Z is available"
 */
export function extractDependencyNameFromTitle(title: string): string | undefined {
    // Try new format with ecosystem tag: "[Dependicus] [npm] Update X from..."
    const ecoUpdateMatch = title.match(/^\[Dependicus\]\s+\[(\w+)\]\s+Update\s+(.+?)\s+from\s+/);
    if (ecoUpdateMatch) {
        return `${ecoUpdateMatch[1]}::${ecoUpdateMatch[2]}`;
    }

    // Try new FYI format with ecosystem tag: "[Dependicus] [npm] FYI: X Y.Z is available"
    const ecoFyiMatch = title.match(/^\[Dependicus\]\s+\[(\w+)\]\s+FYI:\s+(.+?)\s+\d+\.\d+/);
    if (ecoFyiMatch) {
        return `${ecoFyiMatch[1]}::${ecoFyiMatch[2]}`;
    }

    // Backward compat: standard "Update X from..." format (no ecosystem tag)
    const updateMatch = title.match(/^\[Dependicus\]\s+Update\s+(.+?)\s+from\s+/);
    if (updateMatch) {
        return updateMatch[1];
    }

    // Backward compat: FYI format (no ecosystem tag)
    const fyiMatch = title.match(/^\[Dependicus\]\s+FYI:\s+(.+?)\s+\d+\.\d+/);
    if (fyiMatch) {
        return fyiMatch[1];
    }

    return undefined;
}

/**
 * Extract group name from a Dependicus group ticket title.
 * Expected formats:
 * - "[Dependicus] Update <group> group (N dependencies)"
 * - "[Dependicus] FYI: <group> group updates available (N dependencies)"
 */
export function extractGroupNameFromTitle(title: string): string | undefined {
    // Try standard group update format
    const updateMatch = title.match(/^\[Dependicus\]\s+Update\s+(.+?)\s+group\s+\(/);
    if (updateMatch) {
        return updateMatch[1];
    }

    // Try FYI format for groups
    const fyiMatch = title.match(/^\[Dependicus\]\s+FYI:\s+(.+?)\s+group\s+updates/);
    if (fyiMatch) {
        return fyiMatch[1];
    }

    return undefined;
}

/**
 * Build the title for a grouped ticket.
 * Format: "Update <group> group (N dependencies)" or "FYI: <group> group updates available (N dependencies)"
 */
export function buildGroupTicketTitle(
    groupName: string,
    count: number,
    options?: { notificationsOnly?: boolean },
): string {
    const countLabel = count === 1 ? '1 dependency' : `${count} dependencies`;

    if (options?.notificationsOnly) {
        return `FYI: ${groupName} group updates available (${countLabel})`;
    }

    return `Update ${groupName} group (${countLabel})`;
}

/**
 * Build the title for a ticket.
 * Format: "Update <dependency> from X to Y" or "Update <dependency> from X to at least Y (latest: Z)"
 *
 * For notifications-only dependencies, uses FYI-style title since no action is required.
 */
export function buildTicketTitle(
    name: string,
    currentVersion: string,
    minVersion: string,
    latestVersion: string,
    options?: { notificationsOnly?: boolean; ecosystem?: string },
): string {
    const prefix = options?.ecosystem ? `[${options.ecosystem}] ` : '';

    // Notifications-only dependencies get FYI-style titles since no update is mandatory
    if (options?.notificationsOnly) {
        if (currentVersion === minVersion || minVersion === latestVersion) {
            return `${prefix}FYI: ${name} ${latestVersion} is available (currently on ${currentVersion})`;
        }
        return `${prefix}FYI: ${name} ${latestVersion} is available (currently on ${currentVersion})`;
    }

    if (minVersion === latestVersion) {
        return `${prefix}Update ${name} from ${currentVersion} to ${latestVersion}`;
    }
    return `${prefix}Update ${name} from ${currentVersion} to at least ${minVersion} (latest: ${latestVersion})`;
}

/**
 * Find the first version in versionsBetween that introduced the given update type.
 * Skips prerelease versions.
 *
 * For example, if currentVersion is 1.2.3 and we're looking for 'major':
 * - Returns the first version where major > 1 (e.g., 2.0.0)
 *
 * This is used to:
 * - Calculate cooldown period (based on when first required version was published)
 * - Calculate due date (SLA starts from first available update)
 */
export function findFirstVersionOfType(
    currentVersion: string,
    versionsBetween: readonly PackageVersionInfo[],
    updateType: 'major' | 'minor' | 'patch',
): PackageVersionInfo | undefined {
    const current = parseSemver(currentVersion);
    if (!current) return undefined;

    for (const v of versionsBetween) {
        // Skip prerelease versions - they don't count for updates
        if (v.isPrerelease) continue;

        const parsed = parseSemver(v.version);
        if (!parsed) continue;

        if (updateType === 'major' && parsed.major > current.major) {
            return v;
        }
        if (
            updateType === 'minor' &&
            parsed.major === current.major &&
            parsed.minor > current.minor
        ) {
            return v;
        }
        if (
            updateType === 'patch' &&
            parsed.major === current.major &&
            parsed.minor === current.minor &&
            parsed.patch > current.patch
        ) {
            return v;
        }
    }

    return undefined;
}

/**
 * Calculate the due date for a dependency update.
 * Due date = first available update publish date + thresholdDays
 *
 * If no versions are found between current and latest, falls back to
 * the provided fallbackPublishDate.
 */
export function calculateDueDate(
    currentVersion: string,
    versionsBetween: readonly PackageVersionInfo[],
    updateType: 'major' | 'minor' | 'patch',
    thresholdDays: number,
    fallbackPublishDate: string | undefined,
): Date {
    const firstVersion = findFirstVersionOfType(currentVersion, versionsBetween, updateType);

    const availableDate = firstVersion?.publishDate
        ? new Date(firstVersion.publishDate)
        : fallbackPublishDate
          ? new Date(fallbackPublishDate)
          : new Date();

    const dueDate = new Date(availableDate);
    dueDate.setDate(dueDate.getDate() + thresholdDays);

    return dueDate;
}

/**
 * Check if a version is within the cooldown period.
 * Returns true if the first required version was published less than cooldownDays ago.
 */
export function isWithinCooldown(
    currentVersion: string,
    versionsBetween: readonly PackageVersionInfo[],
    updateType: 'major' | 'minor' | 'patch',
    cooldownDays: number,
    now: Date = new Date(),
): boolean {
    const firstVersion = findFirstVersionOfType(currentVersion, versionsBetween, updateType);
    if (!firstVersion || !firstVersion.publishDate) return false;

    const publishedDaysAgo =
        (now.getTime() - new Date(firstVersion.publishDate).getTime()) / (1000 * 60 * 60 * 24);

    return publishedDaysAgo < cooldownDays;
}

/**
 * Find the latest non-prerelease version within the same major version.
 * Returns undefined if no such version exists or if current version is malformed.
 */
export function findLatestWithinMajor(
    currentVersion: string,
    versionsBetween: readonly PackageVersionInfo[],
): PackageVersionInfo | undefined {
    const current = parseSemver(currentVersion);
    if (!current) return undefined;

    let latest: PackageVersionInfo | undefined;

    for (const v of versionsBetween) {
        if (v.isPrerelease) continue;

        const parsed = parseSemver(v.version);
        if (!parsed) continue;

        // Must be same major version
        if (parsed.major !== current.major) continue;

        // Must be newer than current
        if (compareSemver(v.version, currentVersion) <= 0) continue;

        // Track the latest
        if (!latest || compareSemver(v.version, latest.version) > 0) {
            latest = v;
        }
    }

    return latest;
}

/**
 * Find the latest non-prerelease version within the same major.minor version.
 * Returns undefined if no such version exists or if current version is malformed.
 */
export function findLatestWithinMinor(
    currentVersion: string,
    versionsBetween: readonly PackageVersionInfo[],
): PackageVersionInfo | undefined {
    const current = parseSemver(currentVersion);
    if (!current) return undefined;

    let latest: PackageVersionInfo | undefined;

    for (const v of versionsBetween) {
        if (v.isPrerelease) continue;

        const parsed = parseSemver(v.version);
        if (!parsed) continue;

        // Must be same major and minor version
        if (parsed.major !== current.major || parsed.minor !== current.minor) continue;

        // Must be newer than current
        if (compareSemver(v.version, currentVersion) <= 0) continue;

        // Track the latest
        if (!latest || compareSemver(v.version, latest.version) > 0) {
            latest = v;
        }
    }

    return latest;
}

/**
 * Check if a ticket update is within the rate limit period.
 * Returns true if the ticket was updated less than rateLimitDays ago.
 *
 * @param ticketUpdatedAt - ISO date string of when the ticket was last updated
 * @param rateLimitDays - Minimum days between ticket updates
 * @param now - Optional date for testing (defaults to current time)
 */
export function isWithinNotificationRateLimit(
    ticketUpdatedAt: string,
    rateLimitDays: number,
    now: Date = new Date(),
): boolean {
    const updatedDate = new Date(ticketUpdatedAt);
    const daysSinceUpdate = (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceUpdate < rateLimitDays;
}

/**
 * Check if a major version update is available between two versions.
 * Used to determine if rate limits should be bypassed for major releases.
 *
 * @param previousLatestVersion - The previous latest version (from ticket title)
 * @param newLatestVersion - The new latest version being considered
 * @returns true if newLatestVersion represents a major version bump from previousLatestVersion
 */
export function hasMajorVersionSinceLastUpdate(
    previousLatestVersion: string | undefined,
    newLatestVersion: string,
): boolean {
    if (!previousLatestVersion) return false;

    const prev = parseSemver(previousLatestVersion);
    const current = parseSemver(newLatestVersion);

    if (!prev || !current) return false;

    return current.major > prev.major;
}
