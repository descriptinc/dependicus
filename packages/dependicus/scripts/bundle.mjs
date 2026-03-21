import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

// Clean previous output
for (const f of readdirSync('dist')) {
    if (/\.(mjs|js|d\.mts|d\.mts\.map)$/.test(f)) {
        rmSync(join('dist', f));
    }
}

// Bundle JS
run('rolldown', ['-c', 'rolldown.config.ts']);

// Generate .d.mts
run('dts-bundle-generator', [
    '-o',
    'dist/index.d.mts',
    'src/index.ts',
    '--project',
    'tsconfig.json',
    '--no-banner',
]);

// Validate: no absolute build-machine paths in output
const absolutePath = /\/Users\/\w+\/|\/home\/\w+\//;
let found = false;

for (const f of readdirSync('dist').filter((f) => f.endsWith('.mjs'))) {
    const lines = readFileSync(join('dist', f), 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
        const match = trimmed.match(absolutePath);
        if (match) {
            console.error(`Absolute path in dist/${f}:${i + 1}: ${match[0]}`);
            found = true;
        }
    }
}

if (found) process.exit(1);
