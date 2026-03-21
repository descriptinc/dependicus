import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

function rawHbs(): Plugin {
    return {
        name: 'raw-hbs',
        transform(_, id) {
            if (id.endsWith('.hbs')) {
                return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
            }
        },
    };
}

export default defineConfig({
    plugins: [rawHbs()],
    ssr: { resolve: { conditions: ['source'] } },
    test: {
        name: 'dependicus',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
