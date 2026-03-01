import { describe, it, expect } from 'vitest';
import { resolveUrl, resolveUrlPatterns } from './urls';

describe('resolveUrl', () => {
    it('replaces placeholders with values', () => {
        expect(
            resolveUrl('https://example.com/{{name}}/v/{{version}}', {
                name: 'react',
                version: '18.2.0',
            }),
        ).toBe('https://example.com/react/v/18.2.0');
    });

    it('replaces missing vars with empty string', () => {
        expect(resolveUrl('https://example.com/{{name}}/v/{{version}}', { name: 'react' })).toBe(
            'https://example.com/react/v/',
        );
    });

    it('returns pattern unchanged when no placeholders', () => {
        expect(resolveUrl('https://example.com/static', {})).toBe('https://example.com/static');
    });

    it('handles empty pattern', () => {
        expect(resolveUrl('', { name: 'react' })).toBe('');
    });

    it('handles scoped package names', () => {
        expect(
            resolveUrl('https://www.npmjs.com/package/{{name}}/v/{{version}}', {
                name: '@scope/my-pkg',
                version: '1.0.0',
            }),
        ).toBe('https://www.npmjs.com/package/@scope/my-pkg/v/1.0.0');
    });

    it('does not replace single-brace placeholders', () => {
        expect(resolveUrl('https://example.com/{name}', { name: 'react' })).toBe(
            'https://example.com/{name}',
        );
    });
});

describe('resolveUrlPatterns', () => {
    it('resolves all patterns and sorts by label', () => {
        const result = resolveUrlPatterns(
            {
                Registry: 'https://npmjs.com/{{name}}/v/{{version}}',
                'Dependency Graph': 'https://npmgraph.js.org/?q={{name}}@{{version}}',
            },
            { name: 'react', version: '18.2.0' },
        );

        expect(result).toEqual([
            { label: 'Dependency Graph', url: 'https://npmgraph.js.org/?q=react@18.2.0' },
            { label: 'Registry', url: 'https://npmjs.com/react/v/18.2.0' },
        ]);
    });

    it('handles empty patterns object', () => {
        expect(resolveUrlPatterns({}, { name: 'react' })).toEqual([]);
    });
});
