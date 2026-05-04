import type { DataSource, DirectDependency, FactStore } from '../../core/index';
import type { CacheService } from '../../core/services/CacheService';
import type { AdvisoryDetail, SecurityFinding, Severity, GitHubAdvisoryConfig } from '../types';
import { SECURITY_FINDINGS_KEY } from '../types';

// ── Ecosystem mapping ───────────────────────────────────────────────

/** Map dependicus ecosystem names to GitHub Advisory ecosystem names. */
export const ECOSYSTEM_MAP: Record<string, string> = {
    npm: 'npm',
    pypi: 'pip',
    gomod: 'go',
    cargo: 'rust',
};

// ── API types ───────────────────────────────────────────────────────

interface GitHubAdvisory {
    ghsa_id: string;
    summary?: string;
    severity: string;
    cvss?: { vector_string?: string; score?: number };
    vulnerabilities?: Array<{
        package?: { name: string; ecosystem: string };
        vulnerable_version_range?: string;
        first_patched_version?: { identifier: string } | null;
    }>;
}

// ── GitHubAdvisorySource ────────────────────────────────────────────

const API_BASE = 'https://api.github.com/advisories';
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_DAYS = 7;

interface CachedEntry<T> {
    fetchedAt: number;
    data: T;
}

export class GitHubAdvisorySource implements DataSource {
    readonly name = 'github-advisory';
    readonly dependsOn: readonly string[] = [];

    private readonly cacheTtlMs: number;
    private cacheService: CacheService | undefined;

    constructor(config?: GitHubAdvisoryConfig) {
        this.cacheTtlMs = (config?.cacheTtlDays ?? DEFAULT_CACHE_TTL_DAYS) * 24 * 60 * 60 * 1000;
    }

    setCacheService(cs: CacheService): void {
        this.cacheService = cs;
    }

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const work: Array<{ dep: DirectDependency; version: string; ghEcosystem: string }> = [];

        for (const dep of dependencies) {
            const ghEcosystem = ECOSYSTEM_MAP[dep.ecosystem];
            if (!ghEcosystem) continue;
            for (const ver of dep.versions) {
                work.push({ dep, version: ver.version, ghEcosystem });
            }
        }

        if (work.length === 0) return;

        process.stderr.write(`GitHub Advisory: querying ${work.length} package versions...\n`);

        let enriched = 0;
        const concurrency = 5; // Lower than OSV — respect GitHub rate limits
        for (let i = 0; i < work.length; i += concurrency) {
            const batch = work.slice(i, i + concurrency);
            await Promise.all(
                batch.map(async ({ dep, version, ghEcosystem }) => {
                    const finding = await this.fetchFinding(dep.name, version, ghEcosystem);
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

        process.stderr.write(`GitHub Advisory: enriched ${enriched} package versions\n`);
    }

    private async fetchFinding(
        name: string,
        version: string,
        ghEcosystem: string,
    ): Promise<SecurityFinding | undefined> {
        const affects = `${name}@${version}`;
        const url = `${API_BASE}?ecosystem=${encodeURIComponent(ghEcosystem)}&affects=${encodeURIComponent(affects)}&per_page=100`;
        const cacheKey = `ghsa-${ghEcosystem}-${name}-${version}`;

        const advisories = await this.cachedFetch<GitHubAdvisory[]>(cacheKey, url);
        if (!advisories || advisories.length === 0) return undefined;

        // Compute worst severity and highest CVSS score
        let worstSeverity: Severity | undefined;
        let highestScore: number | undefined;

        for (const advisory of advisories) {
            const sev = mapSeverity(advisory.severity);
            if (sev && (!worstSeverity || severityRank(sev) > severityRank(worstSeverity))) {
                worstSeverity = sev;
            }
            const score = advisory.cvss?.score ?? undefined;
            if (score !== undefined) {
                if (highestScore === undefined || score > highestScore) {
                    highestScore = score;
                }
            }
        }

        // Check if any advisory has a patched version
        const fixAvailable = advisories.some((a) =>
            a.vulnerabilities?.some((v) => v.first_patched_version),
        );

        const advisoryIds = advisories.map((a) => a.ghsa_id);
        const rationale: string[] = [];
        if (advisories.length === 1) {
            rationale.push(`1 GitHub advisory (${advisories[0]?.ghsa_id})`);
        } else {
            rationale.push(`${advisories.length} GitHub advisories`);
        }
        if (fixAvailable) {
            rationale.push('fix available');
        }

        const sourceLinks = advisories.map((a) => ({
            label: a.ghsa_id,
            url: `https://github.com/advisories/${a.ghsa_id}`,
        }));

        const advisoryDetails: AdvisoryDetail[] = advisories.map((a) => ({
            id: a.ghsa_id,
            summary: a.summary,
            severity: mapSeverity(a.severity),
            cvssScore: a.cvss?.score ?? undefined,
            fixAvailable: a.vulnerabilities?.some((v) => v.first_patched_version) ?? false,
            url: `https://github.com/advisories/${a.ghsa_id}`,
        }));

        return {
            source: 'github-advisory',
            sourceLabel: 'GitHub Advisory',
            severity: worstSeverity,
            cvssScore: highestScore,
            advisories: advisoryDetails,
            advisoryIds,
            advisoryCount: advisories.length,
            fixAvailable,
            rationale,
            sourceLinks,
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
            const headers: Record<string, string> = {
                Accept: 'application/vnd.github+json',
            };
            // Use GITHUB_TOKEN if available for higher rate limits (5000/hr vs 60/hr)
            const token = process.env.GITHUB_TOKEN;
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(url, {
                headers,
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

const SEVERITY_RANK: Record<string, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

export function mapSeverity(ghSeverity: string): Severity | undefined {
    const lower = ghSeverity.toLowerCase();
    if (lower === 'critical' || lower === 'high' || lower === 'medium' || lower === 'low') {
        return lower;
    }
    return undefined;
}

function severityRank(s: Severity): number {
    return SEVERITY_RANK[s] ?? 0;
}
