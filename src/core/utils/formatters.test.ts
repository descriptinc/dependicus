import { describe, it, expect } from 'vitest';
import {
    sanitizeCacheKey,
    formatDate,
    getAgeDays,
    formatAgeHuman,
    getVersionsBehind,
    convertGitUrlToHttps,
    formatBytes,
    formatSizeChange,
} from './formatters';

describe('sanitizeCacheKey', () => {
    it('replaces special characters with underscores', () => {
        expect(sanitizeCacheKey('@scope/package')).toBe('_scope_package');
        expect(sanitizeCacheKey('foo bar')).toBe('foo_bar');
    });

    it('preserves allowed characters', () => {
        expect(sanitizeCacheKey('foo-bar_1.2.3')).toBe('foo-bar_1.2.3');
    });

    it('handles empty string', () => {
        expect(sanitizeCacheKey('')).toBe('');
    });
});

describe('formatDate', () => {
    it('formats ISO date to YYYY-MM-DD', () => {
        expect(formatDate('2024-03-15T10:30:00.000Z')).toBe('2024-03-15');
        expect(formatDate('2023-12-31T23:59:59.999Z')).toBe('2023-12-31');
    });

    it('returns undefined for empty input', () => {
        expect(formatDate('')).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(formatDate(undefined)).toBeUndefined();
    });

    it('handles invalid dates', () => {
        const result = formatDate('invalid');
        expect(result).toBeUndefined();
    });
});

describe('getAgeDays', () => {
    it('calculates days between publish date and now', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const publishDate = yesterday.toISOString();

        expect(getAgeDays(publishDate)).toBe(1);
    });

    it('returns undefined for empty input', () => {
        expect(getAgeDays('')).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(getAgeDays(undefined)).toBeUndefined();
    });

    it('returns 0 for future dates', () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const futureDate = tomorrow.toISOString();

        expect(getAgeDays(futureDate)).toBe(0);
    });

    it('calculates correct days for dates in the past', () => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const publishDate = thirtyDaysAgo.toISOString();

        // Allow ±1 day tolerance due to sub-day timing between date construction and evaluation
        const result = getAgeDays(publishDate)!;
        expect(result).toBeGreaterThanOrEqual(29);
        expect(result).toBeLessThanOrEqual(30);
    });
});

describe('formatAgeHuman', () => {
    it('formats age in days for recent dates', () => {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        expect(formatAgeHuman(threeDaysAgo.toISOString())).toBe('3 days');
    });

    it('formats single day correctly', () => {
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        expect(formatAgeHuman(oneDayAgo.toISOString())).toBe('1 day');
    });

    it('formats age in months for medium dates', () => {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const result = formatAgeHuman(sixtyDaysAgo.toISOString())!;
        // 59-60 days → "1 month 29 days" or "2 months 0 days" depending on timing
        expect(result).toMatch(/^(1 month 29|2 months)/);
    });

    it('formats age in years for old dates', () => {
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

        const result = formatAgeHuman(twoYearsAgo.toISOString());
        expect(result).toMatch(/^2 years/);
    });

    it('returns undefined for empty input', () => {
        expect(formatAgeHuman('')).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(formatAgeHuman(undefined)).toBeUndefined();
    });

    it('handles single units correctly', () => {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const result = formatAgeHuman(oneYearAgo.toISOString());
        expect(result).toMatch(/^1 year/);
    });
});

describe('getVersionsBehind', () => {
    it('returns empty string for same versions', () => {
        expect(getVersionsBehind('1.0.0', '1.0.0')).toBe('');
    });

    it('calculates major version difference', () => {
        expect(getVersionsBehind('1.0.0', '3.0.0')).toBe('Major x2');
        expect(getVersionsBehind('1.5.2', '4.0.0')).toBe('Major x3');
    });

    it('calculates minor version difference', () => {
        expect(getVersionsBehind('1.0.0', '1.3.0')).toBe('Minor x3');
        expect(getVersionsBehind('2.1.5', '2.4.0')).toBe('Minor x3');
    });

    it('calculates patch version difference', () => {
        expect(getVersionsBehind('1.0.0', '1.0.5')).toBe('Patch x5');
        expect(getVersionsBehind('3.2.1', '3.2.8')).toBe('Patch x7');
    });

    it('returns empty string for empty inputs', () => {
        expect(getVersionsBehind('', '1.0.0')).toBe('');
        expect(getVersionsBehind('1.0.0', '')).toBe('');
    });

    it('returns empty string for invalid semver', () => {
        expect(getVersionsBehind('invalid', '1.0.0')).toBe('');
        expect(getVersionsBehind('1.0.0', 'invalid')).toBe('');
    });

    it('handles prerelease versions', () => {
        expect(getVersionsBehind('1.0.0-beta.1', '1.0.0')).toBe('Major x0');
        expect(getVersionsBehind('1.0.0', '2.0.0-beta.1')).toBe('Major x1');
    });

    it('prioritizes major differences over minor/patch', () => {
        expect(getVersionsBehind('1.5.9', '3.2.1')).toBe('Major x2');
    });
});

describe('formatBytes', () => {
    it('returns empty string for undefined', () => {
        expect(formatBytes(undefined)).toBe('');
    });

    it('returns empty string for negative values', () => {
        expect(formatBytes(-1)).toBe('');
    });

    it('formats bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(500)).toBe('500 B');
        expect(formatBytes(999)).toBe('999 B');
    });

    it('formats kilobytes', () => {
        expect(formatBytes(1000)).toBe('1.0 kB');
        expect(formatBytes(1500)).toBe('1.5 kB');
        expect(formatBytes(999_999)).toBe('1000.0 kB');
    });

    it('formats megabytes', () => {
        expect(formatBytes(1_000_000)).toBe('1.0 MB');
        expect(formatBytes(5_500_000)).toBe('5.5 MB');
    });

    it('formats gigabytes', () => {
        expect(formatBytes(1_000_000_000)).toBe('1.0 GB');
        expect(formatBytes(2_500_000_000)).toBe('2.5 GB');
    });
});

describe('formatSizeChange', () => {
    it('returns empty string when baseSize is undefined', () => {
        expect(formatSizeChange(undefined, 1000)).toBe('');
    });

    it('returns empty string when otherSize is undefined', () => {
        expect(formatSizeChange(1000, undefined)).toBe('');
    });

    it('returns empty string when baseSize is zero', () => {
        expect(formatSizeChange(0, 1000)).toBe('');
    });

    it('returns 0% for equal sizes', () => {
        expect(formatSizeChange(1000, 1000)).toBe('0%');
    });

    it('returns positive percentage for increase', () => {
        expect(formatSizeChange(1000, 1500)).toBe('+50%');
    });

    it('returns negative percentage for decrease', () => {
        expect(formatSizeChange(1000, 750)).toBe('-25%');
    });

    it('rounds to nearest integer', () => {
        expect(formatSizeChange(1000, 1333)).toBe('+33%');
    });
});

describe('convertGitUrlToHttps', () => {
    it('returns undefined for undefined input', () => {
        expect(convertGitUrlToHttps(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        expect(convertGitUrlToHttps('')).toBeUndefined();
    });

    it('handles git+https:// URLs', () => {
        expect(convertGitUrlToHttps('git+https://github.com/owner/repo.git')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles git:// URLs', () => {
        expect(convertGitUrlToHttps('git://github.com/owner/repo.git')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles git+ssh://git@ URLs', () => {
        expect(convertGitUrlToHttps('git+ssh://git@github.com/owner/repo.git')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles ssh://git@ URLs', () => {
        expect(convertGitUrlToHttps('ssh://git@github.com/owner/repo.git')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles git@github.com: SSH shorthand', () => {
        expect(convertGitUrlToHttps('git@github.com:owner/repo.git')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles github: shorthand', () => {
        expect(convertGitUrlToHttps('github:owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('handles github: shorthand with .git suffix', () => {
        expect(convertGitUrlToHttps('github:owner/repo.git')).toBe('https://github.com/owner/repo');
    });

    it('leaves https:// URLs unchanged (except .git suffix)', () => {
        expect(convertGitUrlToHttps('https://github.com/owner/repo')).toBe(
            'https://github.com/owner/repo',
        );
        expect(convertGitUrlToHttps('https://github.com/owner/repo.git')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles URLs without .git suffix', () => {
        expect(convertGitUrlToHttps('git://github.com/owner/repo')).toBe(
            'https://github.com/owner/repo',
        );
    });

    it('handles scoped package repos', () => {
        expect(convertGitUrlToHttps('git+https://github.com/babel/babel.git')).toBe(
            'https://github.com/babel/babel',
        );
    });
});
