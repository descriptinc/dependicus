import { rolldown } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached: string | undefined;

export default async function getBrowserBundle(): Promise<string> {
    if (cached !== undefined) return cached;
    const bundle = await rolldown({
        input: resolve(__dirname, 'main.ts'),
        platform: 'browser',
    });
    const { output } = await bundle.generate({ format: 'iife' });
    if (output.length === 0 || !output[0]) {
        throw new Error('rolldown failed to produce browser bundle');
    }
    cached = output[0].code;
    return cached;
}
