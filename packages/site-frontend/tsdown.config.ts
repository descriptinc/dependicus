import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts', 'src/main.ts'],
    unbundle: true,
    copy: ['src/styles-entry.css', 'src/styles.css'],
});
