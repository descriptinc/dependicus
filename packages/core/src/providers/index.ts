export type { DependencyProvider, SourceContext } from './DependencyProvider';
export { PnpmProvider } from './PnpmProvider';
export { BunProvider } from './BunProvider';
export { YarnProvider } from './YarnProvider';
export { MiseProvider } from './MiseProvider';

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CacheService } from '../services/CacheService';
import type { DependencyProvider } from './DependencyProvider';
import { PnpmProvider } from './PnpmProvider';
import { BunProvider } from './BunProvider';
import { YarnProvider } from './YarnProvider';
import { MiseProvider } from './MiseProvider';

/**
 * Detect the active package manager from the runtime environment.
 * - Bun sets `process.versions.bun`
 * - pnpm sets `npm_config_user_agent` starting with "pnpm/"
 * - yarn sets `npm_config_user_agent` starting with "yarn/"
 */
export function detectRuntime(): 'bun' | 'pnpm' | 'yarn' | undefined {
    if (process.versions.bun) {
        return 'bun';
    }
    if (process.env.npm_config_user_agent?.startsWith('pnpm/')) {
        return 'pnpm';
    }
    if (process.env.npm_config_user_agent?.startsWith('yarn/')) {
        return 'yarn';
    }
    return undefined;
}

/**
 * Auto-detect providers. Prefers runtime detection (which PM launched us),
 * falling back to lockfile presence when the runtime is ambiguous.
 */
export function detectProviders(cacheService: CacheService, rootDir: string): DependencyProvider[] {
    const runtime = detectRuntime();
    if (runtime) {
        return createProvidersByName([runtime], cacheService, rootDir);
    }

    // Fallback: check lockfiles
    const providers: DependencyProvider[] = [];
    if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) {
        providers.push(new PnpmProvider(cacheService, rootDir));
    }
    if (existsSync(join(rootDir, 'bun.lock'))) {
        providers.push(new BunProvider(cacheService, rootDir));
    }
    if (existsSync(join(rootDir, 'yarn.lock'))) {
        providers.push(new YarnProvider(cacheService, rootDir));
    }
    if (existsSync(join(rootDir, 'mise.toml'))) {
        providers.push(new MiseProvider(cacheService, rootDir));
    }
    if (providers.length === 0) {
        throw new Error(
            'No supported lockfile found. Expected pnpm-lock.yaml, bun.lock, yarn.lock, or mise.toml in ' +
                rootDir,
        );
    }
    return providers;
}

/**
 * Create providers from explicit names.
 */
export function createProvidersByName(
    names: string[],
    cacheService: CacheService,
    rootDir: string,
): DependencyProvider[] {
    const providers: DependencyProvider[] = [];
    for (const name of names) {
        switch (name) {
            case 'pnpm':
                providers.push(new PnpmProvider(cacheService, rootDir));
                break;
            case 'bun':
                providers.push(new BunProvider(cacheService, rootDir));
                break;
            case 'yarn':
                providers.push(new YarnProvider(cacheService, rootDir));
                break;
            case 'mise':
                providers.push(new MiseProvider(cacheService, rootDir));
                break;
            default:
                throw new Error(`Unknown provider: ${name}. Supported: pnpm, bun, yarn, mise`);
        }
    }
    return providers;
}
