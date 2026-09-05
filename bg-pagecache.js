const PAGE_CACHE_DB_NAME = 'translationCache';

const PAGE_CACHE_DB_VERSION = 1;

const PAGE_CACHE_STORE = 'pages';

const PAGE_CACHE_QUOTA_EVICT_RATIO = 0.2;

const PAGE_CACHE_QUOTA_EVICT_ROUNDS = 3;

const PAGE_CACHE_SAMPLE_LIMIT = 24;

const PAGE_CACHE_LIST_PAGE_SIZE = 25;

function openPageCacheDB() {
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = indexedDB.open(PAGE_CACHE_DB_NAME, PAGE_CACHE_DB_VERSION);
        } catch (e) { reject(e); return; }
        req.onupgradeneeded = (event) => {
            try {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(PAGE_CACHE_STORE)) {
                    const store = db.createObjectStore(PAGE_CACHE_STORE, { keyPath: 'key' });
                    store.createIndex('savedAt', 'savedAt', { unique: false });
                }
            } catch (e) { }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IDB open failed'));
        req.onblocked = () => reject(new Error('IDB open blocked'));
    });
}

function awaitTransaction(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = (e) => {
            const err = tx.error || (e && e.target && e.target.error) || new Error('IDB tx aborted');
            reject(err);
        };
        tx.onerror = (e) => {
            const err = tx.error || (e && e.target && e.target.error) || new Error('IDB tx error');
            reject(err);
        };
    });
}

function reqAsPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => {
            try { e.preventDefault(); } catch (err) { }
            reject(req.error || new Error('IDB request failed'));
        };
    });
}

async function pageCacheGet(key) {
    if (!key) return { record: null, found: false, error: '' };
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return { record: null, found: false, error: describeStorageFailure(e) }; }
    try {
        const tx = db.transaction(PAGE_CACHE_STORE, 'readonly');
        const store = tx.objectStore(PAGE_CACHE_STORE);
        let result = null;
        try { result = await reqAsPromise(store.get(key)); }
        catch (e) { return { record: null, found: false, error: describeStorageFailure(e) }; }
        try { await awaitTransaction(tx); } catch (e) { }
        return { record: result || null, found: !!result, error: '' };
    } catch (e) { return { record: null, found: false, error: describeStorageFailure(e) }; }
    finally { try { db.close(); } catch (e) { } }
}

function isQuotaExceededError(e) {
    return !!(e && e.name === 'QuotaExceededError');
}

async function pageCachePutRecord(db, record) {
    const tx = db.transaction(PAGE_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(PAGE_CACHE_STORE);
    await reqAsPromise(store.put(record));
    await awaitTransaction(tx);
}

async function pageCacheSet(key, cache) {
    if (!key || !cache) return { saved: false, error: '', quotaExhausted: false };
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return { saved: false, error: describeStorageFailure(e), quotaExhausted: false }; }
    try {
        const record = { ...cache, key };
        if (!record.savedAt) record.savedAt = Date.now();
        let lastError = '';
        for (let round = 0; round <= PAGE_CACHE_QUOTA_EVICT_ROUNDS; round++) {
            try {
                await pageCachePutRecord(db, record);
                return { saved: true, error: '', quotaExhausted: false };
            } catch (e) {
                lastError = describeStorageFailure(e);
                if (!isQuotaExceededError(e)) return { saved: false, error: lastError, quotaExhausted: false };
            }
            if (round === PAGE_CACHE_QUOTA_EVICT_ROUNDS) break;
            let evicted = 0;
            try { evicted = await pageCacheEvictForQuota(); } catch (e) { }
            if (evicted === 0) break;
        }
        return { saved: false, error: lastError, quotaExhausted: true };
    } catch (e) { return { saved: false, error: describeStorageFailure(e), quotaExhausted: false }; }
    finally { try { db.close(); } catch (e) { } }
}

async function pageCacheDelete(key) {
    if (!key) return { removed: false, error: '' };
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return { removed: false, error: describeStorageFailure(e) }; }
    try {
        const tx = db.transaction(PAGE_CACHE_STORE, 'readwrite');
        const store = tx.objectStore(PAGE_CACHE_STORE);
        try { await reqAsPromise(store.delete(key)); }
        catch (e) { return { removed: false, error: describeStorageFailure(e) }; }
        try { await awaitTransaction(tx); }
        catch (e) { return { removed: false, error: describeStorageFailure(e) }; }
        return { removed: true, error: '' };
    } catch (e) { return { removed: false, error: describeStorageFailure(e) }; }
    finally { try { db.close(); } catch (e) { } }
}

function cleanupLegacyPageCache() {
    try {
        chrome.storage.local.get(['legacyPageCacheCleaned'], (marker) => {
            if (chrome.runtime.lastError) return;
            if (marker && marker.legacyPageCacheCleaned) return;
            chrome.storage.local.get(null, (all) => {
                if (chrome.runtime.lastError || !all) return;
                const oldKeys = Object.keys(all).filter(k => k.startsWith('pageCache_'));
                const finalize = () => chrome.storage.local.set({ legacyPageCacheCleaned: 1 }, () => { void chrome.runtime.lastError; });
                if (oldKeys.length === 0) { finalize(); return; }
                chrome.storage.local.remove(oldKeys, () => { void chrome.runtime.lastError; finalize(); });
            });
        });
    } catch (e) { }
}

async function pageCacheDeleteOldest(db, count) {
    if (!(count > 0)) return 0;
    let deleted = 0;
    let committed = true;
    try {
        const tx = db.transaction(PAGE_CACHE_STORE, 'readwrite');
        const store = tx.objectStore(PAGE_CACHE_STORE);
        const index = store.index('savedAt');
        await new Promise((resolve) => {
            let cursorReq;
            try { cursorReq = index.openCursor(); } catch (e) { resolve(); return; }
            cursorReq.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor || deleted >= count) { resolve(); return; }
                try { cursor.delete(); deleted++; } catch (e) { }
                cursor.continue();
            };
            cursorReq.onerror = (e) => { try { e.preventDefault(); } catch (err) { } resolve(); };
        });
        try { await awaitTransaction(tx); } catch (e) { committed = false; }
    } catch (e) { return 0; }
    return committed ? deleted : 0;
}

async function pageCachePrune(maxEntries) {
    const limit = Math.max(1, Number.isFinite(maxEntries) ? maxEntries : 500);
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return 0; }
    try {
        const total = await pageCacheCountEntries(db);
        return await pageCacheDeleteOldest(db, total - limit);
    } catch (e) { return 0; }
    finally { try { db.close(); } catch (e) { } }
}

async function pageCacheEvictForQuota() {
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return 0; }
    try {
        const total = await pageCacheCountEntries(db);
        if (total <= 0) return 0;
        return await pageCacheDeleteOldest(db, Math.max(1, Math.ceil(total * PAGE_CACHE_QUOTA_EVICT_RATIO)));
    } catch (e) { return 0; }
    finally { try { db.close(); } catch (e) { } }
}

function measureRecordBytes(record) {
    try {
        return new Blob([JSON.stringify(record)]).size;
    } catch (e) { return 0; }
}

async function pageCacheCountEntries(db) {
    const tx = db.transaction(PAGE_CACHE_STORE, 'readonly');
    const store = tx.objectStore(PAGE_CACHE_STORE);
    const total = await reqAsPromise(store.count()) || 0;
    try { await awaitTransaction(tx); } catch (e) { }
    return total;
}

function describeStorageFailure(e) {
    if (!e) return 'unknown';
    const name = e.name || 'Error';
    const message = typeof e.message === 'string' ? e.message : '';
    return message ? `${name}: ${message}`.slice(0, 200) : name;
}

function pageCacheSampleBytes(db) {
    const tx = db.transaction(PAGE_CACHE_STORE, 'readonly');
    const store = tx.objectStore(PAGE_CACHE_STORE);
    return new Promise((resolve) => {
        const sample = { records: 0, bytes: 0, error: '' };
        let cursorReq;
        try { cursorReq = store.openCursor(); } catch (e) { sample.error = describeStorageFailure(e); resolve(sample); return; }
        cursorReq.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor || sample.records >= PAGE_CACHE_SAMPLE_LIMIT) { resolve(sample); return; }
            sample.bytes += measureRecordBytes(cursor.value);
            sample.records++;
            cursor.continue();
        };
        cursorReq.onerror = (e) => {
            try { e.preventDefault(); } catch (err) { }
            sample.error = describeStorageFailure(cursorReq.error);
            resolve(sample);
        };
    });
}

async function pageCacheStats() {
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return { entries: 0, bytes: 0, error: describeStorageFailure(e), bytesError: '' }; }
    let entries = 0;
    let bytes = 0;
    let error = '';
    let bytesError = '';
    try {
        entries = await pageCacheCountEntries(db);
        if (entries > 0) {
            const sample = await pageCacheSampleBytes(db);
            if (sample.error) bytesError = sample.error;
            else if (sample.records > 0) bytes = Math.round(sample.bytes / sample.records * entries);
            else bytesError = 'EmptySample: no record could be measured';
        }
    } catch (e) { error = describeStorageFailure(e); }
    finally { try { db.close(); } catch (e) { } }
    return { entries, bytes, error, bytesError };
}

function pageCacheSummarize(record) {
    return {
        key: record.key,
        url: typeof record.url === 'string' ? record.url : '',
        lang: typeof record.lang === 'string' ? record.lang : '',
        savedAt: Number.isFinite(record.savedAt) ? record.savedAt : 0,
        blocks: Array.isArray(record.blocks) ? record.blocks.length : 0
    };
}

async function pageCacheList(offset, limit) {
    const start = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
    const size = Math.min(PAGE_CACHE_LIST_PAGE_SIZE, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : PAGE_CACHE_LIST_PAGE_SIZE));
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return { pages: [], total: 0, offset: start, error: describeStorageFailure(e) }; }
    let total = 0;
    let error = '';
    const pages = [];
    try {
        total = await pageCacheCountEntries(db);
        if (total > start) {
            const tx = db.transaction(PAGE_CACHE_STORE, 'readonly');
            const store = tx.objectStore(PAGE_CACHE_STORE);
            const index = store.index('savedAt');
            await new Promise((resolve) => {
                let skipped = 0;
                let cursorReq;
                try { cursorReq = index.openCursor(null, 'prev'); } catch (e) { error = describeStorageFailure(e); resolve(); return; }
                cursorReq.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor || pages.length >= size) { resolve(); return; }
                    if (skipped < start) {
                        skipped++;
                        cursor.continue();
                        return;
                    }
                    try { pages.push(pageCacheSummarize(cursor.value)); } catch (e) { }
                    cursor.continue();
                };
                cursorReq.onerror = (e) => {
                    try { e.preventDefault(); } catch (err) { }
                    error = describeStorageFailure(cursorReq.error);
                    resolve();
                };
            });
            try { await awaitTransaction(tx); } catch (e) { }
        }
    } catch (e) { error = describeStorageFailure(e); }
    finally { try { db.close(); } catch (e) { } }
    return { pages, total, offset: start, error };
}

async function pageCacheClearAll() {
    let db;
    try { db = await openPageCacheDB(); } catch (e) { return false; }
    try {
        const tx = db.transaction(PAGE_CACHE_STORE, 'readwrite');
        const store = tx.objectStore(PAGE_CACHE_STORE);
        await reqAsPromise(store.clear());
        await awaitTransaction(tx);
        return true;
    } catch (e) { return false; }
    finally { try { db.close(); } catch (e) { } }
}
