const TSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTD2e3T--ElFHXrBtlj4Tufr7C4pdjHcqD_CIxEf55EW8p8aRYnNBRp4QfWdmGdAV_T-VImIXtWJazR/pub?gid=0&single=true&output=tsv";
const ITEMS_JSON_URL = "items.json";

async function init() {
    try {
        const cacheBuster = Math.floor(Date.now() / 600000);
        const [itemsRes, tsvRes] = await Promise.all([
            fetch(ITEMS_JSON_URL),
            fetch(`${TSV_URL}&t=${cacheBuster}`)
        ]);

        const items = await itemsRes.json();
        const tsvText = await tsvRes.text();

        const latestPrices = new Map();
        const lines = tsvText.trim().split(/\r?\n/);
        let maxTimestamp = "";

        lines.forEach(line => {
            const [ts, id, val] = line.split('\t');
            if (!ts || ts === "timestamp") return;
            if (ts > maxTimestamp) maxTimestamp = ts;
            const price = Number(val);
            const current = latestPrices.get(id);
            if (!current || ts >= current.ts) {
                latestPrices.set(id, { ts, price });
            }
        });

        document.getElementById('last-updated').innerText = maxTimestamp ? `${maxTimestamp} 現在` : "データなし";

        const displayData = items.map(item => {
            const info = latestPrices.get(item.id) || { price: 0 };
            return {
                id: item.id,
                name: item.name,
                price: info.price
            };
        });

        renderTable("table-name", [...displayData].sort((a, b) => a.name.localeCompare(b.name, 'ja')));
        renderTable("table-price", [...displayData].sort((a, b) => b.price - a.price));

        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'flex';

    } catch (err) {
        document.getElementById('loading').innerText = "ERR: " + err.message;
    }
}

function renderTable(tableId, data) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    tbody.innerHTML = data.map(item => `
        <tr>
            <td>
                <a href="https://rotool.gungho.jp/item/${item.id}/0/" target="_blank">
                    ${item.name}
                </a>
            </td>
            <td>${item.price > 0 ? item.price.toLocaleString() : "-"}</td>
        </tr>
    `).join('');
}

init();