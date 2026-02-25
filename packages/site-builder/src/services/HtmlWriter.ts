import { rolldown } from 'rolldown';
import { marked } from 'marked';
import { getCssContent } from '../paths';
import type {
    DetailPage,
    DirectDependency,
    DependencyVersion,
    GitHubRelease,
    GitHubData,
    PackageVersionInfo,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    ProviderOutput,
    UsedByGroupKeyFn,
    FactStore,
} from '@dependicus/core';
import { mergeProviderDependencies, getDetailFilename } from '@dependicus/core';
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
} from '@dependicus/core';
import { TemplateService } from './TemplateService';
import type { BrowserColumnDef } from '@dependicus/site-frontend';
import { browserEntryPath } from '@dependicus/site-frontend';

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
    getValue: (name: string, version: DependencyVersion, store: FactStore) => string;
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
    getTooltip?: (name: string, version: DependencyVersion, store: FactStore) => string;
    /**
     * Extract a separate filter value.
     * When set, header filter matches against this value instead of the display value.
     * Implemented via a custom [`headerFilterFunc`](https://tabulator.info/docs/6.3/filter#header-function).
     */
    getFilterValue?: (name: string, version: DependencyVersion, store: FactStore) => string;
}

export interface HtmlWriterOptions {
    groupings?: GroupingConfig[];
    columns?: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
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

export class HtmlWriter {
    private templateService: TemplateService;
    private groupings: GroupingConfig[];
    private columns: CustomColumn[];
    private getUsedByGroupKey: UsedByGroupKeyFn | undefined;
    private getSections: ((ctx: GroupingDetailContext) => GroupingSection[]) | undefined;
    private siteName: string;

    constructor(options?: HtmlWriterOptions) {
        this.templateService = new TemplateService();
        this.groupings = options?.groupings ?? [];
        this.columns = options?.columns ?? [];
        this.getUsedByGroupKey = options?.getUsedByGroupKey;
        this.getSections = options?.getSections;
        this.siteName = options?.siteName ?? 'Dependicus';
    }

    /**
     * Group dependencies by a key derived from the FactStore.
     */
    private groupDependenciesByMeta(
        packages: string[],
        name: string,
        version: DependencyVersion,
        store: FactStore,
    ): Record<string, string[]> | null {
        // eslint-disable-next-line no-null/no-null
        if (!this.getUsedByGroupKey) return null;
        const groupKey = this.getUsedByGroupKey(name, version, store) || 'Unknown';
        return { [groupKey]: [...packages].sort() };
    }

    /**
     * Build row data for custom columns from FactStore.
     */
    private buildCustomColumnData(
        name: string,
        version: DependencyVersion,
        store: FactStore,
    ): Record<string, string> {
        const data: Record<string, string> = {};
        for (const col of this.columns) {
            data[col.key] = col.getValue(name, version, store);
            if (col.getTooltip) {
                data[`${col.key}__tooltip`] = col.getTooltip(name, version, store);
            }
            if (col.getFilterValue) {
                data[`${col.key}__filterValue`] = col.getFilterValue(name, version, store);
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
     * Bundle browser-side JavaScript code using rolldown.
     */
    private async bundleBrowserCode(): Promise<string> {
        const bundle = await rolldown({
            input: browserEntryPath,
            platform: 'browser',
        });
        const { output } = await bundle.generate({ format: 'iife' });

        if (output.length === 0 || !output[0]) {
            throw new Error('rolldown failed to produce output files');
        }

        return output[0].code;
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
                    ...this.buildCustomColumnData(dep.name, versionInfo, scoped),
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
                    'Used By Count': versionInfo.usedBy.length,
                    'Used By': versionInfo.usedBy.join('; '),
                    'Used By Grouped': this.groupDependenciesByMeta(
                        versionInfo.usedBy,
                        dep.name,
                        versionInfo,
                        scoped,
                    ),
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

        // Render full page with layout
        return this.templateService.render('layouts/index', {
            title: 'Dependency Report',
            siteName: this.siteName,
            cssContent,
            bundledJs,
            content,
            timestamp: new Date().toLocaleString(),
            groupings: this.groupings.map((g) => ({
                label: g.label,
                slug: g.slugPrefix ?? g.key,
            })),
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

        // Group usedBy dependencies
        const usedByGrouped = this.groupDependenciesByMeta(
            versionInfo.usedBy,
            dep.name,
            versionInfo,
            store,
        );
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
        const customMeta: Array<{ label: string; value: string }> = [];
        for (const col of this.columns) {
            const value = col.getValue(dep.name, versionInfo, store);
            if (value) {
                customMeta.push({ label: col.header, value });
            }
        }

        // Get deprecated transitive deps
        const deprecatedTransitiveDeps =
            store.getDependencyFact<string[]>(dep.name, FactKeys.DEPRECATED_TRANSITIVE_DEPS) ?? [];

        // Render content using template
        const displayName = shortenModulePath(dep.name, dep.ecosystem);
        const content = this.templateService.render('pages/dependency-detail', {
            name: displayName,
            version: versionInfo.version,
            description,
            customMeta: customMeta.length > 0 ? customMeta : undefined,
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
            groupings: this.groupings.map((g) => ({
                label: g.label,
                slug: g.slugPrefix ?? g.key,
            })),
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
            const releaseNotes = release?.body ? marked.parse(release.body, { gfm: true }) : '';

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
        const countedDeps = new Set<string>();

        for (const dep of deps) {
            for (const version of dep.versions) {
                if (!countedDeps.has(dep.name)) {
                    countedDeps.add(dep.name);
                }

                if (version.version !== version.latestVersion) {
                    outdatedCount++;
                }
                if (version.inCatalog) {
                    catalogCount++;
                }
            }
        }

        return {
            totalDependencies: countedDeps.size,
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
    ): { index: DetailPage; details: DetailPage[] } {
        const slug = grouping.slugPrefix ?? grouping.key;
        const baseHref = providerPrefix ? '../../' : '../';

        // Collect all dependencies for each unique grouping value
        const grouped = new Map<string, DirectDependency[]>();
        for (const dep of dependencies) {
            const value = grouping.getValue(dep.name, store);
            if (!value) continue;
            const existing = grouped.get(value);
            if (existing) {
                existing.push(dep);
            } else {
                grouped.set(value, [dep]);
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
                    slug: `${value}.html`,
                    outdatedCount: stats.outdatedCount,
                };
            });

        const indexContent = this.templateService.render('pages/grouping-index', {
            label: grouping.label,
            items: summaries,
        });

        const indexHtml = this.templateService.render('layouts/base', {
            title: grouping.label,
            siteName: this.siteName,
            content: indexContent,
            baseHref,
            providerPrefix,
            timestamp: new Date().toLocaleString(),
            groupings: this.groupings.map((g) => ({
                label: g.label,
                slug: g.slugPrefix ?? g.key,
            })),
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
                const dependencies = deps.map((dep) => {
                    const version = dep.versions[0];
                    return {
                        name: shortenModulePath(dep.name, dep.ecosystem),
                        version: version?.version ?? '',
                        latestVersion: version?.latestVersion ?? '',
                        detailLink: version
                            ? `../details/${getDetailFilename(dep.name, version.version)}`
                            : '',
                    };
                });

                const ctx: GroupingDetailContext = {
                    groupValue: value,
                    dependencies: deps,
                    store,
                };
                const crossCuttingSections = this.getSections?.(ctx) ?? [];
                const groupingSections = grouping.getSections?.(ctx) ?? [];
                const sections = [...crossCuttingSections, ...groupingSections];

                const detailContent = this.templateService.render('pages/grouping-detail', {
                    label: grouping.label,
                    value,
                    dependencies,
                    count: deps.length,
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
                    groupings: this.groupings.map((g) => ({
                        label: g.label,
                        slug: g.slugPrefix ?? g.key,
                    })),
                });

                return {
                    filename: `${providerPrefix}${slug}/${value}.html`,
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

        const pages: DetailPage[] = [];

        for (const provider of providers) {
            const providerPrefix = `${provider.name}/`;
            const scopedStore = store.scoped(provider.ecosystem);
            for (const grouping of this.groupings) {
                const { index, details } = this.toGroupingPages(
                    provider.dependencies,
                    grouping,
                    scopedStore,
                    providerPrefix,
                );
                pages.push(index);
                pages.push(...details);
            }
        }

        return pages;
    }
}
