import { z } from 'zod';
import type { DependicusOutput } from './types';

const dependencyVersionSchema = z.object({
    version: z.string(),
    latestVersion: z.string(),
    usedBy: z.array(z.string()),
    dependencyTypes: z.array(z.enum(['dev', 'prod'])),
    publishDate: z.string(),
    inCatalog: z.boolean(),
});

const directDependencySchema = z.object({
    packageName: z.string(),
    versions: z.array(dependencyVersionSchema),
});

const serializedFactsSchema = z.object({
    package: z.record(z.string(), z.record(z.string(), z.unknown())),
    version: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
});

const dependicusOutputSchema = z.object({
    metadata: z.object({
        generatedAt: z.string(),
        totalDependencies: z.number(),
        totalPackages: z.number(),
        deprecatedCount: z.number(),
    }),
    dependencies: z.array(directDependencySchema),
    facts: serializedFactsSchema,
});

export {
    dependencyVersionSchema,
    directDependencySchema,
    serializedFactsSchema,
    dependicusOutputSchema,
};

/**
 * Validate and parse dependicus JSON output.
 * Throws a ZodError if the input does not match the expected schema.
 */
export function parseDependicusOutput(input: unknown): DependicusOutput {
    return dependicusOutputSchema.parse(input);
}
