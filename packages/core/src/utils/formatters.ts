import { parse as parseSemver, diff as diffSemver } from 'semver';

/**
 * Sanitize a string for use as a cache key / filename.
 * Replaces characters that are problematic in file paths.
 */
export function sanitizeCacheKey(str: string): string {
    return str.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function formatDate(isoDate: string): string {
    if (!isoDate) {
        return '';
    }

    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
        return '';
    }
    return date.toISOString().split('T')[0] || '';
}

export function getAgeDays(publishDate: string): number {
    if (!publishDate) {
        return 0;
    }

    const published = new Date(publishDate);
    const now = new Date();
    const diffMs = now.getTime() - published.getTime();

    if (diffMs < 0) {
        return 0;
    }

    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function formatAgeHuman(publishDate: string): string {
    if (!publishDate) {
        return '';
    }

    const diffDays = getAgeDays(publishDate);
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    const days = diffDays % 30;

    if (years > 0) {
        if (months > 0) {
            return `${years} year${years > 1 ? 's' : ''} ${months} month${months > 1 ? 's' : ''}`;
        }
        return `${years} year${years > 1 ? 's' : ''}`;
    }

    if (months > 0) {
        if (days > 0) {
            return `${months} month${months > 1 ? 's' : ''} ${days} day${days > 1 ? 's' : ''}`;
        }
        return `${months} month${months > 1 ? 's' : ''}`;
    }

    return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
}

export function getVersionsBehind(currentVersion: string, latestVersion: string): string {
    if (!currentVersion || !latestVersion || currentVersion === latestVersion) {
        return '';
    }

    const current = parseSemver(currentVersion);
    const latest = parseSemver(latestVersion);

    if (!current || !latest) {
        return '';
    }

    const diffType = diffSemver(current, latest);

    if (diffType === 'major' || diffType === 'premajor') {
        const majorDiff = latest.major - current.major;
        return `Major x${majorDiff}`;
    } else if (
        diffType === 'minor' ||
        diffType === 'preminor' ||
        diffType === 'prepatch' ||
        diffType === 'prerelease'
    ) {
        if (latest.major !== current.major) {
            const majorDiff = latest.major - current.major;
            return `Major x${majorDiff}`;
        }
        const minorDiff = latest.minor - current.minor;
        return `Minor x${minorDiff}`;
    } else if (diffType === 'patch') {
        const patchDiff = latest.patch - current.patch;
        return `Patch x${patchDiff}`;
    }

    return '';
}

export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || bytes < 0) return '';
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function formatSizeChange(
    baseSize: number | undefined,
    otherSize: number | undefined,
): string {
    if (baseSize === undefined || otherSize === undefined || baseSize === 0) return '';
    const pct = Math.round(((otherSize - baseSize) / baseSize) * 100);
    if (pct === 0) return '0%';
    return pct > 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Convert a git repository URL to a browsable HTTPS URL.
 * Handles various formats:
 * - git+https://github.com/owner/repo.git -> https://github.com/owner/repo
 * - git://github.com/owner/repo.git -> https://github.com/owner/repo
 * - git+ssh://git@github.com/owner/repo.git -> https://github.com/owner/repo
 * - https://github.com/owner/repo -> https://github.com/owner/repo (unchanged)
 * - github:owner/repo -> https://github.com/owner/repo
 */
export function convertGitUrlToHttps(url: string | undefined): string | undefined {
    if (!url) return undefined;

    // Handle github: shorthand
    const githubShorthand = url.match(/^github:([^/]+)\/([^/]+)$/);
    if (githubShorthand && githubShorthand[1] && githubShorthand[2]) {
        const repo = githubShorthand[2].replace(/\.git$/, '');
        return `https://github.com/${githubShorthand[1]}/${repo}`;
    }

    // Remove git+ prefix if present
    let result = url.replace(/^git\+/, '');

    // Convert git:// to https://
    result = result.replace(/^git:\/\//, 'https://');

    // Convert git+ssh://git@ to https://
    result = result.replace(/^ssh:\/\/git@/, 'https://');

    // Handle git@github.com:owner/repo format (SSH shorthand)
    result = result.replace(/^git@github\.com:/, 'https://github.com/');

    // Remove .git suffix
    result = result.replace(/\.git$/, '');

    return result;
}
