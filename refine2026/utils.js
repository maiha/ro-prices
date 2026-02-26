export function toJSTDate(ts) {
    const d = new Date(ts + 9 * 3600000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dateRangeMs(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startMs = Date.UTC(y, m - 1, d) - 9 * 3600000;
    return [startMs, startMs + 24 * 3600000];
}

export function expandDate(compact) {
    return compact.length === 8
        ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
        : compact;
}

export function medianOf(prices) {
    if (prices.length === 0) return 0;
    const s = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : Math.floor((s[mid - 1] + s[mid]) / 2);
}

export function minOf(prices) {
    if (prices.length === 0) return 0;
    return Math.min(...prices);
}

export function percentileOfSorted(sorted, p) {
    if (!sorted.length) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

export function buildBucketStatsBySeries(records, bucketSec = 3 * 3600) {
    const JST_OFFSET_SEC = 9 * 3600;
    const byKey = new Map();

    records.forEach(r => {
        const key = `${r.grade}_${r.refine}`;
        const tSec = Math.floor(r.ts / 1000);
        const bucketTime = Math.floor((tSec + JST_OFFSET_SEC) / bucketSec) * bucketSec;
        if (!byKey.has(key)) byKey.set(key, new Map());
        const bm = byKey.get(key);
        if (!bm.has(bucketTime)) bm.set(bucketTime, []);
        bm.get(bucketTime).push(r.price);
    });

    const out = new Map();
    byKey.forEach((bucketMap, key) => {
        const stats = [...bucketMap.entries()].sort((a, b) => a[0] - b[0]).map(([time, prices]) => {
            const s = [...prices].sort((a, b) => a - b);
            return {
                time,
                low: s[0],
                high: s[s.length - 1],
                q1: percentileOfSorted(s, 0.25),
                q3: percentileOfSorted(s, 0.75),
                median: medianOf(s),
                count: s.length,
            };
        });
        out.set(key, stats);
    });

    return out;
}

export function getCellData(recs, dateStr, maxDaysAgo = Infinity, statFn = medianOf) {
    const [startMs, endMs] = dateRangeMs(dateStr);
    let currentDate = dateStr;
    let dayPrices = recs.filter(r => r.ts >= startMs && r.ts < endMs).map(r => r.price);
    let daysAgo = 0;

    if (dayPrices.length === 0) {
        const pastRecs = recs.filter(r => r.ts < startMs);
        if (pastRecs.length === 0) return { price: 0, count: 0, daysAgo: null, prevPrice: 0 };
        const latestTs = Math.max(...pastRecs.map(r => r.ts));
        currentDate = toJSTDate(latestTs);
        const [ls, le] = dateRangeMs(currentDate);
        dayPrices = recs.filter(r => r.ts >= ls && r.ts < le).map(r => r.price);
        const [sy, sm, sd] = dateStr.split('-').map(Number);
        const [py, pm, pd] = currentDate.split('-').map(Number);
        daysAgo = Math.round((Date.UTC(sy, sm - 1, sd) - Date.UTC(py, pm - 1, pd)) / 86400000);
        if (daysAgo > maxDaysAgo) return { price: 0, count: 0, daysAgo: null, prevPrice: 0 };
    }

    const price = statFn(dayPrices);
    const count = dayPrices.length;
    const [currentStart] = dateRangeMs(currentDate);
    const prevRecs = recs.filter(r => r.ts < currentStart);
    let prevPrice = 0;

    if (prevRecs.length > 0) {
        const prevLatestTs = Math.max(...prevRecs.map(r => r.ts));
        const prevDate = toJSTDate(prevLatestTs);
        const [ps, pe] = dateRangeMs(prevDate);
        prevPrice = statFn(recs.filter(r => r.ts >= ps && r.ts < pe).map(r => r.price));
    }

    return { price, count, daysAgo, prevPrice };
}

export function getMatrixCellClass(price, rowPrices) {
    if (!price || price <= 0) return '';
    const sorted = rowPrices.filter(p => p > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return '';
    const unique = [...new Set(sorted)];
    const min = unique[0];
    if (price === min) return 'matrix-min';
    if (unique.length === 1) return '';
    const thresLow = unique[Math.floor(unique.length * 0.2)] || Infinity;
    const thresMid = unique[Math.floor(unique.length * 0.5)] || Infinity;
    if (price <= thresLow) return 'matrix-cheap2';
    if (price <= thresMid) return 'matrix-cheap3';
    return '';
}

export function formatPrice(price) {
    if (!price || price <= 0) return '-';
    return (price / 1e9).toFixed(2);
}

export function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}
