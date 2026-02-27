import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { RowData, TabulatorInstance } from './types';
import { createColumnDefs, getTableConfig } from './config';

/**
 * Main entry point for browser-side initialization
 * Data is passed via window.dependicusData global variable
 */
function init() {
    const data = window.dependicusData;

    // Store table instances keyed by tab id
    const tables = new Map<string, TabulatorInstance>();

    // Create column definitions per tab (supportsCatalog varies across providers)
    const columnDefsPerTab = new Map<string, ReturnType<typeof createColumnDefs>>();
    for (const tab of data.tabs) {
        columnDefsPerTab.set(
            tab.id,
            createColumnDefs(data.uniqueNotes, data.customColumns, {
                hasCatalog: tab.supportsCatalog,
            }),
        );
    }

    // Create tables with specified responsive setting
    function createTables(responsive: boolean) {
        // Destroy existing tables
        for (const table of tables.values()) {
            table.destroy();
        }
        tables.clear();

        const responsiveLayout: 'collapse' | false = responsive ? 'collapse' : false;

        for (const tab of data.tabs) {
            const columnDefs = columnDefsPerTab.get(tab.id)!;
            const config = getTableConfig(tab.data, tab.id, columnDefs, {
                groupBy: tab.groupBy,
            });

            config.responsiveLayout = responsiveLayout;
            if (!responsive) {
                delete config.rowHeader;
            }

            const table = new Tabulator(`#table-${tab.id}`, config);
            tables.set(tab.id, table);
        }

        setupEventListeners();
    }

    function setupEventListeners() {
        function updateTabCount(tabId: string, filteredCount: number, totalCount: number) {
            const tab = document.querySelector(`.dep-tab[data-tab="${tabId}"]`);
            if (!tab) return;

            const countBadge = tab.querySelector('.dep-tab-count');
            if (!countBadge) return;

            if (filteredCount < totalCount) {
                countBadge.textContent = `${filteredCount} / ${totalCount}`;
            } else {
                countBadge.textContent = String(totalCount);
            }
        }

        for (const tab of data.tabs) {
            const table = tables.get(tab.id);
            if (!table) continue;

            table.on('dataFiltered', (_filters: unknown, rows: RowData[]) => {
                updateTabCount(tab.id, rows.length, tab.data.length);
            });
        }
    }

    // Tab switching logic
    const tabElements = document.querySelectorAll('.dep-tab');
    const wrappers = document.querySelectorAll('.dep-table-wrapper');

    tabElements.forEach((tabEl) => {
        tabEl.addEventListener('click', () => {
            const buttonElement = tabEl as HTMLButtonElement;
            const tabId = buttonElement.dataset.tab;
            if (!tabId) return;

            // Update active tab
            tabElements.forEach((t) => t.classList.remove('active'));
            tabEl.classList.add('active');

            // Update visible table wrapper
            wrappers.forEach((w) => w.classList.remove('active'));
            const wrapper = document.getElementById(`table-${tabId}`);
            if (wrapper) {
                wrapper.classList.add('active');
                const table = tables.get(tabId);
                if (table) table.redraw();
            }
        });
    });

    // Initialize tables with responsive disabled by default
    createTables(false);

    // Responsive toggle logic
    const responsiveCheckbox = document.getElementById('responsive-checkbox') as HTMLInputElement;

    if (responsiveCheckbox) {
        responsiveCheckbox.addEventListener('change', () => {
            createTables(responsiveCheckbox.checked);
        });
    }
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
