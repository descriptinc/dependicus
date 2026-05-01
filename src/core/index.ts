export type {
    PackageInfo,
    DependencyInfo,
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
    ColumnContext,
} from './types';
export {
    mergeProviderDependencies,
    getDetailFilename,
    getGroupingFilename,
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
    sanitizeCacheKey,
    convertGitUrlToHttps,
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
export type { DependencyProvider, SourceContext } from './providers/DependencyProvider';

// Sources module
export type { DataSource } from './sources/types';
export type { FactStore, SerializedFacts } from './sources/FactStore';
export { RootFactStore, ScopedFactStore, FactKeys } from './sources/FactStore';
export { runSources } from './sources/runSources';
export { GitHubSource } from './sources/GitHubSource';
export { WorkspaceSource } from './sources/WorkspaceSource';

// Infrastructure shared with provider packages
export { CacheService } from './services/CacheService';
export type { PluginContext } from './services/CacheService';
export { BUFFER_SIZES, WORKER_COUNT } from './constants';
export { processInParallel } from './utils/workerQueue';
export type { WorkerQueueOptions } from './utils/workerQueue';
