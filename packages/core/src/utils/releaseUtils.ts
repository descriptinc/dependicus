import type { GitHubRelease } from '../types';

/**
 * Find a release that matches a given version.
 * Tries common tag formats: v1.0.0, 1.0.0, package@1.0.0
 */
export function findReleaseForVersion(
    releases: GitHubRelease[],
    version: string,
    packageName?: string,
): GitHubRelease | undefined {
    const possibleTags = [`v${version}`, version, `${packageName}@${version}`];

    // Also handle scoped packages: @scope/pkg@1.0.0 -> pkg@1.0.0
    if (packageName?.startsWith('@')) {
        const shortName = packageName.split('/')[1];
        if (shortName) {
            possibleTags.push(`${shortName}@${version}`);
        }
    }

    for (const tag of possibleTags) {
        const release = releases.find((r) => r.tagName === tag);
        if (release) return release;
    }

    return undefined;
}

/**
 * Detect the tag format used by a repo based on existing releases.
 * Returns a function that converts a version to a tag name.
 */
export function detectTagFormat(releases: GitHubRelease[]): (version: string) => string {
    if (releases.length === 0) {
        // Default to v-prefix if no releases to infer from
        return (version) => `v${version}`;
    }

    // Sample a few releases to detect the pattern
    const sample = releases.slice(0, 10);

    // Count patterns
    let vPrefixCount = 0;
    let noPrefixCount = 0;

    for (const release of sample) {
        const tag = release.tagName;
        // Check if tag looks like v1.2.3
        if (/^v\d/.test(tag)) {
            vPrefixCount++;
        }
        // Check if tag looks like 1.2.3 (starts with digit)
        else if (/^\d/.test(tag)) {
            noPrefixCount++;
        }
        // Other formats (e.g., package@1.2.3) - we'll handle these by trying to match
    }

    if (noPrefixCount > vPrefixCount) {
        return (version) => version;
    }
    return (version) => `v${version}`;
}
