// ── Fact keys ───────────────────────────────────────────────────────

/** Fact key for the array of security findings on a dependency version. */
export const SECURITY_FINDINGS_KEY = 'security:findings';

// ── Severity ────────────────────────────────────────────────────────

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Canonical ordering from least to most severe. */
export const SEVERITY_ORDER: readonly Severity[] = ['none', 'low', 'medium', 'high', 'critical'];

// ── Security finding ────────────────────────────────────────────────

export interface SecurityFinding {
    source: string;
    sourceLabel: string;
    severity?: Severity;
    advisoryCount?: number;
    fixAvailable?: boolean;
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

export interface SecurityPluginConfig {
    /** Enable OSV.dev vulnerability lookups. Pass `true` for defaults. */
    osv?: boolean | OsvConfig;
}
