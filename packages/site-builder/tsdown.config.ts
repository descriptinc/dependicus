import { defineConfig } from 'tsdown';

export default defineConfig({
    unbundle: true,
    copy: ['src/templates'],
});
