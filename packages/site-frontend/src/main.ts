import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { RowData, TabulatorInstance } from './types';
import { createColumnDefs, getTableConfig } from './config';
import { exportToCsv } from './csv-export';

/**
 * Main entry point for browser-side initialization
 * Data is passed via window.dependicusData global variable
 */
function init() {
    const data = window.dependicusData;

    // Store table instances keyed by tab id
    const tables = new Map<string, TabulatorInstance>();

    // Navigation state
    let activeProvider = data.providers[0]?.name ?? '';
    let activeTabType: 'deps' | 'dups' = 'deps';

    // DOM references
    const providerButtons = document.querySelectorAll<HTMLButtonElement>('.dep-provider');
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('.dep-tab');
    const wrappers = document.querySelectorAll<HTMLElement>('.dep-table-wrapper');
    const depsBadge = tabButtons[0]?.querySelector('.dep-tab-count');
    const dupsBadge = tabButtons[1]?.querySelector('.dep-tab-count');
    const exportBtn = document.getElementById('export-csv') as HTMLButtonElement | null;

    const filteredState = new Map<string, boolean>();

    function getTabId(provider: string, tabType: string): string {
        return tabType === 'deps' ? provider : `${provider}-duplicates`;
    }

    function showTab(provider: string, tabType: string) {
        const tabId = getTabId(provider, tabType);
        wrappers.forEach((w) => w.classList.remove('active'));
        const wrapper = document.getElementById(`table-${tabId}`);
        if (wrapper) {
            wrapper.classList.add('active');
            const table = tables.get(tabId);
            if (table) table.redraw();
        }
    }

    function updateCounts(provider: string) {
        const depsTab = data.tabs.find((t) => t.id === provider);
        const dupsTab = data.tabs.find((t) => t.id === `${provider}-duplicates`);
        if (depsBadge) depsBadge.textContent = String(depsTab?.data.length ?? 0);
        if (dupsBadge) dupsBadge.textContent = String(dupsTab?.data.length ?? 0);
    }

    function updateProviderButtons(provider: string) {
        providerButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.provider === provider);
        });
    }

    function updateTabButtons(tabType: string) {
        tabButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tabType === tabType);
        });
    }

    function setHash(provider: string, tabType: string) {
        const hash = getTabId(provider, tabType);
        history.replaceState(null, '', `#${hash}`);
    }

    function parseHash(): { provider: string; tabType: 'deps' | 'dups' } {
        const hash = location.hash.slice(1);
        if (!hash) return { provider: activeProvider, tabType: 'deps' };

        const providerNames = data.providers.map((p) => p.name);

        // Check for duplicates suffix first
        for (const name of providerNames) {
            if (hash === `${name}-duplicates`) {
                return { provider: name, tabType: 'dups' };
            }
        }

        // Check for exact provider name
        if (providerNames.includes(hash)) {
            return { provider: hash, tabType: 'deps' };
        }

        // Fallback
        return { provider: activeProvider, tabType: 'deps' };
    }

    function updateExportButton() {
        if (!exportBtn) return;
        const tabId = getTabId(activeProvider, activeTabType);
        const isFiltered = filteredState.get(tabId) ?? false;
        exportBtn.textContent = isFiltered ? 'Export Selected' : 'Export';
    }

    function navigate(provider: string, tabType: 'deps' | 'dups') {
        activeProvider = provider;
        activeTabType = tabType;
        updateProviderButtons(provider);
        updateTabButtons(tabType);
        updateCounts(provider);
        showTab(provider, tabType);
        setHash(provider, tabType);
        updateExportButton();
    }

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
            // Only update the badge if this tab belongs to the active provider
            const isDeps = tabId === activeProvider;
            const isDups = tabId === `${activeProvider}-duplicates`;
            if (!isDeps && !isDups) return;

            const badge = isDeps ? depsBadge : dupsBadge;
            if (!badge) return;

            if (filteredCount < totalCount) {
                badge.textContent = `${filteredCount} / ${totalCount}`;
            } else {
                badge.textContent = String(totalCount);
            }
        }

        for (const tab of data.tabs) {
            const table = tables.get(tab.id);
            if (!table) continue;

            table.on('dataFiltered', (_filters: unknown, rows: RowData[]) => {
                updateTabCount(tab.id, rows.length, tab.data.length);
                filteredState.set(tab.id, rows.length < tab.data.length);
                updateExportButton();
            });
        }
    }

    // Provider click handlers
    providerButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const provider = btn.dataset.provider;
            if (!provider) return;
            navigate(provider, activeTabType);
        });
    });

    // Tab click handlers
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tabType = btn.dataset.tabType as 'deps' | 'dups';
            if (!tabType) return;
            navigate(activeProvider, tabType);
        });
    });

    // Export CSV click handler
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const tabId = getTabId(activeProvider, activeTabType);
            const table = tables.get(tabId);
            if (!table) return;

            const isFiltered = filteredState.get(tabId) ?? false;
            const rows = isFiltered
                ? (table.getData('active') as RowData[])
                : (table.getData() as RowData[]);

            const suffix = activeTabType === 'dups' ? '-duplicates' : '';
            const filename = `dependicus-${activeProvider}${suffix}.csv`;
            exportToCsv(rows, filename);
        });
    }

    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
        const { provider, tabType } = parseHash();
        navigate(provider, tabType);
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

    // Restore state from hash or use defaults
    const initial = parseHash();
    navigate(initial.provider, initial.tabType);
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
