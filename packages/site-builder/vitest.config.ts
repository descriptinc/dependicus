import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: '@dependicus/site-builder',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
