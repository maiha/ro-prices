import { store } from './store.js';
import { init } from './data.js';
import {
    currentDateParam,
    handleRouting,
    latestDate,
    navigateBackFromCustom,
    navigateToCustom,
    navigateToDate,
    navigateToItem,
    navigateToItemSelect,
    navigateToList,
    navigateToMatrix,
    navigateToTop,
} from './router.js';
import { overallMatrixUiState, renderOverallMatrix } from './views/overallMatrix.js';
import { getActiveNames, loadCustomItems, renderCustomSelect, saveCustomItems, updateCustomCount } from './views/custom.js';
import { bindChartFeatureEvents } from './chartFeature.js';

bindChartFeatureEvents();

function bindEvents() {
    document.addEventListener('keydown', e => {
        if (e.key !== '/' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;

        const searchInput = document.getElementById('item-search-root-input');
        if (!searchInput) return;
        if (document.activeElement === searchInput || e.target === searchInput) return;

        e.preventDefault();
        searchInput.focus();
        if (typeof searchInput.select === 'function') searchInput.select();
    });

    document.addEventListener('click', e => {
        // 相場一覧 ページャー
        const matrixWinBtn = e.target.closest('#matrix-section .matrix-win-btn[data-win]');
        if (matrixWinBtn) {
            overallMatrixUiState.windowSize = Number(matrixWinBtn.dataset.win);
            overallMatrixUiState.pageStart = null;
            renderOverallMatrix();
            return;
        }
        if (e.target.closest('#matrix-section .matrix-prev-btn')) {
            overallMatrixUiState.pageStart = Math.max(0, overallMatrixUiState.pageStart - overallMatrixUiState.windowSize);
            renderOverallMatrix();
            return;
        }
        if (e.target.closest('#matrix-section .matrix-next-btn')) {
            const max = Math.max(0, store.appMatrixDates.length - overallMatrixUiState.windowSize);
            overallMatrixUiState.pageStart = Math.min(max, overallMatrixUiState.pageStart + overallMatrixUiState.windowSize);
            renderOverallMatrix();
            return;
        }

        if (e.target.closest('#overall-matrix th .expand-all-btn')) {
            const allNames = getActiveNames();
            const allExpanded = allNames.length > 0 && allNames.every(n => store.expandedItems.has(n));
            if (allExpanded) allNames.forEach(n => store.expandedItems.delete(n));
            else allNames.forEach(n => store.expandedItems.add(n));
            renderOverallMatrix();
            return;
        }

        const expandRow = e.target.closest('tr[data-expand-name]');
        if (expandRow) {
            const nameLink = e.target.closest('.item-name-link[data-item-id]');
            if (nameLink) {
                navigateToItem(nameLink.dataset.itemId);
                return;
            }
            const name = expandRow.dataset.expandName;
            if (store.expandedItems.has(name)) store.expandedItems.delete(name);
            else store.expandedItems.add(name);
            renderOverallMatrix();
            return;
        }

        const itemLink = e.target.closest('a[data-item-id]');
        if (itemLink) {
            e.preventDefault();
            navigateToItem(itemLink.dataset.itemId);
            return;
        }

        if (e.target.closest('a')) return;

        const dateEl = e.target.closest('[data-date]');
        if (dateEl) {
            navigateToDate(dateEl.dataset.date);
            return;
        }

        const tr = e.target.closest('tr[data-item-id]');
        if (tr) navigateToItem(tr.dataset.itemId);
    });

    window.addEventListener('popstate', handleRouting);
    window.addEventListener('hashchange', handleRouting);

    document.getElementById('title-link').addEventListener('click', e => { e.preventDefault(); navigateToTop(); });
    document.getElementById('nav-top').addEventListener('click', e => { e.preventDefault(); navigateToTop(); });
    document.getElementById('nav-refined').addEventListener('click', e => { e.preventDefault(); navigateToList(); });
    document.getElementById('nav-matrix').addEventListener('click', e => { e.preventDefault(); navigateToMatrix(); });
    document.getElementById('nav-item').addEventListener('click', e => { e.preventDefault(); navigateToItemSelect(); });
    document.getElementById('nav-custom').addEventListener('click', e => {
        e.preventDefault();
        if (e.currentTarget.classList.contains('active')) navigateBackFromCustom();
        else navigateToCustom();
    });

    document.getElementById('custom-mode-toggle').addEventListener('change', e => {
        store.appCustomMode = e.target.checked;
        handleRouting();
    });

    document.getElementById('reload-btn').addEventListener('click', () => init());

    document.getElementById('custom-body').addEventListener('click', e => {
        const btn = e.target.closest('.custom-toggle[data-item-id]');
        if (!btn) return;
        const itemId = btn.dataset.itemId;
        if (store.appCustomItems.has(itemId)) store.appCustomItems.delete(itemId);
        else store.appCustomItems.add(itemId);
        saveCustomItems();
        btn.classList.toggle('custom-toggle-on', store.appCustomItems.has(itemId));
        updateCustomCount();
    });

    document.getElementById('custom-all-btn').addEventListener('click', () => {
        store.appNameMap.forEach((_, item_id) => store.appCustomItems.add(item_id));
        saveCustomItems();
        renderCustomSelect();
    });

    document.getElementById('custom-none-btn').addEventListener('click', () => {
        store.appCustomItems.clear();
        saveCustomItems();
        renderCustomSelect();
    });

    document.getElementById('prev-day-btn').addEventListener('click', () => {
        const date = currentDateParam() || latestDate();
        const idx = store.appAvailableDates.indexOf(date);
        if (idx > 0) navigateToDate(store.appAvailableDates[idx - 1]);
    });

    document.getElementById('next-day-btn').addEventListener('click', () => {
        const date = currentDateParam() || latestDate();
        const idx = store.appAvailableDates.indexOf(date);
        if (idx >= 0 && idx < store.appAvailableDates.length - 1) navigateToDate(store.appAvailableDates[idx + 1]);
    });
}

bindEvents();

loadCustomItems();
if (store.appCustomItems.size > 0) {
    store.appCustomMode = true;
    document.getElementById('custom-mode-toggle').checked = true;
}

init();
