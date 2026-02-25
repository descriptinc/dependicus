import { describe, it, expect } from 'vitest';
import { findReleaseForVersion, detectTagFormat } from './releaseUtils';
import type { GitHubRelease } from '../types';

describe('releaseUtils', () => {
    describe('findReleaseForVersion', () => {
        const createRelease = (tagName: string): GitHubRelease => ({
            tagName,
            name: `Release ${tagName}`,
            publishedAt: '2025-01-01T00:00:00Z',
            body: '',
            htmlUrl: `https://github.com/owner/repo/releases/tag/${tagName}`,
        });

        it('should find release by v-prefixed tag', () => {
            const releases = [createRelease('v1.0.0'), createRelease('v1.1.0')];
            const result = findReleaseForVersion(releases, '1.0.0');
            expect(result?.tagName).toBe('v1.0.0');
        });

        it('should find release by non-prefixed tag', () => {
            const releases = [createRelease('1.0.0'), createRelease('1.1.0')];
            const result = findReleaseForVersion(releases, '1.0.0');
            expect(result?.tagName).toBe('1.0.0');
        });

        it('should find release by package@version tag', () => {
            const releases = [
                createRelease('my-package@1.0.0'),
                createRelease('my-package@1.1.0'),
            ];
            const result = findReleaseForVersion(releases, '1.0.0', 'my-package');
            expect(result?.tagName).toBe('my-package@1.0.0');
        });

        it('should find release by short name for scoped packages', () => {
            const releases = [createRelease('react-announce@1.0.0')];
            const result = findReleaseForVersion(releases, '1.0.0', '@radix-ui/react-announce');
            expect(result?.tagName).toBe('react-announce@1.0.0');
        });

        it('should return undefined when no matching release found', () => {
            const releases = [createRelease('v2.0.0')];
            const result = findReleaseForVersion(releases, '1.0.0');
            expect(result).toBeUndefined();
        });
    });

    describe('detectTagFormat', () => {
        const createRelease = (tagName: string): GitHubRelease => ({
            tagName,
            name: `Release ${tagName}`,
            publishedAt: '2025-01-01T00:00:00Z',
            body: '',
            htmlUrl: `https://github.com/owner/repo/releases/tag/${tagName}`,
        });

        it('should default to v-prefix when no releases', () => {
            const toTag = detectTagFormat([]);
            expect(toTag('1.0.0')).toBe('v1.0.0');
        });

        it('should detect v-prefix format', () => {
            const releases = [
                createRelease('v1.0.0'),
                createRelease('v1.1.0'),
                createRelease('v2.0.0'),
            ];
            const toTag = detectTagFormat(releases);
            expect(toTag('1.0.0')).toBe('v1.0.0');
        });

        it('should detect no-prefix format', () => {
            const releases = [
                createRelease('1.0.0'),
                createRelease('1.1.0'),
                createRelease('2.0.0'),
            ];
            const toTag = detectTagFormat(releases);
            expect(toTag('1.0.0')).toBe('1.0.0');
        });
    });
});
