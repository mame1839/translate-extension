function messagingRuntime() {
    try {
        if (typeof chrome === 'undefined') return null;
        const runtime = chrome.runtime;
        if (!runtime || typeof runtime.sendMessage !== 'function') return null;
        return runtime;
    } catch (e) {
        return null;
    }
}

function readRuntimeLastError() {
    try {
        const runtime = messagingRuntime();
        const lastError = runtime ? runtime.lastError : null;
        if (!lastError) return '';
        return lastError.message || 'runtime error';
    } catch (e) {
        return 'runtime error';
    }
}

function extensionBindingsGone() {
    try {
        const runtime = messagingRuntime();
        return !runtime || !runtime.id;
    } catch (e) {
        return true;
    }
}

function messagingFailureText(reason) {
    if (typeof reason === 'string') return reason || 'messaging failed';
    const message = reason && reason.message;
    return typeof message === 'string' && message ? message : 'messaging failed';
}

function sendRuntimeMessage(message, onResponse) {
    const wantsResponse = typeof onResponse === 'function';
    const deliver = (response, failure) => {
        if (!wantsResponse) return;
        try { onResponse(response, failure); } catch (e) { }
    };
    const giveUp = (reason) => {
        if (extensionBindingsGone()) noteExtensionContextLost();
        deliver(undefined, messagingFailureText(reason));
        return false;
    };
    const runtime = messagingRuntime();
    if (!runtime) return giveUp('Extension context invalidated.');
    try {
        if (wantsResponse) {
            runtime.sendMessage(message, (response) => {
                const failure = readRuntimeLastError();
                if (failure) { giveUp(failure); return; }
                deliver(response, '');
            });
        } else {
            const sending = runtime.sendMessage(message);
            if (sending && typeof sending.catch === 'function') {
                sending.catch(() => {
                    if (extensionBindingsGone()) noteExtensionContextLost();
                });
            }
        }
        return true;
    } catch (reason) {
        return giveUp(reason);
    }
}

function noteExtensionContextLost() {
    if (extensionContextLost) return;
    extensionContextLost = true;
    translationHasError = true;
    clearPendingRetranslation();
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    showExtensionContextLostPanel();
}

function extensionReloadedMessage() {
    return extensionContextLost ? localizedErrorCause('extensionReloaded') : '';
}

function showExtensionContextLostPanel() {
    if (!IS_TOP_FRAME) return;
    if (statusPanelPhase !== 'progress') return;
    if (!statusContainer || !statusShadowRoot) return;
    statusContainer.style.display = 'block';
    removeMinimizedIndicator();
    renderStatusPanel('error', { message: extensionReloadedMessage(), code: 'extensionReloaded' });
}

function querySessionDomainKnown(callback) {
    sendRuntimeMessage({ action: 'sessionIsDomainKnown' }, (response, failure) => {
        if (failure) { callback(false); return; }
        callback(!!response?.known);
    });
}

function rememberTranslatedDomain() {
    sendRuntimeMessage({ action: 'sessionMarkTranslated' });
}

function broadcastCancelToAllFrames() {
    translatingSubframes.clear();
    sendRuntimeMessage({ action: "cancelTranslation", allFrames: true }, (response, failure) => {
        if (failure) handleCancellation();
    });
}

function reportFrameTranslationState(translating) {
    if (IS_TOP_FRAME) return;
    sendRuntimeMessage({ action: "frameTranslationState", translating });
}

function trackSubframeTranslationState(report) {
    if (!IS_TOP_FRAME) return;
    const frameId = Number.isInteger(report?.frameId) ? report.frameId : -1;
    if (frameId <= 0) return;
    if (report.translating === true) translatingSubframes.add(frameId);
    else translatingSubframes.delete(frameId);
}

function subframeFailureError(report) {
    const cause = typeof report?.error === 'string' && report.error ? report.error : st.errorOccurred;
    const error = new Error(cause);
    error.translationErrorCode = typeof report?.code === 'string' ? report.code : '';
    return error;
}

function noteSubframeTranslationFailure(report) {
    if (!IS_TOP_FRAME) return;
    const failure = subframeFailureError(report);
    subframeFailures.push(failure);
    if (isTranslating) return;
    if (translationHasError) return;
    if (ensureStatusPanelForError()) showErrorPopup(failure.message, translationErrorCodeOf(failure));
}

function computeHasRemainingForPopup() {
    if (isTranslating || isApplyingUpdates) return false;
    const now = Date.now();
    if (now - popupRemainingMemo.ts < POPUP_STATE_MEMO_MS) return popupRemainingMemo.value;
    let remaining = false;
    try { remaining = hasTranslatableUnitsInDocument(); } catch (e) { remaining = false; }
    popupRemainingMemo = { ts: now, value: remaining };
    return remaining;
}

function collectPopupPageState() {
    let translatedBlocks = 0;
    let revertedBlocks = 0;
    let stuckTranslatedBlocks = 0;
    try {
        forEachMarkedElement(
            '[data-translation-status="translated"], [data-translation-status="original"], [data-translation-status="failed"]',
            block => {
                const status = block.dataset.translationStatus;
                if (status === 'translated') translatedBlocks++;
                else if (status === 'original') revertedBlocks++;
                else if ('translatedHtml' in block.dataset) stuckTranslatedBlocks++;
            }
        );
    } catch (e) { }
    const showingTranslation = translatedBlocks + stuckTranslatedBlocks;
    let translationStatus = 'idle';
    if (isTranslating || isApplyingUpdates || translatingSubframes.size > 0) translationStatus = 'translating';
    else if (translationHasError) translationStatus = 'error';
    else if (showingTranslation > 0 || revertedBlocks > 0) translationStatus = 'translated';
    const coverage = translationStatus === 'idle' ? measureCacheCoverage() : null;
    return {
        translationStatus,
        showingOriginal: showingTranslation === 0 && revertedBlocks > 0,
        mixedView: showingTranslation > 0 && revertedBlocks > 0,
        progress: translationProgress,
        stats: {
            batches: batchesProcessed,
            totalBatches,
            translatedFragments: translatedUnitsCount,
            totalFragments: expectedTotalUnits
        },
        restorableChars: coverage ? coverage.matched : 0,
        totalChars: coverage ? coverage.total : 0,
        cacheReadError: coverage ? coverage.error : '',
        hasUntranslatedText: translationStatus === 'translated' ? computeHasRemainingForPopup() : false
    };
}

function respondPopupPageState(sendResponse) {
    const pageState = collectPopupPageState();
    try {
        chrome.storage.local.get(['excludeList', 'alwaysTranslateList'], function (items) {
            const currentUrl = window.location.href;
            pageState.excluded = siteListMatchesUrl(items.excludeList, currentUrl);
            pageState.alwaysTranslate = siteListMatchesUrl(items.alwaysTranslateList, currentUrl);
            sendResponse(pageState);
        });
        return true;
    } catch (e) {
        pageState.excluded = false;
        pageState.alwaysTranslate = false;
        sendResponse(pageState);
        return false;
    }
}
