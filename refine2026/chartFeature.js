import { store } from './store.js';
import { REFINE_COLS, SERIES_COLORS } from './constants.js';
import {
    buildBucketStatsBySeries,
    formatPrice,
    getMatrixCellClass,
    toJSTDate,
} from './utils.js';

const AGG_GRANULARITIES = ['3h', '6h', '1d'];
const DETAIL_MATRIX_DAYS = 7;

const chartUiState = {
    itemId: null,
    selectedSeriesKey: null,
    aggGranularity: '3h',
};

const matrixUiState = {
    pageStart: null,
    lastItemId: null,
};

const chartViewState = {
    raw: { chart: null, resizeObserver: null },
    agg: { chart: null, resizeObserver: null },
};

let chartUrlEventsBound = false;

function toChartTime(sec, granularity) {
    if (granularity === '1d') {
        const d = new Date(sec * 1000);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    }
    return sec;
}

function mapDataTimes(data, granularity) {
    return data.map(p => ({ ...p, time: toChartTime(p.time, granularity) }));
}

function formatChartTimeLabel(t, granularity) {
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

    if (granularity === '1d') {
        return `${y}/${mo}/${day}(${dow})`;
    }

    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}/${mo}/${day}(${dow}) ${hh}:${mm}`;
}

function getDefaultAggGranularity() {
    return '1d';
}

function normalizeAggGranularity(v) {
    return AGG_GRANULARITIES.includes(v) ? v : getDefaultAggGranularity();
}

function formatAggGranularityLabel(v) {
    if (v === '1d') return '日足';
    return `${v}足`;
}

function findTickerSection(rawChartContainer) {
    const tickerBody = document.getElementById('ticker-body');
    const tickerFilter = document.getElementById('ticker-filter');
    if (!tickerBody || !tickerFilter) return null;

    let node = tickerBody;
    while (node && node !== document.body) {
        if (
            node instanceof HTMLElement &&
            node.contains(tickerFilter) &&
            (!rawChartContainer || !node.contains(rawChartContainer))
        ) {
            return node;
        }
        node = node.parentElement;
    }

    return tickerBody.parentElement;
}

function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatBoardPriceG(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return '-';
    return `${(v / 1e9).toFixed(2)}G`;
}

function formatBoardSignedPriceG(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
    const sign = v > 0 ? '+' : '';
    return `${sign}${(v / 1e9).toFixed(2)}G`;
}

function formatBoardPercent(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
}

function formatBoardCount(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
    return `${v.toLocaleString('ja-JP')}件`;
}

function formatBoardDateTime(ts) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return '-';
    const JST_OFFSET_MS = 9 * 3600000;
    const d = new Date(ts + JST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

function formatBoardDate(d) {
    if (!d) return '-';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    if (!m) return escapeHtml(String(d));
    return `${m[1]}/${m[2]}/${m[3]}`;
}

function getSeriesLabelByKey(seriesKey) {
    if (!seriesKey) return '-';
    const [grade, refine] = String(seriesKey).split('_').map(Number);
    const col = REFINE_COLS.find(c => c.grade === grade && c.refine === refine);
    if (col && col.label) return col.label;

    const parts = [];
    if (Number.isInteger(refine)) parts.push(`+${refine}`);
    if (Number.isInteger(grade) && grade > 0) parts.push(`★${grade}`);
    return parts.join(' ') || String(seriesKey);
}

function ensureDetailHeaderTickerInfo() {
    const header = document.querySelector('#detail-view .detail-header');
    const itemNameEl = document.getElementById('detail-item-name');
    const rotoolLink = document.getElementById('detail-rotool-link');
    if (!header || !itemNameEl || !rotoolLink) return null;

    if (!document.getElementById('detail-header-ticker-style')) {
        const style = document.createElement('style');
        style.id = 'detail-header-ticker-style';
        style.textContent = `
            #detail-view .detail-header {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            #detail-item-name {
                margin-right: 4px;
            }
            #detail-header-ticker-inline {
                display: flex;
                align-items: baseline;
                gap: 10px;
                min-width: 0;
                flex-wrap: wrap;
                color: #666;
            }
            #detail-header-ticker-price {
                display: inline-flex;
                align-items: baseline;
                gap: 6px;
                white-space: nowrap;
            }
            #detail-header-ticker-price .tbp-main {
                font-size: 1.9em;
                font-weight: 700;
                line-height: 1;
                color: #333;
            }
            #detail-header-ticker-price .tbp-main.positive {
                color: #2e7d32;
            }
            #detail-header-ticker-price .tbp-main.negative {
                color: #d32f2f;
            }
            #detail-header-ticker-price .tbp-change {
                font-weight: 700;
                line-height: 1.1;
                color: #666;
            }
            #detail-header-ticker-price .tbp-change.positive {
                color: #2e7d32;
            }
            #detail-header-ticker-price .tbp-change.negative {
                color: #d32f2f;
            }
            #detail-header-ticker-sub {
                color: #666;
                white-space: nowrap;
            }
            #detail-header-ticker-time {
                color: #666;
                white-space: nowrap;
            }
            #detail-rotool-link {
                margin-left: auto;
            }
            @media (max-width: 1200px) {
                #detail-header-ticker-inline {
                    gap: 8px;
                }
                #detail-header-ticker-price .tbp-main {
                    font-size: 1.5em;
                }
            }
        `;
        document.head.appendChild(style);
    }

    let inline = document.getElementById('detail-header-ticker-inline');
    let priceEl = document.getElementById('detail-header-ticker-price');
    let subEl = document.getElementById('detail-header-ticker-sub');
    let timeEl = document.getElementById('detail-header-ticker-time');

    if (!inline) {
        inline = document.createElement('div');
        inline.id = 'detail-header-ticker-inline';

        priceEl = document.createElement('span');
        priceEl.id = 'detail-header-ticker-price';

        subEl = document.createElement('span');
        subEl.id = 'detail-header-ticker-sub';

        timeEl = document.createElement('span');
        timeEl.id = 'detail-header-ticker-time';

        inline.appendChild(priceEl);
        inline.appendChild(subEl);
        inline.appendChild(timeEl);
    }

    if (inline.parentNode !== header || inline.nextElementSibling !== rotoolLink) {
        header.insertBefore(inline, rotoolLink);
    }

    return { inline, priceEl, subEl, timeEl };
}

function ensureDetailTopRowLayout() {
    const detailView = document.getElementById('detail-view');
    if (!detailView) return null;

    const header = detailView.querySelector('.detail-header');
    const matrixContainer = document.getElementById('detail-matrix-container');
    if (!header || !matrixContainer) return null;

    if (!document.getElementById('detail-top-row-style')) {
        const style = document.createElement('style');
        style.id = 'detail-top-row-style';
        style.textContent = `
            #detail-top-row {
                display: grid;
                grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
                gap: 12px;
                align-items: stretch;
                margin: 0 0 12px;
                width: 100%;
            }
            #detail-top-row-left,
            #detail-top-row-right {
                min-width: 0;
                display: flex;
                flex-direction: column;
            }
            #detail-top-row-right {
                align-items: flex-start;
            }
            #detail-top-row #ticker-board-wrap {
                margin: 0;
                width: 100%;
                height: 100%;
            }
            #detail-top-row #detail-matrix-container {
                width: max-content;
                max-width: 100%;
                margin: 0;
            }
            #detail-top-row #detail-matrix {
                max-width: 100%;
                overflow: auto;
            }
            @media (max-width: 1100px) {
                #detail-top-row {
                    grid-template-columns: minmax(0, 1fr);
                }
            }
        `;
        document.head.appendChild(style);
    }

    let topRow = document.getElementById('detail-top-row');
    let left = document.getElementById('detail-top-row-left');
    let right = document.getElementById('detail-top-row-right');

    if (!topRow) {
        topRow = document.createElement('div');
        topRow.id = 'detail-top-row';

        left = document.createElement('div');
        left.id = 'detail-top-row-left';

        right = document.createElement('div');
        right.id = 'detail-top-row-right';

        topRow.appendChild(left);
        topRow.appendChild(right);

        if (header.nextSibling) {
            detailView.insertBefore(topRow, header.nextSibling);
        } else {
            detailView.appendChild(topRow);
        }
    }

    if (topRow.parentNode !== detailView || topRow.previousElementSibling !== header) {
        detailView.insertBefore(topRow, header.nextSibling);
    }

    if (matrixContainer.parentNode !== right) {
        right.appendChild(matrixContainer);
    }

    return { topRow, left, right };
}

function ensureTickerBoardLayout() {
    const topLayout = ensureDetailTopRowLayout();
    if (!topLayout) return null;

    if (!document.getElementById('ticker-board-style')) {
        const style = document.createElement('style');
        style.id = 'ticker-board-style';
        style.textContent = `
            #ticker-board-wrap {
                width: 100%;
                margin: 0 0 12px;
                height: 100%;
            }
            #ticker-board {
                border: 1px solid #ddd;
                background: #fff;
                border-radius: 6px;
                box-sizing: border-box;
                height: 100%;
                display: grid;
                grid-template-rows: auto 1fr;
                overflow: hidden;
            }
            #ticker-board .tb-meta {
                color: #777;
                line-height: 1.3;
                padding: 6px 8px;
                border-bottom: 1px solid #eee;
                background: #fafafa;
                word-break: break-word;
            }
            #ticker-board .tb-grid {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                align-content: start;
                border-left: 1px solid #eee;
                border-top: 1px solid #eee;
            }
            #ticker-board .tb-grid .info-cell {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                border-right: 1px solid #eee;
                border-bottom: 1px solid #eee;
                min-height: 27px;
                box-sizing: border-box;
                padding: 2px 8px;
            }
            #ticker-board .tb-grid .info-label {
                color: #666;
                white-space: nowrap;
            }
            #ticker-board .tb-grid .info-value {
                font-weight: 700;
                color: #1f3b5b;
                text-align: right;
                white-space: nowrap;
            }
            #ticker-board .tb-grid .info-value.positive {
                color: #2e7d32;
            }
            #ticker-board .tb-grid .info-value.negative {
                color: #d32f2f;
            }
            #ticker-board .tb-empty {
                color: #888;
                padding: 8px;
            }
        `;
        document.head.appendChild(style);
    }

    let wrap = document.getElementById('ticker-board-wrap');
    let board = document.getElementById('ticker-board');

    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'ticker-board-wrap';
        board = document.createElement('div');
        board.id = 'ticker-board';
        wrap.appendChild(board);
    }

    if (wrap.parentNode !== topLayout.left) {
        topLayout.left.appendChild(wrap);
    }

    return board;
}

function computeTickerBoardSummary(records) {
    if (!records || records.length === 0) return null;

    const sortedAsc = [...records].sort((a, b) => a.ts - b.ts);
    const sortedDesc = [...sortedAsc].slice().reverse();

    const latest = sortedDesc[0];
    const prev = sortedDesc[1] || null;

    const latestDay = latest ? toJSTDate(latest.ts) : null;
    const dayRecs = latestDay ? sortedAsc.filter(r => toJSTDate(r.ts) === latestDay) : [];

    const open = dayRecs.length > 0 ? dayRecs[0].price : null;
    const close = dayRecs.length > 0 ? dayRecs[dayRecs.length - 1].price : null;
    const high = dayRecs.length > 0 ? Math.max(...dayRecs.map(r => r.price)) : null;
    const low = dayRecs.length > 0 ? Math.min(...dayRecs.map(r => r.price)) : null;
    const turnover = dayRecs.reduce((sum, r) => sum + (r.price || 0), 0);
    const volume = dayRecs.length;
    const vwap = volume > 0 ? (turnover / volume) : null;

    const change = prev ? latest.price - prev.price : null;
    const changePct = prev && prev.price > 0 ? ((latest.price - prev.price) / prev.price) * 100 : null;

    return {
        latestPrice: latest.price,
        latestTs: latest.ts,
        prevPrice: prev ? prev.price : null,
        change,
        changePct,
        latestDay,
        open,
        high,
        low,
        close,
        vwap,
        turnover,
        volume,
        totalTrades: sortedAsc.length,
        firstTs: sortedAsc[0]?.ts ?? null,
        lastTs: sortedAsc[sortedAsc.length - 1]?.ts ?? null,
    };
}

function renderTickerBoard(records) {
    const boardEl = ensureTickerBoardLayout();
    const headerInfo = ensureDetailHeaderTickerInfo();
    if (!boardEl) return;

    const itemId = chartUiState.itemId;
    const itemName = itemId != null ? (store.appNameMap.get(itemId) || itemId) : '-';
    const seriesLabel = getSeriesLabelByKey(chartUiState.selectedSeriesKey);
    const summary = computeTickerBoardSummary(records);

    const itemNameEl = document.getElementById('detail-item-name');
    if (itemNameEl) itemNameEl.textContent = itemName;

    if (headerInfo) {
        headerInfo.subEl.textContent = `取引基本情報 / ${seriesLabel}`;
    }

    if (!summary) {
        if (headerInfo) {
            headerInfo.priceEl.innerHTML = `<span class="tbp-main">-</span><span class="tbp-change">前回比 -</span>`;
            headerInfo.subEl.textContent = `取引基本情報 / ${seriesLabel}`;
            headerInfo.timeEl.textContent = 'データなし';
        }

        boardEl.innerHTML = `
            <div class="tb-meta">フィルタ条件に一致する取引がありません。</div>
            <div class="tb-empty">取引情報を表示できません。</div>
        `;
        return;
    }

    const isUp = typeof summary.change === 'number' && summary.change > 0;
    const isDown = typeof summary.change === 'number' && summary.change < 0;
    const changeClass = isUp ? 'positive' : isDown ? 'negative' : '';
    const changeMark = isUp ? '▲' : isDown ? '▼' : '';
    const priceClass = changeClass;

    const changeText = summary.change == null
        ? '前回比 -'
        : `${formatBoardSignedPriceG(summary.change)} (${formatBoardPercent(summary.changePct)})`;

    if (headerInfo) {
        headerInfo.priceEl.innerHTML = `<span class="tbp-main ${priceClass}">${escapeHtml(formatBoardPriceG(summary.latestPrice))}</span><span class="tbp-change ${changeClass}">${changeMark}${escapeHtml(changeText)}</span>`;
        headerInfo.timeEl.textContent = `${formatBoardDateTime(summary.latestTs)} 現在`;
    }

    const metaText = `${formatBoardCount(summary.totalTrades)} / ${formatBoardDateTime(summary.firstTs)} → ${formatBoardDateTime(summary.lastTs)}`;

    const infoCell = (label, value, cls = '') => {
        const valueClass = cls ? `info-value ${cls}` : 'info-value';
        return `
            <div class="info-cell">
                <span class="info-label">${escapeHtml(label)}</span>
                <span class="${valueClass}">${escapeHtml(value)}</span>
            </div>
        `;
    };

    boardEl.innerHTML = `
        <div class="tb-meta">${escapeHtml(metaText)}</div>
        <div class="tb-grid">
            ${infoCell('対象日', formatBoardDate(summary.latestDay))}
            ${infoCell('出来高', formatBoardCount(summary.volume))}
            ${infoCell('始値', formatBoardPriceG(summary.open))}
            ${infoCell('終値', formatBoardPriceG(summary.close))}
            ${infoCell('高値', formatBoardPriceG(summary.high))}
            ${infoCell('安値', formatBoardPriceG(summary.low))}
            ${infoCell('VWAP', formatBoardPriceG(summary.vwap))}
            ${infoCell('売買代金', formatBoardPriceG(summary.turnover))}
        </div>
    `;
}

function renderAggGranularityControls() {
    const wrap = document.getElementById('chart-agg-controls');
    if (!wrap) return;

    const current = normalizeAggGranularity(chartUiState.aggGranularity);
    wrap.innerHTML = AGG_GRANULARITIES.map(v => {
        const active = v === current;
        return `<button type="button" class="chart-agg-btn${active ? ' active' : ''}" data-agg="${v}">${formatAggGranularityLabel(v)}</button>`;
    }).join('');
}


function ensureDualChartLayout() {
    const rawContainer = document.getElementById('chart-container');
    if (!rawContainer || !rawContainer.parentNode) return { rawContainer: null, aggContainer: null };

    let layoutRoot = document.getElementById('chart-dual-layout');
    let row = document.getElementById('chart-dual-row');
    let leftPanel = document.getElementById('chart-panel-raw');
    let rightPanel = document.getElementById('chart-panel-agg');
    let aggContainer = document.getElementById('chart-container-agg');
    let aggControls = document.getElementById('chart-agg-controls');

    if (!layoutRoot) {
        layoutRoot = document.createElement('div');
        layoutRoot.id = 'chart-dual-layout';

        row = document.createElement('div');
        row.id = 'chart-dual-row';

        leftPanel = document.createElement('div');
        leftPanel.id = 'chart-panel-raw';

        rightPanel = document.createElement('div');
        rightPanel.id = 'chart-panel-agg';

        const leftTitle = document.createElement('div');
        leftTitle.textContent = '全件';
        leftTitle.style.fontWeight = '600';
        leftTitle.style.margin = '0 0 6px';

        const rightHead = document.createElement('div');
        rightHead.id = 'chart-agg-head';

        const rightTitle = document.createElement('div');
        rightTitle.textContent = 'ローソク';
        rightTitle.style.fontWeight = '600';
        rightTitle.style.whiteSpace = 'nowrap';

        aggControls = document.createElement('div');
        aggControls.id = 'chart-agg-controls';

        const style = document.createElement('style');
        style.id = 'chart-agg-controls-style';
        style.textContent = `
            #chart-agg-controls .chart-agg-btn {
                padding: 2px 10px;
                border: 1px solid #ccc;
                border-radius: 4px;
                background: #f8f9fa;
                color: #555;
                cursor: pointer;
            }
            #chart-agg-controls .chart-agg-btn:hover {
                background: #e9ecef;
                border-color: #aaa;
                color: #333;
            }
            #chart-agg-controls .chart-agg-btn.active {
                background: #1976d2;
                color: #fff;
                border-color: #1976d2;
            }
        `;
        if (!document.getElementById('chart-agg-controls-style')) {
            document.head.appendChild(style);
        }

        aggContainer = document.createElement('div');
        aggContainer.id = 'chart-container-agg';

        rawContainer.parentNode.insertBefore(layoutRoot, rawContainer);
        layoutRoot.appendChild(row);

        leftPanel.appendChild(leftTitle);
        leftPanel.appendChild(rawContainer);

        rightHead.appendChild(rightTitle);
        rightHead.appendChild(aggControls);
        rightPanel.appendChild(rightHead);
        rightPanel.appendChild(aggContainer);

        row.appendChild(leftPanel);
        row.appendChild(rightPanel);
    }

    layoutRoot.style.display = 'block';
    layoutRoot.style.width = '100%';
    layoutRoot.style.marginBottom = '12px';

    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '12px';
    row.style.alignItems = 'flex-start';
    row.style.justifyContent = 'flex-start';
    row.style.width = 'fit-content';
    row.style.maxWidth = '100%';

    leftPanel.style.minWidth = '0';
    leftPanel.style.flex = '0 1 560px';
    leftPanel.style.maxWidth = '560px';
    leftPanel.style.width = '100%';
    leftPanel.style.overflow = 'hidden';
    leftPanel.style.display = 'flex';
    leftPanel.style.flexDirection = 'column';
    leftPanel.style.alignItems = 'stretch';

    rightPanel.style.minWidth = '0';
    rightPanel.style.flex = '0 1 560px';
    rightPanel.style.maxWidth = '560px';
    rightPanel.style.width = '100%';
    rightPanel.style.overflow = 'hidden';
    rightPanel.style.display = 'flex';
    rightPanel.style.flexDirection = 'column';
    rightPanel.style.alignItems = 'stretch';

    const rightHead = document.getElementById('chart-agg-head');
    if (rightHead) {
        rightHead.style.display = 'flex';
        rightHead.style.alignItems = 'center';
        rightHead.style.justifyContent = 'space-between';
        rightHead.style.gap = '8px';
        rightHead.style.margin = '0 0 6px';
        rightHead.style.width = '100%';
        rightHead.style.boxSizing = 'border-box';
    }

    if (aggControls) {
        aggControls.style.display = 'inline-flex';
        aggControls.style.gap = '4px';
        aggControls.style.flexWrap = 'wrap';
        aggControls.style.justifyContent = 'flex-end';
        aggControls.style.marginLeft = 'auto';
    }

    if (aggContainer) {
        aggContainer.style.width = '100%';
        aggContainer.style.maxWidth = '560px';
    }

    if (row && leftPanel && rawContainer.parentNode !== leftPanel) {
        leftPanel.appendChild(rawContainer);
    }

    if (rightPanel && aggContainer && aggContainer.parentNode !== rightPanel) {
        rightPanel.appendChild(aggContainer);
    }

    const tickerSection = findTickerSection(rawContainer);
    if (tickerSection && layoutRoot.parentNode && tickerSection.parentNode === layoutRoot.parentNode) {
        if (tickerSection !== layoutRoot.nextElementSibling) {
            layoutRoot.parentNode.insertBefore(tickerSection, layoutRoot.nextSibling);
        }
    }

    renderAggGranularityControls();

    return { rawContainer, aggContainer };
}

function parseItemIdFromHash() {
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    if (!rawHash) return null;

    const [pathPart] = rawHash.split('?');
    const segs = (pathPart || '').split('/').filter(Boolean);
    const itemIdx = segs.indexOf('item');
    if (itemIdx < 0 || segs[itemIdx + 1] == null) return null;

    return segs[itemIdx + 1];
}

function parseSeriesKeyFromHash(itemId = null) {
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    if (!rawHash) return null;

    const [pathPart, queryPart] = rawHash.split('?');

    const segs = (pathPart || '').split('/').filter(Boolean);
    const itemIdx = segs.indexOf('item');
    if (itemIdx >= 0) {
        const hashItemId = segs[itemIdx + 1];
        if (hashItemId && (itemId == null || String(itemId) === String(hashItemId))) {
            const refineIdx = segs.indexOf('refine', itemIdx + 2);
            if (refineIdx >= 0 && segs[refineIdx + 1] != null) {
                const refine = Number(segs[refineIdx + 1]);
                const gradeIdx = segs.indexOf('grade', itemIdx + 2);
                const grade = (gradeIdx >= 0 && segs[gradeIdx + 1] != null) ? Number(segs[gradeIdx + 1]) : 0;
                if (Number.isInteger(grade) && Number.isInteger(refine)) {
                    return `${grade}_${refine}`;
                }
            }
        }
    }

    const qs = queryPart || (rawHash.includes('=') ? rawHash : '');
    if (qs) {
        const params = new URLSearchParams(qs);
        const rg = params.get('grade');
        const rr = params.get('refine');
        if (rr != null) {
            const refine = Number(rr);
            const grade = rg != null ? Number(rg) : 0;
            if (Number.isInteger(grade) && Number.isInteger(refine)) {
                return `${grade}_${refine}`;
            }
        }
    }

    const m = rawHash.match(/(?:^|[&/])(\d+)_(\d+)(?:$|[&/])/);
    if (m) {
        return `${Number(m[1])}_${Number(m[2])}`;
    }

    return null;
}

function parseAggGranularityFromHash(itemId = null) {
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    if (!rawHash) return null;

    const [pathPart, queryPart] = rawHash.split('?');
    const segs = (pathPart || '').split('/').filter(Boolean);

    const itemIdx = segs.indexOf('item');
    if (itemIdx >= 0) {
        const hashItemId = segs[itemIdx + 1];
        if (hashItemId && (itemId == null || String(itemId) === String(hashItemId))) {
            const aggIdx = segs.indexOf('agg', itemIdx + 2);
            if (aggIdx >= 0 && segs[aggIdx + 1] != null) {
                return normalizeAggGranularity(segs[aggIdx + 1]);
            }
        }
    }

    const qs = queryPart || (rawHash.includes('=') ? rawHash : '');
    if (qs) {
        const params = new URLSearchParams(qs);
        const agg = params.get('agg');
        if (agg) return normalizeAggGranularity(agg);
    }

    return null;
}

function buildChartHash(itemId, seriesKey, aggGranularity = chartUiState.aggGranularity) {
    if (itemId == null) return window.location.hash || '#';

    const [grade, refine] = String(seriesKey || '').split('_').map(Number);
    const agg = normalizeAggGranularity(aggGranularity || getDefaultAggGranularity());

    let hash = `#/item/${itemId}`;

    if (Number.isInteger(refine)) {
        hash += `/refine/${refine}`;
    }
    if (Number.isInteger(grade) && grade !== 0) {
        hash += `/grade/${grade}`;
    }

    hash += `/agg/${agg}`;

    return hash;
}

function syncChartUrl(itemId, seriesKey, mode = 'replace') {
    if (!itemId || !seriesKey || mode === 'none') return;

    const nextHash = buildChartHash(itemId, seriesKey, chartUiState.aggGranularity);
    const currentHash = window.location.hash || '';
    if (currentHash === nextHash) return;

    if (mode === 'push') {
        window.history.pushState(null, '', nextHash);
        return;
    }
    window.history.replaceState(null, '', nextHash);
}

function setTickerSeriesFilterByKey(seriesKey) {
    if (!seriesKey) return;

    const [grade, refine] = String(seriesKey).split('_').map(Number);
    if (!Number.isInteger(grade) || !Number.isInteger(refine)) return;

    store.tickerFilters.grades.clear();
    store.tickerFilters.grades.add(grade);
    store.tickerFilters.refines.clear();
    store.tickerFilters.refines.add(refine);
}

function clearTickerSeriesFilter() {
    store.tickerFilters.grades.clear();
    store.tickerFilters.refines.clear();
}

function recoverChartSelectionFromUrl() {
    if (!chartUiState.itemId) return;

    const hashItemId = parseItemIdFromHash();
    if (!hashItemId || String(hashItemId) !== String(chartUiState.itemId)) return;

    const nextAgg = normalizeAggGranularity(parseAggGranularityFromHash(chartUiState.itemId) || getDefaultAggGranularity());
    const hashSeriesKey = parseSeriesKeyFromHash(chartUiState.itemId);

    if (!hashSeriesKey) {
        chartUiState.selectedSeriesKey = null;
        chartUiState.aggGranularity = nextAgg;
        clearTickerSeriesFilter();
        renderChart(chartUiState.itemId, { preserveFilters: true, urlHistory: 'replace' });
        return;
    }

    const changed = (hashSeriesKey !== chartUiState.selectedSeriesKey) || (nextAgg !== chartUiState.aggGranularity);
    if (!changed) return;

    chartUiState.selectedSeriesKey = hashSeriesKey;
    chartUiState.aggGranularity = nextAgg;
    setTickerSeriesFilterByKey(hashSeriesKey);
    renderChart(chartUiState.itemId, { preserveFilters: true, urlHistory: 'none' });
}

function getDefaultSeriesKey() {
    return '0_10';
}

function resolveChartSelectedSeriesKey(statsByKey, itemId = null) {
    const requested =
        chartUiState.selectedSeriesKey ||
        parseSeriesKeyFromHash(itemId) ||
        getDefaultSeriesKey();

    if (requested && statsByKey.has(requested)) return requested;

    const defaultKey = getDefaultSeriesKey();
    if (statsByKey.has(defaultKey)) return defaultKey;

    for (const col of REFINE_COLS) {
        const key = `${col.grade}_${col.refine}`;
        if (statsByKey.has(key)) return key;
    }

    const first = statsByKey.keys().next();
    return first.done ? null : first.value;
}

function buildRawStatsBySeries(records) {
    const JST_OFFSET_SEC = 9 * 3600;
    const out = new Map();

    for (const r of records) {
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
    }

    return out;
}

function buildStatsByGranularity(records, granularity) {
    if (granularity === 'raw') return buildRawStatsBySeries(records);

    const bucketSecMap = {
        '3h': 3 * 3600,
        '6h': 6 * 3600,
        '1d': 24 * 3600,
    };
    const bucketSec = bucketSecMap[granularity] || 24 * 3600;
    return buildBucketStatsBySeries(records, bucketSec);
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

function buildVolumeData(stats, granularity) {
    let prevMedian = null;

    return stats.map(s => {
        const isUp = prevMedian == null || s.median >= prevMedian;
        prevMedian = s.median;
        return {
            time: toChartTime(s.time, granularity),
            value: s.count,
            color: isUp ? 'rgba(46, 204, 113, 0.45)' : 'rgba(231, 76, 60, 0.45)',
        };
    });
}

function createSingleChart(viewKey, container, granularity, colLabel, stats, baseColor) {
    if (!container) return;

    if (!stats || stats.length === 0) {
        container.innerHTML = '';
        return;
    }

    const showVolume = granularity !== 'raw';
    const CHART_WIDTH = 560;
    const CHART_HEIGHT = 180;

    container.style.position = 'relative';
    container.style.width = `${CHART_WIDTH}px`;
    container.style.maxWidth = `${CHART_WIDTH}px`;
    container.style.height = `${CHART_HEIGHT}px`;
    container.style.margin = '0';

    let tooltipEl = null;
    if (showVolume) {
        tooltipEl = document.createElement('div');
        tooltipEl.style.position = 'absolute';
        tooltipEl.style.display = 'none';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.zIndex = '10';
        tooltipEl.style.background = 'rgba(255,255,255,0.96)';
        tooltipEl.style.border = '1px solid #d0d0d0';
        tooltipEl.style.borderRadius = '6px';
        tooltipEl.style.padding = '6px 8px';
        tooltipEl.style.boxShadow = '0 2px 10px rgba(0,0,0,0.10)';
        tooltipEl.style.fontSize = '12px';
        tooltipEl.style.lineHeight = '1.35';
        tooltipEl.style.color = '#333';
        tooltipEl.style.whiteSpace = 'nowrap';
        container.appendChild(tooltipEl);
    }

    const chart = LightweightCharts.createChart(container, {
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
        layout: { background: { color: '#ffffff' }, textColor: '#333', attributionLogo: false },
        grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
        rightPriceScale: {
            borderColor: '#ddd',
            scaleMargins: showVolume ? { top: 0.03, bottom: 0.28 } : { top: 0.03, bottom: 0.03 },
        },
        timeScale: {
            borderColor: '#ddd',
            timeVisible: granularity !== '1d',
            secondsVisible: false,
        },
        handleScroll: {
            mouseWheel: false,
            pressedMouseMove: true,
        },
        handleScale: {
            mouseWheel: false,
            pinch: true,
            axisPressedMouseMove: true,
        },
        localization: {
            priceFormatter: v => `${(v / 1e9).toFixed(2)}G`,
            timeFormatter: t => formatChartTimeLabel(t, granularity),
        },
    });

    let volumeSeries = null;
    if (showVolume) {
        volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
            priceScaleId: 'vol',
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
            lastValueVisible: false,
            priceLineVisible: false,
            base: 0,
        });
        chart.priceScale('vol').applyOptions({
            borderVisible: false,
            scaleMargins: { top: 0.78, bottom: 0.02 },
        });
    }

    let candleSeries = null;

    if (granularity === 'raw') {
        const rawBuilt = buildRawLineData(stats);
        const lineData = mapDataTimes(rawBuilt.activeData, granularity);

        const lineSeries = chart.addSeries(LightweightCharts.LineSeries, {
            title: colLabel,
            color: baseColor,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true,
        });
        lineSeries.setData(lineData);
    } else {
        const candleBuilt = buildRangeBoxCandles(stats, baseColor);
        const candleData = mapDataTimes(candleBuilt.activeData, granularity);

        candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
            title: colLabel,
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
        candleSeries.setData(candleData);
    }

    if (volumeSeries) {
        volumeSeries.setData(buildVolumeData(stats, granularity));
    }

    if (candleSeries && tooltipEl) {
        const statByTime = new Map(stats.map(s => [toChartTime(s.time, granularity), s]));

        const toHoverTimeKey = t => {
            if (typeof t === 'number') return t;
            if (
                t &&
                typeof t === 'object' &&
                typeof t.year === 'number' &&
                typeof t.month === 'number' &&
                typeof t.day === 'number'
            ) {
                return Date.UTC(t.year, t.month - 1, t.day) / 1000;
            }
            return null;
        };

        const fmtG = v => (typeof v === 'number' && v > 0) ? `${(v / 1e9).toFixed(2)}G` : '-';

        chart.subscribeCrosshairMove(param => {
            const point = param.point;
            const cw = container.clientWidth;
            const ch = container.clientHeight;

            if (!point || param.time == null || point.x < 0 || point.y < 0 || point.x > cw || point.y > ch) {
                tooltipEl.style.display = 'none';
                return;
            }

            const tKey = toHoverTimeKey(param.time);
            if (tKey == null) {
                tooltipEl.style.display = 'none';
                return;
            }

            const s = statByTime.get(tKey);
            if (!s) {
                tooltipEl.style.display = 'none';
                return;
            }

            tooltipEl.innerHTML = [
                `<div style="font-weight:600; margin-bottom:4px;">${formatChartTimeLabel(param.time, granularity)}</div>`,
                `<div>高値: <b>${fmtG(s.high)}</b></div>`,
                `<div>安値: <b>${fmtG(s.low)}</b></div>`,
                `<div>中央値: <b>${fmtG(s.median)}</b></div>`,
                `<div>取引量: <b>${s.count}</b></div>`,
            ].join('');

            tooltipEl.style.display = 'block';

            const pad = 8;
            let left = point.x + 12;
            let top = point.y - tooltipEl.offsetHeight - 12;

            if (left + tooltipEl.offsetWidth > cw - pad) {
                left = cw - tooltipEl.offsetWidth - pad;
            }
            if (left < pad) left = pad;

            if (top < pad) {
                top = point.y + 12;
            }
            if (top + tooltipEl.offsetHeight > ch - pad) {
                top = ch - tooltipEl.offsetHeight - pad;
            }
            if (top < pad) top = pad;

            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
        });
    }

    chartViewState[viewKey].chart = chart;
    chartViewState[viewKey].resizeObserver = null;

    chart.timeScale().fitContent();
    setTimeout(() => {
        if (chartViewState[viewKey].chart !== chart) return;
        const ts = chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        if (range) ts.setVisibleLogicalRange({ from: range.from - 1.5, to: range.to });
    }, 0);
}

function destroySingleChart(viewKey) {
    const st = chartViewState[viewKey];
    if (!st) return;

    if (st.resizeObserver) {
        st.resizeObserver.disconnect();
        st.resizeObserver = null;
    }
    if (st.chart) {
        st.chart.remove();
        st.chart = null;
    }
}

function renderTicker(records) {
    const JST_OFFSET_MS = 9 * 3600000;
    const { grades, refines, enchants, cards } = store.tickerFilters;

    const chipHtml = (type, val, label, isActive) =>
        `<span class="filter-chip ${isActive ? 'active' : 'available'} row-chip" data-filter-type="${type}" data-filter-val="${val}">${label}</span>`;

    const rowsHtml = records.map(r => {
        const d = new Date(r.ts + JST_OFFSET_MS);
        const datetime = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

        const refineChip = chipHtml('refine', r.refine, `+${r.refine}`, refines.size > 0 && refines.has(r.refine));
        const gradeChip = r.grade === 1
            ? chipHtml('grade', '1', '★1', grades.size > 0 && grades.has(1))
            : '';

        const enchantChips = [r.card2, r.card3, r.card4]
            .filter(Boolean)
            .map(e => chipHtml('enchant', e, e, enchants.size > 0 && enchants.has(e)))
            .join('');

        const cardChip = r.card1
            ? chipHtml('card', r.card1, r.card1, cards.size > 0 && cards.has(r.card1))
            : '';

        const priceG = r.price > 0 ? `${(r.price / 1e9).toFixed(2)}G` : '-';

        return `<div class="ticker-row" data-grade="${r.grade}" data-refine="${r.refine}"><span>${datetime}</span><span>${priceG}</span><span>${gradeChip}</span><span>${refineChip}</span><span>${enchantChips}</span><span>${cardChip}</span></div>`;
    }).join('');

    document.getElementById('ticker-body').innerHTML = rowsHtml;
}

function applyTickerFilters(records) {
    const { grades, refines, enchants, cards } = store.tickerFilters;

    return records.filter(r => {
        if (grades.size > 0 && !grades.has(r.grade)) return false;
        if (refines.size > 0 && !refines.has(r.refine)) return false;

        if (enchants.size > 0) {
            const e2 = r.card2;
            const e3 = r.card3;
            const e4 = r.card4;
            for (const e of enchants) {
                if (e !== e2 && e !== e3 && e !== e4) return false;
            }
        }

        if (cards.size > 0 && !cards.has(r.card1)) return false;

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
    const filtered = applyTickerFilters(store.currentTickerRecords);
    renderTicker(filtered);
    renderTickerFilterUI();
    renderTickerBoard(filtered);
}

function toggleFilter(type, val) {
    if (type === 'grade') {
        const n = Number(val);
        if (store.tickerFilters.grades.has(n)) store.tickerFilters.grades.delete(n);
        else store.tickerFilters.grades.add(n);
    } else if (type === 'refine') {
        const n = Number(val);
        if (store.tickerFilters.refines.has(n)) store.tickerFilters.refines.delete(n);
        else store.tickerFilters.refines.add(n);
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
    const selectedKey = chartUiState.selectedSeriesKey;

    document.querySelectorAll('#detail-item-matrix tbody tr[data-grade]').forEach(row => {
        const grade = Number(row.dataset.grade);
        const refine = Number(row.dataset.refine);
        const rowKey = `${grade}_${refine}`;
        row.classList.toggle('dim-active', !!selectedKey && rowKey === selectedKey);
    });
}

function buildDayMinPriceMap(recs) {
    const dayMinMap = new Map();

    for (const r of recs) {
        const day = toJSTDate(r.ts);
        const prev = dayMinMap.get(day);
        if (prev == null || r.price < prev) {
            dayMinMap.set(day, r.price);
        }
    }

    return dayMinMap;
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

    if (matrixUiState.lastItemId !== itemId) {
        matrixUiState.pageStart = null;
        matrixUiState.lastItemId = itemId;
    }

    const allDates = store.appAvailableDates;
    const maxStart = Math.max(0, allDates.length - DETAIL_MATRIX_DAYS);

    if (matrixUiState.pageStart === null) matrixUiState.pageStart = maxStart;
    const pageStart = Math.max(0, Math.min(matrixUiState.pageStart, maxStart));
    matrixUiState.pageStart = pageStart;

    const dates = allDates.slice(pageStart, pageStart + DETAIL_MATRIX_DAYS);
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
        `</div>`;

    const headerCells =
        '<th class="dim-sticky">精錬</th>' +
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

        const dayMinMap = buildDayMinPriceMap(recs);
        const dataDates = [...dayMinMap.keys()].sort();

        const latestDate = dataDates.length > 0 ? dataDates[dataDates.length - 1] : null;
        const prevDate = dataDates.length > 1 ? dataDates[dataDates.length - 2] : null;

        const latestPrice = latestDate ? (dayMinMap.get(latestDate) || 0) : 0;
        const prevPrice = prevDate ? (dayMinMap.get(prevDate) || 0) : 0;

        const dayDiff = latestPrice > 0 && prevPrice > 0 ? latestPrice - prevPrice : null;
        const diffStr = dayDiff === null
            ? '-'
            : (dayDiff >= 0 ? `+${(dayDiff / 1e9).toFixed(2)}` : `${(dayDiff / 1e9).toFixed(2)}`);
        const diffCls = dayDiff === null ? '' : (dayDiff > 0 ? ' dim-up' : dayDiff < 0 ? ' dim-down' : '');

        const last3Dates = allDates.slice(-3);
        const last3Prices = last3Dates
            .map(d => dayMinMap.get(d) || 0)
            .filter(p => p > 0);

        const low3d = last3Prices.length > 0 ? Math.min(...last3Prices) : 0;
        const high3d = last3Prices.length > 0 ? Math.max(...last3Prices) : 0;

        const rowPrices = dates.map(d => dayMinMap.get(d) || 0);
        const cells = rowPrices.map(price => {
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
            cells +
            '</tr>';
    }).join('');

    if (pagerHeadEl) pagerHeadEl.innerHTML = pagerHtml;
    container.innerHTML = `<table id="detail-item-matrix"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function destroyChart() {
    destroySingleChart('raw');
    destroySingleChart('agg');

    store.currentChart = null;
    store.currentVolumeSeries = null;
    store.currentSeriesVariants = new Map();
    store.currentSeriesToKey = new Map();

    const rawContainer = document.getElementById('chart-container');
    const aggContainer = document.getElementById('chart-container-agg');
    if (rawContainer) rawContainer.innerHTML = '';
    if (aggContainer) aggContainer.innerHTML = '';
}

export function renderChart(itemId, refineOrOptions = {}, maybeOptions = {}) {
    let options = {};
    let explicitRefine = null;

    if (typeof refineOrOptions === 'number') {
        explicitRefine = refineOrOptions;
        options = maybeOptions || {};
    } else {
        options = refineOrOptions || {};
        if (typeof options.refine === 'number') explicitRefine = options.refine;
    }

    const urlHistory = options.urlHistory || 'replace';

    const prevItemId = chartUiState.itemId;
    chartUiState.itemId = itemId;

    if (prevItemId !== itemId) {
        chartUiState.selectedSeriesKey = null;
    }

    if (!options.preserveFilters && explicitRefine == null && !options.selectedSeriesKey) {
        chartUiState.selectedSeriesKey = null;
    }

    if (explicitRefine != null && Number.isInteger(explicitRefine)) {
        chartUiState.selectedSeriesKey = `0_${explicitRefine}`;
    }
    if (typeof options.selectedSeriesKey === 'string') {
        chartUiState.selectedSeriesKey = options.selectedSeriesKey;
    }

    chartUiState.aggGranularity = normalizeAggGranularity(
        options.aggGranularity ||
        chartUiState.aggGranularity ||
        parseAggGranularityFromHash(itemId) ||
        getDefaultAggGranularity()
    );

    ensureDetailHeaderTickerInfo();
    ensureDetailTopRowLayout();
    const { rawContainer, aggContainer } = ensureDualChartLayout();
    ensureTickerBoardLayout();

    renderDetailMatrix(itemId);

    const itemName = store.appNameMap.get(itemId) || itemId;
    document.getElementById('detail-rotool-link').href = `https://rotool.gungho.jp/item/${itemId}/0/`;
    document.getElementById('detail-item-name').textContent = itemName;

    const itemRecordsBase = store.appAllRecords.filter(r => r.item_id === itemId);
    const itemRecords = [...itemRecordsBase].sort((a, b) => a.ts - b.ts);
    store.currentTickerRecords = [...itemRecordsBase].sort((a, b) => b.ts - a.ts);

    if (!options.preserveFilters) {
        store.tickerFilters = {
            grades: new Set(),
            refines: new Set(),
            enchants: new Set(),
            cards: new Set(),
        };
    }

    destroyChart();
    renderAggGranularityControls();

    if (itemRecords.length === 0) {
        refreshTicker();
        updateDetailMatrixHighlight();
        return;
    }

    const statsByRaw = buildStatsByGranularity(itemRecords, 'raw');
    const selectedKey = resolveChartSelectedSeriesKey(statsByRaw, itemId);

    if (!selectedKey) {
        refreshTicker();
        updateDetailMatrixHighlight();
        return;
    }

    chartUiState.selectedSeriesKey = selectedKey;
    setTickerSeriesFilterByKey(selectedKey);
    syncChartUrl(itemId, selectedKey, urlHistory);

    const [selGrade, selRefine] = selectedKey.split('_').map(Number);
    const selectedCol = REFINE_COLS.find(c => c.grade === selGrade && c.refine === selRefine);
    const baseColor = SERIES_COLORS[selectedKey] || '#999';

    const rawStats = statsByRaw.get(selectedKey) || [];
    const statsByAgg = buildStatsByGranularity(itemRecords, chartUiState.aggGranularity);
    const aggStats = statsByAgg.get(selectedKey) || [];

    createSingleChart(
        'raw',
        rawContainer,
        'raw',
        selectedCol ? selectedCol.label : selectedKey,
        rawStats,
        baseColor
    );

    createSingleChart(
        'agg',
        aggContainer,
        chartUiState.aggGranularity,
        selectedCol ? selectedCol.label : selectedKey,
        aggStats,
        baseColor
    );

    refreshTicker();
    updateDetailMatrixHighlight();
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

    document.addEventListener('click', e => {
        const aggBtn = e.target.closest('#chart-agg-controls .chart-agg-btn[data-agg]');
        if (!aggBtn) return;

        const nextAgg = normalizeAggGranularity(aggBtn.dataset.agg);
        if (nextAgg === chartUiState.aggGranularity) return;

        chartUiState.aggGranularity = nextAgg;
        renderAggGranularityControls();

        if (chartUiState.itemId) {
            renderChart(chartUiState.itemId, { preserveFilters: true, urlHistory: 'push' });
        }
    });

    function handleDetailMatrixPagerClick(e) {
        if (e.target.closest('.matrix-prev-btn')) {
            matrixUiState.pageStart = Math.max(0, (matrixUiState.pageStart ?? 0) - DETAIL_MATRIX_DAYS);
            if (chartUiState.itemId) renderDetailMatrix(chartUiState.itemId);
            return true;
        }

        if (e.target.closest('.matrix-next-btn')) {
            const max = Math.max(0, store.appAvailableDates.length - DETAIL_MATRIX_DAYS);
            matrixUiState.pageStart = Math.min(max, (matrixUiState.pageStart ?? 0) + DETAIL_MATRIX_DAYS);
            if (chartUiState.itemId) renderDetailMatrix(chartUiState.itemId);
            return true;
        }

        return false;
    }

    const detailMatrixHeadEl = document.getElementById('detail-matrix-head');
    if (detailMatrixHeadEl) {
        detailMatrixHeadEl.addEventListener('click', e => {
            handleDetailMatrixPagerClick(e);
        });
    }

    const detailMatrixEl = document.getElementById('detail-matrix');
    if (!detailMatrixEl) return;

    detailMatrixEl.addEventListener('click', e => {
        if (handleDetailMatrixPagerClick(e)) return;

        const row = e.target.closest('#detail-item-matrix tbody tr[data-grade]');
        if (!row) return;

        const grade = Number(row.dataset.grade);
        const refine = Number(row.dataset.refine);

        chartUiState.selectedSeriesKey = `${grade}_${refine}`;
        setTickerSeriesFilterByKey(chartUiState.selectedSeriesKey);

        if (chartUiState.itemId) {
            renderChart(chartUiState.itemId, { preserveFilters: true, urlHistory: 'push' });
        }
    });

    if (!chartUrlEventsBound) {
        chartUrlEventsBound = true;

        const onUrlChanged = () => {
            recoverChartSelectionFromUrl();
        };

        window.addEventListener('popstate', onUrlChanged);
        window.addEventListener('hashchange', onUrlChanged);
    }
}