import { describe, it, expect } from 'vitest';
import type { RowData } from './types';
import { escapeCsvField, rowToCsvFields, buildCsvString, CSV_COLUMNS } from './csv-export';

function makeRow(overrides: Partial<RowData> = {}): RowData {
    return {
        Dependency: 'react',
        Ecosystem: 'npm',
        Type: 'prod',
        Version: '18.2.0',
        'Latest Version': '19.0.0',
        'Versions Behind': 'Major x1',
        'Catalog?': false,
        'Published Date': '2023-06-15',
        Age: 365,
        Notes: '',
        'Used By Count': 3,
        'Used By': 'app-a; app-b; app-c',
        'Used By Grouped': null,
        'Deprecated Transitive Dependencies': '',
        'Detail Link': 'details/react.html',
        ...overrides,
    };
}

describe('escapeCsvField', () => {
    it('returns plain values unchanged', () => {
        expect(escapeCsvField('hello')).toBe('hello');
    });

    it('wraps values containing commas in quotes', () => {
        expect(escapeCsvField('a,b')).toBe('"a,b"');
    });

    it('escapes double quotes inside values', () => {
        expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    });

    it('wraps values containing newlines in quotes', () => {
        expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });
});

describe('rowToCsvFields', () => {
    it('splits Type into Dev=false and Prod=true for prod-only', () => {
        const fields = rowToCsvFields(makeRow({ Type: 'prod' }));
        const devIdx = CSV_COLUMNS.indexOf('Dev');
        const prodIdx = CSV_COLUMNS.indexOf('Prod');
        expect(fields[devIdx]).toBe('false');
        expect(fields[prodIdx]).toBe('true');
    });

    it('splits Type into Dev=true and Prod=false for dev-only', () => {
        const fields = rowToCsvFields(makeRow({ Type: 'dev' }));
        const devIdx = CSV_COLUMNS.indexOf('Dev');
        const prodIdx = CSV_COLUMNS.indexOf('Prod');
        expect(fields[devIdx]).toBe('true');
        expect(fields[prodIdx]).toBe('false');
    });

    it('sets both Dev and Prod to true for "dev, prod"', () => {
        const fields = rowToCsvFields(makeRow({ Type: 'dev, prod' }));
        const devIdx = CSV_COLUMNS.indexOf('Dev');
        const prodIdx = CSV_COLUMNS.indexOf('Prod');
        expect(fields[devIdx]).toBe('true');
        expect(fields[prodIdx]).toBe('true');
    });

    it('serializes Catalog? as boolean string', () => {
        const catalogIdx = CSV_COLUMNS.indexOf('Catalog');

        const trueFields = rowToCsvFields(makeRow({ 'Catalog?': true }));
        expect(trueFields[catalogIdx]).toBe('true');

        const falseFields = rowToCsvFields(makeRow({ 'Catalog?': false }));
        expect(falseFields[catalogIdx]).toBe('false');
    });

    it('strips HTML tags from values', () => {
        const fields = rowToCsvFields(
            makeRow({ 'Used By': '<span class="dep-pill">app-a</span>; <span>app-b</span>' }),
        );
        const usedByIdx = CSV_COLUMNS.indexOf('Used By');
        expect(fields[usedByIdx]).toBe('app-a; app-b');
    });

    it('outputs plain text for Dependency (no link markup)', () => {
        const fields = rowToCsvFields(makeRow({ Dependency: 'react' }));
        expect(fields[0]).toBe('react');
    });

    it('outputs age as number string', () => {
        const fields = rowToCsvFields(makeRow({ Age: 42 }));
        const ageIdx = CSV_COLUMNS.indexOf('Age');
        expect(fields[ageIdx]).toBe('42');
    });

    it('outputs Used By Count as number string', () => {
        const fields = rowToCsvFields(makeRow({ 'Used By Count': 7 }));
        const countIdx = CSV_COLUMNS.indexOf('Used By Count');
        expect(fields[countIdx]).toBe('7');
    });
});

describe('buildCsvString', () => {
    it('starts with the header row', () => {
        const csv = buildCsvString([]);
        const headerLine = csv.split('\n')[0];
        expect(headerLine).toBe(CSV_COLUMNS.join(','));
    });

    it('produces one data row per input', () => {
        const csv = buildCsvString([makeRow(), makeRow({ Dependency: 'vue' })]);
        const lines = csv.trim().split('\n');
        expect(lines).toHaveLength(3); // header + 2 data rows
    });

    it('excludes Detail Link and Used By Grouped from output', () => {
        const csv = buildCsvString([makeRow()]);
        expect(csv).not.toContain('Detail Link');
        expect(csv).not.toContain('Used By Grouped');
    });

    it('does not include emoji tick/cross for catalog', () => {
        const csv = buildCsvString([makeRow({ 'Catalog?': true })]);
        expect(csv).not.toMatch(/[✓✗✔✘☑☐]/);
        expect(csv).toContain('true');
    });
});
