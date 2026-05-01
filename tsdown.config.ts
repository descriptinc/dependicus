import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';
import type { Plugin } from 'rolldown';

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
    entry: ['src/index.ts', 'src/bin.ts'],
    unbundle: true,
    inputOptions: {
        // Prevent tsdown from bundling node_modules dependencies (rolldown is
        // imported at runtime by site-frontend/browser-bundle.ts for dev builds)
        external: [/^[^./]/],
    },
    plugins: [inlineRawFiles()],
});
