const errorMessages = {
    apiKeyNotSet: 'API key is not set. Please configure it in the options page.',
    endpointNotSet: 'Endpoint URL is not set. Please configure it in the options page.',
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
    emptyResponse: 'Empty response received from AI.'
};

const DEFAULTS = Object.freeze({
    apiProvider: 'gemini',
    geminiModel: 'gemini-3.1-flash-lite',
    openaiModel: 'gpt-5.4-nano-2026-03-17',
    anthropicModel: 'claude-haiku-4-5-20251001',
    compatibleModel: '',
    batchSize: 500,
    maxBatchLength: 65535,
    delayBetweenRequests: 10000,
    maxToken: 65536,
    concurrencyLimit: 10,
    maxRetries: 3,
    timeout: 180
});

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

const tabStates = new Map();
const globalRequestQueue = new Map();
let isProcessing = false;
const activeTranslationTabs = new Set();

function getTabState(tabId) {
    if (!tabStates.has(tabId)) {
        tabStates.set(tabId, {
            abortController: new AbortController(),
            translationCancelled: false
        });
    }
    const state = tabStates.get(tabId);
    if (state.abortController.signal.aborted) {
        state.abortController = new AbortController();
        state.translationCancelled = false;
    }
    return state;
}

chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === 'install') {
        chrome.runtime.openOptionsPage();
    }
    chrome.storage.local.get(
        ['apiProvider', 'targetLanguage', 'geminiModel', 'openaiModel', 'anthropicModel', 'compatibleModel',
         'batchSize', 'maxBatchLength', 'delayBetweenRequests', 'maxToken', 'concurrencyLimit', 'maxRetries', 'timeout', 'showContextMenu'],
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
            if (items.maxToken === undefined) toSet.maxToken = DEFAULTS.maxToken;
            if (items.concurrencyLimit === undefined) toSet.concurrencyLimit = DEFAULTS.concurrencyLimit;
            if (items.maxRetries === undefined) toSet.maxRetries = DEFAULTS.maxRetries;
            if (items.timeout === undefined) toSet.timeout = DEFAULTS.timeout;
            if (items.showContextMenu === undefined) toSet.showContextMenu = true;
            if (Object.keys(toSet).length > 0) chrome.storage.local.set(toSet);
            chrome.contextMenus.removeAll(() => {
                chrome.contextMenus.create({
                    id: "toggleTranslation",
                    title: chrome.i18n.getMessage('contextMenuToggle'),
                    contexts: ["all"],
                    visible: items.showContextMenu !== false
                });
            });
        }
    );
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    const tabId = sender.tab?.id;
    if (!tabId) return false;

    if (request.action === "translateBatch") {
        activeTranslationTabs.add(tabId);
        if (!globalRequestQueue.has(tabId)) {
            globalRequestQueue.set(tabId, {
                batches: [],
                state: getTabState(tabId)
            });
        }
        globalRequestQueue.get(tabId).batches.push({ request, sendResponse });
        if (!isProcessing) {
            processQueue();
        }
        return true;
    }

    if (request.action === "cancelTranslation") {
        const state = getTabState(tabId);
        state.translationCancelled = true;
        state.abortController.abort();
        if (globalRequestQueue.has(tabId)) {
            const tabData = globalRequestQueue.get(tabId);
            tabData.batches.forEach(({ sendResponse: sr }) => {
                safeSendResponse(sr, { success: false, error: errorMessages.translationCancelled });
            });
            globalRequestQueue.delete(tabId);
        }
        activeTranslationTabs.delete(tabId);
        chrome.tabs.sendMessage(tabId, { action: "translationCancelled" }).catch(() => {
            if (tabStates.has(tabId)) tabStates.delete(tabId);
        });
        return false;
    }

    if (request.action === "translationCancelled" || request.action === "translationComplete" || request.action === "translationError") {
        activeTranslationTabs.delete(tabId);
        return false;
    }
    return false;
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId === "toggleTranslation" && tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: "toggleTranslation" }).catch(() => { });
    }
});

chrome.storage.onChanged.addListener(function (changes) {
    if (changes.showContextMenu !== undefined) {
        chrome.contextMenus.update("toggleTranslation", {
            visible: changes.showContextMenu.newValue !== false
        }).catch(() => {});
    }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    if (tabStates.has(tabId)) {
        const state = tabStates.get(tabId);
        if (!state.abortController.signal.aborted) {
            state.abortController.abort();
        }
        tabStates.delete(tabId);
    }
    globalRequestQueue.delete(tabId);
    activeTranslationTabs.delete(tabId);
});

async function processQueue() {
    if (isProcessing || globalRequestQueue.size === 0) return;
    isProcessing = true;
    try {
        while (globalRequestQueue.size > 0) {
            const tabId = globalRequestQueue.keys().next().value;
            const tabData = globalRequestQueue.get(tabId);
            globalRequestQueue.delete(tabId);
            try {
                await processTab(tabId, tabData);
            } catch (error) {
                console.error(`Error processing tab ${tabId}:`, error);
            }
            if (globalRequestQueue.size > 0) {
                const { delayBetweenRequests } = await new Promise(resolve =>
                    chrome.storage.local.get(['delayBetweenRequests'], resolve));
                const waitTime = (delayBetweenRequests ?? DEFAULTS.delayBetweenRequests);
                await sleep(waitTime, null);
            }
        }
    } finally {
        isProcessing = false;
    }
}

async function processTab(tabId, tabData) {
    const { batches, state } = tabData;
    const { concurrencyLimit, delayBetweenRequests } = await new Promise(resolve =>
        chrome.storage.local.get(['concurrencyLimit', 'delayBetweenRequests'], resolve));
    const concLimit = Math.max(1, concurrencyLimit || DEFAULTS.concurrencyLimit);
    const delayMs = Math.max(0, delayBetweenRequests ?? DEFAULTS.delayBetweenRequests);

    if (!batches || batches.length === 0) return;

    let activeRequests = 0;
    let batchIndex = 0;
    let nextFireTime = Date.now();

    return new Promise(resolve => {
        const tryLaunch = () => {
            if (state.translationCancelled || state.abortController.signal.aborted) {
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
                        const translations = await translateTextBatch(request.batch, state.abortController.signal);
                        safeSendResponse(sendResponse, { success: true, translations });
                    } catch (error) {
                        if (error?.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
                            nextFireTime = Math.max(nextFireTime, Date.now() + error.retryAfterMs);
                        }
                        safeSendResponse(sendResponse, {
                            success: false,
                            error: error?.message || errorMessages.unknownError
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
    const error = new Error(errorMessages.translationCancelled);
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

async function fetchWithTimeout(resource, options = {}, timeout) {
    const controller = new AbortController();
    const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout * 1000) : null;
    options.signal = combineSignals(options.signal, controller.signal);
    try {
        const response = await fetch(resource, options);
        if (timeoutId) clearTimeout(timeoutId);
        return response;
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            if (options.signal?.aborted && !controller.signal.aborted) {
                throw createAbortError();
            }
            throw new Error(errorMessages.requestTimeout);
        }
        throw new Error(`${errorMessages.fetchError}: ${error.message}`);
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

async function translateTextBatch(fragmentBatch, signal) {
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

    const provider = (apiProvider || DEFAULTS.apiProvider).trim();
    const jsonText = JSON.stringify(payload, null, 2);
    const retryLimit = maxRetries ?? DEFAULTS.maxRetries;
    const langCode = (targetLanguage || 'en').trim();
    const langEntry = LANGUAGE_LIST.find(l => l.code === langCode);
    const langName = langEntry ? langEntry.name : 'English';

    let translatedJSONString;
    if (provider === 'openai') {
        translatedJSONString = await translateWithOpenAI(jsonText, retryLimit, signal, langName);
    } else if (provider === 'anthropic') {
        translatedJSONString = await translateWithAnthropic(jsonText, retryLimit, signal, langName);
    } else if (provider === 'openai-compatible') {
        translatedJSONString = await translateWithOpenAICompatible(jsonText, retryLimit, signal, langName);
    } else {
        translatedJSONString = await translateWithGemini(jsonText, retryLimit, signal, langName);
    }

    let translatedData;
    try {
        translatedData = extractJson(translatedJSONString);
    } catch (e) {
        throw new Error(`${errorMessages.jsonParseFailed} ${e.message}\nResponse: ${translatedJSONString.substring(0, 200)}`);
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

function extractJson(responseText) {
    let cleaned = responseText.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const candidate = cleaned.slice(firstBrace, lastBrace + 1);
            return JSON.parse(candidate);
        }
        throw e;
    }
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

function createTranslationPrompt(jsonPayload, targetLanguage) {
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
8. **Do not translate** — Brand/product names, proper nouns, code identifiers, URLs, emails, file paths, numbers, currency symbols, and HTML entities. Leave them exactly as written.
9. **Technical terms** — Translate only if a well-established ${targetLanguage} term exists; otherwise keep the original or use an established loanword form.
10. **Do NOT add, summarize, explain, or annotate** — Output translation only.

## Output Format

Return ONLY a single valid JSON object. Same keys as input. Each value is the translated string with placeholders preserved. No markdown fences, no commentary, no trailing text.

## Examples
Note: the examples below use Japanese output only to illustrate placeholder structure rules. Your output must be in **${targetLanguage}**.

### Example 1 — anchor with preposition
Input:  {"TU_0":"Shootings <t0><a1>in Siverek</a1></t0> and <t2><a3>in Onikişubat</a3></t2> leave 12 dead."}
Output: {"TU_0":"<t0><a1>シヴェレク</a1></t0>と<t2><a3>オニキシュバト</a3></t2>での銃撃事件で12人が死亡。"}
(Place names stay inside anchors; prepositions move outside.)

### Example 2 — anchor at sentence start
Input:  {"TU_0":"<a0>Click here</a0> to see <t1>our products</t1>."}
Output: {"TU_0":"<t1>製品</t1>を見るには<a0>こちら</a0>をクリック。"}

### Example 3 — inline links
Input:  {"TU_0":"Read our <a0>Terms</a0> and <a1>Privacy Policy</a1>."}
Output: {"TU_0":"<a0>利用規約</a0>と<a1>プライバシーポリシー</a1>をお読みください。"}

### Example 4 — nested emphasis + anchor
Input:  {"TU_0":"See the <t0>official <a1>documentation</a1></t0>."}
Output: {"TU_0":"<t0>公式<a1>ドキュメント</a1></t0>を参照。"}

### Example 5 — disappearing article
Input:  {"TU_0":"Read <t0>the</t0> <t1>guide</t1>."}
Output: {"TU_0":"<t0></t0><t1>ガイド</t1>をお読みください。"}

### Example 6 — block and skip placeholders
Input:  {"TU_0":"Overview <b0></b0> See the <s1></s1> icon."}
Output: {"TU_0":"概要 <b0></b0> <s1></s1>アイコンを参照。"}

## Input JSON
${jsonPayload}`;
}

function handleOpenAIHttpError(response, data) {
    const message = data?.error?.message || `HTTP Error ${response.status}`;
    switch (response.status) {
        case 401:
            throw new Error(errorMessages.invalidApiKey);
        case 403:
            throw new Error(errorMessages.invalidApiKey);
        case 404:
            throw new Error(errorMessages.modelNotFound);
        case 429: {
            const retryAfterHeader = response.headers.get('Retry-After');
            let retryAfterMs = null;
            if (retryAfterHeader) {
                const asInt = parseInt(retryAfterHeader, 10);
                if (Number.isFinite(asInt)) retryAfterMs = asInt * 1000;
            }
            const detail = message ? `\n${message}` : '';
            const err = new Error(`${errorMessages.apiLimitReached}${detail}`);
            if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
            throw err;
        }
        case 500:
        case 502:
        case 503:
        case 504:
            throw new Error(`${errorMessages.serverError}\n${message}`);
        default:
            throw new Error(`${errorMessages.unknownError}\n${message}`);
    }
}

async function translateWithGemini(text, retryLimit, signal, targetLanguage = 'English') {
    const { geminiApiKey: apiKey, geminiModel: model, maxToken, timeout } = await new Promise(resolve =>
        chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'maxToken', 'timeout'], resolve));
    if (!apiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualModel = (model || '').trim() || DEFAULTS.geminiModel;
    const actualMaxToken = maxToken || DEFAULTS.maxToken;
    const actualTimeout = timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage);
    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: actualMaxToken,
            responseMimeType: "application/json"
        }
    };
    return performTranslation(async () => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(actualModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal
        }, actualTimeout);
        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }
        if (!response.ok) {
            const message = data?.error?.message || `HTTP Error ${response.status}`;
            const status = data?.error?.status || '';
            switch (response.status) {
                case 400:
                    if (message.includes("API key not valid")) throw new Error(errorMessages.invalidApiKey);
                    throw new Error(`${errorMessages.invalidRequest}\n${message}`);
                case 401:
                case 403:
                    throw new Error(errorMessages.invalidApiKey);
                case 404:
                    throw new Error(errorMessages.modelNotFound);
                case 429: {
                    const retryAfterHeader = response.headers.get('Retry-After');
                    let retryAfterMs = null;
                    if (retryAfterHeader) {
                        const asInt = parseInt(retryAfterHeader, 10);
                        if (Number.isFinite(asInt)) retryAfterMs = asInt * 1000;
                    }
                    const detailParts = [];
                    if (status) detailParts.push(status);
                    if (message) detailParts.push(message);
                    if (retryAfterMs != null) detailParts.push(`Retry-After: ${retryAfterMs / 1000}s`);
                    const detail = detailParts.length ? `\n${detailParts.join(' | ')}` : '';
                    const err = new Error(`${errorMessages.apiLimitReached}${detail}`);
                    if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
                    throw err;
                }
                case 500:
                case 502:
                case 503:
                case 504:
                    throw new Error(`${errorMessages.serverError}\n${message}`);
                default:
                    throw new Error(`${errorMessages.unknownError}\n${message}`);
            }
        }
        if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
            const blockReason = data?.promptFeedback?.blockReason;
            if (blockReason) throw new Error(`${errorMessages.invalidRequest} (blocked: ${blockReason})`);
            throw new Error(`${errorMessages.unknownError} (no candidates)`);
        }
        const candidate = data.candidates[0];
        if (candidate.finishReason === 'MAX_TOKENS') throw new Error(errorMessages.maxTokensError);
        if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'BLOCKLIST' || candidate.finishReason === 'PROHIBITED_CONTENT') {
            throw new Error(`${errorMessages.invalidRequest} (content blocked: ${candidate.finishReason})`);
        }
        const parts = candidate.content?.parts;
        const responseText = Array.isArray(parts)
            ? parts.map(p => p?.text || '').join('')
            : '';
        if (!responseText) throw new Error(errorMessages.emptyResponse);
        return responseText;
    }, retryLimit, signal);
}

async function translateWithOpenAI(text, retryLimit, signal, targetLanguage = 'English') {
    const { openaiApiKey: apiKey, openaiModel: model, maxToken, timeout } = await new Promise(resolve =>
        chrome.storage.local.get(['openaiApiKey', 'openaiModel', 'maxToken', 'timeout'], resolve));
    if (!apiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualModel = (model || '').trim() || DEFAULTS.openaiModel;
    const actualMaxToken = maxToken || DEFAULTS.maxToken;
    const actualTimeout = timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage);
    const isReasoningModel = /^o\d/i.test(actualModel);
    const requestBody = {
        model: actualModel,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: actualMaxToken,
        response_format: { type: 'json_object' }
    };
    if (!isReasoningModel) requestBody.temperature = 0.2;
    return performTranslation(async () => {
        const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody),
            signal
        }, actualTimeout);
        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }
        if (!response.ok) handleOpenAIHttpError(response, data);
        const choice = data?.choices?.[0];
        if (!choice) throw new Error(`${errorMessages.unknownError} (no choices)`);
        if (choice.finish_reason === 'length') throw new Error(errorMessages.maxTokensError);
        const responseText = choice.message?.content || '';
        if (!responseText) throw new Error(errorMessages.emptyResponse);
        return responseText;
    }, retryLimit, signal);
}

async function translateWithOpenAICompatible(text, retryLimit, signal, targetLanguage = 'English') {
    const { compatibleApiKey: apiKey, compatibleModel: model, compatibleEndpoint: endpoint, maxToken, timeout } = await new Promise(resolve =>
        chrome.storage.local.get(['compatibleApiKey', 'compatibleModel', 'compatibleEndpoint', 'maxToken', 'timeout'], resolve));
    if (!endpoint) throw new Error(errorMessages.endpointNotSet);
    const actualModel = (model || '').trim();
    const actualMaxToken = maxToken || DEFAULTS.maxToken;
    const actualTimeout = timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage);
    const requestBody = {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: actualMaxToken
    };
    if (actualModel) requestBody.model = actualModel;
    return performTranslation(async () => {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const response = await fetchWithTimeout(endpoint.trim(), {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal
        }, actualTimeout);
        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }
        if (!response.ok) handleOpenAIHttpError(response, data);
        const choice = data?.choices?.[0];
        if (!choice) throw new Error(`${errorMessages.unknownError} (no choices)`);
        if (choice.finish_reason === 'length') throw new Error(errorMessages.maxTokensError);
        const responseText = choice.message?.content || '';
        if (!responseText) throw new Error(errorMessages.emptyResponse);
        return responseText;
    }, retryLimit, signal);
}

async function translateWithAnthropic(text, retryLimit, signal, targetLanguage = 'English') {
    const { anthropicApiKey: apiKey, anthropicModel: model, maxToken, timeout } = await new Promise(resolve =>
        chrome.storage.local.get(['anthropicApiKey', 'anthropicModel', 'maxToken', 'timeout'], resolve));
    if (!apiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualModel = (model || '').trim() || DEFAULTS.anthropicModel;
    const actualMaxToken = maxToken || DEFAULTS.maxToken;
    const actualTimeout = timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage);
    const requestBody = {
        model: actualModel,
        max_tokens: actualMaxToken,
        messages: [{ role: 'user', content: prompt }]
    };
    return performTranslation(async () => {
        const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody),
            signal
        }, actualTimeout);
        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }
        if (!response.ok) {
            const message = data?.error?.message || `HTTP Error ${response.status}`;
            switch (response.status) {
                case 400:
                    throw new Error(`${errorMessages.invalidRequest}\n${message}`);
                case 401:
                case 403:
                    throw new Error(errorMessages.invalidApiKey);
                case 404:
                    throw new Error(errorMessages.modelNotFound);
                case 429: {
                    const retryAfterHeader = response.headers.get('Retry-After');
                    let retryAfterMs = null;
                    if (retryAfterHeader) {
                        const asInt = parseInt(retryAfterHeader, 10);
                        if (Number.isFinite(asInt)) retryAfterMs = asInt * 1000;
                    }
                    const err = new Error(`${errorMessages.apiLimitReached}\n${message}`);
                    if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
                    throw err;
                }
                case 500:
                case 502:
                case 503:
                case 504:
                    throw new Error(`${errorMessages.serverError}\n${message}`);
                default:
                    throw new Error(`${errorMessages.unknownError}\n${message}`);
            }
        }
        if (data?.stop_reason === 'max_tokens') throw new Error(errorMessages.maxTokensError);
        const responseText = data?.content?.[0]?.text || '';
        if (!responseText) throw new Error(errorMessages.emptyResponse);
        return responseText;
    }, retryLimit, signal);
}
