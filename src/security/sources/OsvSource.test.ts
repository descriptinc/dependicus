import { describe, it, expect } from 'vitest';
import {
    severityFromScore,
    cvssBaseScore,
    parseSeverity,
    hasFixedVersion,
    pickWorstSeverity,
    ECOSYSTEM_MAP,
} from './OsvSource';
import type { OsvVulnerability } from './OsvSource';

describe('severityFromScore', () => {
    it('maps 0 to none', () => expect(severityFromScore(0)).toBe('none'));
    it('maps 0.1 to low', () => expect(severityFromScore(0.1)).toBe('low'));
    it('maps 3.9 to low', () => expect(severityFromScore(3.9)).toBe('low'));
    it('maps 4.0 to medium', () => expect(severityFromScore(4.0)).toBe('medium'));
    it('maps 6.9 to medium', () => expect(severityFromScore(6.9)).toBe('medium'));
    it('maps 7.0 to high', () => expect(severityFromScore(7.0)).toBe('high'));
    it('maps 8.9 to high', () => expect(severityFromScore(8.9)).toBe('high'));
    it('maps 9.0 to critical', () => expect(severityFromScore(9.0)).toBe('critical'));
    it('maps 10.0 to critical', () => expect(severityFromScore(10.0)).toBe('critical'));
});

describe('cvssBaseScore', () => {
    it('parses a CVSS v3.1 vector', () => {
        const score = cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H');
        expect(score).toBe(10.0);
    });

    it('parses a CVSS v4.0 vector', () => {
        const score = cvssBaseScore(
            'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H',
        );
        expect(score).toBeGreaterThanOrEqual(9.0);
    });

    it('returns undefined for CVSS v2 vectors (not supported)', () => {
        expect(cvssBaseScore('AV:N/AC:L/Au:N/C:C/I:C/A:C')).toBeUndefined();
    });

    it('returns undefined for garbage input', () => {
        expect(cvssBaseScore('not-a-vector')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        expect(cvssBaseScore('')).toBeUndefined();
    });
});

describe('parseSeverity', () => {
    it('returns undefined for empty array', () => {
        expect(parseSeverity([])).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(parseSeverity(undefined)).toBeUndefined();
    });

    it('prefers CVSS_V3 over CVSS_V4', () => {
        const result = parseSeverity([
            {
                type: 'CVSS_V4',
                score: 'CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N',
            },
            { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' },
        ]);
        expect(result).toBe('critical');
    });

    it('uses CVSS_V4 when V3 is absent', () => {
        const result = parseSeverity([
            {
                type: 'CVSS_V4',
                score: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H',
            },
        ]);
        expect(result).toBe('critical');
    });

    it('falls back to medium for CVSS_V2 (v2 scoring not supported)', () => {
        const result = parseSeverity([{ type: 'CVSS_V2', score: 'AV:N/AC:L/Au:N/C:C/I:C/A:C' }]);
        expect(result).toBe('medium');
    });

    it('falls back to medium for unknown type', () => {
        expect(parseSeverity([{ type: 'UNKNOWN', score: 'whatever' }])).toBe('medium');
    });

    it('skips unparseable vectors and falls back to medium', () => {
        // V3 entry with garbage vector, V2 entry (unsupported) — both unscored
        const result = parseSeverity([
            { type: 'CVSS_V3', score: 'garbage' },
            { type: 'CVSS_V2', score: 'AV:N/AC:L/Au:N/C:C/I:C/A:C' },
        ]);
        expect(result).toBe('medium');
    });
});

describe('hasFixedVersion', () => {
    it('returns true when a fixed event exists', () => {
        const vuln: OsvVulnerability = {
            id: 'TEST-001',
            affected: [
                {
                    ranges: [
                        {
                            type: 'ECOSYSTEM',
                            events: [{ introduced: '0' }, { fixed: '1.2.3' }],
                        },
                    ],
                },
            ],
        };
        expect(hasFixedVersion(vuln)).toBe(true);
    });

    it('returns false when no fixed event exists', () => {
        const vuln: OsvVulnerability = {
            id: 'TEST-002',
            affected: [
                {
                    ranges: [
                        {
                            type: 'ECOSYSTEM',
                            events: [{ introduced: '0' }],
                        },
                    ],
                },
            ],
        };
        expect(hasFixedVersion(vuln)).toBe(false);
    });

    it('returns false for empty affected', () => {
        expect(hasFixedVersion({ id: 'TEST-003' })).toBe(false);
    });
});

describe('pickWorstSeverity', () => {
    it('returns undefined for empty array', () => {
        expect(pickWorstSeverity([])).toBeUndefined();
    });

    it('returns the single severity', () => {
        expect(pickWorstSeverity(['low'])).toBe('low');
    });

    it('picks the worst from mixed severities', () => {
        expect(pickWorstSeverity(['low', 'critical', 'medium'])).toBe('critical');
    });

    it('returns none when all are none', () => {
        expect(pickWorstSeverity(['none', 'none'])).toBe('none');
    });
});

describe('ECOSYSTEM_MAP', () => {
    it('maps npm to npm', () => expect(ECOSYSTEM_MAP['npm']).toBe('npm'));
    it('maps pypi to PyPI', () => expect(ECOSYSTEM_MAP['pypi']).toBe('PyPI'));
    it('maps gomod to Go', () => expect(ECOSYSTEM_MAP['gomod']).toBe('Go'));
    it('maps cargo to crates.io', () => expect(ECOSYSTEM_MAP['cargo']).toBe('crates.io'));
    it('returns undefined for mise', () => expect(ECOSYSTEM_MAP['mise']).toBeUndefined());
});
