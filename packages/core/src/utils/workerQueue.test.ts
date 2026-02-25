import { describe, it, expect } from 'vitest';
import { processInParallel } from './workerQueue';

describe('processInParallel', () => {
    it('processes all items', async () => {
        const items = [1, 2, 3, 4, 5];
        const results = await processInParallel(items, async (item) => item * 2);

        expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('preserves order of results', async () => {
        const items = [1, 2, 3, 4, 5];
        const results = await processInParallel(items, async (item) => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            return item * 2;
        });

        expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('handles empty array', async () => {
        const results = await processInParallel([], async (item) => item);

        expect(results).toEqual([]);
    });

    it('uses custom worker count', async () => {
        const items = [1, 2, 3, 4, 5];
        const concurrentCounts: number[] = [];
        let currentConcurrent = 0;

        const results = await processInParallel(
            items,
            async (item) => {
                currentConcurrent++;
                concurrentCounts.push(currentConcurrent);
                await new Promise((resolve) => setTimeout(resolve, 10));
                currentConcurrent--;
                return item * 2;
            },
            { workerCount: 2 },
        );

        expect(results).toEqual([2, 4, 6, 8, 10]);
        expect(Math.max(...concurrentCounts)).toBeLessThanOrEqual(2);
    });

    it('passes item index to processor', async () => {
        const items = ['a', 'b', 'c'];
        const results = await processInParallel(items, async (item, index) => `${item}-${index}`);

        expect(results).toEqual(['a-0', 'b-1', 'c-2']);
    });

    it('handles errors by propagating them', async () => {
        const items = [1, 2, 3];

        await expect(
            processInParallel(items, async (item) => {
                if (item === 2) {
                    throw new Error('Test error');
                }
                return item * 2;
            }),
        ).rejects.toThrow('Test error');
    });

    it('defaults to 4 workers', async () => {
        const items = Array.from({ length: 10 }, (_, i) => i);
        const concurrentCounts: number[] = [];
        let currentConcurrent = 0;

        await processInParallel(items, async (item) => {
            currentConcurrent++;
            concurrentCounts.push(currentConcurrent);
            await new Promise((resolve) => setTimeout(resolve, 5));
            currentConcurrent--;
            return item;
        });

        expect(Math.max(...concurrentCounts)).toBeLessThanOrEqual(4);
    });
});
