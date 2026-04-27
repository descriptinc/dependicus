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
import type { SecurityPluginConfig, SecurityFinding, Severity } from './types';
import { SECURITY_FINDINGS_KEY, SEVERITY_ORDER } from './types';
import { OsvSource } from './sources/OsvSource';

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
            if (source instanceof OsvSource) {
                source.setCacheService(ctx.cacheService);
            }
        }
    }

    // ── Source construction ─────────────────────────────────────────

    private buildSources(): DataSource[] {
        const sources: DataSource[] = [];
        if (this.config.osv) {
            const osvConfig = typeof this.config.osv === 'object' ? this.config.osv : undefined;
            sources.push(new OsvSource(osvConfig));
        }
        return sources;
    }

    // ── Columns ────────────────────────────────────────────────────

    private buildColumns(): CustomColumn[] {
        return [
            {
                key: 'security',
                header: 'Sec',
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
                        return `<a href="${escapeAttr(firstLink.url)}" target="_blank" rel="noopener">${label}</a>`;
                    }
                    return label;
                },
                getFilterValue: (ctx) => {
                    const merged = this.mergeFindings(ctx);
                    return merged.severity ?? '';
                },
                getTooltip: (ctx) => {
                    const findings = getFindings(ctx);
                    if (findings.length === 0) return '';
                    return findings.map((f) => f.sourceLabel).join(', ');
                },
            },
            {
                key: 'securityFix',
                header: 'Fix',
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
                            .map(
                                (l) =>
                                    `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`,
                            )
                            .join(', ');
                        parts.push(linkedIds);
                    }
                    for (const r of merged.rationale) {
                        if (!r.match(/^\d+ advisor/)) parts.push(escapeHtml(r));
                    }
                    return parts.join('; ');
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
            summaryLines.push(`- Severity: **${merged.severity}**`);
        }
        if (merged.advisoryCount > 0) {
            summaryLines.push(`- Advisories: ${merged.advisoryCount}`);
        }
        summaryLines.push(`- Fix available: ${merged.fixAvailable ? 'yes' : 'no'}`);
        sections.push({ title: 'Security summary', body: summaryLines.join('\n') });

        // Why this matters
        if (merged.rationale.length > 0) {
            sections.push({
                title: 'Why this matters',
                body: merged.rationale.join('. ') + '.',
            });
        }

        // Sources
        const allLinks = findings.flatMap((f) => f.sourceLinks ?? []);
        if (allLinks.length > 0) {
            const sourceLines = allLinks.map((l) => `- [${l.label}](${l.url})`);
            sections.push({ title: 'Sources', body: sourceLines.join('\n') });
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

interface MergedFindings {
    severity: Severity | undefined;
    advisoryCount: number;
    fixAvailable: boolean;
    rationale: string[];
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
        return { severity: undefined, advisoryCount: 0, fixAvailable: false, rationale: [] };
    }

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

    const totalAdvisories = findings.reduce((sum, f) => sum + (f.advisoryCount ?? 0), 0);
    const anyFix = findings.some((f) => f.fixAvailable);
    const allRationale = findings.flatMap((f) => f.rationale ?? []);

    return {
        severity: worstSeverity,
        advisoryCount: totalAdvisories,
        fixAvailable: anyFix,
        rationale: allRationale,
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
