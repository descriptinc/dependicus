// Copyright 2026 Descript, Inc
import type { DirectDependency } from '../types';
import type { FactStore } from './FactStore';

export type { FactStore };

export interface DataSource {
    readonly name: string;
    readonly dependsOn: readonly string[];
    /** Like dependsOn, but sources listed here are waited for only if they exist in the pool. */
    readonly softDependsOn?: readonly string[];
    fetch(dependencies: DirectDependency[], store: FactStore): Promise<void>;
    /** Optionally patch data in the HTML and Linear ticket steps after loading
     * the JSON file. Niche use cases only.
     */
    refreshLocal?(dependencies: DirectDependency[], store: FactStore): void;
}
