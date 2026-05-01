import type { DirectDependency, DataSource, FactStore } from '../../core/index';
import { FactKeys, convertGitUrlToHttps } from '../../core/index';
import type { NpmRegistryService } from '../services/NpmRegistryService';

/**
 * Fetches per-version registry metadata (description, homepage, repository URL,
 * bugs URL, unpacked size) and the list of versions between current and latest.
 *
 * Also stores the raw repository URL as a version fact so that downstream
 * sources (e.g. GitHubSource) can read it without re-fetching.
 */
export class NpmRegistrySource implements DataSource {
    readonly name = 'npm-registry';
    readonly dependsOn: readonly string[] = [];

    constructor(private registryService: NpmRegistryService) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const packageNames = dependencies.map((d) => d.name);
        await this.registryService.prefetchFullMetadata(packageNames);

        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const metadata = await this.registryService.getPackageMetadata(
                    dep.name,
                    ver.version,
                );

                if (metadata) {
                    store.setVersionFact(
                        dep.name,
                        ver.version,
                        FactKeys.DESCRIPTION,
                        metadata.description,
                    );
                    store.setVersionFact(
                        dep.name,
                        ver.version,
                        FactKeys.HOMEPAGE,
                        metadata.homepage,
                    );
                    store.setVersionFact(
                        dep.name,
                        ver.version,
                        FactKeys.REPOSITORY_URL,
                        convertGitUrlToHttps(metadata.repository?.url),
                    );
                    store.setVersionFact(
                        dep.name,
                        ver.version,
                        FactKeys.BUGS_URL,
                        metadata.bugs?.url,
                    );
                    store.setVersionFact(
                        dep.name,
                        ver.version,
                        FactKeys.UNPACKED_SIZE,
                        metadata.dist?.unpackedSize,
                    );

                    // Store raw repo URL for GitHubSource to consume
                    store.setVersionFact(
                        dep.name,
                        ver.version,
                        FactKeys.RAW_REPO_URL,
                        metadata.repository?.url,
                    );
                }

                const versionsBetween = await this.registryService.getVersionsBetween(
                    dep.name,
                    ver.version,
                    ver.latestVersion,
                );
                store.setVersionFact(
                    dep.name,
                    ver.version,
                    FactKeys.VERSIONS_BETWEEN,
                    versionsBetween,
                );
            }
        }
    }
}
