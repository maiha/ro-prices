import { store } from '../store.js';
import { REFINE_COLS } from '../constants.js';
import { getCellData, formatPrice, minOf } from '../utils.js';
import { getActiveNames } from './custom.js';

export function renderMatrix(dateStr) {
    const tbody = document.querySelector('#item-grid tbody');
    if (!tbody) return;

    const activeNames = getActiveNames();
    const stats = { 0: { max: -Infinity, min: Infinity }, 1: { max: -Infinity, min: Infinity } };

    const rowsData = activeNames.map(name => {
        const { item_id, cols } = store.appGroupMap.get(name);
        const itemKind = store.appKindMap.get(item_id) || '';
        const cellDataMap = {};
        const diffs = {};

        REFINE_COLS.forEach(col => {
            const key = `${col.grade}_${col.refine}`;
            const cell = cols[key];
            if (cell) {
                cellDataMap[key] = getCellData(cell.recs, dateStr, Infinity, minOf);
            }
        });

        [0, 1].forEach(grade => {
            const data9 = cellDataMap[`${grade}_9`];
            const data10 = cellDataMap[`${grade}_10`];
            if (data9?.price > 0 && data10?.price > 0) {
                const diff = data10.price - data9.price;
                diffs[grade] = diff;
                if (diff > stats[grade].max) stats[grade].max = diff;
                if (diff < stats[grade].min) stats[grade].min = diff;
            }
        });

        return { name, item_id, itemKind, cellDataMap, diffs };
    });

    // 絶対値的な閾値の計算 (最大・最小のレンジに対する割合)
    const thresholds = { 0: {}, 1: {} };
    [0, 1].forEach(grade => {
        const { max, min } = stats[grade];
        if (max !== -Infinity && min !== Infinity && max !== min) {
            const range = max - min;
            thresholds[grade].top10 = max - (range * 0.2);
            thresholds[grade].bottom10 = min + (range * 0.2);
        } else {
            thresholds[grade].top10 = Infinity;
            thresholds[grade].bottom10 = -Infinity;
        }
    });

    tbody.innerHTML = rowsData.map(row => {
        const slotClass = `slot-col caz-eq caz-eq-${row.itemKind}`;

        const cells = REFINE_COLS.map(col => {
            const sep = col.grade === 1 && col.refine === 7 ? ' grade-sep' : '';
            const currentData = row.cellDataMap[`${col.grade}_${col.refine}`];
            let tdStr = `<td class="price-cell empty${sep}"></td>`;

            if (currentData && currentData.price > 0) {
                const { price, daysAgo, prevPrice } = currentData;
                const colorClass = daysAgo > 0 ? ' price-stale'
                    : (prevPrice <= 0 || price > prevPrice) ? ' price-up'
                        : price < prevPrice ? ' price-down' : '';
                const ageBadge = daysAgo > 0 ? `<span class="age-badge">${daysAgo}d</span>` : '';
                tdStr = `<td class="price-cell${sep}${colorClass}">${formatPrice(price)}${ageBadge}</td>`;
            }

            let extraTd = '';
            if (col.refine === 10) {
                const diff = row.diffs[col.grade];
                if (diff !== undefined) {
                    const sign = diff > 0 ? '+' : '';
                    const { max } = stats[col.grade];
                    const th = thresholds[col.grade];

                    let highlightClass = '';
                    if (diff === max) {
                        highlightClass = ' max-diff-highlight';
                    } else if (diff >= th.top10) {
                        highlightClass = ' diff-top-group';
                    } else if (diff <= th.bottom10) {
                        highlightClass = ' diff-bottom-group';
                    }

                    extraTd = `<td class="price-cell${highlightClass}">${sign}${formatPrice(diff)}</td>`;
                } else {
                    extraTd = '<td class="price-cell empty"></td>';
                }
            }

            return tdStr + extraTd;
        }).join('');

        return `<tr data-item-id="${row.item_id}"><td class="${slotClass}"></td><td class="name-col"><span class="item-name-link">${row.name}</span></td>${cells}</tr>`;
    }).join('');
}

export function renderView(dateStr) {
    const idx = store.appAvailableDates.indexOf(dateStr);
    const label = document.getElementById('view-date-label');
    const prevBtn = document.getElementById('prev-day-btn');
    const nextBtn = document.getElementById('next-day-btn');

    if (label) label.textContent = `精錬値別  ${dateStr.replace(/-/g, '/')}`;
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx < 0 || idx >= store.appAvailableDates.length - 1;

    renderMatrix(dateStr);
}