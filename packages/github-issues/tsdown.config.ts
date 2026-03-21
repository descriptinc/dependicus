import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';
import type { Plugin } from 'rolldown';

function rawHbs(): Plugin {
    return {
        name: 'raw-hbs',
        load(id) {
            if (id.endsWith('.hbs')) {
                return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
            }
        },
    };
}

export default defineConfig({
    unbundle: true,
    plugins: [rawHbs()],
});
