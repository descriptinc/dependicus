/**
 * Row data structure matching the CSV/table format
 */
export interface RowData {
    'Package Name': string;
    Type: string;
    Version: string;
    'Latest Version': string;
    'Versions Behind': string;
    'Catalog?': boolean;
    'Published Date': string;
    Age: number; // days as number for sorting
    Notes: string;
    'Used By Count': number;
    'Used By Packages': string;
    'Used By Grouped': Record<string, string[]> | null; // packages grouped by owner team
    'Deprecated Transitive Dependencies': string;
    'Detail Link': string; // relative path to detail page
    [key: string]: string | number | boolean | Record<string, string[]> | null;
}

/**
 * Grouping slug info passed from Node.js so the browser can construct
 * links from annotation keys to grouping pages.
 */
export interface GroupingSlug {
    key: string;
    slug: string;
}

/**
 * Column definition passed from Node.js to the browser for custom metadata columns.
 */
export interface BrowserColumnDef {
    key: string;
    header: string;
    width?: number;
    filter?: 'input' | 'list';
    filterValues?: Record<string, string>;
    hasTooltip?: boolean;
    hasFilterValue?: boolean;
}

/**
 * Data passed from Node.js to browser via global variable
 */
export interface DependicusData {
    allData: RowData[];
    multiVersionData: RowData[];
    catalogData: RowData[];
    uniqueNotes: string[];
    customColumns: BrowserColumnDef[];
    groupings: GroupingSlug[];
}

/**
 * Minimal Tabulator type declarations
 * (Full types would require @types/tabulator-tables)
 */
export interface TabulatorCell {
    getValue(): string | number | boolean;
    getRow(): TabulatorRow;
    getElement(): HTMLElement;
}

export interface TabulatorRow {
    getData(): RowData;
    getTable(): TabulatorInstance;
}

export interface TabulatorColumn {
    field?: string;
    title?: string;
    frozen?: boolean;
    width?: number;
    minWidth?: number;
    formatter?: string | ((cell: TabulatorCell) => string);
    headerFilter?: string | boolean;
    headerFilterPlaceholder?: string;
    headerFilterFunc?:
        | string
        | ((headerValue: string, rowValue: string) => boolean)
        | ((
              headerValue: string,
              rowValue: string,
              rowData: Record<string, unknown>,
          ) => boolean);
    headerFilterParams?: Record<string, unknown>;
    responsive?: number;
    resizable?: boolean;
    variableHeight?: boolean;
    hozAlign?: string;
    sorter?: string;
}

export interface TabulatorConfig {
    data: RowData[];
    columns: TabulatorColumn[];
    layout: string;
    height: string;
    pagination: boolean;
    initialSort: Array<{ column: string; dir: string }>;
    headerSortTristate: boolean;
    virtualDom: boolean;
    responsiveLayout: 'collapse' | 'hide' | false;
    rowHeader?: {
        headerSort: boolean;
        resizable: boolean;
        frozen: boolean;
        width: number;
        minWidth: number;
        formatter: string;
    };
    persistence?: {
        columns: boolean;
    };
    persistenceID?: string;
    groupBy?: string;
    groupStartOpen?: boolean;
    groupHeader?: (value: string, count: number) => string;
}

export interface TabulatorInstance {
    on(event: 'dataFiltered', callback: (filters: unknown, rows: RowData[]) => void): void;
    on(event: 'tableBuilt', callback: () => void): void;
    redraw(): void;
    destroy(): void;
    setHeaderFilterValue(field: string, value: string): void;
}

/**
 * Global variable declaration for data passed from Node.js
 */
declare global {
    interface Window {
        dependicusData: DependicusData;
    }
}
