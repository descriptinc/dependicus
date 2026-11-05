import { satisfies, validRange } from 'semver';

/**
 * Version ranges a workspace pins for each package, across its default
 * catalog and every named catalog. A package can appear in more than one
 * catalog with a different range in each, e.g. `react: ^18` in the default
 * catalog and `react: ^17` in a `react17` catalog for packages that haven't
 * migrated yet.
 */
export type CatalogRanges = Map<string, string[]>;

type CatalogEntries = Record<string, string> | undefined;
type NamedCatalogs = Record<string, CatalogEntries> | undefined;

/**
 * Merge a default catalog and a set of named catalogs into one map of
 * package name to every range that pins it.
 */
export function collectCatalogRanges(
    defaultCatalog: CatalogEntries,
    namedCatalogs: NamedCatalogs,
): CatalogRanges {
    const ranges: CatalogRanges = new Map();
    const add = (entries: CatalogEntries) => {
        if (!entries || typeof entries !== 'object') {
            return;
        }
        for (const [pkg, range] of Object.entries(entries)) {
            if (typeof range !== 'string') {
                continue;
            }
            const existing = ranges.get(pkg);
            if (existing) {
                if (!existing.includes(range)) {
                    existing.push(range);
                }
            } else {
                ranges.set(pkg, [range]);
            }
        }
    };
    add(defaultCatalog);
    if (namedCatalogs && typeof namedCatalogs === 'object') {
        for (const entries of Object.values(namedCatalogs)) {
            add(entries);
        }
    }
    return ranges;
}

/**
 * Whether a version satisfies any of the ranges a package is cataloged at.
 * A range that isn't valid semver (a tag, a git URL) matches only exactly.
 */
export function satisfiesAnyCatalogRange(ranges: string[] | undefined, version: string): boolean {
    if (!ranges) {
        return false;
    }
    return ranges.some((range) => {
        if (!validRange(range)) {
            return version === range;
        }
        try {
            return satisfies(version, range);
        } catch {
            return version === range;
        }
    });
}
