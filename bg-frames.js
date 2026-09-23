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
