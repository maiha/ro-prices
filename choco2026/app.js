// Module-scope data (populated by init, used by chart)
let appAllRecords = [];
let appItems = [];

async function init() {
    const statusEl = document.getElementById('last-updated');
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('content');
    const overlay = document.getElementById('updating-overlay');

    overlay.classList.add('active');
    try {
        const timestamp = Date.now();
        const fetchTasks = [
            fetch(`${APP_CONFIG.ITEMS_JSON_URL}?t=${timestamp}`),
            fetch(`${APP_CONFIG.TSV_URL}&t=${timestamp}`)
        ];

        if (APP_CONFIG.EXTRA_JSON_URL) {
            fetchTasks.push(fetch(`${APP_CONFIG.EXTRA_JSON_URL}?t=${timestamp}`).catch(() => null));
        }

        const [itemsRes, tsvRes, extraRes] = await Promise.all(fetchTasks);

        if (!itemsRes.ok || !tsvRes.ok) throw new Error("Main fetch failed");

        const rawItems = await itemsRes.json();
        let extraData = [];
        if (extraRes && extraRes.ok) {
            try { extraData = await extraRes.json(); } catch (e) { console.warn(e); }
        }

        const extraMap = new Map();
        if (Array.isArray(extraData)) {
            extraData.forEach(ex => {
                const key = ex[APP_CONFIG.EXTRA_JOIN_KEY];
                if (key && !extraMap.has(key)) extraMap.set(key, ex);
            });
        }

        const items = rawItems.map(item => {
            const shortName = item.name.match(/\((.*?)\)/)?.[1] || item.name;
            return { ...item, shortName, extra: extraMap.get(shortName) || {} };
        });

        const tsvText = await tsvRes.text();
        const lines = tsvText.trim().split(/\r?\n/);
        let maxTimestamp = "";
        const allRecords = [];
        lines.forEach(line => {
            const [ts, id, val] = line.split('\t');
            if (!ts || ts === "timestamp" || isNaN(val)) return;
            if (ts > maxTimestamp) maxTimestamp = ts;
            allRecords.push({ ts: new Date(ts).getTime(), id, price: Number(val) });
        });

        // Expose to module scope
        appAllRecords = allRecords;
        appItems = items;

        if (statusEl && maxTimestamp) {
            const d = new Date(new Date(maxTimestamp).getTime() + 3600000);
            statusEl.textContent = d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        }

        if (!maxTimestamp || items.length === 0) return;
        const refTimeMs = new Date(maxTimestamp).getTime();

        const displayData = items.map(item => {
            const itemRecords = allRecords.filter(r => r.id === item.id);

            const getMedian = (startH, endH) => {
                const startMs = refTimeMs - (startH * 3600000);
                const endMs = refTimeMs - (endH * 3600000);
                const prices = itemRecords
                    .filter(r => r.ts <= startMs && r.ts > endMs)
                    .map(r => r.price)
                    .sort((a, b) => a - b);

                if (prices.length === 0) return 0;
                const mid = Math.floor(prices.length / 2);
                return prices.length % 2 !== 0 ? prices[mid] : Math.floor((prices[mid - 1] + prices[mid]) / 2);
            };

            const latestRecord = [...itemRecords].sort((a, b) => b.ts - a.ts)[0];

            return {
                ...item,
                current: getMedian(0, 3),
                h6: getMedian(3, 6),
                h12: getMedian(6, 12),
                d1: getMedian(12, 24),
                d2: getMedian(24, 48),
                d3: getMedian(48, 72)
            };
        });

        const allP = displayData.flatMap(d => [d.current, d.h6, d.h12, d.d1, d.d2, d.d3]).filter(p => p > 0);
        const uniquePrices = [...new Set(allP)].sort((a, b) => a - b);
        const priceThres = {
            mid: uniquePrices[Math.floor(uniquePrices.length * 0.5)] || Infinity,
            high: uniquePrices[Math.floor(uniquePrices.length * 0.8)] || Infinity
        };

        const extraThresMap = new Map();
        if (APP_CONFIG.EXTRA_JSON_URL) {
            APP_CONFIG.EXTRA_ATTRIBUTES.forEach(attr => {
                const vals = displayData
                    .map(d => Number(d.extra[attr.key]))
                    .filter(v => !isNaN(v) && v > 0);
                const uniqueVals = [...new Set(vals)].sort((a, b) => a - b);
                if (uniqueVals.length > 0) {
                    extraThresMap.set(attr.key, {
                        mid: uniqueVals[Math.floor(uniqueVals.length * 0.5)] || Infinity,
                        high: uniqueVals[Math.floor(uniqueVals.length * 0.8)] || Infinity,
                        max: Math.max(...uniqueVals)
                    });
                }
            });
        }

        renderTableName("table-name", [...displayData].sort((a, b) => a.shortName.localeCompare(b.shortName, 'ja')), priceThres);
        renderTablePrice("table-price", [...displayData].sort((a, b) => b.current - a.current), priceThres, extraThresMap);

        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'flex';
    } catch (e) { console.error(e); }
    overlay.classList.remove('active');
    handleRouting();
}

function formatVal(val, type) {
    if (typeof val !== 'number' && isNaN(Number(val))) return val || "-";
    const n = Number(val);
    if (type === 'comma') return n.toLocaleString();
    if (type === 'short') {
        if (n >= 1e9) return (n / 1e9).toFixed(1) + "G";
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return n.toLocaleString();
    }
    return val;
}

function getCls(val, max, thres) {
    if (val <= 0 || isNaN(val)) return "";
    if (val === max) return "rank-top1";
    if (val >= thres.high) return "price-high";
    if (val >= thres.mid) return "price-mid";
    return "";
}

function renderTableName(id, data, thres) {
    const tb = document.querySelector(`#${id} tbody`);
    if (!tb) return;
    const max = Math.max(...data.map(d => d.current));
    tb.innerHTML = data.map(i => `<tr data-item-id="${i.id}"><td class="name-col"><a href="https://rotool.gungho.jp/item/${i.id}/0/" target="_blank">${i.shortName}</a></td><td class="${getCls(i.current, max, thres)}">${i.current > 0 ? i.current.toLocaleString() : "-"}</td></tr>`).join('');
}

function renderTablePrice(id, data, priceThres, extraThresMap) {
    const hr = document.getElementById('price-header-row');
    const tb = document.querySelector(`#${id} tbody`);
    if (!tb || !data.length) return;

    if (APP_CONFIG.EXTRA_JSON_URL && hr && !hr.querySelector('.extra-header')) {
        APP_CONFIG.EXTRA_ATTRIBUTES.forEach(a => {
            const th = document.createElement('th');
            th.className = 'extra-header';
            th.textContent = a.label;
            th.setAttribute('data-key', a.key);
            hr.appendChild(th);
        });
    }

    const cols = ['current', 'h6', 'h12', 'd1', 'd2', 'd3'];
    const colMaxs = {};
    cols.forEach(c => colMaxs[c] = Math.max(...data.map(d => d[c])));

    tb.innerHTML = data.map((item, idx) => {
        const rank = idx === 0 ? '<span class="crown">👑</span>' : idx + 1;
        let extraHtml = "";
        if (APP_CONFIG.EXTRA_JSON_URL) {
            extraHtml = APP_CONFIG.EXTRA_ATTRIBUTES.map(a => {
                const rawVal = item.extra[a.key];
                const numVal = Number(rawVal);
                const thres = extraThresMap.get(a.key);
                const cls = thres ? getCls(numVal, thres.max, thres) : "";
                return `<td class="extra-col ${cls}" data-key="${a.key}">${formatVal(rawVal, a.format)}</td>`;
            }).join('');
        }
        return `<tr data-item-id="${item.id}"><td class="rank-col">${rank}</td><td class="name-col"><a href="https://rotool.gungho.jp/item/${item.id}/0/" target="_blank">${item.shortName}</a></td>${cols.map(c => `<td class="${getCls(item[c], colMaxs[c], priceThres)}">${item[c] > 0 ? item[c].toLocaleString() : "-"}</td>`).join('')}${extraHtml}</tr>`;
    }).join('');
}

// --- SPA routing ---

function navigateToItem(itemId) {
    history.pushState({ item: itemId }, '', '?item=' + itemId);
    handleRouting();
}

function navigateToList() {
    history.pushState({}, '', location.pathname);
    handleRouting();
}

let currentChart = null;
let savedPriceWidth = 0;

function handleRouting() {
    const params = new URLSearchParams(location.search);
    const itemId = params.get('item');
    const contentEl = document.getElementById('content');
    const priceSection = document.getElementById('table-price-section');
    const detailEl = document.getElementById('detail-view');

    if (itemId && appItems.length > 0) {
        if (priceSection.offsetWidth > 0) savedPriceWidth = priceSection.offsetWidth;
        detailEl.style.minWidth = savedPriceWidth + 'px';
        priceSection.style.display = 'none';
        detailEl.style.display = 'block';
        if (contentEl.style.display === 'none') contentEl.style.display = 'flex';
        renderChart(itemId);
        highlightActiveItem(itemId);
    } else {
        detailEl.style.display = 'none';
        detailEl.style.minWidth = '';
        priceSection.style.display = '';
        if (appItems.length > 0) contentEl.style.display = 'flex';
        destroyChart();
        highlightActiveItem(null);
    }
}

function highlightActiveItem(itemId) {
    document.querySelectorAll('#table-name tr.active-item').forEach(tr => tr.classList.remove('active-item'));
    if (itemId) {
        const tr = document.querySelector(`#table-name tr[data-item-id="${itemId}"]`);
        if (tr) tr.classList.add('active-item');
    }
}

function destroyChart() {
    if (currentChart) {
        currentChart.remove();
        currentChart = null;
    }
    document.getElementById('chart-container').innerHTML = '';
}

function renderChart(itemId) {
    const item = appItems.find(i => i.id === itemId);
    if (!item) return;

    const rotoolLink = document.getElementById('detail-rotool-link');
    rotoolLink.href = `https://rotool.gungho.jp/item/${item.id}/0/`;

    const records = appAllRecords
        .filter(r => r.id === itemId)
        .sort((a, b) => a.ts - b.ts);

    if (records.length === 0) return;

    // Ticker-style header: name ▲/▼ change (%)  vs 1d ago
    const latestPrice = records[records.length - 1].price;
    const oneDayAgoMs = records[records.length - 1].ts - 24 * 3600000;
    const olderRecords = records.filter(r => r.ts <= oneDayAgoMs);
    const prevPrice = olderRecords.length ? olderRecords[olderRecords.length - 1].price : null;

    const titleEl = document.getElementById('detail-item-name');
    if (prevPrice && prevPrice > 0) {
        const diff = latestPrice - prevPrice;
        const pct = (diff / prevPrice * 100).toFixed(1);
        const sign = diff > 0 ? '+' : '';
        const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
        const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';
        titleEl.innerHTML = `${item.shortName} <span class="detail-price">${latestPrice.toLocaleString()}</span> <span class="info-value ${cls}">${arrow}${sign}${Math.round(diff).toLocaleString()} (${sign}${pct}%)</span>`;
    } else {
        titleEl.innerHTML = `${item.shortName} <span class="detail-price">${latestPrice.toLocaleString()}</span>`;
    }

    destroyChart();

    const container = document.getElementById('chart-container');
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 400,
        layout: { background: { color: '#ffffff' }, textColor: '#333', attributionLogo: false },
        grid: {
            vertLines: { color: '#f0f0f0' },
            horzLines: { color: '#f0f0f0' },
        },
        rightPriceScale: { borderColor: '#ddd' },
        timeScale: {
            borderColor: '#ddd',
            timeVisible: true,
            secondsVisible: false,
        },
        localization: {
            priceFormatter: v => v.toLocaleString(),
            timeFormatter: t => {
                const d = new Date(t * 1000);
                const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(d.getUTCDate()).padStart(2, '0');
                const hh = String(d.getUTCHours()).padStart(2, '0');
                const mi = String(d.getUTCMinutes()).padStart(2, '0');
                return `${mm}/${dd} ${hh}:${mi}`;
            },
        },
    });

    const JST_OFFSET = 9 * 3600;
    const BUCKET_SEC = 3 * 3600; // 3-hour candles

    // Aggregate into OHLC buckets
    const buckets = new Map();
    records.forEach(r => {
        const utcSec = Math.floor(r.ts / 1000);
        const jstSec = utcSec + JST_OFFSET;
        const key = Math.floor(jstSec / BUCKET_SEC) * BUCKET_SEC;
        if (!buckets.has(key)) {
            buckets.set(key, { time: key, open: r.price, high: r.price, low: r.price, close: r.price });
        } else {
            const b = buckets.get(key);
            b.high = Math.max(b.high, r.price);
            b.low = Math.min(b.low, r.price);
            b.close = r.price;
        }
    });

    const ohlcData = [...buckets.values()].sort((a, b) => a.time - b.time);

    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
    });

    series.setData(ohlcData);

    // SMA overlays
    const calcSMA = (data, period) => {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j].close;
            result.push({ time: data[i].time, value: sum / period });
        }
        return result;
    };

    if (ohlcData.length >= 4) {
        const sma12h = chart.addSeries(LightweightCharts.LineSeries, {
            color: '#2196f3',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        sma12h.setData(calcSMA(ohlcData, 4));
    }

    if (ohlcData.length >= 8) {
        const sma24h = chart.addSeries(LightweightCharts.LineSeries, {
            color: '#ff9800',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        sma24h.setData(calcSMA(ohlcData, 8));
    }

    chart.timeScale().fitContent();
    currentChart = chart;

    const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    // Info panel
    const last = ohlcData[ohlcData.length - 1];
    const prev = ohlcData.length >= 2 ? ohlcData[ohlcData.length - 2] : null;
    const allHighs = ohlcData.map(d => d.high);
    const allLows = ohlcData.map(d => d.low);

    const change = prev ? last.close - prev.close : 0;
    const changePct = prev && prev.close ? (change / prev.close * 100) : 0;
    const changeCls = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
    const changeSign = change > 0 ? '+' : '';

    const sma12hData = ohlcData.length >= 4 ? calcSMA(ohlcData, 4) : [];
    const sma24hData = ohlcData.length >= 8 ? calcSMA(ohlcData, 8) : [];
    const sma12hVal = sma12hData.length ? sma12hData[sma12hData.length - 1].value : null;
    const sma24hVal = sma24hData.length ? sma24hData[sma24hData.length - 1].value : null;

    const fmtP = v => v != null ? Math.round(v).toLocaleString() : '-';

    const infoItems = [
        ['銘柄', item.shortName, ''],
        ['現在価格', fmtP(last.close), ''],
        ['騰落', `${changeSign}${fmtP(change)} (${changeSign}${changePct.toFixed(1)}%)`, changeCls],
        ['高値', fmtP(Math.max(...allHighs)), ''],
        ['安値', fmtP(Math.min(...allLows)), ''],
        ['始値', fmtP(ohlcData[0].open), ''],
        ['SMA 12h', fmtP(sma12hVal), ''],
        ['SMA 24h', fmtP(sma24hVal), ''],
    ];

    document.getElementById('detail-info').innerHTML = infoItems.map(([label, value, cls]) =>
        `<div class="info-cell"><span class="info-label">${label}</span><span class="info-value ${cls}">${value}</span></div>`
    ).join('');

    // Ticker (歩み値) - latest 20 records, newest first
    const JST_OFFSET_MS = 9 * 3600000;
    const recent = records.slice(-20).reverse();
    const tickerBody = document.getElementById('ticker-body');
    tickerBody.innerHTML = recent.map((r, i) => {
        const d = new Date(r.ts + JST_OFFSET_MS);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mi = String(d.getUTCMinutes()).padStart(2, '0');
        const time = `${hh}:${mi}`;
        const price = r.price.toLocaleString();

        // Compare to next older record
        const older = i < recent.length - 1 ? recent[i + 1] : null;
        let diffHtml = '-';
        let rowCls = '';
        if (older) {
            const diff = r.price - older.price;
            if (diff > 0) { diffHtml = `+${diff.toLocaleString()}`; rowCls = 'tick-up'; }
            else if (diff < 0) { diffHtml = `${diff.toLocaleString()}`; rowCls = 'tick-down'; }
            else { diffHtml = '0'; }
        }
        return `<div class="ticker-row ${rowCls}"><span>${time}</span><span>${price}</span><span>${diffHtml}</span></div>`;
    }).join('');
}

// Row click: navigate to detail (but not when clicking a link)
document.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-item-id]');
    if (tr) navigateToItem(tr.dataset.itemId);
});

window.addEventListener('popstate', () => handleRouting());

document.getElementById('back-btn').addEventListener('click', () => navigateToList());

document.getElementById('title-link').addEventListener('click', e => {
    e.preventDefault();
    navigateToList();
});

document.getElementById('reload-btn').addEventListener('click', () => init());

init();
