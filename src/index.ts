// ── Plugins ──────────────────────────────────────────────────────────

/** @group Plugins */
export type { DependicusPlugin } from './plugin';

/** @group Plugins */
export type { PluginContext } from './core/index';

/** @group Plugins */
export type { GroupingConfig } from './core/index';

/** @group Plugins */
export type { GroupingDetailContext } from './core/index';

/** @group Plugins */
export type { GroupingSection, GroupingStat, GroupingFlag } from './core/index';

/** @group Plugins */
export type { CustomColumn, ColumnContext } from './site-builder/index';

/** @group Plugins */
export { getGroupingFilename } from './core/index';

/** @group Plugins */
export type { DependencyVersion } from './core/index';

/** @group Compliance */
export { BasicCompliancePlugin } from './compliance';

/** @group Compliance */
export type { CompliancePolicy, BasicComplianceConfig } from './compliance';

/** @group Compliance */
export type { ComplianceStatus } from './compliance';

// ── Core Types ───────────────────────────────────────────────────────

/** @group Core Types */
export { dependicusCli } from './cli';

/** @group Core Types */
export type { DependicusCliConfig } from './cli';

/** @group Core Types */
export type { DependencyProvider } from './core/index';

/** @group Core Types */
export type { DirectDependency } from './core/index';

/** @group Core Types */
export type { PackageVersionInfo } from './core/index';

// ── Data Collection ──────────────────────────────────────────────────

/** @group Data Collection */
export type { DataSource } from './core/index';

/** @group Data Collection */
export type { FactStore } from './core/index';

/** @group Data Collection */
export { RootFactStore, ScopedFactStore, FactKeys } from './core/index';

/** @group Data Collection */
export { CacheService } from './core/index';

// ── Ticket Creation ──────────────────────────────────────────────────

/** @group Ticket Creation */
export type { VersionContext } from './linear/index';

/** @group Ticket Creation */
export type { LinearIssueSpec } from './linear/index';

/** @group Ticket Creation */
export type { LinearPolicy } from './linear/index';

/** @group Ticket Creation */
export type { IssueAssignment } from './linear/index';

/** @group Ticket Creation */
export { getUpdateType } from './core/index';

// ── GitHub Issue Creation ────────────────────────────────────────────

/** @group Issue Creation */
export type { GitHubIssueSpec } from './github-issues/index';

/** @group Issue Creation */
export type { GitHubIssuePolicy } from './github-issues/index';

/** @group Issue Creation */
export type { GitHubIssueAssignment } from './github-issues/index';
