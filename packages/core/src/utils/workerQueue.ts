export interface WorkerQueueOptions {
    workerCount?: number;
}

export async function processInParallel<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options: WorkerQueueOptions = {},
): Promise<R[]> {
    const { workerCount = 4 } = options;
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            const item = items[index];
            if (item !== undefined) {
                results[index] = await processor(item, index);
            }
        }
    };

    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results;
}
