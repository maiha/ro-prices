async function init() {
    const statusEl = document.getElementById('last-updated');
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('content');

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

        if (statusEl && maxTimestamp) {
            const d = new Date(new Date(maxTimestamp).getTime() + 3600000);
            statusEl.textContent = d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        }

        if (!maxTimestamp || items.length === 0) return;
        const refTimeMs = new Date(maxTimestamp).getTime();

        const displayData = items.map(item => {
            const getPrice = (h) => {
                const target = refTimeMs - (h * 3600000);
                const r = allRecords.filter(r => r.id === item.id && r.ts <= target).sort((a, b) => b.ts - a.ts)[0];
                return r ? r.price : 0;
            };
            return {
                ...item,
                current: getPrice(0), h3: getPrice(3), h6: getPrice(6), h12: getPrice(12), d1: getPrice(24), d2: getPrice(48), d3: getPrice(72)
            };
        });

        const allP = displayData.flatMap(d => [d.current, d.h3, d.h6, d.h12, d.d1, d.d2]).filter(p => p > 0);
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
    tb.innerHTML = data.map(i => `<tr><td class="name-col"><a href="https://rotool.gungho.jp/item/${i.id}/0/" target="_blank">${i.shortName}</a></td><td class="${getCls(i.current, max, thres)}">${i.current > 0 ? i.current.toLocaleString() : "-"}</td></tr>`).join('');
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

    const cols = ['current', 'h3', 'h6', 'h12', 'd1', 'd2'];
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
        return `<tr><td class="rank-col">${rank}</td><td class="name-col"><a href="https://rotool.gungho.jp/item/${item.id}/0/" target="_blank">${item.shortName}</a></td>${cols.map(c => `<td class="${getCls(item[c], colMaxs[c], priceThres)}">${item[c] > 0 ? item[c].toLocaleString() : "-"}</td>`).join('')}${extraHtml}</tr>`;
    }).join('');
}

init();