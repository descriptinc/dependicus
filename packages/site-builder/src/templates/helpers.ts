import { formatDate, formatAgeHuman, getVersionsBehind } from '@dependicus/core';

/**
 * Custom Handlebars helpers for template rendering.
 */
export const helpers = {
    /**
     * Format ISO date string to human-readable format
     */
    formatDate: (dateStr: string): string => {
        if (!dateStr) {
            throw new Error('formatDate: date string is required');
        }
        return formatDate(dateStr) ?? '';
    },

    /**
     * Format date as relative age (e.g., "2 months ago")
     */
    formatAgeHuman: (dateStr: string): string => {
        if (!dateStr) {
            throw new Error('formatAgeHuman: date string is required');
        }
        return formatAgeHuman(dateStr) ?? '';
    },

    /**
     * Get number of versions behind (returns string like "5 versions behind")
     */
    getVersionsBehind: (currentVersion: string, latestVersion: string): string => {
        if (!currentVersion || !latestVersion) {
            throw new Error('getVersionsBehind: both versions are required');
        }
        return getVersionsBehind(currentVersion, latestVersion);
    },

    /**
     * Equality comparison
     */
    eq: (a: unknown, b: unknown): boolean => a === b,

    /**
     * Inequality comparison
     */
    ne: (a: unknown, b: unknown): boolean => a !== b,

    /**
     * Logical NOT
     */
    not: (value: unknown): boolean => !value,

    /**
     * Get array length
     */
    length: (arr: unknown): number => {
        if (!Array.isArray(arr)) {
            throw new Error(`length helper expects array, got ${typeof arr}`);
        }
        return arr.length;
    },

    /**
     * Join array with separator
     */
    join: (arr: unknown, separator: string): string => {
        if (!Array.isArray(arr)) {
            throw new Error(`join helper expects array, got ${typeof arr}`);
        }
        return arr.join(separator);
    },
};
