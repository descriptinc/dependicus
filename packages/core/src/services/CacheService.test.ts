import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CacheService } from './CacheService';

describe('CacheService', () => {
    let tempDir: string;
    let cacheService: CacheService;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'cache-test-'));
        cacheService = new CacheService(tempDir);
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    describe('writeCache / readCache / isCacheValid', () => {
        it('writes and reads cache data', async () => {
            const invalidationFile = join(tempDir, 'lockfile.yaml');
            writeFileSync(invalidationFile, 'lockfile-content');

            await cacheService.writeCache('test-key', '{"data": true}', invalidationFile);
            const data = await cacheService.readCache('test-key');
            expect(data).toBe('{"data": true}');
        });

        it('validates cache when hash matches', async () => {
            const invalidationFile = join(tempDir, 'lockfile.yaml');
            writeFileSync(invalidationFile, 'lockfile-content');

            await cacheService.writeCache('test-key', '{"data": true}', invalidationFile);

            const valid = await cacheService.isCacheValid('test-key', invalidationFile);
            expect(valid).toBe(true);
        });

        it('invalidates cache when file content changes', async () => {
            const invalidationFile = join(tempDir, 'lockfile.yaml');
            writeFileSync(invalidationFile, 'lockfile-content-v1');

            await cacheService.writeCache('test-key', '{"data": true}', invalidationFile);

            // Modify the invalidation file
            writeFileSync(invalidationFile, 'lockfile-content-v2');

            const valid = await cacheService.isCacheValid('test-key', invalidationFile);
            expect(valid).toBe(false);
        });

        it('returns false for non-existent cache', async () => {
            const invalidationFile = join(tempDir, 'lockfile.yaml');
            writeFileSync(invalidationFile, 'content');

            const valid = await cacheService.isCacheValid('missing-key', invalidationFile);
            expect(valid).toBe(false);
        });
    });

    describe('permanent cache', () => {
        it('writes and reads permanent cache', async () => {
            await cacheService.writePermanentCache('perm-key', '{"permanent": true}');
            const data = await cacheService.readPermanentCache('perm-key');
            expect(data).toBe('{"permanent": true}');
        });

        it('hasPermanentCache returns true after writing', async () => {
            expect(cacheService.hasPermanentCache('perm-key')).toBe(false);
            await cacheService.writePermanentCache('perm-key', 'data');
            expect(cacheService.hasPermanentCache('perm-key')).toBe(true);
        });

        it('readPermanentCache returns undefined for missing cache', async () => {
            const data = await cacheService.readPermanentCache('nonexistent');
            expect(data).toBeUndefined();
        });
    });

    describe('lockfile change tracking', () => {
        it('reports lockfile changed when no prior fetch', async () => {
            const lockfile = join(tempDir, 'pnpm-lock.yaml');
            writeFileSync(lockfile, 'lockfile-v1');

            const changed = await cacheService.hasLockfileChangedSinceLastFetch(lockfile);
            expect(changed).toBe(true);
        });

        it('reports lockfile unchanged after recording fetch', async () => {
            const lockfile = join(tempDir, 'pnpm-lock.yaml');
            writeFileSync(lockfile, 'lockfile-v1');

            await cacheService.setLastReleaseFetchHash(lockfile);
            const changed = await cacheService.hasLockfileChangedSinceLastFetch(lockfile);
            expect(changed).toBe(false);
        });

        it('reports lockfile changed after modification', async () => {
            const lockfile = join(tempDir, 'pnpm-lock.yaml');
            writeFileSync(lockfile, 'lockfile-v1');

            await cacheService.setLastReleaseFetchHash(lockfile);

            writeFileSync(lockfile, 'lockfile-v2');
            const changed = await cacheService.hasLockfileChangedSinceLastFetch(lockfile);
            expect(changed).toBe(true);
        });
    });
});
