import type { DataSource } from '@dependicus/core';

// ── Fact keys ───────────────────────────────────────────────────────

/** Fact key for the array of security findings on a dependency version. */
export const SECURITY_FINDINGS_KEY = 'security:findings';

// ── Security finding ────────────────────────────────────────────────

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

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
}

export interface SecurityPluginConfig {
    /** Enable OSV.dev vulnerability lookups. Pass `true` for defaults. */
    osv?: boolean | OsvConfig;
}

// ── Source factory contract ─────────────────────────────────────────

export type SecuritySourceFactory = (config: SecurityPluginConfig) => DataSource | undefined;
