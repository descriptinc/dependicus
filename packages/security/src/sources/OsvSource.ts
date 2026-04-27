import type { CacheService, DataSource, DirectDependency, FactStore } from '@dependicus/core';
import type { SecurityFinding, Severity, OsvConfig } from '../types';
import { SECURITY_FINDINGS_KEY } from '../types';

// ── OSV ecosystem mapping ───────────────────────────────────────────

/** Map dependicus ecosystem names to OSV ecosystem names. */
const ECOSYSTEM_MAP: Record<string, string> = {
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

interface OsvVulnerability {
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

/** Extract a severity bucket from a CVSS v3 vector string. */
function severityFromCvssV3(vector: string): Severity {
    // CVSS:3.x/AV:.../...  — we need the base score, but the vector doesn't
    // contain a numeric score directly. Parse the base metrics to approximate.
    // Instead, look for an explicit score suffix some databases append, or
    // fall back to a heuristic based on the attack vector + privileges.
    //
    // Simpler: many OSV entries also put ecosystem_specific severity.
    // But as a robust fallback, parse the vector properly.
    //
    // CVSS v3 vector → base score approximation is complex. Instead, check
    // if the vector string itself contains a trailing score (some providers
    // append it). Otherwise, use a rough heuristic from attack complexity.
    const acMatch = vector.match(/\/AC:([HLM])/);
    const avMatch = vector.match(/\/AV:([NALP])/);
    const prMatch = vector.match(/\/PR:([NLH])/);
    const cMatch = vector.match(/\/C:([NLH])/);
    const iMatch = vector.match(/\/I:([NLH])/);
    const aMatch = vector.match(/\/A:([NLH])/);

    // Simple weighted heuristic — not a real CVSS calculator, but good enough
    // to bucket into none/low/medium/high/critical.
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

    // Max possible ~12, map to buckets
    if (score >= 10) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    if (score >= 1) return 'low';
    return 'none';
}

function parseSeverity(
    severityEntries: Array<{ type: string; score: string }> | undefined,
): Severity | undefined {
    if (!severityEntries || severityEntries.length === 0) return undefined;

    // Prefer CVSS_V3 over V4 over V2
    const v3 = severityEntries.find((s) => s.type === 'CVSS_V3');
    if (v3) return severityFromCvssV3(v3.score);

    const v4 = severityEntries.find((s) => s.type === 'CVSS_V4');
    if (v4) return severityFromCvssV3(v4.score); // V4 vectors have similar structure

    // For V2 or unknown, default to medium
    return 'medium';
}

/** Check whether any affected range has a "fixed" event. */
function hasFixedVersion(vuln: OsvVulnerability): boolean {
    for (const affected of vuln.affected ?? []) {
        for (const range of affected.ranges ?? []) {
            for (const event of range.events) {
                if ('fixed' in event) return true;
            }
        }
    }
    return false;
}

// ── OsvSource ───────────────────────────────────────────────────────

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';

export class OsvSource implements DataSource {
    readonly name = 'osv';
    readonly dependsOn: readonly string[] = [];

    private readonly batchSize: number;
    private cacheService: CacheService | undefined;

    constructor(config?: OsvConfig) {
        this.batchSize = config?.batchSize ?? 1000;
    }

    setCacheService(cs: CacheService): void {
        this.cacheService = cs;
    }

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        // Build the list of queries, tracking which index maps to which dep+version
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
            const response = await this.batchQuery(batch);

            for (let j = 0; j < response.results.length; j++) {
                const result = response.results[j];
                if (!result?.vulns || result.vulns.length === 0) continue;

                const globalIdx = i + j;
                const ids = result.vulns.map((v) => v.id);
                vulnIdsByIndex.set(globalIdx, ids);
                for (const id of ids) allVulnIds.add(id);
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

        // Fetch in parallel with a concurrency limit
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

            // Compute worst severity across all vulns
            const severities = vulns
                .map((v) => parseSeverity(v.severity))
                .filter((s): s is Severity => s !== undefined);
            const worstSeverity = pickWorstSeverity(severities);

            // Check if any vuln has a fix
            const anyFixAvailable = vulns.some(hasFixedVersion);

            // Build rationale
            const rationale: string[] = [];
            if (vulns.length === 1) {
                rationale.push(`1 advisory (${vulns[0]!.id})`);
            } else {
                rationale.push(`${vulns.length} advisories`);
            }
            if (anyFixAvailable) {
                rationale.push('fix available in a newer version');
            }

            // Build source links
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

            // Append to existing findings array
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
        });
        if (!response.ok) {
            throw new Error(`OSV batch query failed: ${response.status} ${response.statusText}`);
        }
        return (await response.json()) as OsvBatchResponse;
    }

    private async fetchVuln(id: string): Promise<OsvVulnerability | undefined> {
        const cacheKey = `osv-vuln-${id}`;

        // Check cache first — vuln details are immutable once published
        if (this.cacheService) {
            const cached = await this.cacheService.readPermanentCache(cacheKey);
            if (cached) return JSON.parse(cached) as OsvVulnerability;
        }

        try {
            const response = await fetch(`${OSV_VULN_URL}/${encodeURIComponent(id)}`);
            if (!response.ok) return undefined;
            const vuln = (await response.json()) as OsvVulnerability;

            // Cache permanently — vuln IDs are stable
            if (this.cacheService) {
                await this.cacheService.writePermanentCache(cacheKey, JSON.stringify(vuln));
            }

            return vuln;
        } catch {
            return undefined;
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: Severity[] = ['none', 'low', 'medium', 'high', 'critical'];

function pickWorstSeverity(severities: Severity[]): Severity | undefined {
    if (severities.length === 0) return undefined;
    let worst = 0;
    for (const s of severities) {
        const idx = SEVERITY_ORDER.indexOf(s);
        if (idx > worst) worst = idx;
    }
    return SEVERITY_ORDER[worst];
}
