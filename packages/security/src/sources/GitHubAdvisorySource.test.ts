import { describe, it, expect } from 'vitest';
import { ECOSYSTEM_MAP, mapSeverity } from './GitHubAdvisorySource';

describe('ECOSYSTEM_MAP', () => {
    it('maps npm to npm', () => expect(ECOSYSTEM_MAP['npm']).toBe('npm'));
    it('maps pypi to pip', () => expect(ECOSYSTEM_MAP['pypi']).toBe('pip'));
    it('maps gomod to go', () => expect(ECOSYSTEM_MAP['gomod']).toBe('go'));
    it('maps cargo to rust', () => expect(ECOSYSTEM_MAP['cargo']).toBe('rust'));
    it('returns undefined for mise', () => expect(ECOSYSTEM_MAP['mise']).toBeUndefined());
});

describe('mapSeverity', () => {
    it('maps critical', () => expect(mapSeverity('critical')).toBe('critical'));
    it('maps high', () => expect(mapSeverity('high')).toBe('high'));
    it('maps medium', () => expect(mapSeverity('medium')).toBe('medium'));
    it('maps low', () => expect(mapSeverity('low')).toBe('low'));
    it('handles uppercase', () => expect(mapSeverity('HIGH')).toBe('high'));
    it('returns undefined for unknown', () => expect(mapSeverity('unknown')).toBeUndefined());
    it('returns undefined for empty string', () => expect(mapSeverity('')).toBeUndefined());
});
