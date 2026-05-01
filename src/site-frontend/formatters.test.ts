import { describe, it, expect } from 'vitest';
import type { TabulatorCell, TabulatorInstance, RowData } from './types';
import {
    typeFormatter,
    notesFormatter,
    usedByFormatter,
    ageFormatter,
    versionsBehindFormatter,
    nameFormatter,
    versionFormatter,
    latestVersionFormatter,
    deprecatedFormatter,
} from './formatters';

function makeFakeElement(): HTMLElement {
    // Minimal mock that satisfies usedByFormatter's getElement().querySelector('details')
    return {
        querySelector: () => null,
        dataset: {},
    } as unknown as HTMLElement;
}

function makeCell(value: unknown, rowData?: Partial<RowData>): TabulatorCell {
    const fullRowData: RowData = {
        Dependency: 'test-pkg',
        Ecosystem: 'npm',
        Type: 'prod',
        Version: '1.0.0',
        'Latest Version': '2.0.0',
        'Versions Behind': 'Major x1',
        'Catalog?': false,
        'Published Date': '2024-01-01',
        Age: 365,
        Notes: '',
        'Used By Count': 0,
        'Used By': '',
        'Used By Grouped': null,
        'Deprecated Transitive Dependencies': '',
        'Detail Link': '',
        'Latest Version URL': 'https://www.npmjs.com/package/test-pkg/v/2.0.0',
        'Deprecated Dep URLs': [],
        ...rowData,
    };

    return {
        getValue: () => value as string | number | boolean,
        getRow: () => ({
            getData: () => fullRowData,
            getTable: () => ({ redraw: () => {} }) as unknown as TabulatorInstance,
        }),
        getElement: () => makeFakeElement(),
    };
}

describe('formatters', () => {
    describe('typeFormatter', () => {
        it('renders type pills', () => {
            const html = typeFormatter(makeCell('dev, prod'));
            expect(html).toContain('dep-type-pill');
            expect(html).toContain('Dev');
            expect(html).toContain('Prod');
        });

        it('returns empty for no value', () => {
            expect(typeFormatter(makeCell(''))).toBe('');
        });
    });

    describe('notesFormatter', () => {
        it('renders note badges', () => {
            const html = notesFormatter(makeCell('Patched, Forked'));
            expect(html).toContain('dep-notes-badge');
            expect(html).toContain('Patched');
            expect(html).toContain('Forked');
        });

        it('renders single note', () => {
            const html = notesFormatter(makeCell('Deprecated'));
            expect(html).toContain('dep-notes-badge deprecated');
            expect(html).toContain('Deprecated');
        });

        it('renders Patched as plain span (not a link)', () => {
            const html = notesFormatter(makeCell('Patched'));
            expect(html).toContain('<span class="dep-notes-badge patched">Patched</span>');
            expect(html).not.toContain('<a ');
        });

        it('returns empty for no value', () => {
            expect(notesFormatter(makeCell(''))).toBe('');
        });
    });

    describe('ageFormatter', () => {
        it('formats days', () => {
            expect(ageFormatter(makeCell(15))).toBe('15d');
        });

        it('formats months and days', () => {
            expect(ageFormatter(makeCell(45))).toBe('1mo15d');
        });

        it('formats years and months', () => {
            expect(ageFormatter(makeCell(400))).toBe('1y1mo');
        });

        it('returns empty for 0', () => {
            expect(ageFormatter(makeCell(0))).toBe('');
        });

        it('formats singular day', () => {
            expect(ageFormatter(makeCell(1))).toBe('1d');
        });
    });

    describe('versionsBehindFormatter', () => {
        it('renders patch pill', () => {
            const html = versionsBehindFormatter(makeCell('Patch x2'));
            expect(html).toContain('dep-version-behind-pill');
            expect(html).toContain('patch');
            expect(html).toContain('Patch x2');
        });

        it('renders minor pill', () => {
            const html = versionsBehindFormatter(makeCell('Minor x3'));
            expect(html).toContain('minor');
        });

        it('renders major pill', () => {
            const html = versionsBehindFormatter(makeCell('Major x1'));
            expect(html).toContain('major');
        });

        it('returns empty for no value', () => {
            expect(versionsBehindFormatter(makeCell(''))).toBe('');
        });
    });

    describe('nameFormatter', () => {
        it('renders link when detail link exists', () => {
            const cell = makeCell('test-pkg', { 'Detail Link': 'details/test.html' });
            const html = nameFormatter(cell);
            expect(html).toContain('<a href="details/test.html">test-pkg</a>');
        });

        it('renders plain text without detail link', () => {
            const cell = makeCell('test-pkg', { 'Detail Link': '' });
            const html = nameFormatter(cell);
            expect(html).toBe('test-pkg');
        });
    });

    describe('versionFormatter', () => {
        it('renders version as link when detail link exists', () => {
            const cell = makeCell('1.0.0', { 'Detail Link': 'details/test.html' });
            const html = versionFormatter(cell);
            expect(html).toContain('<a href="details/test.html">1.0.0</a>');
        });
    });

    describe('latestVersionFormatter', () => {
        it('renders npm link', () => {
            const cell = makeCell('2.0.0', { Dependency: 'test-pkg' });
            const html = latestVersionFormatter(cell);
            expect(html).toContain('https://www.npmjs.com/package/test-pkg/v/2.0.0');
        });

        it('returns empty for no value', () => {
            expect(latestVersionFormatter(makeCell(''))).toBe('');
        });
    });

    describe('deprecatedFormatter', () => {
        it('renders deprecated deps as pills with links', () => {
            const cell = makeCell('old-pkg@1.0.0; @scope/dep@2.0.0', {
                'Deprecated Dep URLs': [
                    'https://www.npmjs.com/package/old-pkg/v/1.0.0',
                    'https://www.npmjs.com/package/@scope/dep/v/2.0.0',
                ],
            });
            const html = deprecatedFormatter(cell);
            expect(html).toContain('dep-pill');
            expect(html).toContain('old-pkg@1.0.0');
            expect(html).toContain('@scope/dep@2.0.0');
            expect(html).toContain('href="https://www.npmjs.com/package/old-pkg/v/1.0.0"');
        });

        it('generates correct npm links for scoped packages', () => {
            const cell = makeCell('@scope/dep@2.0.0', {
                'Deprecated Dep URLs': ['https://www.npmjs.com/package/@scope/dep/v/2.0.0'],
            });
            const html = deprecatedFormatter(cell);
            expect(html).toContain('href="https://www.npmjs.com/package/@scope/dep/v/2.0.0"');
        });

        it('renders plain spans when no URLs provided', () => {
            const cell = makeCell('old-pkg@1.0.0', {
                'Deprecated Dep URLs': [],
            });
            const html = deprecatedFormatter(cell);
            expect(html).toContain('<span class="dep-pill">old-pkg@1.0.0</span>');
            expect(html).not.toContain('<a ');
        });

        it('returns empty for no value', () => {
            expect(deprecatedFormatter(makeCell(''))).toBe('');
        });
    });

    describe('usedByFormatter', () => {
        it('renders single team without details/summary', () => {
            const cell = makeCell('', {
                'Used By Grouped': { TeamA: ['pkg-a', 'pkg-b'] },
            });
            const html = usedByFormatter(cell);
            expect(html).toContain('dep-used-by-content');
            expect(html).toContain('TeamA:');
            expect(html).toContain('pkg-a');
            expect(html).toContain('pkg-b');
            expect(html).not.toContain('<details');
        });

        it('renders multiple teams with collapsible details', () => {
            const cell = makeCell('', {
                'Used By Grouped': {
                    TeamA: ['pkg-a'],
                    TeamB: ['pkg-b', 'pkg-c'],
                },
            });
            const html = usedByFormatter(cell);
            expect(html).toContain('<details');
            expect(html).toContain('TeamA (1)');
            expect(html).toContain('TeamB (2)');
        });

        it('sorts Unknown team last', () => {
            const cell = makeCell('', {
                'Used By Grouped': {
                    Unknown: ['pkg-x'],
                    Alpha: ['pkg-a'],
                },
            });
            const html = usedByFormatter(cell);
            // In the summary, Alpha should come before Unknown
            const alphaIndex = html.indexOf('Alpha');
            const unknownIndex = html.indexOf('Unknown');
            expect(alphaIndex).toBeLessThan(unknownIndex);
        });

        it('returns empty for empty groups', () => {
            const cell = makeCell('', {
                'Used By Grouped': {},
            });
            const html = usedByFormatter(cell);
            expect(html).toBe('');
        });

        it('renders flat pills when Used By Grouped is null', () => {
            const cell = makeCell('', {
                'Used By Grouped': null,
                'Used By': 'pkg-a; pkg-b; pkg-c',
            });
            const html = usedByFormatter(cell);
            expect(html).toContain('dep-pill');
            expect(html).toContain('pkg-a');
            expect(html).toContain('pkg-b');
            expect(html).toContain('pkg-c');
            expect(html).not.toContain('dep-team-label');
        });

        it('returns empty when Used By Grouped is null and no packages', () => {
            const cell = makeCell('', {
                'Used By Grouped': null,
                'Used By': '',
            });
            const html = usedByFormatter(cell);
            expect(html).toBe('');
        });
    });

    describe('ageFormatter edge cases', () => {
        it('formats exactly one year', () => {
            expect(ageFormatter(makeCell(365))).toBe('1y');
        });

        it('formats multiple years', () => {
            expect(ageFormatter(makeCell(730))).toBe('2y');
        });

        it('formats exact months without remaining days', () => {
            expect(ageFormatter(makeCell(30))).toBe('1mo');
        });

        it('formats multiple months', () => {
            expect(ageFormatter(makeCell(60))).toBe('2mo');
        });
    });

    describe('versionFormatter edge cases', () => {
        it('renders plain text without detail link', () => {
            const cell = makeCell('1.0.0', { 'Detail Link': '' });
            const html = versionFormatter(cell);
            expect(html).toBe('1.0.0');
        });
    });
});
