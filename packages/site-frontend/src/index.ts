import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type { BrowserColumnDef, GroupingSlug, DependicusData, RowData } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the browser JS entry point (for rolldown bundling). */
export const browserEntryPath = resolve(__dirname, 'main.mjs');

/** Absolute path to the CSS entry point (for rolldown bundling). */
export const cssEntryPath = resolve(__dirname, 'styles-entry.css');

/** Absolute path to the raw styles.css file. */
export const stylesCssPath = resolve(__dirname, 'styles.css');
