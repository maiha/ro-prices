import { store } from '../store.js';
import { formatPrice, toJSTDate } from '../utils.js';
import { navigateToItem, navigateToItemSeries } from '../router.js';

const RANKING_N = 20;

let _renderedDate = null;

export function renderRanking() {
    const section = document.getElementById('ranking-section');
    if (!section) return;

    const dates      = store.appMatrixDates;
    const latestDate = dates[dates.length - 1];

    if (_renderedDate === latestDate && section.children.length > 0) return;
    _renderedDate = latestDate;

    const items010  = buildRankItems('0_10');
    const items110  = buildRankItems('1_10');
    const cards010  = items010.map((r, i) => renderRankCard(r, i + 1, '0_10')).join('');
    const cards110  = items110.map((r, i) => renderRankCard(r, i + 1, '1_10')).join('');

    section.innerHTML =
        renderSectionHead('価格ランキング: +10', latestDate) +
        `<div class="alert-group-cards ranking-cards">${cards010 || '<span class="alert-empty">データなし</span>'}</div>` +
        renderSectionHead('価格ランキング: +10(★1)', latestDate) +
        `<div class="alert-group-cards ranking-cards">${cards110 || '<span class="alert-empty">データなし</span>'}</div>`;

    section.addEventListener('click', e => {
        const card = e.target.closest('.alert-card[data-item-id]');
        if (!card) return;
        const seriesKey = card.dataset.seriesKey;
        if (seriesKey && seriesKey !== '0_10') navigateToItemSeries(card.dataset.itemId, seriesKey);
        else navigateToItem(card.dataset.itemId);
    });
}

function renderSectionHead(label, date) {
    return (
        `<div class="section-head">` +
        `<h2 class="section-lead">${label}</h2>` +
        `<div class="section-actions"><span class="ranking-date">${date || ''}</span></div>` +
        `</div>`
    );
}

function buildRankItems(colKey) {
    const result = [];
    store.appSortedNames.forEach(name => {
        const entry = store.appGroupMap.get(name);
        if (!entry) return;
        const col = entry.cols[colKey];
        if (!col || !col.recs || col.recs.length === 0) return;

        // 日付ごとに最安値を集計
        const byDate = new Map();
        col.recs.forEach(r => {
            const d = toJSTDate(r.ts);
            if (!byDate.has(d) || r.price < byDate.get(d)) byDate.set(d, r.price);
        });

        // 日付降順で直近2つの価格を探す
        const sortedDates = [...byDate.keys()].sort().reverse();
        let price = 0, prevPrice = 0;
        for (const d of sortedDates) {
            const p = byDate.get(d);
            if (p > 0) {
                if (price === 0) price = p;
                else { prevPrice = p; break; }
            }
        }

        if (price > 0) result.push({ name, item_id: entry.item_id, price, prevPrice });
    });

    return result
        .sort((a, b) => b.price - a.price)
        .slice(0, RANKING_N);
}

function renderRankCard(r, rank, seriesKey = '0_10') {
    const diff    = r.prevPrice > 0 ? r.price - r.prevPrice : null;
    const diffPct = diff !== null && r.prevPrice > 0 ? (diff / r.prevPrice) * 100 : null;
    const isUp    = diff !== null && diff > 0;
    const isDown  = diff !== null && diff < 0;
    const diffCls  = isUp ? 'tbp-change positive' : isDown ? 'tbp-change negative' : 'tbp-change';
    const diffMark = isUp ? '▲' : isDown ? '▼' : '';
    const diffText = diff === null
        ? ''
        : `${diffMark}${(Math.abs(diff) / 1e9).toFixed(2)}G (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(2)}%)`;

    return (
        `<div class="alert-card alert-card-popular" data-item-id="${r.item_id}" data-series-key="${seriesKey}">` +
        `<div class="alert-card-stripe"></div>` +
        `<div class="alert-card-body">` +
        `<div class="alert-card-row1"><div class="alert-card-row1-left">` +
        `<span class="alert-card-label alert-label-popular">${rank}位</span>` +
        `</div></div>` +
        `<div class="alert-card-name">${r.name}</div>` +
        `<div class="alert-card-price"><span class="alert-price-col">` +
        `<span class="tbp-main ${isUp ? 'positive' : isDown ? 'negative' : ''}">${formatPrice(r.price)}G</span>` +
        (diffText ? `<span class="${diffCls}">${diffText}</span>` : '') +
        `</span></div>` +
        `</div></div>`
    );
}
