import type { CacheService, DataSource, DirectDependency, FactStore } from '@dependicus/core';
import type { SecurityFinding, Maintenance, DepsDevConfig } from '../types';
import { SECURITY_FINDINGS_KEY } from '../types';

// ── Ecosystem mapping ───────────────────────────────────────────────

/** Map dependicus ecosystem names to deps.dev system names (uppercase). */
export const ECOSYSTEM_MAP: Record<string, string> = {
    npm: 'NPM',
    pypi: 'PYPI',
    gomod: 'GO',
    cargo: 'CARGO',
};

/** Systems where the :dependencies endpoint is available. */
const DEPS_SUPPORTED_SYSTEMS = new Set(['NPM', 'CARGO', 'PYPI']);

// ── API types ───────────────────────────────────────────────────────

interface DepsDevVersionResponse {
    isDefault?: boolean;
    isDeprecated?: boolean;
    deprecatedReason?: string;
    links?: Array<{ label: string; url: string }>;
}

interface DepsDevDependenciesResponse {
    nodes?: Array<{
        relation?: string; // SELF, DIRECT, INDIRECT
    }>;
}

// ── DepsDevSource ───────────────────────────────────────────────────

const API_BASE = 'https://api.deps.dev/v3';
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_DAYS = 7;

interface CachedEntry<T> {
    fetchedAt: number;
    data: T;
}

export class DepsDevSource implements DataSource {
    readonly name = 'deps-dev';
    readonly dependsOn: readonly string[] = [];

    private readonly includeDependencies: boolean;
    private readonly cacheTtlMs: number;
    private cacheService: CacheService | undefined;

    constructor(config?: DepsDevConfig) {
        this.includeDependencies = config?.includeDependencies ?? true;
        this.cacheTtlMs = (config?.cacheTtlDays ?? DEFAULT_CACHE_TTL_DAYS) * 24 * 60 * 60 * 1000;
    }

    setCacheService(cs: CacheService): void {
        this.cacheService = cs;
    }

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const work: Array<{ dep: DirectDependency; version: string; system: string }> = [];

        for (const dep of dependencies) {
            const system = ECOSYSTEM_MAP[dep.ecosystem];
            if (!system) continue;
            for (const ver of dep.versions) {
                work.push({ dep, version: ver.version, system });
            }
        }

        if (work.length === 0) return;

        process.stderr.write(`deps.dev: querying ${work.length} package versions...\n`);

        let enriched = 0;
        const concurrency = 10;
        for (let i = 0; i < work.length; i += concurrency) {
            const batch = work.slice(i, i + concurrency);
            await Promise.all(
                batch.map(async ({ dep, version, system }) => {
                    const finding = await this.fetchFinding(dep.name, version, system);
                    if (!finding) return;

                    const scoped = store.scoped(dep.ecosystem);
                    const existing =
                        scoped.getVersionFact<SecurityFinding[]>(
                            dep.name,
                            version,
                            SECURITY_FINDINGS_KEY,
                        ) ?? [];
                    scoped.setVersionFact(dep.name, version, SECURITY_FINDINGS_KEY, [
                        ...existing,
                        finding,
                    ]);
                    enriched++;
                }),
            );
        }

        process.stderr.write(`deps.dev: enriched ${enriched} package versions\n`);
    }

    private async fetchFinding(
        name: string,
        version: string,
        system: string,
    ): Promise<SecurityFinding | undefined> {
        const encodedName = encodeURIComponent(name);
        const encodedVersion = encodeURIComponent(version);

        // Fetch version info
        const versionData = await this.cachedFetch<DepsDevVersionResponse>(
            `depsdev-version-${system}-${name}-${version}`,
            `${API_BASE}/systems/${system}/packages/${encodedName}/versions/${encodedVersion}`,
        );
        if (!versionData) return undefined;

        // Optionally fetch dependency graph
        let depCount: { direct: number; total: number } | undefined;
        if (this.includeDependencies && DEPS_SUPPORTED_SYSTEMS.has(system)) {
            const depsData = await this.cachedFetch<DepsDevDependenciesResponse>(
                `depsdev-deps-${system}-${name}-${version}`,
                `${API_BASE}/systems/${system}/packages/${encodedName}/versions/${encodedVersion}:dependencies`,
            );
            if (depsData?.nodes) {
                const direct = depsData.nodes.filter((n) => n.relation === 'DIRECT').length;
                const total = depsData.nodes.filter((n) => n.relation !== 'SELF').length;
                depCount = { direct, total };
            }
        }

        // Derive maintenance posture
        const maintenance = deriveMaintenance(versionData);

        // deps.dev contributes maintenance/deprecation signals, not advisories.
        // Only emit a finding when the package is actually deprecated; healthy
        // packages should not register as security findings (which would
        // inflate advisory counts and add noise to ticket descriptions).
        if (maintenance !== 'stale') return undefined;

        const rationale: string[] = [];
        rationale.push(
            versionData.deprecatedReason
                ? `deprecated: ${versionData.deprecatedReason}`
                : 'deprecated',
        );
        if (depCount && depCount.total > 0) {
            rationale.push(
                `${depCount.direct} direct ${depCount.direct === 1 ? 'dependency' : 'dependencies'}, ${depCount.total} total transitive`,
            );
        }

        return {
            source: 'deps-dev',
            sourceLabel: 'deps.dev',
            maintenance,
            rationale,
        };
    }

    private async cachedFetch<T>(cacheKey: string, url: string): Promise<T | undefined> {
        if (this.cacheService) {
            const raw = await this.cacheService.readPermanentCache(cacheKey);
            if (raw) {
                const cached = JSON.parse(raw) as CachedEntry<T>;
                if (Date.now() - cached.fetchedAt < this.cacheTtlMs) {
                    return cached.data;
                }
            }
        }

        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!response.ok) return undefined;
            const data = (await response.json()) as T;

            if (this.cacheService) {
                const envelope: CachedEntry<T> = { fetchedAt: Date.now(), data };
                await this.cacheService.writePermanentCache(cacheKey, JSON.stringify(envelope));
            }

            return data;
        } catch {
            return undefined;
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

export function deriveMaintenance(data: DepsDevVersionResponse): Maintenance {
    if (data.isDeprecated) return 'stale';
    // If deps.dev knows about this package and it's not deprecated,
    // the project is actively maintained enough to publish to a registry.
    return 'active';
}
