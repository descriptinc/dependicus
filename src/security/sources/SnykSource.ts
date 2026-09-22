import type { DataSource, DirectDependency, FactStore } from '../../core/index';
import { compareVersions, parseVersion } from '../../core/utils/versionUtils';
import type { CacheService } from '../../core/services/CacheService';
import type { AdvisoryDetail, SecurityFinding, Severity, SnykConfig } from '../types';
import { SECURITY_FINDINGS_KEY } from '../types';

// ── Ecosystem mapping ───────────────────────────────────────────────

/**
 * Map dependicus ecosystem names to purl package types.
 *
 * Anything absent is skipped rather than guessed at, so a new provider shows up
 * as missing Snyk data instead of as purls Snyk resolves to the wrong package.
 */
export const ECOSYSTEM_MAP: Record<string, string> = {
    npm: 'npm',
    pypi: 'pypi',
    gomod: 'golang',
    cargo: 'cargo',
};

// ── API types ───────────────────────────────────────────────────────

interface SnykSeverity {
    type?: string;
    level?: string;
    score?: number;
    source?: string;
}

interface SnykMaturityLevel {
    type?: string;
    level?: string;
}

export interface SnykIssue {
    id: string;
    attributes?: {
        title?: string;
        effective_severity_level?: string;
        severities?: SnykSeverity[];
        problems?: Array<{ id?: string; source?: string }>;
        coordinates?: Array<{ remedies?: Array<{ details?: { upgrade_package?: string } }> }>;
        slots?: { exploit_details?: { maturity_levels?: SnykMaturityLevel[] } };
    };
}

interface SnykIssuesResponse {
    data?: SnykIssue[];
    /** `next` is the path of the following page, absent on the last one. */
    links?: { next?: string };
}

// ── SnykSource ──────────────────────────────────────────────────────

const API_BASE = 'https://api.snyk.io/rest';
const API_ORIGIN = 'https://api.snyk.io';
/** Snyk's page size for this endpoint defaults to 10 and caps at 100. */
const PAGE_SIZE = 100;
/**
 * A package with more issues than this has a dashboard problem, not a paging
 * problem. The cap is here so a malformed `links.next` can't loop forever.
 */
const MAX_PAGES = 20;
/** Snyk pins behaviour to the version sent on each request. */
const API_VERSION = '2024-10-15';
const ADVISORY_BASE = 'https://security.snyk.io/vuln';
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_DAYS = 7;
const DEFAULT_RETRY_AFTER_MS = 2_000;

/**
 * One purl is one request, and Snyk allows 160 a second and 1620 a minute per
 * principal. Six in flight against a ~200ms round trip is ~30/s, which fits the
 * per-minute budget; ten fits the per-second limit and blows the per-minute one
 * on a long enough run.
 */
const CONCURRENCY = 6;

/** Snyk grades on its own scale, keyed on Severity so a new level fails here. */
const SEVERITY_RANK: Record<Severity, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

interface CachedIssues {
    fetchedAt: number;
    issues: SnykIssue[];
}

/** The purl Snyk identifies a package version by, or undefined if it can't. */
export function buildPurl(ecosystem: string, name: string, version: string): string | undefined {
    const type = ECOSYSTEM_MAP[ecosystem];
    if (!type || !name || !version) return undefined;
    // Go module paths carry slashes belonging to the purl's namespace and Snyk
    // accepts them unescaped, so the name goes in as-is; the caller encodes the
    // whole purl for the URL path.
    return `pkg:${type}/${name}@${version}`;
}

function toSeverity(level: string | undefined): Severity | undefined {
    if (!level) return undefined;
    const lower = level.toLowerCase();
    return lower in SEVERITY_RANK ? (lower as Severity) : undefined;
}

function worstSeverity(levels: Array<Severity | undefined>): Severity | undefined {
    let worst: Severity | undefined;
    for (const level of levels) {
        if (!level) continue;
        if (!worst || SEVERITY_RANK[level] > SEVERITY_RANK[worst]) worst = level;
    }
    return worst;
}

/**
 * Snyk's own base score for an issue.
 *
 * Snyk publishes its score alongside NVD's and the distro vendors', and they
 * disagree often, so this takes Snyk's. Snyk then scores the same issue once per
 * CVSS version it supports and marks one `primary`, which is the one
 * `effective_severity_level` follows. Taking the maximum instead pairs a grade
 * with a score contradicting it: snyk 1.1291.0 reports primary 2.4 on CVSS 4.0
 * and secondary 7.2 on 3.1, and came out as "low, CVSS 7.2".
 */
function snykScore(issue: SnykIssue): number | undefined {
    const scored = (issue.attributes?.severities ?? []).filter((s) => typeof s.score === 'number');
    const snyk = scored.filter((s) => s.source === 'Snyk');
    return (snyk.find((s) => s.type === 'primary') ?? snyk[0] ?? scored[0])?.score;
}

/**
 * Every version Snyk says fixes an issue, one per release line it supports.
 * `upgrade_package` is comma-separated, so body-parser 1.20.1 comes back as
 * "1.20.6,2.3.0": patched on the 1.x line, and again on 2.x.
 */
function fixVersions(issue: SnykIssue): string[] {
    const versions: string[] = [];
    for (const coordinate of issue.attributes?.coordinates ?? []) {
        for (const remedy of coordinate.remedies ?? []) {
            for (const part of remedy.details?.upgrade_package?.split(',') ?? []) {
                const trimmed = part.trim();
                if (trimmed) versions.push(trimmed);
            }
        }
    }
    return versions;
}

/**
 * The release line a version belongs to: its major, or major.minor below 1.0,
 * where a minor bump is the breaking one.
 */
function releaseLine(version: string): string | undefined {
    const parts = parseVersion(version);
    if (!parts) return undefined;
    return parts[0] > 0 ? `${parts[0]}` : `0.${parts[1]}`;
}

/**
 * Whether `version` has the fix, given the versions that fix an advisory.
 *
 * Snyk lists one fix per release line it patched. A version on one of those
 * lines is fixed from that line's fix onward. A version on a line with no
 * listed fix is only fixed if it's newer than all of them, since a line in
 * between was left vulnerable.
 */
function hasFix(version: string, fixes: readonly string[]): boolean {
    const line = releaseLine(version);
    const sameLine = fixes.filter((f) => releaseLine(f) === line);
    if (sameLine.length > 0) {
        return sameLine.some((f) => (compareVersions(version, f) ?? -1) >= 0);
    }
    return fixes.every((f) => (compareVersions(version, f) ?? -1) > 0);
}

/**
 * The lowest version above `currentVersion` that fixes every advisory with a
 * known fix, picked from the fix versions themselves. Advisories with no fix
 * are left out, since no upgrade resolves them.
 */
export function lowestFixVersion(
    currentVersion: string,
    fixesPerAdvisory: ReadonlyArray<readonly string[]>,
): string | undefined {
    const fixable = fixesPerAdvisory.filter((fixes) => fixes.length > 0);
    if (fixable.length === 0) return undefined;
    const candidates = [...new Set(fixable.flat())]
        .filter((v) => (compareVersions(v, currentVersion) ?? -1) > 0)
        .sort((a, b) => compareVersions(a, b) ?? 0);
    return candidates.find((v) => fixable.every((fixes) => hasFix(v, fixes)));
}

/** Snyk's exploit-maturity verdict, the most actionable across the issues. */
function exploitMaturity(issues: SnykIssue[]): string | undefined {
    // Snyk marks one entry per scoring format as `primary`; the rest restate the
    // same verdict for older CVSS versions.
    const levels = issues
        .flatMap((i) => i.attributes?.slots?.exploit_details?.maturity_levels ?? [])
        .filter((m) => m.type === 'primary')
        .map((m) => m.level)
        .filter((l): l is string => Boolean(l) && l !== 'Not Defined');
    const order = ['Unproven', 'Proof of Concept', 'Functional', 'Mature'];
    let worst: string | undefined;
    for (const level of levels) {
        if (!worst || order.indexOf(level) > order.indexOf(worst)) worst = level;
    }
    return worst;
}

/**
 * One ID per issue that another source would recognise.
 *
 * Advisory counts are a union of `advisoryIds` across sources, so an issue has
 * to contribute exactly one ID or the count inflates, both by double-counting
 * what OSV already found and by counting an advisory's CVE and GHSA aliases as
 * two. GHSA comes first because that is what OSV and the GitHub Advisory
 * Database key on for npm. `GO` comes next for the Go advisories OSV keys on a
 * `GO-…` id instead, which gin 1.6.0 has one of with no GHSA beside it. Snyk's
 * own ID is the fallback for an issue with no public alias, which is the case
 * worth counting separately anyway.
 */
function crossSourceId(issue: SnykIssue): string {
    const problems = issue.attributes?.problems ?? [];
    for (const source of ['GHSA', 'GO', 'CVE']) {
        const alias = problems.find((p) => p.source === source && p.id);
        if (alias?.id) return alias.id;
    }
    return issue.id;
}

/**
 * Issues worst first, by Snyk's grade then its score.
 *
 * Columns label a cell with the worst severity and link the first entry they
 * find, so the order decides which advisory that label opens. Snyk returns its
 * own order, which is not severity order: gin 1.6.0 comes back with a medium
 * advisory ahead of its two highs, so a "High" cell linked to a medium.
 */
function worstFirst(issues: SnykIssue[]): SnykIssue[] {
    const rank = (issue: SnykIssue): number => {
        const severity = toSeverity(issue.attributes?.effective_severity_level);
        return severity ? SEVERITY_RANK[severity] : -1;
    };
    return [...issues].sort(
        (a, b) => rank(b) - rank(a) || (snykScore(b) ?? 0) - (snykScore(a) ?? 0),
    );
}

/**
 * One finding for a package version's Snyk issues. With the version, the
 * finding also names the lowest release that fixes them.
 */
export function toFinding(
    issues: SnykIssue[],
    currentVersion?: string,
): SecurityFinding | undefined {
    if (issues.length === 0) return undefined;

    const ordered = worstFirst(issues);
    const advisories: AdvisoryDetail[] = ordered.map((issue) => {
        const fixes = fixVersions(issue);
        return {
            id: issue.id,
            summary: issue.attributes?.title,
            severity: toSeverity(issue.attributes?.effective_severity_level),
            cvssScore: snykScore(issue),
            fixAvailable: fixes.length > 0,
            ...(fixes.length > 0 && { fixVersions: fixes }),
            url: `${ADVISORY_BASE}/${encodeURIComponent(issue.id)}`,
        };
    });
    const fixVersion = currentVersion
        ? lowestFixVersion(
              currentVersion,
              advisories.map((a) => a.fixVersions ?? []),
          )
        : undefined;

    const scores = advisories
        .map((a) => a.cvssScore)
        .filter((s): s is number => typeof s === 'number');
    const fixAvailable = advisories.some((a) => a.fixAvailable);
    const maturity = exploitMaturity(ordered);

    const rationale = [
        ordered.length === 1
            ? `1 Snyk advisory (${ordered[0]?.id})`
            : `${ordered.length} Snyk advisories`,
    ];
    if (maturity) rationale.push(`Snyk exploit maturity: ${maturity}`);
    if (fixAvailable) rationale.push('fix available in a newer version');

    return {
        source: 'snyk',
        sourceLabel: 'Snyk',
        severity: worstSeverity(advisories.map((a) => a.severity)),
        cvssScore: scores.length > 0 ? Math.max(...scores) : undefined,
        advisories,
        advisoryIds: [...new Set(ordered.map(crossSourceId))],
        advisoryCount: ordered.length,
        fixAvailable,
        ...(fixVersion && { fixVersion }),
        rationale,
        sourceLinks: ordered.map((issue) => ({
            label: issue.id,
            url: `${ADVISORY_BASE}/${encodeURIComponent(issue.id)}`,
        })),
    };
}

export class SnykSource implements DataSource {
    readonly name = 'snyk';
    readonly dependsOn: readonly string[] = [];

    private readonly orgId: string;
    private readonly cacheTtlMs: number;
    private cacheService: CacheService | undefined;

    constructor(config: SnykConfig) {
        this.orgId = config.orgId;
        this.cacheTtlMs = (config.cacheTtlDays ?? DEFAULT_CACHE_TTL_DAYS) * 24 * 60 * 60 * 1000;
    }

    setCacheService(cs: CacheService): void {
        this.cacheService = cs;
    }

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const token = process.env.SNYK_API_TOKEN;
        if (!token) {
            process.stderr.write('Snyk: SNYK_API_TOKEN is unset, skipping Snyk lookups\n');
            return;
        }

        const targets: Array<{ dep: DirectDependency; version: string; purl: string }> = [];
        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const purl = buildPurl(dep.ecosystem, dep.name, ver.version);
                if (purl) targets.push({ dep, version: ver.version, purl });
            }
        }

        if (targets.length === 0) {
            process.stderr.write('Snyk: no dependencies in an ecosystem Snyk covers\n');
            return;
        }

        process.stderr.write(`Snyk: querying ${targets.length} package versions...\n`);

        let withIssues = 0;
        let failed = 0;

        for (let i = 0; i < targets.length; i += CONCURRENCY) {
            const batch = targets.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
                batch.map(async (target) => ({
                    target,
                    issues: await this.fetchIssues(target.purl, token),
                })),
            );

            for (const { target, issues } of results) {
                if (issues === undefined) {
                    failed++;
                    continue;
                }
                const finding = toFinding(issues, target.version);
                if (!finding) continue;
                withIssues++;

                const scoped = store.scoped(target.dep.ecosystem);
                const existing =
                    scoped.getVersionFact<SecurityFinding[]>(
                        target.dep.name,
                        target.version,
                        SECURITY_FINDINGS_KEY,
                    ) ?? [];
                scoped.setVersionFact(target.dep.name, target.version, SECURITY_FINDINGS_KEY, [
                    ...existing,
                    finding,
                ]);
            }
        }

        const failures = failed > 0 ? `, ${failed} lookups failed` : '';
        process.stderr.write(
            `Snyk: enriched ${withIssues} of ${targets.length} package versions${failures}\n`,
        );
    }

    /**
     * Snyk's issues for one purl, or undefined when the lookup failed.
     *
     * An empty array and a failure are different facts: the first means Snyk
     * knows of no issues, the second means we don't know. Returning undefined
     * for a failure keeps a rate-limited or timed-out run from reporting those
     * versions as clean.
     */
    private async fetchIssues(purl: string, token: string): Promise<SnykIssue[] | undefined> {
        const cacheKey = `snyk-issues-${purl.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

        const cached = await this.readCache(cacheKey);
        if (cached) return cached;

        // Every page of them. Snyk defaults to 10 issues a page, so a busy
        // package answers the first request with a `links.next` and nothing
        // else; keeping only that page files most of its advisories as absent.
        const issues: SnykIssue[] = [];
        let url =
            `${API_BASE}/orgs/${encodeURIComponent(this.orgId)}` +
            `/packages/${encodeURIComponent(purl)}/issues` +
            `?version=${API_VERSION}&limit=${PAGE_SIZE}`;

        for (let page = 0; page < MAX_PAGES; page++) {
            const body = await this.fetchPage(url, purl, token);
            if (!body) return undefined;
            issues.push(...(body.data ?? []));

            const next = body.links?.next;
            if (!next) break;
            // Snyk returns a path, and has returned a full URL before. `URL`
            // resolves either against the origin, so neither needs special
            // casing.
            url = new URL(next, API_ORIGIN).toString();
        }

        if (this.cacheService) {
            const envelope: CachedIssues = { fetchedAt: Date.now(), issues };
            await this.cacheService.writePermanentCache(cacheKey, JSON.stringify(envelope));
        }

        return issues;
    }

    /**
     * The cached issues for this key, or undefined to go to the network.
     *
     * A cache entry that won't parse is treated as a miss. It used to throw
     * from inside the batch's `Promise.all`, which failed the whole run and
     * left every later package version unqueried.
     */
    private async readCache(cacheKey: string): Promise<SnykIssue[] | undefined> {
        if (!this.cacheService) return undefined;
        const raw = await this.cacheService.readPermanentCache(cacheKey);
        if (!raw) return undefined;
        try {
            const cached = JSON.parse(raw) as CachedIssues;
            if (Date.now() - cached.fetchedAt < this.cacheTtlMs) return cached.issues;
        } catch {
            // Fall through to the network and overwrite it.
        }
        return undefined;
    }

    /** One page of issues, or undefined when the lookup failed. */
    private async fetchPage(
        url: string,
        purl: string,
        token: string,
    ): Promise<SnykIssuesResponse | undefined> {
        // One retry: the only error worth retrying is a 429, and Snyk says how
        // long to wait. Anything else is reported and skipped.
        let response = await this.request(url, purl, token);
        if (response?.status === 429) {
            const retryAfter = Number(response.headers.get('retry-after'));
            await new Promise((resolve) =>
                setTimeout(
                    resolve,
                    Number.isFinite(retryAfter) && retryAfter > 0
                        ? retryAfter * 1000
                        : DEFAULT_RETRY_AFTER_MS,
                ),
            );
            response = await this.request(url, purl, token);
        }

        if (!response) return undefined;
        if (!response.ok) {
            process.stderr.write(
                `Snyk: ${purl} lookup failed: ${response.status} ${response.statusText}\n`,
            );
            return undefined;
        }

        try {
            return (await response.json()) as SnykIssuesResponse;
        } catch (error) {
            // A truncated or non-JSON body is one failed lookup, not a failed
            // run: throwing here would unwind the whole batch.
            process.stderr.write(`Snyk: ${purl} returned an unreadable body: ${error}\n`);
            return undefined;
        }
    }

    private async request(url: string, purl: string, token: string): Promise<Response | undefined> {
        try {
            return await fetch(url, {
                headers: {
                    authorization: `token ${token}`,
                    accept: 'application/vnd.api+json',
                },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
        } catch (error) {
            process.stderr.write(`Snyk: ${purl} lookup failed: ${error}\n`);
            return undefined;
        }
    }
}
