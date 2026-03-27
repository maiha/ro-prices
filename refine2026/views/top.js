import { store } from '../store.js';
import { formatPrice } from '../utils.js';
import { navigateToItem } from '../router.js';

const TOP_N = 6;

function minOf(arr) {
    return arr.length ? Math.min(...arr) : 0;
}

function computeWindow(windowMs) {
    const now = Date.now();
    const lateCutoff  = now - windowMs / 2;  // 直近1.5日の境界
    const earlyCutoff = now - windowMs;       // 3日前

    const fmtDate = ts => {
        const d = new Date(ts + 9 * 3600000);
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    };

    const fmtDatetime = ts => {
        const d = new Date(ts + 9 * 3600000);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
    };

    const allFiltered = store.appAllRecords.filter(r =>
        r.grade === 0 && r.refine === 10 && !r.card1
    );

    // 取引量：直近3日
    const volumeMap = new Map();
    allFiltered.filter(r => r.ts >= earlyCutoff).forEach(r =>
        volumeMap.set(r.item_id, (volumeMap.get(r.item_id) || 0) + 1)
    );

    // 後半：直近1.5日
    const lateMap = new Map();
    allFiltered.filter(r => r.ts >= lateCutoff).forEach(r => {
        if (!lateMap.has(r.item_id)) lateMap.set(r.item_id, []);
        lateMap.get(r.item_id).push({ price: r.price, ts: r.ts });
    });

    // 前半優先：1.5〜3日前。なければlateCutoff以前全件をfallback
    const earlyWindowMap = new Map();
    allFiltered.filter(r => r.ts >= earlyCutoff && r.ts < lateCutoff).forEach(r => {
        if (!earlyWindowMap.has(r.item_id)) earlyWindowMap.set(r.item_id, []);
        earlyWindowMap.get(r.item_id).push({ price: r.price, ts: r.ts });
    });

    const fallbackCutoff = now - 7 * 86400_000;  // 最大1週間前まで
    const earlyFallbackMap = new Map();
    allFiltered.filter(r => r.ts >= fallbackCutoff && r.ts < lateCutoff).forEach(r => {
        if (!earlyFallbackMap.has(r.item_id)) earlyFallbackMap.set(r.item_id, []);
        earlyFallbackMap.get(r.item_id).push({ price: r.price, ts: r.ts });
    });

    // 最終取引・前回取引（人気カード用）
    const latestRecMap = new Map();
    const prevRecMap   = new Map();
    allFiltered.filter(r => r.ts >= earlyCutoff).forEach(r => {
        const cur = latestRecMap.get(r.item_id);
        if (!cur || r.ts > cur.ts) {
            if (cur) prevRecMap.set(r.item_id, cur);
            latestRecMap.set(r.item_id, r);
        } else if (!prevRecMap.get(r.item_id) || r.ts > prevRecMap.get(r.item_id).ts) {
            prevRecMap.set(r.item_id, r);
        }
    });

    const changes = [];
    lateMap.forEach((late, item_id) => {
        const earlyWindow = earlyWindowMap.get(item_id) || [];
        const early = earlyWindow.length > 0 ? earlyWindow : (earlyFallbackMap.get(item_id) || []);
        if (!early.length) return;
        const baseRec   = early.reduce((m, r) => r.price < m.price ? r : m);
        const latestRec = late.reduce((m, r) => r.price < m.price ? r : m);
        if (baseRec.price <= 0 || latestRec.price <= 0) return;
        changes.push({
            item_id,
            basePrice: baseRec.price, baseDate: fmtDate(baseRec.ts),
            latestPrice: latestRec.price, latestDate: fmtDate(latestRec.ts),
            ratio: latestRec.price / baseRec.price,
            vol: volumeMap.get(item_id) || 0,
        });
    });

    const popular = [...volumeMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N)
        .map(([item_id, vol]) => {
            const latest = latestRecMap.get(item_id);
            const prev   = prevRecMap.get(item_id);
            const latestPrice = latest?.price ?? 0;
            const prevPrice   = prev?.price ?? null;
            const change      = latestPrice && prevPrice ? latestPrice - prevPrice : null;
            const changePct   = change !== null && prevPrice ? (change / prevPrice) * 100 : null;
            return {
                item_id, vol,
                latestPrice,
                latestDatetime: latest ? fmtDatetime(latest.ts) : '',
                change, changePct,
            };
        });

    const upItems   = changes.filter(c => c.ratio > 1.05).sort((a, b) => b.ratio - a.ratio).slice(0, TOP_N);
    const downItems = changes.filter(c => c.ratio < 0.95).sort((a, b) => a.ratio - b.ratio).slice(0, TOP_N);

    return { popular, upItems, downItems };
}

function fmtSignedG(v) {
    const sign = v > 0 ? '+' : '';
    return `${sign}${(v / 1e9).toFixed(2)}G`;
}

function fmtPct(v) {
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
}

function renderPopularCard(item) {
    const name = store.appNameMap.get(item.item_id) || item.item_id;
    const isUp   = item.change != null && item.change > 0;
    const isDown = item.change != null && item.change < 0;
    const changeCls  = isUp ? 'tbp-change positive' : isDown ? 'tbp-change negative' : 'tbp-change';
    const changeMark = isUp ? '▲' : isDown ? '▼' : '';
    const changeText = item.change != null
        ? `${changeMark}${fmtSignedG(item.change)} (${fmtPct(item.changePct)})`
        : '';
    const priceHtml = item.latestPrice > 0
        ? `<div class="alert-card-price">` +
          `<span class="alert-price-col">` +
          `<span class="tbp-main ${isUp ? 'positive' : isDown ? 'negative' : ''}">${formatPrice(item.latestPrice)}G</span>` +
          (changeText ? `<span class="${changeCls}">${changeText}</span>` : '') +
          `<span class="alert-price-date">${item.latestDatetime}</span>` +
          `</span></div>`
        : '';
    return (
        `<div class="alert-card alert-card-popular" data-item-id="${item.item_id}">` +
        `<div class="alert-card-stripe"></div>` +
        `<div class="alert-card-body">` +
        `<div class="alert-card-row1"><div class="alert-card-row1-left">` +
        `<span class="alert-card-label alert-label-popular">人気</span>` +
        `<span class="alert-card-pct">${item.vol}件</span>` +
        `</div></div>` +
        `<div class="alert-card-name">${name}</div>` +
        priceHtml +
        `</div></div>`
    );
}

function renderChangeCard(item, isUp) {
    const name       = store.appNameMap.get(item.item_id) || item.item_id;
    const pct        = isUp ? `+${Math.round((item.ratio - 1) * 100)}%` : `-${Math.round((1 - item.ratio) * 100)}%`;
    const baseCls    = item.basePrice >= item.latestPrice ? 'price-hi' : 'price-lo';
    const latestCls  = item.latestPrice >= item.basePrice ? 'price-hi' : 'price-lo';
    const dirClass   = isUp ? 'alert-card-up'  : 'alert-card-down';
    const labelClass = isUp ? 'alert-label-up' : 'alert-label-down';
    const label      = isUp ? '急騰' : '急落';
    const priceHtml  =
        `<span class="alert-price-col">` +
        `<span class="tbp-main ${baseCls}">${formatPrice(item.basePrice)}G</span>` +
        `<span class="alert-price-date">${item.baseDate}</span>` +
        `</span>` +
        `<span class="alert-price-arrow">→</span>` +
        `<span class="alert-price-col">` +
        `<span class="tbp-main ${latestCls}">${formatPrice(item.latestPrice)}G</span>` +
        `<span class="alert-price-date">${item.latestDate}</span>` +
        `</span>`;
    return (
        `<div class="alert-card ${dirClass}" data-item-id="${item.item_id}">` +
        `<div class="alert-card-stripe"></div>` +
        `<div class="alert-card-body">` +
        `<div class="alert-card-row1"><div class="alert-card-row1-left">` +
        `<span class="alert-card-label ${labelClass}">${label}</span>` +
        `<span class="alert-card-pct">${pct}</span>` +
        `</div></div>` +
        `<div class="alert-card-name">${name}</div>` +
        `<div class="alert-card-price">${priceHtml}</div>` +
        `</div></div>`
    );
}


export function renderTop() {
    const section = document.getElementById('top-section');
    if (!section) return;

    const data3 = computeWindow(3 * 86400_000);
    const data7 = computeWindow(7 * 86400_000);

    const newsCards =
        data3.upItems.map(i => renderChangeCard(i, true)).join('') +
        data3.downItems.map(i => renderChangeCard(i, false)).join('');

    const newsSection =
        `<div class="top-section">` +
        `<div class="top-lead">注目</div>` +
        `<div class="alert-group-cards">${newsCards || `<span class="alert-empty">なし</span>`}</div>` +
        `</div>`;

    const volSection = (label, data) =>
        `<div class="top-section">` +
        `<div class="top-lead">${label}</div>` +
        `<div class="alert-group-cards">${data.popular.map(renderPopularCard).join('') || `<span class="alert-empty">データなし</span>`}</div>` +
        `</div>`;

    section.innerHTML =
        `<div id="top-panel">` +
        newsSection +
        volSection('直近3日', data3) +
        volSection('直近1週間', data7) +
        `</div>`;

    section.addEventListener('click', e => {
        const card = e.target.closest('.alert-card[data-item-id]');
        if (card) navigateToItem(card.dataset.itemId);
    });
}
