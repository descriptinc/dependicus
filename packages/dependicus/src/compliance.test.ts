import { describe, it, expect } from 'vitest';
import { FactStore, FactKeys } from '@dependicus/core';
import type {
    PackageVersionInfo,
    GroupingDetailContext,
    DependencyVersion,
} from '@dependicus/core';
import type { VersionContext } from '@dependicus/linear';
import {
    BasicCompliancePlugin,
    type CompliancePolicy,
    type BasicComplianceConfig,
} from './compliance';

const POLICY_KEY = 'testPolicy';

const tier1Policy: CompliancePolicy = {
    name: 'Tier 1',
    thresholdDays: { major: 360, minor: 180, patch: 90 },
    description: 'Major dependencies',
};

const tier2Policy: CompliancePolicy = {
    name: 'Tier 2',
    thresholdDays: { minor: 180, patch: 90 },
    description: 'No major threshold',
};

const tier3Policy: CompliancePolicy = {
    name: 'Tier 3',
    notificationsOnly: true,
    notificationRateLimitDays: 30,
    description: 'Notifications only',
};

const nonePolicy: CompliancePolicy = {
    name: 'None',
    description: 'No updates required',
};

const policies: Record<string, CompliancePolicy> = {
    tier1: tier1Policy,
    tier2: tier2Policy,
    tier3: tier3Policy,
    none: nonePolicy,
};

function makeConfig(): BasicComplianceConfig {
    return {
        policies,
        getPolicy: (packageName, store) => {
            return store.getPackageFact<string>(packageName, POLICY_KEY);
        },
    };
}

function makeStore(packageName: string, policyId: string | undefined): FactStore {
    const store = new FactStore();
    if (policyId) {
        store.setPackageFact(packageName, POLICY_KEY, policyId);
    }
    return store;
}

function makeDependencyVersion(overrides: Partial<DependencyVersion> = {}): DependencyVersion {
    return {
        version: '1.0.0',
        latestVersion: '2.0.0',
        usedBy: ['@app/web'],
        dependencyTypes: ['prod'],
        publishDate: '2024-01-01',
        inCatalog: true,
        ...overrides,
    };
}

describe('compliance columns', () => {
    it('returns non-compliant for overdue packages', () => {
        const config = makeConfig();
        const plugin = new BasicCompliancePlugin(config);
        const store = makeStore('test-pkg', 'tier1');
        const versionsBetween: PackageVersionInfo[] = [
            {
                version: '2.0.0',
                publishDate: '2022-01-01T00:00:00.000Z',
                isPrerelease: false,
                npmUrl: '',
            },
        ];
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, versionsBetween);

        const version = makeDependencyVersion();
        const complianceCol = plugin.columns!.find((c) => c.key === 'compliance')!;
        expect(complianceCol.getValue('test-pkg', version, store)).toBe('Non-Compliant');
    });

    it('returns compliant for packages within threshold', () => {
        const config = makeConfig();
        const plugin = new BasicCompliancePlugin(config);
        const store = makeStore('test-pkg', 'tier1');
        const recentDate = new Date(Date.now() - 30 * 86400000).toISOString(); // 30 days ago
        const versionsBetween: PackageVersionInfo[] = [
            { version: '2.0.0', publishDate: recentDate, isPrerelease: false, npmUrl: '' },
        ];
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, versionsBetween);

        const version = makeDependencyVersion();
        const complianceCol = plugin.columns!.find((c) => c.key === 'compliance')!;
        expect(complianceCol.getValue('test-pkg', version, store)).toBe('Compliant');
    });

    it('returns not-applicable when no policy set', () => {
        const config = makeConfig();
        const plugin = new BasicCompliancePlugin(config);
        const store = makeStore('test-pkg', undefined);

        const version = makeDependencyVersion();
        const complianceCol = plugin.columns!.find((c) => c.key === 'compliance')!;
        expect(complianceCol.getValue('test-pkg', version, store)).toBe('N/A');
    });

    it('returns detail text for non-compliant packages', () => {
        const config = makeConfig();
        const plugin = new BasicCompliancePlugin(config);
        const store = makeStore('test-pkg', 'tier1');
        const versionsBetween: PackageVersionInfo[] = [
            {
                version: '2.0.0',
                publishDate: '2022-01-01T00:00:00.000Z',
                isPrerelease: false,
                npmUrl: '',
            },
        ];
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, versionsBetween);

        const version = makeDependencyVersion();
        const detailCol = plugin.columns!.find((c) => c.key === 'complianceDetail')!;
        const detail = detailCol.getValue('test-pkg', version, store);
        expect(detail).toContain('Major update');
        expect(detail).toContain('overdue');
    });
});

describe('getSections', () => {
    it('returns compliance stats and flagged packages', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: (pkg, s) => s.getPackageFact<string>(pkg, POLICY_KEY),
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        // Compliant package
        store.setPackageFact('compliant-pkg', POLICY_KEY, 'tier1');
        const recentDate = new Date(Date.now() - 30 * 86400000).toISOString();
        store.setVersionFact('compliant-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            { version: '2.0.0', publishDate: recentDate, isPrerelease: false, npmUrl: '' },
        ]);

        // Non-compliant package
        store.setPackageFact('overdue-pkg', POLICY_KEY, 'tier1');
        store.setVersionFact('overdue-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            {
                version: '2.0.0',
                publishDate: '2022-01-01T00:00:00.000Z',
                isPrerelease: false,
                npmUrl: '',
            },
        ]);

        const ctx: GroupingDetailContext = {
            groupValue: 'test-group',
            dependencies: [
                { packageName: 'compliant-pkg', versions: [makeDependencyVersion()] },
                { packageName: 'overdue-pkg', versions: [makeDependencyVersion()] },
            ],
            store,
        };

        const sections = plugin.getSections!(ctx);
        const complianceSection = sections.find((s) => s.title === 'Compliance');
        expect(complianceSection).toBeDefined();
        expect(complianceSection!.stats).toContainEqual({ label: 'Compliant', value: 1 });
        expect(complianceSection!.stats).toContainEqual({
            label: 'Out of Compliance',
            value: 1,
        });

        const flaggedSection = sections.find((s) => s.title === 'Non-Compliant Packages');
        expect(flaggedSection).toBeDefined();
        expect(flaggedSection!.flaggedPackages).toHaveLength(1);
        expect(flaggedSection!.flaggedPackages![0]!.packageName).toBe('overdue-pkg');
    });

    it('returns empty sections when no dependencies', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: (pkg, s) => s.getPackageFact<string>(pkg, POLICY_KEY),
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();
        const ctx: GroupingDetailContext = {
            groupValue: 'test-group',
            dependencies: [],
            store,
        };

        const sections = plugin.getSections!(ctx);
        expect(sections).toEqual([]);
    });

    it('counts no-policy packages correctly', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => undefined, // no policy for any package
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();
        const ctx: GroupingDetailContext = {
            groupValue: 'test-group',
            dependencies: [
                { packageName: 'no-policy-pkg', versions: [makeDependencyVersion()] },
            ],
            store,
        };

        const sections = plugin.getSections!(ctx);
        const complianceSection = sections.find((s) => s.title === 'Compliance');
        expect(complianceSection).toBeDefined();
        expect(complianceSection!.stats).toContainEqual({ label: 'No Policy Set', value: 1 });
    });
});

describe('getTicketSpec', () => {
    const defaultContext: VersionContext = {
        packageName: 'test-pkg',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
    };

    it('returns dueDate policy for tier1', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier1',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            { version: '2.0.0', publishDate: '2022-01-01', isPrerelease: false, npmUrl: '' },
        ]);

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result).toBeDefined();
        expect(result!.policy).toEqual({ type: 'dueDate' });
    });

    it('returns fyi policy for notifications-only', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier3',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result).toBeDefined();
        expect(result!.policy).toEqual({ type: 'fyi', rateLimitDays: 30 });
    });

    it('returns noTicket policy when no thresholds and not notifications-only', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'none',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result).toBeDefined();
        expect(result!.policy).toEqual({ type: 'noTicket' });
    });

    it('includes daysOverdue and thresholdDays for non-compliant packages', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier1',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            { version: '2.0.0', publishDate: '2022-01-01', isPrerelease: false, npmUrl: '' },
        ]);

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result!.daysOverdue).toBeGreaterThan(0);
        expect(result!.thresholdDays).toBe(360);
        expect(result!.targetVersion).toBe('2.0.0');
    });

    it('does not include daysOverdue for notifications-only', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier3',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result!.daysOverdue).toBeUndefined();
        expect(result!.thresholdDays).toBeUndefined();
        expect(result!.targetVersion).toBeUndefined();
    });

    it('targets within-major version for tier2 policy (no major threshold)', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier2',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            { version: '1.1.0', publishDate: '2022-01-01', isPrerelease: false, npmUrl: '' },
            { version: '2.0.0', publishDate: '2022-06-01', isPrerelease: false, npmUrl: '' },
        ]);

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result!.targetVersion).toBe('1.1.0');
        expect(result!.availableMajorVersion).toBe('2.0.0');
    });

    it('does not set availableMajorVersion when latest is only a minor bump', () => {
        const patchOnlyPolicies = {
            patchOnly: {
                name: 'Patch Only',
                thresholdDays: { patch: 30 } as const,
            },
        };
        const config: BasicComplianceConfig = {
            policies: patchOnlyPolicies,
            getPolicy: () => 'patchOnly',
        };
        const plugin = new BasicCompliancePlugin(config);
        const context: VersionContext = {
            packageName: 'test-pkg',
            currentVersion: '1.0.0',
            latestVersion: '1.5.0',
        };
        const store = new FactStore();
        store.setVersionFact('test-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            { version: '1.0.5', publishDate: '2022-01-01', isPrerelease: false, npmUrl: '' },
            { version: '1.5.0', publishDate: '2022-06-01', isPrerelease: false, npmUrl: '' },
        ]);

        const result = plugin.getTicketSpec!(context, store);
        expect(result!.targetVersion).toBe('1.0.5');
        expect(result!.availableMajorVersion).toBeUndefined();
    });

    it('includes descriptionSections with policy info', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier1',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result!.descriptionSections).toHaveLength(1);
        const section = result!.descriptionSections![0]!;
        expect(section.title).toBe('Policy');
        expect(section.body).toContain('**Tier 1** policy');
        expect(section.body).toContain('Major updates: 12 months');
        expect(section.body).toContain('Minor updates: 6 months');
        expect(section.body).toContain('Patch updates: 3 months');
    });

    it('does NOT return teamId, assignment, group, or ownerLabel', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier1',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result).toBeDefined();
        expect('teamId' in result!).toBe(false);
        expect('assignment' in result!).toBe(false);
        expect('group' in result!).toBe(false);
        expect('ownerLabel' in result!).toBe(false);
    });

    it('returns undefined when no policy found', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => undefined,
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result).toBeUndefined();
    });

    it('returns undefined for unknown policy ID', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'nonexistent-policy',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        expect(result).toBeUndefined();
    });

    it('includes notifications-only line for tier3 policy', () => {
        const config: BasicComplianceConfig = {
            policies,
            getPolicy: () => 'tier3',
        };
        const plugin = new BasicCompliancePlugin(config);
        const store = new FactStore();

        const result = plugin.getTicketSpec!(defaultContext, store);
        const section = result!.descriptionSections![0]!;
        expect(section.body).toContain('Notifications only (no mandatory updates)');
    });
});

describe('groupings', () => {
    it('creates a compliance-policy grouping', () => {
        const plugin = new BasicCompliancePlugin(makeConfig());
        expect(plugin.groupings).toHaveLength(1);
        expect(plugin.groupings[0]!.key).toBe('compliance-policy');
        expect(plugin.groupings[0]!.label).toBe('Compliance Policies');
    });

    it('getValue returns the policy name for a package with a policy', () => {
        const plugin = new BasicCompliancePlugin(makeConfig());
        const store = makeStore('test-pkg', 'tier1');
        const grouping = plugin.groupings[0]!;
        expect(grouping.getValue('test-pkg', store)).toBe('Tier 1');
    });

    it('getValue returns undefined for a package with no policy', () => {
        const plugin = new BasicCompliancePlugin(makeConfig());
        const store = makeStore('test-pkg', undefined);
        const grouping = plugin.groupings[0]!;
        expect(grouping.getValue('test-pkg', store)).toBeUndefined();
    });

    it('getSections returns compliance stats for the grouped packages', () => {
        const plugin = new BasicCompliancePlugin(makeConfig());
        const store = new FactStore();
        store.setPackageFact('compliant-pkg', POLICY_KEY, 'tier1');
        store.setVersionFact('compliant-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            {
                version: '2.0.0',
                publishDate: new Date(Date.now() - 30 * 86400000).toISOString(),
                isPrerelease: false,
                npmUrl: '',
            },
        ]);
        store.setPackageFact('overdue-pkg', POLICY_KEY, 'tier1');
        store.setVersionFact('overdue-pkg', '1.0.0', FactKeys.VERSIONS_BETWEEN, [
            {
                version: '2.0.0',
                publishDate: '2022-01-01T00:00:00.000Z',
                isPrerelease: false,
                npmUrl: '',
            },
        ]);

        const grouping = plugin.groupings[0]!;
        const sections = grouping.getSections!({
            groupValue: 'Tier 1',
            dependencies: [
                { packageName: 'compliant-pkg', versions: [makeDependencyVersion()] },
                { packageName: 'overdue-pkg', versions: [makeDependencyVersion()] },
            ],
            store,
        });

        const statsSection = sections.find((s) => s.title === 'Compliance');
        expect(statsSection).toBeDefined();
        expect(statsSection!.stats).toContainEqual({ label: 'Compliant', value: 1 });
        expect(statsSection!.stats).toContainEqual({ label: 'Out of Compliance', value: 1 });

        const flaggedSection = sections.find((s) => s.title === 'Non-Compliant Packages');
        expect(flaggedSection).toBeDefined();
        expect(flaggedSection!.flaggedPackages).toHaveLength(1);
    });
});
