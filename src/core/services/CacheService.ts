import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeCacheKey } from '../utils/formatters';

/** One file, or several, whose contents decide whether a cache entry is still good. */
export type InvalidationInput = string | readonly string[];

/** Context passed to plugins during initialization. */
export interface PluginContext {
    cacheService: CacheService;
}

export class CacheService {
    private readonly cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    private cacheFileName(key: string): string {
        return `${sanitizeCacheKey(key)}.json`;
    }

    private cacheHashName(key: string): string {
        return `${sanitizeCacheKey(key)}.hash`;
    }

    /**
     * Get the SHA256 hash of a file's content.
     */
    private async getFileHash(filePath: string): Promise<string> {
        const content = await readFile(filePath, 'utf-8');
        return createHash('sha256').update(content).digest('hex');
    }

    /**
     * Hash every invalidation input into one value.
     *
     * A single path hashes to that file's content hash, unchanged, so caches
     * written by earlier versions stay valid. A list combines each path with its
     * content, and a file that doesn't exist contributes a marker rather than
     * throwing, because absence is a meaningful state for some inputs (there is
     * no node_modules before the first install).
     */
    private async getInvalidationHash(invalidation: InvalidationInput): Promise<string> {
        if (typeof invalidation === 'string') {
            return await this.getFileHash(invalidation);
        }

        const combined = createHash('sha256');
        for (const filePath of invalidation) {
            const fileHash = existsSync(filePath) ? await this.getFileHash(filePath) : 'absent';
            combined.update(`${filePath}\u0000${fileHash}\u0000`);
        }
        return combined.digest('hex');
    }

    /**
     * Check if cached data is valid (exists and matches the current hash of the invalidation inputs).
     * @param key - Cache key (e.g., 'pnpm-list')
     * @param invalidation - Path, or paths, whose contents determine cache validity (e.g., a lockfile)
     */
    async isCacheValid(key: string, invalidation: InvalidationInput): Promise<boolean> {
        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        const hashPath = join(this.cacheDir, this.cacheHashName(key));

        if (!existsSync(dataPath) || !existsSync(hashPath)) {
            return false;
        }

        const currentHash = await this.getInvalidationHash(invalidation);
        const cachedHash = (await readFile(hashPath, 'utf-8')).trim();

        return currentHash === cachedHash;
    }

    /**
     * Read cached data for a given key.
     * @param key - Cache key
     */
    async readCache(key: string): Promise<string> {
        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        return await readFile(dataPath, 'utf-8');
    }

    /**
     * Write data to cache along with the hash of the invalidation inputs.
     * @param key - Cache key
     * @param data - Data to cache
     * @param invalidation - Path, or paths, whose contents determine cache validity
     */
    async writeCache(key: string, data: string, invalidation: InvalidationInput): Promise<void> {
        // Ensure cache directory exists
        if (!existsSync(this.cacheDir)) {
            await mkdir(this.cacheDir, { recursive: true });
        }

        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        const hashPath = join(this.cacheDir, this.cacheHashName(key));
        const currentHash = await this.getInvalidationHash(invalidation);

        await writeFile(dataPath, data, 'utf-8');
        await writeFile(hashPath, currentHash, 'utf-8');
    }

    /**
     * Write data to cache without invalidation file (cache permanently).
     * @param key - Cache key
     * @param data - Data to cache
     */
    async writePermanentCache(key: string, data: string): Promise<void> {
        // Ensure cache directory exists
        if (!existsSync(this.cacheDir)) {
            await mkdir(this.cacheDir, { recursive: true });
        }

        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        await writeFile(dataPath, data, 'utf-8');
    }

    /**
     * Check if permanent cache exists.
     * @param key - Cache key
     */
    hasPermanentCache(key: string): boolean {
        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        return existsSync(dataPath);
    }

    /**
     * Read permanent cache if it exists.
     * @param key - Cache key
     */
    async readPermanentCache(key: string): Promise<string | undefined> {
        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        if (!existsSync(dataPath)) {
            return undefined;
        }
        return await readFile(dataPath, 'utf-8');
    }
}
