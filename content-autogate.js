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
