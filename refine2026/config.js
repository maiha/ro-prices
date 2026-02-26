const PROFILES = {
    prod: {
        DATA_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRicNuVbiQId8zAghBF9bl7kMtrM-1XXSqjL9ikuwtbsnDXKmuKZ0ZtCc78QDelc-FbkytCN50WNglO/pub?gid=0&single=true&output=tsv",
        META_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRicNuVbiQId8zAghBF9bl7kMtrM-1XXSqjL9ikuwtbsnDXKmuKZ0ZtCc78QDelc-FbkytCN50WNglO/pub?gid=1067686929&single=true&output=tsv",
        // データ対象期間（JST 日付文字列 "YYYY-MM-DD"）。null で無制限。
        DATE_FROM: "2026-02-23",
        DATE_TO: null,
    },
};

// ← この1行だけ書き換えてプロファイル切り替え
const APP_CONFIG = PROFILES.prod;

// 「個別装備 - アイテム選択」画面の表示設定
// - 外側の配列 = 行、内側の配列 = その行に並べるグループ
// - 1要素の行 → 横幅100%、2要素 → 50:50、3要素 → 33:33:33
// - null または省略（スパース配列 ,）で空スロットを表現できる
// - label: グループ見出しに表示する名前
// - kind: meta の kind 値と一致するもので振り分け
// - ここに載っていない kind は末尾に「その他」としてまとめる
const ITEM_SELECT_GROUPS = [
    [{ kind: 50, label: '頭' }],
    [{ kind: 9, label: '武器' }, { kind: 61, label: '盾' }],
    [{ kind: 62, label: '肩' }, { kind: 60, label: '鎧' }],
    [{ kind: 63, label: '靴' }],
];

// カスタム設定の localStorage キー名
const CUSTOM_ITEMS_KEY = 'ro-refine2026-custom-items-key';
