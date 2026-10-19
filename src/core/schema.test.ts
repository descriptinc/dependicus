import { describe, it, expect } from 'vitest';
import { parseDependicusOutput, dependicusOutputSchema } from './schema';

describe('schema', () => {
    const validInput = {
        metadata: {
            generatedAt: '2025-01-01T00:00:00.000Z',
        },
        providers: [
            {
                name: 'pnpm',
                supportsCatalog: true,
                dependencies: [
                    {
                        name: 'react',
                        versions: [
                            {
                                version: '18.2.0',
                                latestVersion: '19.0.0',
                                usedBy: ['@my/app'],
                                dependencyTypes: ['prod'],
                                publishDate: '2024-01-01T00:00:00.000Z',
                                inCatalog: true,
                            },
                        ],
                    },
                ],
            },
        ],
        facts: {
            dependency: {
                react: {
                    githubData: { owner: 'facebook', repo: 'react', releases: [] },
                },
            },
            version: {
                react: {
                    '18.2.0': {
                        isDeprecated: false,
                    },
                },
            },
        },
    };

    describe('parseDependicusOutput', () => {
        it('accepts valid input', () => {
            const result = parseDependicusOutput(validInput);
            expect(result.metadata.generatedAt).toBe('2025-01-01T00:00:00.000Z');
            expect(result.providers).toHaveLength(1);
            expect(result.providers[0]?.name).toBe('pnpm');
            expect(result.facts.dependency.react).toBeDefined();
        });

        it('keeps the provider fields the issue templates read', () => {
            const provider = {
                ...validInput.providers[0],
                installCommand: 'pnpm install',
                catalogFile: 'pnpm-workspace.yaml',
                updatePrefix: 'Update the version in:',
                updateSuffix: 'Then run `pnpm install`.',
                updateInstructions: 'Bump each package.',
                patchHint: 'Check the patches in `patches/` still apply.',
            };
            const result = parseDependicusOutput({ ...validInput, providers: [provider] });
            const { dependencies: _deps, ...kept } = result.providers[0]!;
            expect(kept).toEqual({
                name: 'pnpm',
                ecosystem: 'npm',
                supportsCatalog: true,
                installCommand: 'pnpm install',
                urlPatterns: {},
                catalogFile: 'pnpm-workspace.yaml',
                updatePrefix: 'Update the version in:',
                updateSuffix: 'Then run `pnpm install`.',
                updateInstructions: 'Bump each package.',
                patchHint: 'Check the patches in `patches/` still apply.',
            });
        });

        it('accepts input with empty facts', () => {
            const minimal = {
                metadata: {
                    generatedAt: '2025-01-01T00:00:00.000Z',
                },
                providers: [],
                facts: {
                    dependency: {},
                    version: {},
                },
            };
            const result = parseDependicusOutput(minimal);
            expect(result.providers).toHaveLength(0);
        });

        it('rejects missing metadata', () => {
            expect(() =>
                parseDependicusOutput({
                    providers: [],
                    facts: { dependency: {}, version: {} },
                }),
            ).toThrow();
        });

        it('rejects missing providers', () => {
            expect(() =>
                parseDependicusOutput({
                    metadata: {
                        generatedAt: '2025-01-01',
                    },
                    facts: { dependency: {}, version: {} },
                }),
            ).toThrow();
        });

        it('rejects missing facts', () => {
            expect(() =>
                parseDependicusOutput({
                    metadata: {
                        generatedAt: '2025-01-01',
                    },
                    providers: [],
                }),
            ).toThrow();
        });

        it('rejects invalid dependency type', () => {
            const invalid = {
                ...validInput,
                providers: [
                    {
                        name: 'pnpm',
                        supportsCatalog: true,
                        dependencies: [
                            {
                                name: 'react',
                                versions: [
                                    {
                                        version: '18.2.0',
                                        latestVersion: '19.0.0',
                                        usedBy: ['@my/app'],
                                        dependencyTypes: ['invalid'],
                                        publishDate: '2024-01-01',
                                        inCatalog: true,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            expect(() => parseDependicusOutput(invalid)).toThrow();
        });

        it('accepts versions with missing publishDate', () => {
            const input = {
                ...validInput,
                providers: [
                    {
                        name: 'mise',
                        supportsCatalog: false,
                        dependencies: [
                            {
                                name: 'node',
                                ecosystem: 'mise',
                                versions: [
                                    {
                                        version: '22.0.0',
                                        latestVersion: '24.0.0',
                                        usedBy: ['mise.toml'],
                                        dependencyTypes: ['prod' as const],
                                        inCatalog: false,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            const result = parseDependicusOutput(input);
            expect(result.providers[0]?.dependencies[0]?.versions[0]?.publishDate).toBeUndefined();
        });

        it('rejects non-object input', () => {
            expect(() => parseDependicusOutput('not an object')).toThrow();
            expect(() => parseDependicusOutput(42)).toThrow();
            // eslint-disable-next-line no-null/no-null
            expect(() => parseDependicusOutput(null)).toThrow();
        });
    });

    describe('dependicusOutputSchema', () => {
        it('safeParse returns success for valid input', () => {
            const result = dependicusOutputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        it('safeParse returns failure for invalid input', () => {
            const result = dependicusOutputSchema.safeParse({});
            expect(result.success).toBe(false);
        });
    });
});
