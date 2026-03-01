/**
 * Custom Handlebars helpers for issue description templates.
 *
 * Note: helpers that share a name with a template context property would shadow
 * the property (Handlebars resolves helpers first). Values like `detailUrl` are
 * pre-computed in the TypeScript data prep and passed as context, so they are
 * intentionally NOT registered as helpers.
 */
export const helpers = {
    /** Format ISO date string as YYYY-MM-DD. Returns empty string for missing or invalid dates. */
    formatDateShort: (dateStr: string): string => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().slice(0, 10);
    },

    /** Equality comparison. */
    eq: (a: unknown, b: unknown): boolean => a === b,

    /** Inequality comparison. */
    ne: (a: unknown, b: unknown): boolean => a !== b,

    /** Greater-than comparison. */
    gt: (a: number, b: number): boolean => a > b,

    /** Logical NOT. */
    not: (value: unknown): boolean => !value,

    /** Join array elements with a separator. */
    join: (arr: unknown[], separator: string): string => {
        if (!Array.isArray(arr)) return '';
        return arr.join(separator);
    },

    /** Slice an array (start inclusive, end exclusive). */
    slice: (arr: unknown[], start: number, end: number): unknown[] => {
        if (!Array.isArray(arr)) return [];
        return arr.slice(start, end);
    },
};
