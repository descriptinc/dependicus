import type { RowData } from './types';

export const CSV_COLUMNS = [
    'Dependency',
    'Ecosystem',
    'Dev',
    'Prod',
    'Version',
    'Latest Version',
    'Versions Behind',
    'Catalog',
    'Published Date',
    'Age',
    'Notes',
    'Used By Count',
    'Used By',
    'Deprecated Transitive Dependencies',
] as const;

export function escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function stripHtml(value: string): string {
    return value.replace(/<[^>]*>/g, '');
}

export function rowToCsvFields(row: RowData): string[] {
    const typeStr = String(row.Type ?? '').toLowerCase();
    const isDev = typeStr.includes('dev');
    const isProd = typeStr.includes('prod');

    return CSV_COLUMNS.map((col) => {
        switch (col) {
            case 'Dev':
                return String(isDev);
            case 'Prod':
                return String(isProd);
            case 'Catalog':
                return String(Boolean(row['Catalog?']));
            case 'Age':
                return String(row.Age ?? '');
            case 'Used By Count':
                return String(row['Used By Count'] ?? '');
            case 'Used By':
                return stripHtml(String(row['Used By'] ?? ''));
            default:
                return stripHtml(String(row[col] ?? ''));
        }
    });
}

export function buildCsvString(rows: RowData[]): string {
    const header = CSV_COLUMNS.map(escapeCsvField).join(',');
    const body = rows.map((row) => rowToCsvFields(row).map(escapeCsvField).join(',')).join('\n');
    return `${header}\n${body}\n`;
}

export function exportToCsv(rows: RowData[], filename: string): void {
    const csv = buildCsvString(rows);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
