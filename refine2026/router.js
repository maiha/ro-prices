import { store } from './store.js';
import { expandDate, toJSTDate } from './utils.js';
import { renderView } from './views/refined.js';
import { renderItemSelect } from './views/itemSelect.js';
import { renderOverallMatrix } from './views/overallMatrix.js';
import { renderCustomSelect } from './views/custom.js';
import { renderChart } from './chartFeature.js';

let lastDate = null;
let lastHashBeforeCustom = '#refined';

export function parseHash() {
    const hash = location.hash.slice(1);
    return hash.split('/').filter(Boolean);
}

export function currentDateParam() {
    const parts = parseHash();
    if (parts[0] !== 'refined' || !parts[1]) return null;
    return expandDate(parts[1]);
}

export function latestDate() {
    return store.appAvailableDates[store.appAvailableDates.length - 1] || toJSTDate(Date.now());
}

export function navigateToTop() {
    history.pushState({}, '', '#top');
    handleRouting();
}

export function navigateToMatrix() {
    history.pushState({}, '', '#market');
    handleRouting();
}

export function navigateToItemSelect() {
    history.pushState({}, '', '#items');
    handleRouting();
}

export function navigateToDate(dateStr) {
    history.pushState({}, '', `#refined/${dateStr.replace(/-/g, '')}`);
    handleRouting();
}

export function navigateToList() {
    history.pushState({}, '', '#refined');
    handleRouting();
}

export function navigateToItem(itemId) {
    lastDate = currentDateParam() || latestDate();
    history.pushState({}, '', `#item/${itemId}`);
    handleRouting();
}

export function navigateToCustom() {
    const current = location.hash || '#refined';
    if (current !== '#custom') lastHashBeforeCustom = current;
    history.pushState({}, '', '#custom');
    handleRouting();
}

export function navigateBackFromCustom() {
    history.pushState({}, '', lastHashBeforeCustom);
    handleRouting();
}

export function getLastDate() {
    return lastDate;
}

export function handleRouting() {
    window.scrollTo(0, 0);

    const parts = parseHash();
    const view = parts[0];
    if (!view) {
        history.replaceState({}, '', '#top');
        handleRouting();
        return;
    }

    const itemId = view === 'item' ? (parts[1] || null) : null;
    const dateStr = view === 'refined' ? (parts[1] ? expandDate(parts[1]) : latestDate()) : null;

    const contentEl = document.getElementById('content');
    const topSection = document.getElementById('top-section');
    const matrixSection = document.getElementById('matrix-section');
    const gridSection = document.getElementById('grid-section');
    const detailEl = document.getElementById('detail-view');
    const itemSelectSection = document.getElementById('item-select-section');
    const customSection = document.getElementById('custom-section');

    const show = (top, matrix, grid, detail, itemSelect, custom) => {
        topSection.style.display = top ? '' : 'none';
        matrixSection.style.display = matrix ? '' : 'none';
        gridSection.style.display = grid ? '' : 'none';
        detailEl.style.display = detail ? 'block' : 'none';
        itemSelectSection.style.display = itemSelect ? '' : 'none';
        customSection.style.display = custom ? '' : 'none';
        contentEl.style.display = 'flex';
    };

    document.getElementById('nav-top').classList.toggle('active', view === 'top');
    document.getElementById('nav-matrix').classList.toggle('active', view === 'market');
    document.getElementById('nav-refined').classList.toggle('active', view === 'refined');
    document.getElementById('nav-item').classList.toggle('active', view === 'item' || view === 'items');
    document.getElementById('nav-custom').classList.toggle('active', view === 'custom');

    if (view === 'top') {
        show(true, false, false, false, false, false);
        return;
    }

    if (!store.appAllRecords.length) return;

    if (view === 'item' && itemId) {
        show(false, false, false, true, false, false);
        renderChart(itemId);
    } else if (view === 'items') {
        show(false, false, false, false, true, false);
        renderItemSelect();
    } else if (view === 'refined') {
        show(false, false, true, false, false, false);
        renderView(dateStr);
    } else if (view === 'market') {
        show(false, true, false, false, false, false);
        renderOverallMatrix();
    } else if (view === 'custom') {
        show(false, false, false, false, false, true);
        renderCustomSelect();
    } else {
        history.replaceState({}, '', '#top');
        handleRouting();
    }
}
