import { describe, it, expect, vi } from 'vitest';
import { GitHubSource } from './GitHubSource';
import { FactStore, FactKeys } from './FactStore';
import type { DirectDependency, GitHubData } from '../types';
import type {
    GitHubService,
    GitHubRepo,
    GitHubRelease,
    ChangelogInfo,
} from '../services/GitHubService';

function makeDep(packageName: string, version: string, latestVersion: string): DirectDependency {
    return {
        packageName,
        versions: [
            {
                version,
                latestVersion,
                usedBy: ['@my/app'],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01',
                inCatalog: false,
            },
        ],
    };
}

const fakeRepo: GitHubRepo = { owner: 'facebook', repo: 'react' };

const fakeReleases: GitHubRelease[] = [
    {
        tagName: 'v19.0.0',
        name: 'React 19.0.0',
        publishedAt: '2025-01-01',
        body: 'Release notes',
        htmlUrl: 'https://github.com/facebook/react/releases/tag/v19.0.0',
    },
];

const fakeChangelog: ChangelogInfo = {
    url: 'https://github.com/facebook/react/blob/main/CHANGELOG.md',
    filename: 'CHANGELOG.md',
};

function mockGitHubService(overrides: Partial<GitHubService> = {}): GitHubService {
    return {
        parseRepoUrl: vi.fn(() => undefined),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        prefetchRepoData: vi.fn(async () => {}),
        getReleases: vi.fn(async () => []),
        getChangelogUrl: vi.fn(async () => undefined),
        getCompareUrl: vi.fn(() => ''),
        findReleaseForVersion: vi.fn(() => undefined),
        detectTagFormat: vi.fn(() => (v: string) => `v${v}`),
        getReleaseUrl: vi.fn(() => ''),
        hasReleasesCache: vi.fn(async () => false),
        hasChangelogCache: vi.fn(() => false),
        ...overrides,
    } as unknown as GitHubService;
}

describe('GitHubSource', () => {
    it('has the correct name and depends on npm-registry', () => {
        const source = new GitHubSource(mockGitHubService());
        expect(source.name).toBe('github');
        expect(source.dependsOn).toEqual(['npm-registry']);
    });

    it('collects repo URLs from version facts and fetches', async () => {
        const parseRepoUrl = vi.fn(() => fakeRepo);
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const prefetchRepoData = vi.fn(async () => {});
        const service = mockGitHubService({ parseRepoUrl, prefetchRepoData });
        const source = new GitHubSource(service);
        const store = new FactStore();

        // Pre-populate rawRepoUrl facts (normally set by NpmRegistrySource)
        store.setVersionFact(
            'react',
            '18.2.0',
            FactKeys.RAW_REPO_URL,
            'git+https://github.com/facebook/react.git',
        );

        await source.fetch([makeDep('react', '18.2.0', '19.0.0')], store);

        expect(parseRepoUrl).toHaveBeenCalledWith('git+https://github.com/facebook/react.git');
        expect(prefetchRepoData).toHaveBeenCalledWith([fakeRepo]);
    });

    it('stores GITHUB_DATA as a package-level fact', async () => {
        const service = mockGitHubService({
            parseRepoUrl: vi.fn(() => fakeRepo),
            getReleases: vi.fn(async () => fakeReleases),
            getChangelogUrl: vi.fn(async () => fakeChangelog),
        });
        const source = new GitHubSource(service);
        const store = new FactStore();
        store.setVersionFact(
            'react',
            '18.2.0',
            FactKeys.RAW_REPO_URL,
            'https://github.com/facebook/react',
        );

        await source.fetch([makeDep('react', '18.2.0', '19.0.0')], store);

        const githubData = store.getPackageFact<GitHubData>('react', FactKeys.GITHUB_DATA);
        expect(githubData).toBeDefined();
        expect(githubData!.owner).toBe('facebook');
        expect(githubData!.repo).toBe('react');
        expect(githubData!.releases).toHaveLength(1);
        expect(githubData!.releases[0]!.tagName).toBe('v19.0.0');
        expect(githubData!.changelogUrl).toBe(
            'https://github.com/facebook/react/blob/main/CHANGELOG.md',
        );
    });

    it('stores COMPARE_URL for versions not at latest', async () => {
        const service = mockGitHubService({
            parseRepoUrl: vi.fn(() => fakeRepo),
            getReleases: vi.fn(async () => fakeReleases),
            getCompareUrl: vi.fn(
                () => 'https://github.com/facebook/react/compare/v18.2.0...v19.0.0',
            ),
        });
        const source = new GitHubSource(service);
        const store = new FactStore();
        store.setVersionFact(
            'react',
            '18.2.0',
            FactKeys.RAW_REPO_URL,
            'https://github.com/facebook/react',
        );

        await source.fetch([makeDep('react', '18.2.0', '19.0.0')], store);

        expect(store.getVersionFact('react', '18.2.0', FactKeys.COMPARE_URL)).toBe(
            'https://github.com/facebook/react/compare/v18.2.0...v19.0.0',
        );
    });

    it('does not store COMPARE_URL when version equals latestVersion', async () => {
        const getCompareUrl = vi.fn(() => 'should-not-be-stored');
        const service = mockGitHubService({
            parseRepoUrl: vi.fn(() => fakeRepo),
            getReleases: vi.fn(async () => fakeReleases),
            getCompareUrl,
        });
        const source = new GitHubSource(service);
        const store = new FactStore();
        store.setVersionFact(
            'react',
            '19.0.0',
            FactKeys.RAW_REPO_URL,
            'https://github.com/facebook/react',
        );

        await source.fetch([makeDep('react', '19.0.0', '19.0.0')], store);

        expect(getCompareUrl).not.toHaveBeenCalled();
        expect(store.getVersionFact('react', '19.0.0', FactKeys.COMPARE_URL)).toBeUndefined();
    });

    it('skips dependencies without a parseable repo URL', async () => {
        const service = mockGitHubService({
            parseRepoUrl: vi.fn(() => undefined),
        });
        const source = new GitHubSource(service);
        const store = new FactStore();
        // No rawRepoUrl set — simulating a package without a repository field

        await source.fetch([makeDep('some-pkg', '1.0.0', '2.0.0')], store);

        expect(store.getPackageFact('some-pkg', FactKeys.GITHUB_DATA)).toBeUndefined();
    });

    it('handles multiple dependencies with different repos', async () => {
        const vueRepo: GitHubRepo = { owner: 'vuejs', repo: 'core' };
        const parseRepoUrl = vi.fn((url: string | undefined) => {
            if (url?.includes('facebook')) return fakeRepo;
            if (url?.includes('vuejs')) return vueRepo;
            return undefined;
        });

        const service = mockGitHubService({
            parseRepoUrl,
            getReleases: vi.fn(async () => fakeReleases),
            getChangelogUrl: vi.fn(async () => undefined),
        });
        const source = new GitHubSource(service);
        const store = new FactStore();
        store.setVersionFact(
            'react',
            '18.2.0',
            FactKeys.RAW_REPO_URL,
            'https://github.com/facebook/react',
        );
        store.setVersionFact('vue', '3.3.0', 'rawRepoUrl', 'https://github.com/vuejs/core');

        const deps = [makeDep('react', '18.2.0', '19.0.0'), makeDep('vue', '3.3.0', '3.4.0')];

        await source.fetch(deps, store);

        const reactData = store.getPackageFact<GitHubData>('react', FactKeys.GITHUB_DATA);
        const vueData = store.getPackageFact<GitHubData>('vue', FactKeys.GITHUB_DATA);

        expect(reactData!.owner).toBe('facebook');
        expect(vueData!.owner).toBe('vuejs');
    });
});
