import { describe, it, expect } from 'vitest';
import {
    parseVersion,
    compareVersions,
    getUpdateType,
    isNewerThan,
    isPrerelease,
    extractLatestVersionFromTitle,
    extractDependencyNameFromTitle,
    extractGroupNameFromTitle,
    buildTicketTitle,
    buildGroupTicketTitle,
    findFirstVersionOfType,
    calculateDueDate,
    isWithinCooldown,
    findLatestWithinMajor,
    isWithinNotificationRateLimit,
    hasMajorVersionSinceLastUpdate,
} from './versionUtils';
import type { PackageVersionInfo } from '../types';

describe('isPrerelease', () => {
    it('returns true for prerelease versions', () => {
        expect(isPrerelease('1.0.0-beta.1')).toBe(true);
        expect(isPrerelease('2.0.0-alpha')).toBe(true);
        expect(isPrerelease('3.0.0-rc.1')).toBe(true);
    });

    it('returns false for stable versions', () => {
        expect(isPrerelease('1.0.0')).toBe(false);
        expect(isPrerelease('2.3.4')).toBe(false);
    });
});

describe('parseVersion', () => {
    it('parses simple versions', () => {
        expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
        expect(parseVersion('0.0.0')).toEqual([0, 0, 0]);
        expect(parseVersion('19.2.3')).toEqual([19, 2, 3]);
    });

    it('parses versions with prerelease suffixes', () => {
        expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
        expect(parseVersion('2.0.0-rc.1')).toEqual([2, 0, 0]);
    });

    it('handles v-prefixed versions', () => {
        expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    });

    it('returns undefined for malformed versions', () => {
        expect(parseVersion('invalid')).toBeUndefined();
        expect(parseVersion('1.2')).toBeUndefined();
        expect(parseVersion('')).toBeUndefined();
    });
});

describe('compareVersions', () => {
    it('returns negative when a < b', () => {
        expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
        expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
        expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    });

    it('returns positive when a > b', () => {
        expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
        expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
        expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    });

    it('returns zero when equal', () => {
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    });

    it('returns undefined for malformed versions', () => {
        expect(compareVersions('invalid', '1.0.0')).toBeUndefined();
        expect(compareVersions('1.0.0', 'invalid')).toBeUndefined();
    });
});

describe('getUpdateType', () => {
    it('returns major for major version bump', () => {
        expect(getUpdateType('1.0.0', '2.0.0')).toBe('major');
        expect(getUpdateType('18.2.0', '19.0.0')).toBe('major');
        expect(getUpdateType('1.9.9', '2.0.0')).toBe('major');
    });

    it('returns minor for minor version bump', () => {
        expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor');
        expect(getUpdateType('19.0.0', '19.2.3')).toBe('minor');
    });

    it('returns patch for patch version bump', () => {
        expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch');
        expect(getUpdateType('19.2.0', '19.2.3')).toBe('patch');
    });

    it('returns undefined when current >= latest', () => {
        expect(getUpdateType('2.0.0', '1.0.0')).toBeUndefined();
        expect(getUpdateType('1.1.0', '1.0.0')).toBeUndefined();
        expect(getUpdateType('1.0.0', '1.0.0')).toBeUndefined();
    });

    it('returns undefined for malformed versions', () => {
        expect(getUpdateType('invalid', '1.0.0')).toBeUndefined();
    });

    it('returns undefined when stable would update to prerelease', () => {
        expect(getUpdateType('1.0.0', '2.0.0-beta.1')).toBeUndefined();
        expect(getUpdateType('1.0.0', '1.1.0-alpha')).toBeUndefined();
        expect(getUpdateType('1.0.0', '1.0.1-rc.1')).toBeUndefined();
    });

    it('handles 2-segment versions via coercion', () => {
        expect(getUpdateType('1.7', '1.8')).toBe('minor');
        expect(getUpdateType('22.22.0', '25')).toBe('major');
        expect(getUpdateType('3.14.3', '3.14')).toBeUndefined(); // 3.14.3 >= 3.14.0
    });

    it('handles prerelease-to-prerelease updates', () => {
        expect(getUpdateType('1.0.0-rc.5', '1.0.0-rc.10')).toBe('patch');
        expect(getUpdateType('1.4.0-r.1', '1.5.0-r.1')).toBe('minor');
    });
});

describe('isNewerThan', () => {
    it('returns true when a is newer than b', () => {
        expect(isNewerThan('2.0.0', '1.0.0')).toBe(true);
        expect(isNewerThan('1.1.0', '1.0.0')).toBe(true);
        expect(isNewerThan('1.0.1', '1.0.0')).toBe(true);
    });

    it('returns false when a is older or equal', () => {
        expect(isNewerThan('1.0.0', '2.0.0')).toBe(false);
        expect(isNewerThan('1.0.0', '1.0.0')).toBe(false);
    });

    it('returns false for malformed versions', () => {
        expect(isNewerThan('invalid', '1.0.0')).toBe(false);
    });
});

describe('extractLatestVersionFromTitle', () => {
    it('extracts from "latest: X.Y.Z" format', () => {
        expect(
            extractLatestVersionFromTitle(
                '[Dependicus] Update react from 18.2.0 to at least 19.0.0 (latest: 19.2.3)',
            ),
        ).toBe('19.2.3');
    });

    it('extracts from "to X.Y.Z" format when min equals latest', () => {
        expect(
            extractLatestVersionFromTitle('[Dependicus] Update react from 18.2.0 to 19.2.3'),
        ).toBe('19.2.3');
    });

    it('extracts from FYI format', () => {
        expect(
            extractLatestVersionFromTitle(
                '[Dependicus] FYI: stytch 13.0.0 is available (currently on 12.19.0)',
            ),
        ).toBe('13.0.0');
    });

    it('handles prerelease versions', () => {
        expect(
            extractLatestVersionFromTitle('[Dependicus] Update pkg from 1.0.0 to 2.0.0-beta.1'),
        ).toBe('2.0.0-beta.1');
    });

    it('returns undefined for old format without version', () => {
        expect(extractLatestVersionFromTitle('[Dependicus] Update react')).toBeUndefined();
    });
});

describe('extractDependencyNameFromTitle', () => {
    it('extracts package name from update title', () => {
        expect(
            extractDependencyNameFromTitle('[Dependicus] Update react from 18.2.0 to 19.2.3'),
        ).toBe('react');
    });

    it('extracts package name from FYI title', () => {
        expect(
            extractDependencyNameFromTitle(
                '[Dependicus] FYI: stytch 13.0.0 is available (currently on 12.19.0)',
            ),
        ).toBe('stytch');
    });

    it('handles scoped packages', () => {
        expect(
            extractDependencyNameFromTitle('[Dependicus] Update @linear/sdk from 32.0.0 to 65.0.0'),
        ).toBe('@linear/sdk');
    });

    it('handles packages with hyphens', () => {
        expect(
            extractDependencyNameFromTitle('[Dependicus] Update react-dom from 18.2.0 to 19.0.0'),
        ).toBe('react-dom');
    });

    it('differentiates similar package names', () => {
        expect(
            extractDependencyNameFromTitle('[Dependicus] Update react from 18.0.0 to 19.0.0'),
        ).toBe('react');

        expect(
            extractDependencyNameFromTitle('[Dependicus] Update react-utils from 1.0.0 to 2.0.0'),
        ).toBe('react-utils');
    });

    it('extracts ecosystem::name from title with ecosystem tag', () => {
        expect(
            extractDependencyNameFromTitle(
                '[Dependicus] [npm] Update braintrust from 0.1.0 to 3.9.0',
            ),
        ).toBe('npm::braintrust');
    });

    it('extracts ecosystem::name from FYI title with ecosystem tag', () => {
        expect(
            extractDependencyNameFromTitle(
                '[Dependicus] [pypi] FYI: braintrust 0.18.0 is available (currently on 0.2.1)',
            ),
        ).toBe('pypi::braintrust');
    });

    it('extracts ecosystem::name for scoped packages with ecosystem tag', () => {
        expect(
            extractDependencyNameFromTitle(
                '[Dependicus] [npm] Update @linear/sdk from 32.0.0 to 65.0.0',
            ),
        ).toBe('npm::@linear/sdk');
    });

    it('returns undefined for non-Dependicus titles', () => {
        expect(extractDependencyNameFromTitle('Update react to 19.0.0')).toBeUndefined();
        expect(extractDependencyNameFromTitle('Fix bug in react')).toBeUndefined();
        expect(extractDependencyNameFromTitle('[Dependicus] Update react')).toBeUndefined();
    });
});

describe('buildTicketTitle', () => {
    it('builds simple title when min equals latest', () => {
        expect(buildTicketTitle('react', '18.2.0', '19.2.3', '19.2.3')).toBe(
            'Update react from 18.2.0 to 19.2.3',
        );
    });

    it('builds "at least" title when min differs from latest', () => {
        expect(buildTicketTitle('react', '18.2.0', '19.0.0', '19.2.3')).toBe(
            'Update react from 18.2.0 to at least 19.0.0 (latest: 19.2.3)',
        );
    });

    it('handles scoped packages', () => {
        expect(buildTicketTitle('@linear/sdk', '32.0.0', '65.0.0', '65.2.0')).toBe(
            'Update @linear/sdk from 32.0.0 to at least 65.0.0 (latest: 65.2.0)',
        );
    });

    it('builds FYI title for notifications-only packages', () => {
        expect(
            buildTicketTitle('stytch', '12.19.0', '13.0.0', '13.0.0', {
                notificationsOnly: true,
            }),
        ).toBe('FYI: stytch 13.0.0 is available (currently on 12.19.0)');
    });

    it('builds FYI title for notifications-only even when min differs from latest', () => {
        expect(
            buildTicketTitle('stytch', '12.19.0', '13.0.0', '13.2.0', {
                notificationsOnly: true,
            }),
        ).toBe('FYI: stytch 13.2.0 is available (currently on 12.19.0)');
    });

    it('includes ecosystem tag when ecosystem is provided', () => {
        expect(
            buildTicketTitle('braintrust', '0.1.0', '3.9.0', '3.9.0', { ecosystem: 'npm' }),
        ).toBe('[npm] Update braintrust from 0.1.0 to 3.9.0');
    });

    it('includes ecosystem tag in FYI titles', () => {
        expect(
            buildTicketTitle('braintrust', '0.2.1', '0.18.0', '0.18.0', {
                notificationsOnly: true,
                ecosystem: 'pypi',
            }),
        ).toBe('[pypi] FYI: braintrust 0.18.0 is available (currently on 0.2.1)');
    });

    it('includes ecosystem tag in "at least" titles', () => {
        expect(buildTicketTitle('react', '18.2.0', '19.0.0', '19.2.3', { ecosystem: 'npm' })).toBe(
            '[npm] Update react from 18.2.0 to at least 19.0.0 (latest: 19.2.3)',
        );
    });
});

describe('findFirstVersionOfType', () => {
    const makeVersion = (
        version: string,
        publishDate: string,
        prerelease = false,
    ): PackageVersionInfo => ({
        version,
        publishDate,
        isPrerelease: prerelease,
        registryUrl: `https://www.npmjs.com/package/test/v/${version}`,
    });

    it('finds first major version bump in versionsBetween', () => {
        const versions = [
            makeVersion('1.0.1', '2024-01-01'),
            makeVersion('1.1.0', '2024-02-01'),
            makeVersion('2.0.0', '2024-03-01'),
            makeVersion('2.0.1', '2024-04-01'),
        ];

        const result = findFirstVersionOfType('1.0.0', versions, 'major');
        expect(result?.version).toBe('2.0.0');
        expect(result?.publishDate).toBe('2024-03-01');
    });

    it('finds first minor version bump when major unchanged', () => {
        const versions = [
            makeVersion('1.0.1', '2024-01-01'),
            makeVersion('1.1.0', '2024-02-01'),
            makeVersion('1.2.0', '2024-03-01'),
        ];

        const result = findFirstVersionOfType('1.0.0', versions, 'minor');
        expect(result?.version).toBe('1.1.0');
    });

    it('finds first patch version bump when major/minor unchanged', () => {
        const versions = [
            makeVersion('1.0.1', '2024-01-01'),
            makeVersion('1.0.2', '2024-02-01'),
            makeVersion('1.0.3', '2024-03-01'),
        ];

        const result = findFirstVersionOfType('1.0.0', versions, 'patch');
        expect(result?.version).toBe('1.0.1');
    });

    it('skips prerelease versions', () => {
        const versions = [
            makeVersion('2.0.0-alpha.1', '2024-01-01', true),
            makeVersion('2.0.0-beta.1', '2024-02-01', true),
            makeVersion('2.0.0', '2024-03-01', false),
        ];

        const result = findFirstVersionOfType('1.0.0', versions, 'major');
        expect(result?.version).toBe('2.0.0');
        expect(result?.publishDate).toBe('2024-03-01');
    });

    it('returns undefined when versionsBetween is empty', () => {
        const result = findFirstVersionOfType('1.0.0', [], 'major');
        expect(result).toBeUndefined();
    });

    it('returns undefined when no matching version type exists', () => {
        const versions = [makeVersion('1.0.1', '2024-01-01'), makeVersion('1.0.2', '2024-02-01')];

        const result = findFirstVersionOfType('1.0.0', versions, 'major');
        expect(result).toBeUndefined();
    });

    it('returns undefined for malformed current version', () => {
        const versions = [makeVersion('2.0.0', '2024-01-01')];
        const result = findFirstVersionOfType('invalid', versions, 'major');
        expect(result).toBeUndefined();
    });
});

describe('calculateDueDate', () => {
    const makeVersion = (version: string, publishDate: string): PackageVersionInfo => ({
        version,
        publishDate,
        isPrerelease: false,
        registryUrl: `https://www.npmjs.com/package/test/v/${version}`,
    });

    it('calculates due date from first required version publish date', () => {
        const versions = [makeVersion('2.0.0', '2024-06-15'), makeVersion('2.0.1', '2024-07-01')];

        const dueDate = calculateDueDate('1.0.0', versions, 'major', 360, '2023-01-01');

        expect(dueDate.getFullYear()).toBe(2025);
        expect(dueDate.getMonth()).toBe(5); // June is 5 (0-indexed)
    });

    it('falls back to fallback publish date if no versions between', () => {
        const dueDate = calculateDueDate('1.0.0', [], 'major', 360, '2024-01-15');

        expect(dueDate.getFullYear()).toBe(2025);
        expect(dueDate.getMonth()).toBe(0); // January
    });

    it('uses correct threshold for different update types', () => {
        const versions = [makeVersion('1.1.0', '2024-06-15')];

        const dueDate = calculateDueDate('1.0.0', versions, 'minor', 180, '2024-01-01');

        expect(dueDate.getFullYear()).toBe(2024);
        expect(dueDate.getMonth()).toBe(11); // December
    });
});

describe('isWithinCooldown', () => {
    const makeVersion = (version: string, publishDate: string): PackageVersionInfo => ({
        version,
        publishDate,
        isPrerelease: false,
        registryUrl: `https://www.npmjs.com/package/test/v/${version}`,
    });

    it('returns true when first required version published within cooldown days', () => {
        const now = new Date('2024-06-10');
        const versions = [makeVersion('2.0.0', '2024-06-05')];

        expect(isWithinCooldown('1.0.0', versions, 'major', 7, now)).toBe(true);
    });

    it('returns false when first required version published past cooldown days', () => {
        const now = new Date('2024-06-20');
        const versions = [makeVersion('2.0.0', '2024-06-05')];

        expect(isWithinCooldown('1.0.0', versions, 'major', 7, now)).toBe(false);
    });

    it('uses first major version for cooldown, not latest patch', () => {
        const now = new Date('2024-06-20');
        const versions = [
            makeVersion('2.0.0', '2024-01-01'),
            makeVersion('2.0.1', '2024-06-18'),
            makeVersion('2.0.2', '2024-06-19'),
        ];

        expect(isWithinCooldown('1.0.0', versions, 'major', 7, now)).toBe(false);
    });

    it('returns false when no matching version exists', () => {
        const now = new Date('2024-06-10');
        const versions = [makeVersion('1.0.1', '2024-06-05')];

        expect(isWithinCooldown('1.0.0', versions, 'major', 7, now)).toBe(false);
    });

    it('returns false for empty versions array', () => {
        const now = new Date('2024-06-10');
        expect(isWithinCooldown('1.0.0', [], 'major', 7, now)).toBe(false);
    });
});

describe('findLatestWithinMajor', () => {
    const makeVersion = (version: string, publishDate: string): PackageVersionInfo => ({
        version,
        publishDate,
        isPrerelease: false,
        registryUrl: `https://www.npmjs.com/package/test/v/${version}`,
    });

    it('finds latest minor/patch within current major', () => {
        const versions = [
            makeVersion('12.19.0', '2024-01-01'),
            makeVersion('12.20.0', '2024-02-01'),
            makeVersion('12.43.1', '2024-03-01'),
            makeVersion('13.0.0', '2024-04-01'),
        ];

        const result = findLatestWithinMajor('12.19.0', versions);
        expect(result?.version).toBe('12.43.1');
    });

    it('returns undefined when only major updates exist', () => {
        const versions = [makeVersion('13.0.0', '2024-01-01'), makeVersion('13.1.0', '2024-02-01')];

        const result = findLatestWithinMajor('12.19.0', versions);
        expect(result).toBeUndefined();
    });

    it('skips prerelease versions', () => {
        const versions = [
            makeVersion('12.20.0', '2024-01-01'),
            { ...makeVersion('12.21.0-beta.1', '2024-02-01'), isPrerelease: true },
            makeVersion('12.43.0', '2024-03-01'),
        ];

        const result = findLatestWithinMajor('12.19.0', versions);
        expect(result?.version).toBe('12.43.0');
    });

    it('returns undefined when no newer versions within major exist', () => {
        const versions = [
            makeVersion('12.19.0', '2024-01-01'),
            makeVersion('12.18.0', '2024-02-01'),
        ];

        const result = findLatestWithinMajor('12.19.0', versions);
        expect(result).toBeUndefined();
    });

    it('returns undefined for empty versions array', () => {
        const result = findLatestWithinMajor('12.19.0', []);
        expect(result).toBeUndefined();
    });

    it('returns undefined for malformed current version', () => {
        const versions = [makeVersion('12.20.0', '2024-01-01')];
        const result = findLatestWithinMajor('invalid', versions);
        expect(result).toBeUndefined();
    });
});

describe('extractGroupNameFromTitle', () => {
    it('extracts group name from update title', () => {
        expect(extractGroupNameFromTitle('[Dependicus] Update sentry group (5 packages)')).toBe(
            'sentry',
        );
    });

    it('extracts group name from FYI title', () => {
        expect(
            extractGroupNameFromTitle(
                '[Dependicus] FYI: sentry group updates available (3 packages)',
            ),
        ).toBe('sentry');
    });

    it('returns undefined for non-group titles', () => {
        expect(
            extractGroupNameFromTitle('[Dependicus] Update react from 18.0.0 to 19.0.0'),
        ).toBeUndefined();
    });

    it('returns undefined for non-Dependicus titles', () => {
        expect(extractGroupNameFromTitle('Update sentry group (5 packages)')).toBeUndefined();
    });
});

describe('buildGroupTicketTitle', () => {
    it('builds title for single dependency group', () => {
        expect(buildGroupTicketTitle('sentry', 1)).toBe('Update sentry group (1 dependency)');
    });

    it('builds title for multiple dependency group', () => {
        expect(buildGroupTicketTitle('sentry', 5)).toBe('Update sentry group (5 dependencies)');
    });

    it('builds FYI title for notifications-only groups', () => {
        expect(buildGroupTicketTitle('sentry', 3, { notificationsOnly: true })).toBe(
            'FYI: sentry group updates available (3 dependencies)',
        );
    });

    it('builds FYI title for single dependency notifications-only group', () => {
        expect(buildGroupTicketTitle('sentry', 1, { notificationsOnly: true })).toBe(
            'FYI: sentry group updates available (1 dependency)',
        );
    });
});

describe('isWithinNotificationRateLimit', () => {
    const now = new Date('2024-06-15T00:00:00Z');

    it.each([
        { daysAgo: '10 days', ticketUpdatedAt: '2024-06-05T00:00:00Z', expected: true },
        { daysAgo: '35 days', ticketUpdatedAt: '2024-05-11T00:00:00Z', expected: false },
        {
            daysAgo: '30 days (exactly at boundary)',
            ticketUpdatedAt: '2024-05-16T00:00:00Z',
            expected: false,
        },
        {
            daysAgo: '29.5 days (just under boundary)',
            ticketUpdatedAt: '2024-05-16T12:00:00Z',
            expected: true,
        },
    ])(
        'returns $expected when ticket was updated $daysAgo ago (30-day limit)',
        ({ ticketUpdatedAt, expected }) => {
            expect(isWithinNotificationRateLimit(ticketUpdatedAt, 30, now)).toBe(expected);
        },
    );

    it.each([
        { rateLimitDays: 7, expected: true },
        { rateLimitDays: 3, expected: false },
    ])(
        'returns $expected with $rateLimitDays-day limit for ticket updated 5 days ago',
        ({ rateLimitDays, expected }) => {
            const ticketUpdatedAt = '2024-06-10T00:00:00Z';
            expect(isWithinNotificationRateLimit(ticketUpdatedAt, rateLimitDays, now)).toBe(
                expected,
            );
        },
    );
});

describe('hasMajorVersionSinceLastUpdate', () => {
    it('returns true when major version increased', () => {
        expect(hasMajorVersionSinceLastUpdate('1.0.0', '2.0.0')).toBe(true);
        expect(hasMajorVersionSinceLastUpdate('12.5.0', '13.0.0')).toBe(true);
    });

    it('returns false when only minor version increased', () => {
        expect(hasMajorVersionSinceLastUpdate('1.0.0', '1.1.0')).toBe(false);
        expect(hasMajorVersionSinceLastUpdate('12.5.0', '12.6.0')).toBe(false);
    });

    it('returns false when only patch version increased', () => {
        expect(hasMajorVersionSinceLastUpdate('1.0.0', '1.0.1')).toBe(false);
        expect(hasMajorVersionSinceLastUpdate('12.5.3', '12.5.4')).toBe(false);
    });

    it('returns false when versions are equal', () => {
        expect(hasMajorVersionSinceLastUpdate('1.0.0', '1.0.0')).toBe(false);
    });

    it('returns false when previous version is undefined', () => {
        expect(hasMajorVersionSinceLastUpdate(undefined, '2.0.0')).toBe(false);
    });

    it('returns false for malformed versions', () => {
        expect(hasMajorVersionSinceLastUpdate('invalid', '2.0.0')).toBe(false);
        expect(hasMajorVersionSinceLastUpdate('1.0.0', 'invalid')).toBe(false);
    });

    it('handles multiple major version jumps', () => {
        expect(hasMajorVersionSinceLastUpdate('1.0.0', '3.0.0')).toBe(true);
        expect(hasMajorVersionSinceLastUpdate('10.0.0', '15.0.0')).toBe(true);
    });
});
