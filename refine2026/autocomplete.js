(function () {
    'use strict';

    if (
        !window.wanakana ||
        typeof window.wanakana.toHiragana !== 'function' ||
        typeof window.wanakana.toRomaji !== 'function'
    ) {
        throw new Error('wanakana が読み込まれていません。');
    }

    const toHiragana = window.wanakana.toHiragana;
    const toRomaji = window.wanakana.toRomaji;

    let uidSeq = 0;

    function uid(prefix) {
        uidSeq += 1;
        return prefix + '-' + uidSeq + '-' + Math.random().toString(36).slice(2, 7);
    }

    function normLabel(raw) {
        return String(raw == null ? '' : raw)
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '');
    }

    function normYomi(raw) {
        return toHiragana(String(raw == null ? '' : raw))
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '');
    }

    // V/B揺らぎ吸収（"ゔぁ"系2文字を1文字に畳み込む）
    function foldVB1(kana) {
        return kana
            .replace(/ゔぁ|ば/g, 'ば')
            .replace(/ゔぃ|び/g, 'び')
            .replace(/ゔぇ|べ/g, 'べ')
            .replace(/ゔぉ|ぼ/g, 'ぼ')
            .replace(/ゔ|ぶ/g, 'ぶ');
    }

    function normYomiLoose(raw) {
        return foldVB1(normYomi(raw)).replace(/ー/g, '');
    }

    // ローマ字インクリメンタル用（va/var/varu を安定して拾う）
    function normRomajiLoose(raw) {
        return String(raw == null ? '' : raw)
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '')
            .replace(/v/g, 'b')      // V/B同一視
            .replace(/[^a-z]/g, ''); // 英字以外除去
    }

    function buildIndex(data) {
        const out = new Array(data.length);
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const label = String(d.label ?? '');
            const yomi = String(d.yomi ?? '');
            const yomiLoose = normYomiLoose(yomi);

            out[i] = {
                id: d.id,
                label,
                yomi,
                labelNorm: normLabel(label),
                yomiNorm: normYomi(yomi),
                yomiLoose: yomiLoose,
                romajiLoose: toRomaji(yomiLoose)
                    .normalize('NFKC')
                    .toLowerCase()
                    .replace(/[^a-z]/g, ''),
                _order: i
            };
        }
        return out;
    }

    function createItemAutocomplete(root, options) {
        if (!root) throw new Error('root 要素が必要です。');

        const opts = Object.assign(
            {
                data: [],
                maxResults: 10,
                autoSelectFirst: true, // 追加: 候補先頭を自動選択
                placeholder: 'アイテム名を入力（英字・かな対応）',
                onSelect: null
            },
            options || {}
        );

        const compId = uid('iac');
        const listId = compId + '-list';

        // ルートを初期化
        root.innerHTML = '';
        root.classList.add('iac');

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'item-search-root-input';
        input.className = 'iac-input';
        input.placeholder = opts.placeholder;
        input.autocomplete = 'off';
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', listId);

        const list = document.createElement('ul');
        list.id = listId;
        list.className = 'iac-list';
        list.setAttribute('role', 'listbox');
        list.hidden = true;

        root.appendChild(input);
        root.appendChild(list);

        let indexed = buildIndex(opts.data);
        let currentResults = [];
        let activeIndex = -1;
        let isOpen = false;
        let isComposing = false;
        let skipNextInput = false;
        let suppressNextInput = false;
        let lastQueryRaw = null;

        function openList() {
            if (isOpen) return;
            isOpen = true;
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }

        function closeList() {
            if (!isOpen) return;
            isOpen = false;
            list.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            activeIndex = -1;
        }

        function clearListDOM() {
            list.textContent = '';
            input.removeAttribute('aria-activedescendant');
            activeIndex = -1; // 再描画後に updateActive(0) を効かせる
        }

        function updateActive(nextIndex) {
            const prevIndex = activeIndex;
            if (prevIndex === nextIndex) return;

            if (prevIndex >= 0 && prevIndex < list.children.length) {
                const prevEl = list.children[prevIndex];
                prevEl.setAttribute('aria-selected', 'false');
            }

            activeIndex = nextIndex;

            if (activeIndex >= 0 && activeIndex < list.children.length) {
                const el = list.children[activeIndex];
                el.setAttribute('aria-selected', 'true');
                input.setAttribute('aria-activedescendant', el.id);
                el.scrollIntoView({ block: 'nearest' });
            } else {
                input.removeAttribute('aria-activedescendant');
            }
        }

        function renderList(results) {
            clearListDOM();

            if (!results.length) {
                closeList();
                return;
            }

            const frag = document.createDocumentFragment();

            for (let i = 0; i < results.length; i++) {
                const item = results[i];
                const li = document.createElement('li');
                li.className = 'iac-item';
                li.id = compId + '-opt-' + i;
                li.dataset.index = String(i);
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');

                const label = document.createElement('span');
                label.className = 'iac-label';
                label.textContent = item.label;

                const yomi = document.createElement('span');
                yomi.className = 'iac-yomi';
                yomi.textContent = item.yomi;

                li.appendChild(label);
                li.appendChild(yomi);
                frag.appendChild(li);
            }

            list.appendChild(frag);
            openList();
            updateActive(opts.autoSelectFirst ? 0 : -1); // 修正: 先頭自動選択
        }

        function runSearch(rawQuery) {
            const qRaw = String(rawQuery ?? '');
            const qLabel = normLabel(qRaw);
            const qYomi = normYomi(qRaw);
            const qLoose = foldVB1(qYomi).replace(/ー/g, '');
            const qRomaji = normRomajiLoose(qRaw);

            if (!qLabel && !qYomi && !qLoose && !qRomaji) return [];

            const hits = [];
            for (let i = 0; i < indexed.length; i++) {
                const item = indexed[i];
                let score = 0;

                if (qLabel) {
                    if (item.labelNorm.startsWith(qLabel)) score = 300;
                    else if (item.labelNorm.includes(qLabel)) score = 200;
                }

                if (qYomi) {
                    if (item.yomiNorm.startsWith(qYomi)) {
                        if (score < 160) score = 160;
                    } else if (item.yomiNorm.includes(qYomi)) {
                        if (score < 120) score = 120;
                    }
                }

                if (qLoose) {
                    if (item.yomiLoose.startsWith(qLoose)) {
                        if (score < 80) score = 80;
                    } else if (item.yomiLoose.includes(qLoose)) {
                        if (score < 60) score = 60;
                    }
                }

                // ローマ字インクリメンタル（va / var / varu）
                if (qRomaji) {
                    if (item.romajiLoose.startsWith(qRomaji)) {
                        if (score < 140) score = 140;
                    } else if (item.romajiLoose.includes(qRomaji)) {
                        if (score < 100) score = 100;
                    }
                }

                if (score > 0) {
                    hits.push({ idx: i, score: score });
                }
            }

            hits.sort(function (a, b) {
                if (b.score !== a.score) return b.score - a.score;
                const ia = indexed[a.idx];
                const ib = indexed[b.idx];
                if (ia.label.length !== ib.label.length) return ia.label.length - ib.label.length;
                return ia._order - ib._order;
            });

            const take = Math.min(opts.maxResults, hits.length);
            const out = new Array(take);
            for (let i = 0; i < take; i++) {
                out[i] = indexed[hits[i].idx];
            }
            return out;
        }

        function updateResults(rawQuery) {
            // 同一値の連続検索を抑止（IMEの環境差対策にも効く）
            if (rawQuery === lastQueryRaw) return;
            lastQueryRaw = rawQuery;

            currentResults = runSearch(rawQuery);
            renderList(currentResults);
        }

        function selectIndex(index) {
            if (index < 0 || index >= currentResults.length) return;
            const item = currentResults[index];

            suppressNextInput = true;
            input.value = item.label;

            closeList();

            const detail = { item: item };
            input.dispatchEvent(new CustomEvent('itemselect', { detail, bubbles: true }));
            root.dispatchEvent(new CustomEvent('itemselect', { detail, bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            if (typeof opts.onSelect === 'function') {
                opts.onSelect(item);
            }
        }

        function moveActive(delta) {
            if (!isOpen || currentResults.length === 0) return;
            let next = activeIndex + delta;
            if (next < 0) next = currentResults.length - 1;
            if (next >= currentResults.length) next = 0;
            updateActive(next);
        }

        function onCompositionStart() {
            isComposing = true;
        }

        function onCompositionEnd() {
            isComposing = false;
            skipNextInput = true; // compositionend直後のinput二重実行を防止
            updateResults(input.value);
        }

        function onInput(e) {
            if (suppressNextInput) {
                suppressNextInput = false;
                return;
            }
            if (isComposing || e.isComposing) return;
            if (skipNextInput) {
                skipNextInput = false;
                return;
            }
            updateResults(e.target.value);
        }

        function onKeyDown(e) {
            if (isComposing || e.isComposing) return;

            switch (e.key) {
                case 'ArrowDown':
                    if (!isOpen) {
                        updateResults(input.value); // ここで先頭が選択される
                        e.preventDefault();
                        break;
                    }
                    moveActive(1);
                    e.preventDefault();
                    break;

                case 'ArrowUp':
                    if (!isOpen) {
                        updateResults(input.value); // ここで先頭が選択される
                        e.preventDefault();
                        break;
                    }
                    moveActive(-1);
                    e.preventDefault();
                    break;

                case 'Enter':
                    if (isOpen && currentResults.length > 0) {
                        selectIndex(activeIndex >= 0 ? activeIndex : 0);
                        e.preventDefault();
                    }
                    break;

                case 'Escape':
                    closeList();
                    break;
            }
        }

        function onListMouseDown(e) {
            const li = e.target.closest('.iac-item');
            if (!li || !list.contains(li)) return;
            e.preventDefault(); // inputのblur先行を防ぐ
            const idx = Number(li.dataset.index);
            if (Number.isInteger(idx)) {
                selectIndex(idx);
            }
        }

        function onListMouseMove(e) {
            const li = e.target.closest('.iac-item');
            if (!li || !list.contains(li)) return;
            const idx = Number(li.dataset.index);
            if (!Number.isInteger(idx)) return;
            updateActive(idx);
        }

        function onDocumentPointerDown(e) {
            if (!root.contains(e.target)) {
                closeList();
            }
        }

        function onRootFocusOut() {
            // Tab移動などでフォーカスが外へ出たら閉じる
            queueMicrotask(function () {
                if (!root.contains(document.activeElement)) {
                    closeList();
                }
            });
        }

        input.addEventListener('compositionstart', onCompositionStart);
        input.addEventListener('compositionend', onCompositionEnd);
        input.addEventListener('input', onInput);
        input.addEventListener('keydown', onKeyDown);
        input.addEventListener('focus', () => { input.select(); });
        list.addEventListener('mousedown', onListMouseDown);
        list.addEventListener('mousemove', onListMouseMove);
        root.addEventListener('focusout', onRootFocusOut);
        document.addEventListener('pointerdown', onDocumentPointerDown, true);

        function clearInput() {
            suppressNextInput = false;
            lastQueryRaw = null;
            input.value = '';
            closeList();
        }

        function setData(nextData) {
            indexed = buildIndex(Array.isArray(nextData) ? nextData : []);
            lastQueryRaw = null;
            updateResults(input.value);
        }

        function destroy() {
            input.removeEventListener('compositionstart', onCompositionStart);
            input.removeEventListener('compositionend', onCompositionEnd);
            input.removeEventListener('input', onInput);
            input.removeEventListener('keydown', onKeyDown);
            list.removeEventListener('mousedown', onListMouseDown);
            list.removeEventListener('mousemove', onListMouseMove);
            root.removeEventListener('focusout', onRootFocusOut);
            document.removeEventListener('pointerdown', onDocumentPointerDown, true);

            root.innerHTML = '';
            root.classList.remove('iac');
        }

        return {
            root,
            input,
            list,
            setData,
            clearInput,
            search: runSearch,
            close: closeList,
            destroy
        };
    }

    // 既存アプリ組み込み用公開API（1個だけ公開）
    window.ItemAutocomplete = {
        create: createItemAutocomplete,
        _normalize: {
            normLabel,
            normYomi,
            normYomiLoose,
            normRomajiLoose
        }
    };
})();