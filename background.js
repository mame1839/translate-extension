try {
    chrome.runtime.onMessage.addListener(handleContentScriptMessage);
} catch (e) { }

try {
    chrome.runtime.onMessage.addListener(handleSelectionMessage);
} catch (e) { }

try {
    chrome.runtime.onMessage.addListener(handleExtensionPageMessage);
} catch (e) { }

const USAGE_STATS_KEY = 'usageStats';
const USAGE_FLUSH_DELAY_MS = 1500;

const pendingUsage = new Map();
let usageFlushTimer = null;
let usageWriteChain = Promise.resolve();

const PAGE_CACHE_DB_NAME = 'translationCache';
const PAGE_CACHE_DB_VERSION = 1;
const PAGE_CACHE_STORE = 'pages';
const PAGE_CACHE_QUOTA_EVICT_RATIO = 0.2;
const PAGE_CACHE_QUOTA_EVICT_ROUNDS = 3;
const PAGE_CACHE_SAMPLE_LIMIT = 24;
const PAGE_CACHE_LIST_PAGE_SIZE = 25;

try {
    importScripts('translations.js');
} catch (e) { }

try {
    importScripts('modelcaps.js');
} catch (e) { }

try {
    chrome.alarms.create('translator-keepalive', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener(() => { });
} catch (e) { }

const errorMessages = {
    apiKeyNotSet: 'API key is not set. Please configure it in the options page.',
    endpointNotSet: 'Endpoint URL is not set. Please configure it in the options page.',
    modelNotSet: 'Model ID is not set. Please configure it in the options page.',
    jsonParseFailed: 'Failed to parse JSON response from AI.',
    jsonExtractFailed: 'Could not extract JSON from AI response.',
    apiLimitReached: 'API rate limit reached. Please wait and try again.',
    translationCancelled: 'Translation cancelled',
    fetchError: 'Network error or API endpoint unreachable.',
    unknownError: 'An unknown error occurred.',
    maxTokensError: 'API response truncated by token limit. Adjust batch size or max token settings.',
    requestTimeout: 'Request timed out.',
    invalidApiKey: 'Invalid API key. Please check it in the options page.',
    insufficientQuota: 'Insufficient quota. Please check your plan and billing.',
    modelNotFound: 'Specified model not found. Please select a different model in the options page.',
    invalidRequest: 'Invalid request. Please check the extension settings.',
    serverError: 'Server is currently unavailable. Please try again later.',
    emptyResponse: 'Empty response received from AI.',
    contentRefused: 'The AI refused to translate this content.',
    reasoningNotSupported: 'The model rejected the reasoning setting. Please check the extension settings.',
    reasoningTimeout: 'Reasoning ran past the request timeout. Lower the reasoning level or raise the timeout in the extension settings.'
};

const FATAL_TRANSLATION_ERRORS = [
    errorMessages.apiKeyNotSet,
    errorMessages.invalidApiKey,
    errorMessages.endpointNotSet,
    errorMessages.modelNotSet,
    errorMessages.insufficientQuota
];

function isFatalTranslationErrorMessage(message) {
    return typeof message === 'string' && FATAL_TRANSLATION_ERRORS.some(m => message.includes(m));
}

function createTranslationError(code, detail) {
    const baseMessage = errorMessages[code] || errorMessages.unknownError;
    const error = new Error(detail ? `${baseMessage}${detail}` : baseMessage);
    error.translationErrorCode = code;
    return error;
}

function inferTranslationErrorCode(message) {
    if (typeof message !== 'string' || !message) return '';
    for (const [code, text] of Object.entries(errorMessages)) {
        if (message.includes(text)) return code;
    }
    return '';
}

function resolveTranslationErrorCode(error, message) {
    if (typeof error?.translationErrorCode === 'string' && error.translationErrorCode) {
        return error.translationErrorCode;
    }
    return inferTranslationErrorCode(message);
}

const DEFAULTS = Object.freeze({
    apiProvider: 'gemini',
    geminiModel: 'gemini-3.5-flash-lite',
    openaiModel: 'gpt-5.6-luna',
    anthropicModel: 'claude-haiku-4-5-20251001',
    compatibleModel: '',
    geminiReasoning: '',
    openaiReasoning: 'off',
    anthropicReasoning: '',
    compatibleReasoning: '',
    batchSize: 500,
    maxBatchLength: 65535,
    delayBetweenRequests: 10000,
    maxToken: null,
    concurrencyLimit: 10,
    maxRetries: 3,
    timeout: 300
});

const LEGACY_DEFAULT_MAX_TOKEN = 65536;
const MAX_TOKEN_AUTO_SINCE = '7.1.0';
const LEGACY_DEFAULT_TIMEOUT = 180;
const TIMEOUT_RAISED_SINCE = '7.1.0';

const LANGUAGE_LIST = [
    { code: 'en', name: 'English' },       { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'zh-Hant', name: 'Chinese (Traditional)' },
    { code: 'hi', name: 'Hindi' },          { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },         { code: 'ar', name: 'Arabic' },
    { code: 'bn', name: 'Bengali' },        { code: 'ru', name: 'Russian' },
    { code: 'pt', name: 'Portuguese' },     { code: 'ur', name: 'Urdu' },
    { code: 'id', name: 'Indonesian' },     { code: 'de', name: 'German' },
    { code: 'ja', name: 'Japanese' },       { code: 'sw', name: 'Swahili' },
    { code: 'mr', name: 'Marathi' },        { code: 'te', name: 'Telugu' },
    { code: 'tr', name: 'Turkish' },        { code: 'ta', name: 'Tamil' },
    { code: 'vi', name: 'Vietnamese' },     { code: 'ko', name: 'Korean' },
];

const frameStates = new Map();
const globalRequestQueue = new Map();
const processingFrames = new Set();

function toFrameKey(tabId, frameId) {
    return `${tabId}:${Number.isInteger(frameId) ? frameId : 0}`;
}

function getFrameState(tabId, frameId) {
    const key = toFrameKey(tabId, frameId);
    const existing = frameStates.get(key);
    if (existing && !existing.translationCancelled && !existing.abortController.signal.aborted) {
        return existing;
    }
    const state = {
        abortController: new AbortController(),
        translationCancelled: false
    };
    frameStates.set(key, state);
    return state;
}

function cancelFrameByKey(key) {
    const state = frameStates.get(key);
    if (state) {
        state.translationCancelled = true;
        state.abortController.abort();
    }
    const entry = globalRequestQueue.get(key);
    if (entry) {
        entry.batches.forEach(({ sendResponse }) => {
            safeSendResponse(sendResponse, { success: false, cancelled: true, code: 'translationCancelled', error: errorMessages.translationCancelled });
        });
        globalRequestQueue.delete(key);
    }
}

function discardFramesForTab(tabId) {
    for (const key of frameKeysForTab(tabId)) {
        cancelFrameByKey(key);
        frameStates.delete(key);
    }
}

function frameKeysForTab(tabId) {
    const prefix = `${tabId}:`;
    const keys = new Set();
    for (const key of frameStates.keys()) {
        if (key.startsWith(prefix)) keys.add(key);
    }
    for (const key of globalRequestQueue.keys()) {
        if (key.startsWith(prefix)) keys.add(key);
    }
    return keys;
}

try {
    chrome.runtime.onStartup.addListener(function () {
        withSessionLock(async () => {
            try {
                await chrome.storage.session.set({ sessionTabDomains: {}, sessionTranslatedDomains: [] });
            } catch (e) { }
        });
    });
} catch (e) { }

function versionIsBefore(version, reference) {
    const parse = text => String(text || '').split('.').map(part => parseInt(part, 10) || 0);
    const left = parse(version);
    const right = parse(reference);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const a = left[i] || 0;
        const b = right[i] || 0;
        if (a !== b) return a < b;
    }
    return false;
}

function storedMaxTokenIsLegacyDefault(details, items) {
    return details.reason === 'update'
        && items.maxToken === LEGACY_DEFAULT_MAX_TOKEN
        && versionIsBefore(details.previousVersion, MAX_TOKEN_AUTO_SINCE);
}

function storedTimeoutIsLegacyDefault(details, items) {
    return details.reason === 'update'
        && items.timeout === LEGACY_DEFAULT_TIMEOUT
        && versionIsBefore(details.previousVersion, TIMEOUT_RAISED_SINCE);
}

function handleExtensionInstalled(details) {
    if (details.reason === 'install') {
        chrome.runtime.openOptionsPage();
    }
    cleanupLegacyPageCache();
    chrome.storage.local.get(
        ['apiProvider', 'targetLanguage', 'geminiModel', 'openaiModel', 'anthropicModel', 'compatibleModel',
         'batchSize', 'maxBatchLength', 'delayBetweenRequests', 'maxToken', 'concurrencyLimit', 'maxRetries', 'timeout', 'showContextMenu', 'autoRetranslateDomain'],
        function (items) {
            const toSet = {};
            if (!items.apiProvider) toSet.apiProvider = DEFAULTS.apiProvider;
            if (!items.targetLanguage) toSet.targetLanguage = 'en';
            if (!items.geminiModel) toSet.geminiModel = DEFAULTS.geminiModel;
            if (!items.openaiModel) toSet.openaiModel = DEFAULTS.openaiModel;
            if (!items.anthropicModel) toSet.anthropicModel = DEFAULTS.anthropicModel;
            if (items.batchSize === undefined) toSet.batchSize = DEFAULTS.batchSize;
            if (items.maxBatchLength === undefined) toSet.maxBatchLength = DEFAULTS.maxBatchLength;
            if (items.delayBetweenRequests === undefined) toSet.delayBetweenRequests = DEFAULTS.delayBetweenRequests;
            if (storedMaxTokenIsLegacyDefault(details, items)) toSet.maxToken = DEFAULTS.maxToken;
            if (items.concurrencyLimit === undefined) toSet.concurrencyLimit = DEFAULTS.concurrencyLimit;
            if (items.maxRetries === undefined) toSet.maxRetries = DEFAULTS.maxRetries;
            if (items.timeout === undefined || storedTimeoutIsLegacyDefault(details, items)) toSet.timeout = DEFAULTS.timeout;
            if (items.showContextMenu === undefined) toSet.showContextMenu = true;
            if (items.autoRetranslateDomain === undefined) toSet.autoRetranslateDomain = true;
            if (Object.keys(toSet).length > 0) chrome.storage.local.set(toSet);
            chrome.contextMenus.removeAll(() => {
                chrome.contextMenus.create({
                    id: TOGGLE_MENU_ID,
                    title: contextMenuTitle('selMenuToggle', items.targetLanguage),
                    contexts: ["all"],
                    visible: items.showContextMenu !== false
                });
                chrome.contextMenus.create({
                    id: SELECTION_MENU_ID,
                    title: contextMenuTitle('selMenuTranslate', items.targetLanguage),
                    contexts: ["selection"],
                    visible: items.showContextMenu !== false
                });
                chrome.contextMenus.create({
                    id: REPLACE_MENU_ID,
                    title: contextMenuTitle('selMenuReplace', items.targetLanguage),
                    contexts: ["selection"],
                    visible: items.showContextMenu !== false
                });
            });
        }
    );
}

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

function getHostnameFromUrl(url) {
    if (!url) return '';
    try { return new URL(url).hostname; } catch (e) { return ''; }
}

function senderFrameId(sender) {
    return Number.isInteger(sender?.frameId) ? sender.frameId : 0;
}

function topFrameHostname(sender) {
    if (senderFrameId(sender) !== 0) return '';
    return getHostnameFromUrl(sender?.url || sender?.tab?.url);
}

function relayToTopFrame(tabId, sender, message) {
    const frameId = senderFrameId(sender);
    if (frameId === 0) return;
    sendTabMessage(tabId, Object.assign({ frameId }, message), { frameId: 0 });
}

let sessionMutex = Promise.resolve();
function withSessionLock(fn) {
    const run = sessionMutex.then(() => fn().catch(() => { }));
    sessionMutex = run.catch(() => { });
    return run;
}

function markSessionTranslated(tabId, hostname) {
    return withSessionLock(async () => {
        const { sessionTabDomains = {}, sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTabDomains', 'sessionTranslatedDomains']);
        const oldHostname = sessionTabDomains[tabId];
        let mutated = false;
        if (oldHostname !== hostname) {
            sessionTabDomains[tabId] = hostname;
            mutated = true;
            if (oldHostname) {
                const stillUsed = Object.values(sessionTabDomains).includes(oldHostname);
                if (!stillUsed) {
                    const idx = sessionTranslatedDomains.indexOf(oldHostname);
                    if (idx >= 0) sessionTranslatedDomains.splice(idx, 1);
                }
            }
        }
        if (!sessionTranslatedDomains.includes(hostname)) {
            sessionTranslatedDomains.push(hostname);
            mutated = true;
        }
        if (mutated) {
            await chrome.storage.session.set({ sessionTabDomains, sessionTranslatedDomains });
        }
    });
}

async function isSessionDomainKnown(hostname) {
    const { sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTranslatedDomains']);
    return Array.isArray(sessionTranslatedDomains) && sessionTranslatedDomains.includes(hostname);
}

function untrackSessionTab(tabId) {
    return withSessionLock(async () => {
        const { sessionTabDomains = {}, sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTabDomains', 'sessionTranslatedDomains']);
        if (!(tabId in sessionTabDomains)) return;
        const hostname = sessionTabDomains[tabId];
        delete sessionTabDomains[tabId];
        let removedHostname = false;
        if (hostname) {
            const stillUsed = Object.values(sessionTabDomains).includes(hostname);
            if (!stillUsed) {
                const idx = sessionTranslatedDomains.indexOf(hostname);
                if (idx >= 0) {
                    sessionTranslatedDomains.splice(idx, 1);
                    removedHostname = true;
                }
            }
        }
        await chrome.storage.session.set({
            sessionTabDomains,
            ...(removedHostname ? { sessionTranslatedDomains } : {})
        });
    });
}

function handleTabUrlChange(tabId, newUrl) {
    return withSessionLock(async () => {
        const newHostname = getHostnameFromUrl(newUrl);
        const { sessionTabDomains = {}, sessionTranslatedDomains = [] } = await chrome.storage.session.get(['sessionTabDomains', 'sessionTranslatedDomains']);
        const oldHostname = sessionTabDomains[tabId];
        if (oldHostname === newHostname) return;
        if (!oldHostname) return;
        if (newHostname) {
            sessionTabDomains[tabId] = newHostname;
        } else {
            delete sessionTabDomains[tabId];
        }
        const stillUsed = Object.values(sessionTabDomains).includes(oldHostname);
        let updates = { sessionTabDomains };
        if (!stillUsed) {
            const idx = sessionTranslatedDomains.indexOf(oldHostname);
            if (idx >= 0) {
                sessionTranslatedDomains.splice(idx, 1);
                updates.sessionTranslatedDomains = sessionTranslatedDomains;
            }
        }
        await chrome.storage.session.set(updates);
    });
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

function dispatchFrame(key) {
    if (processingFrames.has(key)) return;
    const entry = globalRequestQueue.get(key);
    if (!entry) return;
    globalRequestQueue.delete(key);
    processingFrames.add(key);
    processFrame(entry)
        .catch(error => {
            console.error(`Error processing frame ${key}:`, error);
        })
        .finally(() => {
            processingFrames.delete(key);
            dispatchFrame(key);
        });
}

async function processFrame(entry) {
    const { tabId, frameId, batches, state } = entry;
    const { concurrencyLimit, delayBetweenRequests, streamingTranslation } = await new Promise(resolve =>
        chrome.storage.local.get(['concurrencyLimit', 'delayBetweenRequests', 'streamingTranslation'], resolve));
    const concLimit = Math.max(1, concurrencyLimit || DEFAULTS.concurrencyLimit);
    const delayMs = Math.max(0, delayBetweenRequests ?? DEFAULTS.delayBetweenRequests);
    const streamingEnabled = streamingTranslation === true;

    if (!batches || batches.length === 0) return;

    let activeRequests = 0;
    let batchIndex = 0;
    let nextFireTime = Date.now();

    return new Promise(resolve => {
        const tryLaunch = () => {
            if (state.translationCancelled || state.abortController.signal.aborted) {
                while (batchIndex < batches.length) {
                    const { sendResponse } = batches[batchIndex];
                    batchIndex++;
                    safeSendResponse(sendResponse, { success: false, cancelled: true, code: 'translationCancelled', error: errorMessages.translationCancelled });
                }
                if (activeRequests === 0) resolve();
                return;
            }
            while (batchIndex < batches.length && activeRequests < concLimit) {
                const { request, sendResponse } = batches[batchIndex];
                batchIndex++;
                activeRequests++;
                const myFireTime = Math.max(Date.now(), nextFireTime);
                nextFireTime = myFireTime + delayMs;
                (async () => {
                    try {
                        const waitMs = myFireTime - Date.now();
                        if (waitMs > 0) await sleep(waitMs, state.abortController.signal);
                        if (state.abortController.signal.aborted) throw createAbortError();
                        const streamContext = (streamingEnabled && request.batchId)
                            ? { tabId, frameId, batchId: request.batchId }
                            : null;
                        const translations = await translateTextBatch(request.batch, state.abortController.signal, streamContext);
                        safeSendResponse(sendResponse, { success: true, translations });
                    } catch (error) {
                        if (error?.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
                            nextFireTime = Math.max(nextFireTime, Date.now() + error.retryAfterMs);
                        }
                        const message = error?.message || errorMessages.unknownError;
                        safeSendResponse(sendResponse, {
                            success: false,
                            cancelled: error?.name === 'AbortError',
                            fatal: isFatalTranslationErrorMessage(message),
                            code: resolveTranslationErrorCode(error, message),
                            error: message
                        });
                    } finally {
                        activeRequests--;
                        if (batchIndex >= batches.length && activeRequests === 0) {
                            resolve();
                        } else {
                            tryLaunch();
                        }
                    }
                })();
            }
        };
        tryLaunch();
    });
}

function safeSendResponse(sendResponse, responseData) {
    try {
        if (sendResponse) sendResponse(responseData);
    } catch (e) { }
}

function createAbortError() {
    const error = createTranslationError('translationCancelled');
    error.name = 'AbortError';
    return error;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(createAbortError());
        const timeoutId = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                reject(createAbortError());
            }, { once: true });
        }
    });
}

function createTimeoutError(reasoningLevel, timeoutSeconds) {
    if (reasoningLevel && reasoningLevel !== 'off') {
        return createTranslationError('reasoningTimeout', ` (${reasoningLevel}, ${timeoutSeconds} s)`);
    }
    return createTranslationError('requestTimeout');
}

async function fetchJsonWithTimeout(resource, options = {}, timeout, reasoningLevel = '') {
    const controller = new AbortController();
    const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout * 1000) : null;
    const externalSignal = options.signal;
    options.signal = combineSignals(externalSignal, controller.signal);
    try {
        const response = await fetch(resource, options);
        let data = null;
        try {
            data = await response.json();
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            data = null;
        }
        return { response, data };
    } catch (error) {
        if (error.name === 'AbortError') {
            if (externalSignal?.aborted && !controller.signal.aborted) {
                throw createAbortError();
            }
            throw createTimeoutError(reasoningLevel, timeout);
        }
        throw createTranslationError('fetchError', `: ${error.message}`);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function combineSignals(...signals) {
    const controller = new AbortController();
    const onAbort = () => {
        controller.abort();
        signals.forEach(signal => signal?.removeEventListener?.('abort', onAbort));
    };
    for (const signal of signals.filter(s => s)) {
        if (signal.aborted) {
            controller.abort();
            break;
        }
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return controller.signal;
}

async function translateTextBatch(fragmentBatch, signal, streamContext = null) {
    if (signal?.aborted) throw createAbortError();
    if (!fragmentBatch || fragmentBatch.length === 0) return [];

    const { maxRetries, apiProvider, targetLanguage } = await new Promise(resolve =>
        chrome.storage.local.get(['maxRetries', 'apiProvider', 'targetLanguage'], resolve));

    const payload = {};
    const idByKey = new Map();
    fragmentBatch.forEach((tu, index) => {
        const key = `TU_${index}`;
        payload[key] = tu.template;
        idByKey.set(key, tu.id);
    });
    if (streamContext) streamContext.keys = new Set(idByKey.keys());

    const provider = (apiProvider || DEFAULTS.apiProvider).trim();
    const retryLimit = maxRetries ?? DEFAULTS.maxRetries;
    const langCode = (targetLanguage || 'en').trim();
    const langEntry = LANGUAGE_LIST.find(l => l.code === langCode);
    const langName = langEntry ? langEntry.name : 'English';

    const jsonText = JSON.stringify(payload, null, 2);

    let translatedData;
    if (provider === 'openai') {
        translatedData = await translateWithOpenAI(jsonText, retryLimit, signal, langName, langCode, streamContext);
    } else if (provider === 'anthropic') {
        translatedData = await translateWithAnthropic(jsonText, retryLimit, signal, langName, langCode, streamContext);
    } else if (provider === 'openai-compatible') {
        translatedData = await translateWithOpenAICompatible(jsonText, retryLimit, signal, langName, langCode, streamContext);
    } else {
        translatedData = await translateWithGemini(jsonText, retryLimit, signal, langName, langCode, streamContext);
    }

    const translations = [];
    fragmentBatch.forEach((tu, index) => {
        const key = `TU_${index}`;
        const translated = translatedData[key];
        if (typeof translated === 'string') {
            translations.push({ id: tu.id, translatedTemplate: translated });
        }
    });
    return translations;
}

function parseTranslationResponse(responseText) {
    try {
        return extractJson(responseText);
    } catch (e) {
        throw createTranslationError('jsonParseFailed', ` ${e.message}\nResponse: ${(responseText || '').substring(0, 200)}`);
    }
}

function extractJson(responseText) {
    let cleaned = (responseText || '').trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) { }

    const balanced = extractFirstBalancedObject(cleaned);
    if (balanced) {
        try {
            return JSON.parse(balanced);
        } catch (e) { }
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    let candidate = balanced || cleaned;
    if (!balanced && firstBrace >= 0 && lastBrace > firstBrace) {
        candidate = cleaned.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch (e) { }
    }

    const controlEscaped = escapeControlCharsInJsonStrings(candidate);
    try {
        return JSON.parse(controlEscaped);
    } catch (e) { }

    const partial = extractEntriesByRegex(controlEscaped);
    if (Object.keys(partial).length > 0) return partial;

    throw createTranslationError('jsonExtractFailed');
}

function escapeControlCharsInJsonStrings(text) {
    let result = '';
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (escapeNext) { result += c; escapeNext = false; continue; }
        if (c === '\\' && inString) { result += c; escapeNext = true; continue; }
        if (c === '"') { result += c; inString = !inString; continue; }
        if (inString && c.charCodeAt(0) < 0x20) {
            if (c === '\n') result += '\\n';
            else if (c === '\r') result += '\\r';
            else if (c === '\t') result += '\\t';
            else if (c === '\b') result += '\\b';
            else if (c === '\f') result += '\\f';
            else result += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
            continue;
        }
        result += c;
    }
    return result;
}

function extractFirstBalancedObject(text) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (c === '\\') { escapeNext = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null;
}

function extractEntriesByRegex(text) {
    const result = {};
    const re = /"(TU_\d+)"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"TU_\d+"\s*:\s*"|\}\s*$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const key = m[1];
        const rawValue = m[2];
        result[key] = unescapeJsonString(rawValue);
    }
    return result;
}

function unescapeJsonString(value) {
    try {
        return JSON.parse('"' + value + '"');
    } catch (e) { }
    try {
        let repaired = '';
        let prevBackslashes = 0;
        for (let i = 0; i < value.length; i++) {
            const c = value[i];
            if (c === '\\') {
                repaired += c;
                prevBackslashes++;
                continue;
            }
            if (c === '"' && prevBackslashes % 2 === 0) {
                repaired += '\\"';
            } else {
                repaired += c;
            }
            prevBackslashes = 0;
        }
        return JSON.parse('"' + repaired + '"');
    } catch (e) { }
    return value;
}

async function performTranslation(apiCall, retryLimit, signal) {
    let lastError = null;
    for (let attempt = 0; attempt <= retryLimit; attempt++) {
        if (signal?.aborted) throw createAbortError();
        try {
            return await apiCall();
        } catch (error) {
            lastError = error;
            const noRetryErrors = [
                errorMessages.invalidApiKey,
                errorMessages.modelNotFound,
                errorMessages.invalidRequest,
                errorMessages.maxTokensError,
                errorMessages.insufficientQuota,
                errorMessages.contentRefused,
                errorMessages.reasoningNotSupported,
                errorMessages.reasoningTimeout,
                errorMessages.translationCancelled
            ];
            const msg = error?.message || '';
            if (noRetryErrors.some(m => msg.includes(m))) break;
            if (msg.includes('HTTP Error 4') && !msg.includes('429')) break;
            if (attempt < retryLimit) {
                const isRateLimit = msg.includes(errorMessages.apiLimitReached);
                let backoff;
                if (error?.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
                    backoff = Math.min(120000, error.retryAfterMs + Math.random() * 500);
                } else if (isRateLimit) {
                    backoff = Math.min(120000, (attempt + 1) * 15000 + Math.random() * 3000);
                } else {
                    backoff = Math.min(60000, Math.pow(2, attempt) * 2000 + Math.random() * 1500);
                }
                await sleep(backoff, signal);
            }
        }
    }
    throw lastError;
}

const PROMPT_EXAMPLE_OUTPUTS = {
    en: {
        anchorWithPreposition: '<t0><a1>Siverek</a1></t0> and <t2><a3>Onikişubat</a3></t2> shootings leave 12 dead.',
        anchorAtSentenceStart: 'Click <a0>here</a0> to see <t1>our products</t1>.',
        inlineLinks: 'Read our <a0>Terms</a0> and <a1>Privacy Policy</a1>.',
        nestedEmphasisAnchor: 'See the <t0>official <a1>documentation</a1></t0>.',
        disappearingArticle: 'Read <t0></t0><t1>the guide</t1>.',
        blockAndSkipPlaceholders: 'Overview <b0></b0> See the <s1></s1> icon.'
    },
    zh: {
        anchorWithPreposition: '<t0><a1>锡韦雷克</a1></t0>和<t2><a3>奥尼基舒巴特</a3></t2>的枪击事件造成12人死亡。',
        anchorAtSentenceStart: '点击<a0>此处</a0>查看<t1>我们的产品</t1>。',
        inlineLinks: '请阅读我们的<a0>服务条款</a0>和<a1>隐私政策</a1>。',
        nestedEmphasisAnchor: '请参阅<t0>官方<a1>文档</a1></t0>。',
        disappearingArticle: '请阅读<t0></t0><t1>指南</t1>。',
        blockAndSkipPlaceholders: '概述 <b0></b0> 参见<s1></s1>图标。'
    },
    'zh-Hant': {
        anchorWithPreposition: '<t0><a1>錫韋雷克</a1></t0>和<t2><a3>奧尼基舒巴特</a3></t2>的槍擊事件造成12人死亡。',
        anchorAtSentenceStart: '點擊<a0>這裡</a0>查看<t1>我們的產品</t1>。',
        inlineLinks: '請閱讀我們的<a0>服務條款</a0>和<a1>隱私權政策</a1>。',
        nestedEmphasisAnchor: '請參閱<t0>官方<a1>文件</a1></t0>。',
        disappearingArticle: '請閱讀<t0></t0><t1>指南</t1>。',
        blockAndSkipPlaceholders: '概覽 <b0></b0> 請參閱<s1></s1>圖示。'
    },
    hi: {
        anchorWithPreposition: '<t0><a1>सिवेरेक</a1></t0> और <t2><a3>ओनिकिशुबात</a3></t2> में गोलीबारी से 12 लोगों की मौत।',
        anchorAtSentenceStart: '<t1>हमारे उत्पाद</t1> देखने के लिए <a0>यहाँ</a0> क्लिक करें।',
        inlineLinks: 'कृपया हमारी <a0>शर्तें</a0> और <a1>गोपनीयता नीति</a1> पढ़ें।',
        nestedEmphasisAnchor: '<t0>आधिकारिक <a1>दस्तावेज़</a1></t0> देखें।',
        disappearingArticle: '<t0></t0><t1>गाइड</t1> पढ़ें।',
        blockAndSkipPlaceholders: 'अवलोकन <b0></b0> <s1></s1> आइकन देखें।'
    },
    es: {
        anchorWithPreposition: 'Tiroteos en <t0><a1>Siverek</a1></t0> y en <t2><a3>Onikişubat</a3></t2> dejan 12 muertos.',
        anchorAtSentenceStart: 'Haga clic <a0>aquí</a0> para ver <t1>nuestros productos</t1>.',
        inlineLinks: 'Lea nuestros <a0>Términos</a0> y nuestra <a1>Política de privacidad</a1>.',
        nestedEmphasisAnchor: 'Consulte la <t0><a1>documentación</a1> oficial</t0>.',
        disappearingArticle: 'Lea <t0></t0><t1>la guía</t1>.',
        blockAndSkipPlaceholders: 'Resumen <b0></b0> Vea el icono <s1></s1>.'
    },
    fr: {
        anchorWithPreposition: 'Des fusillades à <t0><a1>Siverek</a1></t0> et à <t2><a3>Onikişubat</a3></t2> font 12 morts.',
        anchorAtSentenceStart: 'Cliquez <a0>ici</a0> pour voir <t1>nos produits</t1>.',
        inlineLinks: 'Lisez nos <a0>Conditions</a0> et notre <a1>Politique de confidentialité</a1>.',
        nestedEmphasisAnchor: 'Consultez la <t0><a1>documentation</a1> officielle</t0>.',
        disappearingArticle: 'Lisez <t0></t0><t1>le guide</t1>.',
        blockAndSkipPlaceholders: 'Aperçu <b0></b0> Voir l\'icône <s1></s1>.'
    },
    ar: {
        anchorWithPreposition: 'إطلاق نار في <t0><a1>سيفيريك</a1></t0> و<t2><a3>أونيكيشوبات</a3></t2> يسفر عن مقتل 12 شخصًا.',
        anchorAtSentenceStart: 'انقر <a0>هنا</a0> لعرض <t1>منتجاتنا</t1>.',
        inlineLinks: 'يرجى قراءة <a0>الشروط</a0> و<a1>سياسة الخصوصية</a1>.',
        nestedEmphasisAnchor: 'راجع <t0><a1>الوثائق</a1> الرسمية</t0>.',
        disappearingArticle: 'اقرأ <t0></t0><t1>الدليل</t1>.',
        blockAndSkipPlaceholders: 'نظرة عامة <b0></b0> راجع أيقونة <s1></s1>.'
    },
    bn: {
        anchorWithPreposition: '<t0><a1>সিভেরেক</a1></t0> এবং <t2><a3>ওনিকিশুবাত</a3></t2>-এ গুলিবর্ষণে 12 জন নিহত।',
        anchorAtSentenceStart: '<t1>আমাদের পণ্য</t1> দেখতে <a0>এখানে</a0> ক্লিক করুন।',
        inlineLinks: 'অনুগ্রহ করে আমাদের <a0>শর্তাবলী</a0> এবং <a1>গোপনীয়তা নীতি</a1> পড়ুন।',
        nestedEmphasisAnchor: '<t0>অফিসিয়াল <a1>ডকুমেন্টেশন</a1></t0> দেখুন।',
        disappearingArticle: '<t0></t0><t1>গাইড</t1> পড়ুন।',
        blockAndSkipPlaceholders: 'সংক্ষিপ্ত বিবরণ <b0></b0> <s1></s1> আইকন দেখুন।'
    },
    ru: {
        anchorWithPreposition: 'Перестрелки в <t0><a1>Сивереке</a1></t0> и <t2><a3>Оникишубате</a3></t2> унесли жизни 12 человек.',
        anchorAtSentenceStart: 'Нажмите <a0>здесь</a0>, чтобы посмотреть <t1>наши продукты</t1>.',
        inlineLinks: 'Ознакомьтесь с нашими <a0>Условиями</a0> и <a1>Политикой конфиденциальности</a1>.',
        nestedEmphasisAnchor: 'См. <t0>официальную <a1>документацию</a1></t0>.',
        disappearingArticle: 'Прочитайте <t0></t0><t1>руководство</t1>.',
        blockAndSkipPlaceholders: 'Обзор <b0></b0> См. значок <s1></s1>.'
    },
    pt: {
        anchorWithPreposition: 'Tiroteios em <t0><a1>Siverek</a1></t0> e em <t2><a3>Onikişubat</a3></t2> deixam 12 mortos.',
        anchorAtSentenceStart: 'Clique <a0>aqui</a0> para ver <t1>nossos produtos</t1>.',
        inlineLinks: 'Leia nossos <a0>Termos</a0> e nossa <a1>Política de Privacidade</a1>.',
        nestedEmphasisAnchor: 'Consulte a <t0><a1>documentação</a1> oficial</t0>.',
        disappearingArticle: 'Leia <t0></t0><t1>o guia</t1>.',
        blockAndSkipPlaceholders: 'Visão geral <b0></b0> Veja o ícone <s1></s1>.'
    },
    ur: {
        anchorWithPreposition: '<t0><a1>سیوریک</a1></t0> اور <t2><a3>اونیکی شوبات</a3></t2> میں فائرنگ سے 12 افراد ہلاک۔',
        anchorAtSentenceStart: '<t1>ہماری مصنوعات</t1> دیکھنے کے لیے <a0>یہاں</a0> کلک کریں۔',
        inlineLinks: 'براہ کرم ہماری <a0>شرائط</a0> اور <a1>رازداری کی پالیسی</a1> پڑھیں۔',
        nestedEmphasisAnchor: '<t0>رسمی <a1>دستاویزات</a1></t0> دیکھیں۔',
        disappearingArticle: '<t0></t0><t1>گائیڈ</t1> پڑھیں۔',
        blockAndSkipPlaceholders: 'جائزہ <b0></b0> <s1></s1> آئیکن دیکھیں۔'
    },
    id: {
        anchorWithPreposition: 'Penembakan di <t0><a1>Siverek</a1></t0> dan di <t2><a3>Onikişubat</a3></t2> menewaskan 12 orang.',
        anchorAtSentenceStart: 'Klik <a0>di sini</a0> untuk melihat <t1>produk kami</t1>.',
        inlineLinks: 'Harap baca <a0>Ketentuan</a0> dan <a1>Kebijakan Privasi</a1> kami.',
        nestedEmphasisAnchor: 'Lihat <t0><a1>dokumentasi</a1> resmi</t0>.',
        disappearingArticle: 'Baca <t0></t0><t1>panduan</t1>.',
        blockAndSkipPlaceholders: 'Ikhtisar <b0></b0> Lihat ikon <s1></s1>.'
    },
    de: {
        anchorWithPreposition: 'Schießereien in <t0><a1>Siverek</a1></t0> und <t2><a3>Onikişubat</a3></t2> fordern 12 Todesopfer.',
        anchorAtSentenceStart: 'Klicken Sie <a0>hier</a0>, um <t1>unsere Produkte</t1> zu sehen.',
        inlineLinks: 'Bitte lesen Sie unsere <a0>Nutzungsbedingungen</a0> und unsere <a1>Datenschutzerklärung</a1>.',
        nestedEmphasisAnchor: 'Siehe die <t0>offizielle <a1>Dokumentation</a1></t0>.',
        disappearingArticle: 'Lesen Sie <t0></t0><t1>den Leitfaden</t1>.',
        blockAndSkipPlaceholders: 'Überblick <b0></b0> Siehe das <s1></s1>-Symbol.'
    },
    ja: {
        anchorWithPreposition: '<t0><a1>シヴェレク</a1></t0>と<t2><a3>オニキシュバト</a3></t2>での銃撃事件で12人が死亡。',
        anchorAtSentenceStart: '<t1>製品</t1>を見るには<a0>こちら</a0>をクリック。',
        inlineLinks: '<a0>利用規約</a0>と<a1>プライバシーポリシー</a1>をお読みください。',
        nestedEmphasisAnchor: '<t0>公式<a1>ドキュメント</a1></t0>を参照。',
        disappearingArticle: '<t0></t0><t1>ガイド</t1>をお読みください。',
        blockAndSkipPlaceholders: '概要 <b0></b0> <s1></s1>アイコンを参照。'
    },
    sw: {
        anchorWithPreposition: 'Watu 12 wameuawa katika milio ya risasi huko <t0><a1>Siverek</a1></t0> na <t2><a3>Onikişubat</a3></t2>.',
        anchorAtSentenceStart: 'Bofya <a0>hapa</a0> ili kuona <t1>bidhaa zetu</t1>.',
        inlineLinks: 'Tafadhali soma <a0>Masharti</a0> yetu na <a1>Sera ya Faragha</a1>.',
        nestedEmphasisAnchor: 'Tazama <t0><a1>nyaraka</a1> rasmi</t0>.',
        disappearingArticle: 'Soma <t0></t0><t1>mwongozo</t1>.',
        blockAndSkipPlaceholders: 'Muhtasari <b0></b0> Tazama ikoni <s1></s1>.'
    },
    mr: {
        anchorWithPreposition: '<t0><a1>सिवेरेक</a1></t0> आणि <t2><a3>ओनिकिशुबात</a3></t2> येथील गोळीबारात 12 जणांचा मृत्यू.',
        anchorAtSentenceStart: '<t1>आमची उत्पादने</t1> पाहण्यासाठी <a0>येथे</a0> क्लिक करा.',
        inlineLinks: 'कृपया आमच्या <a0>अटी</a0> आणि <a1>गोपनीयता धोरण</a1> वाचा.',
        nestedEmphasisAnchor: '<t0>अधिकृत <a1>दस्तऐवज</a1></t0> पहा.',
        disappearingArticle: '<t0></t0><t1>मार्गदर्शिका</t1> वाचा.',
        blockAndSkipPlaceholders: 'आढावा <b0></b0> <s1></s1> आयकॉन पहा.'
    },
    te: {
        anchorWithPreposition: '<t0><a1>సివెరెక్</a1></t0> మరియు <t2><a3>ఒనికిషుబాత్</a3></t2>లలో జరిగిన కాల్పుల్లో 12 మంది మరణించారు.',
        anchorAtSentenceStart: '<t1>మా ఉత్పత్తులను</t1> చూడటానికి <a0>ఇక్కడ</a0> క్లిక్ చేయండి.',
        inlineLinks: 'దయచేసి మా <a0>నియమాలను</a0> మరియు <a1>గోప్యతా విధానాన్ని</a1> చదవండి.',
        nestedEmphasisAnchor: '<t0>అధికారిక <a1>డాక్యుమెంటేషన్</a1></t0> చూడండి.',
        disappearingArticle: '<t0></t0><t1>గైడ్</t1> చదవండి.',
        blockAndSkipPlaceholders: 'అవలోకనం <b0></b0> <s1></s1> చిహ్నాన్ని చూడండి.'
    },
    tr: {
        anchorWithPreposition: '<t0><a1>Siverek</a1></t0> ve <t2><a3>Onikişubat</a3></t2>\'taki silahlı saldırılarda 12 kişi hayatını kaybetti.',
        anchorAtSentenceStart: '<t1>Ürünlerimizi</t1> görmek için <a0>buraya</a0> tıklayın.',
        inlineLinks: 'Lütfen <a0>Şartlarımızı</a0> ve <a1>Gizlilik Politikamızı</a1> okuyun.',
        nestedEmphasisAnchor: '<t0>Resmi <a1>belgelere</a1></t0> bakın.',
        disappearingArticle: '<t0></t0><t1>Kılavuzu</t1> okuyun.',
        blockAndSkipPlaceholders: 'Genel bakış <b0></b0> <s1></s1> simgesine bakın.'
    },
    ta: {
        anchorWithPreposition: '<t0><a1>சிவெரெக்</a1></t0> மற்றும் <t2><a3>ஒனிகிஷுபாத்</a3></t2> ஆகிய இடங்களில் நடந்த துப்பாக்கிச் சூட்டில் 12 பேர் உயிரிழந்தனர்.',
        anchorAtSentenceStart: '<t1>எங்கள் தயாரிப்புகளை</t1> பார்க்க <a0>இங்கே</a0> கிளிக் செய்யவும்.',
        inlineLinks: 'எங்கள் <a0>விதிமுறைகள்</a0> மற்றும் <a1>தனியுரிமைக் கொள்கை</a1> ஆகியவற்றைப் படிக்கவும்.',
        nestedEmphasisAnchor: '<t0>அதிகாரப்பூர்வ <a1>ஆவணங்களை</a1></t0> பார்க்கவும்.',
        disappearingArticle: '<t0></t0><t1>வழிகாட்டியைப்</t1> படிக்கவும்.',
        blockAndSkipPlaceholders: 'மேலோட்டம் <b0></b0> <s1></s1> ஐகானைப் பார்க்கவும்.'
    },
    vi: {
        anchorWithPreposition: 'Các vụ xả súng ở <t0><a1>Siverek</a1></t0> và <t2><a3>Onikişubat</a3></t2> khiến 12 người thiệt mạng.',
        anchorAtSentenceStart: 'Nhấp <a0>vào đây</a0> để xem <t1>sản phẩm của chúng tôi</t1>.',
        inlineLinks: 'Vui lòng đọc <a0>Điều khoản</a0> và <a1>Chính sách quyền riêng tư</a1> của chúng tôi.',
        nestedEmphasisAnchor: 'Xem <t0><a1>tài liệu</a1> chính thức</t0>.',
        disappearingArticle: 'Đọc <t0></t0><t1>hướng dẫn</t1>.',
        blockAndSkipPlaceholders: 'Tổng quan <b0></b0> Xem biểu tượng <s1></s1>.'
    },
    ko: {
        anchorWithPreposition: '<t0><a1>시베레크</a1></t0>와 <t2><a3>오니키슈바트</a3></t2>에서 발생한 총격으로 12명이 사망했다.',
        anchorAtSentenceStart: '<t1>제품</t1>을 보려면 <a0>여기</a0>를 클릭하세요.',
        inlineLinks: '<a0>이용약관</a0>과 <a1>개인정보처리방침</a1>을 읽어 주세요.',
        nestedEmphasisAnchor: '<t0>공식 <a1>문서</a1></t0>를 참조하세요.',
        disappearingArticle: '<t0></t0><t1>가이드</t1>를 읽어 주세요.',
        blockAndSkipPlaceholders: '개요 <b0></b0> <s1></s1> 아이콘을 참조하세요.'
    }
};

const STYLE_PROMPT_LINES = Object.freeze({
    formal: '- Regardless of the source register, write the translation in a consistently polite, formal register suitable for business and official documents.',
    casual: '- Regardless of the source register, write the translation in a relaxed, friendly, conversational register.',
    technical: '- Regardless of the source register, write the translation in precise, concise technical-documentation style with consistent terminology.'
});

function parseGlossaryPairs(glossaryText) {
    const pairs = new Map();
    if (typeof glossaryText !== 'string') return pairs;
    for (const line of glossaryText.split(/\r?\n/)) {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex < 0) continue;
        const source = line.slice(0, separatorIndex).trim();
        const target = line.slice(separatorIndex + 1).trim();
        if (source && target) pairs.set(source, target);
    }
    return pairs;
}

function buildGlossarySection(glossaryText) {
    const pairs = parseGlossaryPairs(glossaryText);
    if (pairs.size === 0) return '';
    const entryLines = [];
    for (const [source, target] of pairs) {
        entryLines.push(source === target
            ? `- "${source}" → keep "${source}" untranslated`
            : `- "${source}" → "${target}"`);
    }
    return `## Glossary (must follow)\nWhenever a source term below appears, render it exactly as the specified target form, adapting only inflection where the grammar of the target language requires it:\n${entryLines.join('\n')}`;
}

function buildStyleSection(translationStyle, customInstruction) {
    const styleLines = [];
    const presetLine = STYLE_PROMPT_LINES[translationStyle];
    if (typeof presetLine === 'string') styleLines.push(presetLine);
    const instruction = typeof customInstruction === 'string' ? customInstruction.replace(/\s+/g, ' ').trim() : '';
    if (instruction) styleLines.push(`- Additional instruction from the user (it never overrides the placeholder and output format rules): ${instruction}`);
    if (styleLines.length === 0) return '';
    return `## Style\n${styleLines.join('\n')}`;
}

function buildPromptCustomSections(translationStyle, customInstruction, glossaryText) {
    const sections = [buildGlossarySection(glossaryText), buildStyleSection(translationStyle, customInstruction)].filter(Boolean);
    if (sections.length === 0) return '';
    return sections.join('\n\n') + '\n\n';
}

async function getPromptCustomSections() {
    const { translationStyle, customInstruction, glossaryText } = await new Promise(resolve =>
        chrome.storage.local.get(['translationStyle', 'customInstruction', 'glossaryText'], resolve));
    return buildPromptCustomSections(translationStyle, customInstruction, glossaryText);
}

function createTranslationPrompt(jsonPayload, targetLanguage, targetLanguageCode, customSections = '') {
    const localizedExamples = PROMPT_EXAMPLE_OUTPUTS[targetLanguageCode];
    const exampleOutputs = localizedExamples || PROMPT_EXAMPLE_OUTPUTS.ja;
    const exampleLanguageNote = localizedExamples
        ? `All examples below show output in **${targetLanguage}**. Your output must also be in **${targetLanguage}**.`
        : `Note: the examples below use Japanese output only to illustrate placeholder structure rules. Your output must be in **${targetLanguage}**.`;
    return `You are an elite translation engine. Translate the provided JSON into fluent, natural **${targetLanguage}** that reads as if originally written by a native speaker, preserving the source meaning, tone, and nuance.

## Input Format
A single JSON object. Each key is a Translation Unit ID (e.g., "TU_0"). Each value is a string of source text interleaved with XML-like placeholder tags. Placeholders use a type prefix (a / t / b / s) followed by a numeric ID that is UNIQUE within the TU:

- \`<aN>...</aN>\` — **ANCHOR (hyperlink) placeholder.** The content inside is the clickable link text. It MUST remain a meaningful noun phrase that makes sense as a hyperlink label. NEVER reduce it to only particles, conjunctions, or grammatical markers; those belong OUTSIDE the tag. Prepositions in the source (in/at/of/for…) typically migrate outside the anchor as the target language's equivalent connective.
- \`<tN>...</tN>\` — paired placeholder for other inline elements (emphasis, bold, italic, span, code, etc.). Translate the inner content naturally. Reorder freely within the sentence.
- \`<bN></bN>\` — empty block placeholder. Represents a child block element translated separately. Preserve verbatim.
- \`<sN></sN>\` — empty skip placeholder. Represents non-translatable content. Preserve verbatim.

Any other characters (including HTML entities like \`&amp;\`, \`&lt;\`, \`&quot;\`) must be preserved as written.

## Translation Rules

1. **Fluency first** — Produce natural, idiomatic ${targetLanguage}. Prefer meaning-based translation over literal when literal would sound unnatural.
2. **Register** — Match the style of the source: formal prose stays formal, UI labels use concise imperative or nominal style, marketing copy uses engaging tone.
3. **Reorder freely** — Word order varies by language. Move placeholders wherever they fit best in ${targetLanguage}.
4. **Preserve every placeholder** — Every \`<aN>\`, \`<tN>\`, \`<bN>\`, \`<sN>\` in the input must appear exactly once in the output (same tag name, same ID). Never drop, duplicate, merge, rename, or swap IDs.
5. **Anchor content integrity (CRITICAL)** — The content inside \`<aN>...</aN>\` must remain a standalone meaningful referent. Do NOT place only grammatical particles, conjunctions, or auxiliary words inside an anchor; those go outside.
6. **Empty content** — Inside \`<tN>\`, if the wrapped content naturally disappears in ${targetLanguage} (e.g., articles), output \`<tN></tN>\`. Do NOT empty \`<aN>\` unless the source anchor was truly empty.
7. **Preserve nesting** — \`<t0>outer <a1>inner</a1> outer</t0>\` must remain nested with both tags intact.
8. **Translate nouns by default** — Personal names, place names, organization names, titles of works, and ordinary nouns are rendered the way ${targetLanguage} normally renders them: translated, or transliterated into the target script when that is the conventional form (Japanese katakana, Cyrillic or Chinese transcription, and so on). Do not leave a noun in the source language merely because it is a proper noun.
9. **Keep as written only in these cases** — (a) content that must not be translated: code identifiers, URLs, email addresses, file paths, numbers, currency symbols, HTML entities, and brand or product names used as such (for example "iPhone", "GitHub"); (b) terms whose translation would change the meaning or break a reference the reader has to match, such as an on-screen UI label, a command name, or a cited title in its official form; (c) names and abbreviations that readers of ${targetLanguage} conventionally see in the source language (for example "API", "NASA"). For a technical term, use the established ${targetLanguage} term when one exists, and otherwise the established loanword form written in the target language's own script.
10. **Do NOT add, summarize, explain, or annotate** — Output translation only.

## Output Format (STRICT — must be machine-parseable)

Return EXACTLY one JSON object and nothing else. Your entire response must satisfy ALL of:

- The very first character is \`{\`. The very last character is \`}\`. No leading or trailing whitespace, prose, comments, or extra characters.
- The closing \`}\` that balances the opening \`{\` is the FINAL character of the response. Never emit a second JSON object, a follow-up explanation, an apology, or any text after that \`}\`.
- Never wrap the response in markdown fences (\`\`\`json, \`\`\`, etc.) or HTML.
- Same keys as the input, exactly. Do not add, rename, omit, reorder, or duplicate keys.
- Each value is a JSON string containing the translation with all required placeholders preserved.

Inside every string value, you MUST produce valid JSON string syntax:

- Escape every literal \`"\` as \`\\"\`.
- Escape every literal \`\\\` as \`\\\\\`.
- Escape line breaks as \`\\n\` (or \`\\r\\n\`). Never emit a raw newline, carriage return, or tab inside a string value.
- Do not emit any other raw control character (U+0000–U+001F). Use \`\\uXXXX\` if absolutely necessary.
- The placeholder tags (\`<aN>\`, \`<tN>\`, \`<bN>\`, \`<sN>\`) are plain ASCII and do NOT need escaping; emit them verbatim inside the string.

If you cannot translate a value, still emit a syntactically valid JSON string for that key (e.g. the original text wrapped in valid quotes). Never omit a key.

## Examples
${exampleLanguageNote}

### Example 1 — anchor with preposition
Input:  {"TU_0":"Shootings <t0><a1>in Siverek</a1></t0> and <t2><a3>in Onikişubat</a3></t2> leave 12 dead."}
Output: {"TU_0":"${exampleOutputs.anchorWithPreposition}"}
(Place names stay inside anchors; prepositions move outside.)

### Example 2 — anchor at sentence start
Input:  {"TU_0":"<a0>Click here</a0> to see <t1>our products</t1>."}
Output: {"TU_0":"${exampleOutputs.anchorAtSentenceStart}"}

### Example 3 — inline links
Input:  {"TU_0":"Read our <a0>Terms</a0> and <a1>Privacy Policy</a1>."}
Output: {"TU_0":"${exampleOutputs.inlineLinks}"}

### Example 4 — nested emphasis + anchor
Input:  {"TU_0":"See the <t0>official <a1>documentation</a1></t0>."}
Output: {"TU_0":"${exampleOutputs.nestedEmphasisAnchor}"}

### Example 5 — disappearing article
Input:  {"TU_0":"Read <t0>the</t0> <t1>guide</t1>."}
Output: {"TU_0":"${exampleOutputs.disappearingArticle}"}

### Example 6 — block and skip placeholders
Input:  {"TU_0":"Overview <b0></b0> See the <s1></s1> icon."}
Output: {"TU_0":"${exampleOutputs.blockAndSkipPlaceholders}"}

${customSections}## Input JSON
${jsonPayload}`;
}

function parseRetryAfterHeaderMs(response) {
    const retryAfterHeader = response.headers.get('Retry-After');
    if (!retryAfterHeader) return null;
    const asInt = parseInt(retryAfterHeader, 10);
    return Number.isFinite(asInt) ? asInt * 1000 : null;
}

function createInvalidRequestError(message, reasoningSent) {
    const rejectsReasoning = reasoningSent === true && /thinking|effort|reasoning|output_config/i.test(message);
    return createTranslationError(rejectsReasoning ? 'reasoningNotSupported' : 'invalidRequest', `\n${message}`);
}

function handleOpenAIHttpError(response, data, reasoningSent) {
    const message = data?.error?.message || `HTTP Error ${response.status}`;
    switch (response.status) {
        case 400: {
            const detail = [message, data?.error?.code, data?.error?.param].filter(Boolean).join(' | ');
            throw createInvalidRequestError(detail, reasoningSent);
        }
        case 401:
            throw createTranslationError('invalidApiKey');
        case 403:
            throw createTranslationError('invalidApiKey');
        case 404:
            throw createTranslationError('modelNotFound');
        case 429: {
            const errorType = data?.error?.type || '';
            const errorCode = data?.error?.code || '';
            if (errorType === 'insufficient_quota' || errorCode === 'insufficient_quota') {
                throw createTranslationError('insufficientQuota', `\n${message}`);
            }
            const retryAfterMs = parseRetryAfterHeaderMs(response);
            const detail = message ? `\n${message}` : '';
            const err = createTranslationError('apiLimitReached', detail);
            if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
            throw err;
        }
        case 500:
        case 502:
        case 503:
        case 504:
            throw createTranslationError('serverError', `\n${message}`);
        default:
            throw createTranslationError('unknownError', `\n${message}`);
    }
}

function handleGeminiHttpError(response, data, reasoningSent) {
    const message = data?.error?.message || `HTTP Error ${response.status}`;
    const status = data?.error?.status || '';
    switch (response.status) {
        case 400:
            if (message.includes("API key not valid")) throw createTranslationError('invalidApiKey');
            throw createInvalidRequestError(message, reasoningSent);
        case 401:
        case 403:
            throw createTranslationError('invalidApiKey');
        case 404:
            throw createTranslationError('modelNotFound');
        case 429: {
            let retryAfterMs = parseRetryAfterHeaderMs(response);
            if (retryAfterMs == null) retryAfterMs = extractGeminiRetryDelayMs(data);
            const detailParts = [];
            if (status) detailParts.push(status);
            if (message) detailParts.push(message);
            if (retryAfterMs != null) detailParts.push(`Retry-After: ${retryAfterMs / 1000}s`);
            const detail = detailParts.length ? `\n${detailParts.join(' | ')}` : '';
            const err = createTranslationError('apiLimitReached', detail);
            if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
            throw err;
        }
        case 500:
        case 502:
        case 503:
        case 504:
            throw createTranslationError('serverError', `\n${message}`);
        default:
            throw createTranslationError('unknownError', `\n${message}`);
    }
}

function handleAnthropicHttpError(response, data, reasoningSent) {
    const message = data?.error?.message || `HTTP Error ${response.status}`;
    switch (response.status) {
        case 400:
            throw createInvalidRequestError(message, reasoningSent);
        case 413:
            throw createTranslationError('invalidRequest', `\n${message}`);
        case 401:
        case 403:
            throw createTranslationError('invalidApiKey');
        case 402:
            throw createTranslationError('insufficientQuota', `\n${message}`);
        case 404:
            throw createTranslationError('modelNotFound');
        case 429: {
            const retryAfterMs = parseRetryAfterHeaderMs(response);
            const err = createTranslationError('apiLimitReached', `\n${message}`);
            if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
            throw err;
        }
        case 500:
        case 502:
        case 503:
        case 504:
        case 529:
            throw createTranslationError('serverError', `\n${message}`);
        default:
            throw createTranslationError('unknownError', `\n${message}`);
    }
}

function parseCompletedTranslationPairs(partialText) {
    const result = new Map();
    if (!partialText) return result;
    try {
        const parsed = JSON.parse(partialText);
        if (parsed && typeof parsed === 'object') {
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === 'string') result.set(key, value);
            }
            return result;
        }
    } catch (e) { }
    const pairRe = /"(TU_\d+)"\s*:\s*"((?:[^"\\]|\\.)*)"(?=\s*[,}])/g;
    let m;
    while ((m = pairRe.exec(partialText)) !== null) {
        try {
            result.set(m[1], JSON.parse('"' + m[2] + '"'));
        } catch (e) {
            result.set(m[1], unescapeJsonString(m[2]));
        }
    }
    return result;
}

function sendTabMessage(tabId, message, options, onFailure) {
    const fail = () => {
        if (typeof onFailure !== 'function') return;
        try { onFailure(); } catch (e) { }
    };
    try {
        const sending = options
            ? chrome.tabs.sendMessage(tabId, message, options)
            : chrome.tabs.sendMessage(tabId, message);
        if (sending && typeof sending.catch === 'function') sending.catch(fail);
    } catch (e) {
        fail();
    }
}

function emitStreamingUpdates(streamContext, acc) {
    if (!streamContext || !streamContext.keys) return;
    const completedPairs = parseCompletedTranslationPairs(acc.fullText);
    const updates = [];
    for (const [key, value] of completedPairs) {
        if (acc.sentKeys.has(key)) continue;
        if (!streamContext.keys.has(key)) continue;
        acc.sentKeys.add(key);
        updates.push({ key, translatedTemplate: value });
    }
    if (updates.length === 0) return;
    const message = {
        action: 'streamingTranslationUpdate',
        batchId: streamContext.batchId,
        translations: updates
    };
    const options = Number.isInteger(streamContext.frameId) ? { frameId: streamContext.frameId } : null;
    sendTabMessage(streamContext.tabId, message, options);
}

function consumeSSELine(line, readChunk, acc, streamContext) {
    const trimmed = (line || '').trim();
    if (!trimmed || !trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch (e) { return; }
    mergeMaxUsage(acc.usage, readUsageTokens(chunk));
    const delta = readChunk(chunk, acc) || '';
    if (!delta) return;
    acc.fullText += delta;
    if (/["},]/.test(delta)) emitStreamingUpdates(streamContext, acc);
}

async function streamModelResponse(streamRequest) {
    const { url, headers, body, timeout, reasoningLevel, signal, onHttpError, readChunk, finalizeStream, streamContext, provider } = streamRequest;
    const timeoutController = new AbortController();
    let timeoutId = null;
    const armIdleTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = timeout > 0 ? setTimeout(() => timeoutController.abort(), timeout * 1000) : null;
    };
    armIdleTimeout();
    const combinedSignal = combineSignals(signal, timeoutController.signal);
    const timedOut = () => timeoutController.signal.aborted && !signal?.aborted;
    const acc = { fullText: '', finishReason: '', sentKeys: new Set(), usage: createUsageTokens() };
    let response;
    try {
        response = await fetch(url, { method: 'POST', headers, body, signal: combinedSignal });
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            if (timedOut()) throw createTimeoutError(reasoningLevel, timeout);
            throw createAbortError();
        }
        throw createTranslationError('fetchError', `: ${error.message}`);
    }
    try {
        if (!response.ok) {
            let data = null;
            try { data = await response.json(); } catch (e) { }
            onHttpError(response, data);
        }
        if (!response.body) throw createTranslationError('emptyResponse');
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let pending = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                armIdleTimeout();
                pending += decoder.decode(value, { stream: true });
                const lines = pending.split('\n');
                pending = lines.pop() || '';
                for (const line of lines) consumeSSELine(line, readChunk, acc, streamContext);
            }
            pending += decoder.decode();
            consumeSSELine(pending, readChunk, acc, streamContext);
        } finally {
            try { reader.releaseLock(); } catch (e) { }
            recordApiUsage(provider, acc.usage);
        }
        finalizeStream(acc);
        return acc.fullText;
    } catch (error) {
        if (error?.name === 'AbortError') {
            if (timedOut()) throw createTimeoutError(acc.fullText ? '' : reasoningLevel, timeout);
            throw createAbortError();
        }
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function readGeminiTextParts(parts) {
    if (!Array.isArray(parts)) return '';
    let text = '';
    for (const part of parts) {
        if (part?.thought === true) continue;
        if (part?.text) text += part.text;
    }
    return text;
}

function readGeminiStreamChunk(chunk, acc) {
    const candidate = chunk?.candidates?.[0];
    if (!candidate) return '';
    if (candidate.finishReason) acc.finishReason = candidate.finishReason;
    return readGeminiTextParts(candidate.content?.parts);
}

function finalizeGeminiStream(acc) {
    if (acc.finishReason === 'SAFETY' || acc.finishReason === 'BLOCKLIST' || acc.finishReason === 'PROHIBITED_CONTENT') {
        throw createTranslationError('invalidRequest', ` (content blocked: ${acc.finishReason})`);
    }
    if (!acc.fullText) {
        if (acc.finishReason === 'MAX_TOKENS') throw createTranslationError('maxTokensError');
        throw createTranslationError('emptyResponse');
    }
}

function readOpenAIStreamChunk(chunk, acc) {
    const choice = chunk?.choices?.[0];
    if (!choice) return '';
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    return choice.delta?.content || '';
}

function finalizeOpenAIStream(acc) {
    if (acc.finishReason === 'length') throw createTranslationError('maxTokensError');
    if (!acc.fullText) throw createTranslationError('emptyResponse');
}

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

function stripLeadingThinkBlock(text) {
    const start = text.length - text.trimStart().length;
    const head = text.slice(start, start + THINK_OPEN_TAG.length);
    if (head.length < THINK_OPEN_TAG.length) return THINK_OPEN_TAG.startsWith(head) ? '' : text;
    if (head !== THINK_OPEN_TAG) return text;
    const close = text.indexOf(THINK_CLOSE_TAG, start + THINK_OPEN_TAG.length);
    if (close < 0) return '';
    return text.slice(close + THINK_CLOSE_TAG.length).trimStart();
}

function readCompatibleStreamChunk(chunk, acc) {
    const delta = readOpenAIStreamChunk(chunk, acc);
    if (!delta) return '';
    acc.rawText = (acc.rawText || '') + delta;
    const visible = stripLeadingThinkBlock(acc.rawText);
    const alreadyEmitted = acc.visibleLength || 0;
    acc.visibleLength = visible.length;
    return visible.slice(alreadyEmitted);
}

function readAnthropicStreamChunk(chunk, acc) {
    if (chunk?.type === 'error') {
        const streamErrorType = chunk.error?.type || '';
        const streamErrorMessage = chunk.error?.message || 'stream error';
        if (streamErrorType === 'overloaded_error' || streamErrorType === 'api_error') {
            throw createTranslationError('serverError', `\n${streamErrorMessage}`);
        }
        throw createTranslationError('unknownError', `\n${streamErrorMessage}`);
    }
    if (chunk?.type === 'message_delta' && chunk.delta?.stop_reason) {
        acc.finishReason = chunk.delta.stop_reason;
        acc.stopDetails = chunk.delta.stop_details;
    }
    if (chunk?.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        return chunk.delta.text || '';
    }
    return '';
}

function throwIfAnthropicRefused(stopReason, stopDetails) {
    if (stopReason !== 'refusal') return;
    const reason = stopDetails?.explanation || stopDetails?.category;
    throw createTranslationError('contentRefused', typeof reason === 'string' && reason ? `\n${reason}` : '');
}

function anthropicOutputTruncated(stopReason) {
    return stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded';
}

function finalizeAnthropicStream(acc) {
    throwIfAnthropicRefused(acc.finishReason, acc.stopDetails);
    if (anthropicOutputTruncated(acc.finishReason)) throw createTranslationError('maxTokensError');
    if (!acc.fullText) throw createTranslationError('emptyResponse');
}

function readAnthropicTextContent(content) {
    if (!Array.isArray(content)) return '';
    return content.map(part => part?.type === 'text' ? (part.text || '') : '').join('');
}

function geminiAllowsCustomTemperature(model) {
    const versionMatch = /^gemini-(\d+)/i.exec(model || '');
    return !!versionMatch && parseInt(versionMatch[1], 10) < 3;
}

function extractGeminiRetryDelayMs(data) {
    const details = data?.error?.details;
    if (!Array.isArray(details)) return null;
    for (const detail of details) {
        if (typeof detail?.['@type'] !== 'string') continue;
        if (!detail['@type'].endsWith('google.rpc.RetryInfo')) continue;
        if (typeof detail.retryDelay !== 'string') continue;
        const delayMatch = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay.trim());
        if (delayMatch) return Math.ceil(parseFloat(delayMatch[1]) * 1000);
    }
    return null;
}

function explicitOutputTokens(maxOutputTokens) {
    return Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : null;
}

function buildGeminiRequest(settings, prompt, maxOutputTokens, options) {
    const actualModel = (settings.geminiModel || '').trim() || DEFAULTS.geminiModel;
    const caps = resolveModelCapabilities('gemini', actualModel);
    const level = resolveReasoningLevel(settings.geminiReasoning, actualModel === DEFAULTS.geminiModel, DEFAULTS.geminiReasoning);
    const outputLimit = explicitOutputTokens(maxOutputTokens);
    const reasoning = buildReasoningFields(caps, level, outputLimit);
    const generationConfig = {};
    if (outputLimit !== null) generationConfig.maxOutputTokens = outputLimit;
    if (options.json) generationConfig.responseMimeType = 'application/json';
    if (geminiAllowsCustomTemperature(actualModel)) generationConfig.temperature = 0.2;
    if (reasoning) Object.assign(generationConfig, reasoning);
    const method = options.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(actualModel)}:${method}`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiApiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        reasoningSent: !!reasoning,
        reasoningLevel: reasoning ? level : ''
    };
}

function buildOpenAIRequest(settings, prompt, maxOutputTokens, options) {
    const actualModel = (settings.openaiModel || '').trim() || DEFAULTS.openaiModel;
    const caps = resolveModelCapabilities('openai', actualModel);
    const level = resolveReasoningLevel(settings.openaiReasoning, actualModel === DEFAULTS.openaiModel, DEFAULTS.openaiReasoning);
    const outputLimit = explicitOutputTokens(maxOutputTokens);
    const reasoning = buildReasoningFields(caps, level, outputLimit);
    const body = {
        model: actualModel,
        messages: [{ role: 'user', content: prompt }]
    };
    if (outputLimit !== null) body.max_completion_tokens = outputLimit;
    if (options.json) body.response_format = { type: 'json_object' };
    if (reasoning) Object.assign(body, reasoning);
    if (options.stream) {
        body.stream = true;
        body.stream_options = { include_usage: true };
    }
    return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.openaiApiKey}` },
        body: JSON.stringify(body),
        reasoningSent: !!reasoning,
        reasoningLevel: reasoning ? level : ''
    };
}

function buildCompatibleRequest(settings, prompt, maxOutputTokens, options) {
    const actualModel = (settings.compatibleModel || '').trim();
    const caps = resolveModelCapabilities('openai-compatible', actualModel);
    const level = resolveReasoningLevel(settings.compatibleReasoning, actualModel === DEFAULTS.compatibleModel, DEFAULTS.compatibleReasoning);
    const outputLimit = explicitOutputTokens(maxOutputTokens);
    const reasoning = buildReasoningFields(caps, level, outputLimit);
    const body = {
        model: actualModel,
        messages: [{ role: 'user', content: prompt }]
    };
    if (!reasoning) body.temperature = 0.2;
    if (outputLimit !== null) body.max_tokens = outputLimit;
    if (reasoning) Object.assign(body, reasoning);
    if (options.stream) body.stream = true;
    const extras = settings.compatibleExtraParams;
    try {
        applyExtraParams(body, extras);
    } catch (error) {
        throw createTranslationError('invalidRequest', ` (${error.message})`);
    }
    const reasoningOverridden = extras !== undefined && Object.prototype.hasOwnProperty.call(extras, 'reasoning_effort');
    const reasoningSent = !!reasoning && !reasoningOverridden;
    const headers = { 'Content-Type': 'application/json' };
    if (settings.compatibleApiKey) headers['Authorization'] = `Bearer ${settings.compatibleApiKey}`;
    return {
        url: settings.compatibleEndpoint.trim(),
        headers,
        body: JSON.stringify(body),
        reasoningSent,
        reasoningLevel: reasoningSent ? level : ''
    };
}

function buildAnthropicRequest(settings, prompt, maxOutputTokens, options) {
    const actualModel = (settings.anthropicModel || '').trim() || DEFAULTS.anthropicModel;
    const caps = resolveModelCapabilities('anthropic', actualModel);
    const level = resolveReasoningLevel(settings.anthropicReasoning, actualModel === DEFAULTS.anthropicModel, DEFAULTS.anthropicReasoning);
    const modelLimit = caps.maxOutputTokens ?? ANTHROPIC_MAX_OUTPUT_TOKENS;
    const maxTokens = Math.min(explicitOutputTokens(maxOutputTokens) ?? modelLimit, modelLimit);
    const reasoning = buildReasoningFields(caps, level, maxTokens);
    const body = {
        model: actualModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
    };
    if (reasoning) Object.assign(body, reasoning);
    if (options.stream) body.stream = true;
    return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body),
        reasoningSent: !!reasoning,
        reasoningLevel: reasoning ? level : ''
    };
}

function postProviderRequest(request, signal, timeout) {
    return fetchJsonWithTimeout(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal
    }, timeout, request.reasoningLevel);
}

async function translateWithGemini(text, retryLimit, signal, targetLanguage = 'English', targetLanguageCode, streamContext = null) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'geminiReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.geminiApiKey) throw createTranslationError('apiKeyNotSet');
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage, targetLanguageCode, await getPromptCustomSections());
    const request = buildGeminiRequest(settings, prompt, settings.maxToken || DEFAULTS.maxToken, { json: true, stream: !!streamContext });
    const onHttpError = (response, data) => handleGeminiHttpError(response, data, request.reasoningSent);
    if (streamContext) {
        return performTranslation(async () => parseTranslationResponse(await streamModelResponse({
            url: request.url,
            headers: request.headers,
            body: request.body,
            timeout: actualTimeout,
            reasoningLevel: request.reasoningLevel,
            signal,
            onHttpError,
            readChunk: readGeminiStreamChunk,
            finalizeStream: finalizeGeminiStream,
            streamContext,
            provider: 'gemini'
        })), retryLimit, signal);
    }
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) onHttpError(response, data);
        recordApiUsage('gemini', readUsageTokens(data));
        if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
            const blockReason = data?.promptFeedback?.blockReason;
            if (blockReason) throw createTranslationError('invalidRequest', ` (blocked: ${blockReason})`);
            throw createTranslationError('unknownError', ' (no candidates)');
        }
        const candidate = data.candidates[0];
        if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'BLOCKLIST' || candidate.finishReason === 'PROHIBITED_CONTENT') {
            throw createTranslationError('invalidRequest', ` (content blocked: ${candidate.finishReason})`);
        }
        const responseText = readGeminiTextParts(candidate.content?.parts);
        if (candidate.finishReason === 'MAX_TOKENS') {
            if (!responseText) throw createTranslationError('maxTokensError');
            return parseTranslationResponse(responseText);
        }
        if (!responseText) throw createTranslationError('emptyResponse');
        return parseTranslationResponse(responseText);
    }, retryLimit, signal);
}

async function translateWithOpenAI(text, retryLimit, signal, targetLanguage = 'English', targetLanguageCode, streamContext = null) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['openaiApiKey', 'openaiModel', 'openaiReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.openaiApiKey) throw createTranslationError('apiKeyNotSet');
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage, targetLanguageCode, await getPromptCustomSections());
    const request = buildOpenAIRequest(settings, prompt, settings.maxToken || DEFAULTS.maxToken, { json: true, stream: !!streamContext });
    const onHttpError = (response, data) => handleOpenAIHttpError(response, data, request.reasoningSent);
    if (streamContext) {
        return performTranslation(async () => parseTranslationResponse(await streamModelResponse({
            url: request.url,
            headers: request.headers,
            body: request.body,
            timeout: actualTimeout,
            reasoningLevel: request.reasoningLevel,
            signal,
            onHttpError,
            readChunk: readOpenAIStreamChunk,
            finalizeStream: finalizeOpenAIStream,
            streamContext,
            provider: 'openai'
        })), retryLimit, signal);
    }
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) onHttpError(response, data);
        recordApiUsage('openai', readUsageTokens(data));
        const choice = data?.choices?.[0];
        if (!choice) throw createTranslationError('unknownError', ' (no choices)');
        if (choice.finish_reason === 'length') throw createTranslationError('maxTokensError');
        const responseText = choice.message?.content || '';
        if (!responseText) throw createTranslationError('emptyResponse');
        return parseTranslationResponse(responseText);
    }, retryLimit, signal);
}

async function translateWithOpenAICompatible(text, retryLimit, signal, targetLanguage = 'English', targetLanguageCode, streamContext = null) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['compatibleApiKey', 'compatibleModel', 'compatibleEndpoint', 'compatibleReasoning', 'compatibleExtraParams', 'maxToken', 'timeout'], resolve));
    if (!settings.compatibleEndpoint) throw createTranslationError('endpointNotSet');
    if (!(settings.compatibleModel || '').trim()) throw createTranslationError('modelNotSet');
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage, targetLanguageCode, await getPromptCustomSections());
    const request = buildCompatibleRequest(settings, prompt, settings.maxToken || DEFAULTS.maxToken, { stream: !!streamContext });
    const onHttpError = (response, data) => handleOpenAIHttpError(response, data, request.reasoningSent);
    if (streamContext) {
        return performTranslation(async () => parseTranslationResponse(await streamModelResponse({
            url: request.url,
            headers: request.headers,
            body: request.body,
            timeout: actualTimeout,
            reasoningLevel: request.reasoningLevel,
            signal,
            onHttpError,
            readChunk: readCompatibleStreamChunk,
            finalizeStream: finalizeOpenAIStream,
            streamContext,
            provider: 'openai-compatible'
        })), retryLimit, signal);
    }
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) onHttpError(response, data);
        recordApiUsage('openai-compatible', readUsageTokens(data));
        const choice = data?.choices?.[0];
        if (!choice) throw createTranslationError('unknownError', ' (no choices)');
        if (choice.finish_reason === 'length') throw createTranslationError('maxTokensError');
        const responseText = stripLeadingThinkBlock(choice.message?.content || '');
        if (!responseText) throw createTranslationError('emptyResponse');
        return parseTranslationResponse(responseText);
    }, retryLimit, signal);
}

async function translateWithAnthropic(text, retryLimit, signal, targetLanguage = 'English', targetLanguageCode, streamContext = null) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['anthropicApiKey', 'anthropicModel', 'anthropicReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.anthropicApiKey) throw createTranslationError('apiKeyNotSet');
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage, targetLanguageCode, await getPromptCustomSections());
    const request = buildAnthropicRequest(settings, prompt, settings.maxToken || DEFAULTS.maxToken, { stream: !!streamContext });
    const onHttpError = (response, data) => handleAnthropicHttpError(response, data, request.reasoningSent);
    if (streamContext) {
        return performTranslation(async () => parseTranslationResponse(await streamModelResponse({
            url: request.url,
            headers: request.headers,
            body: request.body,
            timeout: actualTimeout,
            reasoningLevel: request.reasoningLevel,
            signal,
            onHttpError,
            readChunk: readAnthropicStreamChunk,
            finalizeStream: finalizeAnthropicStream,
            streamContext,
            provider: 'anthropic'
        })), retryLimit, signal);
    }
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) onHttpError(response, data);
        recordApiUsage('anthropic', readUsageTokens(data));
        throwIfAnthropicRefused(data?.stop_reason, data?.stop_details);
        if (anthropicOutputTruncated(data?.stop_reason)) throw createTranslationError('maxTokensError');
        const responseText = readAnthropicTextContent(data?.content);
        if (!responseText) throw createTranslationError('emptyResponse');
        return parseTranslationResponse(responseText);
    }, retryLimit, signal);
}

function toUsageCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function readUsageFromEnvelope(source) {
    if (!source || typeof source !== 'object') return null;
    const geminiUsage = source.usageMetadata;
    if (geminiUsage && typeof geminiUsage === 'object') {
        return {
            input: toUsageCount(geminiUsage.promptTokenCount),
            output: toUsageCount(geminiUsage.candidatesTokenCount) + toUsageCount(geminiUsage.thoughtsTokenCount)
        };
    }
    const usage = source.usage;
    if (usage && typeof usage === 'object') {
        return {
            input: toUsageCount(usage.prompt_tokens) + toUsageCount(usage.input_tokens),
            output: toUsageCount(usage.completion_tokens) + toUsageCount(usage.output_tokens)
        };
    }
    return null;
}

function readUsageTokens(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return readUsageFromEnvelope(payload) || readUsageFromEnvelope(payload.message);
}

function createUsageTokens() {
    return { input: 0, output: 0 };
}

function mergeMaxUsage(target, counts) {
    if (!target || !counts) return;
    if (counts.input > target.input) target.input = counts.input;
    if (counts.output > target.output) target.output = counts.output;
}

function createProviderUsage() {
    return { inputTokens: 0, outputTokens: 0, requests: 0 };
}

function recordApiUsage(provider, counts) {
    const name = (provider || DEFAULTS.apiProvider).trim();
    if (!name) return;
    let entry = pendingUsage.get(name);
    if (!entry) {
        entry = createProviderUsage();
        pendingUsage.set(name, entry);
    }
    entry.requests += 1;
    if (counts) {
        entry.inputTokens += toUsageCount(counts.input);
        entry.outputTokens += toUsageCount(counts.output);
    }
    scheduleUsageFlush();
}

function scheduleUsageFlush() {
    if (usageFlushTimer !== null) return;
    usageFlushTimer = setTimeout(() => {
        usageFlushTimer = null;
        flushPendingUsage();
    }, USAGE_FLUSH_DELAY_MS);
}

function flushPendingUsage() {
    if (pendingUsage.size === 0) return usageWriteChain;
    const delta = new Map(pendingUsage);
    pendingUsage.clear();
    usageWriteChain = usageWriteChain.then(() => storeUsageDelta(delta)).catch(() => { });
    return usageWriteChain;
}

function createUsageStats() {
    return { since: 0, updatedAt: 0, providers: {} };
}

function normalizeUsageStats(raw) {
    const stats = createUsageStats();
    if (!raw || typeof raw !== 'object') return stats;
    stats.since = toUsageCount(raw.since);
    stats.updatedAt = toUsageCount(raw.updatedAt);
    if (!raw.providers || typeof raw.providers !== 'object') return stats;
    for (const [name, entry] of Object.entries(raw.providers)) {
        if (!entry || typeof entry !== 'object') continue;
        stats.providers[name] = {
            inputTokens: toUsageCount(entry.inputTokens),
            outputTokens: toUsageCount(entry.outputTokens),
            requests: toUsageCount(entry.requests)
        };
    }
    return stats;
}

function readStoredUsageStats() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get([USAGE_STATS_KEY], items => {
                void chrome.runtime.lastError;
                resolve(normalizeUsageStats(items && items[USAGE_STATS_KEY]));
            });
        } catch (e) { resolve(createUsageStats()); }
    });
}

function writeUsageStats(stats) {
    return new Promise(resolve => {
        try {
            chrome.storage.local.set({ [USAGE_STATS_KEY]: stats }, () => {
                void chrome.runtime.lastError;
                resolve();
            });
        } catch (e) { resolve(); }
    });
}

async function storeUsageDelta(delta) {
    const stats = await readStoredUsageStats();
    const now = Date.now();
    for (const [name, entry] of delta) {
        const target = stats.providers[name] || createProviderUsage();
        target.inputTokens += entry.inputTokens;
        target.outputTokens += entry.outputTokens;
        target.requests += entry.requests;
        stats.providers[name] = target;
    }
    if (!stats.since) stats.since = now;
    stats.updatedAt = now;
    await writeUsageStats(stats);
}

async function getUsageStatsSnapshot() {
    await flushPendingUsage();
    return readStoredUsageStats();
}

async function resetUsageStats() {
    if (usageFlushTimer !== null) {
        clearTimeout(usageFlushTimer);
        usageFlushTimer = null;
    }
    pendingUsage.clear();
    const cleared = createUsageStats();
    usageWriteChain = usageWriteChain.then(() => writeUsageStats(cleared)).catch(() => { });
    await usageWriteChain;
    return cleared;
}

const TOGGLE_MENU_ID = 'toggleTranslation';
const SELECTION_MENU_ID = 'translateSelection';
const REPLACE_MENU_ID = 'translateReplaceSelection';
const SELECTION_MAX_OUTPUT_TOKENS = 16384;
const selectionControllers = new Map();

const CONTEXT_MENU_TITLE_FALLBACKS = {
    selMenuToggle: 'Toggle translation',
    selMenuTranslate: 'Translate selection',
    selMenuReplace: 'Translate and replace selection'
};

function contextMenuTitle(key, langCode) {
    try {
        if (typeof getT === 'function') {
            const strings = getT((langCode || 'en').trim());
            if (strings && strings[key]) return strings[key];
        }
    } catch (e) { }
    return CONTEXT_MENU_TITLE_FALLBACKS[key];
}

function handleContextMenuSettingsChange(changes, areaName) {
    if (areaName !== 'local') return;
    const shared = {};
    if (changes.showContextMenu !== undefined) {
        shared.visible = changes.showContextMenu.newValue !== false;
    }
    const languageChanged = changes.targetLanguage !== undefined;
    if (!languageChanged && Object.keys(shared).length === 0) return;
    const newLanguage = languageChanged ? changes.targetLanguage.newValue : null;
    const menus = [
        { id: TOGGLE_MENU_ID, key: 'selMenuToggle' },
        { id: SELECTION_MENU_ID, key: 'selMenuTranslate' },
        { id: REPLACE_MENU_ID, key: 'selMenuReplace' }
    ];
    for (const menu of menus) {
        const update = { ...shared };
        if (languageChanged) update.title = contextMenuTitle(menu.key, newLanguage);
        try {
            const updating = chrome.contextMenus.update(menu.id, update);
            if (updating && typeof updating.catch === 'function') updating.catch(() => { });
        } catch (e) { }
    }
}

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

function abortSelectionTranslation(key) {
    const controller = selectionControllers.get(key);
    if (!controller) return;
    selectionControllers.delete(key);
    try { controller.abort(); } catch (e) { }
}

async function runSelectionTranslation(key, rawText, sendResponse) {
    abortSelectionTranslation(key);
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
        safeSendResponse(sendResponse, { success: false, code: 'emptyResponse', error: errorMessages.emptyResponse });
        return;
    }
    const controller = new AbortController();
    selectionControllers.set(key, controller);
    try {
        const translation = await translateSelectionText(text, controller.signal);
        safeSendResponse(sendResponse, { success: true, translation });
    } catch (error) {
        const message = error?.message || errorMessages.unknownError;
        safeSendResponse(sendResponse, {
            success: false,
            cancelled: error?.name === 'AbortError',
            fatal: isFatalTranslationErrorMessage(message),
            code: resolveTranslationErrorCode(error, message),
            error: message
        });
    } finally {
        if (selectionControllers.get(key) === controller) selectionControllers.delete(key);
    }
}

async function translateSelectionText(text, signal) {
    if (signal?.aborted) throw createAbortError();
    const { maxRetries, apiProvider, targetLanguage } = await new Promise(resolve =>
        chrome.storage.local.get(['maxRetries', 'apiProvider', 'targetLanguage'], resolve));
    const provider = (apiProvider || DEFAULTS.apiProvider).trim();
    const retryLimit = maxRetries ?? DEFAULTS.maxRetries;
    const langCode = (targetLanguage || 'en').trim();
    const langEntry = LANGUAGE_LIST.find(l => l.code === langCode);
    const prompt = createSelectionPrompt(text, langEntry ? langEntry.name : 'English');
    if (provider === 'openai') return selectionRequestOpenAI(prompt, retryLimit, signal);
    if (provider === 'anthropic') return selectionRequestAnthropic(prompt, retryLimit, signal);
    if (provider === 'openai-compatible') return selectionRequestCompatible(prompt, retryLimit, signal);
    return selectionRequestGemini(prompt, retryLimit, signal);
}

function createSelectionPrompt(sourceText, targetLanguage) {
    return `Translate the text below into natural, fluent ${targetLanguage}, preserving the meaning, tone, and register of the source.

Rules:
- Output the translation only. No preface, explanation, notes, quotation marks, or markdown fences.
- Keep the original line breaks, paragraph splits, and list markers.
- Translate nouns, including personal, place, and organization names, the way ${targetLanguage} normally renders them, transliterating into the target script when that is the conventional form.
- Leave as written only what must not change: code identifiers, URLs, email addresses, file paths, numbers, brand and product names, terms whose translation would change their meaning, and names conventionally written in the source language.
- If the text is already written in ${targetLanguage}, repeat it unchanged.

Text:
${sourceText}`;
}

function selectionOutputTokenLimit(maxToken) {
    return Math.min(explicitOutputTokens(maxToken) ?? SELECTION_MAX_OUTPUT_TOKENS, SELECTION_MAX_OUTPUT_TOKENS);
}

function finishSelectionText(responseText, truncated) {
    let cleaned = (responseText || '').trim();
    const fenced = /^```[a-zA-Z0-9-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(cleaned);
    if (fenced) cleaned = fenced[1].trim();
    if (!cleaned) throw new Error(truncated ? errorMessages.maxTokensError : errorMessages.emptyResponse);
    return cleaned;
}

async function selectionRequestGemini(prompt, retryLimit, signal) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'geminiReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.geminiApiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const request = buildGeminiRequest(settings, prompt, selectionOutputTokenLimit(settings.maxToken), { json: false, stream: false });
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) handleGeminiHttpError(response, data, request.reasoningSent);
        recordApiUsage('gemini', readUsageTokens(data));
        const candidate = data?.candidates?.[0];
        if (!candidate) {
            const blockReason = data?.promptFeedback?.blockReason;
            if (blockReason) throw new Error(`${errorMessages.invalidRequest} (blocked: ${blockReason})`);
            throw new Error(`${errorMessages.unknownError} (no candidates)`);
        }
        if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'BLOCKLIST' || candidate.finishReason === 'PROHIBITED_CONTENT') {
            throw new Error(`${errorMessages.invalidRequest} (content blocked: ${candidate.finishReason})`);
        }
        return finishSelectionText(readGeminiTextParts(candidate.content?.parts), candidate.finishReason === 'MAX_TOKENS');
    }, retryLimit, signal);
}

async function selectionRequestOpenAI(prompt, retryLimit, signal) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['openaiApiKey', 'openaiModel', 'openaiReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.openaiApiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const request = buildOpenAIRequest(settings, prompt, selectionOutputTokenLimit(settings.maxToken), { json: false, stream: false });
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) handleOpenAIHttpError(response, data, request.reasoningSent);
        recordApiUsage('openai', readUsageTokens(data));
        const choice = data?.choices?.[0];
        if (!choice) throw new Error(`${errorMessages.unknownError} (no choices)`);
        return finishSelectionText(choice.message?.content || '', choice.finish_reason === 'length');
    }, retryLimit, signal);
}

async function selectionRequestCompatible(prompt, retryLimit, signal) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['compatibleApiKey', 'compatibleModel', 'compatibleEndpoint', 'compatibleReasoning', 'compatibleExtraParams', 'maxToken', 'timeout'], resolve));
    if (!settings.compatibleEndpoint) throw new Error(errorMessages.endpointNotSet);
    if (!(settings.compatibleModel || '').trim()) throw new Error(errorMessages.modelNotSet);
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const request = buildCompatibleRequest(settings, prompt, selectionOutputTokenLimit(settings.maxToken), { stream: false });
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) handleOpenAIHttpError(response, data, request.reasoningSent);
        recordApiUsage('openai-compatible', readUsageTokens(data));
        const choice = data?.choices?.[0];
        if (!choice) throw new Error(`${errorMessages.unknownError} (no choices)`);
        return finishSelectionText(stripLeadingThinkBlock(choice.message?.content || ''), choice.finish_reason === 'length');
    }, retryLimit, signal);
}

async function selectionRequestAnthropic(prompt, retryLimit, signal) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['anthropicApiKey', 'anthropicModel', 'anthropicReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.anthropicApiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const request = buildAnthropicRequest(settings, prompt, selectionOutputTokenLimit(settings.maxToken), { stream: false });
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) handleAnthropicHttpError(response, data, request.reasoningSent);
        recordApiUsage('anthropic', readUsageTokens(data));
        throwIfAnthropicRefused(data?.stop_reason, data?.stop_details);
        return finishSelectionText(readAnthropicTextContent(data?.content), anthropicOutputTruncated(data?.stop_reason));
    }, retryLimit, signal);
}

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
