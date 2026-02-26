import { store } from '../store.js';
import { REFINE_COLS, SERIES_COLORS } from '../constants.js';
import {
    buildBucketStatsBySeries,
    dateRangeMs,
    formatPrice,
    getCellData,
    getMatrixCellClass,
    medianOf,
    minOf,
    toJSTDate,
} from '../utils.js';

const chartUiState = {
    itemId: null,
    granularity: 'raw', // '1d' | 'raw'
};

// detail-matrix 列ページネーション状態
const matrixUiState = {
    windowSize: 14,   // 表示する日付列数: 7 | 14 | 30
    pageStart: null,  // 表示開始インデックス（null = 最新ページに自動セット）
    lastItemId: null, // アイテム切替検出用
};

// 1d: bucketTime（JST-shifted UTC秒）→ UTC midnight Unix秒（= BusinessDay廃止）
// raw: JST-shifted Unix秒をそのまま返す
function toChartTime(sec) {
    if (chartUiState.granularity === '1d') {
        const d = new Date(sec * 1000);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    }
    return sec;
}

function timeKey(t) {
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
        return 0;
    }
    return 0;
}

function mapDataTimes(data) {
    return data.map(p => ({ ...p, time: toChartTime(p.time) }));
}

function formatChartTimeLabel(t) {
    const DOW = ['日', '月', '火', '水', '木', '金', '土'];
    let d = null;
    if (typeof t === 'number') {
        d = new Date(t * 1000);
    } else if (typeof t === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        if (m) d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    }
    if (!d || Number.isNaN(d.getTime())) return '';

    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dow = DOW[d.getUTCDay()];

    if (chartUiState.granularity === '1d') {
        return `${y}/${mo}/${day}(${dow})`;
    }

    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}/${mo}/${day}(${dow}) ${hh}:${mm}`;
}

function ensureChartGranularityControls() {
    const chartContainer = document.getElementById('chart-container');
    if (!chartContainer || !chartContainer.parentNode) return;

    let wrap = document.getElementById('chart-granularity-controls');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'chart-granularity-controls';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '12px';
        wrap.style.margin = '6px 0 8px';
        wrap.style.flexWrap = 'wrap';
        chartContainer.parentNode.insertBefore(wrap, chartContainer);
    }

    const options = [
        { value: '1d', label: '日単位' },
        { value: 'raw', label: '全取引' },
    ];

    wrap.innerHTML = options.map(opt => {
        const checked = chartUiState.granularity === opt.value ? ' checked' : '';
        return `
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;">
                <input type="radio" name="chart-granularity" value="${opt.value}"${checked}>
                <span>${opt.label}</span>
            </label>`;
    }).join('');
}

function buildRawStatsBySeries(records) {
    const JST_OFFSET_SEC = 9 * 3600;
    const out = new Map();

    records.forEach(r => {
        const key = `${r.grade}_${r.refine}`;
        if (!out.has(key)) out.set(key, []);
        const arr = out.get(key);

        let time = Math.floor(r.ts / 1000) + JST_OFFSET_SEC;
        if (arr.length > 0 && time <= arr[arr.length - 1].time) {
            time = arr[arr.length - 1].time + 1;
        }

        arr.push({
            time,
            low: r.price,
            high: r.price,
            q1: r.price,
            q3: r.price,
            median: r.price,
            count: 1,
        });
    });

    return out;
}

function buildStatsByGranularity(records, granularity) {
    if (granularity === '1d') return buildBucketStatsBySeries(records, 24 * 3600);
    return buildRawStatsBySeries(records);
}

function buildRangeBoxCandles(stats, baseColor) {
    const activeData = [];
    const inactiveData = [];
    const medianLine = [];
    let prevMedian = null;

    for (const s of stats) {
        const isUp = prevMedian == null || s.median >= prevMedian;
        const open = isUp ? s.q1 : s.q3;
        const close = isUp ? s.q3 : s.q1;

        activeData.push({
            time: s.time,
            open,
            high: s.high,
            low: s.low,
            close,
            color: isUp ? 'rgba(46, 204, 113, 0.30)' : 'rgba(231, 76, 60, 0.28)',
            borderColor: baseColor,
            wickColor: baseColor,
        });
        inactiveData.push({
            time: s.time,
            open,
            high: s.high,
            low: s.low,
            close,
            color: 'rgba(180, 180, 180, 0.16)',
            borderColor: '#c8c8c8',
            wickColor: '#d0d0d0',
        });
        medianLine.push({ time: s.time, value: s.median });
        prevMedian = s.median;
    }

    return { activeData, inactiveData, hitData: medianLine };
}

function buildRawLineData(stats) {
    const lineData = stats.map(s => ({ time: s.time, value: s.median }));
    return { activeData: lineData, inactiveData: lineData, hitData: lineData };
}

function renderTicker(records) {
    const JST_OFFSET_MS = 9 * 3600000;
    const rc = (type, val, label, isActive) =>
        `<span class="filter-chip ${isActive ? 'active' : 'available'} row-chip" data-filter-type="${type}" data-filter-val="${val}">${label}</span>`;

    document.getElementById('ticker-body').innerHTML = records.map(r => {
        const d = new Date(r.ts + JST_OFFSET_MS);
        const datetime = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        const refineChip = rc('refine', r.refine, `+${r.refine}`, store.tickerFilters.refines.size > 0 && store.tickerFilters.refines.has(r.refine));
        const gradeChip = r.grade === 1 ? rc('grade', '1', '★1', store.tickerFilters.grades.size > 0 && store.tickerFilters.grades.has(1)) : '';
        const enchantChips = [r.card2, r.card3, r.card4].filter(Boolean).map(e =>
            rc('enchant', e, e, store.tickerFilters.enchants.size > 0 && store.tickerFilters.enchants.has(e))).join('');
        const cardChip = r.card1 ? rc('card', r.card1, r.card1, store.tickerFilters.cards.size > 0 && store.tickerFilters.cards.has(r.card1)) : '';
        const priceG = r.price > 0 ? `${(r.price / 1e9).toFixed(2)}G` : '-';
        return `<div class="ticker-row" data-grade="${r.grade}" data-refine="${r.refine}"><span>${datetime}</span><span>${priceG}</span><span>${gradeChip}</span><span>${refineChip}</span><span>${enchantChips}</span><span>${cardChip}</span></div>`;
    }).join('');
}

function applyTickerFilters(records) {
    return records.filter(r => {
        if (store.tickerFilters.grades.size > 0 && !store.tickerFilters.grades.has(r.grade)) return false;
        if (store.tickerFilters.refines.size > 0 && !store.tickerFilters.refines.has(r.refine)) return false;
        if (store.tickerFilters.enchants.size > 0) {
            const re = [r.card2, r.card3, r.card4].filter(Boolean);
            if (![...store.tickerFilters.enchants].every(e => re.includes(e))) return false;
        }
        if (store.tickerFilters.cards.size > 0 && !store.tickerFilters.cards.has(r.card1)) return false;
        return true;
    });
}

function renderTickerFilterUI() {
    const el = document.getElementById('ticker-filter');
    const chips = [];
    const chip = (label, type, val, active) =>
        `<span class="filter-chip${active ? ' active' : ' available'}" data-filter-type="${type}" data-filter-val="${val}">${label}${active ? ' <span class="filter-chip-remove">×</span>' : ''}</span>`;

    if (store.tickerFilters.grades.has(1)) chips.push(chip('★1', 'grade', '1', true));
    store.tickerFilters.refines.forEach(n => chips.push(chip(`+${n}`, 'refine', n, true)));
    store.tickerFilters.enchants.forEach(e => chips.push(chip(e, 'enchant', e, true)));
    store.tickerFilters.cards.forEach(c => chips.push(chip(c, 'card', c, true)));

    el.innerHTML = chips.join('');
}

function refreshTicker() {
    renderTicker(applyTickerFilters(store.currentTickerRecords));
    renderTickerFilterUI();
}

function toggleFilter(type, val) {
    if (type === 'grade') {
        const n = Number(val);
        if (store.tickerFilters.grades.has(n)) store.tickerFilters.grades.delete(n);
        else store.tickerFilters.grades.add(n);
        updateSeriesStyle(store.currentSeriesToKey);
    } else if (type === 'refine') {
        const n = Number(val);
        if (store.tickerFilters.refines.has(n)) store.tickerFilters.refines.delete(n);
        else store.tickerFilters.refines.add(n);
        updateSeriesStyle(store.currentSeriesToKey);
    } else if (type === 'enchant') {
        if (store.tickerFilters.enchants.has(val)) store.tickerFilters.enchants.delete(val);
        else store.tickerFilters.enchants.add(val);
    } else if (type === 'card') {
        if (store.tickerFilters.cards.has(val)) store.tickerFilters.cards.delete(val);
        else store.tickerFilters.cards.add(val);
    }

    refreshTicker();
    updateDetailMatrixHighlight();
}

function updateDetailMatrixHighlight() {
    document.querySelectorAll('#detail-item-matrix tbody tr[data-grade]').forEach(row => {
        const grade = Number(row.dataset.grade);
        const refine = Number(row.dataset.refine);
        const active = store.tickerFilters.grades.size === 1 && store.tickerFilters.grades.has(grade) &&
            store.tickerFilters.refines.size === 1 && store.tickerFilters.refines.has(refine);
        row.classList.toggle('dim-active', active);
    });
}

function renderDetailMatrix(itemId) {
    const container = document.getElementById('detail-matrix');
    const pagerHeadEl = document.getElementById('detail-matrix-head');
    if (!container) return;

    const itemName = store.appNameMap.get(itemId) || itemId;
    const groupEntry = store.appGroupMap.get(itemName);
    if (!groupEntry) {
        container.innerHTML = '';
        if (pagerHeadEl) pagerHeadEl.innerHTML = '';
        return;
    }

    const activeCols = REFINE_COLS.filter(col => groupEntry.cols[`${col.grade}_${col.refine}`]);
    if (activeCols.length === 0) {
        container.innerHTML = '';
        if (pagerHeadEl) pagerHeadEl.innerHTML = '';
        return;
    }

    // アイテム切替時にページをリセット
    if (matrixUiState.lastItemId !== itemId) {
        matrixUiState.pageStart = null;
        matrixUiState.lastItemId = itemId;
    }

    // ページウィンドウ計算
    const allDates = store.appAvailableDates;
    const ws = matrixUiState.windowSize;
    const maxStart = Math.max(0, allDates.length - ws);
    if (matrixUiState.pageStart === null) matrixUiState.pageStart = maxStart;
    const pageStart = Math.max(0, Math.min(matrixUiState.pageStart, maxStart));
    matrixUiState.pageStart = pageStart;
    const dates = allDates.slice(pageStart, pageStart + ws);

    const prevDisabled = pageStart === 0;
    const nextDisabled = pageStart >= maxStart;
    const rangeStr = dates.length > 0
        ? `${dates[0].slice(5).replace('-', '/')} 〜 ${dates[dates.length - 1].slice(5).replace('-', '/')}`
        : '';

    const pagerHtml =
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

    const headerCells = '<th class="dim-sticky">精錬</th>' +
        '<th class="dim-sticky dim-recent">直近</th>' +
        '<th class="dim-sticky dim-prev">前日比</th>' +
        '<th class="dim-sticky dim-low3d">3d安</th>' +
        '<th class="dim-sticky dim-high3d">3d高</th>' +
        '<th class="dim-sticky dim-count">件数</th>' +
        dates.map(d => {
            const [, m, day] = d.split('-');
            return `<th class="matrix-date" data-date="${d}">${Number(m)}/${Number(day)}</th>`;
        }).join('');

    const rows = activeCols.map(col => {
        const key = `${col.grade}_${col.refine}`;
        const recs = groupEntry.cols[key].recs;
        let latestPrice = 0;
        let latestDate = null;
        if (recs.length > 0) {
            const latestTs = Math.max(...recs.map(r => r.ts));
            latestDate = toJSTDate(latestTs);
            const [ls, le] = dateRangeMs(latestDate);
            latestPrice = medianOf(recs.filter(r => r.ts >= ls && r.ts < le).map(r => r.price));
        }

        // 前日比
        let prevPrice = 0;
        if (latestDate) {
            const [currentStart] = dateRangeMs(latestDate);
            const prevRecs = recs.filter(r => r.ts < currentStart);
            if (prevRecs.length > 0) {
                const prevLatestTs = Math.max(...prevRecs.map(r => r.ts));
                const prevDateStr = toJSTDate(prevLatestTs);
                const [ps, pe] = dateRangeMs(prevDateStr);
                prevPrice = medianOf(recs.filter(r => r.ts >= ps && r.ts < pe).map(r => r.price));
            }
        }
        const dayDiff = latestPrice > 0 && prevPrice > 0 ? latestPrice - prevPrice : null;
        const diffStr = dayDiff === null ? '-' : (dayDiff >= 0 ? `+${(dayDiff / 1e9).toFixed(2)}` : `${(dayDiff / 1e9).toFixed(2)}`);
        const diffCls = dayDiff === null ? '' : (dayDiff > 0 ? ' dim-up' : dayDiff < 0 ? ' dim-down' : '');

        // 3d安 / 3d高（全期間末尾3日が対象）
        const last3Dates = allDates.slice(-3);
        const last3Prices = last3Dates.map(d => {
            const [s, e] = dateRangeMs(d);
            const dp = recs.filter(r => r.ts >= s && r.ts < e).map(r => r.price);
            return dp.length > 0 ? medianOf(dp) : 0;
        }).filter(p => p > 0);
        const low3d = last3Prices.length > 0 ? Math.min(...last3Prices) : 0;
        const high3d = last3Prices.length > 0 ? Math.max(...last3Prices) : 0;

        const rowPrices = dates.map(d => getCellData(recs, d, 0, minOf).price);
        const cells = dates.map((d, i) => {
            const price = rowPrices[i];
            if (!price || price <= 0) return '<td class="matrix-cell empty"></td>';
            const cls = getMatrixCellClass(price, rowPrices);
            return `<td class="matrix-cell${cls ? ' ' + cls : ''}">${formatPrice(price)}</td>`;
        }).join('');

        return `<tr data-grade="${col.grade}" data-refine="${col.refine}">` +
            `<td class="dim-sticky">${col.label}</td>` +
            `<td class="dim-sticky dim-recent">${formatPrice(latestPrice)}</td>` +
            `<td class="dim-sticky dim-prev${diffCls}">${diffStr}</td>` +
            `<td class="dim-sticky dim-low3d">${formatPrice(low3d)}</td>` +
            `<td class="dim-sticky dim-high3d">${formatPrice(high3d)}</td>` +
            `<td class="dim-sticky dim-count">${recs.length}</td>` +
            cells + '</tr>';
    }).join('');

    if (pagerHeadEl) pagerHeadEl.innerHTML = pagerHtml;
    container.innerHTML =
        `<table id="detail-item-matrix"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;

    requestAnimationFrame(() => {
        const table = container.querySelector('#detail-item-matrix');
        if (!table) return;
        const headerThs = [...table.querySelectorAll('thead tr th')];
        let offset = 0;
        const offsets = [];
        for (let i = 0; i < 6 && i < headerThs.length; i++) {
            offsets.push(offset);
            offset += headerThs[i].offsetWidth;
        }
        table.querySelectorAll('tr').forEach(row => {
            [...row.querySelectorAll('th, td')].slice(0, 6).forEach((cell, i) => { cell.style.left = `${offsets[i]}px`; });
        });
        container.style.setProperty('--name-col-w', `${offset}px`);
        // ページングで最新日を表示するため、横スクロール自動移動は不要
    });
}

function isSeriesKeyActive(key) {
    const [grade, refine] = key.split('_').map(Number);
    const gradeOk = store.tickerFilters.grades.size === 0 || store.tickerFilters.grades.has(grade);
    const refineOk = store.tickerFilters.refines.size === 0 || store.tickerFilters.refines.has(refine);
    return gradeOk && refineOk;
}

function getActiveSeriesKeysForChart() {
    return [...store.currentSeriesVariants.keys()].filter(key => {
        const [grade, refine] = key.split('_').map(Number);
        const gradeOk = store.tickerFilters.grades.size === 0 || store.tickerFilters.grades.has(grade);
        const refineOk = store.tickerFilters.refines.size === 0 || store.tickerFilters.refines.has(refine);
        return gradeOk && refineOk;
    });
}

function refreshVolumeSeries() {
    if (!store.currentVolumeSeries) return;
    const activeKeys = getActiveSeriesKeysForChart();
    if (activeKeys.length === 0) {
        store.currentVolumeSeries.setData([]);
        return;
    }

    const countByTime = new Map();
    const medianAccByTime = new Map();
    activeKeys.forEach(key => {
        const entry = store.currentSeriesVariants.get(key);
        if (!entry) return;
        entry.stats.forEach(s => {
            countByTime.set(s.time, (countByTime.get(s.time) || 0) + s.count);
            if (!medianAccByTime.has(s.time)) medianAccByTime.set(s.time, { sum: 0, n: 0 });
            const acc = medianAccByTime.get(s.time);
            acc.sum += s.median;
            acc.n += 1;
        });
    });

    let prevAggMedian = null;
    const data = [...countByTime.keys()].sort((a, b) => a - b).map(time => {
        const cnt = countByTime.get(time);
        const acc = medianAccByTime.get(time);
        const aggMedian = acc && acc.n > 0 ? acc.sum / acc.n : 0;
        const isUp = prevAggMedian == null || aggMedian >= prevAggMedian;
        prevAggMedian = aggMedian;
        return {
            time: toChartTime(time),
            value: cnt,
            color: isUp ? 'rgba(46, 204, 113, 0.45)' : 'rgba(231, 76, 60, 0.45)',
        };
    });

    store.currentVolumeSeries.setData(data);
}

function updateSeriesStyle(seriesToKey, options = {}) {
    const preserveTimeRange = options.preserveTimeRange !== false;

    const ts = store.currentChart ? store.currentChart.timeScale() : null;
    const prevRange = (preserveTimeRange && ts) ? ts.getVisibleLogicalRange() : null;

    seriesToKey.forEach((key, series) => {
        const active = isSeriesKeyActive(key);
        const variants = store.currentSeriesVariants.get(key);
        if (!variants) return;

        if (!active) {
            const hiddenData = (variants.hitData || []).map(p => ({ time: p.time }));
            series.setData(hiddenData);
            series.applyOptions({
                lastValueVisible: false,
                priceLineVisible: false,
            });
            return;
        }

        if (variants.seriesType === 'line') {
            series.setData(variants.activeData);
            series.applyOptions({
                color: variants.baseColor,
                lineWidth: 2,
                lastValueVisible: true,
                priceLineVisible: false,
                crosshairMarkerVisible: true,
            });
        } else {
            series.setData(variants.activeData);
            series.applyOptions({
                lastValueVisible: true,
                priceLineVisible: false,
                borderVisible: true,
                wickVisible: true,
            });
        }
    });

    if (store.currentChart) {
        store.currentChart.priceScale('right').applyOptions({ autoScale: true });
    }

    if (ts && prevRange) {
        ts.setVisibleLogicalRange(prevRange);
    }

    refreshVolumeSeries();
}

export function destroyChart() {
    if (store.currentChartResizeObserver) {
        store.currentChartResizeObserver.disconnect();
        store.currentChartResizeObserver = null;
    }
    if (store.currentChart) {
        store.currentChart.remove();
        store.currentChart = null;
    }
    store.currentVolumeSeries = null;
    store.currentSeriesVariants = new Map();
    store.currentSeriesToKey = new Map();
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) chartContainer.innerHTML = '';
    if (typeof selectedKey !== 'undefined') selectedKey = null;
}

export function renderItem(itemId, options = {}) {
    chartUiState.itemId = itemId;
    ensureChartGranularityControls();
    renderDetailMatrix(itemId);

    const itemName = store.appNameMap.get(itemId) || itemId;
    document.getElementById('detail-rotool-link').href = `https://rotool.gungho.jp/item/${itemId}/0/`;
    document.getElementById('detail-item-name').textContent = itemName;

    const itemRecords = store.appAllRecords
        .filter(r => r.item_id === itemId)
        .sort((a, b) => a.ts - b.ts);

    store.currentTickerRecords = store.appAllRecords
        .filter(r => r.item_id === itemId)
        .sort((a, b) => b.ts - a.ts);

    if (!options.preserveFilters) {
        store.tickerFilters = { grades: new Set(), refines: new Set(), enchants: new Set(), cards: new Set() };
    }

    destroyChart();
    ensureChartGranularityControls();

    if (itemRecords.length === 0) {
        refreshTicker();
        return;
    }

    const container = document.getElementById('chart-container');
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 420,
        layout: { background: { color: '#ffffff' }, textColor: '#333', attributionLogo: false },
        grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
        rightPriceScale: { borderColor: '#ddd', scaleMargins: { top: 0.03, bottom: 0.28 } },
        // 1d: 日付のみ表示のため timeVisible: false、raw: 時刻も表示
        timeScale: {
            borderColor: '#ddd',
            timeVisible: chartUiState.granularity === 'raw',
            secondsVisible: false,
        },
        localization: {
            priceFormatter: v => `${(v / 1e9).toFixed(2)}G`,
            timeFormatter: t => formatChartTimeLabel(t),
        },
    });

    const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceScaleId: 'vol',
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
        lastValueVisible: false,
        priceLineVisible: false,
        base: 0,
    });
    chart.priceScale('vol').applyOptions({ borderVisible: false, scaleMargins: { top: 0.78, bottom: 0.02 } });

    store.currentChart = chart;
    store.currentVolumeSeries = volumeSeries;
    store.currentSeriesVariants = new Map();

    const statsByKey = buildStatsByGranularity(itemRecords, chartUiState.granularity);
    const seriesToKey = new Map();
    const seriesToData = new Map();
    const isRaw = chartUiState.granularity === 'raw';

    REFINE_COLS.forEach(col => {
        const key = `${col.grade}_${col.refine}`;
        const stats = statsByKey.get(key);
        if (!stats || stats.length === 0) return;

        const baseColor = SERIES_COLORS[key] || '#999';

        if (isRaw) {
            const rawBuilt = buildRawLineData(stats);
            const activeData = mapDataTimes(rawBuilt.activeData);
            const inactiveData = mapDataTimes(rawBuilt.inactiveData);
            const hitData = mapDataTimes(rawBuilt.hitData);

            const series = chart.addSeries(LightweightCharts.LineSeries, {
                title: col.label,
                color: baseColor,
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: true,
            });
            series.setData(activeData);

            store.currentSeriesVariants.set(key, {
                seriesType: 'line',
                stats,
                baseColor,
                activeData,
                inactiveData,
                hitData,
            });
            seriesToKey.set(series, key);
            seriesToData.set(series, hitData);
            return;
        }

        const candleBuilt = buildRangeBoxCandles(stats, baseColor);
        const activeData = mapDataTimes(candleBuilt.activeData);
        const inactiveData = mapDataTimes(candleBuilt.inactiveData);
        const hitData = mapDataTimes(candleBuilt.hitData);

        const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
            title: col.label,
            upColor: 'rgba(0,0,0,0)',
            downColor: 'rgba(0,0,0,0)',
            borderVisible: true,
            wickVisible: true,
            borderUpColor: baseColor,
            borderDownColor: baseColor,
            wickUpColor: baseColor,
            wickDownColor: baseColor,
            priceLineVisible: false,
            lastValueVisible: true,
        });
        series.setData(activeData);

        store.currentSeriesVariants.set(key, {
            seriesType: 'candlestick',
            stats,
            baseColor,
            activeData,
            inactiveData,
            hitData,
        });
        seriesToKey.set(series, key);
        seriesToData.set(series, hitData);
    });

    store.currentChartResizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    store.currentChartResizeObserver.observe(container);

    let lastHoveredSeries = null;
    chart.subscribeCrosshairMove(param => {
        lastHoveredSeries = null;
        const cv = container.querySelector('canvas');
        if (!param.point || param.time == null) {
            if (cv) cv.style.cursor = '';
            return;
        }

        const y = param.point.y;
        const target = timeKey(param.time);
        let closestSeries = null;
        let closestDist = Infinity;

        seriesToData.forEach((data, series) => {
            const key = seriesToKey.get(series);
            if (!key || !isSeriesKeyActive(key)) return;

            let lo = 0;
            let hi = data.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (timeKey(data[mid].time) < target) lo = mid + 1;
                else hi = mid;
            }

            const a = lo > 0 ? data[lo - 1] : null;
            const b = lo < data.length ? data[lo] : null;
            const nearest = (!a || (b && Math.abs(timeKey(b.time) - target) <= Math.abs(timeKey(a.time) - target))) ? b : a;
            if (!nearest) return;

            const coord = series.priceToCoordinate(nearest.value);
            if (coord == null) return;

            const dist = Math.abs(coord - y);
            if (dist < closestDist) {
                closestDist = dist;
                closestSeries = series;
            }
        });

        if (closestSeries && closestDist < 20) {
            lastHoveredSeries = closestSeries;
            if (cv) cv.style.cursor = 'pointer';
        } else if (cv) {
            cv.style.cursor = '';
        }
    });

    store.currentSeriesToKey = seriesToKey;

    chart.subscribeClick(param => {
        let clickedKey = null;

        if (param.hoveredSeries && seriesToKey.has(param.hoveredSeries)) {
            clickedKey = seriesToKey.get(param.hoveredSeries);
        } else if (!param.hoveredSeries && lastHoveredSeries && seriesToKey.has(lastHoveredSeries)) {
            clickedKey = seriesToKey.get(lastHoveredSeries);
        }

        if (clickedKey) {
            const [grade, refine] = clickedKey.split('_').map(Number);
            store.tickerFilters.grades.clear();
            store.tickerFilters.grades.add(grade);
            store.tickerFilters.refines.clear();
            store.tickerFilters.refines.add(refine);

            updateSeriesStyle(store.currentSeriesToKey);
            refreshTicker();
            updateDetailMatrixHighlight();
            return;
        }

        store.tickerFilters.grades.clear();
        store.tickerFilters.refines.clear();

        if (chartUiState.itemId) {
            renderItem(chartUiState.itemId, { preserveFilters: true });
            return;
        }

        updateSeriesStyle(store.currentSeriesToKey);
        refreshTicker();
        updateDetailMatrixHighlight();
    });

    updateSeriesStyle(store.currentSeriesToKey, { preserveTimeRange: false });
    refreshTicker();

    // fitContent() を同期的に呼び出し（内部状態を即時確定させる）
    // setVisibleLogicalRange は setTimeout で分離し、fitContent の効果が
    // getVisibleLogicalRange() に反映されてから実行する
    chart.timeScale().fitContent();
    setTimeout(() => {
        if (store.currentChart !== chart) return;
        const ts = chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        if (range) ts.setVisibleLogicalRange({ from: range.from - 1.5, to: range.to });
    }, 0);
}

export function bindChartFeatureEvents() {
    ['ticker-filter', 'ticker-body'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', e => {
            const chip = e.target.closest('.filter-chip[data-filter-type]');
            if (!chip) return;
            e.stopPropagation();
            toggleFilter(chip.dataset.filterType, chip.dataset.filterVal);
        });
    });

    document.addEventListener('change', e => {
        const radio = e.target.closest('#chart-granularity-controls input[name="chart-granularity"]');
        if (!radio) return;
        const next = radio.value;
        if (!['1d', 'raw'].includes(next)) return;
        if (chartUiState.granularity === next) return;
        chartUiState.granularity = next;
        if (!chartUiState.itemId) return;
        renderItem(chartUiState.itemId, { preserveFilters: true });
    });

    function handleDetailMatrixPagerClick(e) {
        const winBtn = e.target.closest('.matrix-win-btn[data-win]');
        if (winBtn) {
            matrixUiState.windowSize = Number(winBtn.dataset.win);
            matrixUiState.pageStart = null;
            if (chartUiState.itemId) renderDetailMatrix(chartUiState.itemId);
            return true;
        }
        if (e.target.closest('.matrix-prev-btn')) {
            matrixUiState.pageStart = Math.max(0, matrixUiState.pageStart - matrixUiState.windowSize);
            if (chartUiState.itemId) renderDetailMatrix(chartUiState.itemId);
            return true;
        }
        if (e.target.closest('.matrix-next-btn')) {
            const max = Math.max(0, store.appAvailableDates.length - matrixUiState.windowSize);
            matrixUiState.pageStart = Math.min(max, matrixUiState.pageStart + matrixUiState.windowSize);
            if (chartUiState.itemId) renderDetailMatrix(chartUiState.itemId);
            return true;
        }
        return false;
    }

    const detailMatrixHeadEl = document.getElementById('detail-matrix-head');
    if (detailMatrixHeadEl) {
        detailMatrixHeadEl.addEventListener('click', e => { handleDetailMatrixPagerClick(e); });
    }

    const detailMatrixEl = document.getElementById('detail-matrix');
    if (!detailMatrixEl) return;
    detailMatrixEl.addEventListener('click', e => {
        // ページャーボタン（pagerHead経由でも念のため処理）
        if (handleDetailMatrixPagerClick(e)) return;

        // 系列フィルタ（行クリック）
        const row = e.target.closest('#detail-item-matrix tbody tr[data-grade]');
        if (!row) return;

        const grade = Number(row.dataset.grade);
        const refine = Number(row.dataset.refine);
        const exactMatch = store.tickerFilters.grades.size === 1 && store.tickerFilters.grades.has(grade) &&
            store.tickerFilters.refines.size === 1 && store.tickerFilters.refines.has(refine);

        if (exactMatch) {
            store.tickerFilters.grades.clear();
            store.tickerFilters.refines.clear();

            if (chartUiState.itemId) {
                renderItem(chartUiState.itemId, { preserveFilters: true });
                return;
            }
        } else {
            store.tickerFilters.grades.clear();
            store.tickerFilters.grades.add(grade);
            store.tickerFilters.refines.clear();
            store.tickerFilters.refines.add(refine);
        }

        updateSeriesStyle(store.currentSeriesToKey);
        refreshTicker();
        updateDetailMatrixHighlight();
    });
}
