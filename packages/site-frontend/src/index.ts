import { resolve } from 'node:path';

export type { BrowserColumnDef, GroupingSlug, DependicusData, RowData } from './types';

/** Absolute path to the browser JS entry point (for esbuild bundling). */
export const browserEntryPath = resolve(__dirname, 'main.ts');

/** Absolute path to the CSS entry point (for esbuild bundling). */
export const cssEntryPath = resolve(__dirname, 'styles-entry.css');

/** Absolute path to the raw styles.css file. */
export const stylesCssPath = resolve(__dirname, 'styles.css');
