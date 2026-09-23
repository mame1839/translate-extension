const SELECTION_MAX_OUTPUT_TOKENS = 16384;

const selectionControllers = new Map();

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
    const langEntry = LANGUAGES.find(l => l.code === langCode);
    const prompt = createSelectionPrompt(text, langEntry ? langEntry.name : 'English');
    if (provider === 'openai') return selectionRequestOpenAI(prompt, retryLimit, signal);
    if (provider === 'anthropic') return selectionRequestAnthropic(prompt, retryLimit, signal);
    if (provider === 'deepseek') return selectionRequestDeepSeek(prompt, retryLimit, signal);
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

async function selectionRequestDeepSeek(prompt, retryLimit, signal) {
    const settings = await new Promise(resolve =>
        chrome.storage.local.get(['deepseekApiKey', 'deepseekModel', 'deepseekReasoning', 'maxToken', 'timeout'], resolve));
    if (!settings.deepseekApiKey) throw new Error(errorMessages.apiKeyNotSet);
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const request = buildDeepSeekRequest(settings, prompt, selectionOutputTokenLimit(settings.maxToken), { json: false, stream: false });
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) handleDeepSeekHttpError(response, data, request.reasoningSent);
        recordApiUsage('deepseek', readUsageTokens(data));
        const choice = data?.choices?.[0];
        if (!choice) throw new Error(`${errorMessages.unknownError} (no choices)`);
        assertDeepSeekFinishReason(choice.finish_reason);
        return finishSelectionText(choice.message?.content || '', false);
    }, retryLimit, signal);
}
