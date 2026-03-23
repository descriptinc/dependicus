import Handlebars from 'handlebars';
import type { PackageVersionInfo, GitHubData, DetailUrlFn, ProviderInfo } from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
import {
    FactKeys,
    findFirstVersionOfType,
    formatBytes,
    formatSizeChange,
    resolveUrlPatterns,
} from '@dependicus/core';
import { helpers } from './templates/helpers';
import type { OutdatedDependency, OutdatedGroup } from './types';
import issueDescriptionHbs from './templates/issue-description.hbs';
import groupDescriptionHbs from './templates/group-description.hbs';
import newVersionsCommentHbs from './templates/new-versions-comment.hbs';

function createHandlebars(): typeof Handlebars {
    const hbs = Handlebars.create();
    // Disable HTML escaping — output is markdown, not HTML.
    hbs.Utils.escapeExpression = (str: string) => str;

    for (const [name, helper] of Object.entries(helpers)) {
        hbs.registerHelper(name, helper);
    }

    return hbs;
}

const hbs = createHandlebars();

const issueDescriptionTemplate = hbs.compile(issueDescriptionHbs);
const groupDescriptionTemplate = hbs.compile(groupDescriptionHbs);
const newVersionsCommentTemplate = hbs.compile(newVersionsCommentHbs);

/**
 * Build the description for a single-dependency Linear issue.
 */
export function buildIssueDescription(
    dep: OutdatedDependency,
    store: FactStore,
    minVersion: string,
    effectiveLatestVersion: string,
    getDetailUrl: DetailUrlFn,
    providerInfo: ProviderInfo,
): string {
    const { name, ecosystem, versions, worstCompliance } = dep;
    const version = versions[0];
    if (!version) {
        throw new Error(`No versions found for dependency ${name}`);
    }

    // Scope store reads to the dependency's ecosystem
    store = store.scoped(ecosystem);

    // Read enriched data from FactStore
    const versionsBetween =
        store.getVersionFact<PackageVersionInfo[]>(
            name,
            version.version,
            FactKeys.VERSIONS_BETWEEN,
        ) ?? [];
    const description = store.getVersionFact<string>(name, version.version, FactKeys.DESCRIPTION);
    const homepage = store.getVersionFact<string>(name, version.version, FactKeys.HOMEPAGE);
    const repositoryUrl = store.getVersionFact<string>(
        name,
        version.version,
        FactKeys.REPOSITORY_URL,
    );
    const bugsUrl = store.getVersionFact<string>(name, version.version, FactKeys.BUGS_URL);
    const unpackedSize = store.getVersionFact<number>(
        name,
        version.version,
        FactKeys.UNPACKED_SIZE,
    );
    const compareUrl = store.getVersionFact<string>(name, version.version, FactKeys.COMPARE_URL);
    const github = store.getDependencyFact<GitHubData>(name, FactKeys.GITHUB_DATA);
    const deprecatedTransitiveDeps =
        store.getDependencyFact<string[]>(name, FactKeys.DEPRECATED_TRANSITIVE_DEPS) ?? [];
    const isPatched = store.getVersionFact<boolean>(name, version.version, FactKeys.IS_PATCHED);

    const targetVersionInfo = versionsBetween.find((v) => v.version === minVersion);
    const latestVersionInfo = versionsBetween.find((v) => v.version === effectiveLatestVersion);

    const usedBy = [...new Set(versions.flatMap((v) => v.usedBy))];
    const shouldRecommendCatalog = !version.inCatalog && usedBy.length >= 2;

    const versionsReversed = [...versionsBetween].reverse();
    const versionsToShow = versionsReversed.slice(0, 15).map((v) => {
        const release = github?.releases.find((r) =>
            [v.version, `v${v.version}`, `${name}@${v.version}`].includes(r.tagName),
        );
        return {
            ...v,
            isLatest: v.version === effectiveLatestVersion,
            releaseUrl: release?.htmlUrl,
            formattedSize: formatBytes(v.unpackedSize),
            sizeChange: formatSizeChange(unpackedSize, v.unpackedSize),
        };
    });

    const { installCommand, supportsCatalog, catalogFile } = providerInfo;
    const patchHint =
        providerInfo.patchHint ??
        'This dependency has local patches applied. When upgrading, check if the patches are still needed or should be removed.';
    const updatePrefix = providerInfo.updatePrefix ?? 'Update the version in:';
    const updateSuffix =
        providerInfo.updateSuffix ?? `Then, run \`${installCommand}\` to update the lockfile.`;
    const urlPatterns = store.getDependencyFact<Record<string, string>>(name, FactKeys.URLS) ?? {};
    const urls = resolveUrlPatterns(urlPatterns, { name, version: version.version });

    const context = {
        name,
        description,
        formattedInstalledSize: formatBytes(unpackedSize),
        ownerLabel: dep.ownerLabel,
        multiVersion: versions.length > 1,
        versions: versions.map((v) => ({
            version: v.version,
            publishDate: v.publishDate,
            usedByPreview: v.usedBy.slice(0, 3),
            usedByExtra: v.usedBy.length > 3 ? v.usedBy.length - 3 : 0,
        })),
        currentVersion: version.version,
        currentPublishDate: version.publishDate,
        minVersion,
        targetPublishDate: targetVersionInfo?.publishDate,
        showLatest: minVersion !== effectiveLatestVersion,
        effectiveLatestVersion,
        latestPublishDate: latestVersionInfo?.publishDate,
        updateType: worstCompliance.updateType,
        versionsBehindCount: versionsBetween.length,
        dependencyTypes: version.dependencyTypes,
        inCatalog: version.inCatalog,
        supportsCatalog,
        catalogFile,
        shouldRecommendCatalog,
        installCommand,
        updatePrefix,
        updateSuffix,
        patchHint,
        urls,
        usedByCount: usedBy.length,
        usedByList: usedBy.slice(0, 20),
        usedByOverflow: usedBy.length > 20 ? usedBy.length - 20 : 0,
        hasPatches: isPatched,
        descriptionSections: dep.descriptionSections,
        availableMajorVersion: dep.availableMajorVersion,
        hasVersionsBetween: versionsBetween.length > 0,
        compareUrl,
        versionsToShow,
        versionsOverflow: versionsBetween.length > 15 ? versionsBetween.length - 15 : 0,
        detailUrl: getDetailUrl(ecosystem, name, version.version),
        homepage,
        repositoryUrl,
        changelogUrl: github?.changelogUrl,
        bugsUrl,
        hasDeprecatedTransitiveDeps: deprecatedTransitiveDeps.length > 0,
        deprecatedTransitiveDeps,
    };

    return issueDescriptionTemplate(context).trim();
}

/**
 * Build the description for a grouped Linear issue.
 */
export function buildGroupIssueDescription(
    group: OutdatedGroup,
    store: FactStore,
    getDetailUrl: DetailUrlFn,
    providerInfoMap: Map<string, ProviderInfo>,
): string {
    const { groupName, dependencies, worstCompliance } = group;

    const notificationsOnly = group.policy.type === 'fyi';

    const firstDep = dependencies[0];
    if (!firstDep) {
        throw new Error(`Group "${groupName}" has no dependencies`);
    }
    const groupProviderInfo = providerInfoMap.get(firstDep.ecosystem);
    if (!groupProviderInfo) {
        throw new Error(
            `No provider info for ecosystem "${firstDep.ecosystem}" in group "${groupName}"`,
        );
    }
    const { installCommand, supportsCatalog, catalogFile } = groupProviderInfo;
    const updateInstructions =
        groupProviderInfo.updateInstructions ??
        `Update each dependency's version in the appropriate config file, then run \`${installCommand}\`.`;

    const context = {
        groupName,
        dependencyCount: dependencies.length,
        notificationsOnly,
        updateType: worstCompliance.updateType,
        hasOverdue: worstCompliance.daysOverdue > 0,
        daysOverdue: worstCompliance.daysOverdue,
        installCommand,
        supportsCatalog,
        catalogFile,
        updateInstructions,
        dependencies: dependencies
            .map((dep) => {
                const version = dep.versions[0];
                if (!version) return undefined;

                const scoped = store.scoped(dep.ecosystem);
                const versionsBetween =
                    scoped.getVersionFact<PackageVersionInfo[]>(
                        dep.name,
                        version.version,
                        FactKeys.VERSIONS_BETWEEN,
                    ) ?? [];
                const depDescription = scoped.getVersionFact<string>(
                    dep.name,
                    version.version,
                    FactKeys.DESCRIPTION,
                );
                const depUrlPatterns =
                    scoped.getDependencyFact<Record<string, string>>(dep.name, FactKeys.URLS) ?? {};
                const depUrls = resolveUrlPatterns(depUrlPatterns, {
                    name: dep.name,
                    version: version.version,
                });

                const effectiveLatestVersion = dep.targetVersion ?? version.latestVersion;
                const depIsFyi = dep.policy.type === 'fyi';
                const minVersion = depIsFyi
                    ? effectiveLatestVersion
                    : (findFirstVersionOfType(
                          version.version,
                          versionsBetween,
                          dep.worstCompliance.updateType,
                      )?.version ?? effectiveLatestVersion);

                return {
                    name: dep.name,
                    description: depDescription,
                    currentVersion: version.version,
                    minVersion,
                    showLatest: minVersion !== effectiveLatestVersion,
                    effectiveLatestVersion,
                    updateType: dep.worstCompliance.updateType,
                    inCatalog: version.inCatalog,
                    detailUrl: getDetailUrl(dep.ecosystem, dep.name, version.version),
                    urls: depUrls,
                };
            })
            .filter(Boolean),
    };

    return groupDescriptionTemplate(context).trim();
}

/**
 * Build a comment describing new versions that were released.
 */
export function buildNewVersionsComment(
    name: string,
    _oldLatestVersion: string,
    newVersions: PackageVersionInfo[],
    github?: GitHubData,
): string {
    const versionsReversed = [...newVersions].reverse();

    const context = {
        name,
        versionCountText:
            newVersions.length === 1
                ? 'a new version has'
                : `${newVersions.length} new versions have`,
        versions: versionsReversed.map((v) => {
            const release = github?.releases.find((r) =>
                [v.version, `v${v.version}`, `${name}@${v.version}`].includes(r.tagName),
            );
            return {
                ...v,
                releaseUrl: release?.htmlUrl,
                formattedSize: formatBytes(v.unpackedSize),
            };
        }),
    };

    return newVersionsCommentTemplate(context).trim();
}
