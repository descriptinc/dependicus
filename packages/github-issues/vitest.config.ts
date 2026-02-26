import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: '@dependicus/github-issues',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
