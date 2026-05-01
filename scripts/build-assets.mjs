import { rolldown } from 'rolldown';
import { writeFileSync } from 'node:fs';

// Bundle browser JS (main.ts + tabulator-tables + site-frontend code) into an
// IIFE string. This runs at build time; browser-bundle.ts imports the output.
const jsBuild = await rolldown({
    input: 'src/site-frontend/main.ts',
    platform: 'browser',
});
const { output: jsOutput } = await jsBuild.generate({ format: 'iife' });
if (jsOutput.length === 0 || !jsOutput[0]) {
    throw new Error('rolldown failed to produce browser bundle');
}

writeFileSync('src/site-frontend/browser-bundle.asset.js', jsOutput[0].code);
