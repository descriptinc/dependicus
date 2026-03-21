import { rolldown } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached: string | undefined;

export default async function getCssBundle(): Promise<string> {
    if (cached !== undefined) return cached;
    const bundle = await rolldown({
        input: resolve(__dirname, 'styles-entry.css'),
    });
    const { output } = await bundle.generate({});
    const cssAsset = output.find((o) => o.type === 'asset' && o.fileName.endsWith('.css'));
    if (!cssAsset || cssAsset.type !== 'asset') {
        throw new Error('rolldown failed to produce CSS bundle');
    }
    cached = String(cssAsset.source);
    return cached;
}
