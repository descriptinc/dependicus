import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DataSource, DirectDependency, FactStore } from '../core/index';
import { FactKeys } from '../core/index';

const execFileAsync = promisify(execFile);

/**
 * A package from `go list -json=... ./...`, which emits a concatenated JSON
 * stream rather than an array.
 */
interface GoPackageEntry {
    ImportPath: string;
    Name?: string;
    Imports?: string[];
    TestImports?: string[];
    XTestImports?: string[];
}

/** What one module's package graph says about who uses a dependency. */
interface ModuleUsage {
    /** Module path -> import paths of the first-party packages importing it. */
    importedBy: Map<string, Set<string>>;
    /** Module path -> import paths of the main packages that reach it. */
    binaries: Map<string, Set<string>>;
}

/**
 * Records which of a Go module's own packages import each dependency, and
 * which of its binaries reach it.
 *
 * `go list -m` sees a module as one unit, so a backend with many binaries
 * under `cmd/` attributes every dependency to the module and reads as a
 * single consumer. This doesn't change that attribution. It publishes the
 * import graph as facts instead, so a grouping or column can map a dependency
 * to the teams that own the packages using it, the way the Node providers'
 * per-workspace-package attribution already allows.
 *
 * Both facts are import paths, because that is what Go actually knows. What
 * counts as a service, and who owns it, is a question for the repo.
 *
 * `goImportedBy` counts an import from a test file, since the package does
 * depend on it. `goBinaries` doesn't follow test imports onward, because a
 * package's tests aren't part of what its binary ships.
 *
 * Reading imports needs the module's sources, not only the `go.mod` files
 * `go list -m all` fetches. When they aren't there the facts are skipped and
 * everything else carries on.
 */
export class GoImportGraphSource implements DataSource {
    readonly name = 'go-import-graph';
    readonly dependsOn: readonly string[] = [];

    constructor(private readonly projectPaths: readonly string[]) {}

    async fetch(dependencies: DirectDependency[], store: FactStore): Promise<void> {
        const moduleNames = new Set(dependencies.map((d) => d.name));
        if (moduleNames.size === 0) return;

        const importedBy = new Map<string, Set<string>>();
        const binaries = new Map<string, Set<string>>();

        for (const projectPath of this.projectPaths) {
            const usage = await this.readModuleUsage(projectPath, moduleNames);
            if (!usage) continue;
            mergeInto(importedBy, usage.importedBy);
            mergeInto(binaries, usage.binaries);
        }

        for (const dependency of dependencies) {
            const importers = importedBy.get(dependency.name);
            if (importers?.size) {
                store.setDependencyFact(
                    dependency.name,
                    FactKeys.GO_IMPORTED_BY,
                    [...importers].sort(),
                );
            }
            const reachedBy = binaries.get(dependency.name);
            if (reachedBy?.size) {
                store.setDependencyFact(
                    dependency.name,
                    FactKeys.GO_BINARIES,
                    [...reachedBy].sort(),
                );
            }
        }
    }

    /** Read one module's package graph. Returns undefined if it can't be read. */
    private async readModuleUsage(
        projectPath: string,
        moduleNames: ReadonlySet<string>,
    ): Promise<ModuleUsage | undefined> {
        let output: string;
        try {
            // Not execSync: sources run together under Promise.all, and a
            // blocking `go list` on a large module would stall the network
            // ones alongside it.
            const result = await execFileAsync(
                'go',
                ['list', '-json=ImportPath,Name,Imports,TestImports,XTestImports', './...'],
                { encoding: 'utf-8', cwd: projectPath, maxBuffer: 64 * 1024 * 1024 },
            );
            output = result.stdout;
        } catch (error) {
            // `go list ./...` exits non-zero if any one package has an import
            // it can't resolve, which is routine in a repo mid-change, but it
            // still writes valid JSON for every package it did read. Use that
            // rather than dropping the module's whole graph over one package.
            const partial = (error as { stdout?: Buffer | string }).stdout?.toString() ?? '';
            if (!partial.trim()) {
                const reason = (error as Error).message.split('\n')[0] ?? 'go list failed';
                process.stderr.write(
                    `Could not list Go packages in ${projectPath}, so skipping import-graph facts: ${reason}\n`,
                );
                return undefined;
            }
            process.stderr.write(
                `Some Go packages in ${projectPath} could not be read; import-graph facts cover the rest.\n`,
            );
            output = partial;
        }

        const entries = parsePackageStream(output);
        if (entries.length === 0) return undefined;

        const firstParty = new Map<string, GoPackageEntry>();
        for (const entry of entries) firstParty.set(entry.ImportPath, entry);

        const importedBy = new Map<string, Set<string>>();
        for (const entry of entries) {
            const imports = [
                ...(entry.Imports ?? []),
                ...(entry.TestImports ?? []),
                ...(entry.XTestImports ?? []),
            ];
            for (const importPath of imports) {
                if (firstParty.has(importPath)) continue;
                const modulePath = moduleForImport(importPath, moduleNames);
                if (modulePath) add(importedBy, modulePath, entry.ImportPath);
            }
        }

        // Walk out from each binary through the module's own packages, since a
        // thin main package usually reaches its dependencies through the
        // internal packages it imports rather than importing them itself.
        const binaries = new Map<string, Set<string>>();
        for (const entry of entries) {
            if (entry.Name !== 'main') continue;
            for (const modulePath of reachableModules(entry, firstParty, moduleNames)) {
                add(binaries, modulePath, entry.ImportPath);
            }
        }

        return { importedBy, binaries };
    }
}

/** Every dependency reachable from a package through first-party packages. */
function reachableModules(
    root: GoPackageEntry,
    firstParty: ReadonlyMap<string, GoPackageEntry>,
    moduleNames: ReadonlySet<string>,
): Set<string> {
    const found = new Set<string>();
    // Go forbids import cycles between packages, but a diamond is normal.
    const seen = new Set<string>();
    const queue = [root.ImportPath];

    while (queue.length > 0) {
        const importPath = queue.pop()!;
        if (seen.has(importPath)) continue;
        seen.add(importPath);

        const pkg = firstParty.get(importPath);
        if (!pkg) {
            const modulePath = moduleForImport(importPath, moduleNames);
            if (modulePath) found.add(modulePath);
            continue;
        }
        // Only production imports carry the walk onward. A package's tests
        // aren't part of what its binary ships.
        for (const next of pkg.Imports ?? []) queue.push(next);
    }

    return found;
}

/**
 * Resolve a Go import path to the module providing it, preferring the longest
 * match: `example.com/a/b/c` belongs to module `example.com/a/b/c` when that
 * exists, otherwise `example.com/a/b`. Standard library imports match nothing.
 */
function moduleForImport(importPath: string, modulePaths: ReadonlySet<string>): string | undefined {
    const parts = importPath.split('/');
    for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join('/');
        if (modulePaths.has(candidate)) return candidate;
    }
    return undefined;
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
    const existing = map.get(key);
    if (existing) existing.add(value);
    else map.set(key, new Set([value]));
}

function mergeInto(target: Map<string, Set<string>>, source: Map<string, Set<string>>): void {
    for (const [key, values] of source) {
        for (const value of values) add(target, key, value);
    }
}

/** Parse the concatenated `{...}{...}` JSON stream `go list` emits. */
function parsePackageStream(raw: string): GoPackageEntry[] {
    const entries: GoPackageEntry[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                try {
                    entries.push(JSON.parse(raw.slice(start, i + 1)) as GoPackageEntry);
                } catch {
                    // skip malformed entries
                }
                start = -1;
            }
        }
    }

    return entries;
}
