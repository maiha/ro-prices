import { store } from '../store.js';

export function getCustomItemsKey() {
    return (typeof CUSTOM_ITEMS_KEY !== 'undefined' && CUSTOM_ITEMS_KEY) || 'ro-refine2026-custom';
}

export function loadCustomItems() {
    try {
        const raw = localStorage.getItem(getCustomItemsKey());
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                store.appCustomItems = new Set(arr.map(String));
                return;
            }
        }
    } catch (_e) { }
    store.appCustomItems = new Set();
}

export function saveCustomItems() {
    try {
        localStorage.setItem(getCustomItemsKey(), JSON.stringify([...store.appCustomItems]));
    } catch (_e) { }
}

export function getActiveNames() {
    if (!store.appCustomMode || store.appCustomItems.size === 0) return store.appSortedNames;
    return store.appSortedNames.filter(name => {
        const entry = store.appGroupMap.get(name);
        return entry && store.appCustomItems.has(entry.item_id);
    });
}

export function updateCustomCount() {
    const el = document.getElementById('custom-count');
    if (!el) return;
    el.textContent = store.appCustomItems.size > 0 ? `${store.appCustomItems.size}件選択中` : '全表示中';
}

export function renderCustomSelect() {
    const byKind = new Map();
    store.appNameMap.forEach((name, item_id) => {
        const kind = store.appKindMap.has(item_id) ? store.appKindMap.get(item_id) : -1;
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push({ name, item_id });
    });
    byKind.forEach(items => items.sort((a, b) => a.name.localeCompare(b.name, 'ja')));

    const renderGroup = (label, kind, items, modifier = '') => {
        if (!label) {
            label = kind < 0 ? '(kind未設定)' : `kind=${kind} (未設定)`;
        }
        const buttons = items.map(({ name, item_id }) => {
            const on = store.appCustomItems.has(item_id);
            return `<button class="custom-toggle${on ? ' custom-toggle-on' : ''}" data-item-id="${item_id}">${name}</button>`;
        }).join('');
        const body = items.length > 0 ? buttons : '<span class="item-group-nodata">データなし</span>';
        const kindIconClass = `caz-eq caz-eq-${kind}`;
        return `<div class="item-group${modifier ? ' ' + modifier : ''}">
            <div class="item-group-name ${kindIconClass}">${label}</div>
            <div class="item-group-list">${body}</div>
        </div>`;
    };

    const rows = typeof ITEM_SELECT_GROUPS !== 'undefined' ? ITEM_SELECT_GROUPS : [];
    const configuredKinds = new Set(rows.flat().filter(g => g != null).map(g => g.kind));

    const configHtml = rows.map(row => {
        const groupsHtml = row.map(g =>
            g == null
                ? '<div class="item-group-slot"></div>'
                : renderGroup(g.label, g.kind, byKind.get(g.kind) || [], byKind.has(g.kind) ? '' : 'item-group-missing')
        ).join('');
        return `<div class="item-select-row">${groupsHtml}</div>`;
    }).join('');

    const extraGroups = [...byKind.keys()]
        .filter(k => !configuredKinds.has(k))
        .sort((a, b) => a - b)
        .map(kind => {
            return renderGroup(null, kind, byKind.get(kind), 'item-group-extra');
        }).join('');

    document.getElementById('custom-body').innerHTML = configHtml + (extraGroups ? `<div class="item-select-row">${extraGroups}</div>` : '');
    updateCustomCount();
}
