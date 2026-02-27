import { describe, it, expect } from 'vitest';
import { computeOutputMetadata } from './types';
import type { DirectDependency } from './types';
import { FactStore } from './sources/FactStore';

function makeDep(overrides?: Partial<DirectDependency>): DirectDependency {
    return {
        packageName: 'test-pkg',
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

describe('computeOutputMetadata', () => {
    it('sets hasCatalog true when supportsCatalog is true, regardless of data', () => {
        const dep = makeDep();
        const store = new FactStore();
        const metadata = computeOutputMetadata([dep], store, true);
        expect(metadata.hasCatalog).toBe(true);
    });

    it('sets hasCatalog false when supportsCatalog is false, even if data has inCatalog', () => {
        const dep = makeDep({
            versions: [
                {
                    version: '1.0.0',
                    latestVersion: '2.0.0',
                    usedBy: ['app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2024-01-01T00:00:00.000Z',
                    inCatalog: true,
                },
            ],
        });
        const store = new FactStore();
        const metadata = computeOutputMetadata([dep], store, false);
        expect(metadata.hasCatalog).toBe(false);
    });
});
