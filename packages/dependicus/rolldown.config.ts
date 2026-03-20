import { defineConfig } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'rolldown';

const configDir = dirname(fileURLToPath(import.meta.url));

/**
 * Replace `__dirname` with the actual source directory of each module at build
 * time, so that bundled code still resolves template files and asset paths
 * relative to the original workspace package layout.
 *
 * Rolldown polyfills `__dirname` to the *output* path rather than the source
 * path, and has no per-module resolution hook (resolveImportMeta is explicitly
 * unsupported).  A transform-time string replacement is the standard workaround
 * — the `rolldown-require` npm package does the same thing.
 */
function staticDirname(): Plugin {
    return {
        name: 'static-dirname',
        transform: {
            filter: { code: { include: ['__dirname'] } },
            handler(code, id) {
                // Strip the ESM polyfill declaration, then replace remaining usage
                const stripped = code.replace(
                    /const __dirname\s*=\s*dirname\(fileURLToPath\(import\.meta\.url\)\);?\n?/g,
                    '',
                );
                return stripped.replaceAll('__dirname', JSON.stringify(dirname(id)));
            },
        },
    };
}

/**
 * Resolve `@dependicus/*` workspace imports to their TypeScript source rather
 * than the built dist/ output.  This avoids conflicts with the staticDirname
 * plugin (which would corrupt the __dirname polyfill in built files) and
 * produces a cleaner bundle from source.
 */
function resolveWorkspaceSource(): Plugin {
    return {
        name: 'resolve-workspace-source',
        resolveId(source) {
            if (source.startsWith('@dependicus/')) {
                const pkg = source.slice('@dependicus/'.length);
                return resolve(configDir, '..', pkg, 'src/index.ts');
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
    plugins: [resolveWorkspaceSource(), staticDirname()],
});
