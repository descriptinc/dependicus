import { defineConfig } from 'vitest/config';

export default defineConfig({
    ssr: { resolve: { conditions: ['source'] } },
    test: {
        name: '@dependicus/providers-node',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
