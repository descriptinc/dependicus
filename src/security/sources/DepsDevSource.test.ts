import { describe, it, expect } from 'vitest';
import { ECOSYSTEM_MAP, deriveMaintenance } from './DepsDevSource';

describe('ECOSYSTEM_MAP', () => {
    it('maps npm to NPM', () => expect(ECOSYSTEM_MAP['npm']).toBe('NPM'));
    it('maps pypi to PYPI', () => expect(ECOSYSTEM_MAP['pypi']).toBe('PYPI'));
    it('maps gomod to GO', () => expect(ECOSYSTEM_MAP['gomod']).toBe('GO'));
    it('maps cargo to CARGO', () => expect(ECOSYSTEM_MAP['cargo']).toBe('CARGO'));
    it('returns undefined for mise', () => expect(ECOSYSTEM_MAP['mise']).toBeUndefined());
});

describe('deriveMaintenance', () => {
    it('returns stale for deprecated packages', () => {
        expect(deriveMaintenance({ isDefault: true, isDeprecated: true })).toBe('stale');
    });

    it('returns active for non-deprecated packages', () => {
        expect(deriveMaintenance({ isDefault: true, isDeprecated: false })).toBe('active');
        expect(deriveMaintenance({ isDefault: false, isDeprecated: false })).toBe('active');
        expect(deriveMaintenance({})).toBe('active');
    });

    it('treats deprecated as stale regardless of isDefault', () => {
        expect(deriveMaintenance({ isDefault: false, isDeprecated: true })).toBe('stale');
        expect(deriveMaintenance({ isDefault: true, isDeprecated: true })).toBe('stale');
    });
});
