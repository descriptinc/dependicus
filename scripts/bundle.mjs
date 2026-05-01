import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

// Ensure dist exists
mkdirSync('dist', { recursive: true });

// Clean previous bundled output (top-level .mjs files only — preserve
// .d.mts declarations produced by the tsdown build step)
for (const f of readdirSync('dist')) {
    if (/\.(mjs|js)$/.test(f)) {
        rmSync(join('dist', f));
    }
}

// Build pre-bundled browser + CSS assets
run('node', ['scripts/build-assets.mjs']);

// Bundle JS (rolldown replaces individual .mjs with bundled versions)
run('rolldown', ['-c', 'rolldown.config.ts']);

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
