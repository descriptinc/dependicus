import { describe, it, expect } from 'vitest';
import { FactStore, FactKeys } from './FactStore';

describe('FactStore', () => {
    describe('package-level facts', () => {
        it('round-trips a value', () => {
            const store = new FactStore();
            store.setPackageFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
        });

        it('returns undefined for missing keys', () => {
            const store = new FactStore();
            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toBeUndefined();
        });

        it('overwrites existing values', () => {
            const store = new FactStore();
            store.setPackageFact('react', 'customMeta', 'first');
            store.setPackageFact('react', 'customMeta', 'second');
            expect(store.getPackageFact('react', 'customMeta')).toBe('second');
        });

        it('isolates facts by package name', () => {
            const store = new FactStore();
            store.setPackageFact('react', 'customMeta', 'react-meta');
            store.setPackageFact('vue', 'customMeta', 'vue-meta');
            expect(store.getPackageFact('react', 'customMeta')).toBe('react-meta');
            expect(store.getPackageFact('vue', 'customMeta')).toBe('vue-meta');
        });

        it('isolates facts by key', () => {
            const store = new FactStore();
            store.setPackageFact('react', FactKeys.GITHUB_DATA, 'gh');
            store.setPackageFact('react', FactKeys.SIZE_MAP, 'sizes');
            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toBe('gh');
            expect(store.getPackageFact('react', FactKeys.SIZE_MAP)).toBe('sizes');
        });
    });

    describe('version-level facts', () => {
        it('round-trips a value', () => {
            const store = new FactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            expect(store.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBe(12345);
        });

        it('returns undefined for missing keys', () => {
            const store = new FactStore();
            expect(store.getVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE)).toBeUndefined();
        });

        it('overwrites existing values', () => {
            const store = new FactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.DESCRIPTION, 'old');
            store.setVersionFact('react', '18.2.0', FactKeys.DESCRIPTION, 'new');
            expect(store.getVersionFact('react', '18.2.0', FactKeys.DESCRIPTION)).toBe('new');
        });

        it('isolates facts by version', () => {
            const store = new FactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.HOMEPAGE, 'v18');
            store.setVersionFact('react', '19.0.0', FactKeys.HOMEPAGE, 'v19');
            expect(store.getVersionFact('react', '18.2.0', FactKeys.HOMEPAGE)).toBe('v18');
            expect(store.getVersionFact('react', '19.0.0', FactKeys.HOMEPAGE)).toBe('v19');
        });
    });

    describe('toJSON', () => {
        it('serializes package facts into nested objects', () => {
            const store = new FactStore();
            store.setPackageFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            store.setPackageFact('react', FactKeys.SIZE_MAP, { '18.2.0': 50000 });
            store.setPackageFact('vue', 'customMeta', 'vue-meta');

            const json = store.toJSON();

            expect(json.package).toEqual({
                react: {
                    [FactKeys.GITHUB_DATA]: { owner: 'facebook' },
                    [FactKeys.SIZE_MAP]: { '18.2.0': 50000 },
                },
                vue: {
                    customMeta: 'vue-meta',
                },
            });
        });

        it('serializes version facts into nested objects', () => {
            const store = new FactStore();
            store.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            store.setVersionFact('react', '19.0.0', FactKeys.DESCRIPTION, 'React 19');
            store.setVersionFact('vue', '3.0.0', FactKeys.HOMEPAGE, 'https://vuejs.org');

            const json = store.toJSON();

            expect(json.version).toEqual({
                react: {
                    '18.2.0': { [FactKeys.UNPACKED_SIZE]: 12345 },
                    '19.0.0': { [FactKeys.DESCRIPTION]: 'React 19' },
                },
                vue: {
                    '3.0.0': { [FactKeys.HOMEPAGE]: 'https://vuejs.org' },
                },
            });
        });

        it('returns empty objects for empty store', () => {
            const store = new FactStore();
            const json = store.toJSON();
            expect(json).toEqual({ package: {}, version: {} });
        });
    });

    describe('fromJSON', () => {
        it('deserializes package facts', () => {
            const store = FactStore.fromJSON({
                package: {
                    react: { [FactKeys.GITHUB_DATA]: { owner: 'facebook' } },
                },
                version: {},
            });

            expect(store.getPackageFact('react', FactKeys.GITHUB_DATA)).toEqual({
                owner: 'facebook',
            });
        });

        it('deserializes version facts', () => {
            const store = FactStore.fromJSON({
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
            const original = new FactStore();
            original.setPackageFact('react', FactKeys.GITHUB_DATA, { owner: 'facebook' });
            original.setPackageFact('react', FactKeys.SIZE_MAP, { '18.2.0': 50000 });
            original.setVersionFact('react', '18.2.0', FactKeys.UNPACKED_SIZE, 12345);
            original.setVersionFact('react', '18.2.0', FactKeys.IS_DEPRECATED, false);
            original.setVersionFact('vue', '3.0.0', FactKeys.DESCRIPTION, 'Vue 3');

            const restored = FactStore.fromJSON(original.toJSON());

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
            const store = new FactStore();
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
