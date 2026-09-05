const PAGE_CACHE_PREFIX = 'pageCache_';

const PAGE_CACHE_MAX_ENTRIES = 1000;

const PAGE_CACHE_MAX_BLOCKS = 1500;

function computeStringHash(s) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

function currentPageIdentity() {
    try {
        const url = new URL(window.location.href);
        return url.origin + url.pathname + url.search;
    } catch (e) { return ''; }
}

function getPageKeyWithoutLanguage() {
    const identity = currentPageIdentity();
    if (!identity) return null;
    return PAGE_CACHE_PREFIX + computeStringHash(identity);
}

function cacheRecordMatchesCurrentPage(record) {
    const identity = currentPageIdentity();
    if (!identity) return false;
    if (!record || typeof record.url !== 'string' || !record.url) return false;
    try {
        const saved = new URL(record.url);
        return saved.origin + saved.pathname + saved.search === identity;
    } catch (e) { return false; }
}

function getCurrentPageKey(targetLanguage) {
    const base = getPageKeyWithoutLanguage();
    if (!base || !targetLanguage) return null;
    return base + '_' + targetLanguage;
}

function collectCacheableBlocks() {
    return collectBlocksAcrossRoots((node) => {
        if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
        if (node.dataset?.geminiIgnore === 'true') return NodeFilter.FILTER_REJECT;
        return 0;
    });
}

function getBlockOriginalText(block) {
    if (block.dataset?.translationStatus === 'translated' && typeof block.dataset.originalHtml === 'string') {
        const parsed = parseTemplateFragment(block.dataset.originalHtml);
        return ((parsed && parsed.textContent) || '').trim().replace(/\s+/g, ' ');
    }
    return (block.textContent || '').trim().replace(/\s+/g, ' ');
}

function computeBlockTextKey(text) {
    if (!text) return '';
    return computeStringHash(text);
}

function readPageCacheByKey(key) {
    return new Promise(resolve => {
        if (!key) { resolve({ record: null, error: '' }); return; }
        sendRuntimeMessage({ action: 'pageCacheGet', key }, (response, failure) => {
            if (failure) { resolve({ record: null, error: failure }); return; }
            if (!response) { resolve({ record: null, error: 'noResponse' }); return; }
            const error = typeof response.error === 'string' ? response.error : '';
            resolve({ record: error ? null : (response.cache || null), error });
        });
    });
}

function getPageCache(targetLanguage) {
    return readPageCacheByKey(getCurrentPageKey(targetLanguage));
}

function getPageCacheWithoutLanguage() {
    return readPageCacheByKey(getPageKeyWithoutLanguage());
}

function savePageCache(targetLanguage, cache) {
    return new Promise(resolve => {
        const key = getCurrentPageKey(targetLanguage);
        if (!key) { resolve({ saved: false, error: '', quotaExhausted: false }); return; }
        sendRuntimeMessage({ action: 'pageCacheSet', key, cache }, (response, failure) => {
            if (failure) { resolve({ saved: false, error: failure, quotaExhausted: false }); return; }
            if (!response) { resolve({ saved: false, error: 'noResponse', quotaExhausted: false }); return; }
            resolve({
                saved: !!response.saved,
                error: typeof response.error === 'string' ? response.error : '',
                quotaExhausted: response.quotaExhausted === true
            });
        });
    });
}

function clearPageCache(targetLanguage) {
    return new Promise(resolve => {
        const key = getCurrentPageKey(targetLanguage);
        if (!key) { resolve(); return; }
        sendRuntimeMessage({ action: 'pageCacheDelete', key }, () => { resolve(); });
    });
}

function pruneOldCaches() {
    return new Promise(resolve => {
        sendRuntimeMessage({ action: 'pageCachePrune', maxEntries: PAGE_CACHE_MAX_ENTRIES }, () => { resolve(); });
    });
}

function compositeBlockKey(textKey, tagName) {
    return textKey + '|' + (tagName || '');
}

function useSessionMemoForLanguage(targetLanguage) {
    if (!targetLanguage || sessionTranslationMemoLang === targetLanguage) return;
    sessionTranslationMemoLang = targetLanguage;
    sessionTranslationMemo.clear();
}

function rememberTranslatedTemplate(template, translatedTemplate) {
    if (typeof template !== 'string' || !template) return;
    if (typeof translatedTemplate !== 'string' || !translatedTemplate) return;
    if (sessionTranslationMemo.has(template)) sessionTranslationMemo.delete(template);
    sessionTranslationMemo.set(template, translatedTemplate);
    while (sessionTranslationMemo.size > SESSION_MEMO_MAX_ENTRIES) {
        const oldest = sessionTranslationMemo.keys().next();
        if (oldest.done) break;
        sessionTranslationMemo.delete(oldest.value);
    }
}

function recallTranslatedTemplate(template) {
    const remembered = sessionTranslationMemo.get(template);
    return (typeof remembered === 'string' && remembered) ? remembered : null;
}

function usableCacheRecord(record, targetLanguage) {
    if (!record || !Array.isArray(record.blocks)) return null;
    if (record.lang !== targetLanguage) return null;
    if (!cacheRecordMatchesCurrentPage(record)) return null;
    return record;
}

async function resolveCacheForLanguage(targetLanguage) {
    const current = await getPageCache(targetLanguage);
    if (current.error) return current;
    if (usableCacheRecord(current.record, targetLanguage)) return current;
    const withoutLanguage = await getPageCacheWithoutLanguage();
    if (withoutLanguage.error) return withoutLanguage;
    const legacy = usableCacheRecord(withoutLanguage.record, targetLanguage);
    if (!legacy) return { record: null, error: '' };
    savePageCache(targetLanguage, legacy).catch(() => { });
    return withoutLanguage;
}

async function tryRestoreFromCache(targetLanguage) {
    if (!cacheRestoreMap) {
        if (!targetLanguage) return false;
        const resolved = await resolveCacheForLanguage(targetLanguage);
        cacheReadError = resolved.error || '';
        const cache = resolved.record;
        if (!cache) return false;
        useSessionMemoForLanguage(targetLanguage);
        const map = new Map();
        for (const entry of cache.blocks) {
            if (entry && entry.textKey && entry.tagName) {
                map.set(compositeBlockKey(entry.textKey, entry.tagName), entry);
            }
            if (entry) rememberTranslatedTemplate(entry.template, entry.translatedTemplate);
        }
        if (map.size === 0) return false;
        cacheRestoreMap = map;
        cacheRestoreActive = true;
    }
    return cacheRestoreActive;
}

function applyCacheBlock(block, entry) {
    if (!entry || typeof entry.template !== 'string' || typeof entry.translatedTemplate !== 'string') return false;
    if (!entry.template || !entry.translatedTemplate) return false;
    try {
        const tu = buildTU(block);
        if (!tu || !tu.hasTranslatableText) return false;
        if (tu.template !== entry.template) return false;
        if (typeof entry.originalHtml === 'string' && !('originalHtml' in block.dataset)) {
            block.dataset.originalHtml = entry.originalHtml;
        }
        applyTranslation(tu, entry.translatedTemplate, true);
        if (block.dataset?.translationStatus !== 'translated') return false;
        block.dataset.tuTemplate = tu.template;
        return true;
    } catch (e) { return false; }
}

function applyCacheRestore() {
    if (!cacheRestoreMap || cacheRestoreMap.size === 0) {
        cacheRestoreActive = false;
        return 0;
    }
    const currentBlocks = collectCacheableBlocks();
    let applied = 0;
    const consumedTextKeys = new Set();

    for (const block of currentBlocks) {
        if (!block.isConnected) continue;
        if (block.dataset?.translationStatus === 'translated') continue;
        if (block.dataset?.translationStatus === 'processing') continue;
        const text = getBlockOriginalText(block);
        if (!text) continue;
        const textKey = computeBlockTextKey(text);
        const key = compositeBlockKey(textKey, block.tagName);
        const entry = cacheRestoreMap.get(key);
        if (!entry) continue;
        if (applyCacheBlock(block, entry)) {
            cacheRestoreMap.delete(key);
            consumedTextKeys.add(textKey);
            applied++;
        }
    }

    const textKeyOnlyMap = new Map();
    const textKeyConflicts = new Set();
    for (const [mapKey, entry] of cacheRestoreMap) {
        const tk = entry.textKey;
        if (!tk) continue;
        if (consumedTextKeys.has(tk)) continue;
        if (textKeyOnlyMap.has(tk)) {
            textKeyConflicts.add(tk);
        } else {
            textKeyOnlyMap.set(tk, mapKey);
        }
    }
    for (const conflict of textKeyConflicts) {
        textKeyOnlyMap.delete(conflict);
    }

    if (textKeyOnlyMap.size > 0) {
        for (const block of currentBlocks) {
            if (!block.isConnected) continue;
            if (block.dataset?.translationStatus === 'translated') continue;
            if (block.dataset?.translationStatus === 'processing') continue;
            const text = getBlockOriginalText(block);
            if (!text) continue;
            const textKey = computeBlockTextKey(text);
            if (textKeyConflicts.has(textKey)) continue;
            const mapKey = textKeyOnlyMap.get(textKey);
            if (!mapKey) continue;
            const entry = cacheRestoreMap.get(mapKey);
            if (!entry) continue;
            if (applyCacheBlock(block, entry)) {
                cacheRestoreMap.delete(mapKey);
                textKeyOnlyMap.delete(textKey);
                applied++;
            }
        }
    }

    if (cacheRestoreMap.size === 0) {
        cacheRestoreActive = false;
    }
    return applied;
}

function getTranslationUnitTextLength(block) {
    const tu = buildTU(block);
    if (!tu || !tu.hasTranslatableText) return 0;
    let text = '';
    for (const run of tu.textRuns) {
        for (const node of run.nodes) text += node.textContent || '';
    }
    return text.trim().replace(/\s+/g, ' ').length;
}

function measureCacheCoverageScan() {
    const map = (cacheRestoreMap && cacheRestoreMap.size > 0) ? cacheRestoreMap : null;
    let matched = 0, total = 0;
    for (const block of collectCacheableBlocks()) {
        if (!block.isConnected) continue;
        const status = block.dataset?.translationStatus;
        if (status === 'translated' || status === 'processing') continue;
        const unitLength = getTranslationUnitTextLength(block);
        if (unitLength === 0) continue;
        total += unitLength;
        if (!map) continue;
        const text = getBlockOriginalText(block);
        if (!text) continue;
        if (map.has(compositeBlockKey(computeBlockTextKey(text), block.tagName))) matched += unitLength;
    }
    return { matched, total };
}

function measureCacheCoverage() {
    const now = Date.now();
    if (cacheCoverageMemo && cacheCoverageMemo.map === cacheRestoreMap && now - cacheCoverageMemo.ts < POPUP_STATE_MEMO_MS) {
        return cacheCoverageMemo;
    }
    let matched = 0, total = 0;
    let scanError = '';
    try {
        ({ matched, total } = withScanCache(measureCacheCoverageScan));
    } catch (e) {
        matched = 0;
        total = 0;
        scanError = 'coverageScanFailed: ' + ((e && e.message) || String(e));
    }
    cacheCoverageMemo = { ts: now, map: cacheRestoreMap, matched, total, error: cacheReadError || scanError };
    return cacheCoverageMemo;
}

function getStoredTargetLanguage() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get(['targetLanguage'], (items) => {
                if (chrome.runtime.lastError) { resolve(null); return; }
                resolve((items && items.targetLanguage) || 'en');
            });
        } catch (e) { resolve(null); }
    });
}

async function restoreFromCacheOnly() {
    const lang = await getStoredTargetLanguage();
    if (!cacheRestoreMap) { try { await tryRestoreFromCache(lang); } catch (e) { } }
    if (cacheRestoreActive) {
        try { applyCacheRestore(); } catch (e) { }
    }
}

function mergeWithPreviousEntries(previous, entries, lang) {
    if (entries.length >= PAGE_CACHE_MAX_BLOCKS) return entries.slice(0, PAGE_CACHE_MAX_BLOCKS);
    if (!previous || previous.lang !== lang || !Array.isArray(previous.blocks)) return entries;
    const merged = entries.slice();
    const seen = new Set(entries.map(entry => compositeBlockKey(entry.textKey, entry.tagName)));
    for (const entry of previous.blocks) {
        if (merged.length >= PAGE_CACHE_MAX_BLOCKS) break;
        if (!entry || !entry.textKey || !entry.tagName) continue;
        if (!entry.template || !entry.translatedTemplate) continue;
        const composite = compositeBlockKey(entry.textKey, entry.tagName);
        if (seen.has(composite)) continue;
        seen.add(composite);
        merged.push(entry);
    }
    return merged;
}

async function saveCurrentTranslationToCache() {
    const blocks = collectCacheableBlocks();
    if (blocks.length === 0) return;
    const lang = await getStoredTargetLanguage();
    if (!lang) return;
    const entries = [];
    const seen = new Set();
    for (const block of blocks) {
        if (blockTranslationLanguage.get(block) !== lang) continue;
        if (block.dataset?.translationStatus !== 'translated') continue;
        if (typeof block.dataset.translatedHtml !== 'string') continue;
        if (typeof block.dataset.originalHtml !== 'string') continue;
        const template = block.dataset.tuTemplate;
        const translatedTemplate = block.dataset.tuTranslatedTemplate;
        if (!template || !translatedTemplate) continue;
        const text = getBlockOriginalText(block);
        if (!text) continue;
        const textKey = computeBlockTextKey(text);
        const composite = compositeBlockKey(textKey, block.tagName);
        if (seen.has(composite)) continue;
        seen.add(composite);
        entries.push({
            textKey,
            tagName: block.tagName,
            originalHtml: block.dataset.originalHtml,
            translatedHtml: block.dataset.translatedHtml,
            template,
            translatedTemplate
        });
    }
    if (entries.length === 0) return;
    const previous = await resolveCacheForLanguage(lang);
    if (previous.error) return;
    let pageUrl = '';
    try { pageUrl = window.location.href; } catch (e) { }
    const result = await savePageCache(lang, {
        url: pageUrl,
        lang,
        blocks: mergeWithPreviousEntries(previous.record, entries, lang),
        savedAt: Date.now()
    });
    if (result.saved) {
        pruneOldCaches().catch(() => { });
        return;
    }
    showCacheSaveFailureNote(result.quotaExhausted ? st.cacheStorageFull : st.cacheSaveFailed);
}
