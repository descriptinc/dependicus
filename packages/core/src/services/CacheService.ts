import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeCacheKey } from '../utils/formatters';

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
     * Check if cached data is valid (exists and matches current hash of the invalidation file).
     * @param key - Cache key (e.g., 'pnpm-list')
     * @param invalidationFile - File path whose hash determines cache validity (e.g., lockfile path)
     */
    async isCacheValid(key: string, invalidationFile: string): Promise<boolean> {
        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        const hashPath = join(this.cacheDir, this.cacheHashName(key));

        if (!existsSync(dataPath) || !existsSync(hashPath)) {
            return false;
        }

        const currentHash = await this.getFileHash(invalidationFile);
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
     * Write data to cache along with hash of the invalidation file.
     * @param key - Cache key
     * @param data - Data to cache
     * @param invalidationFile - File path whose hash determines cache validity
     */
    async writeCache(key: string, data: string, invalidationFile: string): Promise<void> {
        // Ensure cache directory exists
        if (!existsSync(this.cacheDir)) {
            await mkdir(this.cacheDir, { recursive: true });
        }

        const dataPath = join(this.cacheDir, this.cacheFileName(key));
        const hashPath = join(this.cacheDir, this.cacheHashName(key));
        const currentHash = await this.getFileHash(invalidationFile);

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
