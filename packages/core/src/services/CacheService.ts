import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class CacheService {
    private readonly cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
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
        const dataPath = join(this.cacheDir, `${key}.json`);
        const hashPath = join(this.cacheDir, `${key}.hash`);

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
        const dataPath = join(this.cacheDir, `${key}.json`);
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

        const dataPath = join(this.cacheDir, `${key}.json`);
        const hashPath = join(this.cacheDir, `${key}.hash`);
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

        const dataPath = join(this.cacheDir, `${key}.json`);
        await writeFile(dataPath, data, 'utf-8');
    }

    /**
     * Check if permanent cache exists.
     * @param key - Cache key
     */
    hasPermanentCache(key: string): boolean {
        const dataPath = join(this.cacheDir, `${key}.json`);
        return existsSync(dataPath);
    }

    /**
     * Read permanent cache if it exists.
     * @param key - Cache key
     */
    async readPermanentCache(key: string): Promise<string | undefined> {
        const dataPath = join(this.cacheDir, `${key}.json`);
        if (!existsSync(dataPath)) {
            return undefined;
        }
        return await readFile(dataPath, 'utf-8');
    }

    /**
     * Get the lockfile hash from the last GitHub releases fetch.
     */
    async getLastReleaseFetchHash(): Promise<string | undefined> {
        const hashPath = join(this.cacheDir, 'github-releases-fetch.hash');
        if (!existsSync(hashPath)) {
            return undefined;
        }
        return (await readFile(hashPath, 'utf-8')).trim();
    }

    /**
     * Store the lockfile hash for the current GitHub releases fetch.
     */
    async setLastReleaseFetchHash(lockfilePath: string): Promise<void> {
        if (!existsSync(this.cacheDir)) {
            await mkdir(this.cacheDir, { recursive: true });
        }
        const hash = await this.getFileHash(lockfilePath);
        const hashPath = join(this.cacheDir, 'github-releases-fetch.hash');
        await writeFile(hashPath, hash, 'utf-8');
    }

    /**
     * Check if lockfile has changed since the last releases fetch.
     */
    async hasLockfileChangedSinceLastFetch(lockfilePath: string): Promise<boolean> {
        const lastHash = await this.getLastReleaseFetchHash();
        if (!lastHash) {
            return true;
        }
        const currentHash = await this.getFileHash(lockfilePath);
        return currentHash !== lastHash;
    }
}
