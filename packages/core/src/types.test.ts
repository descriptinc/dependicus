import { describe, it, expect } from 'vitest';
import { mergeProviderDependencies } from './types';
import type { ProviderOutput, DirectDependency } from './types';

function makeProviderOutput(overrides?: Partial<ProviderOutput>): ProviderOutput {
    return {
        name: 'test-provider',
        ecosystem: 'npm',
        supportsCatalog: false,
        dependencies: [],
        ...overrides,
    };
}

function makeDep(overrides?: Partial<DirectDependency>): DirectDependency {
    return {
        packageName: 'test-pkg',
        ecosystem: 'npm',
        versions: [
            {
                version: '1.0.0',
                latestVersion: '2.0.0',
                usedBy: ['app'],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01T00:00:00.000Z',
                inCatalog: false,
            },
        ],
        ...overrides,
    };
}

describe('mergeProviderDependencies', () => {
    it('merges single provider (passthrough)', () => {
        const dep = makeDep();
        const provider = makeProviderOutput({
            name: 'pnpm',
            supportsCatalog: false,
            dependencies: [dep],
        });

        const result = mergeProviderDependencies([provider]);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(dep);
    });

    it('merges two providers with same package/version - unions usedBy and dependencyTypes', () => {
        const dep1 = makeDep({
            packageName: 'lodash',
            versions: [
                {
                    version: '4.17.21',
                    latestVersion: '4.17.21',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const dep2 = makeDep({
            packageName: 'lodash',
            versions: [
                {
                    version: '4.17.21',
                    latestVersion: '4.17.21',
                    usedBy: ['lib', 'tools'],
                    dependencyTypes: ['dev'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const provider1 = makeProviderOutput({
            name: 'pnpm',
            dependencies: [dep1],
        });

        const provider2 = makeProviderOutput({
            name: 'yarn',
            dependencies: [dep2],
        });

        const result = mergeProviderDependencies([provider1, provider2]);

        expect(result).toHaveLength(1);
        expect(result[0]!.packageName).toBe('lodash');
        expect(result[0]!.versions).toHaveLength(1);
        expect(result[0]!.versions[0]).toEqual({
            version: '4.17.21',
            latestVersion: '4.17.21',
            usedBy: ['app', 'lib', 'tools'],
            dependencyTypes: ['dev', 'prod'],
            publishDate: '2024-01-01T00:00:00.000Z',
            inCatalog: false,
        });
    });

    it('merges two providers with different packages - includes both', () => {
        const dep1 = makeDep({
            packageName: 'lodash',
            versions: [
                {
                    version: '4.17.21',
                    latestVersion: '4.17.21',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const dep2 = makeDep({
            packageName: 'express',
            versions: [
                {
                    version: '4.18.0',
                    latestVersion: '4.18.0',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const provider1 = makeProviderOutput({
            name: 'pnpm',
            dependencies: [dep1],
        });

        const provider2 = makeProviderOutput({
            name: 'yarn',
            dependencies: [dep2],
        });

        const result = mergeProviderDependencies([provider1, provider2]);

        expect(result).toHaveLength(2);
        expect(result[0]!.packageName).toBe('express');
        expect(result[1]!.packageName).toBe('lodash');
    });

    it('sets inCatalog true if any provider has it true', () => {
        const dep1 = makeDep({
            packageName: 'react',
            versions: [
                {
                    version: '18.0.0',
                    latestVersion: '18.0.0',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const dep2 = makeDep({
            packageName: 'react',
            versions: [
                {
                    version: '18.0.0',
                    latestVersion: '18.0.0',
                    usedBy: ['lib'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: true,
                },
            ],
        });

        const provider1 = makeProviderOutput({
            name: 'pnpm',
            supportsCatalog: true,
            dependencies: [dep1],
        });

        const provider2 = makeProviderOutput({
            name: 'yarn',
            supportsCatalog: false,
            dependencies: [dep2],
        });

        const result = mergeProviderDependencies([provider1, provider2]);

        expect(result).toHaveLength(1);
        expect(result[0]!.versions[0]!.inCatalog).toBe(true);
    });

    it('results sorted by package name', () => {
        const dep1 = makeDep({
            packageName: 'zebra',
            versions: [
                {
                    version: '1.0.0',
                    latestVersion: '1.0.0',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const dep2 = makeDep({
            packageName: 'apple',
            versions: [
                {
                    version: '1.0.0',
                    latestVersion: '1.0.0',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const dep3 = makeDep({
            packageName: 'monkey',
            versions: [
                {
                    version: '1.0.0',
                    latestVersion: '1.0.0',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: false,
                },
            ],
        });

        const provider = makeProviderOutput({
            name: 'pnpm',
            dependencies: [dep1, dep2, dep3],
        });

        const result = mergeProviderDependencies([provider]);

        expect(result).toHaveLength(3);
        expect(result[0]!.packageName).toBe('apple');
        expect(result[1]!.packageName).toBe('monkey');
        expect(result[2]!.packageName).toBe('zebra');
    });
});
