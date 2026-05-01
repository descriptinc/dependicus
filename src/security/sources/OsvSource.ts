import type { DataSource, DirectDependency, FactStore } from '../../core/index';
import type { CacheService } from '../../core/services/CacheService';
import { CVSS } from '@turingpointde/cvss.js';
import type { AdvisoryDetail, SecurityFinding, Severity, OsvConfig } from '../types';
import { SECURITY_FINDINGS_KEY, SEVERITY_ORDER } from '../types';

// ── OSV ecosystem mapping ───────────────────────────────────────────

/** Map dependicus ecosystem names to OSV ecosystem names. */
export const ECOSYSTEM_MAP: Record<string, string> = {
    npm: 'npm',
    pypi: 'PyPI',
    gomod: 'Go',
    cargo: 'crates.io',
};

// ── OSV API types ───────────────────────────────────────────────────

interface OsvBatchQuery {
    package: { name: string; ecosystem: string };
    version: string;
}

interface OsvBatchResponse {
    results: Array<{
        vulns?: Array<{ id: string; modified: string }>;
    }>;
}

export interface OsvVulnerability {
    id: string;
    summary?: string;
    severity?: Array<{ type: string; score: string }>;
    affected?: Array<{
        package?: { name: string; ecosystem: string };
        ranges?: Array<{
            type: string;
            events: Array<Record<string, string>>;
        }>;
    }>;
    references?: Array<{ type: string; url: string }>;
}

// ── CVSS scoring ────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_VULN_CACHE_TTL_DAYS = 7;

/** Map a numeric CVSS base score to a severity bucket per FIRST.org thresholds. */
export function severityFromScore(score: number): Severity {
    if (score >= 9.0) return 'critical';
    if (score >= 7.0) return 'high';
    if (score >= 4.0) return 'medium';
    if (score > 0) return 'low';
    return 'none';
}

/** Compute a base score from a CVSS vector string (v3.0, v3.1, v4.0).
 *  Returns undefined for v2 vectors or unparseable input. */
export function cvssBaseScore(vector: string): number | undefined {
    try {
        // CVSS v2 vectors lack a version prefix — not supported by our scoring library.
        // parseSeverity() falls back to 'medium' for unscored entries.
        if (!vector.startsWith('CVSS:')) return undefined;
        return CVSS(vector).getScore();
    } catch {
        return undefined;
    }
}

export function parseSeverity(
    severityEntries: Array<{ type: string; score: string }> | undefined,
): Severity | undefined {
    if (!severityEntries || severityEntries.length === 0) return undefined;

    // Prefer V3 > V4 > V2
    const ordered = ['CVSS_V3', 'CVSS_V4', 'CVSS_V2'];
    for (const type of ordered) {
        const entry = severityEntries.find((s) => s.type === type);
        if (entry) {
            const score = cvssBaseScore(entry.score);
            if (score !== undefined) return severityFromScore(score);
        }
    }

    // Unknown type — assume medium rather than hiding it
    return 'medium';
}

/** Check whether any affected range has a "fixed" event. */
export function hasFixedVersion(vuln: OsvVulnerability): boolean {
    for (const affected of vuln.affected ?? []) {
        for (const range of affected.ranges ?? []) {
            for (const event of range.events) {
                if ('fixed' in event) return true;
            }
        }
    }
    return false;
}

export function pickWorstSeverity(severities: Severity[]): Severity | undefined {
    if (severities.length === 0) return undefined;
    let worst = 0;
    for (const s of severities) {
        const idx = SEVERITY_ORDER.indexOf(s);
        if (idx > worst) worst = idx;
    }
    return SEVERITY_ORDER[worst];
}

// ── Cache envelope ──────────────────────────────────────────────────

interface CachedVuln {
    fetchedAt: number;
    data: OsvVulnerability;
}

// ── OsvSource ───────────────────────────────────────────────────────

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';

export class OsvSource implements DataSource {
    readonly name = 'osv';
    readonly dependsOn: readonly string[] = [];

    private readonly batchSize: number;
    private readonly vulnCacheTtlMs: number;
    private cacheService: CacheService | undefined;

    constructor(config?: OsvConfig) {
        this.batchSize = config?.batchSize ?? 1000;
        this.vulnCacheTtlMs =
            (config?.vulnCacheTtlDays ?? DEFAULT_VULN_CACHE_TTL_DAYS) * 24 * 60 * 60 * 1000;
    }

    setCacheService(cs: CacheService): void {
        this.cacheService = cs;
    }

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const queries: OsvBatchQuery[] = [];
        const queryIndex: Array<{ dep: DirectDependency; version: string }> = [];

        for (const dep of dependencies) {
            const osvEcosystem = ECOSYSTEM_MAP[dep.ecosystem];
            if (!osvEcosystem) continue;

            for (const ver of dep.versions) {
                queries.push({
                    package: { name: dep.name, ecosystem: osvEcosystem },
                    version: ver.version,
                });
                queryIndex.push({ dep, version: ver.version });
            }
        }

        if (queries.length === 0) return;

        process.stderr.write(`OSV: querying ${queries.length} package versions...\n`);

        // Step 1: Batch query to find which packages have vulns
        const vulnIdsByIndex = new Map<number, string[]>();
        const allVulnIds = new Set<string>();

        for (let i = 0; i < queries.length; i += this.batchSize) {
            const batch = queries.slice(i, i + this.batchSize);
            try {
                const response = await this.batchQuery(batch);

                for (let j = 0; j < response.results.length; j++) {
                    const result = response.results[j];
                    if (!result?.vulns || result.vulns.length === 0) continue;

                    const globalIdx = i + j;
                    const ids = result.vulns.map((v) => v.id);
                    vulnIdsByIndex.set(globalIdx, ids);
                    for (const id of ids) allVulnIds.add(id);
                }
            } catch (error) {
                process.stderr.write(
                    `OSV: batch query failed, skipping ${batch.length} packages: ${error}\n`,
                );
            }
        }

        if (allVulnIds.size === 0) {
            process.stderr.write('OSV: no vulnerabilities found\n');
            return;
        }

        process.stderr.write(
            `OSV: found ${allVulnIds.size} unique vulnerabilities, fetching details...\n`,
        );

        // Step 2: Fetch full vulnerability details for each unique ID
        const vulnDetails = new Map<string, OsvVulnerability>();
        const idArray = Array.from(allVulnIds);

        const concurrency = 10;
        for (let i = 0; i < idArray.length; i += concurrency) {
            const batch = idArray.slice(i, i + concurrency);
            const results = await Promise.all(batch.map((id) => this.fetchVuln(id)));
            for (const vuln of results) {
                if (vuln) vulnDetails.set(vuln.id, vuln);
            }
        }

        // Step 3: Reduce into SecurityFindings and write to FactStore
        for (const [idx, vulnIds] of vulnIdsByIndex) {
            const entry = queryIndex[idx];
            if (!entry) continue;

            const vulns = vulnIds
                .map((id) => vulnDetails.get(id))
                .filter((v): v is OsvVulnerability => v !== undefined);

            if (vulns.length === 0) continue;

            const severities = vulns
                .map((v) => parseSeverity(v.severity))
                .filter((s): s is Severity => s !== undefined);
            const worstSeverity = pickWorstSeverity(severities);

            // Compute highest CVSS base score across all vulns
            const scores = vulns.flatMap((v) =>
                (v.severity ?? [])
                    .map((s) => cvssBaseScore(s.score))
                    .filter((s): s is number => s !== undefined),
            );
            const worstScore = scores.length > 0 ? Math.max(...scores) : undefined;

            const anyFixAvailable = vulns.some(hasFixedVersion);

            const rationale: string[] = [];
            if (vulns.length === 1) {
                rationale.push(`1 advisory (${vulns[0]?.id})`);
            } else {
                rationale.push(`${vulns.length} advisories`);
            }
            if (anyFixAvailable) {
                rationale.push('fix available in a newer version');
            }

            const sourceLinks = vulns.map((v) => ({
                label: v.id,
                url: `https://osv.dev/vulnerability/${v.id}`,
            }));

            const advisories: AdvisoryDetail[] = vulns.map((v) => {
                const vulnScores = (v.severity ?? [])
                    .map((s) => cvssBaseScore(s.score))
                    .filter((s): s is number => s !== undefined);
                return {
                    id: v.id,
                    summary: v.summary,
                    severity: parseSeverity(v.severity),
                    cvssScore: vulnScores.length > 0 ? Math.max(...vulnScores) : undefined,
                    fixAvailable: hasFixedVersion(v),
                    url: `https://osv.dev/vulnerability/${v.id}`,
                };
            });

            const finding: SecurityFinding = {
                source: 'osv',
                sourceLabel: 'OSV',
                severity: worstSeverity,
                cvssScore: worstScore,
                advisories,
                advisoryIds: vulns.map((v) => v.id),
                advisoryCount: vulns.length,
                fixAvailable: anyFixAvailable,
                rationale,
                sourceLinks,
            };

            const scoped = store.scoped(entry.dep.ecosystem);
            const existing =
                scoped.getVersionFact<SecurityFinding[]>(
                    entry.dep.name,
                    entry.version,
                    SECURITY_FINDINGS_KEY,
                ) ?? [];
            scoped.setVersionFact(entry.dep.name, entry.version, SECURITY_FINDINGS_KEY, [
                ...existing,
                finding,
            ]);
        }

        process.stderr.write(
            `OSV: enriched ${vulnIdsByIndex.size} package versions with vulnerability data\n`,
        );
    }

    private async batchQuery(queries: OsvBatchQuery[]): Promise<OsvBatchResponse> {
        const response = await fetch(OSV_BATCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queries }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`OSV batch query failed: ${response.status} ${response.statusText}`);
        }
        return (await response.json()) as OsvBatchResponse;
    }

    private async fetchVuln(id: string): Promise<OsvVulnerability | undefined> {
        const cacheKey = `osv-vuln-${id}`;

        if (this.cacheService) {
            const raw = await this.cacheService.readPermanentCache(cacheKey);
            if (raw) {
                const cached = JSON.parse(raw) as CachedVuln;
                if (Date.now() - cached.fetchedAt < this.vulnCacheTtlMs) {
                    return cached.data;
                }
            }
        }

        try {
            const response = await fetch(`${OSV_VULN_URL}/${encodeURIComponent(id)}`, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!response.ok) return undefined;
            const vuln = (await response.json()) as OsvVulnerability;

            if (this.cacheService) {
                const envelope: CachedVuln = { fetchedAt: Date.now(), data: vuln };
                await this.cacheService.writePermanentCache(cacheKey, JSON.stringify(envelope));
            }

            return vuln;
        } catch {
            return undefined;
        }
    }
}
