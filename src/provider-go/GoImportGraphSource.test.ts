import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectDependency } from '../core/index';
import { RootFactStore, FactKeys } from '../core/index';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { GoImportGraphSource } from './GoImportGraphSource';

// The shape Go backends usually take: thin main packages under cmd/, with the
// third-party imports living in the internal/ packages they pull in.
const packageList = [
    JSON.stringify({
        ImportPath: 'github.com/example/myapp/cmd/billing',
        Name: 'main',
        Imports: ['github.com/example/myapp/internal/db'],
    }),
    JSON.stringify({
        ImportPath: 'github.com/example/myapp/cmd/worker',
        Name: 'main',
        Imports: ['github.com/example/myapp/internal/db', 'github.com/sirupsen/logrus/hooks/test'],
    }),
    JSON.stringify({
        ImportPath: 'github.com/example/myapp/internal/db',
        Name: 'db',
        Imports: ['database/sql', 'github.com/gorilla/mux'],
        TestImports: ['testing', 'github.com/sirupsen/logrus'],
    }),
].join('\n');

function makeDep(name: string): DirectDependency {
    return {
        name,
        ecosystem: 'gomod',
        versions: [
            {
                version: '1.0.0',
                latestVersion: '1.0.0',
                usedBy: ['myapp'],
                dependencyTypes: ['prod'],
                publishDate: '2024-01-01',
                inCatalog: false,
            },
        ],
    };
}

describe('GoImportGraphSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function run(
        output: string | Error,
        deps = ['github.com/gorilla/mux', 'github.com/sirupsen/logrus'],
    ) {
        if (output instanceof Error) {
            vi.mocked(execSync).mockImplementationOnce(() => {
                throw output;
            });
        } else {
            vi.mocked(execSync).mockReturnValueOnce(output);
        }
        const store = new RootFactStore();
        const dependencies = deps.map(makeDep);
        await new GoImportGraphSource(['/project']).fetch(dependencies, store);
        return store;
    }

    it('records the first-party packages that import a dependency', async () => {
        const store = await run(packageList);

        expect(
            store.getDependencyFact<string[]>('github.com/gorilla/mux', FactKeys.GO_IMPORTED_BY),
        ).toEqual(['github.com/example/myapp/internal/db']);
    });

    it('counts a test import as an importer', async () => {
        const store = await run(packageList);

        expect(
            store.getDependencyFact<string[]>(
                'github.com/sirupsen/logrus',
                FactKeys.GO_IMPORTED_BY,
            ),
        ).toEqual(['github.com/example/myapp/cmd/worker', 'github.com/example/myapp/internal/db']);
    });

    it('records the binaries that reach a dependency through internal packages', async () => {
        const store = await run(packageList);

        // mux is imported by internal/db, which both binaries pull in.
        expect(
            store.getDependencyFact<string[]>('github.com/gorilla/mux', FactKeys.GO_BINARIES),
        ).toEqual(['github.com/example/myapp/cmd/billing', 'github.com/example/myapp/cmd/worker']);
    });

    it('resolves an import to the longest matching module', async () => {
        const store = await run(packageList);

        // logrus/hooks/test belongs to logrus, and only worker imports it for
        // real: billing reaches logrus only through internal/db's tests.
        expect(
            store.getDependencyFact<string[]>('github.com/sirupsen/logrus', FactKeys.GO_BINARIES),
        ).toEqual(['github.com/example/myapp/cmd/worker']);
    });

    it('leaves a dependency nothing imports without facts', async () => {
        const store = await run(packageList, ['github.com/spf13/cobra']);

        expect(
            store.getDependencyFact('github.com/spf13/cobra', FactKeys.GO_IMPORTED_BY),
        ).toBeUndefined();
        expect(
            store.getDependencyFact('github.com/spf13/cobra', FactKeys.GO_BINARIES),
        ).toBeUndefined();
    });

    it('skips the facts when the package list cannot be read', async () => {
        const store = await run(new Error('no sources in module cache'));

        expect(
            store.getDependencyFact('github.com/gorilla/mux', FactKeys.GO_IMPORTED_BY),
        ).toBeUndefined();
    });

    it('does not run go list when there are no dependencies', async () => {
        const store = new RootFactStore();
        await new GoImportGraphSource(['/project']).fetch([], store);

        expect(vi.mocked(execSync)).not.toHaveBeenCalled();
    });

    it('merges the graphs of several modules', async () => {
        const second = JSON.stringify({
            ImportPath: 'github.com/example/other/cmd/api',
            Name: 'main',
            Imports: ['github.com/gorilla/mux'],
        });
        vi.mocked(execSync).mockReturnValueOnce(packageList).mockReturnValueOnce(second);

        const store = new RootFactStore();
        await new GoImportGraphSource(['/project', '/other']).fetch(
            [makeDep('github.com/gorilla/mux')],
            store,
        );

        expect(
            store.getDependencyFact<string[]>('github.com/gorilla/mux', FactKeys.GO_BINARIES),
        ).toEqual([
            'github.com/example/myapp/cmd/billing',
            'github.com/example/myapp/cmd/worker',
            'github.com/example/other/cmd/api',
        ]);
    });
});
