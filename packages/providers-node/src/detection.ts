import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DependencyProvider, CacheService } from '@dependicus/core';
import { PnpmProvider } from './providers/PnpmProvider';
import { BunProvider } from './providers/BunProvider';
import { YarnProvider } from './providers/YarnProvider';
import { NpmProvider } from './providers/NpmProvider';

/**
 * Detect the active package manager from the runtime environment.
 * - Bun sets `process.versions.bun`
 * - pnpm sets `npm_config_user_agent` starting with "pnpm/"
 * - yarn sets `npm_config_user_agent` starting with "yarn/"
 * - npm sets `npm_config_user_agent` starting with "npm/"
 */
export function detectNodeRuntime(): 'bun' | 'pnpm' | 'yarn' | 'npm' | undefined {
    if (process.versions.bun) {
        return 'bun';
    }
    if (process.env.npm_config_user_agent?.startsWith('pnpm/')) {
        return 'pnpm';
    }
    if (process.env.npm_config_user_agent?.startsWith('yarn/')) {
        return 'yarn';
    }
    if (process.env.npm_config_user_agent?.startsWith('npm/')) {
        return 'npm';
    }
    return undefined;
}

/**
 * Auto-detect node providers. Prefers runtime detection (which PM launched us),
 * falling back to lockfile presence when the runtime is ambiguous.
 */
export function detectNodeProviders(
    cacheService: CacheService,
    rootDir: string,
): DependencyProvider[] {
    const runtime = detectNodeRuntime();
    if (runtime) {
        return createNodeProvidersByName([runtime], cacheService, rootDir);
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
    if (existsSync(join(rootDir, 'package-lock.json'))) {
        providers.push(new NpmProvider(cacheService, rootDir));
    }
    return providers;
}

/**
 * Create node providers from explicit names.
 */
export function createNodeProvidersByName(
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
            case 'npm':
                providers.push(new NpmProvider(cacheService, rootDir));
                break;
            default:
                throw new Error(`Unknown node provider: ${name}. Supported: pnpm, bun, yarn, npm`);
        }
    }
    return providers;
}
