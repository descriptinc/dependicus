import { defineConfig } from 'rolldown';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'rolldown';

const configDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve `@dependicus/*` workspace imports to their TypeScript source rather
 * than the built dist/ output. Sub-path imports for pre-bundled assets
 * (browser-bundle, css-bundle) resolve to their pre-built dist/ versions.
 */
function resolveWorkspaceSource(): Plugin {
    return {
        name: 'resolve-workspace-source',
        resolveId(source) {
            if (source === '@dependicus/site-frontend/browser-bundle') {
                return resolve(configDir, '../site-frontend/dist/browser-bundle.mjs');
            }
            if (source === '@dependicus/site-frontend/css-bundle') {
                return resolve(configDir, '../site-frontend/dist/css-bundle.mjs');
            }
            if (source.startsWith('@dependicus/')) {
                const pkg = source.slice('@dependicus/'.length);
                return resolve(configDir, '..', pkg, 'src/index.ts');
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
    external: (id) =>
        !id.startsWith('.') &&
        !id.startsWith('/') &&
        !id.startsWith('\0') &&
        !id.startsWith('@dependicus/'),
    plugins: [resolveWorkspaceSource(), inlineRawFiles()],
});
