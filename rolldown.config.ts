import { defineConfig } from 'rolldown';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'rolldown';

const configDir = dirname(fileURLToPath(import.meta.url));

/**
 * During the production bundle, redirect imports of the site-frontend
 * browser-bundle and css-bundle modules to their pre-built dist/ versions
 * (produced by scripts/build-assets.mjs) instead of the dev-time versions
 * that invoke rolldown/readFileSync at runtime.
 */
function resolvePrebuiltAssets(): Plugin {
    return {
        name: 'resolve-prebuilt-assets',
        resolveId(source, importer) {
            if (!importer) return;
            const resolved = resolve(dirname(importer), source);
            if (resolved.endsWith('/site-frontend/browser-bundle')) {
                return resolve(configDir, 'dist/browser-bundle.mjs');
            }
            if (resolved.endsWith('/site-frontend/css-bundle')) {
                return resolve(configDir, 'dist/css-bundle.mjs');
            }
        },
    };
}

/**
 * Import `.hbs` and `.css` files as raw string modules so that templates and
 * stylesheets are embedded in the bundle instead of read from disk at runtime.
 */
function inlineRawFiles(): Plugin {
    return {
        name: 'inline-raw-files',
        load(id) {
            if (id.endsWith('.hbs') || id.endsWith('.css')) {
                const content = readFileSync(id, 'utf-8');
                return `export default ${JSON.stringify(content)};`;
            }
        },
    };
}

export default defineConfig({
    input: { bin: 'src/bin.ts', index: 'src/index.ts' },
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name].mjs',
    },
    platform: 'node',
    resolve: { conditionNames: ['import', 'node', 'default'] },
    external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    plugins: [resolvePrebuiltAssets(), inlineRawFiles()],
});
