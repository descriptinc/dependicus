import { z } from 'zod';
import type { DependicusOutput } from './types';

const dependencyVersionSchema = z.object({
    version: z.string(),
    latestVersion: z.string(),
    usedBy: z.array(z.string()),
    dependencyTypes: z.array(z.enum(['dev', 'prod'])),
    publishDate: z.string().optional(),
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
    // The provider's issue-template text. Zod drops keys it doesn't know, so
    // each field a provider can set has to be named here or `update` writes
    // it and `make-linear-issues` reads it back as undefined.
    updatePrefix: z.string().optional(),
    updateSuffix: z.string().optional(),
    updateInstructions: z.string().optional(),
    catalogFile: z.string().optional(),
    patchHint: z.string().optional(),
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
