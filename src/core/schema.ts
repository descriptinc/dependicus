import { z } from 'zod';
import type { DependicusOutput } from './types';

const dependencyVersionSchema = z.object({
    version: z.string(),
    latestVersion: z.string(),
    usedBy: z.array(z.string()),
    dependencyTypes: z.array(z.enum(['dev', 'prod'])),
    publishDate: z.union([z.string(), z.undefined()]),
    inCatalog: z.boolean(),
});

const directDependencySchema = z.object({
    name: z.string(),
    ecosystem: z.string().default('npm'),
    versions: z.array(dependencyVersionSchema),
});

const providerOutputSchema = z.object({
    name: z.string(),
    ecosystem: z.string().default('npm'),
    supportsCatalog: z.boolean(),
    installCommand: z.string().default('install'),
    urlPatterns: z.record(z.string(), z.string()).default({}),
    dependencies: z.array(directDependencySchema),
});

const serializedFactsSchema = z.object({
    dependency: z.record(z.string(), z.unknown()),
    version: z.record(z.string(), z.unknown()),
});

const dependicusOutputSchema = z.object({
    metadata: z.object({
        generatedAt: z.string(),
    }),
    providers: z.array(providerOutputSchema),
    facts: serializedFactsSchema,
});

export {
    dependencyVersionSchema,
    directDependencySchema,
    providerOutputSchema,
    serializedFactsSchema,
    dependicusOutputSchema,
};

/**
 * Validate and parse dependicus JSON output.
 * Throws a ZodError if the input does not match the expected schema.
 */
export function parseDependicusOutput(input: unknown): DependicusOutput {
    return dependicusOutputSchema.parse(input) as unknown as DependicusOutput;
}
