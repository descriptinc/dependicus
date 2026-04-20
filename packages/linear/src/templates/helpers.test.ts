import { describe, it, expect } from 'vitest';
import { helpers } from './helpers';

describe('helpers', () => {
    describe('formatDateShort', () => {
        it('formats a valid ISO date string', () => {
            expect(helpers.formatDateShort('2024-03-15T10:30:00.000Z')).toBe('2024-03-15');
        });

        it('formats a date-only string', () => {
            expect(helpers.formatDateShort('2024-03-15')).toBe('2024-03-15');
        });

        it('returns empty string for undefined', () => {
            expect(helpers.formatDateShort(undefined as unknown as string)).toBe('');
        });

        it('returns empty string for empty string', () => {
            expect(helpers.formatDateShort('')).toBe('');
        });

        it('returns empty string for invalid date', () => {
            expect(helpers.formatDateShort('not-a-date')).toBe('');
        });

        it('returns empty string for null', () => {
            expect(helpers.formatDateShort(null as unknown as string)).toBe('');
        });
    });

    describe('eq', () => {
        it('returns true for equal values', () => {
            expect(helpers.eq(1, 1)).toBe(true);
            expect(helpers.eq('a', 'a')).toBe(true);
        });

        it('returns false for unequal values', () => {
            expect(helpers.eq(1, 2)).toBe(false);
            expect(helpers.eq(1, '1')).toBe(false);
        });
    });

    describe('join', () => {
        it('joins array elements', () => {
            expect(helpers.join(['a', 'b', 'c'], ', ')).toBe('a, b, c');
        });

        it('returns empty string for non-array', () => {
            expect(helpers.join('not-array' as unknown as unknown[], ', ')).toBe('');
        });
    });

    describe('slice', () => {
        it('slices an array', () => {
            expect(helpers.slice([1, 2, 3, 4], 1, 3)).toEqual([2, 3]);
        });

        it('returns empty array for non-array', () => {
            expect(helpers.slice('not-array' as unknown as unknown[], 0, 1)).toEqual([]);
        });
    });

    describe('yamlKey', () => {
        it('quotes scoped package names containing a slash', () => {
            expect(helpers.yamlKey('@scope/pkg')).toBe("'@scope/pkg'");
        });

        it('quotes any name containing a slash', () => {
            expect(helpers.yamlKey('foo/bar')).toBe("'foo/bar'");
        });

        it('leaves unscoped names unquoted', () => {
            expect(helpers.yamlKey('lodash')).toBe('lodash');
        });

        it('returns empty string as-is', () => {
            expect(helpers.yamlKey('')).toBe('');
        });

        it('passes through non-string values unchanged', () => {
            expect(helpers.yamlKey(undefined as unknown as string)).toBe(undefined);
            expect(helpers.yamlKey(null as unknown as string)).toBe(null);
        });
    });
});
