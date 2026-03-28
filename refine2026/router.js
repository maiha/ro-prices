import { store } from './store.js';
import { expandDate, toJSTDate } from './utils.js';
import { renderTop } from './views/top.js';
import { renderRanking } from './views/ranking.js';
import { renderRefined } from './views/refined.js';
import { renderItems } from './views/items.js';
import { renderMarket } from './views/market.js';
import { renderCustom } from './views/custom.js';
import { renderItem } from './views/item.js';

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

export function navigateToRanking() {
    history.pushState({}, '', '#ranking');
    handleRouting();
}

export function navigateToAbout() {
    history.pushState({}, '', '#about');
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

export function navigateToItemSeries(itemId, seriesKey) {
    const [grade, refine] = String(seriesKey).split('_').map(Number);
    lastDate = currentDateParam() || latestDate();
    let hash = `#item/${itemId}/refine/${refine}`;
    if (grade !== 0) hash += `/grade/${grade}`;
    history.pushState({}, '', hash);
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
    const rankingSection = document.getElementById('ranking-section');
    const aboutSection = document.getElementById('about-section');
    const matrixSection = document.getElementById('matrix-section');
    const gridSection = document.getElementById('grid-section');
    const detailEl = document.getElementById('detail-view');
    const itemSelectSection = document.getElementById('item-select-section');
    const customSection = document.getElementById('custom-section');

    const show = (top, ranking, about, matrix, grid, detail, itemSelect, custom) => {
        topSection.style.display = top ? '' : 'none';
        rankingSection.style.display = ranking ? '' : 'none';
        aboutSection.style.display = about ? '' : 'none';
        matrixSection.style.display = matrix ? '' : 'none';
        gridSection.style.display = grid ? '' : 'none';
        detailEl.style.display = detail ? 'block' : 'none';
        itemSelectSection.style.display = itemSelect ? '' : 'none';
        customSection.style.display = custom ? '' : 'none';
        contentEl.style.display = 'flex';
    };

    document.getElementById('nav-top').classList.toggle('active', view === 'top');
    document.getElementById('nav-ranking').classList.toggle('active', view === 'ranking');
    document.getElementById('nav-about').classList.toggle('active', view === 'about');
    document.getElementById('nav-matrix').classList.toggle('active', view === 'market');
    document.getElementById('nav-refined').classList.toggle('active', view === 'refined');
    document.getElementById('nav-item').classList.toggle('active', view === 'item' || view === 'items');
    document.getElementById('nav-custom').classList.toggle('active', view === 'custom');

    if (view === 'top') {
        show(true, false, false, false, false, false, false, false);
        if (store.appAllRecords.length) renderTop();
        return;
    }

    if (view === 'about') {
        show(false, false, true, false, false, false, false, false);
        return;
    }

    if (!store.appAllRecords.length) return;

    if (view === 'ranking') {
        show(false, true, false, false, false, false, false, false);
        renderRanking();
    } else if (view === 'item' && itemId) {
        show(false, false, false, false, false, true, false, false);
        renderItem(itemId);
    } else if (view === 'items') {
        show(false, false, false, false, false, false, true, false);
        renderItems();
    } else if (view === 'refined') {
        show(false, false, false, false, true, false, false, false);
        renderRefined(dateStr);
    } else if (view === 'market') {
        show(false, false, false, true, false, false, false, false);
        renderMarket();
    } else if (view === 'custom') {
        show(false, false, false, false, false, false, false, true);
        renderCustom();
    } else {
        history.replaceState({}, '', '#top');
        handleRouting();
    }
}
