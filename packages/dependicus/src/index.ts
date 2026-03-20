// ── Plugins ──────────────────────────────────────────────────────────

/** @group Plugins */
export type { DependicusPlugin } from './plugin';

/** @group Plugins */
export type { GroupingConfig } from '@dependicus/core';

/** @group Plugins */
export type { GroupingDetailContext } from '@dependicus/core';

/** @group Plugins */
export type { GroupingSection, GroupingStat, GroupingFlag } from '@dependicus/core';

/** @group Plugins */
export type { CustomColumn } from '@dependicus/site-builder';

/** @group Plugins */
export type { DependencyVersion } from '@dependicus/core';

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
export type { DependencyProvider } from '@dependicus/core';

/** @group Core Types */
export type { DirectDependency } from '@dependicus/core';

/** @group Core Types */
export type { PackageVersionInfo } from '@dependicus/core';

// ── Data Collection ──────────────────────────────────────────────────

/** @group Data Collection */
export type { DataSource } from '@dependicus/core';

/** @group Data Collection */
export type { FactStore } from '@dependicus/core';

/** @group Data Collection */
export { FactKeys } from '@dependicus/core';

// ── Ticket Creation ──────────────────────────────────────────────────

/** @group Ticket Creation */
export type { VersionContext } from '@dependicus/linear';

/** @group Ticket Creation */
export type { LinearIssueSpec } from '@dependicus/linear';

/** @group Ticket Creation */
export type { LinearPolicy } from '@dependicus/linear';

/** @group Ticket Creation */
export type { IssueAssignment } from '@dependicus/linear';

/** @group Ticket Creation */
export { getUpdateType } from '@dependicus/core';

// ── GitHub Issue Creation ────────────────────────────────────────────

/** @group Issue Creation */
export type { GitHubIssueSpec } from '@dependicus/github-issues';

/** @group Issue Creation */
export type { GitHubIssuePolicy } from '@dependicus/github-issues';

/** @group Issue Creation */
export type { GitHubIssueAssignment } from '@dependicus/github-issues';
