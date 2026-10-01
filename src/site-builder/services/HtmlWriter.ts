import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { getCssContent } from '../paths';
import type {
    ColumnContext,
    DetailPage,
    DirectDependency,
    DependencyVersion,
    GitHubRelease,
    GitHubData,
    PackageVersionInfo,
    DependencyDetailContext,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    ProviderOutput,
    UsedByGroupKeyFn,
    UsedByGroupsFn,
    FactStore,
} from '../../core/index';
import {
    mergeProviderDependencies,
    getDetailFilename,
    getGroupingFilename,
} from '../../core/index';
import {
    FactKeys,
    formatDate,
    formatAgeHuman,
    getAgeDays,
    getVersionsBehind,
    formatBytes,
    formatSizeChange,
    findReleaseForVersion,
    detectTagFormat,
    resolveUrl,
    resolveUrlPatterns,
} from '../../core/index';
import { TemplateService } from './TemplateService';
import type { BrowserColumnDef } from '../../site-frontend/index';
import getBrowserBundle from '../../site-frontend/browser-bundle';

interface GroupStats {
    totalDependencies: number;
    outdatedCount: number;
    catalogCount: number;
}

/**
 * Definition of a custom column that maps FactStore data to a table column.
 *
 * Several properties correspond directly to Tabulator column definition options.
 * See the [Tabulator column docs](https://tabulator.info/docs/6.3/columns) for details.
 *
 * @group Plugins
 */
export interface CustomColumn {
    /**
     * Unique key used as the column
     * [`field`](https://tabulator.info/docs/6.3/columns#definition) in row data.
     */
    key: string;
    /**
     * Column header display text.
     * Maps to Tabulator's [`title`](https://tabulator.info/docs/6.3/columns#definition).
     */
    header: string;
    /** Extract the display value from the store. */
    getValue: (ctx: ColumnContext) => string;
    /**
     * Column width in pixels.
     * Maps to Tabulator's [`width`](https://tabulator.info/docs/6.3/columns#width).
     */
    width?: number;
    /**
     * Filter type for the column header.
     * Maps to Tabulator's [`headerFilter`](https://tabulator.info/docs/6.3/filter#header).
     */
    filter?: 'input' | 'list';
    /**
     * Predefined filter values for `'list'` filter (id to display name).
     * Maps to Tabulator's [`headerFilterParams.values`](https://tabulator.info/docs/6.3/filter#header).
     */
    filterValues?: Record<string, string>;
    /**
     * Extract a tooltip string.
     * Maps to Tabulator's [`tooltip`](https://tabulator.info/docs/6.3/columns#tooltip).
     */
    getTooltip?: (ctx: ColumnContext) => string;
    /**
     * Extract a separate filter value.
     * When set, header filter matches against this value instead of the display value.
     * Implemented via a custom [`headerFilterFunc`](https://tabulator.info/docs/6.3/filter#header-function).
     */
    getFilterValue?: (ctx: ColumnContext) => string;
}

export interface HtmlWriterOptions {
    groupings?: GroupingConfig[];
    columns?: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getUsedByGroups?: UsedByGroupsFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
    getDependencySections?: (ctx: DependencyDetailContext) => GroupingSection[];
    siteName?: string;
}

/**
 * Strip well-known hosting prefixes from Go module paths for display.
 * e.g. "github.com/gorilla/mux" → "gorilla/mux"
 */
function shortenModulePath(name: string, ecosystem: string): string {
    if (ecosystem !== 'gomod') return name;
    return name.replace(/^(?:github\.com|gitlab\.com|bitbucket\.org)\//, '');
}

/**
 * Ecosystem identifiers as a reader would name them. A rollup page spanning
 * several of them is easier to scan under "Go" and "npm" than under "gomod"
 * and "npm".
 */
const ECOSYSTEM_LABELS: Record<string, string> = {
    npm: 'npm',
    gomod: 'Go',
    pypi: 'Python',
    cargo: 'Rust',
    mise: 'mise',
};

function ecosystemLabel(ecosystem: string): string {
    return ECOSYSTEM_LABELS[ecosystem] ?? ecosystem;
}

export class HtmlWriter {
    private templateService: TemplateService;
    private groupings: GroupingConfig[];
    private columns: CustomColumn[];
    private getUsedByGroupKey: UsedByGroupKeyFn | undefined;
    private getUsedByGroups: UsedByGroupsFn | undefined;
    /** Ecosystem -> the provider directory that holds its detail pages. */
    private providerDirs = new Map<string, string>();
    private getSections: ((ctx: GroupingDetailContext) => GroupingSection[]) | undefined;
    private getDependencySections:
        | ((ctx: DependencyDetailContext) => GroupingSection[])
        | undefined;
    private siteName: string;

    constructor(options?: HtmlWriterOptions) {
        this.templateService = new TemplateService();
        this.groupings = options?.groupings ?? [];
        this.columns = options?.columns ?? [];
        this.getUsedByGroupKey = options?.getUsedByGroupKey;
        this.getUsedByGroups = options?.getUsedByGroups;
        this.getSections = options?.getSections;
        this.getDependencySections = options?.getDependencySections;
        this.siteName = options?.siteName ?? 'Dependicus';
    }

    /** Groupings that apply to an ecosystem. Undefined means don't filter. */
    private groupingsFor(ecosystem?: string): GroupingConfig[] {
        if (ecosystem === undefined) return this.groupings;
        return this.groupings.filter((g) => !g.ecosystems || g.ecosystems.includes(ecosystem));
    }

    /** Remember which provider directory holds each ecosystem's detail pages. */
    private rememberProviderDirs(providers: ProviderOutput[]): void {
        this.providerDirs = new Map();
        for (const provider of providers) {
            if (!this.providerDirs.has(provider.ecosystem)) {
                this.providerDirs.set(provider.ecosystem, provider.name);
            }
        }
    }

    /** A grouping that names no ecosystems covers them all, on one page tree. */
    private isMerged(grouping: GroupingConfig): boolean {
        return !grouping.ecosystems;
    }

    /**
     * Nav entries for the groupings a page should link to.
     *
     * Groupings that span every ecosystem live at the site root, so they are
     * reachable from any page. One restricted to an ecosystem lives under a
     * provider, so link to the current provider when it matches and to the
     * first provider that does otherwise.
     */
    private navGroupings(
        ecosystem: string | undefined,
        providerPrefix: string,
    ): Array<{ label: string; slug: string; prefix: string }> {
        return this.groupingsFor(ecosystem).map((g) => ({
            label: g.label,
            slug: g.slugPrefix ?? g.key,
            prefix: this.isMerged(g) ? '' : this.restrictedPrefix(g, ecosystem, providerPrefix),
        }));
    }

    private restrictedPrefix(
        grouping: GroupingConfig,
        ecosystem: string | undefined,
        providerPrefix: string,
    ): string {
        if (ecosystem && grouping.ecosystems?.includes(ecosystem)) return providerPrefix;
        for (const candidate of grouping.ecosystems ?? []) {
            const dir = this.providerDirs.get(candidate);
            if (dir) return `${dir}/`;
        }
        return providerPrefix;
    }

    /**
     * Work out the "Used By" cell: who to list, and how to group them.
     *
     * `getUsedByGroups` decides both, so the listed consumers come from the
     * groups rather than the dependency's own list. That keeps sorting and
     * filtering on the flat column consistent with the pills on screen.
     * `getUsedByGroupKey` only labels the set, so the consumers are unchanged.
     */
    private usedByCells(
        packages: string[],
        ctx: ColumnContext,
    ): { usedBy: string[]; grouped: Record<string, string[]> | null } {
        if (this.getUsedByGroups) {
            const grouped: Record<string, string[]> = {};
            for (const [label, members] of Object.entries(this.getUsedByGroups(ctx))) {
                if (members.length > 0) grouped[label] = [...members].sort();
            }
            if (Object.keys(grouped).length > 0) {
                const listed = [...new Set(Object.values(grouped).flat())].sort();
                return { usedBy: listed, grouped };
            }
        }
        return { usedBy: packages, grouped: this.groupDependenciesByMeta(packages, ctx) };
    }

    /**
     * Group dependencies by a key derived from the FactStore.
     */
    private groupDependenciesByMeta(
        packages: string[],
        ctx: ColumnContext,
    ): Record<string, string[]> | null {
        // eslint-disable-next-line no-null/no-null
        if (!this.getUsedByGroupKey) return null;
        const groupKey = this.getUsedByGroupKey(ctx) || 'Unknown';
        return { [groupKey]: [...packages].sort() };
    }

    /**
     * Build row data for custom columns from FactStore.
     */
    private buildCustomColumnData(ctx: ColumnContext): Record<string, string> {
        const data: Record<string, string> = {};
        for (const col of this.columns) {
            data[col.key] = col.getValue(ctx);
            if (col.getTooltip) {
                data[`${col.key}__tooltip`] = col.getTooltip(ctx);
            }
            if (col.getFilterValue) {
                data[`${col.key}__filterValue`] = col.getFilterValue(ctx);
            }
        }
        return data;
    }

    /**
     * Compose notes string from boolean FactStore facts.
     */
    private composeNotes(name: string, version: string, store: FactStore): string {
        const parts: string[] = [];
        if (store.getVersionFact<boolean>(name, version, FactKeys.IS_PATCHED)) {
            parts.push('Patched');
        }
        if (store.getVersionFact<boolean>(name, version, FactKeys.IS_FORKED)) {
            parts.push('Forked');
        }
        if (store.getVersionFact<boolean>(name, version, FactKeys.HAS_CATALOG_MISMATCH)) {
            parts.push('Catalog Mismatch');
        }
        if (store.getVersionFact<boolean>(name, version, FactKeys.IS_DEPRECATED)) {
            parts.push('Deprecated');
        }
        return parts.join(', ');
    }

    /**
     * Get bundled browser-side JavaScript code.
     */
    private async bundleBrowserCode(): Promise<string> {
        return getBrowserBundle();
    }

    /**
     * Read bundled CSS (open-props + styles.css)
     */
    private readCssFile(): Promise<string> {
        return getCssContent();
    }

    /**
     * Build row data from a list of dependencies.
     * Each row corresponds to a single dependency@version entry.
     */
    private buildRows(
        deps: DirectDependency[],
        store: FactStore,
        detailPrefix: string,
    ): Array<
        Record<string, string | number | boolean | string[] | Record<string, string[]> | null>
    > {
        const rows: Array<
            Record<string, string | number | boolean | string[] | Record<string, string[]> | null>
        > = [];
        for (const dep of deps) {
            const scoped = store.scoped(dep.ecosystem);
            for (const versionInfo of dep.versions) {
                const detailFilename = getDetailFilename(dep.name, versionInfo.version);
                const deprecatedTransitiveDeps =
                    scoped.getDependencyFact<string[]>(
                        dep.name,
                        FactKeys.DEPRECATED_TRANSITIVE_DEPS,
                    ) ?? [];
                const notes = this.composeNotes(dep.name, versionInfo.version, scoped);
                const rowUrlPatterns =
                    scoped.getDependencyFact<Record<string, string>>(dep.name, FactKeys.URLS) ?? {};
                const registryPattern = rowUrlPatterns['Registry'];
                const usedByCells = this.usedByCells(versionInfo.usedBy, {
                    name: dep.name,
                    version: versionInfo,
                    store: scoped,
                    ecosystem: dep.ecosystem,
                });
                rows.push({
                    Dependency: shortenModulePath(dep.name, dep.ecosystem),
                    Ecosystem: dep.ecosystem,
                    Type: versionInfo.dependencyTypes.join(', '),
                    Version: versionInfo.version,
                    'Latest Version': versionInfo.latestVersion,
                    'Versions Behind': getVersionsBehind(
                        versionInfo.version,
                        versionInfo.latestVersion,
                    ),
                    'Catalog?': versionInfo.inCatalog,
                    'Published Date': formatDate(versionInfo.publishDate) ?? '',
                    Age: getAgeDays(versionInfo.publishDate) ?? '',
                    Notes: notes,
                    ...this.buildCustomColumnData({
                        name: dep.name,
                        version: versionInfo,
                        store: scoped,
                        ecosystem: dep.ecosystem,
                    }),
                    'Latest Version URL': registryPattern
                        ? resolveUrl(registryPattern, {
                              name: dep.name,
                              version: versionInfo.latestVersion,
                          })
                        : '',
                    'Deprecated Dep URLs': deprecatedTransitiveDeps.map((dep_) => {
                        if (!registryPattern) return '';
                        const lastAt = dep_.lastIndexOf('@');
                        return resolveUrl(registryPattern, {
                            name: dep_.substring(0, lastAt),
                            version: dep_.substring(lastAt + 1),
                        });
                    }),
                    'Used By Count': usedByCells.usedBy.length,
                    'Used By': usedByCells.usedBy.join('; '),
                    'Used By Grouped': usedByCells.grouped,
                    'Deprecated Transitive Dependencies': deprecatedTransitiveDeps.join('; '),
                    'Detail Link': `${detailPrefix}details/${detailFilename}`,
                });
            }
        }
        return rows;
    }

    /**
     * Generate a standalone HTML page with embedded data and enhanced Tabulator viewer.
     */
    async toHtml(providers: ProviderOutput[], store: FactStore): Promise<string> {
        // Build tabs array: one "all" and one "duplicates" tab per provider
        const tabs: Array<{
            id: string;
            label: string;
            data: Array<
                Record<
                    string,
                    string | number | boolean | string[] | Record<string, string[]> | null
                >
            >;
            groupBy?: string;
            supportsCatalog: boolean;
        }> = [];

        for (const provider of providers) {
            const detailPrefix = `${provider.name}/`;
            const allRows = this.buildRows(provider.dependencies, store, detailPrefix);

            const multiVersionDeps = provider.dependencies.filter((dep) => dep.versions.length > 1);
            const duplicateRows = this.buildRows(multiVersionDeps, store, detailPrefix).sort(
                (a, b) => {
                    const nameCompare = (a['Dependency'] as string).localeCompare(
                        b['Dependency'] as string,
                    );
                    if (nameCompare !== 0) return nameCompare;
                    return (b['Used By Count'] as number) - (a['Used By Count'] as number);
                },
            );

            tabs.push({
                id: provider.name,
                label: provider.name,
                data: allRows,
                supportsCatalog: provider.supportsCatalog,
            });
            tabs.push({
                id: `${provider.name}-duplicates`,
                label: `${provider.name} duplicates`,
                data: duplicateRows,
                groupBy: 'Dependency',
                supportsCatalog: provider.supportsCatalog,
            });
        }

        // Build unique notes across all providers
        const mergedDeps = mergeProviderDependencies(providers);
        const allRows = this.buildRows(mergedDeps, store, '');
        const uniqueNotes = [
            ...new Set(
                allRows
                    .map((r) => r.Notes as string)
                    .filter(Boolean)
                    .flatMap((notes) => notes.split(', ')),
            ),
        ];

        // Ensure standard note values are always available in the filter
        const standardNotes = ['Patched', 'Forked', 'Catalog Mismatch', 'Deprecated'];
        for (const note of standardNotes) {
            if (!uniqueNotes.includes(note)) {
                uniqueNotes.push(note);
            }
        }

        // Bundle browser code and load CSS
        const bundledJs = await this.bundleBrowserCode();
        const cssContent = await this.readCssFile();

        // Prepare custom column definitions for browser
        const browserColumns: BrowserColumnDef[] = this.columns.map((col) => ({
            key: col.key,
            header: col.header,
            width: col.width,
            filter: col.filter,
            filterValues: col.filterValues,
            hasTooltip: col.getTooltip !== undefined,
            hasFilterValue: col.getFilterValue !== undefined,
        }));

        // Prepare tab summaries for template rendering (Handlebars loop)
        const tabSummaries = tabs.map((t) => ({
            id: t.id,
            label: t.label,
            rowCount: t.data.length,
            grouped: t.groupBy !== undefined,
        }));

        // Build provider metadata for 2-level navigation
        const providerInfos = providers.map((provider) => {
            const allTab = tabs.find((t) => t.id === provider.name);
            const dupTab = tabs.find((t) => t.id === `${provider.name}-duplicates`);
            return {
                name: provider.name,
                depCount: allTab?.data.length ?? 0,
                dupCount: dupTab?.data.length ?? 0,
            };
        });

        // Render content using template
        const content = this.templateService.render('pages/index', {
            tabs: tabSummaries,
            tabsJson: JSON.stringify(tabs),
            providersJson: JSON.stringify(providerInfos),
            providersSummary: providerInfos,
            singleProvider: providerInfos.length === 1,
            uniqueNotesJson: JSON.stringify(uniqueNotes),
            customColumnsJson: JSON.stringify(browserColumns),
            groupingsJson: JSON.stringify(
                this.groupings.map((g) => ({
                    key: g.key,
                    slug: g.slugPrefix ?? g.key,
                })),
            ),
        });

        // Render full page with layout.
        // Grouping pages are provider-scoped, so default to the first provider for nav links.
        const defaultProviderPrefix = providers.length > 0 ? `${providers[0]!.name}/` : '';
        const navEcosystem = providers[0]?.ecosystem;

        return this.templateService.render('layouts/index', {
            title: 'Dependency Report',
            siteName: this.siteName,
            cssContent,
            bundledJs,
            content,
            providerPrefix: defaultProviderPrefix,
            timestamp: new Date().toLocaleString(),
            groupings: this.navGroupings(navEcosystem, defaultProviderPrefix),
        });
    }

    /**
     * Generate detail HTML pages for each dependency@version combination.
     * Returns an array of DetailPage objects with provider-scoped filenames
     * (e.g. "pnpm/details/react@18.2.0.html").
     * All data is pre-enriched, so no network requests are made.
     */
    toDetailPages(providers: ProviderOutput[], store: FactStore): DetailPage[] {
        process.stderr.write('Generating detail pages...\n');
        const pages: DetailPage[] = [];
        let generated = 0;
        const total = providers.reduce(
            (sum, p) => sum + p.dependencies.reduce((s, dep) => s + dep.versions.length, 0),
            0,
        );

        for (const provider of providers) {
            const providerPrefix = `${provider.name}/`;
            const scopedStore = store.scoped(provider.ecosystem);
            for (const dep of provider.dependencies) {
                for (const versionInfo of dep.versions) {
                    const detailFilename = getDetailFilename(dep.name, versionInfo.version);
                    const html = this.generateDetailPage(
                        dep,
                        versionInfo,
                        scopedStore,
                        '../../',
                        providerPrefix,
                    );
                    pages.push({ filename: `${providerPrefix}details/${detailFilename}`, html });

                    generated++;
                    if (generated % 100 === 0 || generated === total) {
                        process.stderr.write(`  Generated ${generated}/${total} pages\n`);
                    }
                }
            }
        }

        return pages;
    }

    /**
     * Generate a single detail page for a dependency@version.
     * Uses pre-enriched data, no network requests.
     */
    private generateDetailPage(
        dep: DirectDependency,
        versionInfo: DependencyVersion,
        store: FactStore,
        baseHref = '../',
        providerPrefix = '',
    ): string {
        const navEcosystem = dep.ecosystem;
        const description =
            store.getVersionFact<string>(dep.name, versionInfo.version, FactKeys.DESCRIPTION) ?? '';
        const homepage =
            store.getVersionFact<string>(dep.name, versionInfo.version, FactKeys.HOMEPAGE) ?? '';
        const repositoryUrl =
            store.getVersionFact<string>(dep.name, versionInfo.version, FactKeys.REPOSITORY_URL) ??
            '';
        const bugsUrl =
            store.getVersionFact<string>(dep.name, versionInfo.version, FactKeys.BUGS_URL) ?? '';
        const unpackedSize = store.getVersionFact<number>(
            dep.name,
            versionInfo.version,
            FactKeys.UNPACKED_SIZE,
        );
        const urlPatterns =
            store.getDependencyFact<Record<string, string>>(dep.name, FactKeys.URLS) ?? {};
        const urls = resolveUrlPatterns(urlPatterns, {
            name: dep.name,
            version: versionInfo.version,
        });

        // Get GitHub data from FactStore
        const githubData = store.getDependencyFact<GitHubData>(dep.name, FactKeys.GITHUB_DATA);
        const changelogUrl = githubData?.changelogUrl;
        const releases = githubData?.releases ?? [];

        // Get upgrade path data from FactStore
        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(
                dep.name,
                versionInfo.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];
        const compareUrl = store.getVersionFact<string>(
            dep.name,
            versionInfo.version,
            FactKeys.COMPARE_URL,
        );

        // Prepare upgrade path data for template
        const upgradePathData = this.prepareUpgradePathData(
            dep.name,
            versionInfo.version,
            versionInfo.latestVersion,
            versionsBetween,
            releases,
            githubData,
            compareUrl,
            unpackedSize,
        );

        const colCtx: ColumnContext = {
            name: dep.name,
            version: versionInfo,
            store,
            ecosystem: dep.ecosystem,
        };

        // Group usedBy dependencies
        const usedByGrouped = this.usedByCells(versionInfo.usedBy, colCtx).grouped;
        const usedByGroupedArray = usedByGrouped
            ? Object.keys(usedByGrouped)
                  .sort()
                  .map((groupKey) => ({
                      owner: groupKey,
                      packages: usedByGrouped[groupKey] || [],
                  }))
            : // eslint-disable-next-line no-null/no-null
              null;

        // Prepare version comparison text
        const versionsBehindText =
            versionInfo.version !== versionInfo.latestVersion
                ? ` (${getVersionsBehind(versionInfo.version, versionInfo.latestVersion)})`
                : ' (up to date)';

        // Compose notes from boolean facts
        const notes = this.composeNotes(dep.name, versionInfo.version, store);

        // Build custom metadata for display on detail page
        const customMeta: Array<{ label: string; value: string; detail?: string }> = [];
        for (const col of this.columns) {
            const value = col.getValue(colCtx);
            if (value) {
                // The tooltip is where a column puts the part that doesn't fit
                // in a cell, e.g. a CVSS score or the version a fix landed in.
                // The table shows it on hover; without this the detail page is
                // the one place that loses it.
                const detail = col.getTooltip?.(colCtx);
                customMeta.push({
                    label: col.header,
                    value: DOMPurify.sanitize(value),
                    detail: detail ? DOMPurify.sanitize(detail) : undefined,
                });
            }
        }

        // Get deprecated transitive deps
        const deprecatedTransitiveDeps =
            store.getDependencyFact<string[]>(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS) ?? [];

        const dependencySections = (
            this.getDependencySections?.({
                name: dep.name,
                version: versionInfo,
                ecosystem: dep.ecosystem,
                store,
            }) ?? []
        ).map((section) =>
            section.html ? { ...section, html: DOMPurify.sanitize(section.html) } : section,
        );

        // Render content using template
        const displayName = shortenModulePath(dep.name, dep.ecosystem);
        const content = this.templateService.render('pages/dependency-detail', {
            name: displayName,
            version: versionInfo.version,
            description,
            customMeta: customMeta.length > 0 ? customMeta : undefined,
            sections: dependencySections.length > 0 ? dependencySections : undefined,
            dependencyTypes: versionInfo.dependencyTypes.join(', '),
            formattedPublishDate: formatDate(versionInfo.publishDate) ?? '',
            publishDateAge: formatAgeHuman(versionInfo.publishDate) ?? '',
            latestVersion: versionInfo.latestVersion,
            versionsBehindText,
            inCatalog: versionInfo.inCatalog,
            notes,
            formattedInstalledSize: formatBytes(unpackedSize),
            upgradePath: upgradePathData,
            urls,
            homepage,
            repositoryUrl,
            changelogUrl,
            bugsUrl,
            usedByCount: versionInfo.usedBy.length,
            usedByGrouped: usedByGroupedArray,
            usedByFlat: [...versionInfo.usedBy].sort(),
            hasDeprecatedDeps: deprecatedTransitiveDeps.length > 0,
            deprecatedTransitiveDeps,
        });

        // Render full page with base layout
        return this.templateService.render('layouts/base', {
            title: `${displayName}@${versionInfo.version}`,
            siteName: this.siteName,
            content,
            baseHref,
            providerPrefix,
            timestamp: new Date().toLocaleString(),
            groupings: this.navGroupings(navEcosystem, providerPrefix),
        });
    }

    /**
     * Prepare upgrade path data for template.
     */
    private prepareUpgradePathData(
        name: string,
        currentVersion: string,
        latestVersion: string,
        versionsBetween: PackageVersionInfo[],
        releases: GitHubRelease[],
        githubData: GitHubData | undefined,
        compareUrl: string | undefined,
        installedUnpackedSize: number | undefined,
    ) {
        if (currentVersion === latestVersion || versionsBetween.length === 0) {
            return { hasVersionsBetween: false };
        }

        // Reverse to show newest first
        const versionsNewestFirst = [...versionsBetween].reverse();

        const versions = versionsNewestFirst.map((v) => {
            const release = findReleaseForVersion(releases, v.version, name);
            const releaseNotes = release?.body
                ? DOMPurify.sanitize(marked.parse(release.body, { gfm: true }) as string)
                : '';

            // Prepare GitHub URL
            let githubUrl: string | undefined;
            if (release) {
                githubUrl = release.htmlUrl;
            } else if (githubData) {
                const toTag = detectTagFormat(releases);
                githubUrl = `https://github.com/${githubData.owner}/${githubData.repo}/releases/tag/${toTag(v.version)}`;
            }

            return {
                version: v.version,
                formattedPublishDate: formatDate(v.publishDate),
                registryUrl: v.registryUrl,
                githubUrl,
                releaseNotes,
                isLatest: v.version === latestVersion,
                formattedSize: formatBytes(v.unpackedSize),
                sizeChange: formatSizeChange(installedUnpackedSize, v.unpackedSize),
                sizeIncreased:
                    v.unpackedSize !== undefined &&
                    installedUnpackedSize !== undefined &&
                    v.unpackedSize > installedUnpackedSize,
                sizeDecreased:
                    v.unpackedSize !== undefined &&
                    installedUnpackedSize !== undefined &&
                    v.unpackedSize < installedUnpackedSize,
            };
        });

        const hasPublishDates = versions.some((v) => v.formattedPublishDate != null);
        const hasSizes = versions.some((v) => v.formattedSize);
        const hasLinks = versions.some((v) => v.registryUrl || v.githubUrl);

        return {
            hasVersionsBetween: true,
            currentVersion,
            latestVersion,
            versionCount: versionsBetween.length,
            compareUrl,
            hasPublishDates,
            hasSizes,
            hasLinks,
            versions,
        };
    }

    /**
     * Compute statistics for a group of dependencies.
     */
    private computeGroupStats(deps: DirectDependency[]): GroupStats {
        let outdatedCount = 0;
        let catalogCount = 0;
        let totalCount = 0;

        // Counted per dependency@version, the same unit as the list of
        // dependencies beside these stats. Counting the total by name while
        // counting the others by version made "Outdated" exceed "Total" on any
        // group holding a dependency installed at more than one version.
        for (const dep of deps) {
            for (const version of dep.versions) {
                totalCount++;
                if (version.version !== version.latestVersion) {
                    outdatedCount++;
                }
                if (version.inCatalog) {
                    catalogCount++;
                }
            }
        }

        return {
            totalDependencies: totalCount,
            outdatedCount,
            catalogCount,
        };
    }

    /**
     * Generate all grouping pages for a single grouping configuration.
     * Returns an index page and one detail page per unique annotation value.
     * When providerPrefix is set (e.g. "pnpm/"), filenames and links are scoped
     * under the provider directory.
     */
    toGroupingPages(
        dependencies: DirectDependency[],
        grouping: GroupingConfig,
        store: FactStore,
        providerPrefix = '',
        ecosystem?: string,
    ): { index: DetailPage; details: DetailPage[] } {
        const slug = grouping.slugPrefix ?? grouping.key;
        const baseHref = providerPrefix ? '../../' : '../';
        const navEcosystem = ecosystem;
        // `store` is the root store: a merged page holds dependencies from
        // several ecosystems, so each is read through its own scope.
        const storeFor = (dep: DirectDependency): FactStore => store.scoped(dep.ecosystem);

        // Collect all dependencies for each unique grouping value. getValue may
        // return several, in which case the dependency belongs under each.
        const grouped = new Map<string, DirectDependency[]>();
        for (const dep of dependencies) {
            const value = grouping.getValue(dep.name, storeFor(dep), dep.ecosystem);
            if (!value) continue;
            const values = typeof value === 'string' ? [value] : value;
            for (const single of values) {
                if (!single) continue;
                const existing = grouped.get(single);
                if (existing) {
                    existing.push(dep);
                } else {
                    grouped.set(single, [dep]);
                }
            }
        }

        // Compute stats for each group
        const groupStats = new Map<string, GroupStats>();
        for (const [value, deps] of grouped) {
            groupStats.set(value, this.computeGroupStats(deps));
        }

        // Generate index page
        const summaries = Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([value, deps]) => {
                // Stats are guaranteed to exist since they're built from the same grouped entries
                const stats = groupStats.get(value) as GroupStats;
                return {
                    value,
                    count: deps.length,
                    slug: getGroupingFilename(value),
                    outdatedCount: stats.outdatedCount,
                    ecosystems: [...new Set(deps.map((d) => d.ecosystem))],
                };
            });

        // When a grouping's values are apps and services, the index is where
        // ecosystems mix even though no single value does, so an app and a Go
        // service sit next to each other with nothing to tell them apart.
        // Split it the way a detail page splits its dependency list.
        const indexEcosystems = new Set(summaries.flatMap((entry) => entry.ecosystems));
        const indexGroups =
            !ecosystem && indexEcosystems.size > 1
                ? [...indexEcosystems]
                      .sort((a, b) => ecosystemLabel(a).localeCompare(ecosystemLabel(b)))
                      .map((eco) => {
                          // A value whose dependencies span ecosystems is rare,
                          // and listing it under each is more use than hiding
                          // it under whichever came first.
                          const items = summaries.filter((entry) => entry.ecosystems.includes(eco));
                          return {
                              ecosystem: eco,
                              label: ecosystemLabel(eco),
                              count: items.length,
                              items,
                          };
                      })
                : undefined;

        const indexContent = this.templateService.render('pages/grouping-index', {
            label: grouping.label,
            items: summaries,
            ecosystemGroups: indexGroups,
        });

        const indexHtml = this.templateService.render('layouts/base', {
            title: grouping.label,
            siteName: this.siteName,
            content: indexContent,
            baseHref,
            providerPrefix,
            timestamp: new Date().toLocaleString(),
            groupings: this.navGroupings(navEcosystem, providerPrefix),
        });

        const index: DetailPage = {
            filename: `${providerPrefix}${slug}/index.html`,
            html: indexHtml,
        };

        // Generate detail pages for each value
        const details: DetailPage[] = Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([value, deps]) => {
                const stats = groupStats.get(value) as GroupStats;
                // One entry per dependency@version. Taking versions[0] dropped
                // every other installed version from the page, so a dependency
                // pinned at three versions looked like one and the stats
                // disagreed with the list.
                const dependencies = deps.flatMap((dep) =>
                    dep.versions.map((version) => ({
                        name: shortenModulePath(dep.name, dep.ecosystem),
                        version: version.version,
                        latestVersion: version.latestVersion,
                        ecosystem: dep.ecosystem,
                        detailLink: providerPrefix
                            ? `../details/${getDetailFilename(dep.name, version.version)}`
                            : `../${this.providerDirs.get(dep.ecosystem) ?? ''}/details/${getDetailFilename(dep.name, version.version)}`,
                    })),
                );

                // A merged page lists several ecosystems, and an interleaved
                // run of npm and Go packages is hard to read. Split it when
                // there is more than one; a single-ecosystem page is unchanged.
                const byEcosystem = new Map<string, typeof dependencies>();
                for (const entry of dependencies) {
                    const existing = byEcosystem.get(entry.ecosystem);
                    if (existing) existing.push(entry);
                    else byEcosystem.set(entry.ecosystem, [entry]);
                }
                const ecosystemGroups =
                    byEcosystem.size > 1
                        ? [...byEcosystem.entries()]
                              .sort(([a], [b]) =>
                                  ecosystemLabel(a).localeCompare(ecosystemLabel(b)),
                              )
                              .map(([eco, items]) => ({
                                  ecosystem: eco,
                                  label: ecosystemLabel(eco),
                                  count: items.length,
                                  dependencies: items,
                              }))
                        : undefined;

                const ctx: GroupingDetailContext = {
                    groupValue: value,
                    dependencies: deps,
                    store: ecosystem ? store.scoped(ecosystem) : store,
                };
                const crossCuttingSections = this.getSections?.(ctx) ?? [];
                const groupingSections = grouping.getSections?.(ctx) ?? [];
                const sections = [...crossCuttingSections, ...groupingSections].map((s) =>
                    s.html ? { ...s, html: DOMPurify.sanitize(s.html) } : s,
                );

                const detailContent = this.templateService.render('pages/grouping-detail', {
                    label: grouping.label,
                    value,
                    dependencies,
                    ecosystemGroups,
                    count: dependencies.length,
                    stats,
                    sections,
                });

                const detailHtml = this.templateService.render('layouts/base', {
                    title: `${grouping.label}: ${value}`,
                    siteName: this.siteName,
                    content: detailContent,
                    baseHref,
                    providerPrefix,
                    timestamp: new Date().toLocaleString(),
                    groupings: this.navGroupings(navEcosystem, providerPrefix),
                });

                return {
                    filename: `${providerPrefix}${slug}/${getGroupingFilename(value)}`,
                    html: detailHtml,
                };
            });

        return { index, details };
    }

    /**
     * Generate all grouping pages for all configured groupings across all providers.
     */
    toAllGroupingPages(providers: ProviderOutput[], store: FactStore): DetailPage[] {
        if (this.groupings.length === 0) {
            return [];
        }

        this.rememberProviderDirs(providers);
        const pages: DetailPage[] = [];

        // A grouping that spans every ecosystem gets one tree at the site root,
        // built from the merged dependency list. Per-provider trees left Go
        // pages sitting under go/ with nothing linking to them, because the nav
        // could only point at one provider.
        const merged = this.groupings.filter((g) => this.isMerged(g));
        if (merged.length > 0 && providers.length > 0) {
            const mergedDeps = mergeProviderDependencies(providers);
            for (const grouping of merged) {
                const { index, details } = this.toGroupingPages(
                    mergedDeps,
                    grouping,
                    store,
                    '',
                    undefined,
                );
                pages.push(index);
                pages.push(...details);
            }
        }

        for (const provider of providers) {
            const providerPrefix = `${provider.name}/`;
            for (const grouping of this.groupingsFor(provider.ecosystem)) {
                if (this.isMerged(grouping)) continue;
                const { index, details } = this.toGroupingPages(
                    provider.dependencies,
                    grouping,
                    store,
                    providerPrefix,
                    provider.ecosystem,
                );
                pages.push(index);
                pages.push(...details);
            }
        }

        return pages;
    }
}
