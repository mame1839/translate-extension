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
