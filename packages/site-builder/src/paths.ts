import * as esbuild from 'esbuild';
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
 * The result is cached so repeated calls don't re-run esbuild.
 */
export function getCssContent(): string {
    if (cachedCss !== undefined) {
        return cachedCss;
    }

    const entryPoint = cssEntryPath;

    const result = esbuild.buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        minify: false,
    });

    if (!result.outputFiles || result.outputFiles.length === 0) {
        throw new Error('esbuild failed to produce CSS output');
    }

    const outputFile = result.outputFiles[0];
    if (!outputFile) {
        throw new Error('esbuild CSS output file is undefined');
    }

    cachedCss = outputFile.text;
    return cachedCss;
}
