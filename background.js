try {
    chrome.runtime.onMessage.addListener(handleContentScriptMessage);
} catch (e) { }

try {
    chrome.runtime.onMessage.addListener(handleSelectionMessage);
} catch (e) { }

try {
    chrome.runtime.onMessage.addListener(handleExtensionPageMessage);
} catch (e) { }

try {
    importScripts('translations.js');
} catch (e) { }

try {
    importScripts('modelcaps.js');
} catch (e) { }

try {
    importScripts('bg-common.js');
} catch (e) { }

try {
    importScripts('bg-frames.js');
} catch (e) { }

try {
    importScripts('bg-session.js');
} catch (e) { }

try {
    importScripts('bg-menus.js');
} catch (e) { }

try {
    importScripts('bg-usage.js');
} catch (e) { }

try {
    importScripts('bg-pagecache.js');
} catch (e) { }

try {
    importScripts('bg-prompt.js');
} catch (e) { }

try {
    importScripts('bg-translate.js');
} catch (e) { }

try {
    importScripts('bg-stream.js');
} catch (e) { }

try {
    importScripts('bg-providers.js');
} catch (e) { }

try {
    importScripts('bg-selection.js');
} catch (e) { }

try {
    chrome.alarms.create('translator-keepalive', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener(() => { });
} catch (e) { }

try {
    chrome.runtime.onStartup.addListener(function () {
        withSessionLock(async () => {
            try {
                await chrome.storage.session.set({ sessionTabDomains: {}, sessionTranslatedDomains: [] });
            } catch (e) { }
        });
    });
} catch (e) { }

try {
    chrome.runtime.onInstalled.addListener(handleExtensionInstalled);
} catch (e) { }

function handleContentScriptMessage(request, sender, sendResponse) {
    const tabId = sender.tab?.id;
    if (!tabId) return false;

    if (request.action === "translateBatch") {
        const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
        const key = toFrameKey(tabId, frameId);
        let entry = globalRequestQueue.get(key);
        if (!entry) {
            entry = {
                tabId,
                frameId,
                batches: [],
                state: getFrameState(tabId, frameId)
            };
            globalRequestQueue.set(key, entry);
        }
        entry.batches.push({ request, sendResponse });
        dispatchFrame(key);
        return true;
    }

    if (request.action === "startTranslationAllFrames") {
        sendTabMessage(tabId, { action: "startTranslationFromPopup" });
        return false;
    }

    if (request.action === "cancelTranslation") {
        const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
        if (request.allFrames === true) {
            for (const key of frameKeysForTab(tabId)) cancelFrameByKey(key);
            sendTabMessage(tabId, { action: "translationCancelled" });
        } else {
            const key = toFrameKey(tabId, frameId);
            cancelFrameByKey(key);
            sendTabMessage(tabId, { action: "translationCancelled" }, { frameId }, () => {
                frameStates.delete(key);
            });
        }
        return false;
    }

    if (request.action === "openOptionsPage") {
        try { chrome.runtime.openOptionsPage(); } catch (e) { }
        return false;
    }

    if (request.action === "translationError") {
        relayToTopFrame(tabId, sender, {
            action: "subframeTranslationFailed",
            error: request.error,
            code: request.code
        });
        return false;
    }

    if (request.action === "frameTranslationState") {
        relayToTopFrame(tabId, sender, {
            action: "subframeTranslationState",
            translating: request.translating === true
        });
        return false;
    }

    if (request.action === "sessionMarkTranslated") {
        const hostname = topFrameHostname(sender);
        if (hostname) {
            markSessionTranslated(tabId, hostname).catch(() => { });
        }
        sendResponse({ ok: true });
        return false;
    }

    if (request.action === "sessionIsDomainKnown") {
        const hostname = topFrameHostname(sender);
        if (!hostname) { sendResponse({ known: false }); return false; }
        isSessionDomainKnown(hostname).then(known => {
            if (known) {
                markSessionTranslated(tabId, hostname).catch(() => { });
            }
            sendResponse({ known });
        }).catch(() => sendResponse({ known: false }));
        return true;
    }

    if (request.action === "pageCacheGet") {
        pageCacheGet(request.key)
            .then(result => sendResponse({ cache: result.record, found: result.found, error: result.error }))
            .catch(e => sendResponse({ cache: null, found: false, error: describeStorageFailure(e) }));
        return true;
    }

    if (request.action === "pageCacheSet") {
        pageCacheSet(request.key, request.cache)
            .then(result => sendResponse({ saved: result.saved, error: result.error, quotaExhausted: result.quotaExhausted }))
            .catch(e => sendResponse({ saved: false, error: describeStorageFailure(e), quotaExhausted: false }));
        return true;
    }

    if (request.action === "pageCacheDelete") {
        pageCacheDelete(request.key)
            .then(result => sendResponse({ removed: result.removed, error: result.error }))
            .catch(e => sendResponse({ removed: false, error: describeStorageFailure(e) }));
        return true;
    }

    if (request.action === "pageCachePrune") {
        pageCachePrune(request.maxEntries)
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    }

    return false;
}

try {
    chrome.contextMenus.onClicked.addListener(function (info, tab) {
        if (info.menuItemId === "toggleTranslation" && tab?.id) {
            sendTabMessage(tab.id, { action: "toggleTranslation" });
        }
    });
} catch (e) { }

try {
    chrome.tabs.onRemoved.addListener(function (tabId) {
        discardFramesForTab(tabId);
        untrackSessionTab(tabId).catch(() => { });
    });
} catch (e) { }

try {
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
        if (changeInfo.status === 'loading') {
            discardFramesForTab(tabId);
        }
        if (changeInfo.url) {
            handleTabUrlChange(tabId, changeInfo.url).catch(() => { });
        }
    });
} catch (e) { }

try {
    chrome.storage.onChanged.addListener(handleContextMenuSettingsChange);
} catch (e) { }

try {
    chrome.contextMenus.onClicked.addListener(function (info, tab) {
        if (info.menuItemId !== SELECTION_MENU_ID && info.menuItemId !== REPLACE_MENU_ID) return;
        if (!tab?.id) return;
        const text = (info.selectionText || '').trim();
        if (!text) return;
        const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;
        const replaceIntent = info.menuItemId === REPLACE_MENU_ID;
        sendTabMessage(tab.id, { action: "showSelectionTranslation", text, replaceIntent }, { frameId });
    });
} catch (e) { }

function handleSelectionMessage(request, sender, sendResponse) {
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;

    if (request?.action === "translateSelection") {
        runSelectionTranslation(toFrameKey(tabId, frameId), request.text, sendResponse);
        return true;
    }

    if (request?.action === "cancelSelectionTranslation") {
        abortSelectionTranslation(toFrameKey(tabId, frameId));
        return false;
    }

    return false;
}

function workerVersion() {
    try { return chrome.runtime.getManifest().version || ''; } catch (e) { return ''; }
}

function handleExtensionPageMessage(request, sender, sendResponse) {
    if (request.action === "backgroundVersion") {
        sendResponse({ version: workerVersion() });
        return false;
    }

    if (request.action === "usageStatsGet") {
        getUsageStatsSnapshot()
            .then(stats => sendResponse({ stats, error: '', version: workerVersion() }))
            .catch(e => sendResponse({ stats: null, error: describeStorageFailure(e), version: workerVersion() }));
        return true;
    }

    if (request.action === "usageStatsReset") {
        resetUsageStats()
            .then(stats => sendResponse({ ok: true, stats }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (request.action === "pageCacheStats") {
        pageCacheStats()
            .then(stats => sendResponse({ stats, error: '', version: workerVersion() }))
            .catch(e => sendResponse({ stats: null, error: describeStorageFailure(e), version: workerVersion() }));
        return true;
    }

    if (request.action === "pageCacheClearAll") {
        pageCacheClearAll()
            .then(cleared => sendResponse({ cleared }))
            .catch(() => sendResponse({ cleared: false }));
        return true;
    }

    if (request.action === "pageCacheList") {
        pageCacheList(request.offset, request.limit)
            .then(result => sendResponse(Object.assign({ version: workerVersion() }, result)))
            .catch(e => sendResponse({ pages: [], total: 0, offset: 0, error: describeStorageFailure(e), version: workerVersion() }));
        return true;
    }

    if (request.action === "pageCacheRemove") {
        pageCacheDelete(request.key)
            .then(result => sendResponse({ removed: result.removed, error: result.error }))
            .catch(e => sendResponse({ removed: false, error: describeStorageFailure(e) }));
        return true;
    }

    return false;
}
