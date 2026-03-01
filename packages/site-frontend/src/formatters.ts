import type { TabulatorCell } from './types';

/**
 * Custom formatter for dependency types with pills
 */
export function typeFormatter(cell: TabulatorCell): string {
    const value = cell.getValue();
    if (!value) return '';

    const types = String(value).split(', ').filter(Boolean);
    return types
        .map((type) => {
            const className = type.toLowerCase();
            return `<span class="dep-type-pill ${className}">${type.charAt(0).toUpperCase() + type.slice(1)}</span>`;
        })
        .join('');
}

/**
 * Custom formatter for notes with badges
 */
export function notesFormatter(cell: TabulatorCell): string {
    const value = cell.getValue();
    if (!value) return '';

    const notes = String(value).split(', ').filter(Boolean);

    return notes
        .map((note) => {
            const className = note.toLowerCase().replace(/\s+/g, '-');
            return `<span class="dep-notes-badge ${className}">${note}</span>`;
        })
        .join('');
}

/**
 * Custom formatter for "Used By" - show pills grouped by team in a collapsible details element
 */
export function usedByFormatter(cell: TabulatorCell): string {
    const rowData = cell.getRow().getData();
    const grouped = rowData['Used By Grouped'];

    if (!grouped) {
        // No ownership grouping configured — render flat pill list
        const packages = String(rowData['Used By'] || '')
            .split('; ')
            .filter(Boolean);
        if (packages.length === 0) return '';
        const pills = packages
            .map((pkg) => `<span class="dep-package-pill">${pkg}</span>`)
            .join('');
        return `<div class="dep-used-by-content"><div class="dep-used-by-team-row">${pills}</div></div>`;
    }

    // Sort teams alphabetically, but put "Unknown" last
    const teams = Object.keys(grouped).sort((a, b) => {
        if (a === 'Unknown') return 1;
        if (b === 'Unknown') return -1;
        return a.localeCompare(b);
    });

    if (teams.length === 0) return '';

    // Build expanded content
    const content = teams
        .map((team) => {
            const packages = grouped[team];
            if (!packages || packages.length === 0) return '';
            const pills = packages
                .map((pkg) => `<span class="dep-package-pill">${pkg}</span>`)
                .join('');
            return `<div class="dep-used-by-team-row"><span class="dep-team-label">${team}:</span>${pills}</div>`;
        })
        .filter(Boolean)
        .join('');

    // If only one team, show content directly without details/summary
    if (teams.length === 1) {
        return `<div class="dep-used-by-content">${content}</div>`;
    }

    // Build summary: "Agent (1), BuilderExperience (4), Infrastructure (1)"
    const summaryParts = teams
        .map((team) => {
            const packages = grouped[team];
            if (!packages || packages.length === 0) return '';
            return `${team} (${packages.length})`;
        })
        .filter(Boolean);

    const summary = summaryParts.join(', ');

    // Add toggle listener to trigger table redraw when details expands/collapses
    const cellElement = cell.getElement();
    setTimeout(() => {
        const details = cellElement.querySelector('details');
        if (details && !details.dataset.listenerAdded) {
            details.dataset.listenerAdded = 'true';
            details.addEventListener('toggle', () => {
                // Trigger row height recalculation
                const table = cell.getRow().getTable();
                table.redraw();
            });
        }
    }, 0);

    return `<details class="dep-used-by-details"><summary class="dep-used-by-summary">${summary}</summary><div class="dep-used-by-content">${content}</div></details>`;
}

/**
 * Custom formatter for age - convert days to human readable
 */
export function ageFormatter(cell: TabulatorCell): string {
    const days = Number(cell.getValue());
    if (!days) return '';

    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const remainingDays = days % 30;

    if (years > 0) {
        if (months > 0) return `${years}y${months}mo`;
        return `${years}y`;
    }

    if (months > 0) {
        if (remainingDays > 0) return `${months}mo${remainingDays}d`;
        return `${months}mo`;
    }

    return `${days}d`;
}

/**
 * Custom formatter for versions behind - color-coded pills
 */
export function versionsBehindFormatter(cell: TabulatorCell): string {
    const value = cell.getValue();
    if (!value) return '';

    const valueStr = String(value);
    let className = '';
    if (valueStr.startsWith('Patch')) {
        className = 'patch';
    } else if (valueStr.startsWith('Minor')) {
        className = 'minor';
    } else if (valueStr.startsWith('Major')) {
        className = 'major';
    }

    return `<span class="dep-version-behind-pill ${className}">${valueStr}</span>`;
}

/**
 * Custom formatter for package names - link to detail page
 */
export function packageNameFormatter(cell: TabulatorCell): string {
    const packageName = cell.getValue();
    const detailLink = cell.getRow().getData()['Detail Link'];
    if (detailLink) {
        return `<a href="${detailLink}">${packageName}</a>`;
    }
    return String(packageName);
}

/**
 * Custom formatter for version - link to detail page
 */
export function versionFormatter(cell: TabulatorCell): string {
    const version = cell.getValue();
    const detailLink = cell.getRow().getData()['Detail Link'];
    if (detailLink) {
        return `<a href="${detailLink}">${version}</a>`;
    }
    return String(version);
}

/**
 * Custom formatter for latest version - link to npm (not detail page, since we may not have that version)
 */
export function latestVersionFormatter(cell: TabulatorCell): string {
    const version = cell.getValue();
    if (!version) return '';
    const data = cell.getRow().getData();
    const url = data['Latest Version URL'];
    if (url) {
        return `<a href="${url}" target="_blank" rel="noopener">${version}</a>`;
    }
    return String(version);
}

/**
 * Custom formatter for deprecated deps - show as pills with npm links
 */
export function deprecatedFormatter(cell: TabulatorCell): string {
    const value = cell.getValue();
    if (!value) return '';

    const deps = String(value).split('; ').filter(Boolean);
    if (deps.length === 0) return '';

    const pattern = cell.getRow().getData()['Deprecated Dep URL Pattern'] as string;
    return deps
        .map((dep) => {
            if (pattern) {
                const lastAtIndex = dep.lastIndexOf('@');
                const packageName = dep.substring(0, lastAtIndex);
                const version = dep.substring(lastAtIndex + 1);
                const url = pattern.replace('{name}', packageName).replace('{version}', version);
                return `<a href="${url}" target="_blank" rel="noopener" class="dep-package-pill">${dep}</a>`;
            }
            return `<span class="dep-package-pill">${dep}</span>`;
        })
        .join('');
}
