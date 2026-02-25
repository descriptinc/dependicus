import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Handlebars from 'handlebars';
import type { PackageVersionInfo, GitHubData } from '@dependicus/core';
import type { FactStore } from '@dependicus/core';
import { FactKeys, findFirstVersionOfType, formatBytes, formatSizeChange } from '@dependicus/core';
import { helpers } from './templates/helpers';
import type { OutdatedPackage, OutdatedGroup } from './types';

const templatesDir = resolve(__dirname, 'templates');

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

function loadTemplate(name: string): HandlebarsTemplateDelegate {
    const content = readFileSync(join(templatesDir, `${name}.hbs`), 'utf-8');
    return hbs.compile(content);
}

const ticketDescriptionTemplate = loadTemplate('ticket-description');
const groupDescriptionTemplate = loadTemplate('group-description');
const newVersionsCommentTemplate = loadTemplate('new-versions-comment');

/**
 * Build the description for a single-package Linear ticket.
 */
export function buildTicketDescription(
    pkg: OutdatedPackage,
    store: FactStore,
    minVersion: string,
    effectiveLatestVersion: string,
    dependicusBaseUrl: string,
): string {
    const { packageName, versions, worstCompliance } = pkg;
    const version = versions[0];
    if (!version) {
        throw new Error(`No versions found for package ${packageName}`);
    }

    // Read enriched data from FactStore
    const versionsBetween =
        store.getVersionFact<PackageVersionInfo[]>(
            packageName,
            version.version,
            FactKeys.VERSIONS_BETWEEN,
        ) ?? [];
    const description = store.getVersionFact<string>(
        packageName,
        version.version,
        FactKeys.DESCRIPTION,
    );
    const homepage = store.getVersionFact<string>(packageName, version.version, FactKeys.HOMEPAGE);
    const repositoryUrl = store.getVersionFact<string>(
        packageName,
        version.version,
        FactKeys.REPOSITORY_URL,
    );
    const bugsUrl = store.getVersionFact<string>(packageName, version.version, FactKeys.BUGS_URL);
    const unpackedSize = store.getVersionFact<number>(
        packageName,
        version.version,
        FactKeys.UNPACKED_SIZE,
    );
    const compareUrl = store.getVersionFact<string>(
        packageName,
        version.version,
        FactKeys.COMPARE_URL,
    );
    const github = store.getPackageFact<GitHubData>(packageName, FactKeys.GITHUB_DATA);
    const deprecatedTransitiveDeps =
        store.getPackageFact<string[]>(packageName, FactKeys.DEPRECATED_TRANSITIVE_DEPS) ?? [];
    const isPatched = store.getVersionFact<boolean>(
        packageName,
        version.version,
        FactKeys.IS_PATCHED,
    );

    const targetVersionInfo = versionsBetween.find((v) => v.version === minVersion);
    const latestVersionInfo = versionsBetween.find((v) => v.version === effectiveLatestVersion);

    const usedBy = [...new Set(versions.flatMap((v) => v.usedBy))];
    const shouldRecommendCatalog = !version.inCatalog && usedBy.length >= 2;

    const versionsReversed = [...versionsBetween].reverse();
    const versionsToShow = versionsReversed.slice(0, 15).map((v) => {
        const release = github?.releases.find((r) =>
            [v.version, `v${v.version}`, `${packageName}@${v.version}`].includes(r.tagName),
        );
        return {
            ...v,
            isLatest: v.version === effectiveLatestVersion,
            releaseUrl: release?.htmlUrl,
            formattedSize: formatBytes(v.unpackedSize),
            sizeChange: formatSizeChange(unpackedSize, v.unpackedSize),
        };
    });

    const safeName = packageName.replace(/^@/, '').replace(/\//g, '-');
    const detailFilename = `${safeName}@${version.version}.html`;

    const context = {
        packageName,
        description,
        formattedInstalledSize: formatBytes(unpackedSize),
        ownerLabel: pkg.ownerLabel,
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
        shouldRecommendCatalog,
        usedByCount: usedBy.length,
        usedByList: usedBy.slice(0, 20),
        usedByOverflow: usedBy.length > 20 ? usedBy.length - 20 : 0,
        hasPatches: isPatched,
        descriptionSections: pkg.descriptionSections,
        availableMajorVersion: pkg.availableMajorVersion,
        hasVersionsBetween: versionsBetween.length > 0,
        compareUrl,
        versionsToShow,
        versionsOverflow: versionsBetween.length > 15 ? versionsBetween.length - 15 : 0,
        detailUrl: `${dependicusBaseUrl}/details/${detailFilename}`,
        npmgraphQuery: encodeURIComponent(`${packageName}@${version.version}`),
        homepage,
        repositoryUrl,
        changelogUrl: github?.changelogUrl,
        bugsUrl,
        hasDeprecatedTransitiveDeps: deprecatedTransitiveDeps.length > 0,
        deprecatedTransitiveDeps,
    };

    return ticketDescriptionTemplate(context).trim();
}

/**
 * Build the description for a grouped Linear ticket.
 */
export function buildGroupTicketDescription(
    group: OutdatedGroup,
    store: FactStore,
    dependicusBaseUrl: string,
): string {
    const { groupName, packages, worstCompliance } = group;

    const notificationsOnly = group.policy.type === 'fyi';

    const context = {
        groupName,
        packageCount: packages.length,
        notificationsOnly,
        updateType: worstCompliance.updateType,
        hasOverdue: worstCompliance.daysOverdue > 0,
        daysOverdue: worstCompliance.daysOverdue,
        packages: packages
            .map((pkg) => {
                const version = pkg.versions[0];
                if (!version) return undefined;

                const versionsBetween =
                    store.getVersionFact<PackageVersionInfo[]>(
                        pkg.packageName,
                        version.version,
                        FactKeys.VERSIONS_BETWEEN,
                    ) ?? [];
                const pkgDescription = store.getVersionFact<string>(
                    pkg.packageName,
                    version.version,
                    FactKeys.DESCRIPTION,
                );

                const effectiveLatestVersion = pkg.targetVersion ?? version.latestVersion;
                const pkgIsFyi = pkg.policy.type === 'fyi';
                const minVersion = pkgIsFyi
                    ? effectiveLatestVersion
                    : (findFirstVersionOfType(
                          version.version,
                          versionsBetween,
                          pkg.worstCompliance.updateType,
                      )?.version ?? effectiveLatestVersion);

                const safeName = pkg.packageName.replace(/^@/, '').replace(/\//g, '-');
                const detailFilename = `${safeName}@${version.version}.html`;

                return {
                    packageName: pkg.packageName,
                    description: pkgDescription,
                    currentVersion: version.version,
                    minVersion,
                    showLatest: minVersion !== effectiveLatestVersion,
                    effectiveLatestVersion,
                    updateType: pkg.worstCompliance.updateType,
                    inCatalog: version.inCatalog,
                    detailUrl: `${dependicusBaseUrl}/details/${detailFilename}`,
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
    packageName: string,
    _oldLatestVersion: string,
    newVersions: PackageVersionInfo[],
    github?: GitHubData,
): string {
    const versionsReversed = [...newVersions].reverse();

    const context = {
        packageName,
        versionCountText:
            newVersions.length === 1
                ? 'a new version has'
                : `${newVersions.length} new versions have`,
        versions: versionsReversed.map((v) => {
            const release = github?.releases.find((r) =>
                [v.version, `v${v.version}`, `${packageName}@${v.version}`].includes(r.tagName),
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
