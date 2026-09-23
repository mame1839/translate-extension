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

function getHostnameFromUrl(url) {
    if (!url) return '';
    try { return new URL(url).hostname; } catch (e) { return ''; }
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

function handleDeepSeekHttpError(response, data, reasoningSent) {
    const message = data?.error?.message || `HTTP Error ${response.status}`;
    if (response.status === 402) throw createTranslationError('insufficientQuota', `\n${message}`);
    if (response.status === 422) {
        const detail = [message, data?.error?.code, data?.error?.param].filter(Boolean).join(' | ');
        throw createInvalidRequestError(detail, reasoningSent);
    }
    handleOpenAIHttpError(response, data, reasoningSent);
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
