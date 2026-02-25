import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { RowData, TabulatorInstance } from './types';
import { createColumnDefs, getTableConfig } from './config';

/**
 * Main entry point for browser-side initialization
 * Data is passed via window.dependicusData global variable
 */
function init() {
    const data = window.dependicusData;

    // Create column definitions
    const columnDefs = createColumnDefs(data.uniqueNotes, data.customColumns);

    // Store table instances
    let allDepsTable: TabulatorInstance;
    let multiVersionsTable: TabulatorInstance;
    let catalogTable: TabulatorInstance;

    // Create tables with specified responsive setting
    function createTables(responsive: boolean) {
        // Destroy existing tables if they exist
        if (allDepsTable) allDepsTable.destroy();
        if (multiVersionsTable) multiVersionsTable.destroy();
        if (catalogTable) catalogTable.destroy();

        // Update configs with responsive setting
        const responsiveLayout: 'collapse' | false = responsive ? 'collapse' : false;
        const allConfig = getTableConfig(data.allData, 'all-deps', columnDefs);
        const multiConfig = getTableConfig(data.multiVersionData, 'multi-versions', columnDefs, {
            groupBy: 'Package Name',
        });
        const catalogConfig = getTableConfig(data.catalogData, 'catalog', columnDefs);

        allConfig.responsiveLayout = responsiveLayout;
        multiConfig.responsiveLayout = responsiveLayout;
        catalogConfig.responsiveLayout = responsiveLayout;

        // When responsive is disabled, remove rowHeader to avoid errors
        if (!responsive) {
            delete allConfig.rowHeader;
            delete multiConfig.rowHeader;
            delete catalogConfig.rowHeader;
        }

        // Create new tables
        allDepsTable = new Tabulator('#all-deps-table', allConfig);
        multiVersionsTable = new Tabulator('#multi-versions-table', multiConfig);
        catalogTable = new Tabulator('#catalog-table', catalogConfig);

        // Set up event listeners
        setupEventListeners();
    }

    function setupEventListeners() {
        // Update tab counts when data is filtered
        function updateTabCount(sheet: string, filteredCount: number, totalCount: number) {
            const tab = document.querySelector(`.dep-tab[data-sheet="${sheet}"]`);
            if (!tab) return;

            const countBadge = tab.querySelector('.dep-tab-count');
            if (!countBadge) return;

            if (filteredCount < totalCount) {
                countBadge.textContent = `${filteredCount} / ${totalCount}`;
            } else {
                countBadge.textContent = String(totalCount);
            }
        }

        allDepsTable.on('dataFiltered', (_filters: unknown, rows: RowData[]) => {
            updateTabCount('all', rows.length, data.allData.length);
        });

        multiVersionsTable.on('dataFiltered', (_filters: unknown, rows: RowData[]) => {
            updateTabCount('multi', rows.length, data.multiVersionData.length);
        });

        catalogTable.on('dataFiltered', (_filters: unknown, rows: RowData[]) => {
            updateTabCount('catalog', rows.length, data.catalogData.length);
        });
    }

    // Tab switching logic
    const tabs = document.querySelectorAll('.dep-tab');
    const wrappers = document.querySelectorAll('.dep-table-wrapper');

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const buttonElement = tab as HTMLButtonElement;
            const sheet = buttonElement.dataset.sheet;

            // Update active tab
            tabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            // Update visible table
            wrappers.forEach((w) => w.classList.remove('active'));
            if (sheet === 'all') {
                const element = document.getElementById('all-deps-table');
                if (element) {
                    element.classList.add('active');
                    if (allDepsTable) allDepsTable.redraw();
                }
            } else if (sheet === 'multi') {
                const element = document.getElementById('multi-versions-table');
                if (element) {
                    element.classList.add('active');
                    if (multiVersionsTable) multiVersionsTable.redraw();
                }
            } else if (sheet === 'catalog') {
                const element = document.getElementById('catalog-table');
                if (element) {
                    element.classList.add('active');
                    if (catalogTable) catalogTable.redraw();
                }
            }
        });
    });

    // Initialize tables with responsive disabled by default
    createTables(false);

    // Responsive toggle logic
    const responsiveCheckbox = document.getElementById('responsive-checkbox') as HTMLInputElement;

    if (responsiveCheckbox) {
        responsiveCheckbox.addEventListener('change', () => {
            // Recreate tables with new responsive setting
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
