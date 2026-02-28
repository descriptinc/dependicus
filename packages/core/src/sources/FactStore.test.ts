import { describe, it, expect } from 'vitest';
import { RootFactStore, FactKeys } from './FactStore';

describe('RootFactStore', () => {
    describe('package-level facts', () => {
        it('round-trips a value', () => {
            const store = new RootFactStore();
            store.setPackageFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
        });

        it('returns undefined for missing keys', () => {
            const store = new RootFactStore();
            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toBeUndefined();
        });

        it('overwrites existing values', () => {
            const store = new RootFactStore();
            store.setPackageFact('react', 'customMeta', 'first');
            store.setPackageFact('react', 'customMeta', 'second');
            expect(store.getPackageFact('react', 'customMeta')).toBe('second');
        });

        it('isolates facts by package name', () => {
            const store = new RootFactStore();
            store.setPackageFact('react', 'customMeta', 'react-meta');
            store.setPackageFact('vue', 'customMeta', 'vue-meta');
            expect(store.getPackageFact('react', 'customMeta')).toBe('react-meta');
            expect(store.getPackageFact('vue', 'customMeta')).toBe('vue-meta');
        });

        it('isolates facts by key', () => {
            const store = new RootFactStore();
            store.setPackageFact('react', FactKeys.GITHUB_DATA, 'gh');
            store.setPackageFact('react', FactKeys.SIZE_MAP, 'sizes');
            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toBe('gh');
            expect(store.getPackageFact('react', FactKeys.SIZE_MAP)).toBe('sizes');
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
            store.setPackageFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            store.setPackageFact('react', FactKeys.SIZE_MAP, { '18.2.0': 50000 });
            store.setPackageFact('vue', 'customMeta', 'vue-meta');

            const json = store.toJSON();

            expect(json.package).toEqual({
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
            expect(json).toEqual({ package: {}, version: {} });
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

            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toEqual({
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
            original.setPackageFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            original.setPackageFact('react', FactKeys.SIZE_MAP, { '18.2.0': 50000 });
            original.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            original.setVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED, false);
            original.setVersionFact('vue', '3.0.0', FactKeys.DESCRIPTION, 'Vue 3');

            const restored = RootFactStore.fromJSON(original.toJSON());

            expect(restored.getPackageFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
            expect(restored.getPackageFact('react', FactKeys.SIZE_MAP)).toEqual({
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
            store.setPackageFact('react', FactKeys.DESCRIPTION, 'package-level');
            store.setVersionFact('react', '18.2.0', FactKeys.DESCRIPTION, 'version-level');
            expect(store.getPackageFact('react', FactKeys.DESCRIPTION)).toBe('package-level');
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

        npm.setPackageFact('node', 'description', 'npm node');
        mise.setPackageFact('node', 'description', 'mise node');

        expect(npm.getPackageFact('node', 'description')).toBe('npm node');
        expect(mise.getPackageFact('node', 'description')).toBe('mise node');
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
        npm.setPackageFact('react', 'description', 'React lib');
        npm.setVersionFact('react', '18.2.0', 'size', 12345);

        const json = root.toJSON();

        expect(json.package).toEqual({
            npm: { react: { description: 'React lib' } },
        });
        expect(json.version).toEqual({
            npm: { react: { '18.2.0': { size: 12345 } } },
        });
    });

    it('scoped facts round-trip through JSON', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        npm.setPackageFact('react', 'description', 'React lib');
        npm.setVersionFact('react', '18.2.0', 'size', 12345);

        const restored = RootFactStore.fromJSON(root.toJSON());
        const restoredNpm = restored.scoped('npm');

        expect(restoredNpm.getPackageFact('react', 'description')).toBe('React lib');
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
        expect(store.getPackageFact('react', 'description')).toBe('React');
        expect(store.getVersionFact('react', '18.2.0', 'size')).toBe(12345);
    });

    it('can re-scope from a scoped store', () => {
        const root = new RootFactStore();
        const npm = root.scoped('npm');
        const other = npm.scoped('mise');

        other.setPackageFact('node', 'desc', 'from mise');
        expect(other.getPackageFact('node', 'desc')).toBe('from mise');
        expect(npm.getPackageFact('node', 'desc')).toBeUndefined();
    });
});
