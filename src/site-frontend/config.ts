import type { TabulatorColumn, TabulatorConfig, RowData, BrowserColumnDef } from './types';
import {
    notesFormatter,
    usedByFormatter,
    ageFormatter,
    versionsBehindFormatter,
    nameFormatter,
    versionFormatter,
    latestVersionFormatter,
    deprecatedFormatter,
    typeFormatter,
} from './formatters';

/**
 * Create column definitions with all enhancements
 */
export function createColumnDefs(
    uniqueNotes: string[],
    customColumns: BrowserColumnDef[],
    options?: { hasCatalog?: boolean },
): TabulatorColumn[] {
    const hasCatalog = options?.hasCatalog ?? true;
    const columns: TabulatorColumn[] = [
        {
            title: 'Dependency',
            field: 'Dependency',
            frozen: true,
            width: 250,
            minWidth: 150,
            formatter: nameFormatter,
            headerFilter: 'input',
            headerFilterPlaceholder: 'Filter dependencies...',
            headerFilterFunc: 'like',
            responsive: 0, // Never collapse
        },
        {
            title: 'Type',
            field: 'Type',
            width: 120,
            minWidth: 100,
            formatter: typeFormatter,
            headerFilter: 'list',
            headerFilterParams: {
                values: { '': 'All', dev: 'Dev', prod: 'Prod' },
            },
            headerFilterFunc: (headerValue: string, rowValue: string) => {
                if (!headerValue) return true;
                return rowValue.toLowerCase().includes(headerValue.toLowerCase());
            },
            responsive: 1, // Collapse second
        },
        {
            title: 'Version',
            field: 'Version',
            width: 120,
            minWidth: 80,
            formatter: versionFormatter,
            headerFilter: 'input',
            headerFilterPlaceholder: 'Filter version...',
            responsive: 0, // Never collapse
        },
        {
            title: 'Latest',
            field: 'Latest Version',
            width: 100,
            minWidth: 80,
            formatter: latestVersionFormatter,
            responsive: 1, // Collapse second
        },
        {
            title: 'Behind',
            field: 'Versions Behind',
            width: 100,
            minWidth: 80,
            formatter: versionsBehindFormatter,
            headerFilter: 'list',
            headerFilterParams: {
                values: {
                    '': 'All',
                    'Out of Date': 'Out of Date',
                    Patch: 'Patch',
                    Minor: 'Minor',
                    Major: 'Major',
                },
            },
            headerFilterFunc: (headerValue: string, rowValue: string) => {
                if (!headerValue) return true;
                if (headerValue === 'Out of Date') {
                    return rowValue !== '';
                }
                return rowValue.startsWith(headerValue);
            },
            responsive: 1, // Collapse second
        },
        ...(hasCatalog
            ? [
                  {
                      title: 'Catalog?',
                      field: 'Catalog?',
                      width: 100,
                      minWidth: 100,
                      hozAlign: 'center',
                      formatter: 'tickCross',
                      headerFilter: 'tickCross',
                      headerFilterParams: { tristate: true },
                      responsive: 1, // Collapse second
                  } as TabulatorColumn,
              ]
            : []),
        {
            title: 'Published Date',
            field: 'Published Date',
            width: 130,
            minWidth: 120,
            responsive: 2, // Collapse first
        },
        {
            title: 'Age',
            field: 'Age',
            width: 75,
            minWidth: 60,
            formatter: ageFormatter,
            sorter: 'number',
            responsive: 2, // Collapse first
        },
        {
            title: 'Notes',
            field: 'Notes',
            width: 100,
            minWidth: 60,
            formatter: notesFormatter,
            headerFilter: 'list',
            headerFilterParams: {
                values: { '': 'All', ...Object.fromEntries(uniqueNotes.map((n) => [n, n])) },
            },
            headerFilterPlaceholder: 'All notes',
            responsive: 1, // Collapse second
        },
    ];

    // Insert custom columns after Age/Notes, before # used
    for (const col of customColumns) {
        const colDef: TabulatorColumn = {
            title: col.header,
            field: col.key,
            width: col.width ?? 180,
            minWidth: 100,
            responsive: 1,
        };

        if (col.hasTooltip) {
            const tooltipKey = `${col.key}__tooltip`;
            colDef.formatter = (cell) => {
                const value = cell.getValue();
                if (!value) return '';
                const rowData = cell.getRow().getData();
                const tooltip = rowData[tooltipKey];
                if (tooltip) {
                    return `<span title="${String(tooltip)}">${String(value)}</span>`;
                }
                return String(value);
            };
        } else {
            colDef.formatter = 'html';
        }

        if (col.filter === 'input') {
            colDef.headerFilter = 'input';
            colDef.headerFilterPlaceholder = `Filter ${col.header.toLowerCase()}...`;
            if (col.hasFilterValue) {
                const filterKey = `${col.key}__filterValue`;
                colDef.headerFilterFunc = (
                    headerValue: string,
                    _rowValue: string,
                    rowData: Record<string, unknown>,
                ) => {
                    if (!headerValue) return true;
                    const filterValue = String(rowData[filterKey] ?? '');
                    return filterValue.toLowerCase().includes(headerValue.toLowerCase());
                };
            } else {
                colDef.headerFilterFunc = 'like';
            }
        } else if (col.filter === 'list') {
            colDef.headerFilter = 'list';
            colDef.headerFilterParams = {
                values: col.filterValues ?? { '': 'All' },
            };
            if (col.hasFilterValue) {
                const filterKey = `${col.key}__filterValue`;
                colDef.headerFilterFunc = (
                    headerValue: string,
                    _rowValue: string,
                    rowData: Record<string, unknown>,
                ) => {
                    if (!headerValue) return true;
                    return String(rowData[filterKey] ?? '') === headerValue;
                };
            }
        }

        columns.push(colDef);
    }

    columns.push(
        {
            title: '# used',
            field: 'Used By Count',
            width: 90,
            minWidth: 80,
            hozAlign: 'right',
            headerFilter: 'number',
            headerFilterPlaceholder: 'Min...',
            headerFilterFunc: '>=',
            responsive: 1, // Collapse second
        },
        {
            title: 'Used By',
            field: 'Used By',
            width: 300,
            minWidth: 150,
            formatter: usedByFormatter,
            variableHeight: true,
            headerFilter: 'input',
            headerFilterPlaceholder: 'Filter...',
            headerFilterFunc: 'like',
            responsive: 2, // Collapse first
            resizable: true,
        },
        {
            title: 'Deprecated Transitive Dependencies',
            field: 'Deprecated Transitive Dependencies',
            width: 300,
            minWidth: 200,
            formatter: deprecatedFormatter,
            variableHeight: true,
            headerFilter: 'input',
            headerFilterPlaceholder: 'Filter deps...',
            headerFilterFunc: 'like',
            responsive: 2, // Collapse first
            resizable: true,
        },
    );

    return columns;
}

/**
 * Common table configuration
 */
export function getTableConfig(
    data: RowData[],
    elementId: string,
    columnDefs: TabulatorColumn[],
    options: { groupBy?: string } = {},
): TabulatorConfig {
    const config: TabulatorConfig = {
        data: data,
        columns: columnDefs,
        layout: 'fitDataFill',
        height: '100%',
        pagination: false,
        initialSort: [
            { column: 'Used By Count', dir: 'desc' },
            { column: 'Dependency', dir: 'asc' },
        ],
        headerSortTristate: true,
        virtualDom: true,
        responsiveLayout: 'collapse',
        rowHeader: {
            headerSort: false,
            resizable: false,
            frozen: true,
            width: 40,
            minWidth: 40,
            formatter: 'responsiveCollapse',
        },
        persistence: {
            columns: true,
        },
        persistenceID: `dependicus-${elementId}`,
    };

    // Add grouping if specified
    if (options.groupBy) {
        config.groupBy = options.groupBy;
        config.groupStartOpen = true;
        config.groupHeader = function (value: string, count: number) {
            return `<strong>${value}</strong> <span style="color:#666; margin-left:8px;">(${count} version${count > 1 ? 's' : ''})</span>`;
        };
    }

    return config;
}
