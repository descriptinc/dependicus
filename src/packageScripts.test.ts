import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
) as { scripts: Record<string, string> };

describe('package.json scripts', () => {
    // `prepare` is what builds `dist/` when a project installs dependicus from
    // a git URL instead of the registry, where the published `dist/` isn't
    // there to use. It has to stay in step with `build` or git installs ship
    // something different from releases.
    it('keeps prepare in step with build', () => {
        expect(packageJson.scripts.prepare).toBe(packageJson.scripts.build);
    });

    // `prepare` runs under whichever package manager the installing project
    // uses, so it can't assume any particular one is on PATH.
    it('names no package manager in prepare', () => {
        expect(packageJson.scripts.prepare).not.toMatch(/\b(pnpm|npm|yarn|bun|aube)\b/);
    });
});
