import { store } from '../store.js';
import { REFINE_COLS } from '../constants.js';
import { getCellData, getMatrixCellClass, formatPrice, minOf } from '../utils.js';
import { getActiveNames } from './custom.js';

// 列ページネーション状態
export const overallMatrixUiState = {
    windowSize: 14,   // 表示する日付列数: 7 | 14 | 30
    pageStart: null,  // 表示開始インデックス（null = 最新ページに自動セット）
};

export function renderOverallMatrix() {
    const table = document.getElementById('overall-matrix');
    if (!table) return;

    const allDates = store.appMatrixDates;
    const names = getActiveNames();
    const allExpanded = names.length > 0 && names.every(n => store.expandedItems.has(n));

    // ページウィンドウ計算
    const ws = overallMatrixUiState.windowSize;
    const maxStart = Math.max(0, allDates.length - ws);
    if (overallMatrixUiState.pageStart === null) overallMatrixUiState.pageStart = maxStart;
    const pageStart = Math.max(0, Math.min(overallMatrixUiState.pageStart, maxStart));
    overallMatrixUiState.pageStart = pageStart;
    const dates = allDates.slice(pageStart, pageStart + ws);

    const prevDisabled = pageStart === 0;
    const nextDisabled = pageStart >= maxStart;
    const rangeStr = dates.length > 0
        ? `${dates[0].slice(5).replace('-', '/')} 〜 ${dates[dates.length - 1].slice(5).replace('-', '/')}`
        : '';

    // ページャーを section-actions に描画
    const pagerEl = document.querySelector('#matrix-section .section-actions');
    if (pagerEl) {
        pagerEl.innerHTML =
            `<div class="matrix-pager">` +
            `<div class="matrix-nav">` +
            `<span class="matrix-pager-range">${rangeStr}</span>` +
            `<button class="matrix-nav-btn matrix-prev-btn"${prevDisabled ? ' disabled' : ''}>◀ 前</button>` +
            `<button class="matrix-nav-btn matrix-next-btn"${nextDisabled ? ' disabled' : ''}>次 ▶</button>` +
            `</div>` +
            `<div class="matrix-win-btns">` +
            [7, 14, 30].map(n =>
                `<button class="matrix-win-btn${n === ws ? ' active' : ''}" data-win="${n}">${n}日</button>`
            ).join('') +
            `</div>` +
            `</div>`;
    }

    const theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = `<th class="slot-col">部位</th>` +
        `<th class="name-col"><div class="name-col-inner">アイテム名<span class="expand-all-btn expand-btn">${allExpanded ? '▲' : '▼'}</span></div></th>` +
        dates.map(d => {
            const [, m, day] = d.split('-');
            return `<th class="matrix-date" data-date="${d}">${Number(m)}/${Number(day)}</th>`;
        }).join('');

    const tbody = table.querySelector('tbody');
    const rows = [];

    names.forEach(name => {
        const priceByDate = store.appMatrixData.get(name) || new Map();
        const { item_id } = store.appGroupMap.get(name) || {};
        const isExpanded = store.expandedItems.has(name);
        const itemKind = store.appKindMap.get(item_id) || '';
        const slotClass = `slot-col caz-eq caz-eq-${itemKind}`;
        const slotLabel = store.appSlotLabelMap.get(store.appKindMap.get(item_id)) || ''
        const nameCell = `<td class="name-col"><div class="name-col-inner"><span class="item-name-link" data-item-id="${item_id}">${name}</span><span class="expand-btn">${isExpanded ? '▲' : '▼'}</span></div></td>`;
        const rowPrices = dates.map(d => priceByDate.get(d) || 0);

        const cells = dates.map((d, i) => {
            const price = rowPrices[i];
            if (price <= 0) return '<td class="matrix-cell empty"></td>';
            const cls = getMatrixCellClass(price, rowPrices);
            return `<td class="matrix-cell${cls ? ' ' + cls : ''}">${formatPrice(price)}</td>`;
        }).join('');

        rows.push(`<tr data-expand-name="${name}"><td class="${slotClass}"></td>${nameCell}${cells}</tr>`);

        if (!isExpanded) return;
        [...REFINE_COLS].reverse().forEach(col => {
            const key = `${col.grade}_${col.refine}`;
            const recs = store.appGroupMap.get(name)?.cols[key]?.recs || [];
            if (recs.length === 0) return;
            const subData = dates.map(d => getCellData(recs, d, 0, minOf));
            const subRowPrices = subData.map(sd => sd.price);
            const subCells = dates.map((d, i) => {
                const { price } = subData[i];
                if (price <= 0) return `<td class="matrix-cell empty" data-date="${d}"></td>`;
                const cls = getMatrixCellClass(price, subRowPrices);
                return `<td class="matrix-cell${cls ? ' ' + cls : ''}" data-date="${d}">${formatPrice(price)}</td>`;
            }).join('');
            rows.push(`<tr class="sub-row"><td class="slot-col"></td><td class="name-col sub-label">${col.label}</td>${subCells}</tr>`);
        });
    });

    tbody.innerHTML = rows.join('');

    const slotColTh = table.querySelector('th.slot-col');
    const nameColTh = table.querySelector('th.name-col');
    const wrapper = table.closest('.matrix-wrapper');
    if (!nameColTh || !wrapper) return;

    const slotWidth = slotColTh ? slotColTh.offsetWidth : 0;
    table.querySelectorAll('td.slot-col, th.slot-col').forEach(el => { el.style.left = '0px'; });
    table.querySelectorAll('td.name-col, th.name-col').forEach(el => { el.style.left = `${slotWidth}px`; });
    wrapper.style.setProperty('--name-col-w', `${slotWidth + nameColTh.offsetWidth}px`);
    // ページングで最新日を表示するため、横スクロール自動移動は不要
}
