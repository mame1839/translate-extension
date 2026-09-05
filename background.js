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
    const reasoning = buildReasoningFields(caps, level, outputLimit, options.stream);
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
    const reasoning = buildReasoningFields(caps, level, outputLimit, options.stream);
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
    const reasoning = buildReasoningFields(caps, level, outputLimit, options.stream);
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
    const reasoning = buildReasoningFields(caps, level, maxTokens, options.stream);
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
