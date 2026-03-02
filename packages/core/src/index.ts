export type {
    DetailPage,
    DirectDependency,
    DependencyVersion,
    DependicusOutput,
    OutputMetadata,
    ProviderInfo,
    ProviderOutput,
    GroupingConfig,
    GroupingDetailContext,
    GroupingSection,
    GroupingStat,
    GroupingFlag,
    GitHubRelease,
    GitHubData,
    PackageVersionInfo,
    UsedByGroupKeyFn,
} from './types';
export {
    mergeProviderDependencies,
    getDetailFilename,
    createDetailUrlBuilder,
    buildProviderInfoMap,
} from './types';
export type { DetailUrlFn } from './types';

export {
    formatDate,
    formatAgeHuman,
    getAgeDays,
    getVersionsBehind,
    formatBytes,
    formatSizeChange,
} from './utils/formatters';

export {
    getUpdateType,
    isNewerThan,
    extractLatestVersionFromTitle,
    extractDependencyNameFromTitle,
    extractGroupNameFromTitle,
    buildTicketTitle,
    buildGroupTicketTitle,
    findFirstVersionOfType,
    calculateDueDate,
    isWithinCooldown,
    findLatestWithinMajor,
    findLatestWithinMinor,
    isWithinNotificationRateLimit,
    hasMajorVersionSinceLastUpdate,
} from './utils/versionUtils';

export { findReleaseForVersion, detectTagFormat } from './utils/releaseUtils';

export { resolveUrl, resolveUrlPatterns } from './urls';

export { createCoreServices, readDependicusJson } from './createCoreServices';
export type { CoreServicesConfig, CoreServices } from './createCoreServices';

// Providers
export type { DependencyProvider } from './providers/DependencyProvider';
export { PnpmProvider } from './providers/PnpmProvider';
export { BunProvider } from './providers/BunProvider';
export { YarnProvider } from './providers/YarnProvider';
export { detectProviders, detectRuntime, createProvidersByName } from './providers';

// Sources module
export type { DataSource } from './sources/types';
export type { FactStore, SerializedFacts } from './sources/FactStore';
export { RootFactStore, ScopedFactStore, FactKeys } from './sources/FactStore';
export { runSources } from './sources/runSources';
export { NpmRegistrySource } from './sources/NpmRegistrySource';
export { NpmSizeSource } from './sources/NpmSizeSource';
export { GitHubSource } from './sources/GitHubSource';
export { DeprecationSource } from './sources/DeprecationSource';
export { WorkspaceSource } from './sources/WorkspaceSource';
