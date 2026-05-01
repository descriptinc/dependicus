import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import styles from './styles.css';

const require = createRequire(import.meta.url);

let cached: string | undefined;

export default async function getCssBundle(): Promise<string> {
    if (cached !== undefined) return cached;
    cached = [
        readFileSync(require.resolve('open-props/open-props.min.css'), 'utf-8'),
        readFileSync(require.resolve('open-props/normalize.min.css'), 'utf-8'),
        readFileSync(require.resolve('tabulator-tables/dist/css/tabulator.min.css'), 'utf-8'),
        styles,
    ].join('\n');
    return cached;
}
