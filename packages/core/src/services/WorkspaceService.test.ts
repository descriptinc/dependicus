import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceService } from './WorkspaceService';

describe('WorkspaceService', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'workspace-test-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    function createWorkspaceFile(content: string): string {
        const filePath = join(tempDir, 'pnpm-workspace.yaml');
        writeFileSync(filePath, content);
        return filePath;
    }

    describe('isInCatalog', () => {
        it('returns true when version satisfies catalog range', () => {
            const filePath = createWorkspaceFile(`
catalog:
  react: ^18.2.0
`);
            const ws = new WorkspaceService(filePath);
            expect(ws.isInCatalog('react', '18.3.0')).toBe(true);
            expect(ws.isInCatalog('react', '18.2.0')).toBe(true);
        });

        it('returns false when version does not satisfy catalog range', () => {
            const filePath = createWorkspaceFile(`
catalog:
  react: ^18.2.0
`);
            const ws = new WorkspaceService(filePath);
            expect(ws.isInCatalog('react', '17.0.0')).toBe(false);
            expect(ws.isInCatalog('react', '19.0.0')).toBe(false);
        });

        it('returns false for packages not in catalog', () => {
            const filePath = createWorkspaceFile(`
catalog:
  react: ^18.2.0
`);
            const ws = new WorkspaceService(filePath);
            expect(ws.isInCatalog('vue', '3.0.0')).toBe(false);
        });

        it('falls back to exact match for non-semver ranges', () => {
            const filePath = createWorkspaceFile(`
catalog:
  my-pkg: not-a-version
`);
            const ws = new WorkspaceService(filePath);
            expect(ws.isInCatalog('my-pkg', 'not-a-version')).toBe(true);
            expect(ws.isInCatalog('my-pkg', 'other')).toBe(false);
        });
    });

    describe('hasPackageInCatalog', () => {
        it('returns true for packages in catalog', () => {
            const filePath = createWorkspaceFile(`
catalog:
  react: ^18.2.0
`);
            const ws = new WorkspaceService(filePath);
            expect(ws.hasPackageInCatalog('react')).toBe(true);
        });

        it('returns false for packages not in catalog', () => {
            const filePath = createWorkspaceFile(`
catalog:
  react: ^18.2.0
`);
            const ws = new WorkspaceService(filePath);
            expect(ws.hasPackageInCatalog('vue')).toBe(false);
        });
    });

    describe('no workspace file', () => {
        it('returns safe defaults when constructed without a file path', () => {
            const ws = new WorkspaceService();
            expect(ws.isPatched('react', '18.2.0')).toBe(false);
            expect(ws.isInCatalog('react', '18.2.0')).toBe(false);
            expect(ws.hasPackageInCatalog('react')).toBe(false);
        });
    });
});
