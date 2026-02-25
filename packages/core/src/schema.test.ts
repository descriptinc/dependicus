import { describe, it, expect } from 'vitest';
import { parseDependicusOutput, dependicusOutputSchema } from './schema';

describe('schema', () => {
    const validInput = {
        metadata: {
            generatedAt: '2025-01-01T00:00:00.000Z',
            totalDependencies: 1,
            totalPackages: 1,
            deprecatedCount: 0,
        },
        dependencies: [
            {
                packageName: 'react',
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
        facts: {
            package: {
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
            expect(result.metadata.totalPackages).toBe(1);
            expect(result.dependencies).toHaveLength(1);
            expect(result.dependencies[0]?.packageName).toBe('react');
            expect(result.facts.package.react).toBeDefined();
        });

        it('accepts input with empty facts', () => {
            const minimal = {
                metadata: {
                    generatedAt: '2025-01-01T00:00:00.000Z',
                    totalDependencies: 0,
                    totalPackages: 0,
                    deprecatedCount: 0,
                },
                dependencies: [],
                facts: {
                    package: {},
                    version: {},
                },
            };
            const result = parseDependicusOutput(minimal);
            expect(result.dependencies).toHaveLength(0);
        });

        it('rejects missing metadata', () => {
            expect(() =>
                parseDependicusOutput({
                    dependencies: [],
                    facts: { package: {}, version: {} },
                }),
            ).toThrow();
        });

        it('rejects missing dependencies', () => {
            expect(() =>
                parseDependicusOutput({
                    metadata: {
                        generatedAt: '2025-01-01',
                        totalDependencies: 0,
                        totalPackages: 0,
                        deprecatedCount: 0,
                    },
                    facts: { package: {}, version: {} },
                }),
            ).toThrow();
        });

        it('rejects missing facts', () => {
            expect(() =>
                parseDependicusOutput({
                    metadata: {
                        generatedAt: '2025-01-01',
                        totalDependencies: 0,
                        totalPackages: 0,
                        deprecatedCount: 0,
                    },
                    dependencies: [],
                }),
            ).toThrow();
        });

        it('rejects invalid dependency type', () => {
            const invalid = {
                ...validInput,
                dependencies: [
                    {
                        packageName: 'react',
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
            };
            expect(() => parseDependicusOutput(invalid)).toThrow();
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
