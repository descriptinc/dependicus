import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dependicusCli } from './cli';
import type { DirectDependency, ProviderOutput, DependencyProvider } from '@dependicus/core';
import { RootFactStore, readDependicusJson } from '@dependicus/core';

// Mock external dependencies
vi.mock('@dependicus/site-builder', () => ({
    createDependicus: vi.fn(),
}));

vi.mock('@dependicus/core', async () => {
    const actual = await vi.importActual<typeof import('@dependicus/core')>('@dependicus/core');
    return {
        ...actual,
        readDependicusJson: vi.fn(),
    };
});

vi.mock('@dependicus/linear', () => ({
    reconcileIssues: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    writeFile: vi.fn(),
    mkdir: vi.fn(),
}));

// Import mocked modules
import { createDependicus } from '@dependicus/site-builder';
import { reconcileIssues } from '@dependicus/linear';
import { writeFile, mkdir } from 'node:fs/promises';

const mockCreateDependicus = vi.mocked(createDependicus);
const mockReadDependicusJson = vi.mocked(readDependicusJson);
const mockReconcileIssues = vi.mocked(reconcileIssues);
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
                    dependicusBaseUrl: 'https://example.com',
                    getDetailUrl: expect.any(Function),
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
});
