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
