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
    UsedByGroupKeyFn,
    FactStore,
} from '@dependicus/core';
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
} from '@dependicus/core';
import { TemplateService } from './TemplateService';
import type { BrowserColumnDef } from '@dependicus/site-frontend';
import { browserEntryPath } from '@dependicus/site-frontend';

interface GroupStats {
    totalPackages: number;
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
    getValue: (packageName: string, version: DependencyVersion, store: FactStore) => string;
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
    getTooltip?: (packageName: string, version: DependencyVersion, store: FactStore) => string;
    /**
     * Extract a separate filter value.
     * When set, header filter matches against this value instead of the display value.
     * Implemented via a custom [`headerFilterFunc`](https://tabulator.info/docs/6.3/filter#header-function).
     */
    getFilterValue?: (packageName: string, version: DependencyVersion, store: FactStore) => string;
}

export interface HtmlWriterOptions {
    groupings?: GroupingConfig[];
    columns?: CustomColumn[];
    getUsedByGroupKey?: UsedByGroupKeyFn;
    getSections?: (ctx: GroupingDetailContext) => GroupingSection[];
    siteName?: string;
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
     * Generate a safe filename for a package@version detail page.
     * Replaces @ and / with safe characters.
     */
    static getDetailFilename(packageName: string, version: string): string {
        // Replace @ with nothing (for scoped packages) and / with -
        const safeName = packageName.replace(/^@/, '').replace(/\//g, '-');
        return `${safeName}@${version}.html`;
    }

    /**
     * Group packages by a key derived from the FactStore.
     */
    private groupPackagesByMeta(
        packages: string[],
        packageName: string,
        version: DependencyVersion,
        store: FactStore,
    ): Record<string, string[]> | null {
        // eslint-disable-next-line no-null/no-null
        if (!this.getUsedByGroupKey) return null;
        const groupKey = this.getUsedByGroupKey(packageName, version, store) || 'Unknown';
        return { [groupKey]: [...packages].sort() };
    }

    /**
     * Build row data for custom columns from FactStore.
     */
    private buildCustomColumnData(
        packageName: string,
        version: DependencyVersion,
        store: FactStore,
    ): Record<string, string> {
        const data: Record<string, string> = {};
        for (const col of this.columns) {
            data[col.key] = col.getValue(packageName, version, store);
            if (col.getTooltip) {
                data[`${col.key}__tooltip`] = col.getTooltip(packageName, version, store);
            }
            if (col.getFilterValue) {
                data[`${col.key}__filterValue`] = col.getFilterValue(packageName, version, store);
            }
        }
        return data;
    }

    /**
     * Compose notes string from boolean FactStore facts.
     */
    private composeNotes(packageName: string, version: string, store: FactStore): string {
        const parts: string[] = [];
        if (store.getVersionFact<boolean>(packageName, version, FactKeys.IS_PATCHED)) {
            parts.push('Patched');
        }
        if (store.getVersionFact<boolean>(packageName, version, FactKeys.IS_FORKED)) {
            parts.push('Forked');
        }
        if (store.getVersionFact<boolean>(packageName, version, FactKeys.HAS_CATALOG_MISMATCH)) {
            parts.push('Catalog Mismatch');
        }
        if (store.getVersionFact<boolean>(packageName, version, FactKeys.IS_DEPRECATED)) {
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
     * Generate a standalone HTML page with embedded data and enhanced Tabulator viewer.
     */
    async toHtml(
        dependencies: DirectDependency[],
        store: FactStore,
        hasCatalog = false,
    ): Promise<string> {
        // Flatten data into rows (similar to CSV structure)
        const allRows: Array<
            Record<string, string | number | boolean | Record<string, string[]> | null>
        > = [];
        for (const dep of dependencies) {
            for (const versionInfo of dep.versions) {
                const detailFilename = HtmlWriter.getDetailFilename(
                    dep.packageName,
                    versionInfo.version,
                );
                const deprecatedTransitiveDeps =
                    store.getPackageFact<string[]>(
                        dep.packageName,
                        FactKeys.DEPRECATED_TRANSITIVE_DEPS,
                    ) ?? [];
                const notes = this.composeNotes(dep.packageName, versionInfo.version, store);
                allRows.push({
                    'Package Name': dep.packageName,
                    Type: versionInfo.dependencyTypes.join(', '),
                    Version: versionInfo.version,
                    'Latest Version': versionInfo.latestVersion,
                    'Versions Behind': getVersionsBehind(
                        versionInfo.version,
                        versionInfo.latestVersion,
                    ),
                    'Catalog?': versionInfo.inCatalog,
                    'Published Date': formatDate(versionInfo.publishDate),
                    Age: getAgeDays(versionInfo.publishDate),
                    Notes: notes,
                    ...this.buildCustomColumnData(dep.packageName, versionInfo, store),
                    'Used By Count': versionInfo.usedBy.length,
                    'Used By Packages': versionInfo.usedBy.join('; '),
                    'Used By Grouped': this.groupPackagesByMeta(
                        versionInfo.usedBy,
                        dep.packageName,
                        versionInfo,
                        store,
                    ),
                    'Deprecated Transitive Dependencies': deprecatedTransitiveDeps.join('; '),
                    'Detail Link': `details/${detailFilename}`,
                });
            }
        }

        // Create separate dataset for packages with multiple versions
        const multiVersionRows = this.getMultiVersionRows(dependencies, store);

        // Create separate dataset for catalog dependencies
        const catalogRows = allRows.filter((row) => row['Catalog?'] === true);

        // Get unique values for dropdown filters
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

        // Render content using template
        const content = this.templateService.render('pages/index', {
            allRowsCount: allRows.length,
            multiVersionRowsCount: multiVersionRows.length,
            catalogRowsCount: catalogRows.length,
            hasCatalog,
            allDataJson: JSON.stringify(allRows, undefined, 2),
            multiVersionDataJson: JSON.stringify(multiVersionRows, undefined, 2),
            catalogDataJson: JSON.stringify(catalogRows, undefined, 2),
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
     * Get rows for packages that have multiple versions installed.
     */
    private getMultiVersionRows(
        dependencies: DirectDependency[],
        store: FactStore,
    ): Array<Record<string, string | number | boolean | Record<string, string[]> | null>> {
        const multiVersionDeps = dependencies.filter((dep) => dep.versions.length > 1);
        const rows: Array<
            Record<string, string | number | boolean | Record<string, string[]> | null>
        > = [];

        for (const dep of multiVersionDeps) {
            for (const versionInfo of dep.versions) {
                const detailFilename = HtmlWriter.getDetailFilename(
                    dep.packageName,
                    versionInfo.version,
                );
                const deprecatedTransitiveDeps =
                    store.getPackageFact<string[]>(
                        dep.packageName,
                        FactKeys.DEPRECATED_TRANSITIVE_DEPS,
                    ) ?? [];
                const notes = this.composeNotes(dep.packageName, versionInfo.version, store);
                rows.push({
                    'Package Name': dep.packageName,
                    Type: versionInfo.dependencyTypes.join(', '),
                    Version: versionInfo.version,
                    'Latest Version': versionInfo.latestVersion,
                    'Versions Behind': getVersionsBehind(
                        versionInfo.version,
                        versionInfo.latestVersion,
                    ),
                    'Catalog?': versionInfo.inCatalog,
                    'Published Date': formatDate(versionInfo.publishDate),
                    Age: getAgeDays(versionInfo.publishDate),
                    Notes: notes,
                    ...this.buildCustomColumnData(dep.packageName, versionInfo, store),
                    'Used By Count': versionInfo.usedBy.length,
                    'Used By Packages': versionInfo.usedBy.join('; '),
                    'Used By Grouped': this.groupPackagesByMeta(
                        versionInfo.usedBy,
                        dep.packageName,
                        versionInfo,
                        store,
                    ),
                    'Deprecated Transitive Dependencies': deprecatedTransitiveDeps.join('; '),
                    'Detail Link': `details/${detailFilename}`,
                });
            }
        }

        // Sort by package name then by usage count descending
        return rows.sort((a, b) => {
            const nameCompare = (a['Package Name'] as string).localeCompare(
                b['Package Name'] as string,
            );
            if (nameCompare !== 0) return nameCompare;
            return (b['Used By Count'] as number) - (a['Used By Count'] as number);
        });
    }

    /**
     * Generate detail HTML pages for each package@version combination.
     * Returns an array of DetailPage objects with filename and html content.
     * All data is pre-enriched, so no network requests are made.
     */
    toDetailPages(dependencies: DirectDependency[], store: FactStore): DetailPage[] {
        process.stderr.write('Generating detail pages...\n');
        const pages: DetailPage[] = [];
        let generated = 0;
        const total = dependencies.reduce((sum, dep) => sum + dep.versions.length, 0);

        for (const dep of dependencies) {
            for (const versionInfo of dep.versions) {
                const filename = HtmlWriter.getDetailFilename(dep.packageName, versionInfo.version);
                const html = this.generateDetailPage(dep, versionInfo, store);
                pages.push({ filename, html });

                generated++;
                if (generated % 100 === 0 || generated === total) {
                    process.stderr.write(`  Generated ${generated}/${total} pages\n`);
                }
            }
        }

        return pages;
    }

    /**
     * Generate a single detail page for a package@version.
     * Uses pre-enriched data, no network requests.
     */
    private generateDetailPage(
        dep: DirectDependency,
        versionInfo: DependencyVersion,
        store: FactStore,
    ): string {
        const packageName = dep.packageName;
        const description =
            store.getVersionFact<string>(packageName, versionInfo.version, FactKeys.DESCRIPTION) ??
            '';
        const homepage =
            store.getVersionFact<string>(packageName, versionInfo.version, FactKeys.HOMEPAGE) ?? '';
        const repositoryUrl =
            store.getVersionFact<string>(
                packageName,
                versionInfo.version,
                FactKeys.REPOSITORY_URL,
            ) ?? '';
        const bugsUrl =
            store.getVersionFact<string>(packageName, versionInfo.version, FactKeys.BUGS_URL) ?? '';
        const unpackedSize = store.getVersionFact<number>(
            packageName,
            versionInfo.version,
            FactKeys.UNPACKED_SIZE,
        );
        const npmUrl = `https://www.npmjs.com/package/${packageName}/v/${versionInfo.version}`;
        const npmGraphUrl = `https://npmgraph.js.org/?q=${encodeURIComponent(`${packageName}@${versionInfo.version}`)}`;

        // Get GitHub data from FactStore
        const githubData = store.getPackageFact<GitHubData>(packageName, FactKeys.GITHUB_DATA);
        const changelogUrl = githubData?.changelogUrl;
        const releases = githubData?.releases ?? [];

        // Get upgrade path data from FactStore
        const versionsBetween =
            store.getVersionFact<PackageVersionInfo[]>(
                packageName,
                versionInfo.version,
                FactKeys.VERSIONS_BETWEEN,
            ) ?? [];
        const compareUrl = store.getVersionFact<string>(
            packageName,
            versionInfo.version,
            FactKeys.COMPARE_URL,
        );

        // Prepare upgrade path data for template
        const upgradePathData = this.prepareUpgradePathData(
            packageName,
            versionInfo.version,
            versionInfo.latestVersion,
            versionsBetween,
            releases,
            githubData,
            compareUrl,
            unpackedSize,
        );

        // Group usedBy packages
        const usedByGrouped = this.groupPackagesByMeta(
            versionInfo.usedBy,
            packageName,
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
        const notes = this.composeNotes(packageName, versionInfo.version, store);

        // Build custom metadata for display on detail page
        const customMeta: Array<{ label: string; value: string }> = [];
        for (const col of this.columns) {
            const value = col.getValue(packageName, versionInfo, store);
            if (value) {
                customMeta.push({ label: col.header, value });
            }
        }

        // Get deprecated transitive deps
        const deprecatedTransitiveDeps =
            store.getPackageFact<string[]>(packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS) ?? [];

        // Render content using template
        const content = this.templateService.render('pages/package-detail', {
            packageName,
            version: versionInfo.version,
            description,
            customMeta: customMeta.length > 0 ? customMeta : undefined,
            dependencyTypes: versionInfo.dependencyTypes.join(', '),
            formattedPublishDate: formatDate(versionInfo.publishDate),
            publishDateAge: versionInfo.publishDate ? formatAgeHuman(versionInfo.publishDate) : '',
            latestVersion: versionInfo.latestVersion,
            versionsBehindText,
            inCatalog: versionInfo.inCatalog,
            notes,
            formattedInstalledSize: formatBytes(unpackedSize),
            upgradePath: upgradePathData,
            npmUrl,
            npmGraphUrl,
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
            title: `${packageName}@${versionInfo.version}`,
            siteName: this.siteName,
            content,
            baseHref: '../',
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
        packageName: string,
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
            const release = findReleaseForVersion(releases, v.version, packageName);
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
                npmUrl: v.npmUrl,
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

        return {
            hasVersionsBetween: true,
            currentVersion,
            latestVersion,
            versionCount: versionsBetween.length,
            compareUrl,
            versions,
        };
    }

    /**
     * Compute statistics for a group of dependencies.
     */
    private computeGroupStats(deps: DirectDependency[]): GroupStats {
        let outdatedCount = 0;
        let catalogCount = 0;
        const countedPackages = new Set<string>();

        for (const dep of deps) {
            for (const version of dep.versions) {
                if (!countedPackages.has(dep.packageName)) {
                    countedPackages.add(dep.packageName);
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
            totalPackages: countedPackages.size,
            outdatedCount,
            catalogCount,
        };
    }

    /**
     * Generate all grouping pages for a single grouping configuration.
     * Returns an index page and one detail page per unique annotation value.
     */
    toGroupingPages(
        dependencies: DirectDependency[],
        grouping: GroupingConfig,
        store: FactStore,
    ): { index: DetailPage; details: DetailPage[] } {
        const slug = grouping.slugPrefix ?? grouping.key;

        // Collect all dependencies for each unique grouping value
        const grouped = new Map<string, DirectDependency[]>();
        for (const dep of dependencies) {
            const value = grouping.getValue(dep.packageName, store);
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
            baseHref: '../',
            timestamp: new Date().toLocaleString(),
            groupings: this.groupings.map((g) => ({
                label: g.label,
                slug: g.slugPrefix ?? g.key,
            })),
        });

        const index: DetailPage = {
            filename: `${slug}/index.html`,
            html: indexHtml,
        };

        // Generate detail pages for each value
        const details: DetailPage[] = Array.from(grouped.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([value, deps]) => {
                const stats = groupStats.get(value) as GroupStats;
                const packages = deps.map((dep) => {
                    const version = dep.versions[0];
                    return {
                        packageName: dep.packageName,
                        version: version?.version ?? '',
                        latestVersion: version?.latestVersion ?? '',
                        detailLink: version
                            ? `../details/${HtmlWriter.getDetailFilename(dep.packageName, version.version)}`
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
                    packages,
                    count: deps.length,
                    stats,
                    sections,
                });

                const detailHtml = this.templateService.render('layouts/base', {
                    title: `${grouping.label}: ${value}`,
                    siteName: this.siteName,
                    content: detailContent,
                    baseHref: '../',
                    timestamp: new Date().toLocaleString(),
                    groupings: this.groupings.map((g) => ({
                        label: g.label,
                        slug: g.slugPrefix ?? g.key,
                    })),
                });

                return {
                    filename: `${slug}/${value}.html`,
                    html: detailHtml,
                };
            });

        return { index, details };
    }

    /**
     * Generate all grouping pages for all configured groupings.
     */
    toAllGroupingPages(dependencies: DirectDependency[], store: FactStore): DetailPage[] {
        if (this.groupings.length === 0) {
            return [];
        }

        const pages: DetailPage[] = [];

        for (const grouping of this.groupings) {
            const { index, details } = this.toGroupingPages(dependencies, grouping, store);
            pages.push(index);
            pages.push(...details);
        }

        return pages;
    }
}
