import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let cached: string | undefined;

export default async function getCssBundle(): Promise<string> {
    if (cached !== undefined) return cached;
    cached = [
        readFileSync(require.resolve('open-props/open-props.min.css'), 'utf-8'),
        readFileSync(require.resolve('open-props/normalize.min.css'), 'utf-8'),
        readFileSync(require.resolve('tabulator-tables/dist/css/tabulator.min.css'), 'utf-8'),
        readFileSync(resolve(__dirname, 'styles.css'), 'utf-8'),
    ].join('\n');
    return cached;
}
