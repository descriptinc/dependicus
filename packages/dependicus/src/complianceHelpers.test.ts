import { describe, it, expect } from 'vitest';
import { getPackageComplianceStatus, formatComplianceDetail } from './compliance';
import type { PackageVersionInfo } from '@dependicus/core';

describe('getPackageComplianceStatus', () => {
    const makeVersion = (version: string, publishDate: string): PackageVersionInfo => ({
        version,
        publishDate,
        isPrerelease: false,
        npmUrl: `https://www.npmjs.com/package/test/v/${version}`,
    });

    describe('not-applicable cases', () => {
        it('returns not-applicable when no threshold provided', () => {
            const result = getPackageComplianceStatus('1.0.0', '2.0.0', [], undefined);
            expect(result.status).toBe('not-applicable');
        });

        it('returns not-applicable when latest is a prerelease', () => {
            const result = getPackageComplianceStatus('1.0.0', '2.0.0-beta.1', [], 360);
            expect(result.status).toBe('not-applicable');
        });

        it('returns not-applicable when current >= latest', () => {
            const result = getPackageComplianceStatus('2.0.0', '1.0.0', [], 360);
            expect(result.status).toBe('not-applicable');
        });
    });

    describe('compliant cases', () => {
        it('returns compliant when already at latest version', () => {
            const result = getPackageComplianceStatus('2.0.0', '2.0.0', [], 360);
            expect(result.status).toBe('compliant');
        });

        it('returns compliant when update is within threshold', () => {
            // Published 30 days ago, threshold is 360 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const versions = [makeVersion('2.0.0', thirtyDaysAgo.toISOString())];

            const result = getPackageComplianceStatus('1.0.0', '2.0.0', versions, 360);
            expect(result.status).toBe('compliant');
        });

        it('returns compliant when first required version not found', () => {
            // No major versions in versionsBetween
            const versions = [makeVersion('1.0.1', '2024-01-01')];
            const result = getPackageComplianceStatus('1.0.0', '2.0.0', versions, 360);
            expect(result.status).toBe('compliant');
        });
    });

    describe('non-compliant cases', () => {
        it('returns non-compliant when major update is overdue', () => {
            // Published 400 days ago, threshold is 360 days
            const publishDate = new Date();
            publishDate.setDate(publishDate.getDate() - 400);
            const versions = [makeVersion('2.0.0', publishDate.toISOString())];

            const result = getPackageComplianceStatus('1.0.0', '2.0.0', versions, 360);
            if (result.status !== 'non-compliant') {
                throw new Error('Expected non-compliant status');
            }
            expect(result.status).toBe('non-compliant');
            expect(result.updateType).toBe('major');
            expect(result.thresholdDays).toBe(360);
            expect(result.daysOverdue).toBeGreaterThan(0);
            expect(result.daysOverdue).toBeCloseTo(40, 0);
        });

        it('returns non-compliant when minor update is overdue', () => {
            // Published 200 days ago, threshold is 180 days
            const publishDate = new Date();
            publishDate.setDate(publishDate.getDate() - 200);
            const versions = [makeVersion('1.1.0', publishDate.toISOString())];

            const result = getPackageComplianceStatus('1.0.0', '1.1.0', versions, 180);
            if (result.status !== 'non-compliant') {
                throw new Error('Expected non-compliant status');
            }
            expect(result.status).toBe('non-compliant');
            expect(result.updateType).toBe('minor');
            expect(result.thresholdDays).toBe(180);
            expect(result.daysOverdue).toBeGreaterThan(0);
            expect(result.daysOverdue).toBeCloseTo(20, 0);
        });

        it('returns non-compliant when patch update is overdue', () => {
            // Published 100 days ago, threshold is 90 days
            const publishDate = new Date();
            publishDate.setDate(publishDate.getDate() - 100);
            const versions = [makeVersion('1.0.1', publishDate.toISOString())];

            const result = getPackageComplianceStatus('1.0.0', '1.0.1', versions, 90);
            if (result.status !== 'non-compliant') {
                throw new Error('Expected non-compliant status');
            }
            expect(result.status).toBe('non-compliant');
            expect(result.updateType).toBe('patch');
            expect(result.thresholdDays).toBe(90);
            expect(result.daysOverdue).toBeGreaterThan(0);
            expect(result.daysOverdue).toBeCloseTo(10, 0);
        });

        it('uses first required version for compliance, not latest', () => {
            const versions = [
                makeVersion(
                    '2.0.0',
                    new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
                ),
                makeVersion(
                    '2.0.1',
                    new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
                ),
                makeVersion(
                    '2.0.5',
                    new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
                ),
            ];

            const result = getPackageComplianceStatus('1.0.0', '2.0.5', versions, 360);
            if (result.status !== 'non-compliant') {
                throw new Error('Expected non-compliant status');
            }
            expect(result.status).toBe('non-compliant');
            expect(result.daysOverdue).toBeGreaterThan(30);
        });
    });

    describe('edge cases', () => {
        it('handles empty versionsBetween array', () => {
            const result = getPackageComplianceStatus('1.0.0', '2.0.0', [], 360);
            expect(result.status).toBe('compliant');
        });

        it('handles malformed versions', () => {
            const result = getPackageComplianceStatus('invalid', '2.0.0', [], 360);
            expect(result.status).toBe('not-applicable');
        });

        it('skips prerelease versions in versionsBetween', () => {
            const versions: PackageVersionInfo[] = [
                {
                    version: '2.0.0-alpha.1',
                    publishDate: '2024-01-01',
                    isPrerelease: true,
                    npmUrl: 'https://www.npmjs.com/package/test/v/2.0.0-alpha.1',
                },
                {
                    version: '2.0.0-beta.1',
                    publishDate: '2024-02-01',
                    isPrerelease: true,
                    npmUrl: 'https://www.npmjs.com/package/test/v/2.0.0-beta.1',
                },
            ];
            const result = getPackageComplianceStatus('1.0.0', '2.0.0', versions, 360);
            expect(result.status).toBe('compliant');
        });
    });
});

describe('formatComplianceDetail', () => {
    it('returns empty string for compliant status', () => {
        const result = formatComplianceDetail({ status: 'compliant' });
        expect(result).toBe('');
    });

    it('returns empty string for not-applicable status', () => {
        const result = formatComplianceDetail({ status: 'not-applicable' });
        expect(result).toBe('');
    });

    it('formats major update overdue in months', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'major',
            daysOverdue: 65,
            thresholdDays: 360,
        });
        expect(result).toBe('Major update 2 months overdue');
    });

    it('formats minor update overdue in months', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'minor',
            daysOverdue: 90,
            thresholdDays: 180,
        });
        expect(result).toBe('Minor update 3 months overdue');
    });

    it('formats patch update overdue in months', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'patch',
            daysOverdue: 35,
            thresholdDays: 90,
        });
        expect(result).toBe('Patch update 1 month overdue');
    });

    it('formats days when less than 1 month overdue', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'major',
            daysOverdue: 15,
            thresholdDays: 360,
        });
        expect(result).toBe('Major update 15 days overdue');
    });

    it('handles singular day', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'patch',
            daysOverdue: 1,
            thresholdDays: 90,
        });
        expect(result).toBe('Patch update 1 day overdue');
    });

    it('handles singular month', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'minor',
            daysOverdue: 31,
            thresholdDays: 180,
        });
        expect(result).toBe('Minor update 1 month overdue');
    });

    it('handles zero days overdue', () => {
        const result = formatComplianceDetail({
            status: 'non-compliant',
            updateType: 'major',
            daysOverdue: 0,
            thresholdDays: 360,
        });
        expect(result).toBe('Major update 0 days overdue');
    });
});
