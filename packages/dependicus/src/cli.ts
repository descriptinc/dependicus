// Copyright 2026 Descript, Inc
import { join, basename, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { createDependicus } from '@dependicus/site-builder';
import { readDependicusJson } from '@dependicus/core';
import type { DirectDependency, FactStore } from '@dependicus/core';
import { reconcileTickets } from '@dependicus/linear';
import type { VersionContext, LinearIssueSpec } from '@dependicus/linear';
import { reconcileGitHubIssues } from '@dependicus/github-issues';
import type { GitHubIssueSpec } from '@dependicus/github-issues';
import type { VersionContext as GitHubVersionContext } from '@dependicus/github-issues';
import type { DependicusPlugin, ResolvedPlugins } from './plugin';
import { resolvePlugins } from './plugin';

/** @group Core Types */
export interface DependicusCliConfig {
    /** Name of the CLI binary. Defaults to `'dependicus'`. */
    cliName?: string;
    /** Root directory of the project. Defaults to `process.cwd()`. Can be overridden with `--repo-root`. */
    repoRoot?: string;
    /** Directory to write HTML and JSON output to. Defaults to `<repoRoot>/dependicus-out`. */
    outputDir?: string;
    /** Directory to store cached data from API calls. Defaults to `<repoRoot>/.dependicus-cache`. */
    cacheDir?: string;
    /** Base URL where the Dependicus site is published (used in Linear ticket links, etc.). */
    dependicusBaseUrl: string;
    /** Plugins that provide data sources, groupings, columns, and ticket callbacks. Defaults to `[]`. */
    plugins?: DependicusPlugin[];
    /** Name shown in the site heading and title tag. Defaults to `'Dependicus for <basename of repoRoot>'`. */
    siteName?: string;
    /** Linear ticket integration configuration. */
    linear?: {
        /** Given information about a package and specific version, return the ticket spec (policy, assignment, etc.) or undefined to skip. */
        getLinearIssueSpec?: (
            context: VersionContext,
            store: FactStore,
        ) => LinearIssueSpec | undefined;
        /** Number of days to wait before creating a new ticket for a newly-published version. */
        cooldownDays?: number;
        /** Whether to allow new ticket creation. Defaults to `true`. */
        allowNewTickets?: boolean;
    };
    /** GitHub Issues integration configuration. */
    github?: {
        /** Given information about a package and specific version, return the issue spec or undefined to skip. */
        getGitHubIssueSpec?: (
            context: GitHubVersionContext,
            store: FactStore,
        ) => GitHubIssueSpec | undefined;
        /** Number of days to wait before creating a new issue for a newly-published version. */
        cooldownDays?: number;
        /** Whether to allow new issue creation. Defaults to `true`. */
        allowNewIssues?: boolean;
    };
}

const JSON_FILENAME = 'dependencies.json';

async function loadDependencies(
    jsonPath: string,
    cliName: string,
): Promise<{ dependencies: DirectDependency[]; store: FactStore }> {
    return await readDependicusJson(jsonPath).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            process.stderr.write(
                `Error: No dependency data found at ${jsonPath}\n` +
                    `Run "${cliName} update" first to collect dependency data.\n`,
            );
            process.exit(1);
        }
        throw error;
    });
}

function createDependicusInstance(
    config: DependicusCliConfig & { repoRoot: string },
    resolved: ResolvedPlugins,
) {
    const siteName = config.siteName ?? `Dependicus for ${basename(config.repoRoot)}`;
    return createDependicus({
        repoRoot: config.repoRoot,
        outputDir: config.outputDir,
        cacheDir: config.cacheDir,
        sources: resolved.sources,
        siteName,
        groupings: resolved.groupings,
        columns: resolved.columns,
        getUsedByGroupKey: resolved.getUsedByGroupKey,
        getSections: resolved.getSections,
    });
}

const execFileAsync = promisify(execFile);

async function getGhAuthToken(): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync('gh', ['auth', 'token']);
        return stdout.trim() || undefined;
    } catch {
        return undefined;
    }
}

/** @group Core Types */
export function dependicusCli(config: DependicusCliConfig): {
    run(argv: string[]): Promise<void>;
} {
    const cliName = config.cliName ?? 'dependicus';

    return {
        async run(argv: string[]): Promise<void> {
            const program = new Command();
            program
                .name(cliName)
                .description(`Dependency analysis powered by Dependicus`)
                .option('--repo-root <path>', 'Root directory of the project (default: cwd)');

            // Resolve config that depends on --repo-root after Commander parses argv.
            function resolveConfig() {
                const repoRoot = resolve(
                    program.opts<{ repoRoot?: string }>().repoRoot ?? config.repoRoot ?? '.',
                );
                const effectiveConfig = { ...config, repoRoot };
                const resolved = resolvePlugins(effectiveConfig.plugins ?? [], effectiveConfig);
                const outputDir = effectiveConfig.outputDir ?? join(repoRoot, 'dependicus-out');
                const jsonPath = join(outputDir, JSON_FILENAME);
                return { repoRoot, effectiveConfig, resolved, outputDir, jsonPath };
            }

            program
                .command('update')
                .description('Collect and enrich dependency data (requires network)')
                .option('--html', 'Also generate HTML site after collecting data')
                .action(async (options: { html?: boolean }) => {
                    const { effectiveConfig, resolved, outputDir, jsonPath } = resolveConfig();
                    const dependicus = await createDependicusInstance(effectiveConfig, resolved);

                    process.stderr.write('Collecting dependencies...\n');
                    const { store, ...output } = await dependicus.collectData();

                    await mkdir(outputDir, { recursive: true });
                    await writeFile(jsonPath, JSON.stringify(output, undefined, 2), 'utf-8');

                    process.stderr.write(
                        `Wrote ${output.dependencies.length} packages to ${jsonPath}\n`,
                    );

                    if (options.html) {
                        await dependicus.generateSite(output.dependencies, store);
                        process.stderr.write(`Generated site in ${outputDir}\n`);
                    }
                });

            program
                .command('html')
                .description('Generate HTML site from enriched data (offline)')
                .option('--json-file <path>', 'Path to dependencies.json file')
                .action(async (options: { jsonFile?: string }) => {
                    const { effectiveConfig, resolved, outputDir, jsonPath } = resolveConfig();
                    const dependicus = await createDependicusInstance(effectiveConfig, resolved);
                    const effectivePath = options.jsonFile ?? jsonPath;

                    const { dependencies: deps, store } = await loadDependencies(
                        effectivePath,
                        cliName,
                    );
                    if (!options.jsonFile || process.env.DEPENDICUS_REFRESH_FACTS === '1') {
                        dependicus.refreshLocal(deps, store);
                    }

                    await dependicus.generateSite(deps, store);
                    process.stderr.write(`Generated site in ${outputDir}\n`);
                });

            const linearConfig = config.linear ?? {};
            program
                .command('make-linear-tickets')
                .description('Create/update Linear tickets for outdated dependencies')
                .option('--dry-run', 'Preview changes without creating or modifying tickets')
                .option('--json-file <path>', 'Path to dependencies.json file')
                .option('--linear-team-id <id>', 'Assign all tickets to this Linear team')
                .action(
                    async (options: {
                        dryRun?: boolean;
                        jsonFile?: string;
                        linearTeamId?: string;
                    }) => {
                        const linearApiKey = process.env.LINEAR_API_KEY;
                        if (!linearApiKey) {
                            process.stderr.write(
                                'Error: LINEAR_API_KEY environment variable is required\n',
                            );
                            process.exit(1);
                        }

                        const { effectiveConfig, resolved, jsonPath } = resolveConfig();

                        // If --linear-team-id is given, wrap getLinearIssueSpec to inject teamId
                        const teamIdOverride = options.linearTeamId as string | undefined;
                        const baseGetLinearIssueSpec = resolved.getLinearIssueSpec;
                        const effectiveGetLinearIssueSpec: typeof resolved.getLinearIssueSpec =
                            teamIdOverride && baseGetLinearIssueSpec
                                ? (ctx, s) => {
                                      const spec = baseGetLinearIssueSpec(ctx, s);
                                      if (!spec) return undefined;
                                      return { ...spec, teamId: teamIdOverride };
                                  }
                                : teamIdOverride
                                  ? () => ({ teamId: teamIdOverride })
                                  : resolved.getLinearIssueSpec;

                        const dependicus = await createDependicusInstance(
                            effectiveConfig,
                            resolved,
                        );
                        const effectivePath = options.jsonFile ?? jsonPath;
                        const { dependencies: deps, store } = await loadDependencies(
                            effectivePath,
                            cliName,
                        );
                        if (!options.jsonFile || process.env.DEPENDICUS_REFRESH_FACTS === '1') {
                            dependicus.refreshLocal(deps, store);
                        }

                        await reconcileTickets(
                            deps,
                            store,
                            {
                                linearApiKey,
                                dryRun: options.dryRun,
                                dependicusBaseUrl: effectiveConfig.dependicusBaseUrl,
                                cooldownDays: linearConfig.cooldownDays,
                                allowNewTickets: linearConfig.allowNewTickets,
                            },
                            effectiveGetLinearIssueSpec,
                        );
                    },
                );

            const githubConfig = config.github ?? {};
            program
                .command('make-github-issues')
                .description('Create/update GitHub issues for outdated dependencies')
                .option('--dry-run', 'Preview changes without creating or modifying issues')
                .option('--json-file <path>', 'Path to dependencies.json file')
                .option('--github-owner <owner>', 'GitHub repository owner')
                .option('--github-repo <repo>', 'GitHub repository name')
                .action(
                    async (options: {
                        dryRun?: boolean;
                        jsonFile?: string;
                        githubOwner?: string;
                        githubRepo?: string;
                    }) => {
                        const githubToken = process.env.GITHUB_TOKEN || (await getGhAuthToken());
                        if (!githubToken) {
                            process.stderr.write(
                                'Error: GITHUB_TOKEN environment variable is required (or install gh CLI and run `gh auth login`)\n',
                            );
                            process.exit(1);
                        }

                        const { effectiveConfig, resolved, jsonPath } = resolveConfig();

                        // If --github-owner/--github-repo are given, wrap getGitHubIssueSpec to inject them
                        const ownerOverride = options.githubOwner as string | undefined;
                        const repoOverride = options.githubRepo as string | undefined;
                        const baseGetGitHubIssueSpec = resolved.getGitHubIssueSpec;
                        const effectiveGetGitHubIssueSpec: typeof resolved.getGitHubIssueSpec =
                            (ownerOverride || repoOverride) && baseGetGitHubIssueSpec
                                ? (ctx, s) => {
                                      const spec = baseGetGitHubIssueSpec(ctx, s);
                                      if (!spec) return undefined;
                                      return {
                                          ...spec,
                                          ...(ownerOverride ? { owner: ownerOverride } : {}),
                                          ...(repoOverride ? { repo: repoOverride } : {}),
                                      };
                                  }
                                : ownerOverride || repoOverride
                                  ? () => ({
                                        owner: ownerOverride ?? '',
                                        repo: repoOverride ?? '',
                                    })
                                  : resolved.getGitHubIssueSpec;

                        const dependicus = await createDependicusInstance(
                            effectiveConfig,
                            resolved,
                        );
                        const effectivePath = options.jsonFile ?? jsonPath;
                        const { dependencies: deps, store } = await loadDependencies(
                            effectivePath,
                            cliName,
                        );
                        if (!options.jsonFile || process.env.DEPENDICUS_REFRESH_FACTS === '1') {
                            dependicus.refreshLocal(deps, store);
                        }

                        await reconcileGitHubIssues(
                            deps,
                            store,
                            {
                                githubToken,
                                dryRun: options.dryRun,
                                dependicusBaseUrl: effectiveConfig.dependicusBaseUrl,
                                cooldownDays: githubConfig.cooldownDays,
                                allowNewIssues: githubConfig.allowNewIssues,
                            },
                            effectiveGetGitHubIssueSpec,
                        );
                    },
                );

            await program.parseAsync(argv);
        },
    };
}
