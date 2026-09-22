import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPurl, ECOSYSTEM_MAP, lowestFixVersion, SnykSource, toFinding } from './SnykSource';
import type { SnykIssue } from './SnykSource';
import { RootFactStore } from '../../core/index';
import type { DirectDependency } from '../../core/index';
import { SECURITY_FINDINGS_KEY } from '../types';
import type { SecurityFinding } from '../types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

// Real responses, trimmed to the attributes the source reads. Each one also
// carries pages of markdown description that nothing here looks at.
function load(name: string): SnykIssue[] {
    return (JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as { data: SnykIssue[] }).data;
}

const lodash = load('lodash-4.17.15.json');
const gin = load('gin-1.6.0.json');
const react = load('react-18.2.0.json');
// Scored twice by Snyk: primary 2.4 on CVSS 4.0, secondary 7.2 on 3.1.
const multiCvss = load('snyk-1.1291.0.json');

describe('ECOSYSTEM_MAP', () => {
    it('maps npm to npm', () => expect(ECOSYSTEM_MAP['npm']).toBe('npm'));
    it('maps gomod to golang', () => expect(ECOSYSTEM_MAP['gomod']).toBe('golang'));
    it('returns undefined for mise', () => expect(ECOSYSTEM_MAP['mise']).toBeUndefined());
});

describe('buildPurl', () => {
    it('builds an npm purl', () => {
        expect(buildPurl('npm', 'lodash', '4.17.15')).toBe('pkg:npm/lodash@4.17.15');
    });

    it('keeps a scoped npm name intact', () => {
        expect(buildPurl('npm', '@types/node', '24.13.3')).toBe('pkg:npm/@types/node@24.13.3');
    });

    it('keeps a Go module path intact', () => {
        expect(buildPurl('gomod', 'github.com/gin-gonic/gin', 'v1.6.0')).toBe(
            'pkg:golang/github.com/gin-gonic/gin@v1.6.0',
        );
    });

    it('skips an ecosystem Snyk does not cover', () => {
        expect(buildPurl('mise', 'node', '24.18.0')).toBeUndefined();
    });
});

describe('toFinding', () => {
    it('reports nothing for a version with no issues', () => {
        expect(toFinding(react)).toBeUndefined();
    });

    it('takes the worst severity and the highest Snyk score', () => {
        const finding = toFinding(lodash);
        expect(finding?.severity).toBe('high');
        expect(finding?.cvssScore).toBe(8.6);
        expect(finding?.advisoryCount).toBe(8);
        expect(finding?.fixAvailable).toBe(true);
    });

    it("scores an issue from Snyk's primary CVSS entry, not the highest", () => {
        // Reporting 7.2 next to "low" is a grade contradicting its own score.
        const finding = toFinding(multiCvss);
        expect(finding?.severity).toBe('low');
        expect(finding?.cvssScore).toBe(2.4);
    });

    it('contributes one advisory ID per issue, preferring GHSA', () => {
        const ids = toFinding(lodash)?.advisoryIds ?? [];
        expect(ids).toHaveLength(lodash.length);
        expect(ids).toContain('GHSA-p6mc-m468-83gw');
        // Not the CVE alongside the GHSA for the same advisory, or counts double.
        expect(ids).not.toContain('CVE-2020-8203');
        // Two of these have no public alias, so they fall back to the Snyk ID.
        expect(ids).toContain('SNYK-JS-LODASH-608086');
    });

    it("prefers a Go advisory's GO id, which is what OSV keys on", () => {
        // gin has one advisory with a GO alias and no GHSA. Contributing its
        // CVE instead counts the same flaw twice in the merged advisory count.
        expect(toFinding(gin)?.advisoryIds).toContain('GO-2023-1737');
    });

    it('puts the advisory matching the reported severity first', () => {
        // Columns label a cell with the worst severity and link the first entry,
        // and Snyk returns gin's medium advisory ahead of its two highs.
        const finding = toFinding(gin);
        expect(finding?.advisories?.[0]?.severity).toBe(finding?.severity);
        expect(finding?.sourceLinks?.[0]?.label).toBe(finding?.advisories?.[0]?.id);
    });

    it('reports exploit maturity, which no free source carries', () => {
        expect(toFinding(lodash)?.rationale).toContain('Snyk exploit maturity: Proof of Concept');
    });

    it('ignores a Not Defined exploit maturity', () => {
        // Two of gin's three are Not Defined; the third is a PoC.
        expect(toFinding(gin)?.rationale).toContain('Snyk exploit maturity: Proof of Concept');
    });

    it('reads a fix from a comma-separated upgrade list', () => {
        // Snyk lists one fix per supported release line.
        const issue: SnykIssue = {
            id: 'SNYK-JS-THING-1',
            attributes: {
                effective_severity_level: 'high',
                coordinates: [{ remedies: [{ details: { upgrade_package: '1.20.6,2.3.0' } }] }],
            },
        };
        expect(toFinding([issue])?.fixAvailable).toBe(true);
    });

    it('links each advisory to its Snyk page', () => {
        expect(toFinding(gin)?.sourceLinks?.[0]?.url).toMatch(
            /^https:\/\/security\.snyk\.io\/vuln\/SNYK-GOLANG-/,
        );
    });

    it('labels itself so merged columns can attribute it', () => {
        expect(toFinding(gin)?.source).toBe('snyk');
        expect(toFinding(gin)?.sourceLabel).toBe('Snyk');
    });
});

describe('SnykSource.fetch', () => {
    const cache = {
        isCacheValid: vi.fn().mockResolvedValue(false),
        readCache: vi.fn(),
        writeCache: vi.fn().mockResolvedValue(undefined),
        hasPermanentCache: vi.fn().mockReturnValue(false),
        readPermanentCache: vi.fn(),
        writePermanentCache: vi.fn().mockResolvedValue(undefined),
    };

    const dependency: DirectDependency = {
        name: 'lodash',
        ecosystem: 'npm',
        versions: [
            {
                version: '4.17.15',
                latestVersion: '4.17.21',
                usedBy: ['app'],
                dependencyTypes: ['prod'],
                publishDate: undefined,
                inCatalog: false,
            },
        ],
    };

    function page(body: unknown): Response {
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: () => Promise.resolve(body),
        } as unknown as Response;
    }

    function findings(store: RootFactStore): SecurityFinding[] {
        return (
            store
                .scoped('npm')
                .getVersionFact<SecurityFinding[]>('lodash', '4.17.15', SECURITY_FINDINGS_KEY) ?? []
        );
    }

    beforeEach(() => {
        vi.resetAllMocks();
        cache.readPermanentCache.mockResolvedValue(undefined);
        cache.writePermanentCache.mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn());
        process.env.SNYK_API_TOKEN = 'test-token';
    });

    it('follows links.next, because Snyk pages ten issues at a time', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(
                page({ data: lodash.slice(0, 2), links: { next: '/rest/next-page' } }),
            )
            .mockResolvedValueOnce(page({ data: lodash.slice(2) }));

        const source = new SnykSource({ orgId: 'org' });
        source.setCacheService(cache as never);
        const store = new RootFactStore();
        await source.fetch([dependency], store);

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(findings(store)[0]?.advisoryCount).toBe(lodash.length);
    });

    it('treats a cache entry that will not parse as a miss', async () => {
        cache.readPermanentCache.mockResolvedValue('{ truncated');
        vi.mocked(fetch).mockResolvedValueOnce(page({ data: lodash }));

        const source = new SnykSource({ orgId: 'org' });
        source.setCacheService(cache as never);
        const store = new RootFactStore();
        // This threw from inside the batch, which failed the whole run.
        await source.fetch([dependency], store);

        expect(findings(store)[0]?.advisoryCount).toBe(lodash.length);
    });

    it('keeps going when one body is unreadable', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: () => Promise.reject(new Error('Unexpected end of JSON input')),
        } as unknown as Response);

        const source = new SnykSource({ orgId: 'org' });
        source.setCacheService(cache as never);
        const store = new RootFactStore();
        await source.fetch([dependency], store);

        expect(findings(store)).toEqual([]);
    });
});

describe('lowestFixVersion', () => {
    it('takes the fix on the current release line', () => {
        // body-parser 1.20.1: patched on 1.x, and again on 2.x.
        expect(lowestFixVersion('1.20.1', [['1.20.6', '2.3.0']])).toBe('1.20.6');
    });

    it('moves up a line when one advisory is only fixed there', () => {
        expect(lowestFixVersion('1.20.1', [['1.20.6', '2.3.0'], ['2.0.0']])).toBe('2.3.0');
    });

    it('needs every advisory fixed, not just the latest fix', () => {
        expect(lowestFixVersion('4.17.15', [['4.17.17'], ['4.17.21'], ['4.18.1']])).toBe('4.18.1');
    });

    it('treats minors as release lines below 1.0', () => {
        expect(lowestFixVersion('0.32.5', [['0.32.6', '0.33.5']])).toBe('0.32.6');
    });

    it('ignores advisories with no fix', () => {
        expect(lowestFixVersion('1.0.0', [[], ['1.0.3']])).toBe('1.0.3');
        expect(lowestFixVersion('1.0.0', [[]])).toBeUndefined();
    });

    it('ignores fixes at or below the current version', () => {
        expect(lowestFixVersion('2.0.0', [['1.9.0', '2.0.0']])).toBeUndefined();
    });
});

describe('toFinding fix versions', () => {
    it("lists each advisory's fixes and the lowest version fixing them all", () => {
        const finding = toFinding(lodash, '4.17.15');
        expect(finding?.fixVersion).toBe('4.18.1');
        expect(finding?.advisories?.every((a) => a.fixVersions?.length)).toBe(true);
        expect(toFinding(gin, '1.6.0')?.fixVersion).toBe('1.9.1');
    });

    it('leaves the fix version out without the current version', () => {
        expect(toFinding(lodash)?.fixVersion).toBeUndefined();
    });
});
