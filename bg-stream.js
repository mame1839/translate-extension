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
    forEachTuPair(partialText, /"(TU_\d+)"\s*:\s*"((?:[^"\\]|\\.)*)"(?=\s*[,}])/g, (key, value) => result.set(key, value));
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

function assertDeepSeekFinishReason(reason) {
    if (reason === 'stop') return;
    if (reason === 'length') throw createTranslationError('maxTokensError');
    if (reason === 'content_filter') throw createTranslationError('contentRefused');
    if (reason === 'insufficient_system_resource' || reason === 'aborted') throw createTranslationError('serverError');
    throw createTranslationError('unknownError', ` (finish_reason: ${reason ?? 'missing'})`);
}

function finalizeDeepSeekStream(acc) {
    assertDeepSeekFinishReason(acc.finishReason);
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
