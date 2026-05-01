import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

function inlineRawFiles(): Plugin {
    return {
        name: 'inline-raw-files',
        transform(_, id) {
            if (id.endsWith('.hbs') || id.endsWith('.css') || id.endsWith('.asset.js')) {
                return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
            }
        },
    };
}

export default defineConfig({
    plugins: [inlineRawFiles()],
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
