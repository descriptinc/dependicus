import { defineConfig } from 'rolldown';
import { dirname } from 'node:path';
import type { Plugin } from 'rolldown';

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
                return code.replaceAll('__dirname', JSON.stringify(dirname(id)));
            },
        },
    };
}

export default defineConfig({
    input: 'src/bin.ts',
    output: { file: 'dist/bin.js', format: 'cjs', banner: '#!/usr/bin/env node' },
    platform: 'node',
    external: [/^rolldown/],
    plugins: [staticDirname()],
});
