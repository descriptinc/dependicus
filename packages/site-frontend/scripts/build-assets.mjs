import { rolldown } from 'rolldown';
import { writeFileSync } from 'node:fs';

// Bundle browser JS into an IIFE
const jsBuild = await rolldown({
    input: 'src/main.ts',
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

// Bundle CSS (open-props + tabulator + styles.css)
const cssBuild = await rolldown({
    input: 'src/styles-entry.css',
});
const { output: cssOutput } = await cssBuild.generate({});
const cssAsset = cssOutput.find((o) => o.type === 'asset' && o.fileName.endsWith('.css'));
if (!cssAsset || cssAsset.type !== 'asset') {
    throw new Error('rolldown failed to produce CSS bundle');
}
const cssContent = String(cssAsset.source);

writeFileSync(
    'dist/css-bundle.mjs',
    `export default async function getCssBundle() {\n    return ${JSON.stringify(cssContent)};\n}\n`,
);
