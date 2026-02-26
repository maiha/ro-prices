export const store = {
    appAllRecords: [],
    appNameMap: new Map(),
    appKindMap: new Map(),
    appYomiMap: new Map(),
    appSortedNames: [],
    appSlotLabelMap: new Map(), // kind → label（部位列表示用）
    appGroupMap: new Map(),
    appAvailableDates: [],
    appMatrixData: new Map(),
    appMatrixDates: [],

    expandedItems: new Set(),
    appAutocomplete: null,
    appCustomItems: new Set(),
    appCustomMode: false,

    appMatrixAutoScrolled: false,
    appMatrixUserScrolled: false,

    currentChart: null,
    currentTickerRecords: [],
    currentSeriesToKey: new Map(),
    tickerFilters: { grades: new Set(), refines: new Set(), enchants: new Set(), cards: new Set() },

    currentVolumeSeries: null,
    currentChartResizeObserver: null,
    currentSeriesVariants: new Map(),
};
