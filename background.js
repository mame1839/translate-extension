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

const SELECTION_MAX_OUTPUT_TOKENS = 16384;
const selectionControllers = new Map();

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
