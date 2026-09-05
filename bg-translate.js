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
    const langEntry = LANGUAGES.find(l => l.code === langCode);
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
