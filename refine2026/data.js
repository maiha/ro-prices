import { store } from './store.js';
import { minOf, toJSTDate, yieldToMain } from './utils.js';
import { handleRouting, navigateToItem } from './router.js';

export async function init() {
    const statusEl = document.getElementById('last-updated');
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('content');
    const overlay = document.getElementById('updating-overlay');

    overlay.classList.add('active');
    try {
        const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        const cacheMs = isDev ? 30000 : 300000;
        const timestamp = Math.floor(Date.now() / cacheMs);

        const [metaRes, dataRes] = await Promise.all([
            fetch(`${APP_CONFIG.META_URL}&t=${timestamp}`, { cache: 'no-store' }),
            fetch(`${APP_CONFIG.DATA_URL}&t=${timestamp}`, { cache: 'no-store' }),
        ]);
        if (!metaRes.ok || !dataRes.ok) throw new Error('Main fetch failed');

        store.appMatrixAutoScrolled = false;
        store.appMatrixUserScrolled = false;

        const metaText = await metaRes.text();
        const [metaHeader, ...metaLines] = metaText.trim().split(/\r?\n/);
        const metaKeys = metaHeader.split('\t');
        const nameMap = new Map();
        const kindMap = new Map();
        const yomiMap = new Map();

        for (let i = 0; i < metaLines.length; i++) {
            const l = metaLines[i];
            if (!l) continue;
            const cols = l.split('\t');
            const obj = {};
            metaKeys.forEach((k, j) => { obj[k] = cols[j]; });

            if (obj.item_id) {
                nameMap.set(obj.item_id, obj.item_name || obj.item_id);
                if (obj.kind !== undefined && obj.kind !== '') kindMap.set(obj.item_id, Number(obj.kind));
                if (obj.yomi !== undefined && obj.yomi !== '') yomiMap.set(obj.item_id, obj.yomi);
            }
            if ((i & 2047) === 0) await yieldToMain();
        }

        store.appNameMap = nameMap;
        store.appKindMap = kindMap;
        store.appYomiMap = yomiMap;

        const acData = [...nameMap.entries()].map(([item_id, label]) => ({ id: item_id, label, yomi: yomiMap.get(item_id) || '' }));
        if (store.appAutocomplete) {
            store.appAutocomplete.setData(acData);
        } else if (window.ItemAutocomplete) {
            const searchRoot = document.getElementById('item-search-root');
            if (searchRoot) {
                store.appAutocomplete = window.ItemAutocomplete.create(searchRoot, {
                    data: acData,
                    maxResults: 10,
                    autoSelectFirst: true,
                    placeholder: 'アイテム検索: ari / あーり / アーリ',
                    onSelect(item) {
                        navigateToItem(item.id);
                        store.appAutocomplete.clearInput();
                    },
                });
            }
        }

        const dataText = await dataRes.text();
        const [dataHeader, ...dataLines] = dataText.trim().split(/\r?\n/);
        const dataKeys = dataHeader.split('\t');
        const rangeFromMs = APP_CONFIG.DATE_FROM ? new Date(`${APP_CONFIG.DATE_FROM}T00:00:00+09:00`).getTime() : null;
        const rangeToMs = APP_CONFIG.DATE_TO ? new Date(`${APP_CONFIG.DATE_TO}T00:00:00+09:00`).getTime() + 86400000 : null;

        let maxTimestamp = '';
        const allRecords = [];
        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i];
            if (!line) continue;
            const cols = line.split('\t');
            const row = {};
            dataKeys.forEach((k, j) => { if (!(k in row)) row[k] = cols[j]; });

            const { timestamp: ts, item_id, price } = row;
            if (!ts || !price || Number.isNaN(Number(price))) continue;
            if (!nameMap.has(item_id)) continue;

            const tsMs = new Date(ts).getTime();
            if (rangeFromMs && tsMs < rangeFromMs) continue;
            if (rangeToMs && tsMs >= rangeToMs) continue;

            if (ts > maxTimestamp) maxTimestamp = ts;
            allRecords.push({
                ts: tsMs,
                item_id,
                price: Number(price),
                grade: Number(row.grade),
                refine: Number(row.refine),
                card1: row.card1 || '',
                card2: row.card2 || '',
                card3: row.card3 || '',
                card4: row.card4 || '',
            });

            if ((i & 2047) === 0) await yieldToMain();
        }

        store.appAllRecords = allRecords;

        if (statusEl && maxTimestamp) {
            const d = new Date(new Date(maxTimestamp).getTime());
            statusEl.textContent = d.toLocaleString('ja-JP', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            });
        }

        if (!maxTimestamp || allRecords.length === 0) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'flex';
            return;
        }

        const noCardRecords = allRecords.filter(r => [0, 1].includes(r.grade) && [7, 8, 9, 10].includes(r.refine) && !r.card1);
        store.appAvailableDates = [...new Set(noCardRecords.map(r => toJSTDate(r.ts)))].sort();

        const groupMap = new Map();
        noCardRecords.forEach(r => {
            const name = nameMap.get(r.item_id) || r.item_id;
            if (!groupMap.has(name)) groupMap.set(name, { item_id: r.item_id, cols: {} });
            const colKey = `${r.grade}_${r.refine}`;
            const entry = groupMap.get(name);
            if (!entry.cols[colKey]) entry.cols[colKey] = { item_id: r.item_id, recs: [] };
            entry.cols[colKey].recs.push(r);
        });
        // マスタ全件を追加（取引なしアイテムも行として表示するため）
        nameMap.forEach((name, item_id) => {
            if (!groupMap.has(name)) groupMap.set(name, { item_id, cols: {} });
        });
        store.appGroupMap = groupMap;

        // ITEM_SELECT_GROUPS から部位順・ラベルを構築
        const slotGroups = typeof ITEM_SELECT_GROUPS !== 'undefined'
            ? ITEM_SELECT_GROUPS.flat().filter(g => g != null) : [];
        const slotOrderMap = new Map(); // kind → 順序index
        const slotLabelMap = new Map(); // kind → label
        slotGroups.forEach((g, i) => { slotOrderMap.set(g.kind, i); slotLabelMap.set(g.kind, g.label); });
        store.appSlotLabelMap = slotLabelMap;

        // sort: (部位順, よみ)
        store.appSortedNames = [...groupMap.keys()].sort((a, b) => {
            const aId = groupMap.get(a)?.item_id;
            const bId = groupMap.get(b)?.item_id;
            const aOrder = slotOrderMap.has(kindMap.get(aId)) ? slotOrderMap.get(kindMap.get(aId)) : Infinity;
            const bOrder = slotOrderMap.has(kindMap.get(bId)) ? slotOrderMap.get(kindMap.get(bId)) : Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            const aYomi = yomiMap.get(aId) || a;
            const bYomi = yomiMap.get(bId) || b;
            return aYomi.localeCompare(bYomi, 'ja');
        });

        const repRecs = allRecords.filter(r => r.grade === 0 && r.refine === 10 && !r.card1);
        const byItemDate = new Map();
        repRecs.forEach(r => {
            const dateStr = toJSTDate(r.ts);
            if (!byItemDate.has(r.item_id)) byItemDate.set(r.item_id, new Map());
            const dm = byItemDate.get(r.item_id);
            if (!dm.has(dateStr)) dm.set(dateStr, []);
            dm.get(dateStr).push(r.price);
        });

        const matrixData = new Map();
        byItemDate.forEach((dm, item_id) => {
            const name = nameMap.get(item_id) || item_id;
            const priceByDate = new Map();
            dm.forEach((prices, dateStr) => priceByDate.set(dateStr, minOf(prices)));
            matrixData.set(name, priceByDate);
        });
        store.appMatrixData = matrixData;
        store.appMatrixDates = [...new Set(repRecs.map(r => toJSTDate(r.ts)))].sort();

        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'flex';
    } catch (e) {
        console.error(e);
    } finally {
        overlay.classList.remove('active');
        handleRouting();
    }
}
