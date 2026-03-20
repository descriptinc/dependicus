import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts', 'src/bin.ts'],
    unbundle: true,
    external: [/^@dependicus\//],
});
