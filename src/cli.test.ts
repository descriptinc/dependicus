import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dependicusCli } from './cli';
import type { DirectDependency, ProviderOutput, DependencyProvider } from './core/index';
import { RootFactStore, readDependicusJson } from './core/index';

// Mock external dependencies
vi.mock('./site-builder/index', () => ({
    createDependicus: vi.fn(),
}));

vi.mock('./core/index', async () => {
    const actual = await vi.importActual<typeof import('./core/index')>('./core/index');
    return {
        ...actual,
        readDependicusJson: vi.fn(),
    };
});

vi.mock('./linear/index', () => ({
    reconcileIssues: vi.fn(),
}));

vi.mock('./github-issues/index', () => ({
    reconcileGitHubIssues: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    writeFile: vi.fn(),
    mkdir: vi.fn(),
}));

// Import mocked modules
import { createDependicus } from './site-builder/index';
import { reconcileIssues } from './linear/index';
import { reconcileGitHubIssues } from './github-issues/index';
import { writeFile, mkdir } from 'node:fs/promises';

const mockCreateDependicus = vi.mocked(createDependicus);
const mockReadDependicusJson = vi.mocked(readDependicusJson);
const mockReconcileIssues = vi.mocked(reconcileIssues);
const mockReconcileGitHubIssues = vi.mocked(reconcileGitHubIssues);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

function makeDep(name: string): DirectDependency {
    return {
        name,
        ecosystem: 'npm',
        versions: [
            {
                version: '1.0.0',
                latestVersion: '2.0.0',
                usedBy: [],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01T00:00:00.000Z',
                inCatalog: false,
            },
        ],
    };
}

function makeProvider(deps: DirectDependency[]): ProviderOutput {
    return {
        name: 'pnpm',
        ecosystem: 'npm',
        supportsCatalog: false,
        installCommand: 'pnpm install',
        urlPatterns: {},
        dependencies: deps,
    };
}

function makeStore(): RootFactStore {
    return new RootFactStore();
}

function argv(...args: string[]): string[] {
    return ['node', 'dependicus', ...args];
}

const mockProvider: DependencyProvider = {
    name: 'mock',
    ecosystem: 'npm',
    rootDir: '/repo',
    lockfilePath: '/repo/mock.lock',
    supportsCatalog: false,
    installCommand: 'mock install',
    urlPatterns: {},
    getPackages: vi.fn().mockResolvedValue([]),
    isInCatalog: vi.fn().mockReturnValue(false),
    hasInCatalog: vi.fn().mockReturnValue(false),
    isPatched: vi.fn().mockReturnValue(false),
    createSources: vi.fn().mockReturnValue([]),
    resolveVersionMetadata: vi.fn().mockResolvedValue(new Map()),
};

describe('dependicusCli', () => {
    const baseConfig = {
        repoRoot: '/repo',
        outputDir: '/repo/out',
        dependicusBaseUrl: 'https://example.com',
        providers: [mockProvider],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const savedEnv: Record<string, string | undefined> = {};

    afterEach(() => {
        for (const [key, val] of Object.entries(savedEnv)) {
            if (val === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = val;
            }
        }
    });

    function setEnv(key: string, value: string | undefined) {
        savedEnv[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    describe('update command', () => {
        it('calls collectData and writes JSON', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            const mockInstance = {
                collectData: vi.fn().mockResolvedValue({
                    metadata: { generatedAt: '2025-01-01' },
                    providers,
                    facts: {},
                    store,
                }),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('update'));

            expect(mockCreateDependicus).toHaveBeenCalledWith(
                expect.objectContaining({ repoRoot: '/repo', outputDir: '/repo/out' }),
            );
            expect(mockInstance.collectData).toHaveBeenCalled();
            expect(mockMkdir).toHaveBeenCalledWith('/repo/out', { recursive: true });
            expect(mockWriteFile).toHaveBeenCalledWith(
                '/repo/out/dependencies.json',
                expect.any(String),
                'utf-8',
            );
            expect(mockInstance.generateSite).not.toHaveBeenCalled();
        });

        it('also generates site when --html is passed', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            const mockInstance = {
                collectData: vi.fn().mockResolvedValue({
                    metadata: { generatedAt: '2025-01-01' },
                    providers,
                    facts: {},
                    store,
                }),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('update', '--html'));

            expect(mockInstance.generateSite).toHaveBeenCalledWith(providers, store);
        });
    });

    describe('html command', () => {
        it('loads JSON and generates site', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('html'));

            expect(mockReadDependicusJson).toHaveBeenCalledWith('/repo/out/dependencies.json');
            expect(mockInstance.generateSite).toHaveBeenCalledWith(providers, store);
        });

        it('uses custom JSON path with --json-file', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('html', '--json-file', '/custom/deps.json'));

            expect(mockReadDependicusJson).toHaveBeenCalledWith('/custom/deps.json');
        });
    });

    describe('make-linear-issues command', () => {
        const linearConfig = {
            ...baseConfig,
            dependicusBaseUrl: 'https://example.com',
            linear: {
                cooldownDays: 7,
                allowNewIssues: true,
            },
        };

        it('calls reconcileIssues with correct args', async () => {
            setEnv('LINEAR_API_KEY', 'test-key');
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            mockReconcileIssues.mockResolvedValue({
                created: 0,
                updated: 0,
                closed: 0,
                closedDuplicates: 0,
            });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(linearConfig);
            await cli.run(argv('make-linear-issues'));

            expect(mockReconcileIssues).toHaveBeenCalledWith(
                deps,
                store,
                {
                    linearApiKey: 'test-key',
                    dryRun: undefined,
                    getDetailUrl: expect.any(Function),
                    providerInfoMap: expect.any(Map),
                    cooldownDays: 7,
                    allowNewIssues: true,
                },
                undefined,
            );
        });

        it('passes --dry-run flag', async () => {
            setEnv('LINEAR_API_KEY', 'test-key');
            const providers = [makeProvider([])];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            mockReconcileIssues.mockResolvedValue({
                created: 0,
                updated: 0,
                closed: 0,
                closedDuplicates: 0,
            });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(linearConfig);
            await cli.run(argv('make-linear-issues', '--dry-run'));

            expect(mockReconcileIssues).toHaveBeenCalled();
            const config = mockReconcileIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('dryRun', true);
        });

        it('is not registered when linear config is omitted', async () => {
            const cli = dependicusCli(baseConfig);
            // Commander will throw/exit for unknown commands
            const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
                throw new Error('process.exit');
            });

            try {
                await cli.run(argv('make-linear-issues'));
            } catch {
                // expected
            }

            exitSpy.mockRestore();
            stderrWrite.mockRestore();
        });
    });

    describe('refreshLocal', () => {
        it('calls refreshLocal by default when no --json-file', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('html'));

            // refreshLocal receives merged deps (same as input since single provider)
            expect(mockInstance.refreshLocal).toHaveBeenCalledWith(deps, store);
        });

        it('skips refreshLocal with --json-file unless DEPENDICUS_REFRESH_FACTS=1', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            setEnv('DEPENDICUS_REFRESH_FACTS', undefined);

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('html', '--json-file', '/custom/deps.json'));

            expect(mockInstance.refreshLocal).not.toHaveBeenCalled();
        });

        it('calls refreshLocal with --json-file when DEPENDICUS_REFRESH_FACTS=1', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            const mockInstance = {
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            setEnv('DEPENDICUS_REFRESH_FACTS', '1');

            const cli = dependicusCli(baseConfig);
            await cli.run(argv('html', '--json-file', '/custom/deps.json'));

            expect(mockInstance.refreshLocal).toHaveBeenCalledWith(deps, store);
        });
    });

    describe('defaults', () => {
        it('uses dependicus-out as default outputDir', async () => {
            const deps = [makeDep('react')];
            const providers = [makeProvider(deps)];
            const store = makeStore();
            const mockInstance = {
                collectData: vi.fn().mockResolvedValue({
                    metadata: { generatedAt: '2025-01-01' },
                    providers,
                    facts: {},
                    store,
                }),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli({
                repoRoot: '/my-repo',
                dependicusBaseUrl: 'https://example.com',
                providers: [mockProvider],
            });
            await cli.run(argv('update'));

            expect(mockMkdir).toHaveBeenCalledWith('/my-repo/dependicus-out', {
                recursive: true,
            });
            expect(mockWriteFile).toHaveBeenCalledWith(
                '/my-repo/dependicus-out/dependencies.json',
                expect.any(String),
                'utf-8',
            );
        });
    });

    describe('global options', () => {
        it('--output-dir overrides default output directory', async () => {
            const mockInstance = {
                collectData: vi.fn().mockResolvedValue({
                    metadata: { generatedAt: '2025-01-01' },
                    providers: [makeProvider([makeDep('react')])],
                    facts: {},
                    store: makeStore(),
                }),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli({
                repoRoot: '/repo',
                dependicusBaseUrl: 'https://example.com',
                providers: [mockProvider],
            });
            await cli.run(argv('--output-dir', '/custom/output', 'update'));

            expect(mockMkdir).toHaveBeenCalledWith('/custom/output', { recursive: true });
            expect(mockWriteFile).toHaveBeenCalledWith(
                '/custom/output/dependencies.json',
                expect.any(String),
                'utf-8',
            );
        });

        it('--cache-dir overrides default cache directory', async () => {
            const mockInstance = {
                collectData: vi.fn().mockResolvedValue({
                    metadata: { generatedAt: '2025-01-01' },
                    providers: [makeProvider([])],
                    facts: {},
                    store: makeStore(),
                }),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli({
                repoRoot: '/repo',
                dependicusBaseUrl: 'https://example.com',
                providers: [mockProvider],
            });
            await cli.run(argv('--cache-dir', '/custom/cache', 'update'));

            expect(mockCreateDependicus).toHaveBeenCalledWith(
                expect.objectContaining({ cacheDir: '/custom/cache' }),
            );
        });

        it('--site-name overrides default site name', async () => {
            const mockInstance = {
                collectData: vi.fn().mockResolvedValue({
                    metadata: { generatedAt: '2025-01-01' },
                    providers: [makeProvider([])],
                    facts: {},
                    store: makeStore(),
                }),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            };
            mockCreateDependicus.mockResolvedValue(mockInstance);

            const cli = dependicusCli({
                repoRoot: '/repo',
                dependicusBaseUrl: 'https://example.com',
                providers: [mockProvider],
            });
            await cli.run(argv('--site-name', 'My Custom Name', 'update'));

            expect(mockCreateDependicus).toHaveBeenCalledWith(
                expect.objectContaining({ siteName: 'My Custom Name' }),
            );
        });
    });

    describe('make-linear-issues flags', () => {
        const linearConfig = {
            ...baseConfig,
            dependicusBaseUrl: 'https://example.com',
            linear: {
                cooldownDays: 7,
                allowNewIssues: true,
                skipStateNames: ['done'],
            },
        };

        function setupLinearMocks() {
            const providers = [makeProvider([makeDep('react')])];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            mockReconcileIssues.mockResolvedValue({
                created: 0,
                updated: 0,
                closed: 0,
                closedDuplicates: 0,
            });
            mockCreateDependicus.mockResolvedValue({
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            });
        }

        it('--cooldown-days overrides config value', async () => {
            setEnv('LINEAR_API_KEY', 'test-key');
            setupLinearMocks();

            const cli = dependicusCli(linearConfig);
            await cli.run(argv('make-linear-issues', '--cooldown-days', '14'));

            const config = mockReconcileIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('cooldownDays', 14);
        });

        it('--no-new-issues sets allowNewIssues to false', async () => {
            setEnv('LINEAR_API_KEY', 'test-key');
            setupLinearMocks();

            const cli = dependicusCli(linearConfig);
            await cli.run(argv('make-linear-issues', '--no-new-issues'));

            const config = mockReconcileIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('allowNewIssues', false);
        });

        it('--skip-state populates skipStateNames (repeatable)', async () => {
            setEnv('LINEAR_API_KEY', 'test-key');
            setupLinearMocks();

            const cli = dependicusCli(linearConfig);
            await cli.run(
                argv('make-linear-issues', '--skip-state', 'pr', '--skip-state', 'verify'),
            );

            const config = mockReconcileIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('skipStateNames', ['pr', 'verify']);
        });

        it('--rate-limit-days overrides config value', async () => {
            setEnv('LINEAR_API_KEY', 'test-key');
            setupLinearMocks();

            const cli = dependicusCli(linearConfig);
            await cli.run(argv('make-linear-issues', '--rate-limit-days', '7'));

            const config = mockReconcileIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('rateLimitDays', 7);
        });
    });

    describe('make-github-issues flags', () => {
        const githubConfig = {
            ...baseConfig,
            dependicusBaseUrl: 'https://example.com',
            github: {
                cooldownDays: 3,
                allowNewIssues: true,
            },
        };

        function setupGitHubMocks() {
            const providers = [makeProvider([makeDep('react')])];
            const store = makeStore();
            mockReadDependicusJson.mockResolvedValue({ providers, store });
            mockReconcileGitHubIssues.mockResolvedValue({
                created: 0,
                updated: 0,
                closed: 0,
                closedDuplicates: 0,
                skipped: 0,
            });
            mockCreateDependicus.mockResolvedValue({
                collectData: vi.fn(),
                generateSite: vi.fn(),
                refreshLocal: vi.fn(),
            });
        }

        it('--cooldown-days overrides config value', async () => {
            setEnv('GITHUB_TOKEN', 'test-token');
            setupGitHubMocks();

            const cli = dependicusCli(githubConfig);
            await cli.run(argv('make-github-issues', '--cooldown-days', '10'));

            const config = mockReconcileGitHubIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('cooldownDays', 10);
        });

        it('--no-new-issues sets allowNewIssues to false', async () => {
            setEnv('GITHUB_TOKEN', 'test-token');
            setupGitHubMocks();

            const cli = dependicusCli(githubConfig);
            await cli.run(argv('make-github-issues', '--no-new-issues'));

            const config = mockReconcileGitHubIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('allowNewIssues', false);
        });

        it('--rate-limit-days overrides config value', async () => {
            setEnv('GITHUB_TOKEN', 'test-token');
            setupGitHubMocks();

            const cli = dependicusCli(githubConfig);
            await cli.run(argv('make-github-issues', '--rate-limit-days', '14'));

            const config = mockReconcileGitHubIssues.mock.calls[0]![2];
            expect(config).toHaveProperty('rateLimitDays', 14);
        });
    });
});
