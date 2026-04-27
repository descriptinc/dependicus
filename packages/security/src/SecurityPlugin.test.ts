import { describe, it, expect } from 'vitest';
import { RootFactStore } from '@dependicus/core';
import type { DependencyVersion } from '@dependicus/core';
import { SecurityPlugin } from './SecurityPlugin';
import type { SecurityFinding } from './types';
import { SECURITY_FINDINGS_KEY } from './types';

function makeVersion(overrides?: Partial<DependencyVersion>): DependencyVersion {
    return {
        version: '1.0.0',
        latestVersion: '2.0.0',
        usedBy: ['@app/web'],
        dependencyTypes: ['prod'],
        publishDate: '2024-01-01',
        inCatalog: false,
        ...overrides,
    };
}

describe('SecurityPlugin', () => {
    it('constructs OsvSource when osv is true', () => {
        const plugin = new SecurityPlugin({ osv: true });
        expect(plugin.sources).toHaveLength(1);
        expect(plugin.sources[0]!.name).toBe('osv');
    });

    it('constructs no sources when config is empty', () => {
        const plugin = new SecurityPlugin({});
        expect(plugin.sources).toHaveLength(0);
    });

    it('columns return empty strings when no findings exist', () => {
        const plugin = new SecurityPlugin({ osv: true });
        const store = new RootFactStore();
        const scoped = store.scoped('npm');
        const ver = makeVersion();

        const ctx = { name: 'react', version: ver, store: scoped, ecosystem: 'npm' };
        for (const col of plugin.columns) {
            expect(col.getValue(ctx)).toBe('');
        }
    });

    it('columns render severity and fix when findings exist', () => {
        const plugin = new SecurityPlugin({ osv: true });
        const store = new RootFactStore();
        const scoped = store.scoped('npm');
        const ver = makeVersion();

        const finding: SecurityFinding = {
            source: 'osv',
            sourceLabel: 'OSV',
            severity: 'high',
            advisoryCount: 2,
            fixAvailable: true,
            rationale: ['2 advisories', 'fix available in a newer version'],
            sourceLinks: [{ label: 'GHSA-1234', url: 'https://osv.dev/vulnerability/GHSA-1234' }],
        };
        scoped.setVersionFact('react', '1.0.0', SECURITY_FINDINGS_KEY, [finding]);

        const secCol = plugin.columns.find((c) => c.key === 'security')!;
        const fixCol = plugin.columns.find((c) => c.key === 'securityFix')!;
        const whyCol = plugin.columns.find((c) => c.key === 'securityWhy')!;

        const ctx = { name: 'react', version: ver, store: scoped, ecosystem: 'npm' };
        const secValue = secCol.getValue(ctx);
        expect(secValue).toContain('High');
        expect(secValue).toContain('<a href=');
        expect(secValue).toContain('osv.dev');
        expect(fixCol.getValue(ctx)).toBe('Yes');
        const whyValue = whyCol.getValue(ctx);
        expect(whyValue).toContain('<a href=');
        expect(whyValue).toContain('GHSA-1234');
        expect(whyValue).toContain('fix available');
    });

    it('getLinearIssueSpec returns description sections for findings', () => {
        const plugin = new SecurityPlugin({ osv: true });
        const store = new RootFactStore();
        const scoped = store.scoped('npm');

        const finding: SecurityFinding = {
            source: 'osv',
            sourceLabel: 'OSV',
            severity: 'critical',
            advisoryCount: 1,
            fixAvailable: false,
            advisories: [
                {
                    id: 'CVE-2024-0001',
                    summary: 'Prototype pollution in lodash',
                    severity: 'critical',
                    cvssScore: 9.8,
                    fixAvailable: false,
                    url: 'https://osv.dev/vulnerability/CVE-2024-0001',
                },
            ],
            advisoryIds: ['CVE-2024-0001'],
            rationale: ['1 advisory (CVE-2024-0001)'],
            sourceLinks: [
                { label: 'CVE-2024-0001', url: 'https://osv.dev/vulnerability/CVE-2024-0001' },
            ],
        };
        scoped.setVersionFact('lodash', '4.17.20', SECURITY_FINDINGS_KEY, [finding]);

        const spec = plugin.getLinearIssueSpec(
            {
                name: 'lodash',
                ecosystem: 'npm',
                currentVersion: '4.17.20',
                latestVersion: '4.17.21',
            },
            scoped,
        );

        expect(spec).toBeDefined();
        expect(spec!.descriptionSections).toBeDefined();
        expect(spec!.descriptionSections!.length).toBeGreaterThanOrEqual(2);

        const titles = spec!.descriptionSections!.map((s) => s.title);
        expect(titles).toContain('Security summary');
        expect(titles).toContain('Advisories');

        const advisorySection = spec!.descriptionSections!.find((s) => s.title === 'Advisories')!;
        expect(advisorySection.body).toContain('CVE-2024-0001');
        expect(advisorySection.body).toContain('Prototype pollution in lodash');
        expect(advisorySection.body).toContain('critical');
    });

    it('getLinearIssueSpec returns undefined when no findings', () => {
        const plugin = new SecurityPlugin({ osv: true });
        const store = new RootFactStore();
        const scoped = store.scoped('npm');

        const spec = plugin.getLinearIssueSpec(
            {
                name: 'lodash',
                ecosystem: 'npm',
                currentVersion: '4.17.20',
                latestVersion: '4.17.21',
            },
            scoped,
        );

        expect(spec).toBeUndefined();
    });
});
