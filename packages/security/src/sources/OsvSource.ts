import type { CacheService, DataSource, DirectDependency, FactStore } from '@dependicus/core';
import type { SecurityFinding, Severity, OsvConfig } from '../types';
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

// ── CVSS parsing ────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_VULN_CACHE_TTL_DAYS = 7;

/**
 * Extract a severity bucket from a CVSS v3 vector string.
 * Uses a weighted heuristic over base metrics — not a real CVSS calculator,
 * but sufficient for coarse bucketing.
 */
export function severityFromCvssV3(vector: string): Severity {
    const avMatch = vector.match(/AV:([NALP])/);
    const acMatch = vector.match(/AC:([HL])/);
    const prMatch = vector.match(/PR:([NLH])/);
    // Use word boundary to avoid matching VC:/SC: from v4 vectors
    const cMatch = vector.match(/\bC:([NLH])/);
    const iMatch = vector.match(/\bI:([NLH])/);
    const aMatch = vector.match(/\bA:([NLH])/);

    let score = 0;
    if (avMatch?.[1] === 'N') score += 3;
    else if (avMatch?.[1] === 'A') score += 2;
    else if (avMatch?.[1] === 'L') score += 1;

    if (acMatch?.[1] === 'L') score += 1;

    if (prMatch?.[1] === 'N') score += 2;
    else if (prMatch?.[1] === 'L') score += 1;

    const impactLetters = [cMatch?.[1], iMatch?.[1], aMatch?.[1]];
    for (const l of impactLetters) {
        if (l === 'H') score += 2;
        else if (l === 'L') score += 1;
    }

    if (score >= 10) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    if (score >= 1) return 'low';
    return 'none';
}

/**
 * Extract a severity bucket from a CVSS v4 vector string.
 * V4 uses different metric names: AT (attack requirements), VC/VI/VA
 * (vulnerable system impact), SC/SI/SA (subsequent system impact).
 */
export function severityFromCvssV4(vector: string): Severity {
    const avMatch = vector.match(/AV:([NALP])/);
    const atMatch = vector.match(/AT:([NP])/); // Attack Requirements: None, Present
    const prMatch = vector.match(/PR:([NLH])/);
    const vcMatch = vector.match(/VC:([NLH])/);
    const viMatch = vector.match(/VI:([NLH])/);
    const vaMatch = vector.match(/VA:([NLH])/);
    const scMatch = vector.match(/SC:([NLH])/);
    const siMatch = vector.match(/SI:([NLH])/);
    const saMatch = vector.match(/SA:([NLH])/);

    let score = 0;
    if (avMatch?.[1] === 'N') score += 3;
    else if (avMatch?.[1] === 'A') score += 2;
    else if (avMatch?.[1] === 'L') score += 1;

    if (atMatch?.[1] === 'N') score += 1; // No special requirements = easier to exploit

    if (prMatch?.[1] === 'N') score += 2;
    else if (prMatch?.[1] === 'L') score += 1;

    // Vulnerable system impact (primary)
    const vulnImpact = [vcMatch?.[1], viMatch?.[1], vaMatch?.[1]];
    for (const l of vulnImpact) {
        if (l === 'H') score += 2;
        else if (l === 'L') score += 1;
    }

    // Subsequent system impact (secondary, weighted less)
    const subImpact = [scMatch?.[1], siMatch?.[1], saMatch?.[1]];
    for (const l of subImpact) {
        if (l === 'H') score += 1;
    }

    if (score >= 10) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    if (score >= 1) return 'low';
    return 'none';
}

/**
 * Extract a severity bucket from a CVSS v2 vector string.
 * V2 uses Au (Authentication) instead of PR, and has no scope concept.
 */
export function severityFromCvssV2(vector: string): Severity {
    const avMatch = vector.match(/AV:([NLA])/);
    const acMatch = vector.match(/AC:([HML])/);
    const auMatch = vector.match(/Au:([NSM])/);
    const cMatch = vector.match(/\bC:([NPC])/);
    const iMatch = vector.match(/\bI:([NPC])/);
    const aMatch = vector.match(/\bA:([NPC])/);

    let score = 0;
    if (avMatch?.[1] === 'N') score += 3;
    else if (avMatch?.[1] === 'A') score += 2;
    else if (avMatch?.[1] === 'L') score += 1;

    if (acMatch?.[1] === 'L') score += 1;

    if (auMatch?.[1] === 'N') score += 2;
    else if (auMatch?.[1] === 'S') score += 1;

    // V2 impact uses N/P/C (None/Partial/Complete)
    const impactLetters = [cMatch?.[1], iMatch?.[1], aMatch?.[1]];
    for (const l of impactLetters) {
        if (l === 'C') score += 2;
        else if (l === 'P') score += 1;
    }

    if (score >= 10) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    if (score >= 1) return 'low';
    return 'none';
}

export function parseSeverity(
    severityEntries: Array<{ type: string; score: string }> | undefined,
): Severity | undefined {
    if (!severityEntries || severityEntries.length === 0) return undefined;

    const v3 = severityEntries.find((s) => s.type === 'CVSS_V3');
    if (v3) return severityFromCvssV3(v3.score);

    const v4 = severityEntries.find((s) => s.type === 'CVSS_V4');
    if (v4) return severityFromCvssV4(v4.score);

    const v2 = severityEntries.find((s) => s.type === 'CVSS_V2');
    if (v2) return severityFromCvssV2(v2.score);

    // Unknown severity type — assume medium rather than hiding it
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

            const anyFixAvailable = vulns.some(hasFixedVersion);

            const rationale: string[] = [];
            if (vulns.length === 1) {
                rationale.push(`1 advisory (${vulns[0]!.id})`);
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

            const finding: SecurityFinding = {
                source: 'osv',
                sourceLabel: 'OSV',
                severity: worstSeverity,
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
