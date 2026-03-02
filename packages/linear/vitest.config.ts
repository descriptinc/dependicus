import { defineProject } from 'vitest/config';

export default defineProject({
    test: {
        name: '@dependicus/linear',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
