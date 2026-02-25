import { describe, it, expect, vi } from 'vitest';
import { DeprecationSource } from './DeprecationSource';
import { FactStore, FactKeys } from './FactStore';
import type { DirectDependency } from '../types';
import type { DeprecationService } from '../services/DeprecationService';

function makeDep(packageName: string, version: string, latestVersion = '2.0.0'): DirectDependency {
    return {
        packageName,
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
        // eslint-disable-next-line @typescript-eslint/no-empty-function
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
        const store = new FactStore();

        await source.fetch([makeDep('old-lib', '1.0.0')], store);

        expect(store.getVersionFact('old-lib', '1.0.0', FactKeys.IS_DEPRECATED)).toBe(true);
    });

    it('marks non-deprecated versions as IS_DEPRECATED=false', async () => {
        const service = mockDeprecationService({
            getDeprecatedPackages: vi.fn(async () => new Set<string>()),
        });
        const source = new DeprecationSource(service);
        const store = new FactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(store.getVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED)).toBe(false);
    });

    it('stores DEPRECATED_TRANSITIVE_DEPS for each dependency', async () => {
        // deprecated-transitive@1.0.0 is pulled in by "react" but is not itself a direct dep
        const deprecationMap = new Map<string, string[]>([
            ['deprecated-transitive@1.0.0', ['react']],
        ]);

        const service = mockDeprecationService({
            getDeprecatedPackages: vi.fn(async () => new Set<string>()),
            getDeprecationMap: vi.fn(async () => deprecationMap),
        });
        const source = new DeprecationSource(service);
        const store = new FactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(
            store.getPackageFact<string[]>('react', FactKeys.DEPRECATED_TRANSITIVE_DEPS),
        ).toEqual(['deprecated-transitive@1.0.0']);
    });

    it('excludes deprecated packages that are themselves direct dependencies', async () => {
        // "old-lib@1.0.0" is deprecated and pulled in by "react",
        // but old-lib is also a direct dependency, so it should be excluded
        const deprecationMap = new Map<string, string[]>([['old-lib@1.0.0', ['react']]]);

        const service = mockDeprecationService({
            getDeprecatedPackages: vi.fn(async () => new Set(['old-lib@1.0.0'])),
            getDeprecationMap: vi.fn(async () => deprecationMap),
        });
        const source = new DeprecationSource(service);
        const store = new FactStore();

        const deps = [makeDep('react', '18.2.0'), makeDep('old-lib', '1.0.0')];
        await source.fetch(deps, store);

        // react should NOT list old-lib as a transitive dep since it's direct
        expect(
            store.getPackageFact<string[]>('react', FactKeys.DEPRECATED_TRANSITIVE_DEPS),
        ).toEqual([]);
    });

    it('handles multiple deprecated transitives for a single dependency', async () => {
        const deprecationMap = new Map<string, string[]>([
            ['dep-a@1.0.0', ['my-pkg']],
            ['dep-b@2.0.0', ['my-pkg']],
            ['dep-c@3.0.0', ['other-pkg']],
        ]);

        const service = mockDeprecationService({
            getDeprecationMap: vi.fn(async () => deprecationMap),
        });
        const source = new DeprecationSource(service);
        const store = new FactStore();

        await source.fetch([makeDep('my-pkg', '1.0.0')], store);

        const transitives = store.getPackageFact<string[]>(
            'my-pkg',
            FactKeys.DEPRECATED_TRANSITIVE_DEPS,
        );
        expect(transitives).toEqual(expect.arrayContaining(['dep-a@1.0.0', 'dep-b@2.0.0']));
        expect(transitives).toHaveLength(2);
    });

    it('stores empty array when no deprecated transitive deps exist', async () => {
        const service = mockDeprecationService({
            getDeprecationMap: vi.fn(async () => new Map()),
        });
        const source = new DeprecationSource(service);
        const store = new FactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(
            store.getPackageFact<string[]>('react', FactKeys.DEPRECATED_TRANSITIVE_DEPS),
        ).toEqual([]);
    });

    it('handles multiple versions per dependency', async () => {
        const deprecated = new Set(['react@17.0.0']);
        const service = mockDeprecationService({
            getDeprecatedPackages: vi.fn(async () => deprecated),
        });
        const source = new DeprecationSource(service);
        const store = new FactStore();

        const dep: DirectDependency = {
            packageName: 'react',
            versions: [
                {
                    version: '17.0.0',
                    latestVersion: '19.0.0',
                    usedBy: ['@my/app'],
                    dependencyTypes: ['prod'],
                    publishDate: '2023-01-01',
                    inCatalog: false,
                },
                {
                    version: '18.2.0',
                    latestVersion: '19.0.0',
                    usedBy: ['@my/lib'],
                    dependencyTypes: ['dev'],
                    publishDate: '2024-01-01',
                    inCatalog: false,
                },
            ],
        };

        await source.fetch([dep], store);

        expect(store.getVersionFact('react', '17.0.0', FactKeys.IS_DEPRECATED)).toBe(true);
        expect(store.getVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED)).toBe(false);
    });
});
