import { defineConfig } from 'tsdown';

export default defineConfig({
    unbundle: true,
    external: [/^@dependicus\//],
    // @pandatix/js-cvss uses ESM syntax without "type": "module" in its
    // package.json, which breaks Node ESM resolution at runtime. Force it
    // to be inlined so the broken bare-specifier imports don't survive.
    noExternal: ['@pandatix/js-cvss'],
});
