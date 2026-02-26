import { store } from '../store.js';

export function renderItemSelect() {
    const byKind = new Map();
    store.appSortedNames.forEach(name => {
        const { item_id } = store.appGroupMap.get(name);
        const kind = store.appKindMap.has(item_id) ? store.appKindMap.get(item_id) : -1;
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push({ name, item_id });
    });

    const renderGroup = (g, items, modifier = '') => {
        const links = items.map(({ name, item_id }) => `<a href="#item/${item_id}" class="item-select-link">${name}</a>`).join('');
        const body = items.length > 0 ? links : '<span class="item-group-nodata">データなし</span>';
        const kindIconClass = `caz-eq caz-eq-${g.kind}`;
        return `<div class="item-group${modifier ? ' ' + modifier : ''}">
            <div class="item-group-name ${kindIconClass}">${g.label}</div>
            <div class="item-group-list">${body}</div>
        </div>`;
    };

    const rows = typeof ITEM_SELECT_GROUPS !== 'undefined' ? ITEM_SELECT_GROUPS : [];
    const configuredKinds = new Set(rows.flat().filter(g => g != null).map(g => g.kind));

    const configHtml = rows.map(row => {
        const groupsHtml = row.map(g =>
            g == null
                ? '<div class="item-group-slot"></div>'
                : renderGroup(g, byKind.get(g.kind) || [], byKind.has(g.kind) ? '' : 'item-group-missing')
        ).join('');
        return `<div class="item-select-row">${groupsHtml}</div>`;
    }).join('');

    const extraGroups = [...byKind.keys()]
        .filter(k => !configuredKinds.has(k))
        .sort((a, b) => a - b)
        .map(kind => renderGroup(kind < 0 ? '(kind未設定)' : `kind=${kind} (未設定)`, byKind.get(kind), 'item-group-extra'))
        .join('');

    document.getElementById('item-select-body').innerHTML = configHtml + (extraGroups ? `<div class="item-select-row">${extraGroups}</div>` : '');
}
