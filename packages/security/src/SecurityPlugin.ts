import type {
    DataSource,
    FactStore,
    GroupingDetailContext,
    GroupingSection,
    PluginContext,
} from '@dependicus/core';
import type { ColumnContext, CustomColumn } from '@dependicus/site-builder';
import type { VersionContext, LinearIssueSpec } from '@dependicus/linear';
import type { GitHubIssueSpec } from '@dependicus/github-issues';
import type { VersionContext as GitHubVersionContext } from '@dependicus/github-issues';
import type { SecurityPluginConfig, SecurityFinding, Severity, Maintenance } from './types';
import { SECURITY_FINDINGS_KEY, SEVERITY_ORDER } from './types';
import { OsvSource } from './sources/OsvSource';
import { DepsDevSource } from './sources/DepsDevSource';
import { GitHubAdvisorySource } from './sources/GitHubAdvisorySource';

// ── DependicusPlugin implementation ─────────────────────────────────

export class SecurityPlugin {
    readonly name = 'security';
    readonly sources: DataSource[];
    readonly columns: CustomColumn[];

    constructor(private readonly config: SecurityPluginConfig) {
        this.sources = this.buildSources();
        this.columns = this.buildColumns();
    }

    // ── Lifecycle ──────────────────────────────────────────────────

    init(ctx: PluginContext): void {
        for (const source of this.sources) {
            if ('setCacheService' in source && typeof source.setCacheService === 'function') {
                (
                    source as { setCacheService: (cs: PluginContext['cacheService']) => void }
                ).setCacheService(ctx.cacheService);
            }
        }
    }

    // ── Source construction ─────────────────────────────────────────

    private buildSources(): DataSource[] {
        const sources: DataSource[] = [];
        if (this.config.osv) {
            const c = typeof this.config.osv === 'object' ? this.config.osv : undefined;
            sources.push(new OsvSource(c));
        }
        if (this.config.depsdev) {
            const c = typeof this.config.depsdev === 'object' ? this.config.depsdev : undefined;
            sources.push(new DepsDevSource(c));
        }
        if (this.config.githubAdvisory) {
            const c =
                typeof this.config.githubAdvisory === 'object'
                    ? this.config.githubAdvisory
                    : undefined;
            sources.push(new GitHubAdvisorySource(c));
        }
        return sources;
    }

    // ── Columns ────────────────────────────────────────────────────

    private buildColumns(): CustomColumn[] {
        return [
            {
                key: 'security',
                header: 'Severity',
                width: 100,
                filter: 'list',
                filterValues: SEVERITY_LABELS,
                getValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    if (!merged.severity) return '';
                    const label = SEVERITY_LABELS[merged.severity] ?? '';
                    const findings = getFindings(ctx);
                    const firstLink = findings.flatMap((f) => f.sourceLinks ?? [])[0];
                    if (firstLink) {
                        return `<a href="${escapeAttr(firstLink.url)}">${label}</a>`;
                    }
                    return label;
                },
                getFilterValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    return merged.severity ?? '';
                },
                getTooltip: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    if (!merged.severity) return '';
                    const findings = getFindings(ctx);
                    const vulnSources = [
                        ...new Set(findings.filter((f) => f.severity).map((f) => f.sourceLabel)),
                    ].join(', ');
                    if (merged.cvssScore !== undefined) {
                        return `CVSS ${merged.cvssScore.toFixed(1)} (${vulnSources})`;
                    }
                    return vulnSources;
                },
            },
            {
                key: 'securityFix',
                header: 'Fix Available',
                width: 70,
                filter: 'list',
                filterValues: { true: 'Yes', false: 'No' },
                getValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    if (merged.advisoryCount === 0) return '';
                    return merged.fixAvailable ? 'Yes' : 'No';
                },
                getFilterValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    if (merged.advisoryCount === 0) return '';
                    return String(merged.fixAvailable ?? false);
                },
            },
            {
                key: 'securityWhy',
                header: 'Security',
                width: 280,
                filter: 'input',
                getValue: (ctx) => {
                    const findings = getFindings(ctx);
                    if (findings.length === 0) return '';
                    const allLinks = findings.flatMap((f) => f.sourceLinks ?? []);
                    const merged = this.mergeFindings(ctx);
                    const parts: string[] = [];
                    if (allLinks.length > 0) {
                        const linkedIds = allLinks
                            .map((l) => `<a href="${escapeAttr(l.url)}">${escapeHtml(l.label)}</a>`)
                            .join(', ');
                        parts.push(linkedIds);
                    }
                    for (const r of merged.rationale) {
                        if (!r.match(/^\d+ (?:advisor|GitHub advisor)/)) parts.push(escapeHtml(r));
                    }
                    return parts.join('; ');
                },
            },
            {
                key: 'maintenance',
                header: 'Deprecated',
                width: 100,
                filter: 'list',
                filterValues: MAINTENANCE_LABELS,
                getValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    if (merged.maintenance !== 'stale') return '';
                    return 'Stale';
                },
                getFilterValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    return merged.maintenance ?? '';
                },
            },
        ];
    }

    // ── Sections (for grouping detail pages) ───────────────────────

    getSections = (ctx: GroupingDetailContext): GroupingSection[] => {
        const { dependencies, store } = ctx;
        let withAdvisories = 0;
        let withFixes = 0;
        let clean = 0;

        for (const dep of dependencies) {
            for (const ver of dep.versions) {
                const scoped = store.scoped(dep.ecosystem);
                const findings =
                    scoped.getVersionFact<SecurityFinding[]>(
                        dep.name,
                        ver.version,
                        SECURITY_FINDINGS_KEY,
                    ) ?? [];
                if (findings.length === 0) {
                    clean++;
                } else {
                    withAdvisories++;
                    if (findings.some((f) => f.fixAvailable)) withFixes++;
                }
            }
        }

        if (withAdvisories === 0 && clean === 0) return [];

        return [
            {
                title: 'Security',
                stats: [
                    { label: 'With advisories', value: withAdvisories },
                    { label: 'Fix available', value: withFixes },
                    { label: 'Clean', value: clean },
                ],
            },
        ];
    };

    // ── Linear issue spec ──────────────────────────────────────────

    getLinearIssueSpec = (
        context: VersionContext,
        store: FactStore,
    ): Partial<LinearIssueSpec> | undefined => {
        const findings =
            store.getVersionFact<SecurityFinding[]>(
                context.name,
                context.currentVersion,
                SECURITY_FINDINGS_KEY,
            ) ?? [];

        if (findings.length === 0) return undefined;

        const merged = mergeFindingsFromArray(findings);
        return {
            descriptionSections: this.buildDescriptionSections(merged, findings),
        };
    };

    // ── GitHub issue spec ──────────────────────────────────────────

    getGitHubIssueSpec = (
        context: GitHubVersionContext,
        store: FactStore,
    ): Partial<GitHubIssueSpec> | undefined => {
        const findings =
            store.getVersionFact<SecurityFinding[]>(
                context.name,
                context.currentVersion,
                SECURITY_FINDINGS_KEY,
            ) ?? [];

        if (findings.length === 0) return undefined;

        const merged = mergeFindingsFromArray(findings);
        return {
            descriptionSections: this.buildDescriptionSections(merged, findings),
        };
    };

    // ── Private helpers ────────────────────────────────────────────

    private mergeFindings(ctx: ColumnContext): MergedFindings {
        const findings = getFindings(ctx);
        return mergeFindingsFromArray(findings);
    }

    private buildDescriptionSections(
        merged: MergedFindings,
        findings: SecurityFinding[],
    ): Array<{ title: string; body: string }> {
        const sections: Array<{ title: string; body: string }> = [];

        // Security summary
        const summaryLines: string[] = [];
        if (merged.severity) {
            const scoreSuffix =
                merged.cvssScore !== undefined ? ` (CVSS ${merged.cvssScore.toFixed(1)})` : '';
            summaryLines.push(`- Severity: **${merged.severity}**${scoreSuffix}`);
        }
        if (merged.advisoryCount > 0) {
            summaryLines.push(`- Advisories: ${merged.advisoryCount}`);
        }
        summaryLines.push(`- Fix available: ${merged.fixAvailable ? 'yes' : 'no'}`);
        if (merged.maintenance) {
            summaryLines.push(`- Maintenance posture: ${merged.maintenance}`);
        }
        sections.push({ title: 'Security summary', body: summaryLines.join('\n') });

        // Advisories (deduplicated across sources, with inline summaries)
        const allAdvisories = findings.flatMap((f) => f.advisories ?? []);
        if (allAdvisories.length > 0) {
            const seen = new Set<string>();
            const lines: string[] = [];
            for (const a of allAdvisories) {
                if (seen.has(a.id)) continue;
                seen.add(a.id);
                const parts: string[] = [`[${a.id}](${a.url})`];
                if (a.severity) {
                    const score = a.cvssScore !== undefined ? ` ${a.cvssScore.toFixed(1)}` : '';
                    parts.push(`${a.severity}${score}`);
                }
                if (a.fixAvailable) parts.push('fix available');
                const line = parts.join(' · ');
                const summary = a.summary ? `: ${a.summary}` : '';
                lines.push(`- ${line}${summary}`);
            }
            sections.push({ title: 'Advisories', body: lines.join('\n') });
        }

        // Why this matters (non-advisory rationale only)
        const nonAdvisoryRationale = merged.rationale.filter(
            (r) => !r.match(/^\d+ (?:advisor|GitHub advisor)/),
        );
        if (nonAdvisoryRationale.length > 0) {
            sections.push({
                title: 'Why this matters',
                body: nonAdvisoryRationale.join('. ') + '.',
            });
        }

        return sections;
    }
}

// ── Shared helpers ──────────────────────────────────────────────────

const SEVERITY_LABELS: Record<string, string> = {
    none: 'None',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
};

const MAINTENANCE_LABELS: Record<string, string> = {
    active: 'Active',
    stale: 'Stale',
    unknown: 'Unknown',
};

interface MergedFindings {
    severity: Severity | undefined;
    cvssScore: number | undefined;
    advisoryCount: number;
    fixAvailable: boolean;
    maintenance: Maintenance | undefined;
    rationale: string[];
    /** Comma-separated source labels (e.g. "OSV, deps.dev"). */
    sources: string;
}

function getFindings(ctx: ColumnContext): SecurityFinding[] {
    return (
        ctx.store.getVersionFact<SecurityFinding[]>(
            ctx.name,
            ctx.version.version,
            SECURITY_FINDINGS_KEY,
        ) ?? []
    );
}

function mergeFindingsFromArray(findings: SecurityFinding[]): MergedFindings {
    if (findings.length === 0) {
        return {
            severity: undefined,
            cvssScore: undefined,
            advisoryCount: 0,
            fixAvailable: false,
            maintenance: undefined,
            rationale: [],
            sources: '',
        };
    }

    // Worst severity
    const severities = findings
        .map((f) => f.severity)
        .filter((s): s is Severity => s !== undefined);
    let worstSeverity: Severity | undefined;
    if (severities.length > 0) {
        let worst = 0;
        for (const s of severities) {
            const idx = SEVERITY_ORDER.indexOf(s);
            if (idx > worst) worst = idx;
        }
        worstSeverity = SEVERITY_ORDER[worst];
    }

    // Highest CVSS score
    const scores = findings.map((f) => f.cvssScore).filter((s): s is number => s !== undefined);
    const worstScore = scores.length > 0 ? Math.max(...scores) : undefined;

    // Deduplicated advisory count: union of advisoryIds across all sources
    const allIds = findings.flatMap((f) => f.advisoryIds ?? []);
    const uniqueIds = new Set(allIds);
    const advisoryCount =
        uniqueIds.size > 0
            ? uniqueIds.size
            : findings.reduce((sum, f) => sum + (f.advisoryCount ?? 0), 0);

    const anyFix = findings.some((f) => f.fixAvailable);

    // Worst maintenance posture (stale > unknown > active)
    const maintenanceOrder: Maintenance[] = ['active', 'unknown', 'stale'];
    const maintenances = findings
        .map((f) => f.maintenance)
        .filter((m): m is Maintenance => m !== undefined);
    let maintenance: Maintenance | undefined;
    if (maintenances.length > 0) {
        let worst = 0;
        for (const m of maintenances) {
            const idx = maintenanceOrder.indexOf(m);
            if (idx > worst) worst = idx;
        }
        maintenance = maintenanceOrder[worst];
    }

    const allRationale = findings.flatMap((f) => f.rationale ?? []);
    const sources = [...new Set(findings.map((f) => f.sourceLabel))].join(', ');

    return {
        severity: worstSeverity,
        cvssScore: worstScore,
        advisoryCount,
        fixAvailable: anyFix,
        maintenance,
        rationale: allRationale,
        sources,
    };
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
