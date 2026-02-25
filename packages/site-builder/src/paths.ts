import { rolldown } from 'rolldown';
import { stylesCssPath, cssEntryPath } from '@dependicus/site-frontend';

/**
 * Returns the absolute path to the styles.css file bundled with this package.
 * Callers should copy this file to their output directory so that detail and
 * grouping pages can reference it via <link rel="stylesheet">.
 */
export function getStylesCssPath(): string {
    return stylesCssPath;
}

let cachedCss: string | undefined;

/**
 * Bundle the CSS entry point (open-props + styles.css) into a single string.
 * The result is cached so repeated calls don't re-run rolldown.
 */
export async function getCssContent(): Promise<string> {
    if (cachedCss !== undefined) {
        return cachedCss;
    }

    const bundle = await rolldown({
        input: cssEntryPath,
    });

    const { output } = await bundle.generate({});

    const cssAsset = output.find((o) => o.type === 'asset' && o.fileName.endsWith('.css'));
    if (!cssAsset || cssAsset.type !== 'asset') {
        throw new Error('rolldown failed to produce CSS output');
    }

    cachedCss = String(cssAsset.source);
    return cachedCss;
}
