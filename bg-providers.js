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

function buildDeepSeekRequest(settings, prompt, maxOutputTokens, options) {
    const actualModel = (settings.deepseekModel || '').trim() || DEFAULTS.deepseekModel;
    const caps = resolveModelCapabilities('deepseek', actualModel);
    const level = resolveReasoningLevel(settings.deepseekReasoning, actualModel === DEFAULTS.deepseekModel, DEFAULTS.deepseekReasoning);
    const modelLimit = caps.maxOutputTokens ?? DEEPSEEK_MAX_OUTPUT_TOKENS;
    const outputLimit = Math.min(explicitOutputTokens(maxOutputTokens) ?? modelLimit, modelLimit);
    const reasoning = buildReasoningFields(caps, level, outputLimit, options.stream);
    const body = {
        model: actualModel,
        messages: [{ role: 'user', content: prompt }]
    };
    if (reasoning) Object.assign(body, reasoning);
    else body.thinking = { type: 'disabled' };
    const thinkingOn = body.thinking && body.thinking.type === 'enabled';
    if (!thinkingOn) body.temperature = 0.2;
    body.max_tokens = outputLimit;
    if (options.json) body.response_format = { type: 'json_object' };
    if (options.stream) {
        body.stream = true;
        body.stream_options = { include_usage: true };
    }
    return {
        url: 'https://api.deepseek.com/chat/completions',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.deepseekApiKey}`
        },
        body: JSON.stringify(body),
        reasoningSent: true,
        reasoningLevel: thinkingOn ? level : ''
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

function readGeminiResponseText(data) {
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
    if (candidate.finishReason === 'MAX_TOKENS' && !responseText) throw createTranslationError('maxTokensError');
    return responseText;
}

function readOpenAIResponseText(data) {
    const choice = data?.choices?.[0];
    if (!choice) throw createTranslationError('unknownError', ' (no choices)');
    if (choice.finish_reason === 'length') throw createTranslationError('maxTokensError');
    return choice.message?.content || '';
}

function readDeepSeekResponseText(data) {
    const choice = data?.choices?.[0];
    if (!choice) throw createTranslationError('unknownError', ' (no choices)');
    assertDeepSeekFinishReason(choice.finish_reason);
    return choice.message?.content || '';
}

function readCompatibleResponseText(data) {
    return stripLeadingThinkBlock(readOpenAIResponseText(data));
}

function readAnthropicResponseText(data) {
    throwIfAnthropicRefused(data?.stop_reason, data?.stop_details);
    if (anthropicOutputTruncated(data?.stop_reason)) throw createTranslationError('maxTokensError');
    return readAnthropicTextContent(data?.content);
}

function providerSpec(provider) {
    if (provider === 'openai') {
        return {
            name: 'openai',
            settingsKeys: ['openaiApiKey', 'openaiModel', 'openaiReasoning', 'maxToken', 'timeout'],
            assertConfigured: settings => { if (!settings.openaiApiKey) throw createTranslationError('apiKeyNotSet'); },
            buildRequest: buildOpenAIRequest,
            handleHttpError: handleOpenAIHttpError,
            readChunk: readOpenAIStreamChunk,
            finalizeStream: finalizeOpenAIStream,
            readResponseText: readOpenAIResponseText
        };
    }
    if (provider === 'anthropic') {
        return {
            name: 'anthropic',
            settingsKeys: ['anthropicApiKey', 'anthropicModel', 'anthropicReasoning', 'maxToken', 'timeout'],
            assertConfigured: settings => { if (!settings.anthropicApiKey) throw createTranslationError('apiKeyNotSet'); },
            buildRequest: buildAnthropicRequest,
            handleHttpError: handleAnthropicHttpError,
            readChunk: readAnthropicStreamChunk,
            finalizeStream: finalizeAnthropicStream,
            readResponseText: readAnthropicResponseText
        };
    }
    if (provider === 'deepseek') {
        return {
            name: 'deepseek',
            settingsKeys: ['deepseekApiKey', 'deepseekModel', 'deepseekReasoning', 'maxToken', 'timeout'],
            assertConfigured: settings => { if (!settings.deepseekApiKey) throw createTranslationError('apiKeyNotSet'); },
            buildRequest: buildDeepSeekRequest,
            handleHttpError: handleDeepSeekHttpError,
            readChunk: readOpenAIStreamChunk,
            finalizeStream: finalizeDeepSeekStream,
            readResponseText: readDeepSeekResponseText
        };
    }
    if (provider === 'openai-compatible') {
        return {
            name: 'openai-compatible',
            settingsKeys: ['compatibleApiKey', 'compatibleModel', 'compatibleEndpoint', 'compatibleReasoning', 'compatibleExtraParams', 'maxToken', 'timeout'],
            assertConfigured: settings => {
                if (!settings.compatibleEndpoint) throw createTranslationError('endpointNotSet');
                if (!(settings.compatibleModel || '').trim()) throw createTranslationError('modelNotSet');
            },
            buildRequest: buildCompatibleRequest,
            handleHttpError: handleOpenAIHttpError,
            readChunk: readCompatibleStreamChunk,
            finalizeStream: finalizeOpenAIStream,
            readResponseText: readCompatibleResponseText
        };
    }
    return {
        name: 'gemini',
        settingsKeys: ['geminiApiKey', 'geminiModel', 'geminiReasoning', 'maxToken', 'timeout'],
        assertConfigured: settings => { if (!settings.geminiApiKey) throw createTranslationError('apiKeyNotSet'); },
        buildRequest: buildGeminiRequest,
        handleHttpError: handleGeminiHttpError,
        readChunk: readGeminiStreamChunk,
        finalizeStream: finalizeGeminiStream,
        readResponseText: readGeminiResponseText
    };
}

async function translateWithProvider(provider, text, retryLimit, signal, targetLanguage = 'English', targetLanguageCode, streamContext = null) {
    const spec = providerSpec(provider);
    const settings = await new Promise(resolve => chrome.storage.local.get(spec.settingsKeys, resolve));
    spec.assertConfigured(settings);
    const actualTimeout = settings.timeout || DEFAULTS.timeout;
    const prompt = createTranslationPrompt(text, targetLanguage, targetLanguageCode, await getPromptCustomSections());
    const request = spec.buildRequest(settings, prompt, settings.maxToken || DEFAULTS.maxToken, { json: true, stream: !!streamContext });
    const onHttpError = (response, data) => spec.handleHttpError(response, data, request.reasoningSent);
    if (streamContext) {
        return performTranslation(async () => parseTranslationResponse(await streamModelResponse({
            url: request.url,
            headers: request.headers,
            body: request.body,
            timeout: actualTimeout,
            reasoningLevel: request.reasoningLevel,
            signal,
            onHttpError,
            readChunk: spec.readChunk,
            finalizeStream: spec.finalizeStream,
            streamContext,
            provider: spec.name
        })), retryLimit, signal);
    }
    return performTranslation(async () => {
        const { response, data } = await postProviderRequest(request, signal, actualTimeout);
        if (!response.ok) onHttpError(response, data);
        recordApiUsage(spec.name, readUsageTokens(data));
        const responseText = spec.readResponseText(data);
        if (!responseText) throw createTranslationError('emptyResponse');
        return parseTranslationResponse(responseText);
    }, retryLimit, signal);
}
