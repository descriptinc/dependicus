import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CacheService } from '../../core/index';

vi.mock('node:child_process', () => ({
    spawnSync: vi.fn(),
    execFile: vi.fn(),
}));

import { spawnSync } from 'node:child_process';
import { DeprecationService } from './DeprecationService';

const mockSpawnSync = vi.mocked(spawnSync);

function createMockCacheService(overrides: Partial<CacheService> = {}): CacheService {
    return {
        isCacheValid: vi.fn().mockResolvedValue(false),
        readCache: vi.fn().mockResolvedValue(''),
        writeCache: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as CacheService;
}

function spawnResult({ stdout = '', stderr = '', status = 0 } = {}) {
    return { stdout, stderr, status, error: undefined } as unknown as ReturnType<typeof spawnSync>;
}

/** A `pnpm:deprecation` ndjson line as pnpm 10 through 12 emit it. */
function deprecationEvent(pkgName: string, pkgVersion: string, depth = 0): string {
    return JSON.stringify({
        time: 1789169555812,
        name: 'pnpm:deprecation',
        level: 'debug',
        pkgName,
        pkgVersion,
        pkgId: `${pkgName}@${pkgVersion}`,
        prefix: '/repo/packages/app',
        deprecated: 'no longer supported',
        depth,
    });
}

const unrelatedEvents = [
    JSON.stringify({ name: 'pnpm:scope', level: 'debug', selected: 2, total: 2 }),
    JSON.stringify({ name: 'pnpm:stage', level: 'debug', stage: 'resolution_done' }),
].join('\n');

describe('DeprecationService', () => {
    let tempDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), 'deprecation-service-test-'));
        writeFileSync(join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    describe('getDeprecatedPackages', () => {
        it('runs a pnpm install that works on pnpm 10 through 12', async () => {
            mockSpawnSync.mockReturnValue(spawnResult());
            const service = new DeprecationService(createMockCacheService(), tempDir);

            await service.getDeprecatedPackages();

            expect(mockSpawnSync).toHaveBeenCalledWith(
                'pnpm',
                [
                    'install',
                    '--lockfile-only',
                    '--no-frozen-lockfile',
                    '--no-prefer-frozen-lockfile',
                    '--config.optimistic-repeat-install=false',
                    '--reporter=ndjson',
                ],
                expect.objectContaining({ cwd: tempDir }),
            );
        });

        it('reads deprecation events from stdout, where pnpm 10 and 11 write them', async () => {
            mockSpawnSync.mockReturnValue(
                spawnResult({
                    stdout: [
                        unrelatedEvents,
                        deprecationEvent('request', '2.88.2'),
                        deprecationEvent('har-validator', '5.1.5', 1),
                    ].join('\n'),
                }),
            );
            const service = new DeprecationService(createMockCacheService(), tempDir);

            const deprecated = await service.getDeprecatedPackages();

            expect(deprecated).toEqual(new Set(['request@2.88.2', 'har-validator@5.1.5']));
        });

        it('reads deprecation events from stderr, where pnpm 12 writes them', async () => {
            mockSpawnSync.mockReturnValue(
                spawnResult({
                    stderr: [unrelatedEvents, deprecationEvent('glob', '7.2.3')].join('\n'),
                }),
            );
            const service = new DeprecationService(createMockCacheService(), tempDir);

            const deprecated = await service.getDeprecatedPackages();

            expect(deprecated).toEqual(new Set(['glob@7.2.3']));
        });

        it('handles scoped packages', async () => {
            mockSpawnSync.mockReturnValue(
                spawnResult({
                    stderr: deprecationEvent('@babel/plugin-proposal-optional-chaining', '7.21.0'),
                }),
            );
            const service = new DeprecationService(createMockCacheService(), tempDir);

            const deprecated = await service.getDeprecatedPackages();

            expect(deprecated).toEqual(
                new Set(['@babel/plugin-proposal-optional-chaining@7.21.0']),
            );
        });

        it('falls back to the pnpm 12 text warnings when no events are present', async () => {
            mockSpawnSync.mockReturnValue(
                spawnResult({
                    stdout: [
                        'Scope: all 2 workspace projects',
                        'packages/app                             | [WARN] deprecated glob@7.2.3',
                        'packages/app                             | [WARN] deprecated @babel/core@6.26.3',
                        '[WARN] 2 deprecated subdependencies found: inflight@1.0.6, uuid@3.4.0',
                        'Done in 378ms using pnpm v12.4.1',
                    ].join('\n'),
                }),
            );
            const service = new DeprecationService(createMockCacheService(), tempDir);

            const deprecated = await service.getDeprecatedPackages();

            expect(deprecated).toEqual(
                new Set(['glob@7.2.3', '@babel/core@6.26.3', 'inflight@1.0.6', 'uuid@3.4.0']),
            );
        });

        it('falls back to the pnpm 10 text warnings when no events are present', async () => {
            mockSpawnSync.mockReturnValue(
                spawnResult({
                    stdout: [
                        'services/api                             |  WARN  deprecated elevenlabs@1.59.0',
                        ' WARN  2 deprecated subdependencies found: inflight@1.0.6, uuid@3.4.0',
                    ].join('\n'),
                }),
            );
            const service = new DeprecationService(createMockCacheService(), tempDir);

            const deprecated = await service.getDeprecatedPackages();

            expect(deprecated).toEqual(
                new Set(['elevenlabs@1.59.0', 'inflight@1.0.6', 'uuid@3.4.0']),
            );
        });

        it('throws when pnpm exits non-zero', async () => {
            mockSpawnSync.mockReturnValue(
                spawnResult({ status: 1, stderr: "error: unexpected argument '--nope'" }),
            );
            const service = new DeprecationService(createMockCacheService(), tempDir);

            await expect(service.getDeprecatedPackages()).rejects.toThrow('exited with code 1');
        });

        it('caches the output and reuses it on the next call', async () => {
            const cacheService = createMockCacheService();
            mockSpawnSync.mockReturnValue(
                spawnResult({ stdout: deprecationEvent('request', '2.88.2') }),
            );
            const service = new DeprecationService(cacheService, tempDir);

            await service.getDeprecatedPackages();

            expect(cacheService.writeCache).toHaveBeenCalledWith(
                'pnpm-install-deprecations',
                expect.stringContaining('pnpm:deprecation'),
                join(tempDir, 'pnpm-lock.yaml'),
            );
        });

        it('reads from the cache instead of running pnpm when the cache is valid', async () => {
            const cacheService = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn().mockResolvedValue(deprecationEvent('glob', '7.2.3')),
            });
            const service = new DeprecationService(cacheService, tempDir);

            const deprecated = await service.getDeprecatedPackages();

            expect(mockSpawnSync).not.toHaveBeenCalled();
            expect(deprecated).toEqual(new Set(['glob@7.2.3']));
        });
    });

    describe('getDeprecationMap', () => {
        // parsePnpmWhyOutput is private, so exercise it through the map, which
        // reads `pnpm why` output straight from the cache.
        async function mapFromWhyOutput(whyOutput: string): Promise<Map<string, string[]>> {
            const cacheService = createMockCacheService({
                isCacheValid: vi.fn().mockResolvedValue(true),
                readCache: vi.fn(async (key: string) =>
                    key === 'pnpm-install-deprecations'
                        ? deprecationEvent('har-validator', '5.1.5', 1)
                        : whyOutput,
                ),
            } as unknown as Partial<CacheService>);
            const service = new DeprecationService(cacheService, tempDir);
            return service.getDeprecationMap();
        }

        it('parses the pnpm 10 and 11 project-tree shape', async () => {
            const whyOutput = JSON.stringify([
                { name: 'ws-root', version: '1.0.0', path: '/repo', private: true },
                {
                    name: 'app',
                    version: '1.0.0',
                    path: '/repo/packages/app',
                    dependencies: {
                        request: {
                            from: 'request',
                            version: '2.88.2',
                            dependencies: {
                                'har-validator': { from: 'har-validator', version: '5.1.5' },
                            },
                        },
                    },
                    devDependencies: {
                        jest: { from: 'jest', version: '29.0.0' },
                    },
                },
            ]);

            const map = await mapFromWhyOutput(whyOutput);

            expect(map.get('har-validator@5.1.5')).toEqual(['request', 'jest']);
        });

        it('parses the pnpm 12 dependents-tree shape', async () => {
            const whyOutput = JSON.stringify([
                {
                    name: 'har-validator',
                    version: '5.1.5',
                    path: '/repo/node_modules/.pnpm/har-validator@5.1.5/node_modules/har-validator',
                    dependents: [
                        {
                            name: 'request',
                            version: '2.88.2',
                            dependents: [
                                { name: 'app', version: '1.0.0', depField: 'dependencies' },
                            ],
                        },
                    ],
                },
            ]);

            const map = await mapFromWhyOutput(whyOutput);

            expect(map.get('har-validator@5.1.5')).toEqual(['request']);
        });

        it('treats a pnpm 12 package a project depends on directly as its own direct dep', async () => {
            const whyOutput = JSON.stringify([
                {
                    name: 'har-validator',
                    version: '5.1.5',
                    dependents: [{ name: 'app', version: '1.0.0', depField: 'dependencies' }],
                },
            ]);

            const map = await mapFromWhyOutput(whyOutput);

            expect(map.get('har-validator@5.1.5')).toEqual(['har-validator']);
        });

        it('collects every direct dependency in a branching pnpm 12 dependents tree', async () => {
            const whyOutput = JSON.stringify([
                {
                    name: 'har-validator',
                    version: '5.1.5',
                    dependents: [
                        {
                            name: 'request',
                            version: '2.88.2',
                            dependents: [
                                { name: 'app', version: '1.0.0', depField: 'dependencies' },
                            ],
                        },
                        {
                            name: 'deep',
                            version: '1.0.0',
                            dependents: [
                                {
                                    name: 'tooling',
                                    version: '1.0.0',
                                    dependents: [
                                        {
                                            name: 'api',
                                            version: '1.0.0',
                                            depField: 'devDependencies',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ]);

            const map = await mapFromWhyOutput(whyOutput);

            expect(map.get('har-validator@5.1.5')).toEqual(['request', 'tooling']);
        });

        it('omits packages whose why output names no direct dependency', async () => {
            const whyOutput = JSON.stringify([
                { name: 'har-validator', version: '5.1.5', dependents: [] },
            ]);

            const map = await mapFromWhyOutput(whyOutput);

            expect(map.has('har-validator@5.1.5')).toBe(false);
        });

        it('survives unparseable why output', async () => {
            const map = await mapFromWhyOutput('not json');

            expect(map.size).toBe(0);
        });
    });
});
