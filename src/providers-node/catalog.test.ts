import { describe, it, expect } from 'vitest';
import { collectCatalogRanges, satisfiesAnyCatalogRange } from './catalog';

describe('collectCatalogRanges', () => {
    it('collects the default catalog', () => {
        const ranges = collectCatalogRanges({ react: '^18.2.0', typescript: '~5.3.0' }, undefined);

        expect(ranges.get('react')).toEqual(['^18.2.0']);
        expect(ranges.get('typescript')).toEqual(['~5.3.0']);
    });

    it('collects named catalogs', () => {
        const ranges = collectCatalogRanges(undefined, {
            react17: { react: '^17.0.0' },
            legacy: { next: '^12.0.0' },
        });

        expect(ranges.get('react')).toEqual(['^17.0.0']);
        expect(ranges.get('next')).toEqual(['^12.0.0']);
    });

    it('keeps every range for a package that is in more than one catalog', () => {
        const ranges = collectCatalogRanges(
            { react: '^18.2.0' },
            { react17: { react: '^17.0.0' }, react18: { react: '^18.2.0' } },
        );

        expect(ranges.get('react')).toEqual(['^18.2.0', '^17.0.0']);
    });

    it('returns an empty map when there are no catalogs', () => {
        expect(collectCatalogRanges(undefined, undefined).size).toBe(0);
    });

    it('ignores malformed entries', () => {
        const ranges = collectCatalogRanges(
            { react: 5 } as unknown as Record<string, string>,
            { broken: 'nope' } as unknown as Record<string, Record<string, string>>,
        );

        expect(ranges.size).toBe(0);
    });
});

describe('satisfiesAnyCatalogRange', () => {
    it('matches a version against any of the ranges', () => {
        expect(satisfiesAnyCatalogRange(['^18.2.0', '^17.0.0'], '17.0.2')).toBe(true);
        expect(satisfiesAnyCatalogRange(['^18.2.0', '^17.0.0'], '18.3.1')).toBe(true);
        expect(satisfiesAnyCatalogRange(['^18.2.0', '^17.0.0'], '19.0.0')).toBe(false);
    });

    it('returns false with no ranges', () => {
        expect(satisfiesAnyCatalogRange(undefined, '1.0.0')).toBe(false);
        expect(satisfiesAnyCatalogRange([], '1.0.0')).toBe(false);
    });

    it('matches a non-semver range only exactly', () => {
        expect(satisfiesAnyCatalogRange(['workspace:*'], 'workspace:*')).toBe(true);
        expect(satisfiesAnyCatalogRange(['workspace:*'], '1.0.0')).toBe(false);
    });
});
