import { rolldown } from 'rolldown';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

mkdirSync('dist', { recursive: true });

// Bundle browser JS into an IIFE
const jsBuild = await rolldown({
    input: 'src/site-frontend/main.ts',
    platform: 'browser',
});
const { output: jsOutput } = await jsBuild.generate({ format: 'iife' });
if (jsOutput.length === 0 || !jsOutput[0]) {
    throw new Error('rolldown failed to produce browser bundle');
}
const iifeCode = jsOutput[0].code;

writeFileSync(
    'dist/browser-bundle.mjs',
    `export default async function getBrowserBundle() {\n    return ${JSON.stringify(iifeCode)};\n}\n`,
);

// Bundle CSS by concatenating source files directly
const require = createRequire(import.meta.url);
const cssContent = [
    readFileSync(require.resolve('open-props/open-props.min.css'), 'utf-8'),
    readFileSync(require.resolve('open-props/normalize.min.css'), 'utf-8'),
    readFileSync(require.resolve('tabulator-tables/dist/css/tabulator.min.css'), 'utf-8'),
    readFileSync('src/site-frontend/styles.css', 'utf-8'),
].join('\n');

writeFileSync(
    'dist/css-bundle.mjs',
    `export default async function getCssBundle() {\n    return ${JSON.stringify(cssContent)};\n}\n`,
);
