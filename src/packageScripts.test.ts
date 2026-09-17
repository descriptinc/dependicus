import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
) as { scripts: Record<string, string> };

// Installing dependicus from a git URL builds `dist/` from the clone, because
// the published `dist/` only exists in registry tarballs. Package managers
// disagree about which lifecycle script does that build: npm, pnpm and bun run
// `prepare`, yarn runs `prepack`. Both have to do the same thing as `build` or
// a git install ships something different from a release.
const BUILD_SCRIPTS = ['prepare', 'prepack'] as const;

describe('package.json scripts', () => {
    for (const script of BUILD_SCRIPTS) {
        it(`keeps ${script} in step with build`, () => {
            expect(packageJson.scripts[script]).toBe(packageJson.scripts.build);
        });

        // These run under whichever package manager the installing project
        // uses, and yarn runs them in a bootstrap environment that has only
        // yarn on PATH, so they can't name a package manager.
        it(`names no package manager in ${script}`, () => {
            expect(packageJson.scripts[script]).not.toMatch(/\b(pnpm|npm|yarn|bun|aube)\b/);
        });
    }
});
