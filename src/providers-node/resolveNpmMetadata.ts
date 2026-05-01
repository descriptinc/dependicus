import { WORKER_COUNT, processInParallel } from '../core/index';
import type { NpmRegistryService } from './services/NpmRegistryService';

/**
 * Shared implementation of resolveVersionMetadata for all four node providers.
 * Fetches full npm registry metadata in parallel, then extracts publish dates
 * and latest versions for each requested name@version pair.
 */
export async function resolveNpmMetadata(
    registryService: NpmRegistryService,
    packages: Array<{ name: string; versions: string[] }>,
): Promise<Map<string, { publishDate: string | undefined; latestVersion: string }>> {
    const packageNames = packages.map((p) => p.name);

    const metadataMap = new Map<
        string,
        Awaited<ReturnType<typeof registryService.getFullPackageMetadata>>
    >();
    let completed = 0;

    process.stderr.write('Fetching package metadata from npm registry...\n');

    await processInParallel(
        packageNames,
        async (packageName) => {
            const metadata = await registryService.getFullPackageMetadata(packageName);
            metadataMap.set(packageName, metadata);
            completed++;
            if (completed % 50 === 0 || completed === packageNames.length) {
                process.stderr.write(`  Fetched ${completed}/${packageNames.length} packages\n`);
            }
        },
        { workerCount: WORKER_COUNT },
    );

    const resultMap = new Map<string, { publishDate: string | undefined; latestVersion: string }>();
    for (const { name, versions } of packages) {
        const metadata = metadataMap.get(name);
        const latestVersion = metadata?.['dist-tags']?.latest || '';
        for (const version of versions) {
            const publishDate = metadata?.time?.[version];
            resultMap.set(`${name}@${version}`, { publishDate, latestVersion });
        }
    }
    return resultMap;
}
