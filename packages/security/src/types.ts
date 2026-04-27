// ── Fact keys ───────────────────────────────────────────────────────

/** Fact key for the array of security findings on a dependency version. */
export const SECURITY_FINDINGS_KEY = 'security:findings';

// ── Severity ────────────────────────────────────────────────────────

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Canonical ordering from least to most severe. */
export const SEVERITY_ORDER: readonly Severity[] = ['none', 'low', 'medium', 'high', 'critical'];

export type Maintenance = 'active' | 'stale' | 'unknown';

// ── Security finding ────────────────────────────────────────────────

export interface AdvisoryDetail {
    id: string;
    summary?: string;
    severity?: Severity;
    cvssScore?: number;
    fixAvailable?: boolean;
    url: string;
}

export interface SecurityFinding {
    source: string;
    sourceLabel: string;
    severity?: Severity;
    /** Highest CVSS base score across advisories (0.0–10.0). */
    cvssScore?: number;
    /** Per-advisory details for inline rendering in tickets. */
    advisories?: AdvisoryDetail[];
    /** Advisory IDs (GHSA-xxxx, CVE-xxxx) for cross-source deduplication. */
    advisoryIds?: string[];
    advisoryCount?: number;
    fixAvailable?: boolean;
    maintenance?: Maintenance;
    rationale?: string[];
    sourceLinks?: { label: string; url: string }[];
}

// ── Plugin config ───────────────────────────────────────────────────

export interface OsvConfig {
    /** Override the batch size for OSV API queries. Default: 1000. */
    batchSize?: number;
    /** How many days to cache individual vulnerability details. Default: 7. */
    vulnCacheTtlDays?: number;
}

export interface DepsDevConfig {
    /** Include transitive dependency counts (extra API call per package). Default: true. */
    includeDependencies?: boolean;
    /** Cache TTL in days. Default: 7. */
    cacheTtlDays?: number;
}

export interface GitHubAdvisoryConfig {
    /** Cache TTL in days. Default: 7. */
    cacheTtlDays?: number;
}

export interface SecurityPluginConfig {
    /** Enable OSV.dev vulnerability lookups. Pass `true` for defaults. */
    osv?: boolean | OsvConfig;
    /** Enable deps.dev maintenance/ecosystem context. Pass `true` for defaults. */
    depsdev?: boolean | DepsDevConfig;
    /** Enable GitHub Advisory vulnerability lookups. Pass `true` for defaults. */
    githubAdvisory?: boolean | GitHubAdvisoryConfig;
}
