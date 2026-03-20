import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type {
    BrowserColumnDef,
    GroupingSlug,
    DependicusData,
    ProviderInfo,
    RowData,
} from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveAsset(name: string, ext: string): string {
    const tsPath = resolve(__dirname, `${name}.ts`);
    return existsSync(tsPath) ? tsPath : resolve(__dirname, `${name}.${ext}`);
}

/** Absolute path to the browser JS entry point (for rolldown bundling). */
export const browserEntryPath = resolveAsset('main', 'mjs');

/** Absolute path to the CSS entry point (for rolldown bundling). */
export const cssEntryPath = resolve(__dirname, 'styles-entry.css');

/** Absolute path to the raw styles.css file. */
export const stylesCssPath = resolve(__dirname, 'styles.css');
