import type { PackageInfo } from '../types';

export interface DependencyProvider {
    readonly name: string;
    readonly rootDir: string;
    readonly lockfilePath: string;
    readonly supportsCatalog: boolean;
    getPackages(): Promise<PackageInfo[]>;
    isInCatalog(packageName: string, version: string): boolean;
    hasPackageInCatalog(packageName: string): boolean;
    isPatched(packageName: string, version: string): boolean;
}
