import { describe, it, expect, vi } from 'vitest';
import { WorkspaceSource } from './WorkspaceSource';
import { RootFactStore, FactKeys } from './FactStore';
import type { DirectDependency } from '../types';
import type { DependencyProvider } from '../providers/DependencyProvider';

function makeDep(packageName: string, version: string): DirectDependency {
    return {
        packageName,
        ecosystem: 'npm',
        versions: [
            {
                version,
                latestVersion: '2.0.0',
                usedBy: ['@my/app'],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01',
                inCatalog: false,
            },
        ],
    };
}

function mockProvider(overrides: Partial<DependencyProvider> = {}): DependencyProvider {
    return {
        name: 'mock',
        ecosystem: 'npm',
        rootDir: '/repo',
        lockfilePath: '/repo/mock.lock',
        supportsCatalog: false,
        installCommand: 'pnpm install',
        urlPatterns: {},
        getPackages: vi.fn().mockResolvedValue([]),
        isPatched: vi.fn(() => false),
        hasPackageInCatalog: vi.fn(() => false),
        isInCatalog: vi.fn(() => false),
        createSources: vi.fn().mockReturnValue([]),
        ...overrides,
    } as unknown as DependencyProvider;
}

describe('WorkspaceSource', () => {
    it('has the correct name and no dependencies', () => {
        const source = new WorkspaceSource([mockProvider()]);
        expect(source.name).toBe('workspace');
        expect(source.dependsOn).toEqual([]);
    });

    it('sets IS_PATCHED fact for patched versions', async () => {
        const provider = mockProvider({
            isPatched: vi.fn((pkg, ver) => pkg === 'react' && ver === '18.2.0'),
        });
        const source = new WorkspaceSource([provider]);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(store.scoped('npm').getVersionFact('react', '18.2.0', FactKeys.IS_PATCHED)).toBe(
            true,
        );
    });

    it('sets IS_PATCHED=false for non-patched versions', async () => {
        const source = new WorkspaceSource([mockProvider()]);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(store.scoped('npm').getVersionFact('react', '18.2.0', FactKeys.IS_PATCHED)).toBe(
            false,
        );
    });

    it('sets HAS_CATALOG_MISMATCH when package is in catalog but version does not match', async () => {
        const provider = mockProvider({
            hasPackageInCatalog: vi.fn(() => true),
            isInCatalog: vi.fn(() => false),
        });
        const source = new WorkspaceSource([provider]);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '17.0.0')], store);

        expect(
            store.scoped('npm').getVersionFact('react', '17.0.0', FactKeys.HAS_CATALOG_MISMATCH),
        ).toBe(true);
    });

    it('sets HAS_CATALOG_MISMATCH=false when version matches catalog', async () => {
        const provider = mockProvider({
            hasPackageInCatalog: vi.fn(() => true),
            isInCatalog: vi.fn(() => true),
        });
        const source = new WorkspaceSource([provider]);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(
            store.scoped('npm').getVersionFact('react', '18.2.0', FactKeys.HAS_CATALOG_MISMATCH),
        ).toBe(false);
    });

    it('sets HAS_CATALOG_MISMATCH=false when package is not in catalog', async () => {
        const provider = mockProvider({
            hasPackageInCatalog: vi.fn(() => false),
        });
        const source = new WorkspaceSource([provider]);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0')], store);

        expect(
            store.scoped('npm').getVersionFact('react', '18.2.0', FactKeys.HAS_CATALOG_MISMATCH),
        ).toBe(false);
    });

    it('handles multiple dependencies and versions', async () => {
        const provider = mockProvider({
            isPatched: vi.fn((pkg, ver) => pkg === 'react' && ver === '18.2.0'),
            hasPackageInCatalog: vi.fn(() => false),
        });
        const source = new WorkspaceSource([provider]);
        const store = new RootFactStore();

        await source.fetch([makeDep('react', '18.2.0'), makeDep('vue', '3.0.0')], store);

        const scoped = store.scoped('npm');
        expect(scoped.getVersionFact('react', '18.2.0', FactKeys.IS_PATCHED)).toBe(true);
        expect(scoped.getVersionFact('vue', '3.0.0', FactKeys.IS_PATCHED)).toBe(false);
    });
});
