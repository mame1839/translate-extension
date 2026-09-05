function autoTranslationBudgetLeft() {
    return autoRetranslateRounds < AUTO_RETRANSLATE_MAX_ROUNDS;
}

function clearPendingRetranslation() {
    pendingNewContentRetranslation = false;
    pendingAuthorizedRetranslation = false;
}

function isCurrentUrlExcluded() {
    try {
        return siteListMatchesUrl(currentExcludeList, window.location.href);
    } catch (e) {
        return false;
    }
}

function isExcludedSubframe() {
    return !IS_TOP_FRAME && isCurrentUrlExcluded();
}

function adoptSettingSnapshot(items) {
    autoTranslateNewContent = items.autoTranslateNewContent === true;
    hidePromptForAllSites = items.hidePromptAllSites === true;
    currentExcludeList = Array.isArray(items.excludeList) ? items.excludeList : [];
}

function watchSettingChanges() {
    if (settingWatcherAttached) return;
    settingWatcherAttached = true;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.autoTranslateNewContent) autoTranslateNewContent = changes.autoTranslateNewContent.newValue === true;
        if (changes.hidePromptAllSites) hidePromptForAllSites = changes.hidePromptAllSites.newValue === true;
        if (changes.excludeList) currentExcludeList = Array.isArray(changes.excludeList.newValue) ? changes.excludeList.newValue : [];
    });
}

function canAutoTranslateNewContent() {
    if (!translationStarted) return false;
    if (translationCancelled || translationHasError) return false;
    if (!autoTranslateNewContent) return false;
    if (isCurrentUrlExcluded()) return false;
    return autoTranslationBudgetLeft();
}

function startAutoTranslation() {
    autoRetranslateRounds++;
    startTranslation();
}

const observerConfig = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden', 'aria-hidden']
};

function initTranslation() {
    try {
        postFinishScanCount = 0;
        chrome.storage.local.get(
            ['targetLanguage', 'realTimeTranslation', 'excludeList', 'alwaysTranslateList', 'hidePromptAllSites', 'autoRetranslateDomain', 'toggleBlueBackground', 'autoTranslateNewContent'],
            async function (items) {
                try { watchForNewContent(); } catch (e) { }
                try { watchUserInteractions(); } catch (e) { }
                try { watchSpaUrlChanges(); } catch (e) { }
                try { watchScrollForNewContent(); } catch (e) { }
                try { watchSettingChanges(); } catch (e) { }

                const pageLang = getPageLanguage();
                const chosenLang = items.targetLanguage || 'en';
                applyStrings(chosenLang);
                adoptSettingSnapshot(items);

                const isReactSpa = isLikelyReactApp();
                const currentUrl = window.location.href;
                const isExcluded = siteListMatchesUrl(items.excludeList, currentUrl);
                const isAlwaysTranslate = !isExcluded && siteListMatchesUrl(items.alwaysTranslateList, currentUrl);
                if (!isReactSpa && !isExcluded) {
                    const restored = await tryRestoreFromCache(chosenLang);
                    const optedIntoAutoTranslation = (restored || cacheRestoreActive) && (items.realTimeTranslation === true
                        || isAlwaysTranslate
                        || (items.autoRetranslateDomain !== false && await new Promise(resolve => querySessionDomainKnown(resolve))));
                    if (optedIntoAutoTranslation) {
                        let restoredBlocks = 0;
                        try { restoredBlocks = applyCacheRestore(); } catch (e) { }
                        if (restoredBlocks > 0) {
                            if (items.toggleBlueBackground) {
                                try {
                                    forEachMarkedElement('[data-translation-status="translated"]', b => {
                                        if (b.dataset && b.dataset.geminiIgnore !== 'true') b.classList.add('translated-text');
                                    });
                                } catch (e) { }
                            }
                            if (!hidePromptForAllSites) showCacheRestoreNotice();
                            translationStarted = true;
                            rememberTranslatedDomain();
                            pendingAuthorizedRetranslation = true;
                            scheduleRetranslationIfNeeded();
                            return;
                        }
                    }
                }
                const languageDecision = resolvePageLanguageDecision(await detectContentLanguage(), pageLang, chosenLang);
                detectedPageLanguage = languageDecision.detectedSourceLanguage;

                const translationStarter = () => {
                    if (isTranslating) return;
                    if (!translationStarted) return;
                    startTranslation();
                };

                const autoRetranslateEnabled = items.autoRetranslateDomain !== false;

                const beginAutoTranslation = () => {
                    if (isExcluded) return;
                    if (languageDecision.skipAutoTranslation) {
                        if (languageDecision.skipAutoTranslationIsLowConfidence) showPromptIfNeeded(true);
                        return;
                    }
                    translationStarted = true;
                    setTimeout(translationStarter, 100);
                    setTimeout(translationStarter, 1500);
                };

                if (items.realTimeTranslation === true && !isReactSpa) {
                    beginAutoTranslation();
                    return;
                }

                if (isAlwaysTranslate && !isReactSpa) {
                    beginAutoTranslation();
                    return;
                }

                if (autoRetranslateEnabled && !isExcluded && !isReactSpa) {
                    querySessionDomainKnown((known) => {
                        if (known) {
                            beginAutoTranslation();
                            return;
                        }
                        showPromptIfNeeded();
                    });
                    return;
                }

                showPromptIfNeeded();

                function showPromptIfNeeded(promptEvenIfTargetLanguage) {
                    if (!IS_TOP_FRAME) return;
                    if (isExcluded) return;
                    if (languageDecision.pageIsTargetLanguage && !promptEvenIfTargetLanguage) return;
                    if (items.hidePromptAllSites !== true) {
                        createTranslationPrompt(false);
                    }
                }
            }
        );
    } catch (error) { }
}

let lastObservedUrl = '';
let spaWatcherAttached = false;
let spaPollIntervalId = null;

function watchSpaUrlChanges() {
    if (spaWatcherAttached) return;
    spaWatcherAttached = true;
    lastObservedUrl = window.location.href;
    const onChange = () => {
        const currentUrl = window.location.href;
        if (currentUrl === lastObservedUrl) return;
        lastObservedUrl = currentUrl;
        handleSpaNavigation();
    };
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    spaPollIntervalId = setInterval(onChange, 500);
    window.addEventListener('pagehide', () => {
        if (spaPollIntervalId !== null) {
            clearInterval(spaPollIntervalId);
            spaPollIntervalId = null;
        }
    }, { once: true });
}

function watchScrollForNewContent() {
    if (scrollListenersAttached) return;
    scrollListenersAttached = true;
    const handler = () => {
        clearTimeout(scrollDebounceTimer);
        scrollDebounceTimer = setTimeout(() => {
            if (!translationStarted) return;
            if (isTranslating || isApplyingUpdates || translationCancelled || translationHasError) return;
            if (Date.now() < postNavigationCooldownUntil) return;
            const scrollHeight = document.documentElement ? document.documentElement.scrollHeight : 0;
            if (scrollHeight === lastScrollScanHeight && !domChangedSinceScrollScan) return;
            lastScrollScanHeight = scrollHeight;
            domChangedSinceScrollScan = false;
            try {
                if (!hasTranslatableUnitsInDocument()) return;
                if (canAutoTranslateNewContent()) {
                    startAutoTranslation();
                } else {
                    maybeShowContinueNotice();
                }
            } catch (e) { }
        }, 800);
    };
    const keyHandler = (e) => {
        if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'End' || e.key === 'Home' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ') handler();
    };
    window.addEventListener('scroll', handler, { passive: true, capture: true });
    window.addEventListener('resize', handler, { passive: true });
    document.addEventListener('wheel', handler, { passive: true, capture: true });
    document.addEventListener('touchmove', handler, { passive: true, capture: true });
    document.addEventListener('keydown', keyHandler, { passive: true, capture: true });
}

async function handleSpaNavigation() {
    cacheRestoreMap = null;
    cacheRestoreActive = false;
    postNavigationCooldownUntil = Date.now() + 5000;
    clearTimeout(observerDebounceTimer);
    clearTimeout(userInteractionTimer);
    if (!pendingStartIsUserInitiated && pendingStartTimer !== null) {
        clearTimeout(pendingStartTimer);
        pendingStartTimer = null;
    }
    clearPendingRetranslation();
    lastScrollScanHeight = -1;
    autoRetranslateRounds = 0;
    continueNoticeShown = false;
    translationRunGeneration++;
    try { cleanupProcessingMarkers(); } catch (e) { }
    try { translationUnits.clear(); } catch (e) { }
    domUpdateQueue = [];
    streamingBatchRegistry.clear();
}

const mutationCallback = (mutations) => {
    if (translationHasError) return;
    if (!translationStarted) return;
    const withinCooldown = Date.now() < postNavigationCooldownUntil;
    let hasRelevantChange = false;
    for (const mutation of mutations) {
        if (isInsideExtensionUi(mutation.target)) continue;
        domChangedSinceScrollScan = true;
        if (withinCooldown) return;
        if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (target && target.nodeType === Node.ELEMENT_NODE && !isFullyExcluded(target)) {
                if (hasUntranslatedDescendant(target)) hasRelevantChange = true;
            }
            continue;
        }
        if (mutation.type === 'characterData') {
            const parent = mutation.target.parentElement;
            if (parent && !isFullyExcluded(parent) && !isInsideEditableHost(parent) && isTranslatableText(mutation.target.textContent)) {
                const block = findBlockAncestor(parent);
                if (block) {
                    const status = block.dataset?.translationStatus;
                    if (status !== 'translated' && status !== 'processing' && status !== 'original') {
                        hasRelevantChange = true;
                    }
                }
            }
            continue;
        }
        if (mutation.type !== 'childList') continue;
        const targetInsideEditableHost = isInsideEditableHost(mutation.target);
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && !replayingDrainedMutations) {
                attachObserversTo(node);
            }
            if (!targetInsideEditableHost && containsTranslatableContent(node)) {
                hasRelevantChange = true;
            }
        }
    }
    if (hasRelevantChange && translationStarted && !translationCancelled) {
        if (!canAutoTranslateNewContent()) {
            maybeShowContinueNotice();
        } else if (isTranslating || isApplyingUpdates) {
            pendingNewContentRetranslation = true;
        } else {
            clearTimeout(observerDebounceTimer);
            observerDebounceTimer = setTimeout(() => {
                if (canAutoTranslateNewContent() && !isTranslating && !isApplyingUpdates) {
                    startAutoTranslation();
                }
            }, 600);
        }
    }
};

function attachObserversTo(root) {
    if (!root) return;
    if (root instanceof ShadowRoot) {
        if (root.host?.dataset?.geminiIgnore === 'true') return;
        observeMutationRoot(root);
        attachShadowRootObserversWithin(root);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.dataset?.geminiIgnore === 'true') return;
    if (root === document.body) observeMutationRoot(root);
    if (root.shadowRoot) attachObserversTo(root.shadowRoot);
    attachShadowRootObserversWithin(root);
}

function observeMutationRoot(root) {
    if (observedRoots.has(root)) return;
    try {
        const observer = new MutationObserver(mutationCallback);
        observer.observe(root, observerConfig);
        activeObservers.push(observer);
        observedRoots.add(root);
    } catch (e) { }
}

function attachShadowRootObserversWithin(root) {
    if (!root.querySelectorAll) return;
    try {
        for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot && !observedRoots.has(el.shadowRoot)) {
                attachObserversTo(el.shadowRoot);
            }
        }
    } catch (e) { }
}

function watchForNewContent() {
    disconnectAllObservers();
    domChangedSinceScrollScan = true;
    if (document.body) {
        attachObserversTo(document.body);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) attachObserversTo(document.body);
        });
    }
}

function watchUserInteractions() {
    if (userInteractionListenersAttached) return;
    userInteractionListenersAttached = true;
    const navigationClickHandler = (e) => {
        try {
            const target = e.target?.closest?.('a, button, [role="link"], [role="button"], [role="tab"], [role="menuitem"]');
            if (!target) return;
            postNavigationCooldownUntil = Math.max(postNavigationCooldownUntil, Date.now() + 5000);
            cacheRestoreMap = null;
            cacheRestoreActive = false;
            clearTimeout(observerDebounceTimer);
            clearTimeout(userInteractionTimer);
            clearPendingRetranslation();
        } catch (err) { }
    };
    const handler = () => {
        if (!translationStarted) return;
        if (translationCancelled || translationHasError) return;
        if (Date.now() < postNavigationCooldownUntil) return;
        clearTimeout(userInteractionTimer);
        userInteractionTimer = setTimeout(() => {
            if (!translationStarted) return;
            if (translationCancelled || translationHasError) return;
            if (Date.now() < postNavigationCooldownUntil) return;
            if (isTranslating || isApplyingUpdates) {
                if (canAutoTranslateNewContent()) pendingNewContentRetranslation = true;
                return;
            }
            if (!cacheRestoreActive && !hasTranslatableUnitsInDocument()) return;
            if (canAutoTranslateNewContent()) {
                startAutoTranslation();
            } else {
                maybeShowContinueNotice();
            }
        }, 800);
    };
    document.addEventListener('click', navigationClickHandler, { capture: true, passive: true });
    document.addEventListener('click', handler, { capture: true, passive: true });
    document.addEventListener('focusin', handler, { capture: true, passive: true });
    document.addEventListener('keyup', handler, { capture: true, passive: true });
}

function disconnectAllObservers() {
    const drained = [];
    activeObservers.forEach(obs => {
        try {
            const records = obs.takeRecords();
            if (records && records.length > 0) drained.push(...records);
        } catch (e) { }
        try { obs.disconnect(); } catch (e) { }
    });
    activeObservers = [];
    observedRoots = new WeakSet();
    if (drained.length > 0) {
        replayingDrainedMutations = true;
        try { mutationCallback(drained); } catch (e) { }
        replayingDrainedMutations = false;
    }
}

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
        markOversizedUnitsSkipped(oversizedTus);
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
                    if (isReasoningTimeoutError(error)) markBatchUnitsTimedOut(batch);
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

function scheduleRetranslationIfNeeded() {
    if (!translationStarted) return;
    if (translationCancelled || translationHasError) return;
    if (isTranslating || isApplyingUpdates) return;
    if (!pendingNewContentRetranslation && !pendingAuthorizedRetranslation) return;
    const authorized = (pendingAuthorizedRetranslation && autoTranslationBudgetLeft())
        || (pendingNewContentRetranslation && canAutoTranslateNewContent());
    clearPendingRetranslation();
    if (!authorized) {
        maybeShowContinueNotice();
        return;
    }
    clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
        if (translationStarted && !isTranslating && !translationCancelled && !translationHasError) {
            startAutoTranslation();
        }
    }, 600);
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
    for (const id of unitIds) {
        const block = translationUnits.get(id)?.block;
        if (!block || !block.isConnected) continue;
        if (block.dataset?.translationStatus === 'translated') continue;
        try {
            block.dataset.translationStatus = 'failed';
            block.dataset.translationFailReason = 'temporary';
        } catch (e) { }
    }
}

function reattachCommentAnchors(commentAnchors) {
    if (!commentAnchors) return;
    const sequenceByScope = new Map();
    for (const entry of commentAnchors) {
        let sequence = sequenceByScope.get(entry.scope);
        if (!sequence) {
            sequence = [];
            sequenceByScope.set(entry.scope, sequence);
        }
        sequence.push(entry.node);
    }
    sequenceByScope.forEach((sequence, scope) => {
        let pending = null;
        for (const node of sequence) {
            if (node.nodeType === Node.COMMENT_NODE) {
                if (!pending) pending = [];
                pending.push(node);
                continue;
            }
            if (!pending || node.parentNode !== scope) continue;
            try {
                for (const comment of pending) scope.insertBefore(comment, node);
                pending = null;
            } catch (e) { }
        }
        if (!pending) return;
        try {
            for (const comment of pending) scope.appendChild(comment);
        } catch (e) { }
    });
}

function applyTemplateWithPlaceholders(tu, template) {
    const normalized = normalizeTranslatedTemplate(template, tu.placeholders);
    const parsed = parseTemplateFragment(normalized);
    if (!parsed) return false;

    const newChildren = [];
    for (const child of parsed.childNodes) {
        const restored = restoreNode(child, tu.placeholders);
        if (restored) newChildren.push(restored);
    }

    if (typeof tu.block.replaceChildren === 'function') {
        tu.block.replaceChildren(...newChildren);
    } else {
        while (tu.block.firstChild) tu.block.removeChild(tu.block.firstChild);
        for (const child of newChildren) tu.block.appendChild(child);
    }
    reattachCommentAnchors(tu.commentAnchors);
    return true;
}

function templateSignature(parsedNode, placeholders, referencePlaceholders) {
    let signature = '';
    for (const child of parsedNode.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) signature += 'T:' + text + '\n';
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const match = child.nodeName.toLowerCase().match(/^([atbs])(\d+)$/);
        if (!match) {
            signature += templateSignature(child, placeholders, referencePlaceholders);
            continue;
        }
        const entry = placeholders[parseInt(match[2], 10)];
        const node = entry ? entry.node : null;
        let name = 'P?' + match[0];
        if (node) {
            const index = referencePlaceholders.findIndex(reference => reference.node === node);
            if (index >= 0) name = 'P' + index;
        }
        signature += name + '\n';
        if (entry && (entry.type === 'tag' || entry.type === 'anchor')) {
            signature += templateSignature(child, placeholders, referencePlaceholders);
        }
        signature += '/' + name + '\n';
    }
    return signature;
}

function appliedResultMatchesTranslation(tu, translatedTemplate) {
    for (const entry of tu.placeholders) {
        if (!entry.node || !tu.block.contains(entry.node)) return false;
    }
    const wanted = parseTemplateFragment(normalizeTranslatedTemplate(translatedTemplate, tu.placeholders));
    if (!wanted) return false;
    const applied = buildTU(tu.block);
    if (!applied) return false;
    const appliedFragment = parseTemplateFragment(applied.template);
    if (!appliedFragment) return false;
    return templateSignature(appliedFragment, applied.placeholders, tu.placeholders) ===
        templateSignature(wanted, tu.placeholders, tu.placeholders);
}

function snapshotSubtree(node) {
    const entry = { node, children: [] };
    if (node.nodeType === Node.TEXT_NODE) {
        entry.value = node.nodeValue;
        return entry;
    }
    for (const child of node.childNodes) entry.children.push(snapshotSubtree(child));
    return entry;
}

function restoreSubtree(entry) {
    if (entry.node.nodeType === Node.TEXT_NODE) {
        if (entry.node.nodeValue !== entry.value) entry.node.nodeValue = entry.value;
        return;
    }
    for (const child of entry.children) restoreSubtree(child);
    const wanted = entry.children.map(child => child.node);
    const current = entry.node.childNodes;
    let identical = current.length === wanted.length;
    for (let index = 0; identical && index < wanted.length; index++) {
        if (current[index] !== wanted[index]) identical = false;
    }
    if (identical) return;
    if (typeof entry.node.replaceChildren === 'function') {
        entry.node.replaceChildren(...wanted);
    } else {
        while (entry.node.firstChild) entry.node.removeChild(entry.node.firstChild);
        for (const child of wanted) entry.node.appendChild(child);
    }
}

function discardApplyThatDidNotMatch(tu, fromCacheRestore, snapshot) {
    try { restoreSubtree(snapshot); } catch (e) { }
    try { blockTranslationLanguage.delete(tu.block); } catch (e) { }
    try { delete tu.block.dataset.translationStatus; } catch (e) { }
    try { delete tu.block.dataset.translatedHtml; } catch (e) { }
    try { delete tu.block.dataset.tuTranslatedTemplate; } catch (e) { }
    try { tu.block.classList.remove('translated-text'); } catch (e) { }
    if (tu.progressCounted) {
        tu.progressCounted = false;
        translatedUnitsCount--;
    }
    return markApplyFailed(tu, fromCacheRestore);
}

function blockContainsCustomElement(block) {
    if (block.nodeName.indexOf('-') !== -1) return true;
    for (const element of block.querySelectorAll('*')) {
        if (element.nodeName.indexOf('-') !== -1) return true;
    }
    return false;
}

function collectRearrangedChildren(parsedNode, placeholders, parentNode, plan) {
    const wanted = [];
    for (const child of parsedNode.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            wanted.push({ text: child.textContent || '' });
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const match = child.nodeName.toLowerCase().match(/^([atbs])(\d+)$/);
        if (!match) {
            const unwrapped = collectRearrangedChildren(child, placeholders, parentNode, plan);
            if (!unwrapped) return null;
            for (const item of unwrapped) wanted.push(item);
            continue;
        }
        const entry = placeholders[parseInt(match[2], 10)];
        if (!entry || !entry.node) return null;
        const bothNodeKeeping = (match[1] === 'b' || match[1] === 's') &&
            (entry.type === 'block' || entry.type === 'skip');
        if (entry.ph !== `${match[1]}${match[2]}` && !bothNodeKeeping) return null;
        if (entry.node.parentNode !== parentNode) return null;
        wanted.push({ node: entry.node });
        if (entry.type === 'tag' || entry.type === 'anchor') {
            const inner = collectRearrangedChildren(child, placeholders, entry.node, plan);
            if (!inner) return null;
            plan.push({ parent: entry.node, wanted: inner });
        }
    }
    return wanted;
}

function placeNodeBefore(parent, node, reference) {
    if (node.parentNode === parent && typeof parent.moveBefore === 'function') {
        try {
            parent.moveBefore(node, reference);
            return;
        } catch (e) { }
    }
    parent.insertBefore(node, reference);
}

function applyRearrangementPlan(plan, allowElementMoves) {
    for (const step of plan) {
        const parent = step.parent;
        const spareTexts = [];
        for (const child of parent.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) spareTexts.push(child);
        }
        let spareCursor = 0;
        const ordered = [];
        for (const item of step.wanted) {
            if (item.node) {
                ordered.push(item.node);
                continue;
            }
            let textNode = spareTexts[spareCursor];
            if (textNode) spareCursor++;
            else textNode = document.createTextNode('');
            textNode.nodeValue = item.text;
            ordered.push(textNode);
        }
        let cursor = parent.firstChild;
        for (const node of ordered) {
            if (cursor === node) {
                cursor = cursor.nextSibling;
                continue;
            }
            if (!allowElementMoves && node.nodeType === Node.ELEMENT_NODE) return false;
            placeNodeBefore(parent, node, cursor);
        }
        for (let index = spareCursor; index < spareTexts.length; index++) {
            spareTexts[index].nodeValue = '';
        }
    }
    return true;
}

function blockAllowsElementMoves(block) {
    if (typeof block.moveBefore === 'function') return true;
    return !blockContainsCustomElement(block);
}

function rearrangementKeepsTranslatableText(plan) {
    for (const step of plan) {
        let liveHasText = false;
        for (const child of step.parent.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && isTranslatableText(child.nodeValue)) {
                liveHasText = true;
                break;
            }
        }
        if (!liveHasText) continue;
        let translatedHasText = false;
        for (const item of step.wanted) {
            if (item.text !== undefined && isTranslatableText(item.text)) {
                translatedHasText = true;
                break;
            }
        }
        if (!translatedHasText) return false;
    }
    return true;
}

function planRearrangementToTemplate(tu, template) {
    const parsed = parseTemplateFragment(normalizeTranslatedTemplate(template, tu.placeholders));
    if (!parsed) return null;
    const plan = [];
    const topLevel = collectRearrangedChildren(parsed, tu.placeholders, tu.block, plan);
    if (!topLevel) return null;
    plan.push({ parent: tu.block, wanted: topLevel });
    return plan;
}

function rearrangeWithoutRebuilding(tu, translatedTemplate, fromCacheRestore) {
    if (!blockAllowsElementMoves(tu.block)) return false;
    const plan = planRearrangementToTemplate(tu, translatedTemplate);
    if (!plan) return false;
    if (!rearrangementKeepsTranslatableText(plan)) return false;

    const snapshot = snapshotSubtree(tu.block);
    try {
        if (!applyRearrangementPlan(plan, true)) {
            restoreSubtree(snapshot);
            return false;
        }
    } catch (e) {
        restoreSubtree(snapshot);
        return false;
    }
    if (!appliedResultMatchesTranslation(tu, translatedTemplate)) {
        restoreSubtree(snapshot);
        return false;
    }
    try { tu.block.dataset.tuTranslatedTemplate = translatedTemplate; } catch (e) { }
    try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }
    try {
        if (!('originalHtml' in tu.block.dataset)) tu.block.dataset.originalHtml = tu.originalInnerHTML;
        tu.block.dataset.translatedHtml = tu.block.innerHTML;
        tu.block.dataset.translationStatus = 'translated';
    } catch (e) { }
    if (highlightTranslated) tu.block.classList.add('translated-text');
    else tu.block.classList.remove('translated-text');
    countTranslatedUnitOnce(tu, fromCacheRestore);
    return true;
}

function applyTranslation(tu, translatedTemplate, fromCacheRestore) {
    if (!tu || !tu.block || !tu.block.isConnected) return;
    let snapshot = null;
    try { snapshot = snapshotSubtree(tu.block); } catch (e) { }
    if (!snapshot) return markApplyFailed(tu, fromCacheRestore);
    if (shouldUseTextOnlyApply(tu.block)) {
        applyTranslationInPlace(tu, translatedTemplate, fromCacheRestore);
    } else {
        applyTranslationByReplacement(tu, translatedTemplate, fromCacheRestore);
    }
    try {
        if (tu.block.dataset?.translationStatus === 'translated' &&
            appliedResultMatchesTranslation(tu, translatedTemplate)) {
            acceptAppliedTranslation(tu, translatedTemplate);
            return;
        }
        discardApplyThatDidNotMatch(tu, fromCacheRestore, snapshot);
        if (!rearrangeWithoutRebuilding(tu, translatedTemplate, fromCacheRestore)) return;
        acceptAppliedTranslation(tu, translatedTemplate);
    } catch (e) {
        discardApplyThatDidNotMatch(tu, fromCacheRestore, snapshot);
    }
}

function acceptAppliedTranslation(tu, translatedTemplate) {
    rememberTranslatedTemplate(tu.template, translatedTemplate);
    try { blockTranslationLanguage.set(tu.block, sessionTranslationMemoLang); } catch (e) { }
}

function markApplyFailed(tu, fromCacheRestore) {
    if (fromCacheRestore) return false;
    try {
        tu.block.dataset.translationStatus = 'failed';
        tu.block.dataset.translationFailReason = 'apply';
    } catch (e) { }
    return false;
}

function applyTranslationByReplacement(tu, translatedTemplate, fromCacheRestore) {
    try {
        try { tu.block.dataset.tuTranslatedTemplate = translatedTemplate; } catch (e) { }
        try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }

        if (!('originalHtml' in tu.block.dataset)) {
            tu.block.dataset.originalHtml = tu.originalInnerHTML;
        }

        if (!applyTemplateWithPlaceholders(tu, translatedTemplate)) return markApplyFailed(tu, fromCacheRestore);

        tu.block.dataset.translatedHtml = tu.block.innerHTML;
        tu.block.dataset.translationStatus = 'translated';
        if (highlightTranslated) {
            tu.block.classList.add('translated-text');
        } else {
            tu.block.classList.remove('translated-text');
        }
        countTranslatedUnitOnce(tu, fromCacheRestore);
        return true;
    } catch (e) {
        return markApplyFailed(tu, fromCacheRestore);
    }
}

function countTranslatedUnitOnce(tu, fromCacheRestore) {
    if (fromCacheRestore) return;
    if (tu.progressCounted) return;
    tu.progressCounted = true;
    translatedUnitsCount++;
}

function isInsideReactCustomElement(node) {
    let anc = node?.parentElement;
    while (anc && anc !== document.documentElement) {
        const name = anc.nodeName;
        if (name === 'REACT-APP' || name === 'REACT-PARTIAL') return true;
        anc = anc.parentElement;
    }
    return false;
}

function shouldUseTextOnlyApply(node) {
    if (isInsideReactCustomElement(node)) return true;
    if (isShadowHostingCustomElement(node) || isInsideShadowHostingCustomElement(node)) return true;
    try { if (isLikelyReactApp()) return true; } catch (e) { }
    return false;
}

function isExcludedFromTextRuns(element) {
    const status = element.dataset?.translationStatus;
    if (status === 'translated' || status === 'original') return true;
    if (BLOCK_TAGS.has(element.nodeName) || isShadowHostingCustomElement(element) || isBlockLikeAnchorInShadowHost(element)) return true;
    return isFullyExcluded(element);
}

function collectLiveTextRuns(block) {
    const runs = [];
    let runOpen = false;
    const visitLive = (parent, insideAnchor) => {
        for (const child of parent.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (!runOpen) {
                    runs.push({ nodes: [], translatable: false });
                    runOpen = true;
                }
                const run = runs[runs.length - 1];
                run.nodes.push(child);
                if (isTranslatableText(text)) run.translatable = true;
                continue;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            if (isExcludedFromTextRuns(child)) {
                runOpen = false;
                continue;
            }
            if (child.nodeName === 'A' && insideAnchor) {
                visitLive(child, true);
                continue;
            }
            runOpen = false;
            visitLive(child, insideAnchor || child.nodeName === 'A');
            runOpen = false;
        }
    };
    visitLive(block, false);
    return runs;
}

function placeholderNameOfNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
    const name = node.nodeName.toLowerCase();
    return /^[atbs]\d+$/.test(name) ? name : '';
}

function slotKeyWithin(node, root, nameOf, allowedScopeNames) {
    let scope = node.parentNode;
    let scopeName = '';
    while (scope && scope !== root) {
        const name = nameOf(scope);
        if (name && (!allowedScopeNames || allowedScopeNames.has(name))) {
            scopeName = name;
            break;
        }
        scope = scope.parentNode;
    }
    if (!scope) return null;
    let atScopeLevel = node;
    while (atScopeLevel && atScopeLevel.parentNode !== scope) atScopeLevel = atScopeLevel.parentNode;
    if (!atScopeLevel) return null;
    let previous = atScopeLevel.previousSibling;
    while (previous) {
        const name = nameOf(previous);
        if (name) return scopeName + '>' + name;
        previous = previous.previousSibling;
    }
    return scopeName + '>';
}

function collectSlotTexts(parsed, liveScopeNames) {
    const bySlot = new Map();
    const byScope = new Map();
    const slotKeysByScope = new Map();
    const translatedScopes = new Set();
    const walker = document.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
        const value = node.nodeValue;
        if (!value) continue;
        const key = slotKeyWithin(node, parsed, placeholderNameOfNode, liveScopeNames);
        if (key === null) continue;
        const scopeName = key.slice(0, key.indexOf('>'));
        const slotTexts = bySlot.get(key);
        if (slotTexts) {
            slotTexts.push(value);
        } else {
            bySlot.set(key, [value]);
            const scopeKeys = slotKeysByScope.get(scopeName);
            if (scopeKeys) scopeKeys.push(key);
            else slotKeysByScope.set(scopeName, [key]);
        }
        const scopeTexts = byScope.get(scopeName);
        if (scopeTexts) scopeTexts.push(value);
        else byScope.set(scopeName, [value]);
        if (isTranslatableText(value)) translatedScopes.add(scopeName);
    }
    return { bySlot, byScope, slotKeysByScope, translatedScopes };
}

function collectLiveRunSlots(tu, runs) {
    const placeholderNames = new Map();
    for (const entry of tu.placeholders) {
        if (entry.node) placeholderNames.set(entry.node, entry.ph);
    }
    const nameOf = node => placeholderNames.get(node) || '';
    const scopes = new Map();
    for (const run of runs) {
        if (run.nodes.length === 0) continue;
        const key = slotKeyWithin(run.nodes[0], tu.block, nameOf, null);
        if (key === null) continue;
        const scopeName = key.slice(0, key.indexOf('>'));
        let scope = scopes.get(scopeName);
        if (!scope) {
            scope = { runs: [], slots: new Map() };
            scopes.set(scopeName, scope);
        }
        scope.runs.push(run);
        const slotRuns = scope.slots.get(key);
        if (slotRuns) slotRuns.push(run);
        else scope.slots.set(key, [run]);
    }
    return scopes;
}

function writeRunText(run, value) {
    run.nodes.forEach((node, index) => {
        node.nodeValue = index === 0 ? value : '';
    });
}

function planScopeWrites(scope, scopeName, translated, writes) {
    const translatedKeys = translated.slotKeysByScope.get(scopeName) || [];
    const everySegmentHasASlot = translatedKeys.every(key => scope.slots.has(key));

    if (!everySegmentHasASlot) {
        const scopeTexts = translated.byScope.get(scopeName);
        const target = scope.runs.find(run => run.translatable) || scope.runs[0];
        writes.push({ run: target, value: scopeTexts.join('') });
        for (const run of scope.runs) {
            if (run !== target && run.translatable) writes.push({ run, value: '' });
        }
        return;
    }

    scope.slots.forEach((slotRuns, key) => {
        const texts = translated.bySlot.get(key);
        if (!texts) {
            for (const run of slotRuns) {
                if (run.translatable) writes.push({ run, value: '' });
            }
            return;
        }
        if (texts.length === slotRuns.length) {
            slotRuns.forEach((run, index) => writes.push({ run, value: texts[index] }));
            return;
        }
        writes.push({ run: slotRuns[0], value: texts.join('') });
        for (let index = 1; index < slotRuns.length; index++) {
            if (slotRuns[index].translatable) writes.push({ run: slotRuns[index], value: '' });
        }
    });
}

function planSlotWrites(scopes, translated) {
    const writes = [];
    let everyScopeTranslated = true;
    scopes.forEach((scope, scopeName) => {
        const scopeNeedsText = scope.runs.some(run => run.translatable);
        if (scopeNeedsText && !translated.translatedScopes.has(scopeName)) {
            everyScopeTranslated = false;
            return;
        }
        if (!translated.byScope.has(scopeName)) return;
        planScopeWrites(scope, scopeName, translated, writes);
    });
    if (!everyScopeTranslated) return null;
    return writes.length > 0 ? writes : null;
}

function applyTemplateTextOnly(tu, template) {
    const normalized = normalizeTranslatedTemplate(template, tu.placeholders);
    const parsed = parseTemplateFragment(normalized);
    if (!parsed) return false;

    let runs = tu.textRuns;
    const runsAreLive = Array.isArray(runs) &&
        runs.every(run => run.nodes.every(node => tu.block.contains(node)));
    if (!runsAreLive) runs = collectLiveTextRuns(tu.block);
    if (!runs.some(run => run.translatable)) return false;

    const scopes = collectLiveRunSlots(tu, runs);
    if (scopes.size === 0) return false;

    const translated = collectSlotTexts(parsed, new Set(scopes.keys()));
    if (translated.translatedScopes.size === 0) return false;

    const writes = planSlotWrites(scopes, translated);
    if (!writes) return false;

    for (const write of writes) writeRunText(write.run, write.value);
    return true;
}

function applyTranslationInPlace(tu, translatedTemplate, fromCacheRestore) {
    try {
        try { tu.block.dataset.tuTranslatedTemplate = translatedTemplate; } catch (e) { }
        try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }
        if (!applyTemplateTextOnly(tu, translatedTemplate)) return markApplyFailed(tu, fromCacheRestore);
        if (!('originalHtml' in tu.block.dataset)) {
            try { tu.block.dataset.originalHtml = tu.originalInnerHTML; } catch (e) { }
        }
        try {
            tu.block.dataset.translatedHtml = tu.block.innerHTML;
            tu.block.dataset.translationStatus = 'translated';
        } catch (e) { }
        if (highlightTranslated) tu.block.classList.add('translated-text');
        else tu.block.classList.remove('translated-text');
        countTranslatedUnitOnce(tu, fromCacheRestore);
        return true;
    } catch (e) {
        return markApplyFailed(tu, fromCacheRestore);
    }
}

function normalizeTranslatedTemplate(tpl, placeholders) {
    let s = (tpl || '').trim();
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
    s = s.replace(/<([atbs])(\d+)\s*\/>/g, '<$1$2></$1$2>');
    const present = new Set();
    const nodeKeepingIds = new Set();
    const tagRe = /<\/?([atbs])(\d+)\b[^>]*>/g;
    let m;
    while ((m = tagRe.exec(s)) !== null) {
        present.add(`${m[1]}${m[2]}`);
        if (m[1] === 'b' || m[1] === 's') nodeKeepingIds.add(parseInt(m[2], 10));
    }
    for (let i = 0; i < placeholders.length; i++) {
        const ph = placeholders[i];
        if (present.has(ph.ph)) continue;
        if (ph.type === 'block' || ph.type === 'skip') {
            if (nodeKeepingIds.has(i)) continue;
            s += `<${ph.ph}></${ph.ph}>`;
        } else if (ph.type === 'anchor' && ph.originalText) {
            s += `<${ph.ph}>${escapeHtml(ph.originalText)}</${ph.ph}>`;
        }
    }
    return s;
}

function parseTemplateFragment(html) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
        return doc.body;
    } catch (e) {
        return null;
    }
}

const PARSE_CONTEXT_WRAPPERS = {
    TABLE: ['<table>', '</table>'],
    THEAD: ['<table><thead>', '</thead></table>'],
    TBODY: ['<table><tbody>', '</tbody></table>'],
    TFOOT: ['<table><tfoot>', '</tfoot></table>'],
    TR: ['<table><tbody><tr>', '</tr></tbody></table>']
};

function collectContextParsedChildren(parsedBody, contextTagName) {
    const contextElement = parsedBody.querySelector(contextTagName.toLowerCase());
    if (!contextElement) return null;
    let wrapperRoot = contextElement;
    while (wrapperRoot.parentNode && wrapperRoot.parentNode !== parsedBody) {
        wrapperRoot = wrapperRoot.parentNode;
    }
    const fosterParented = Array.from(parsedBody.childNodes).filter(node => node !== wrapperRoot);
    return [...contextElement.childNodes, ...fosterParented];
}

function setBlockContent(block, html) {
    const wrapper = PARSE_CONTEXT_WRAPPERS[block.tagName];
    const parsedBody = parseTemplateFragment(wrapper ? wrapper[0] + html + wrapper[1] : html);
    if (!parsedBody) return;
    const newChildren = wrapper
        ? collectContextParsedChildren(parsedBody, block.tagName)
        : Array.from(parsedBody.childNodes);
    if (!newChildren) return;
    if (typeof block.replaceChildren === 'function') {
        block.replaceChildren(...newChildren);
    } else {
        while (block.firstChild) block.removeChild(block.firstChild);
        for (const child of newChildren) block.appendChild(child);
    }
}

function restoreNode(parsedNode, placeholders) {
    if (parsedNode.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(parsedNode.textContent || '');
    }
    if (parsedNode.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = parsedNode.nodeName.toLowerCase();
    const match = tag.match(/^([atbs])(\d+)$/);
    if (match) {
        const idx = parseInt(match[2], 10);
        const entry = placeholders[idx];
        if (!entry) return document.createTextNode(parsedNode.textContent || '');
        const bothNodeKeeping = (match[1] === 'b' || match[1] === 's') &&
            (entry.type === 'block' || entry.type === 'skip');
        if (entry.ph !== `${match[1]}${match[2]}` && !bothNodeKeeping) {
            return document.createTextNode(parsedNode.textContent || '');
        }
        if (entry.type === 'tag' || entry.type === 'anchor') {
            const originalNode = entry.node;
            if (!originalNode) return null;
            const newChildren = [];
            for (const child of parsedNode.childNodes) {
                const restored = restoreNode(child, placeholders);
                if (restored) newChildren.push(restored);
            }
            if (typeof originalNode.replaceChildren === 'function') {
                originalNode.replaceChildren(...newChildren);
            } else {
                while (originalNode.firstChild) originalNode.removeChild(originalNode.firstChild);
                for (const child of newChildren) originalNode.appendChild(child);
            }
            return originalNode;
        }
        if (entry.type === 'block' || entry.type === 'skip') {
            return entry.node || null;
        }
        return null;
    }

    return document.createTextNode(parsedNode.textContent || '');
}

function placeholderOrderFromAppliedTemplate(template, count) {
    if (typeof template !== 'string' || !template) return null;
    const order = [];
    const seen = new Set();
    const tagRe = /<([atbs])(\d+)\b[^>]*>/g;
    let match;
    while ((match = tagRe.exec(template)) !== null) {
        const index = parseInt(match[2], 10);
        if (index >= count || seen.has(index)) return null;
        seen.add(index);
        order.push(index);
    }
    for (let index = 0; index < count; index++) {
        if (!seen.has(index)) order.push(index);
    }
    return order;
}

function placeholdersInOriginalOrder(tu, appliedTemplate) {
    const order = placeholderOrderFromAppliedTemplate(appliedTemplate, tu.placeholders.length);
    if (!order) return null;
    const ordered = new Array(tu.placeholders.length);
    for (let position = 0; position < order.length; position++) {
        const entry = tu.placeholders[position];
        const originalIndex = order[position];
        ordered[originalIndex] = Object.assign({}, entry, { ph: entry.ph.charAt(0) + originalIndex });
    }
    return ordered;
}

function writeBlockBackToTemplate(tu, originalTemplate, textOnly) {
    if (!textOnly) return applyTemplateWithPlaceholders(tu, originalTemplate);
    const plan = planRearrangementToTemplate(tu, originalTemplate);
    if (!plan) return false;
    return applyRearrangementPlan(plan, blockAllowsElementMoves(tu.block));
}

function revertBlockToOriginal(block) {
    const textOnly = shouldUseTextOnlyApply(block);
    const originalTemplate = block.dataset.tuTemplate;
    const appliedTemplate = block.dataset.tuTranslatedTemplate;
    if (typeof originalTemplate === 'string' && originalTemplate) {
        try {
            const tu = buildTU(block);
            const ordered = tu ? placeholdersInOriginalOrder(tu, appliedTemplate) : null;
            if (ordered) {
                tu.placeholders = ordered;
                if (appliedResultMatchesTranslation(tu, appliedTemplate)) {
                    const snapshot = snapshotSubtree(block);
                    let restored = false;
                    try {
                        restored = writeBlockBackToTemplate(tu, originalTemplate, textOnly) &&
                            appliedResultMatchesTranslation(tu, originalTemplate);
                    } catch (e) { }
                    if (restored) return true;
                    restoreSubtree(snapshot);
                }
            }
        } catch (e) { }
    }
    if (textOnly) return false;
    if (typeof block.dataset.originalHtml === 'string') {
        setBlockContent(block, block.dataset.originalHtml);
        return true;
    }
    return false;
}

function restoreTranslatedHtmlFallback(block) {
    if (shouldUseTextOnlyApply(block)) return;
    if ('translatedHtml' in block.dataset) {
        setBlockContent(block, block.dataset.translatedHtml);
        block.dataset.translationStatus = 'translated';
        if (highlightTranslated) block.classList.add('translated-text');
        else block.classList.remove('translated-text');
    }
}

function toggleAllTranslations(requestedView) {
    if (isTranslating) return;
    clearTimeout(observerDebounceTimer);
    disconnectAllObservers();
    try {
        const blocks = [];
        forEachMarkedElement(
            '[data-translation-status="translated"], [data-translation-status="original"]',
            block => blocks.push(block)
        );
        if (blocks.length === 0) return;
        let shouldRevert = blocks.some(block => block.dataset.translationStatus === 'translated');
        if (requestedView === 'original') shouldRevert = true;
        else if (requestedView === 'translation') shouldRevert = false;
        blocks.forEach(block => {
            if (shouldRevert) {
                if (block.dataset.translationStatus !== 'translated') return;
                if (revertBlockToOriginal(block)) {
                    block.dataset.translationStatus = 'original';
                    block.classList.remove('translated-text');
                } else {
                    block.dataset.translationStatus = 'failed';
                }
                return;
            }
            if (block.dataset.translationStatus === 'translated') return;
            if (typeof block.dataset.tuTranslatedTemplate === 'string' && block.dataset.tuTranslatedTemplate) {
                try {
                    const tu = buildTU(block);
                    if (tu && tu.hasTranslatableText) {
                        applyTranslation(tu, block.dataset.tuTranslatedTemplate, true);
                    } else {
                        restoreTranslatedHtmlFallback(block);
                    }
                } catch (e) {
                    restoreTranslatedHtmlFallback(block);
                }
            } else {
                restoreTranslatedHtmlFallback(block);
            }
        });
        translationStarted = !shouldRevert;
    } finally {
        watchForNewContent();
        clearTimeout(observerDebounceTimer);
    }
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

function schedulePostFinishScans() {
    for (const delay of POST_FINISH_SCAN_DELAYS) {
        setTimeout(() => {
            if (!translationStarted) return;
            if (isTranslating || translationCancelled) return;
            if (Date.now() < postNavigationCooldownUntil) return;
            if (postFinishScanCount >= POST_FINISH_MAX_SCANS) return;
            try {
                if (!hasTranslatableUnitsInDocument()) return;
                if (!canAutoTranslateNewContent()) {
                    maybeShowContinueNotice();
                    return;
                }
                postFinishScanCount++;
                startAutoTranslation();
            } catch (e) { }
        }, delay);
    }
}

const SELECTION_CONTAINER_ID = 'gemini-translator-selection-container';
const SELECTION_MAX_CHARS = 5000;
const SELECTION_RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);
const SELECTION_FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif`;
const SELECTION_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const SELECTION_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .sel-card {
            width: 340px;
            max-width: calc(100vw - 24px);
            padding: 12px 14px 14px;
            background: #ffffff;
            border: 1px solid rgba(27, 27, 33, 0.09);
            border-radius: 16px;
            box-shadow: 0 2px 6px 2px rgba(23, 23, 40, 0.08), 0 1px 2px rgba(23, 23, 40, 0.10);
            color: #1b1b21;
            font-family: ${SELECTION_FONT};
            font-size: 13.5px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            animation: selCardIn 160ms ${SELECTION_EASE};
        }
        @keyframes selCardIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .sel-head {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
        }
        .sel-badge {
            width: 24px;
            height: 24px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: #d3e3fd;
            color: #041e49;
        }
        .sel-title {
            flex: 1;
            min-width: 0;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.04em;
            color: #1a73e8;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .sel-title.error { color: #ba1a1a; }
        .sel-icon-btn {
            width: 28px;
            height: 28px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: none;
            border-radius: 999px;
            background: transparent;
            color: #4a4952;
            cursor: pointer;
            transition: background-color 150ms ${SELECTION_EASE};
        }
        .sel-icon-btn:hover { background: #f5f5fa; }
        .sel-icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.35); }
        .sel-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 2px 0 4px;
            color: #4a4952;
        }
        .sel-spinner {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            border-radius: 50%;
            border: 2px solid rgba(26, 115, 232, 0.25);
            border-top-color: #1a73e8;
            animation: selSpin 800ms linear infinite;
        }
        @keyframes selSpin { to { transform: rotate(360deg); } }
        .sel-text {
            margin: 0;
            max-height: 260px;
            overflow-y: auto;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
            font-size: 14px;
            color: #1b1b21;
        }
        .sel-error {
            margin: 0;
            max-height: 220px;
            overflow-y: auto;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
            padding: 10px 12px;
            border-radius: 12px;
            background: #ffe1de;
            color: #7a1210;
            font-size: 12.5px;
        }
        .sel-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 12px;
        }
        .sel-btn {
            min-height: 36px;
            padding: 0 16px;
            border: none;
            border-radius: 999px;
            background: #d3e3fd;
            color: #041e49;
            font-family: inherit;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 150ms ${SELECTION_EASE}, box-shadow 150ms ${SELECTION_EASE};
        }
        .sel-btn:hover { box-shadow: 0 1px 2px rgba(23, 23, 40, 0.10), 0 1px 3px 1px rgba(23, 23, 40, 0.06); }
        .sel-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.35); }
        .sel-btn.secondary { background: transparent; color: #1a73e8; box-shadow: inset 0 0 0 1px rgba(27, 27, 33, 0.16); }
        .sel-btn.secondary:hover { background: #f5f5fa; box-shadow: inset 0 0 0 1px rgba(27, 27, 33, 0.24); }
        .sel-note { margin: 10px 0 0; overflow-wrap: anywhere; font-size: 12.5px; color: #4a4952; }
        .sel-note.done { color: #146c2e; font-weight: 600; }
        @media (prefers-color-scheme: dark) {
            .sel-card {
                background: #1a1a20;
                border-color: rgba(232, 231, 240, 0.09);
                color: #e5e4ea;
                box-shadow: 0 2px 6px 2px rgba(0, 0, 0, 0.32), 0 1px 2px rgba(0, 0, 0, 0.4);
            }
            .sel-badge { background: #0842a0; color: #d3e3fd; }
            .sel-title { color: #8ab4f8; }
            .sel-title.error { color: #ffb4ab; }
            .sel-icon-btn { color: #b6b5bf; }
            .sel-icon-btn:hover { background: #1e1e24; }
            .sel-icon-btn:focus-visible { box-shadow: 0 0 0 3px rgba(138, 180, 248, 0.4); }
            .sel-loading { color: #b6b5bf; }
            .sel-spinner { border-color: rgba(138, 180, 248, 0.25); border-top-color: #8ab4f8; }
            .sel-text { color: #e5e4ea; }
            .sel-error { background: #6e2621; color: #ffdad5; }
            .sel-btn { background: #0842a0; color: #d3e3fd; }
            .sel-btn:hover { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 1px 3px 1px rgba(0, 0, 0, 0.25); }
            .sel-btn:focus-visible { box-shadow: 0 0 0 3px rgba(138, 180, 248, 0.4); }
            .sel-btn.secondary { background: transparent; color: #8ab4f8; box-shadow: inset 0 0 0 1px rgba(232, 231, 240, 0.18); }
            .sel-btn.secondary:hover { background: #1e1e24; box-shadow: inset 0 0 0 1px rgba(232, 231, 240, 0.26); }
            .sel-note { color: #b6b5bf; }
            .sel-note.done { color: #6dd58c; }
        }
    `;

let selectionContainer = null;
let selectionShadowRoot = null;
let selectionAnchorRange = null;
let selectionAnchorPoint = null;
let selectionCopyTimer = null;
let selectionStrings = null;
let selectionIsRtl = false;
let selectionRequestId = 0;
let selectionListenersAttached = false;
let selectionReplaceIntent = false;
let selectionReplacePlan = null;
let selectionUndoTarget = null;
const selectionNodeOriginals = new WeakMap();

function watchSelectionPointer() {
    try {
        document.addEventListener('contextmenu', function (event) {
            selectionAnchorPoint = { x: event.clientX, y: event.clientY };
        }, true);
    } catch (e) { }
}

function selectionLabel(key, fallback) {
    const value = selectionStrings ? selectionStrings[key] : null;
    return (typeof value === 'string' && value) ? value : fallback;
}

function createSelectionIcon(size, shapes) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.25');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const [shapeTag, shapeAttrs] of shapes) {
        const shape = document.createElementNS(ns, shapeTag);
        for (const [attrName, attrValue] of Object.entries(shapeAttrs)) {
            shape.setAttribute(attrName, attrValue);
        }
        svg.appendChild(shape);
    }
    return svg;
}

function isInsideSkippedContainer(node) {
    let el = node && node.nodeType !== Node.ELEMENT_NODE ? node.parentElement : node;
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.documentElement) {
        if (INLINE_SKIP_TAGS.has(el.nodeName)) return true;
        el = el.parentElement || (el.getRootNode?.() instanceof ShadowRoot ? el.getRootNode().host : null);
    }
    return false;
}

function isEligibleReplaceBlock(block) {
    if (!block || !block.isConnected) return false;
    const status = block.dataset ? block.dataset.translationStatus : undefined;
    if (status === 'translated' || status === 'processing' || status === 'original') return false;
    if (isFullyExcluded(block)) return false;
    return true;
}

function selectionTextNodeIsRejected(node) {
    return isInsideEditableHost(node) || isInsideSkippedContainer(node);
}

function blocksTouchedByRange(range) {
    const blocks = [];
    const seen = new Set();
    if (!range) return blocks;
    let root = range.commonAncestorContainer;
    if (root && root.nodeType === Node.TEXT_NODE) root = root.parentNode;
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return blocks;
    let walker;
    try {
        walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    } catch (e) {
        return blocks;
    }
    let tn;
    while (tn = walker.nextNode()) {
        let intersects = false;
        try { intersects = range.intersectsNode(tn); } catch (e) { intersects = false; }
        if (!intersects) continue;
        let sub = tn.nodeValue || '';
        if (tn === range.startContainer && tn === range.endContainer) sub = sub.slice(range.startOffset, range.endOffset);
        else if (tn === range.startContainer) sub = sub.slice(range.startOffset);
        else if (tn === range.endContainer) sub = sub.slice(0, range.endOffset);
        if (!isTranslatableText(sub)) continue;
        if (selectionTextNodeIsRejected(tn)) continue;
        const block = findBlockAncestor(tn);
        if (!block || seen.has(block)) continue;
        if (!isEligibleReplaceBlock(block)) continue;
        seen.add(block);
        blocks.push(block);
    }
    return blocks;
}

function classifySelectionForReplace(range) {
    if (!range) return { kind: 'reject', reason: 'norange' };
    let startContainer, endContainer;
    try {
        startContainer = range.startContainer;
        endContainer = range.endContainer;
    } catch (e) {
        return { kind: 'reject', reason: 'norange' };
    }
    if (!startContainer || !endContainer) return { kind: 'reject', reason: 'norange' };
    let startRoot = null, endRoot = null;
    try { startRoot = startContainer.getRootNode(); } catch (e) { }
    try { endRoot = endContainer.getRootNode(); } catch (e) { }
    if (startRoot !== endRoot) return { kind: 'reject', reason: 'shadow' };
    if (selectionTextNodeIsRejected(startContainer) || selectionTextNodeIsRejected(endContainer)) {
        return { kind: 'reject', reason: 'editable' };
    }
    if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
        const startOffset = range.startOffset;
        const endOffset = range.endOffset;
        const value = startContainer.nodeValue || '';
        const slice = value.slice(startOffset, endOffset);
        if (endOffset > startOffset && isTranslatableText(slice)) {
            return { kind: 'node', node: startContainer, startOffset, endOffset };
        }
    }
    const blocks = blocksTouchedByRange(range);
    if (blocks.length === 0) return { kind: 'reject', reason: 'noblocks' };
    return { kind: 'blocks', blocks };
}

function replaceSingleTextNode(node, startOffset, endOffset, translation) {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.isConnected) return false;
    if (typeof translation !== 'string') return false;
    const value = node.nodeValue || '';
    if (startOffset < 0 || endOffset > value.length || endOffset <= startOffset) return false;
    if (!selectionNodeOriginals.has(node)) selectionNodeOriginals.set(node, value);
    node.nodeValue = value.slice(0, startOffset) + translation + value.slice(endOffset);
    return true;
}

function restoreReplacedTextNode(node) {
    if (!node || !selectionNodeOriginals.has(node)) return false;
    const original = selectionNodeOriginals.get(node);
    try {
        if (node.isConnected) node.nodeValue = original;
    } catch (e) {
        return false;
    }
    selectionNodeOriginals.delete(node);
    return true;
}

function requestSelectionBatch(batch) {
    return new Promise(resolve => {
        const payload = batch.map(tu => ({ id: tu.id, template: tu.template }));
        sendRuntimeMessage({ action: 'translateBatch', batch: payload }, (response, failure) => {
            if (failure) { resolve({ error: failure }); return; }
            if (!response) { resolve({ error: 'noResponse' }); return; }
            if (response.success) { resolve({ translations: response.translations || [] }); return; }
            resolve({
                error: typeof response.error === 'string' ? response.error : 'failed',
                code: typeof response.code === 'string' ? response.code : '',
                cancelled: response.cancelled === true,
                fatal: response.fatal === true
            });
        });
    });
}

async function runSelectionBlockReplace(blocks) {
    const config = await new Promise(resolve => {
        try {
            chrome.storage.local.get(['targetLanguage', 'batchSize', 'maxToken', 'toggleBlueBackground'], resolve);
        } catch (e) {
            resolve({});
        }
    });
    const lang = (config && config.targetLanguage) || 'en';
    useSessionMemoForLanguage(lang);
    try { applyStrings(lang); } catch (e) { }
    highlightTranslated = config.toggleBlueBackground === true;
    const maxBatchLength = Number.isFinite(config.maxToken) ? Math.min(Math.floor(config.maxToken * 3), DEFAULTS.maxBatchLength) : DEFAULTS.maxBatchLength;

    const tus = [];
    const byId = new Map();
    let counter = 0;
    for (const block of blocks) {
        if (!isEligibleReplaceBlock(block)) continue;
        const tu = buildTU(block);
        if (!tu || !tu.hasTranslatableText) continue;
        if (tu.template.length > maxBatchLength) continue;
        tu.id = `sel_${Date.now()}_${counter++}`;
        tus.push(tu);
        byId.set(tu.id, tu);
    }
    if (tus.length === 0) return { total: 0, applied: 0, failed: 0, failure: null };

    for (const tu of tus) {
        try {
            tu.block.dataset.translationStatus = 'processing';
            tu.block.dataset.tuTemplate = tu.template;
        } catch (e) { }
    }

    const batches = createBatches(tus, config.batchSize || DEFAULTS.batchSize, maxBatchLength);
    const hadObservers = activeObservers.length > 0;
    let failure = null;
    disconnectAllObservers();
    try {
        for (const batch of batches) {
            const result = await requestSelectionBatch(batch);
            if (result.error) {
                if (!failure) failure = result;
                continue;
            }
            const returned = new Set();
            for (const item of (result.translations || [])) {
                if (!item || typeof item.translatedTemplate !== 'string') continue;
                const tu = byId.get(item.id);
                if (!tu || !tu.block || !tu.block.isConnected) continue;
                returned.add(item.id);
                try { applyTranslation(tu, item.translatedTemplate, true); } catch (e) { }
            }
            for (const tu of batch) {
                if (returned.has(tu.id)) continue;
                if (tu.block && tu.block.dataset && tu.block.dataset.translationStatus === 'processing') {
                    try { delete tu.block.dataset.translationStatus; } catch (e) { }
                }
            }
        }
    } finally {
        for (const tu of tus) {
            if (tu.block && tu.block.dataset && tu.block.dataset.translationStatus === 'processing') {
                try { delete tu.block.dataset.translationStatus; } catch (e) { }
            }
        }
        if (hadObservers) watchForNewContent();
    }

    let applied = 0;
    for (const tu of tus) {
        if (tu.block && tu.block.dataset && tu.block.dataset.translationStatus === 'translated') applied++;
    }
    if (applied > 0) saveCurrentTranslationToCache().catch(() => { });
    return { total: tus.length, applied, failed: tus.length - applied, failure };
}

function showSelectionTranslation(rawText, replaceIntent) {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) return;
    selectionReplaceIntent = replaceIntent === true;
    selectionReplacePlan = null;
    selectionUndoTarget = null;
    captureSelectionAnchor();
    chrome.storage.local.get(['targetLanguage'], function (items) {
        const lang = (items && items.targetLanguage) || 'en';
        selectionStrings = (typeof getT === 'function') ? getT(lang) : null;
        selectionIsRtl = SELECTION_RTL_LANGS.has(String(lang).split('-')[0]);
        openSelectionPopup();
        if (!selectionShadowRoot) return;
        if (text.length > SELECTION_MAX_CHARS) {
            const template = selectionLabel('selTooLong', 'Selection is too long (up to {max} characters).');
            renderSelectionError(template.replace('{max}', String(SELECTION_MAX_CHARS)));
            return;
        }
        renderSelectionLoading();
        requestSelectionTranslation(text);
    });
}

function captureSelectionAnchor() {
    selectionAnchorRange = null;
    try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
            selectionAnchorRange = selection.getRangeAt(0).cloneRange();
        }
    } catch (e) { }
}

function selectionErrorText(code, rawMessage) {
    const messageKey = ERROR_CODE_MESSAGE_KEYS[code];
    if (messageKey) {
        const localized = selectionLabel(messageKey, '');
        if (localized) return localized;
    }
    return rawMessage;
}

function requestSelectionTranslation(text) {
    const requestId = ++selectionRequestId;
    const genericError = selectionLabel('error', 'An error occurred');
    const handleFailure = (message) => {
        if (requestId !== selectionRequestId) return;
        renderSelectionError(message || genericError);
    };
    sendRuntimeMessage({ action: 'translateSelection', text }, function (response, failure) {
        if (requestId !== selectionRequestId) return;
        if (failure) { handleFailure(extensionReloadedMessage() || failure); return; }
        if (!response) { handleFailure(genericError); return; }
        if (response.cancelled) { closeSelectionPopup(); return; }
        if (response.success) {
            renderSelectionResult(typeof response.translation === 'string' ? response.translation : '');
            return;
        }
        handleFailure(selectionErrorText(response.code, response.error));
    });
}

function openSelectionPopup() {
    closeSelectionPopup();
    const host = document.body || document.documentElement;
    if (!host) return;
    selectionContainer = document.createElement('div');
    selectionContainer.id = SELECTION_CONTAINER_ID;
    selectionContainer.dataset.geminiIgnore = 'true';
    selectionContainer.style.cssText = 'position:fixed!important;top:0!important;left:0!important;margin:0!important;padding:0!important;border:none!important;display:block!important;z-index:2147483647!important;';
    selectionShadowRoot = attachUiShadowRoot(selectionContainer);

    const style = document.createElement('style');
    style.textContent = SELECTION_CSS;
    selectionShadowRoot.appendChild(style);

    const card = document.createElement('div');
    card.className = 'sel-card';
    card.setAttribute('dir', selectionIsRtl ? 'rtl' : 'ltr');

    const head = document.createElement('div');
    head.className = 'sel-head';

    const badge = document.createElement('span');
    badge.className = 'sel-badge';
    badge.appendChild(createSelectionIcon('14', [
        ['path', { d: 'm5 8 6 6' }],
        ['path', { d: 'm4 14 6-6 2-3' }],
        ['path', { d: 'M2 5h12' }],
        ['path', { d: 'M7 2h1' }],
        ['path', { d: 'm22 22-5-10-5 10' }],
        ['path', { d: 'M14 18h6' }]
    ]));

    const title = document.createElement('span');
    title.className = 'sel-title';
    title.id = 'selPanelTitle';
    title.textContent = selectionLabel('selTitle', 'Translation');

    const closeLabel = selectionLabel('selClose', 'Close');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sel-icon-btn';
    closeBtn.type = 'button';
    closeBtn.title = closeLabel;
    closeBtn.setAttribute('aria-label', closeLabel);
    closeBtn.appendChild(createSelectionIcon('14', [
        ['line', { x1: '6', y1: '6', x2: '18', y2: '18' }],
        ['line', { x1: '18', y1: '6', x2: '6', y2: '18' }]
    ]));
    addUserClickListener(closeBtn, function () { closeSelectionPopup(); });

    head.appendChild(badge);
    head.appendChild(title);
    head.appendChild(closeBtn);

    const body = document.createElement('div');
    body.id = 'selPanelBody';

    card.appendChild(head);
    card.appendChild(body);
    selectionShadowRoot.appendChild(card);
    host.appendChild(selectionContainer);
    attachSelectionListeners();
    positionSelectionPopup();
}

function setSelectionBody(node) {
    if (!selectionShadowRoot) return;
    const body = selectionShadowRoot.getElementById('selPanelBody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (node) body.appendChild(node);
}

function setSelectionTitle(text, isError) {
    if (!selectionShadowRoot) return;
    const title = selectionShadowRoot.getElementById('selPanelTitle');
    if (!title) return;
    title.textContent = text;
    title.classList.toggle('error', isError === true);
}

function clearSelectionActions() {
    if (!selectionShadowRoot) return;
    const actions = selectionShadowRoot.querySelector('.sel-actions');
    if (actions && actions.parentNode) actions.parentNode.removeChild(actions);
}

function renderSelectionLoading() {
    if (!selectionShadowRoot) return;
    clearSelectionActions();
    setSelectionTitle(selectionLabel('selTitle', 'Translation'), false);
    const wrap = document.createElement('div');
    wrap.className = 'sel-loading';
    const spinner = document.createElement('span');
    spinner.className = 'sel-spinner';
    const label = document.createElement('span');
    label.textContent = selectionLabel('selLoading', 'Translating…');
    wrap.appendChild(spinner);
    wrap.appendChild(label);
    setSelectionBody(wrap);
    positionSelectionPopup();
}

function appendSelectionNote(message) {
    if (!selectionShadowRoot) return;
    const body = selectionShadowRoot.getElementById('selPanelBody');
    if (!body) return;
    const note = document.createElement('p');
    note.className = 'sel-note';
    note.setAttribute('dir', 'auto');
    note.textContent = message;
    body.appendChild(note);
}

function selectionReplaceButtonLabel(plan) {
    return plan.kind === 'node'
        ? selectionLabel('selReplaceSelection', 'Replace selection')
        : selectionLabel('selReplaceBlock', 'Replace paragraph');
}

function renderSelectionResult(translation) {
    if (!selectionShadowRoot) return;
    clearSelectionActions();
    setSelectionTitle(selectionLabel('selTitle', 'Translation'), false);
    const paragraph = document.createElement('p');
    paragraph.className = 'sel-text';
    paragraph.setAttribute('dir', 'auto');
    paragraph.textContent = translation;
    setSelectionBody(paragraph);

    selectionReplacePlan = classifySelectionForReplace(selectionAnchorRange);
    const canReplace = selectionReplacePlan && (selectionReplacePlan.kind === 'node' || selectionReplacePlan.kind === 'blocks');
    if (!canReplace && selectionReplaceIntent) {
        appendSelectionNote(selectionLabel('selReplaceUnavailable', 'This selection cannot be replaced here'));
    }

    const actions = document.createElement('div');
    actions.className = 'sel-actions';
    if (canReplace) {
        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'sel-btn';
        replaceBtn.type = 'button';
        replaceBtn.textContent = selectionReplaceButtonLabel(selectionReplacePlan);
        addUserClickListener(replaceBtn, function () { onSelectionReplaceClick(translation); });
        actions.appendChild(replaceBtn);
    }
    const copyBtn = document.createElement('button');
    copyBtn.className = canReplace ? 'sel-btn secondary' : 'sel-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = selectionLabel('selCopy', 'Copy');
    addUserClickListener(copyBtn, function () { copySelectionTranslation(translation, copyBtn); });
    actions.appendChild(copyBtn);
    const card = selectionShadowRoot.querySelector('.sel-card');
    if (card) card.appendChild(actions);
    positionSelectionPopup();
}

function onSelectionReplaceClick(translation) {
    const plan = selectionReplacePlan;
    if (!plan) return;
    if (plan.kind === 'node') {
        if (replaceSingleTextNode(plan.node, plan.startOffset, plan.endOffset, translation)) {
            selectionUndoTarget = { kind: 'node', node: plan.node };
            renderSelectionReplaced(true);
        } else {
            renderSelectionReplaceFailure(null);
        }
        return;
    }
    if (plan.kind !== 'blocks') return;
    const requestId = ++selectionRequestId;
    renderSelectionReplacing();
    runSelectionBlockReplace(plan.blocks).then(result => {
        if (requestId !== selectionRequestId) return;
        if (result && result.applied > 0) renderSelectionReplaced(false);
        else renderSelectionReplaceFailure(result ? result.failure : null);
    }).catch(() => {
        if (requestId !== selectionRequestId) return;
        renderSelectionReplaceFailure(null);
    });
}

function renderSelectionReplacing() {
    if (!selectionShadowRoot) return;
    clearSelectionActions();
    setSelectionTitle(selectionLabel('selTitle', 'Translation'), false);
    const wrap = document.createElement('div');
    wrap.className = 'sel-loading';
    const spinner = document.createElement('span');
    spinner.className = 'sel-spinner';
    const label = document.createElement('span');
    label.textContent = selectionLabel('selReplacing', 'Replacing…');
    wrap.appendChild(spinner);
    wrap.appendChild(label);
    setSelectionBody(wrap);
    positionSelectionPopup();
}

function renderSelectionReplaced(showUndo) {
    if (!selectionShadowRoot) return;
    clearSelectionActions();
    setSelectionTitle(selectionLabel('selTitle', 'Translation'), false);
    const box = document.createElement('p');
    box.className = 'sel-note done';
    box.setAttribute('dir', 'auto');
    box.textContent = selectionLabel('selReplaced', 'Replaced');
    setSelectionBody(box);
    if (showUndo) {
        const actions = document.createElement('div');
        actions.className = 'sel-actions';
        const undoBtn = document.createElement('button');
        undoBtn.className = 'sel-btn';
        undoBtn.type = 'button';
        undoBtn.textContent = selectionLabel('selUndo', 'Undo');
        addUserClickListener(undoBtn, function () { onSelectionUndoClick(); });
        actions.appendChild(undoBtn);
        const card = selectionShadowRoot.querySelector('.sel-card');
        if (card) card.appendChild(actions);
    }
    positionSelectionPopup();
}

function renderSelectionReplaceFailure(failure) {
    let message = selectionLabel('selReplaceFailed', 'Could not replace the selection');
    if (failure) {
        const localized = selectionErrorText(failure.code, failure.error);
        if (localized) message = localized;
    }
    renderSelectionError(message);
}

function onSelectionUndoClick() {
    if (selectionUndoTarget && selectionUndoTarget.kind === 'node') {
        restoreReplacedTextNode(selectionUndoTarget.node);
    }
    selectionUndoTarget = null;
    closeSelectionPopup();
}

function renderSelectionError(message) {
    if (!selectionShadowRoot) return;
    clearSelectionActions();
    setSelectionTitle(selectionLabel('error', 'An error occurred'), true);
    const box = document.createElement('div');
    box.className = 'sel-error';
    box.setAttribute('dir', 'auto');
    box.textContent = message;
    setSelectionBody(box);
    positionSelectionPopup();
}

function copySelectionTranslation(translation, button) {
    const finish = (copied) => {
        if (selectionCopyTimer) clearTimeout(selectionCopyTimer);
        button.textContent = copied
            ? selectionLabel('selCopied', 'Copied')
            : selectionLabel('selCopyFailed', 'Copy failed');
        selectionCopyTimer = setTimeout(function () {
            selectionCopyTimer = null;
            try { button.textContent = selectionLabel('selCopy', 'Copy'); } catch (e) { }
        }, 1600);
    };
    try {
        const writing = navigator.clipboard?.writeText(translation);
        if (writing && typeof writing.then === 'function') {
            writing.then(() => finish(true)).catch(() => finish(copySelectionFallback(translation)));
            return;
        }
    } catch (e) { }
    finish(copySelectionFallback(translation));
}

function copySelectionFallback(translation) {
    let holder = null;
    try {
        holder = document.createElement('textarea');
        holder.value = translation;
        holder.setAttribute('readonly', '');
        holder.dataset.geminiIgnore = 'true';
        holder.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
        (document.body || document.documentElement).appendChild(holder);
        holder.select();
        return document.execCommand('copy');
    } catch (e) {
        return false;
    } finally {
        if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    }
}

function selectionAnchorRect() {
    if (selectionAnchorRange) {
        try {
            const rect = selectionAnchorRange.getBoundingClientRect();
            if (rect && (rect.width > 0 || rect.height > 0)) return rect;
        } catch (e) { }
    }
    if (selectionAnchorPoint) {
        return {
            top: selectionAnchorPoint.y,
            bottom: selectionAnchorPoint.y,
            left: selectionAnchorPoint.x,
            width: 0,
            height: 0
        };
    }
    return null;
}

function positionSelectionPopup() {
    if (!selectionContainer || !selectionShadowRoot) return;
    const card = selectionShadowRoot.querySelector('.sel-card');
    if (!card) return;
    const margin = 12;
    const gap = 10;
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || 0;
    const viewportHeight = document.documentElement?.clientHeight || window.innerHeight || 0;
    const cardRect = card.getBoundingClientRect();
    const width = cardRect.width || 340;
    const height = cardRect.height || 120;
    const anchor = selectionAnchorRect();
    let left;
    let top;
    if (anchor) {
        left = anchor.left + (anchor.width / 2) - (width / 2);
        top = anchor.bottom + gap;
        if (top + height > viewportHeight - margin) {
            const above = anchor.top - height - gap;
            top = above >= margin ? above : Math.max(margin, viewportHeight - height - margin);
        }
    } else {
        left = (viewportWidth - width) / 2;
        top = margin;
    }
    const maxLeft = Math.max(margin, viewportWidth - width - margin);
    const maxTop = Math.max(margin, viewportHeight - height - margin);
    left = Math.min(Math.max(margin, left), maxLeft);
    top = Math.min(Math.max(margin, top), maxTop);
    selectionContainer.style.left = `${Math.round(left)}px`;
    selectionContainer.style.top = `${Math.round(top)}px`;
}

function closeSelectionPopup() {
    detachSelectionListeners();
    if (selectionCopyTimer) {
        clearTimeout(selectionCopyTimer);
        selectionCopyTimer = null;
    }
    const hadRequest = selectionRequestId > 0;
    selectionRequestId++;
    if (hadRequest) {
        sendRuntimeMessage({ action: 'cancelSelectionTranslation' });
    }
    if (selectionContainer && selectionContainer.parentNode) {
        selectionContainer.parentNode.removeChild(selectionContainer);
    }
    selectionContainer = null;
    selectionShadowRoot = null;
    selectionAnchorRange = null;
    selectionReplacePlan = null;
    selectionReplaceIntent = false;
    selectionUndoTarget = null;
}

function attachSelectionListeners() {
    if (selectionListenersAttached) return;
    selectionListenersAttached = true;
    try {
        document.addEventListener('keydown', onSelectionKeyDown, true);
        document.addEventListener('pointerdown', onSelectionPointerDown, true);
        window.addEventListener('scroll', onSelectionViewportChange, true);
        window.addEventListener('resize', onSelectionViewportChange, true);
    } catch (e) { }
}

function detachSelectionListeners() {
    if (!selectionListenersAttached) return;
    selectionListenersAttached = false;
    try {
        document.removeEventListener('keydown', onSelectionKeyDown, true);
        document.removeEventListener('pointerdown', onSelectionPointerDown, true);
        window.removeEventListener('scroll', onSelectionViewportChange, true);
        window.removeEventListener('resize', onSelectionViewportChange, true);
    } catch (e) { }
}

function onSelectionKeyDown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') closeSelectionPopup();
}

function onSelectionPointerDown(event) {
    if (!selectionContainer) return;
    const target = event.target;
    if (target === selectionContainer) return;
    if (target instanceof Node && selectionContainer.contains(target)) return;
    closeSelectionPopup();
}

function onSelectionViewportChange() {
    positionSelectionPopup();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTranslation);
} else {
    setTimeout(initTranslation, 100);
}

watchSelectionPointer();

try {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (sender.tab) return false;
        try {
            switch (request.action) {
                case "getTranslationStatus":
                    sendResponse({
                        isTranslating,
                        progress: translationProgress,
                        stats: {
                            batches: batchesProcessed,
                            totalBatches,
                            translatedFragments: translatedUnitsCount,
                            totalFragments: expectedTotalUnits
                        }
                    });
                    return false;
                case "getPageState":
                    return respondPopupPageState(sendResponse);
                case "cancelTranslationFromPopup":
                    if (isTranslating && !translationCancelled && !translationHasError) handleCancelButtonClick();
                    else broadcastCancelToAllFrames();
                    sendResponse({ status: "cancelling" });
                    return false;
                case "subframeTranslationState":
                    trackSubframeTranslationState(request);
                    sendResponse({ status: "noted" });
                    return false;
                case "subframeTranslationFailed":
                    noteSubframeTranslationFailure(request);
                    sendResponse({ status: "noted" });
                    return false;
                case "startTranslationFromPopup":
                    if (isTranslating) {
                        sendResponse({ status: "alreadyTranslating" });
                        return false;
                    }
                    if (isExcludedSubframe()) {
                        sendResponse({ status: "excluded" });
                        return false;
                    }
                    removePrompt();
                    translationStarted = true;
                    rememberTranslatedDomain();
                    startTranslation(true);
                    sendResponse({ status: "starting" });
                    return false;
                case "clearPageCacheAndRetranslate":
                    if (isTranslating) {
                        sendResponse({ status: "alreadyTranslating" });
                        return false;
                    }
                    if (isExcludedSubframe()) {
                        sendResponse({ status: "excluded" });
                        return false;
                    }
                    removePrompt();
                    clearPageCacheAndRetranslate().catch(() => { });
                    sendResponse({ status: "starting" });
                    return false;
                case "restoreFromCacheOnly":
                    if (isTranslating) { sendResponse({ status: "alreadyTranslating" }); return false; }
                    restoreFromCacheOnly();
                    sendResponse({ status: "restoring" });
                    return false;
                case "toggleTranslation":
                    if (isTranslating) {
                        sendResponse({ status: "Translating" });
                    } else {
                        toggleAllTranslations(request.view);
                        sendResponse({ status: "toggled" });
                    }
                    return false;
                case "translationCancelled":
                    if (!translationCancelled && !translationHasError && !fatalErrorCancelPending) handleCancellation();
                    sendResponse({ status: "cancelled_ack" });
                    return false;
                case "streamingTranslationUpdate":
                    handleStreamingUpdate(request.batchId, request.translations);
                    return false;
                case "showSelectionTranslation":
                    showSelectionTranslation(request.text, request.replaceIntent === true);
                    sendResponse({ status: "showing" });
                    return false;
                default:
                    return false;
            }
        } catch (e) {
            return false;
        }
    });
} catch (error) { }
