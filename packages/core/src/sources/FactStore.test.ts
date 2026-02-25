import { describe, it, expect } from 'vitest';
import { RootFactStore, FactKeys } from './FactStore';

describe('RootFactStore', () => {
    describe('package-level facts', () => {
        it('round-trips a value', () => {
            const store = new RootFactStore();
            store.setDependencyFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            expect(store.getDependencyFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
        });

        it('returns undefined for missing keys', () => {
            const store = new RootFactStore();
            expect(store.getDependencyFact('react', FactKeys.GITHUB_DATA)).toBeUndefined();
        });

        it('overwrites existing values', () => {
            const store = new RootFactStore();
            store.setDependencyFact('react', 'customMeta', 'first');
            store.setDependencyFact('react', 'customMeta', 'second');
            expect(store.getDependencyFact('react', 'customMeta')).toBe('second');
        });

        it('isolates facts by package name', () => {
            const store = new RootFactStore();
            store.setDependencyFact('react', 'customMeta', 'react-meta');
            store.setDependencyFact('vue', 'customMeta', 'vue-meta');
            expect(store.getDependencyFact('react', 'customMeta')).toBe('react-meta');
            expect(store.getDependencyFact('vue', 'customMeta')).toBe('vue-meta');
        });

        it('isolates facts by key', () => {
            const store = new RootFactStore();
            store.setDependencyFact('react', FactKeys.GITHUB_DATA, 'gh');
            store.setDependencyFact('react', FactKeys.SIZE_MAP, 'sizes');
            expect(store.getDependencyFact('react', FactKeys.GITHUB_DATA)).toBe('gh');
            expect(store.getDependencyFact('react', FactKeys.SIZE_MAP)).toBe('sizes');
        });
    });

    describe('version-level facts', () => {
        it('round-trips a value', () => {
            const store = new RootFactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            expect(store.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBe(12345);
        });

        it('returns undefined for missing keys', () => {
            const store = new RootFactStore();
            expect(store.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBeUndefined();
        });

        it('overwrites existing values', () => {
            const store = new RootFactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.DESCRIPTION, 'old');
            store.setVersionFact('react', '18.2.0', FactKeys.DESCRIPTION, 'new');
            expect(store.getVersionFact('react', '18.2.0', FactKeys.DESCRIPTION)).toBe('new');
        });

        it('isolates facts by version', () => {
            const store = new RootFactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.HOMEPAGE, 'v18');
            store.setVersionFact('react', '19.0.0', FactKeys.HOMEPAGE, 'v19');
            expect(store.getVersionFact('react', '18.2.0', FactKeys.HOMEPAGE)).toBe('v18');
            expect(store.getVersionFact('react', '19.0.0', FactKeys.HOMEPAGE)).toBe('v19');
        });
    });

    describe('toJSON', () => {
        it('serializes package facts into nested objects', () => {
            const store = new RootFactStore();
            store.setDependencyFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            store.setDependencyFact('react', FactKeys.SIZE_MAP, { '18.2.0': 50000 });
            store.setDependencyFact('vue', 'customMeta', 'vue-meta');

            const json = store.toJSON();

            expect(json.dependency).toEqual({
                _root: {
                    react: {
                        [FactKeys.GITHUB_DATA]: { owner: 'facebook' },
                        [FactKeys.SIZE_MAP]: { '18.2.0': 50000 },
                    },
                    vue: {
                        customMeta: 'vue-meta',
                    },
                },
            });
        });

        it('serializes version facts into nested objects', () => {
            const store = new RootFactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            store.setVersionFact('react', '19.0.0', FactKeys.DESCRIPTION, 'React 19');
            store.setVersionFact('vue', '3.0.0', FactKeys.HOMEPAGE, 'https://vuejs.org');

            const json = store.toJSON();

            expect(json.version).toEqual({
                _root: {
                    react: {
                        '18.2.0': { [FactKeys.UNPACKED_SIZE]: 12345 },
                        '19.0.0': { [FactKeys.DESCRIPTION]: 'React 19' },
                    },
                    vue: {
                        '3.0.0': { [FactKeys.HOMEPAGE]: 'https://vuejs.org' },
                    },
                },
            });
        });

        it('returns empty objects for empty store', () => {
            const store = new RootFactStore();
            const json = store.toJSON();
            expect(json).toEqual({ dependency: {}, version: {} });
        });
    });

    describe('fromJSON', () => {
        it('deserializes package facts from old format', () => {
            const store = RootFactStore.fromJSON({
                package: {
                    react: { [FactKeys.GITHUB_DATA]: { owner: 'facebook' } },
                },
                version: {},
            });

            expect(store.getDependencyFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
        });

        it('deserializes version facts from old format', () => {
            const store = RootFactStore.fromJSON({
                package: {},
                version: {
                    react: {
                        '18.2.0': { [FactKeys.UNPACKED_SIZE]: 12345 },
                    },
                },
            });

            expect(store.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBe(12345);
        });

        it('round-trips through toJSON/fromJSON', () => {
            const original = new RootFactStore();
            original.setDependencyFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            original.setDependencyFact('react', FactKeys.SIZE_MAP, { '18.2.0': 50000 });
            original.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            original.setVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED, false);
            original.setVersionFact('vue', '3.0.0', FactKeys.DESCRIPTION, 'Vue 3');

            const restored = RootFactStore.fromJSON(original.toJSON());

            expect(restored.getDependencyFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
            expect(restored.getDependencyFact('react', FactKeys.SIZE_MAP)).toEqual({
                '18.2.0': 50000,
            });
            expect(restored.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBe(12345);
            expect(restored.getVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED)).toBe(false);
            expect(restored.getVersionFact('vue', '3.0.0', FactKeys.DESCRIPTION)).toBe('Vue 3');
        });
    });

    describe('key space isolation', () => {
        it('package and version facts do not collide', () => {
            const store = new RootFactStore();
            // A package fact with key "description" should not interfere
            // with a version fact for the same package and key
            store.setDependencyFact('react', FactKeys.DESCRIPTION, 'package-level');
            store.setVersionFact('react', '18.2.0', FactKeys.DESCRIPTION, 'version-level');
            expect(store.getDependencyFact('react', FactKeys.DESCRIPTION)).toBe('package-level');
            expect(store.getVersionFact('react', '18.2.0', FactKeys.DESCRIPTION)).toBe(
                'version-level',
            );
        });
    });
});

describe('ScopedFactStore', () => {
    it('isolates facts by ecosystem', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        const mise = root.scoped('mise');

        npm.setDependencyFact('node', 'description', 'npm node');
        mise.setDependencyFact('node', 'description', 'mise node');

        expect(npm.getDependencyFact('node', 'description')).toBe('npm node');
        expect(mise.getDependencyFact('node', 'description')).toBe('mise node');
    });

    it('isolates version facts by ecosystem', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        const mise = root.scoped('mise');

        npm.setVersionFact('node', '22.0.0', 'size', 100);
        mise.setVersionFact('node', '22.0.0', 'size', 200);

        expect(npm.getVersionFact('node', '22.0.0', 'size')).toBe(100);
        expect(mise.getVersionFact('node', '22.0.0', 'size')).toBe(200);
    });

    it('scoped facts are visible in toJSON output', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        npm.setDependencyFact('react', 'description', 'React lib');
        npm.setVersionFact('react', '18.2.0', 'size', 12345);

        const json = root.toJSON();

        expect(json.dependency).toEqual({
            npm: { react: { description: 'React lib' } },
        });
        expect(json.version).toEqual({
            npm: { react: { '18.2.0': { size: 12345 } } },
        });
    });

    it('scoped facts round-trip through JSON', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        npm.setDependencyFact('react', 'description', 'React lib');
        npm.setVersionFact('react', '18.2.0', 'size', 12345);

        const restored = RootFactStore.fromJSON(root.toJSON());
        const restoredNpm = restored.scoped('npm');

        expect(restoredNpm.getDependencyFact('react', 'description')).toBe('React lib');
        expect(restoredNpm.getVersionFact('react', '18.2.0', 'size')).toBe(12345);
    });

    it('backward compat: old format JSON deserializes into unscoped root', () => {
        // Old format without ecosystem nesting
        const oldData = {
            package: {
                react: { description: 'React' },
            },
            version: {
                react: { '18.2.0': { size: 12345 } },
            },
        };
        const store = RootFactStore.fromJSON(oldData);
        expect(store.getDependencyFact('react', 'description')).toBe('React');
        expect(store.getVersionFact('react', '18.2.0', 'size')).toBe(12345);
    });

    it('can re-scope from a scoped store', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        const other = npm.scoped('mise');

        other.setDependencyFact('node', 'desc', 'from mise');
        expect(other.getDependencyFact('node', 'desc')).toBe('from mise');
        expect(npm.getDependencyFact('node', 'desc')).toBeUndefined();
    });
});
