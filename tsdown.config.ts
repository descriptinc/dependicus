import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';
import type { Plugin } from 'rolldown';

function inlineRawFiles(): Plugin {
    return {
        name: 'inline-raw-files',
        resolveId(source, importer) {
            // Redirect .css imports to a virtual .cssraw ID so rolldown's
            // native CSS handling doesn't extract them into separate files.
            if (source.endsWith('.css') && importer) {
                const resolved = new URL(source, 'file://' + importer).pathname;
                return { id: resolved + '.cssraw' };
            }
        },
        load(id) {
            const rawPath = id.endsWith('.cssraw') ? id.slice(0, -'.cssraw'.length) : null;
            if (rawPath || id.endsWith('.hbs') || id.endsWith('.asset.js')) {
                const content = readFileSync(rawPath ?? id, 'utf-8');
                return `export default ${JSON.stringify(content)};`;
            }
        },
    };
}

export default defineConfig({
    entry: ['src/index.ts', 'src/bin.ts'],
    unbundle: true,
    inputOptions: {
        // Prevent tsdown from bundling node_modules dependencies
        external: [/^[^./]/],
    },
    plugins: [inlineRawFiles()],
});
