import { describe, it, expect, vi } from 'vitest';
import { DeprecationSource } from './DeprecationSource';
import { RootFactStore, FactKeys } from '@dependicus/core';
import type { DirectDependency } from '@dependicus/core';
import type { DeprecationService } from '../services/DeprecationService';

function makeDep(name: string, version: string, latestVersion = '2.0.0'): DirectDependency {
    return {
        name,
        ecosystem: 'npm',
        versions: [
            {
                version,
                latestVersion,
                usedBy: ['@my/app'],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01',
                inCatalog: false,
            },
        ],
    };
}

function mockDeprecationService(overrides: Partial<DeprecationService> = {}): DeprecationService {
    return {
        getDeprecatedPackages: vi.fn(async () => new Set<string>()),
        getDeprecationMap: vi.fn(async () => new Map<string, string[]>()),
        isDeprecated: vi.fn(async () => false),
        getDeprecatedTransitiveDeps: vi.fn(async () => []),
        warmCaches: vi.fn(async () => {}),
        ...overrides,
    } as unknown as DeprecationService;
}

describe('DeprecationSource', () => {
    it('has the correct name and no dependencies', () => {
        const source = new DeprecationSource(mockDeprecationService());
        expect(source.name).toBe('deprecation');
        expect(source.dependsOn).toEqual([]);
    });

    it('marks deprecated versions as IS_DEPRECATED=true', async () => {
        const service = mockDeprecationService({
            getDeprecatedPackages: vi.fn(async () => new Set(['old-lib@1.0.0'])),
        });
        const source = new DeprecationSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('old-lib', '1.0.0')], store);

        expect(store.getVersionFact('old-lib', '1.0.0', FactKeys.IS_DEPRECATED)).toBe(true);
    });

    it('marks non-deprecated versions as IS_DEPRECATED=false', async () => {
        const source = new DeprecationSource(mockDeprecationService());
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(store.getVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED)).toBe(false);
    });

    it('stores DEPRECATED_TRANSITIVE_DEPS for each dependency', async () => {
        const deprecationMap = new Map<string, string[]>([
            ['deprecated-transitive@1.0.0', ['react']],
        ]);
        const service = mockDeprecationService({
            getDeprecationMap: vi.fn(async () => deprecationMap),
        });
        const source = new DeprecationSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(
            store.getDependencyFact<string[]>('react', FactKeys.DEPRECATED_TRANSITIVE_DEPS),
        ).toEqual(['deprecated-transitive@1.0.0']);
    });

    it('stores empty array when no deprecated transitive deps exist', async () => {
        const service = mockDeprecationService({
            getDeprecationMap: vi.fn(async () => new Map()),
        });
        const source = new DeprecationSource(service);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(
            store.getDependencyFact<string[]>('react', FactKeys.DEPRECATED_TRANSITIVE_DEPS),
        ).toEqual([]);
    });
});
