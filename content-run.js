async function startTranslation(userInitiated = false) {
    if (isTranslating) return;
    if (userInitiated) {
        translationCancelled = false;
        translationHasError = false;
        autoRetranslateRounds = 0;
        continueNoticeShown = false;
    }
    const cooldownRemaining = postNavigationCooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
        pendingAuthorizedRetranslation = true;
        clearTimeout(pendingStartTimer);
        pendingStartIsUserInitiated = userInitiated || pendingStartIsUserInitiated;
        pendingStartTimer = setTimeout(() => {
            pendingStartTimer = null;
            const wasUserInitiated = pendingStartIsUserInitiated;
            pendingStartIsUserInitiated = false;
            if (!translationStarted || isTranslating) return;
            if (!wasUserInitiated && (translationCancelled || translationHasError)) return;
            startTranslation(wasUserInitiated);
        }, cooldownRemaining + 200);
        return;
    }
    isTranslating = true;
    reportFrameTranslationState(true);
    await waitForPendingApply();
    const runGeneration = ++translationRunGeneration;
    subframeFailures = [];
    clearPendingRetranslation();
    translationCancelled = false;
    translationHasError = false;
    fatalErrorCancelPending = false;
    translatedUnitsCount = 0;
    totalBatches = 0;
    batchesProcessed = 0;
    modelWaitStartedAt = 0;
    modelResponded = false;
    expectedTotalUnits = 0;
    oversizedSkippedCount = 0;
    translationProgress = 0;
    domUpdateQueue = [];
    streamingBatchRegistry.clear();
    streamingActive = false;
    if (cacheRestoreActive) {
        try { applyCacheRestore(); } catch (e) { }
    }
    let lang = 'en';
    try {
        const config = await new Promise(resolve => {
            chrome.storage.local.get(['targetLanguage', 'showProgressPopup', 'batchSize', 'maxToken', 'toggleBlueBackground', 'streamingTranslation'], resolve);
        });
        lang = config.targetLanguage || 'en';
        highlightTranslated = config.toggleBlueBackground === true;
        streamingEnabled = config.streamingTranslation === true;
        useSessionMemoForLanguage(lang);
        applyStrings(lang);

        if (userInitiated) clearFailedMarkersForRetry();

        const allTus = collectTranslationUnits();
        if (allTus.length === 0) {
            isTranslating = false;
            reportNoTranslatableText(userInitiated);
            return;
        }

        const maxBatchLength = Number.isFinite(config.maxToken) ? Math.min(Math.floor(config.maxToken * 3), DEFAULTS.maxBatchLength) : DEFAULTS.maxBatchLength;
        const tus = [];
        const oversizedTus = [];
        for (const tu of allTus) {
            if (tu.template.length <= maxBatchLength) tus.push(tu);
            else oversizedTus.push(tu);
        }
        oversizedSkippedCount = oversizedTus.length;
        markUnitsFailed(oversizedTus.map(tu => tu.block), 'oversized');
        if (tus.length === 0) {
            isTranslating = false;
            if (oversizedSkippedCount > 0) handleTranslationError(createOversizedBlockError(), lang);
            else reportNoTranslatableText(userInitiated);
            return;
        }
        expectedTotalUnits = tus.length;

        const rememberedTranslations = [];
        const unresolvedTus = [];
        for (const tu of tus) {
            const remembered = recallTranslatedTemplate(tu.template);
            if (remembered) rememberedTranslations.push({ id: tu.id, translatedTemplate: remembered });
            else unresolvedTus.push(tu);
        }

        const batches = createBatches(unresolvedTus, config.batchSize || DEFAULTS.batchSize, maxBatchLength);
        totalBatches = batches.length;

        for (const tu of tus) {
            if (tu.block && tu.block.isConnected) {
                tu.block.dataset.translationStatus = 'processing';
                try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }
            }
        }

        if (rememberedTranslations.length > 0) {
            domUpdateQueue.push({ generation: runGeneration, translations: rememberedTranslations });
            applyQueuedUpdates();
        }

        if (config.showProgressPopup !== false && IS_TOP_FRAME) {
            createOrShowProgressPopup(lang);
            if (progressInterval) clearInterval(progressInterval);
            progressInterval = setInterval(() => updateProgress(), 300);
        }
        updateProgress();

        const failures = [];
        let cancelledBatchCount = 0;
        const resendUnitIds = new Set();
        const batchPromises = batches.map(batch =>
            processBatch(batch, runGeneration)
                .then(translations => {
                    if (runGeneration !== translationRunGeneration || translationCancelled) return;
                    modelResponded = true;
                    batchesProcessed++;
                    markMissingBatchUnitsFailed(batch, translations);
                    for (const id of unitsNotReturned(batch, translations)) resendUnitIds.add(id);
                    domUpdateQueue.push({ generation: runGeneration, translations });
                    applyQueuedUpdates();
                })
                .catch(error => {
                    if (runGeneration !== translationRunGeneration) return;
                    batchesProcessed++;
                    if (error?.translationCancelled === true) {
                        cancelledBatchCount++;
                        return;
                    }
                    if (!translationCancelled && !fatalErrorCancelPending
                        && error?.translationFatal !== true && isTemporaryBatchError(error)) {
                        for (const item of batch) resendUnitIds.add(item.id);
                        return;
                    }
                    if (isReasoningTimeoutError(error)) markUnitsFailed(blocksOfUnits(batch.map(item => item.id)), 'timeout');
                    failures.push(error);
                    if (error?.translationFatal === true && !fatalErrorCancelPending && !translationCancelled) {
                        fatalErrorCancelPending = true;
                        sendRuntimeMessage({ action: "cancelTranslation" });
                    }
                })
        );

        await Promise.allSettled(batchPromises);

        await new Promise(resolve => {
            const deadline = Date.now() + 30000;
            const interval = setInterval(() => {
                if ((!isApplyingUpdates && domUpdateQueue.length === 0) || translationCancelled || translationHasError || Date.now() > deadline) {
                    clearInterval(interval);
                    resolve();
                }
            }, 50);
        });

        if (!translationCancelled && !fatalErrorCancelPending
            && runGeneration === translationRunGeneration && resendUnitIds.size > 0) {
            await resendOnce(resendUnitIds, runGeneration);
            await new Promise(resolve => {
                const deadline = Date.now() + 30000;
                const interval = setInterval(() => {
                    if ((!isApplyingUpdates && domUpdateQueue.length === 0) || translationCancelled || translationHasError || Date.now() > deadline) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 50);
            });
        }

        if (runGeneration !== translationRunGeneration) {
            removeStatusIndicator();
            return;
        }
        if (translationCancelled) {
            handleCancellation(lang);
        } else if (failures.length > 0) {
            const fatalError = failures.find(f => f?.translationFatal === true);
            const blockingFailure = failures.find(f => !isReasoningTimeoutError(f));
            if (fatalError || translatedUnitsCount === 0) {
                handleTranslationError(fatalError || failures[0], lang);
            } else if (blockingFailure) {
                finishTranslationWithFailures(blockingFailure);
            } else {
                finishTranslation();
            }
        } else if (cancelledBatchCount > 0) {
            handleCancellation(lang);
        } else if (translatedUnitsCount === 0 && expectedTotalUnits > 0) {
            handleTranslationError(createNothingTranslatedError(), lang);
        } else if (subframeFailures.length > 0) {
            finishTranslationWithFailures(subframeFailures[0]);
        } else {
            finishTranslation();
        }
    } catch (error) {
        if (!translationCancelled) handleTranslationError(error, lang);
    } finally {
        isTranslating = false;
        reportFrameTranslationState(false);
        if (progressInterval) clearInterval(progressInterval);
        cleanupProcessingMarkers();
        scheduleRetranslationIfNeeded();
    }
}

function applyQueuedUpdates() {
    if (isApplyingUpdates) return pendingApplyPromise;
    isApplyingUpdates = true;
    const applyRun = drainDomUpdateQueue()
        .catch(() => { })
        .finally(() => {
            isApplyingUpdates = false;
            if (pendingApplyPromise === applyRun) pendingApplyPromise = null;
        });
    pendingApplyPromise = applyRun;
    return applyRun;
}

async function waitForPendingApply() {
    while (pendingApplyPromise) {
        const current = pendingApplyPromise;
        try { await current; } catch (e) { }
        if (pendingApplyPromise === current) pendingApplyPromise = null;
    }
}

function nextAnimationFrame() {
    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        try { requestAnimationFrame(finish); } catch (e) { }
        setTimeout(finish, 200);
    });
}

async function drainDomUpdateQueue() {
    disconnectAllObservers();
    const scrollAnchor = captureScrollAnchor();
    try {
        while (domUpdateQueue.length > 0) {
            if (translationCancelled) { domUpdateQueue = []; break; }
            const queued = domUpdateQueue.shift();
            if (!queued || queued.generation !== translationRunGeneration) continue;
            if (Array.isArray(queued.translations)) {
                for (const translated of queued.translations) {
                    const tu = translationUnits.get(translated.id);
                    if (tu && tu.block && tu.block.isConnected) {
                        applyTranslation(tu, translated.translatedTemplate);
                    }
                }
                restoreScrollAnchor(scrollAnchor);
            }
            await nextAnimationFrame();
        }
    } finally {
        restoreScrollAnchor(scrollAnchor);
        watchForNewContent();
    }
}

function handleStreamingUpdate(batchId, updates) {
    if (!Array.isArray(updates) || updates.length === 0) return;
    if (!isTranslating || translationCancelled || translationHasError) return;
    const registryEntry = streamingBatchRegistry.get(batchId);
    if (!registryEntry || registryEntry.generation !== translationRunGeneration) return;
    const translations = [];
    for (const update of updates) {
        if (!update || typeof update.key !== 'string' || typeof update.translatedTemplate !== 'string') continue;
        const tuId = registryEntry.keyToTuId.get(update.key);
        if (!tuId) continue;
        translations.push({ id: tuId, translatedTemplate: update.translatedTemplate });
    }
    if (translations.length === 0) return;
    modelResponded = true;
    markStreamingActive();
    domUpdateQueue.push({ generation: registryEntry.generation, translations });
    applyQueuedUpdates();
}

function captureScrollAnchor() {
    try {
        const centerX = Math.max(1, Math.floor(window.innerWidth / 2));
        const anchorY = Math.max(1, Math.floor(window.innerHeight * 0.25));
        const targets = document.elementsFromPoint(centerX, anchorY) || [];
        for (const el of targets) {
            if (!(el instanceof Element)) continue;
            if (el.dataset?.geminiIgnore === 'true') continue;
            if (isInsideExtensionUi(el)) continue;
            const rect = el.getBoundingClientRect();
            if (!isFinite(rect.top)) continue;
            return { el, offsetFromTop: rect.top };
        }
    } catch (e) { }
    return null;
}

function restoreScrollAnchor(anchor) {
    if (!anchor || !anchor.el || !anchor.el.isConnected) return;
    try {
        const newRect = anchor.el.getBoundingClientRect();
        const diff = newRect.top - anchor.offsetFromTop;
        if (Math.abs(diff) > 0.5) {
            window.scrollBy(0, diff);
        }
    } catch (e) { }
}

function handleTranslationError(error, lang) {
    if (!translationHasError && (error?.translationCancelled === true || translationCancelled)) {
        handleCancellation(lang);
        return;
    }
    translationHasError = true;
    let errorMessage = st.errorOccurred;
    if (error && error.message) {
        errorMessage = error.message;
    } else if (error) {
        errorMessage = `${st.errorOccurred}: ${JSON.stringify(error)}`;
    }
    const errorCode = translationErrorCodeOf(error);
    updateProgress();
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    cleanupProcessingMarkers();
    if (extensionContextLost) {
        showExtensionContextLostPanel();
        return;
    }
    if (ensureStatusPanelForError()) showErrorPopup(errorMessage, errorCode);
    sendRuntimeMessage({ action: "translationError", error: errorMessage, code: errorCode });
}

function translationErrorCodeOf(error) {
    return typeof error?.translationErrorCode === 'string' ? error.translationErrorCode : '';
}

function isTemporaryBatchError(error) {
    return TEMPORARY_BATCH_ERROR_CODES.has(translationErrorCodeOf(error));
}

function isReasoningTimeoutError(error) {
    return translationErrorCodeOf(error) === 'reasoningTimeout';
}

function resetPageTranslationState() {
    clearTimeout(observerDebounceTimer);
    disconnectAllObservers();
    try {
        forEachMarkedElement('[data-translation-status]', block => {
            if (block.dataset.geminiIgnore === 'true') return;
            if (block.dataset.translationStatus === 'translated') {
                try { revertBlockToOriginal(block); } catch (e) { }
            }
            block.classList.remove('translated-text');
            delete block.dataset.translationStatus;
            delete block.dataset.tuTemplate;
            delete block.dataset.tuTranslatedTemplate;
            delete block.dataset.originalHtml;
            delete block.dataset.translatedHtml;
        });
    } finally {
        watchForNewContent();
    }
    sessionTranslationMemo.clear();
    cacheRestoreMap = null;
    cacheRestoreActive = false;
    try { translationUnits.clear(); } catch (e) { }
    domUpdateQueue = [];
    streamingBatchRegistry.clear();
    translatedUnitsCount = 0;
    oversizedSkippedCount = 0;
    lastScrollScanHeight = -1;
    postFinishScanCount = 0;
}

async function clearPageCacheAndRetranslate() {
    if (isTranslating) return false;
    removeCacheRestoreNotice();
    await clearPageCache(await getStoredTargetLanguage());
    resetPageTranslationState();
    translationStarted = true;
    translationCancelled = false;
    translationHasError = false;
    rememberTranslatedDomain();
    startTranslation(true);
    return true;
}

function handleCancellation(lang) {
    translationCancelled = true;
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    updateProgress();
    restoreStatusPanelFromMinimized();
    renderStatusPanel('cancelled');
    cleanupProcessingMarkers();
    sendRuntimeMessage({ action: "translationCancelled" });
}

function oversizedSkippedLabel() {
    if (!st.blocksTooLong) return '';
    return st.blocksTooLong.replace('{count}', oversizedSkippedCount);
}

function createOversizedBlockError() {
    const error = new Error(oversizedSkippedLabel() || 'Blocks exceed the output token limit');
    error.translationErrorCode = 'blockTooLong';
    return error;
}

function createNothingTranslatedError() {
    const error = new Error(st.nothingTranslated || 'No block could be translated');
    error.translationErrorCode = 'nothingTranslated';
    return error;
}

function reportNoTranslatableText(userInitiated) {
    if (!userInitiated) return;
    if (ensureStatusPanelForError()) renderStatusPanel('empty');
}

function clearFailedMarkersForRetry() {
    forEachMarkedElement('[data-translation-status="failed"]', el => {
        delete el.dataset.translationStatus;
        delete el.dataset.translationFailReason;
    });
}

function retryFailedBlocks() {
    startTranslation(true);
}

async function processBatch(batch, runGeneration) {
    if (translationCancelled) {
        const cancelled = new Error('TRANSLATION_CANCELLED');
        cancelled.translationCancelled = true;
        cancelled.translationErrorCode = 'translationCancelled';
        throw cancelled;
    }
    const batchId = `${streamingBatchSeed}_${++streamingBatchCounter}`;
    const keyToTuId = new Map();
    batch.forEach((item, index) => keyToTuId.set(`TU_${index}`, item.id));
    streamingBatchRegistry.set(batchId, { keyToTuId, generation: runGeneration });
    if (!modelWaitStartedAt) modelWaitStartedAt = Date.now();
    return new Promise((resolve, reject) => {
        sendRuntimeMessage({ action: "translateBatch", batch, batchId }, (response, failure) => {
            streamingBatchRegistry.delete(batchId);
            if (failure) return reject(new Error(failure));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) return resolve(response.translations || []);
            const error = new Error(response.error || 'Translation failed');
            if (response.cancelled === true) error.translationCancelled = true;
            if (response.fatal === true) error.translationFatal = true;
            if (typeof response.code === 'string' && response.code) error.translationErrorCode = response.code;
            reject(error);
        });
    });
}

function unitAwaitingTranslation(id) {
    const block = translationUnits.get(id)?.block;
    return !!block && block.isConnected && block.dataset?.translationStatus !== 'translated';
}

async function resendOnce(unitIds, runGeneration) {
    const ids = Array.from(unitIds).filter(unitAwaitingTranslation).slice(0, AUTO_RESEND_MAX_UNITS);
    for (const id of ids) {
        if (translationCancelled || fatalErrorCancelPending) break;
        if (runGeneration !== translationRunGeneration) break;
        if (!unitAwaitingTranslation(id)) continue;
        const tu = translationUnits.get(id);
        try {
            const translations = await processBatch([{ id: tu.id, template: tu.template }], runGeneration);
            if (translationCancelled || runGeneration !== translationRunGeneration) break;
            markMissingBatchUnitsFailed([{ id: tu.id, template: tu.template }], translations);
            domUpdateQueue.push({ generation: runGeneration, translations });
            await applyQueuedUpdates();
        } catch (error) {
            if (error?.translationFatal === true) break;
        }
    }
    await waitForPendingApply();
    markUnitsFailed(blocksOfUnits(unitIds), 'temporary');
}

function handleCancelButtonClick() {
    translationCancelled = true;
    const currentHeader = statusShadowRoot?.querySelector('#translationHeaderText');
    const currentCancelBtn = statusShadowRoot?.querySelector('#cancelTranslationBtn');
    if (currentHeader) currentHeader.textContent = st.cancelling;
    if (currentCancelBtn) {
        currentCancelBtn.disabled = true;
        currentCancelBtn.textContent = st.cancelling;
    }
    broadcastCancelToAllFrames();
}

function finishTranslation() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    cacheRestoreMap = null;
    cacheRestoreActive = false;
    updateProgress(100);
    restoreStatusPanelFromMinimized();
    renderStatusPanel('done');
    const completionMessage = oversizedSkippedCount > 0 ? oversizedSkippedLabel() : st.translationCompleted;
    sendRuntimeMessage({ action: "translationComplete", message: completionMessage });
    saveCurrentTranslationToCache().catch(() => { });
    if (oversizedSkippedCount === 0 && countVisibleFailedBlocks() === 0) {
        cancelStatusAutoDismiss();
        statusAutoDismissTimer = setTimeout(() => {
            statusAutoDismissTimer = null;
            if (!isTranslating) removeStatusIndicator();
        }, 3000);
    }
    schedulePostFinishScans();
}

function finishTranslationWithFailures(error) {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    cacheRestoreMap = null;
    cacheRestoreActive = false;
    updateProgress();
    const errorMessage = error?.message || st.errorOccurred;
    const errorCode = translationErrorCodeOf(error);
    if (extensionContextLost) {
        showExtensionContextLostPanel();
    } else {
        if (ensureStatusPanelForError()) showErrorPopup(errorMessage, errorCode);
        sendRuntimeMessage({ action: "translationError", error: errorMessage, code: errorCode });
    }
    saveCurrentTranslationToCache().catch(() => { });
}
