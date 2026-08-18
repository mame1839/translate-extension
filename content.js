(function () {
    let promptMessage = 'Translate this page?';
    let translateButtonText = { yes: 'Translate', no: 'No', never: 'Never show for this site' };
    let st = {
        translating: 'Translating…',
        cancelling: 'Cancelling…',
        translationCancelled: 'Translation cancelled.',
        noTextFound: 'No translatable text found',
        translationCompleted: 'Translation complete',
        errorOccurred: 'An error occurred',
        apiLimitError: 'API rate limit reached. Please wait or adjust settings.',
        progressTemplate: 'Batch: {currentBatch}/{totalBatch}  ·  Blocks: {translatedUnits}/{totalUnits}',
        closeButton: 'Close',
        cancelButton: 'Cancel',
        openOptions: 'Open settings',
        reactWarning: 'This site uses a complex framework. Translation may break the UI.',
        blocksTemplate: 'Blocks {translated} / {total}',
        streamingNote: 'Applying text as it arrives',
        minimizeLabel: 'Minimize',
        restoreLabel: 'Restore',
        errorTitle: 'Translation failed',
        errorDetails: 'Technical details',
        retryButton: 'Retry',
        cacheRestoredTitle: 'Restored the saved translation',
        retranslateButton: 'Re-translate',
        translateRestButton: 'Translate the rest',
        newContentTitle: 'New content on this page is not translated',
        blocksTooLong: '{count} blocks are longer than the output token limit and were left untranslated. Raise the max output tokens in settings.',
        cacheSaveFailed: 'Could not save the translation for this page. It will be translated again next time.',
        cacheStorageFull: 'Storage is full. The translation for this page was not saved.'
    };

    const RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);
    let currentUiLang = 'en';
    let detectedPageLanguage = '';

    function applyStrings(lang) {
        const hasLang = typeof TRANSLATIONS !== 'undefined' && !!TRANSLATIONS[lang];
        const t = hasLang ? TRANSLATIONS[lang] : TRANSLATIONS['en'];
        currentUiLang = hasLang ? lang : 'en';
        promptMessage = t.promptMessage;
        translateButtonText = { yes: t.promptYes, no: t.promptNo, never: t.promptNever };
        st = {
            translating: t.translating,
            cancelling: t.cancelling,
            translationCancelled: t.cancelled,
            noTextFound: t.noText,
            translationCompleted: t.complete,
            errorOccurred: t.error,
            apiLimitError: t.apiLimit,
            progressTemplate: t.progressTemplate,
            closeButton: t.closeBtn,
            cancelButton: t.cancelBtn,
            openOptions: t.openOptions,
            reactWarning: t.reactWarning,
            blocksTemplate: t.popupBlocksTemplate,
            streamingNote: t.panelStreamingNote,
            minimizeLabel: t.panelMinimize,
            restoreLabel: t.panelRestore,
            errorTitle: t.errTitle,
            errorDetails: t.errDetails,
            retryButton: t.errRetry,
            cacheRestoredTitle: t.cacheRestoredTitle,
            retranslateButton: t.popupRetranslate,
            translateRestButton: t.translateRestButton,
            newContentTitle: t.newContentTitle,
            blocksTooLong: t.blocksTooLong,
            nothingTranslated: t.nothingTranslated,
            cacheSaveFailed: t.cacheSaveFailed,
            cacheStorageFull: t.cacheStorageFull,
            someBlocksFailed: t.someBlocksFailed,
            retryFailedButton: t.retryFailedButton
        };
    }

    const BLOCK_TAGS = new Set([
        'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'LI', 'DT', 'DD', 'TD', 'TH', 'CAPTION',
        'BLOCKQUOTE', 'PRE', 'ADDRESS',
        'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'MAIN',
        'FIGURE', 'FIGCAPTION',
        'UL', 'OL', 'DL',
        'TR', 'TBODY', 'THEAD', 'TFOOT', 'TABLE',
        'FORM', 'FIELDSET', 'LEGEND',
        'DETAILS', 'SUMMARY',
        'DIALOG', 'OUTPUT'
    ]);

    const INLINE_SKIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'CANVAS',
        'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT', 'OPTION', 'OPTGROUP',
        'VIDEO', 'AUDIO', 'EMBED', 'OBJECT', 'MATH', 'TEMPLATE',
        'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'MAP', 'AREA',
        'BR', 'HR', 'WBR', 'META', 'LINK', 'TITLE', 'HEAD'
    ]);

    const DEFAULTS = Object.freeze({
        batchSize: 500,
        maxBatchLength: 65535,
        delayBetweenRequests: 10000,
        maxToken: 65536,
        concurrencyLimit: 10,
        maxRetries: 3,
        timeout: 180
    });

    const SHARED_FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;

    const UI_TOKENS_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .root {
            --primary: #1a73e8;
            --on-primary: #ffffff;
            --primary-soft: rgba(26, 115, 232, 0.18);
            --primary-buffer: rgba(26, 115, 232, 0.45);
            --primary-tint: rgba(26, 115, 232, 0.08);
            --surface: #ffffff;
            --surface-1: #f5f5fa;
            --surface-2: #ededf4;
            --outline-soft: rgba(27, 27, 33, 0.09);
            --text: #1b1b21;
            --text-2: #4a4952;
            --text-3: #7b7a84;
            --error: #ba1a1a;
            --error-container: #ffe1de;
            --on-error-container: #7a1210;
            --error-tint: rgba(186, 26, 26, 0.08);
            --success: #0d7a4d;
            --success-soft: rgba(13, 122, 77, 0.16);
            --warning-container: #ffefc8;
            --on-warning-container: #6d5100;
            --ring: rgba(26, 115, 232, 0.35);
            --elev-3: 0 8px 24px -6px rgba(23, 23, 40, 0.22), 0 2px 8px rgba(23, 23, 40, 0.10);
            --ease: cubic-bezier(0.2, 0, 0, 1);
            font-family: ${SHARED_FONT};
            font-size: 13.5px;
            line-height: 1.5;
            color: var(--text);
            font-feature-settings: "kern" 1, "liga" 1, "palt" 1;
            -webkit-font-smoothing: antialiased;
        }
        @media (prefers-color-scheme: dark) {
            .root {
                --primary: #8ab4f8;
                --on-primary: #062e6f;
                --primary-soft: rgba(138, 180, 248, 0.20);
                --primary-buffer: rgba(138, 180, 248, 0.45);
                --primary-tint: rgba(138, 180, 248, 0.12);
                --surface: #1e1e24;
                --surface-1: #26262d;
                --surface-2: #2e2e36;
                --outline-soft: rgba(232, 231, 240, 0.09);
                --text: #e5e4ea;
                --text-2: #b6b5bf;
                --text-3: #85848e;
                --error: #ffb4ab;
                --error-container: #6e2621;
                --on-error-container: #ffdad5;
                --error-tint: rgba(255, 180, 171, 0.12);
                --success: #6fd9a4;
                --success-soft: rgba(111, 217, 164, 0.18);
                --warning-container: #574400;
                --on-warning-container: #ffe08d;
                --ring: rgba(138, 180, 248, 0.4);
                --elev-3: 0 8px 24px -6px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);
            }
        }
    `;

    const UI_CARD_CSS = `
        .card {
            position: fixed !important;
            z-index: 2147483647 !important;
            width: 316px;
            max-width: calc(100vw - 32px);
            padding: 16px;
            background: var(--surface);
            border: 1px solid var(--outline-soft);
            border-radius: 16px;
            box-shadow: var(--elev-3);
            animation: cardIn 220ms var(--ease);
        }
        .card.top { top: 16px; right: 16px; }
        .card.bottom { bottom: 16px; right: 16px; }
        @keyframes cardIn {
            from { opacity: 0; transform: translateY(-6px) scale(0.98); }
            to { opacity: 1; transform: none; }
        }
        .head { display: flex; align-items: center; gap: 10px; }
        .app-icon {
            width: 28px; height: 28px;
            border-radius: 8px;
            background: var(--primary);
            color: var(--on-primary);
            display: grid; place-items: center;
            flex-shrink: 0;
        }
        .status-ico {
            width: 28px; height: 28px;
            border-radius: 999px;
            display: grid; place-items: center;
            flex-shrink: 0;
        }
        .status-ico.ok { background: var(--success-soft); color: var(--success); }
        .status-ico.err { background: var(--error-container); color: var(--on-error-container); }
        .status-ico.neutral { background: var(--surface-1); color: var(--text-3); }
        .head-text { flex: 1; min-width: 0; }
        .title { font-size: 13.5px; font-weight: 600; }
        .sub { font-size: 12px; color: var(--text-3); margin-top: 1px; }
        .icon-btn {
            width: 30px; height: 30px;
            display: grid; place-items: center;
            border: none; border-radius: 999px;
            background: transparent;
            color: var(--text-3);
            cursor: pointer;
            padding: 0;
            flex-shrink: 0;
            transition: background-color 150ms var(--ease), color 150ms var(--ease);
        }
        .icon-btn:hover { background: var(--surface-2); color: var(--text); }
        .icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .root[dir="rtl"] .actions { justify-content: flex-start; }
        .btn {
            border: none; border-radius: 999px;
            font: inherit;
            font-size: 13px;
            font-weight: 600;
            padding: 8px 18px;
            cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px;
            transition: background-color 150ms var(--ease), box-shadow 150ms var(--ease);
        }
        .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
        .btn[disabled] { opacity: 0.5; cursor: default; }
        .btn-filled { background: var(--primary); color: var(--on-primary); }
        .btn-filled:not([disabled]):hover { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); }
        .btn-text { background: transparent; color: var(--primary); padding: 8px 12px; }
        .btn-text:not([disabled]):hover { background: var(--primary-tint); }
        .btn-danger-text { background: transparent; color: var(--error); padding: 8px 12px; }
        .btn-danger-text:not([disabled]):hover { background: var(--error-tint); }
        @media (prefers-reduced-motion: reduce) {
            .card { animation: none; }
        }
    `;

    const PROMPT_CSS = UI_TOKENS_CSS + UI_CARD_CSS + `
        .warn {
            display: flex; align-items: flex-start; gap: 8px;
            margin-top: 12px;
            padding: 9px 12px;
            background: var(--warning-container);
            color: var(--on-warning-container);
            border-radius: 10px;
            font-size: 12px;
            line-height: 1.45;
        }
        .warn svg { flex-shrink: 0; margin-top: 1px; }
        .warn-text { flex: 1; min-width: 0; word-break: break-word; }
        .never-row {
            display: flex; align-items: center;
            margin: 12px -16px 0;
            padding: 10px 16px 0;
            border-top: 1px solid var(--outline-soft);
        }
        .never-btn {
            background: transparent; border: none;
            color: var(--text-3);
            font: inherit;
            font-size: 12px;
            font-weight: 500;
            padding: 4px 8px;
            border-radius: 8px;
            cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .never-btn:hover { background: var(--surface-1); color: var(--text-2); }
        .never-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
    `;

    const PANEL_CSS = UI_TOKENS_CSS + UI_CARD_CSS + `
        .progress-bar {
            position: relative;
            height: 4px;
            margin-top: 14px;
            border-radius: 999px;
            background: var(--primary-soft);
            overflow: hidden;
        }
        .progress-fill {
            position: absolute;
            inset-block: 0;
            inset-inline-start: 0;
            width: 0%;
            border-radius: 999px;
            background: var(--primary);
            transition: width 300ms var(--ease);
        }
        .progress-bar.streaming::after {
            content: "";
            position: absolute;
            inset-block: 0;
            inset-inline-start: var(--stream-offset, 0%);
            width: 18%;
            border-radius: 999px;
            background: var(--primary-buffer);
            animation: streamBuffer 1.4s var(--ease) infinite;
        }
        @keyframes streamBuffer {
            0% { transform: translateX(0); opacity: 1; }
            100% { transform: translateX(160%); opacity: 0.2; }
        }
        .root[dir="rtl"] .progress-bar.streaming::after { animation-name: streamBufferRtl; }
        @keyframes streamBufferRtl {
            0% { transform: translateX(0); opacity: 1; }
            100% { transform: translateX(-160%); opacity: 0.2; }
        }
        .caption {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 7px;
            font-size: 11.5px;
            color: var(--text-3);
            font-variant-numeric: tabular-nums;
        }
        .caption .pct { color: var(--text-2); font-weight: 600; font-size: 12px; flex-shrink: 0; }
        .caption .stats { text-align: end; min-width: 0; }
        .cause {
            margin-top: 12px;
            font-size: 12.5px;
            line-height: 1.5;
            color: var(--text-2);
            word-break: break-word;
        }
        details.raw { margin-top: 10px; }
        details.raw summary {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px;
            border-radius: 8px;
            font-size: 12px;
            color: var(--text-3);
            cursor: pointer;
            user-select: none;
            list-style: none;
        }
        details.raw summary::-webkit-details-marker { display: none; }
        details.raw summary:hover { background: var(--surface-1); }
        details.raw summary:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
        details.raw summary svg { transition: transform 160ms var(--ease); }
        details.raw[open] summary svg { transform: rotate(90deg); }
        .root[dir="rtl"] details.raw summary svg { transform: scaleX(-1); }
        .root[dir="rtl"] details.raw[open] summary svg { transform: scaleX(-1) rotate(-90deg); }
        details.raw pre {
            margin: 8px 0 0;
            padding: 9px 11px;
            background: var(--surface-1);
            border: 1px solid var(--outline-soft);
            border-radius: 8px;
            font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
            font-size: 11px;
            line-height: 1.5;
            color: var(--text-2);
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 130px;
            overflow-y: auto;
            direction: ltr;
            text-align: left;
        }
        @media (prefers-reduced-motion: reduce) {
            .progress-bar.streaming::after { animation: none; }
        }
    `;

    const MINI_CSS = UI_TOKENS_CSS + `
        .mini {
            position: fixed !important;
            bottom: 16px !important;
            right: 16px !important;
            z-index: 2147483647 !important;
            width: 48px;
            height: 48px;
            padding: 0;
            border: 1px solid var(--outline-soft);
            border-radius: 999px;
            background: var(--surface);
            box-shadow: var(--elev-3);
            display: grid;
            place-items: center;
            cursor: pointer;
            animation: miniIn 220ms var(--ease);
            transition: transform 150ms var(--ease);
        }
        .mini:hover { transform: scale(1.06); }
        .mini:focus-visible { outline: none; box-shadow: var(--elev-3), 0 0 0 3px var(--ring); }
        @keyframes miniIn {
            from { opacity: 0; transform: scale(0.7); }
            to { opacity: 1; transform: scale(1); }
        }
        .mini .ring { position: absolute; inset: 4px; }
        .mini .ring .track { stroke: var(--primary-soft); }
        .mini .ring .value { stroke: var(--primary); transition: stroke-dashoffset 300ms var(--ease); }
        .pct-label {
            font-size: 11px;
            font-weight: 700;
            color: var(--text-2);
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.02em;
        }
        @media (prefers-reduced-motion: reduce) {
            .mini { animation: none; }
        }
    `;

    const IS_TOP_FRAME = (function () {
        try { return window.top === window; } catch (e) { return false; }
    })();

    const translatingSubframes = new Set();
    let subframeFailures = [];

    let isTranslating = false;
    let translationStarted = false;
    let translationCancelled = false;
    let translationHasError = false;
    let extensionContextLost = false;

    let translationProgress = 0;
    let translatedUnitsCount = 0;
    let expectedTotalUnits = 0;
    let oversizedSkippedCount = 0;
    const AUTO_RESEND_MAX_UNITS = 50;
    const TEMPORARY_BATCH_ERROR_CODES = new Set(['serverError', 'requestTimeout', 'jsonParseFailed', 'jsonExtractFailed', 'emptyResponse']);
    let totalBatches = 0;
    let batchesProcessed = 0;

    let translationUnits = new Map();
    let activeObservers = [];
    let observedRoots = new WeakSet();
    let replayingDrainedMutations = false;
    let scanCache = null;
    let observerDebounceTimer = null;
    let userInteractionTimer = null;
    let userInteractionListenersAttached = false;
    let scrollListenersAttached = false;
    let scrollDebounceTimer = null;
    let lastScrollScanHeight = -1;
    let domChangedSinceScrollScan = true;
    let progressInterval = null;
    let statusContainer = null;
    let statusShadowRoot = null;
    let statusPanelPhase = '';
    let promptContainer = null;
    let promptShadowRoot = null;
    let minimizedDiv = null;
    let minimizedShadowRoot = null;
    let domUpdateQueue = [];
    let isApplyingUpdates = false;
    let pendingApplyPromise = null;
    let translationRunGeneration = 0;
    let pendingStartTimer = null;
    let pendingStartIsUserInitiated = false;
    let streamingBatchRegistry = new Map();
    let streamingBatchCounter = 0;
    let streamingEnabled = false;
    let streamingActive = false;
    const streamingBatchSeed = Math.random().toString(36).slice(2, 10);
    let pendingNewContentRetranslation = false;
    let pendingAuthorizedRetranslation = false;
    let cacheRestoreMap = null;
    let cacheRestoreActive = false;
    let cacheReadError = '';
    let cacheCoverageMemo = null;
    let popupRemainingMemo = { ts: 0, value: false };
    const sessionTranslationMemo = new Map();
    let sessionTranslationMemoLang = '';
    const SESSION_MEMO_MAX_ENTRIES = 2000;
    const blockTranslationLanguage = new WeakMap();
    let statusAutoDismissTimer = null;
    let restoreNoticeContainer = null;
    let restoreNoticeTimer = null;
    const RESTORE_NOTICE_TIMEOUT_MS = 12000;
    let postNavigationCooldownUntil = 0;
    let highlightTranslated = false;
    let fatalErrorCancelPending = false;
    let postFinishScanCount = 0;
    const POST_FINISH_MAX_SCANS = 1;
    const POST_FINISH_SCAN_DELAYS = [3000];
    let autoTranslateNewContent = false;
    let hidePromptForAllSites = false;
    let currentExcludeList = [];
    let settingWatcherAttached = false;
    let autoRetranslateRounds = 0;
    const AUTO_RETRANSLATE_MAX_ROUNDS = 3;
    let continueNoticeShown = false;
    let continueNoticeCooldownUntil = 0;
    const CONTINUE_NOTICE_COOLDOWN_MS = 60000;

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
                        measureCacheCoverage();
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

    const PAGE_CACHE_PREFIX = 'pageCache_';
    const PAGE_CACHE_MAX_ENTRIES = 1000;
    const PAGE_CACHE_MAX_BLOCKS = 1500;

    function computeStringHash(s) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            hash ^= s.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        return hash.toString(36);
    }

    function currentPageIdentity() {
        try {
            const url = new URL(window.location.href);
            return url.origin + url.pathname + url.search;
        } catch (e) { return ''; }
    }

    function getPageKeyWithoutLanguage() {
        const identity = currentPageIdentity();
        if (!identity) return null;
        return PAGE_CACHE_PREFIX + computeStringHash(identity);
    }

    function cacheRecordMatchesCurrentPage(record) {
        const identity = currentPageIdentity();
        if (!identity) return false;
        if (!record || typeof record.url !== 'string' || !record.url) return false;
        try {
            const saved = new URL(record.url);
            return saved.origin + saved.pathname + saved.search === identity;
        } catch (e) { return false; }
    }

    function getCurrentPageKey(targetLanguage) {
        const base = getPageKeyWithoutLanguage();
        if (!base || !targetLanguage) return null;
        return base + '_' + targetLanguage;
    }

    function collectCacheableBlocks() {
        return collectBlocksAcrossRoots((node) => {
            if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.geminiIgnore === 'true') return NodeFilter.FILTER_REJECT;
            return 0;
        });
    }

    function getBlockOriginalText(block) {
        if (block.dataset?.translationStatus === 'translated' && typeof block.dataset.originalHtml === 'string') {
            const parsed = parseTemplateFragment(block.dataset.originalHtml);
            return ((parsed && parsed.textContent) || '').trim().replace(/\s+/g, ' ');
        }
        return (block.textContent || '').trim().replace(/\s+/g, ' ');
    }

    function computeBlockTextKey(text) {
        if (!text) return '';
        return computeStringHash(text);
    }

    function readPageCacheByKey(key) {
        return new Promise(resolve => {
            if (!key) { resolve({ record: null, error: '' }); return; }
            sendRuntimeMessage({ action: 'pageCacheGet', key }, (response, failure) => {
                if (failure) { resolve({ record: null, error: failure }); return; }
                if (!response) { resolve({ record: null, error: 'noResponse' }); return; }
                const error = typeof response.error === 'string' ? response.error : '';
                resolve({ record: error ? null : (response.cache || null), error });
            });
        });
    }

    function getPageCache(targetLanguage) {
        return readPageCacheByKey(getCurrentPageKey(targetLanguage));
    }

    function getPageCacheWithoutLanguage() {
        return readPageCacheByKey(getPageKeyWithoutLanguage());
    }

    function savePageCache(targetLanguage, cache) {
        return new Promise(resolve => {
            const key = getCurrentPageKey(targetLanguage);
            if (!key) { resolve({ saved: false, error: '', quotaExhausted: false }); return; }
            sendRuntimeMessage({ action: 'pageCacheSet', key, cache }, (response, failure) => {
                if (failure) { resolve({ saved: false, error: failure, quotaExhausted: false }); return; }
                if (!response) { resolve({ saved: false, error: 'noResponse', quotaExhausted: false }); return; }
                resolve({
                    saved: !!response.saved,
                    error: typeof response.error === 'string' ? response.error : '',
                    quotaExhausted: response.quotaExhausted === true
                });
            });
        });
    }

    function clearPageCache(targetLanguage) {
        return new Promise(resolve => {
            const key = getCurrentPageKey(targetLanguage);
            if (!key) { resolve(); return; }
            sendRuntimeMessage({ action: 'pageCacheDelete', key }, () => { resolve(); });
        });
    }

    function pruneOldCaches() {
        return new Promise(resolve => {
            sendRuntimeMessage({ action: 'pageCachePrune', maxEntries: PAGE_CACHE_MAX_ENTRIES }, () => { resolve(); });
        });
    }

    function compositeBlockKey(textKey, tagName) {
        return textKey + '|' + (tagName || '');
    }

    function useSessionMemoForLanguage(targetLanguage) {
        if (!targetLanguage || sessionTranslationMemoLang === targetLanguage) return;
        sessionTranslationMemoLang = targetLanguage;
        sessionTranslationMemo.clear();
    }

    function rememberTranslatedTemplate(template, translatedTemplate) {
        if (typeof template !== 'string' || !template) return;
        if (typeof translatedTemplate !== 'string' || !translatedTemplate) return;
        if (sessionTranslationMemo.has(template)) sessionTranslationMemo.delete(template);
        sessionTranslationMemo.set(template, translatedTemplate);
        while (sessionTranslationMemo.size > SESSION_MEMO_MAX_ENTRIES) {
            const oldest = sessionTranslationMemo.keys().next();
            if (oldest.done) break;
            sessionTranslationMemo.delete(oldest.value);
        }
    }

    function recallTranslatedTemplate(template) {
        const remembered = sessionTranslationMemo.get(template);
        return (typeof remembered === 'string' && remembered) ? remembered : null;
    }

    function usableCacheRecord(record, targetLanguage) {
        if (!record || !Array.isArray(record.blocks)) return null;
        if (record.lang !== targetLanguage) return null;
        if (!cacheRecordMatchesCurrentPage(record)) return null;
        return record;
    }

    async function resolveCacheForLanguage(targetLanguage) {
        const current = await getPageCache(targetLanguage);
        if (current.error) return current;
        if (usableCacheRecord(current.record, targetLanguage)) return current;
        const withoutLanguage = await getPageCacheWithoutLanguage();
        if (withoutLanguage.error) return withoutLanguage;
        const legacy = usableCacheRecord(withoutLanguage.record, targetLanguage);
        if (!legacy) return { record: null, error: '' };
        savePageCache(targetLanguage, legacy).catch(() => { });
        return withoutLanguage;
    }

    async function tryRestoreFromCache(targetLanguage) {
        if (!cacheRestoreMap) {
            if (!targetLanguage) return false;
            const resolved = await resolveCacheForLanguage(targetLanguage);
            cacheReadError = resolved.error || '';
            const cache = resolved.record;
            if (!cache) return false;
            useSessionMemoForLanguage(targetLanguage);
            const map = new Map();
            for (const entry of cache.blocks) {
                if (entry && entry.textKey && entry.tagName) {
                    map.set(compositeBlockKey(entry.textKey, entry.tagName), entry);
                }
                if (entry) rememberTranslatedTemplate(entry.template, entry.translatedTemplate);
            }
            if (map.size === 0) return false;
            cacheRestoreMap = map;
            cacheRestoreActive = true;
        }
        return cacheRestoreActive;
    }

    function applyCacheBlock(block, entry) {
        if (!entry || typeof entry.template !== 'string' || typeof entry.translatedTemplate !== 'string') return false;
        if (!entry.template || !entry.translatedTemplate) return false;
        try {
            const tu = buildTU(block);
            if (!tu || !tu.hasTranslatableText) return false;
            if (tu.template !== entry.template) return false;
            if (typeof entry.originalHtml === 'string' && !('originalHtml' in block.dataset)) {
                block.dataset.originalHtml = entry.originalHtml;
            }
            applyTranslation(tu, entry.translatedTemplate, true);
            if (block.dataset?.translationStatus !== 'translated') return false;
            block.dataset.tuTemplate = tu.template;
            return true;
        } catch (e) { return false; }
    }

    function applyCacheRestore() {
        if (!cacheRestoreMap || cacheRestoreMap.size === 0) {
            cacheRestoreActive = false;
            return 0;
        }
        const currentBlocks = collectCacheableBlocks();
        let applied = 0;
        const consumedTextKeys = new Set();

        for (const block of currentBlocks) {
            if (!block.isConnected) continue;
            if (block.dataset?.translationStatus === 'translated') continue;
            if (block.dataset?.translationStatus === 'processing') continue;
            const text = getBlockOriginalText(block);
            if (!text) continue;
            const textKey = computeBlockTextKey(text);
            const key = compositeBlockKey(textKey, block.tagName);
            const entry = cacheRestoreMap.get(key);
            if (!entry) continue;
            if (applyCacheBlock(block, entry)) {
                cacheRestoreMap.delete(key);
                consumedTextKeys.add(textKey);
                applied++;
            }
        }

        const textKeyOnlyMap = new Map();
        const textKeyConflicts = new Set();
        for (const [mapKey, entry] of cacheRestoreMap) {
            const tk = entry.textKey;
            if (!tk) continue;
            if (consumedTextKeys.has(tk)) continue;
            if (textKeyOnlyMap.has(tk)) {
                textKeyConflicts.add(tk);
            } else {
                textKeyOnlyMap.set(tk, mapKey);
            }
        }
        for (const conflict of textKeyConflicts) {
            textKeyOnlyMap.delete(conflict);
        }

        if (textKeyOnlyMap.size > 0) {
            for (const block of currentBlocks) {
                if (!block.isConnected) continue;
                if (block.dataset?.translationStatus === 'translated') continue;
                if (block.dataset?.translationStatus === 'processing') continue;
                const text = getBlockOriginalText(block);
                if (!text) continue;
                const textKey = computeBlockTextKey(text);
                if (textKeyConflicts.has(textKey)) continue;
                const mapKey = textKeyOnlyMap.get(textKey);
                if (!mapKey) continue;
                const entry = cacheRestoreMap.get(mapKey);
                if (!entry) continue;
                if (applyCacheBlock(block, entry)) {
                    cacheRestoreMap.delete(mapKey);
                    textKeyOnlyMap.delete(textKey);
                    applied++;
                }
            }
        }

        if (cacheRestoreMap.size === 0) {
            cacheRestoreActive = false;
        }
        return applied;
    }

    function measureCacheCoverage() {
        if (cacheCoverageMemo) return;
        let matched = 0, total = 0;
        try {
            for (const block of collectCacheableBlocks()) {
                if (!block.isConnected) continue;
                const text = getBlockOriginalText(block);
                if (!text) continue;
                total += text.length;
                if (cacheRestoreMap) {
                    const key = compositeBlockKey(computeBlockTextKey(text), block.tagName);
                    if (cacheRestoreMap.has(key)) matched += text.length;
                }
            }
        } catch (e) { }
        cacheCoverageMemo = { matched, total, error: cacheReadError || '' };
    }

    function getStoredTargetLanguage() {
        return new Promise(resolve => {
            try {
                chrome.storage.local.get(['targetLanguage'], (items) => {
                    if (chrome.runtime.lastError) { resolve(null); return; }
                    resolve((items && items.targetLanguage) || 'en');
                });
            } catch (e) { resolve(null); }
        });
    }

    async function restoreFromCacheOnly() {
        const lang = await getStoredTargetLanguage();
        if (!cacheRestoreMap) { try { await tryRestoreFromCache(lang); } catch (e) { } }
        if (cacheRestoreActive) {
            try { applyCacheRestore(); } catch (e) { }
        }
    }

    function mergeWithPreviousEntries(previous, entries, lang) {
        if (entries.length >= PAGE_CACHE_MAX_BLOCKS) return entries.slice(0, PAGE_CACHE_MAX_BLOCKS);
        if (!previous || previous.lang !== lang || !Array.isArray(previous.blocks)) return entries;
        const merged = entries.slice();
        const seen = new Set(entries.map(entry => compositeBlockKey(entry.textKey, entry.tagName)));
        for (const entry of previous.blocks) {
            if (merged.length >= PAGE_CACHE_MAX_BLOCKS) break;
            if (!entry || !entry.textKey || !entry.tagName) continue;
            if (!entry.template || !entry.translatedTemplate) continue;
            const composite = compositeBlockKey(entry.textKey, entry.tagName);
            if (seen.has(composite)) continue;
            seen.add(composite);
            merged.push(entry);
        }
        return merged;
    }

    async function saveCurrentTranslationToCache() {
        const blocks = collectCacheableBlocks();
        if (blocks.length === 0) return;
        const lang = await getStoredTargetLanguage();
        if (!lang) return;
        const entries = [];
        const seen = new Set();
        for (const block of blocks) {
            if (blockTranslationLanguage.get(block) !== lang) continue;
            if (block.dataset?.translationStatus !== 'translated') continue;
            if (typeof block.dataset.translatedHtml !== 'string') continue;
            if (typeof block.dataset.originalHtml !== 'string') continue;
            const template = block.dataset.tuTemplate;
            const translatedTemplate = block.dataset.tuTranslatedTemplate;
            if (!template || !translatedTemplate) continue;
            const text = getBlockOriginalText(block);
            if (!text) continue;
            const textKey = computeBlockTextKey(text);
            const composite = compositeBlockKey(textKey, block.tagName);
            if (seen.has(composite)) continue;
            seen.add(composite);
            entries.push({
                textKey,
                tagName: block.tagName,
                originalHtml: block.dataset.originalHtml,
                translatedHtml: block.dataset.translatedHtml,
                template,
                translatedTemplate
            });
        }
        if (entries.length === 0) return;
        const previous = await resolveCacheForLanguage(lang);
        if (previous.error) return;
        let pageUrl = '';
        try { pageUrl = window.location.href; } catch (e) { }
        const result = await savePageCache(lang, {
            url: pageUrl,
            lang,
            blocks: mergeWithPreviousEntries(previous.record, entries, lang),
            savedAt: Date.now()
        });
        if (result.saved) {
            pruneOldCaches().catch(() => { });
            return;
        }
        showCacheSaveFailureNote(result.quotaExhausted ? st.cacheStorageFull : st.cacheSaveFailed);
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
                    if (!hasUntranslatedTextInDocument()) return;
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

    function isLikelyReactApp() {
        try {
            if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return true;
            if (document.querySelector('[data-reactroot]')) return true;
            const root = document.querySelector('#root, #app, #__next');
            if (root) {
                const noscript = document.querySelector('noscript');
                if (noscript && /enable\s+javascript/i.test(noscript.textContent || '')) return true;
                if (root.children.length > 50) return true;
            }
            if (document.querySelector('[class^="Mui"], [class*=" Mui"], [class^="ant-"], [class*=" ant-"], [class^="chakra-"], [class*=" chakra-"]')) return true;
        } catch (e) { }
        return false;
    }

    function getPageLanguage() {
        try {
            const htmlLang = document.documentElement?.getAttribute('lang');
            if (htmlLang) return htmlLang.trim();
            const metaLang = document.querySelector('meta[http-equiv="Content-Language"]');
            if (metaLang) {
                const content = metaLang.getAttribute('content');
                if (content) return content.trim();
            }
        } catch (e) { }
        return '';
    }

    const LANGUAGE_DETECTION_SAMPLE_LIMIT = 1500;
    const LANGUAGE_DETECTION_MIN_SAMPLE_LENGTH = 40;
    const LANGUAGE_DETECTION_MIN_CONFIDENCE = 0.5;
    const LANGUAGE_DETECTION_AUTO_SKIP_CONFIDENCE = 0.85;
    const LANGUAGE_DETECTION_TIMEOUT_MS = 1500;
    const LANGUAGE_DETECTION_SAMPLE_RETRY_DELAYS = [700, 1500];
    const LANGUAGE_SAMPLE_SKIP_SELECTOR = 'script,style,noscript,template,svg,math,code,pre,kbd,samp,var,textarea,[aria-hidden="true"],[data-gemini-ignore="true"]';
    const CHINESE_SCRIPT_MIN_SIGNAL = 4;
    const CHINESE_SCRIPT_TRADITIONAL_RATIO = 0.5;
    const TRADITIONAL_ONLY_CHARS = new Set('個為這們來時說會學發對國開關門問間東車書長點電話語讀寫聽買賣見現頭顯體麼還進過動務業產網頁圖資訊應該條從樂愛兒幾機號處報讓與經濟給結統專區單華費邊連選錢銀難題響觀歡舊灣風飛馬鳥島齊備標檢測環總聯龍記計設訪評識護議證貝負貨質購輸農遠違郵醫錯鍵陽陳際隨雖雙雜離術壓廠廣異溫滿漢無獲盤禮絡繼續舉藝藥衛裝訂訓詞詢誰調謝譯變豐賽軟輕輪辦運達適嗎後裡');
    const SIMPLIFIED_ONLY_CHARS = new Set('个为这们来时说会学发对国开关门问间东车书长点电话语读写听买卖见现头显体么还进过动务业产网页图资讯应该条从乐爱儿几机号处报让与经济给结统专区单华费边连选钱银难题响观欢旧湾风飞马鸟岛齐备标检测环总联龙记计设访评识护议证贝负货质购输农远违邮医错键阳陈际随虽双杂离术压厂广异温满汉无获盘礼络继续举艺药卫装订训词询谁调谢译变丰赛软轻轮办运达适吗');

    function waitForMs(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function resolveWithTimeout(promise, timeoutMs, timeoutValue) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
            promise.then(
                (value) => { clearTimeout(timer); resolve(value); },
                () => { clearTimeout(timer); resolve(timeoutValue); }
            );
        });
    }

    function collectLanguageDetectionSample() {
        if (!document.body) return '';
        let sample = '';
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    const value = node.nodeValue;
                    if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (parent.closest(LANGUAGE_SAMPLE_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            let node;
            while ((node = walker.nextNode()) && sample.length < LANGUAGE_DETECTION_SAMPLE_LIMIT) {
                sample += node.nodeValue.replace(/\s+/g, ' ').trim() + ' ';
            }
        } catch (e) { }
        return sample.trim();
    }

    function classifyChineseScript(sample) {
        let traditionalCount = 0;
        let simplifiedCount = 0;
        for (const ch of sample) {
            if (TRADITIONAL_ONLY_CHARS.has(ch)) traditionalCount++;
            else if (SIMPLIFIED_ONLY_CHARS.has(ch)) simplifiedCount++;
        }
        if (traditionalCount + simplifiedCount < CHINESE_SCRIPT_MIN_SIGNAL) return null;
        const ratio = traditionalCount / (traditionalCount + simplifiedCount);
        return ratio >= CHINESE_SCRIPT_TRADITIONAL_RATIO ? 'Hant' : 'Hans';
    }

    function detectedLanguageMatchesTarget(detected, targetLang) {
        const sourcePrimary = detected.lang.split('-')[0].toLowerCase();
        const targetPrimary = targetLang.split('-')[0].toLowerCase();
        if (sourcePrimary !== targetPrimary) return false;
        if (sourcePrimary !== 'zh') return true;
        if (!detected.chineseScript) return true;
        const targetIsTraditional = /-(hant|tw|hk|mo)/i.test(targetLang);
        return (detected.chineseScript === 'Hant') === targetIsTraditional;
    }

    async function runLanguageDetector(sample) {
        const detector = await LanguageDetector.create();
        try {
            const results = await detector.detect(sample);
            return Array.isArray(results) && results.length > 0 ? results[0] : null;
        } finally {
            try { detector.destroy(); } catch (e) { }
        }
    }

    async function detectContentLanguage() {
        try {
            if (typeof LanguageDetector === 'undefined') return null;
            const availability = await resolveWithTimeout(LanguageDetector.availability(), LANGUAGE_DETECTION_TIMEOUT_MS, null);
            if (availability !== 'available') return null;
            let sample = collectLanguageDetectionSample();
            for (const retryDelay of LANGUAGE_DETECTION_SAMPLE_RETRY_DELAYS) {
                if (sample.length >= LANGUAGE_DETECTION_MIN_SAMPLE_LENGTH) break;
                await waitForMs(retryDelay);
                sample = collectLanguageDetectionSample();
            }
            if (sample.length < LANGUAGE_DETECTION_MIN_SAMPLE_LENGTH) return null;
            const top = await resolveWithTimeout(runLanguageDetector(sample), LANGUAGE_DETECTION_TIMEOUT_MS, null);
            if (!top || typeof top.detectedLanguage !== 'string' || top.detectedLanguage === 'und') return null;
            const confidence = typeof top.confidence === 'number' ? top.confidence : 0;
            const sourcePrimary = top.detectedLanguage.split('-')[0].toLowerCase();
            let chineseScript = null;
            if (sourcePrimary === 'zh') {
                chineseScript = classifyChineseScript(sample);
                if (!chineseScript && /hant/i.test(top.detectedLanguage)) chineseScript = 'Hant';
            }
            return { lang: top.detectedLanguage, confidence, chineseScript };
        } catch (e) { return null; }
    }

    function detectedLanguageTag(detected) {
        const primary = detected.lang.split('-')[0].toLowerCase();
        if (primary === 'zh' && detected.chineseScript) {
            return detected.chineseScript === 'Hant' ? 'zh-Hant' : 'zh';
        }
        return detected.lang;
    }

    function resolvePageLanguageDecision(detected, pageLang, chosenLang) {
        const pageLangPrimary = pageLang ? pageLang.split('-')[0].toLowerCase() : null;
        const chosenLangPrimary = chosenLang.split('-')[0].toLowerCase();
        const attributeSaysTargetLanguage = !!(pageLangPrimary && pageLangPrimary === chosenLangPrimary);
        const detectionUsable = !!(detected && detected.confidence >= LANGUAGE_DETECTION_MIN_CONFIDENCE);
        const pageIsTargetLanguage = detectionUsable
            ? detectedLanguageMatchesTarget(detected, chosenLang)
            : attributeSaysTargetLanguage;
        const skipAutoTranslation = detectionUsable
            ? (detected.confidence >= LANGUAGE_DETECTION_AUTO_SKIP_CONFIDENCE && detectedLanguageMatchesTarget(detected, chosenLang))
            : attributeSaysTargetLanguage;
        const skipAutoTranslationIsLowConfidence = !detectionUsable && skipAutoTranslation;
        const detectedSourceLanguage = detectionUsable ? detectedLanguageTag(detected) : '';
        return { pageIsTargetLanguage, skipAutoTranslation, skipAutoTranslationIsLowConfidence, detectedSourceLanguage };
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';

    const ICON_LOGO = [
        ['path', { d: 'm5 8 6 6' }],
        ['path', { d: 'm4 14 6-6 2-3' }],
        ['path', { d: 'M2 5h12' }],
        ['path', { d: 'M7 2h1' }],
        ['path', { d: 'm22 22-5-10-5 10' }],
        ['path', { d: 'M14 18h6' }]
    ];
    const ICON_CLOSE = [
        ['path', { d: 'M18 6 6 18' }],
        ['path', { d: 'm6 6 12 12' }]
    ];
    const ICON_MINIMIZE = [['path', { d: 'M5 12h14' }]];
    const ICON_WARNING = [
        ['path', { d: 'M12 9v4' }],
        ['path', { d: 'M12 17h.01' }],
        ['path', { d: 'm10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0z' }]
    ];
    const ICON_BLOCKED = [
        ['path', { d: 'M4.9 4.9 19 19' }],
        ['path', { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' }]
    ];
    const ICON_CHECK = [['path', { d: 'M20 6 9 17l-5-5' }]];
    const ICON_ALERT = [
        ['path', { d: 'M12 8v4.5' }],
        ['path', { d: 'M12 16h.01' }]
    ];
    const ICON_CHEVRON = [['path', { d: 'm9 18 6-6-6-6' }]];

    function isRtlLang(lang) {
        return RTL_LANGS.has((lang || '').split('-')[0].toLowerCase());
    }

    function createUiRoot() {
        const root = document.createElement('div');
        root.className = 'root';
        root.dir = isRtlLang(currentUiLang) ? 'rtl' : 'ltr';
        return root;
    }

    function createUiElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    function createIconButton(shapes, label, elementId) {
        const button = document.createElement('button');
        button.className = 'icon-btn';
        button.type = 'button';
        if (elementId) button.id = elementId;
        if (label) {
            button.title = label;
            button.setAttribute('aria-label', label);
        }
        button.appendChild(createSvgIcon('15', '2.2', shapes));
        return button;
    }

    function addUserClickListener(target, handler) {
        target.addEventListener('click', function (event) {
            if (!event || event.isTrusted !== true) return;
            handler.call(this, event);
        });
    }

    function attachUiShadowRoot(host) {
        return host.attachShadow({ mode: 'closed' });
    }

    function createTextButton(className, label, onClick, elementId) {
        const button = createUiElement('button', className, label);
        button.type = 'button';
        if (elementId) button.id = elementId;
        if (onClick) addUserClickListener(button, onClick);
        return button;
    }

    function createActionsRow(buttons) {
        const actions = createUiElement('div', 'actions');
        for (const button of buttons) actions.appendChild(button);
        return actions;
    }

    function languageNativeName(code) {
        if (!code) return '';
        const primary = code.split('-')[0].toLowerCase();
        try {
            if (typeof LANGUAGES !== 'undefined' && Array.isArray(LANGUAGES)) {
                const exact = LANGUAGES.find(entry => entry.code.toLowerCase() === code.toLowerCase());
                if (exact) return exact.native;
                const loose = LANGUAGES.find(entry => entry.code.split('-')[0].toLowerCase() === primary);
                if (loose) return loose.native;
            }
        } catch (e) { }
        return primary.toUpperCase();
    }

    function isolateBidi(text) {
        return '⁨' + text + '⁩';
    }

    function promptLanguagePairLabel() {
        const pageLang = detectedPageLanguage || getPageLanguage();
        if (!pageLang) return '';
        const source = languageNativeName(pageLang);
        const target = languageNativeName(currentUiLang);
        if (!source || !target || source === target) return '';
        const arrow = isRtlLang(currentUiLang) ? ' ← ' : ' → ';
        return isolateBidi(source) + arrow + isolateBidi(target);
    }

    function createSvgIcon(size, strokeWidth, shapes) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', strokeWidth);
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        for (const [shapeTag, shapeAttrs] of shapes) {
            const shape = document.createElementNS(SVG_NS, shapeTag);
            for (const [attrName, attrValue] of Object.entries(shapeAttrs)) {
                shape.setAttribute(attrName, attrValue);
            }
            svg.appendChild(shape);
        }
        return svg;
    }

    function createTranslationPrompt(showWarning) {
        if (promptContainer || document.getElementById('gemini-translator-prompt-container')) return;
        promptContainer = document.createElement('div');
        promptContainer.id = 'gemini-translator-prompt-container';
        promptContainer.dataset.geminiIgnore = 'true';
        promptContainer.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;';
        promptShadowRoot = attachUiShadowRoot(promptContainer);

        const style = document.createElement('style');
        style.textContent = PROMPT_CSS;
        promptShadowRoot.appendChild(style);

        const root = createUiRoot();
        const card = createUiElement('div', 'card top');

        const head = createUiElement('div', 'head');
        const brand = createUiElement('div', 'app-icon');
        brand.appendChild(createSvgIcon('15', '2.25', ICON_LOGO));
        const headText = createUiElement('div', 'head-text');
        headText.appendChild(createUiElement('div', 'title', promptMessage));
        const pairLabel = promptLanguagePairLabel();
        if (pairLabel) headText.appendChild(createUiElement('div', 'sub', pairLabel));
        const dismissButton = createIconButton(ICON_CLOSE, st.closeButton);
        head.appendChild(brand);
        head.appendChild(headText);
        head.appendChild(dismissButton);
        card.appendChild(head);

        if (showWarning) {
            const warnDiv = createUiElement('div', 'warn');
            warnDiv.appendChild(createSvgIcon('14', '2', ICON_WARNING));
            warnDiv.appendChild(createUiElement('span', 'warn-text', st.reactWarning));
            card.appendChild(warnDiv);
        }

        const noButton = createTextButton('btn btn-text', translateButtonText.no);
        const yesButton = createTextButton('btn btn-filled', translateButtonText.yes);
        card.appendChild(createActionsRow([noButton, yesButton]));

        const neverRow = createUiElement('div', 'never-row');
        const neverButton = createUiElement('button', 'never-btn');
        neverButton.type = 'button';
        neverButton.appendChild(createSvgIcon('12', '2', ICON_BLOCKED));
        neverButton.appendChild(document.createTextNode(translateButtonText.never));
        neverRow.appendChild(neverButton);
        card.appendChild(neverRow);

        root.appendChild(card);
        promptShadowRoot.appendChild(root);
        document.body.appendChild(promptContainer);

        addUserClickListener(dismissButton, function () { removePrompt(); });
        addUserClickListener(yesButton, function () {
            removePrompt();
            translationStarted = true;
            rememberTranslatedDomain();
            startTranslation(true);
            sendRuntimeMessage({ action: 'startTranslationAllFrames' });
        });
        addUserClickListener(noButton, function () { removePrompt(); });
        addUserClickListener(neverButton, function () {
            chrome.storage.local.get(['excludeList'], function (items) {
                const excludeList = Array.isArray(items.excludeList) ? items.excludeList : [];
                try {
                    const currentUrl = window.location.href;
                    if (!siteListMatchesUrl(excludeList, currentUrl)) {
                        excludeList.push(new URL(currentUrl).origin);
                        chrome.storage.local.set({ excludeList });
                    }
                } catch (e) { }
            });
            removePrompt();
        });
    }

    function removePrompt() {
        if (promptContainer && promptContainer.parentNode) {
            promptContainer.parentNode.removeChild(promptContainer);
        }
        promptContainer = null;
        promptShadowRoot = null;
    }

    function removeCacheRestoreNotice() {
        if (restoreNoticeTimer !== null) {
            clearTimeout(restoreNoticeTimer);
            restoreNoticeTimer = null;
        }
        if (restoreNoticeContainer && restoreNoticeContainer.parentNode) {
            restoreNoticeContainer.parentNode.removeChild(restoreNoticeContainer);
        }
        restoreNoticeContainer = null;
    }

    function translateRemainingFromNotice() {
        removeCacheRestoreNotice();
        continueNoticeShown = false;
        continueNoticeCooldownUntil = 0;
        autoRetranslateRounds = 0;
        translationStarted = true;
        translationCancelled = false;
        translationHasError = false;
        rememberTranslatedDomain();
        startTranslation(true);
    }

    function maybeShowContinueNotice() {
        if (!IS_TOP_FRAME) return;
        if (hidePromptForAllSites) return;
        if (isCurrentUrlExcluded()) return;
        if (restoreNoticeContainer) return;
        if (Date.now() < continueNoticeCooldownUntil) return;
        if (!hasTranslatableUnitsInDocument()) return;
        continueNoticeShown = true;
        continueNoticeCooldownUntil = Date.now() + CONTINUE_NOTICE_COOLDOWN_MS;
        showCacheRestoreNotice(st.newContentTitle, false);
    }

    function showCacheRestoreNotice(titleText, offerRetranslate) {
        if (!IS_TOP_FRAME) return;
        if (restoreNoticeContainer) return;
        if (!document.body) return;
        restoreNoticeContainer = document.createElement('div');
        restoreNoticeContainer.id = 'gemini-translator-restore-container';
        restoreNoticeContainer.dataset.geminiIgnore = 'true';
        restoreNoticeContainer.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;';
        const shadow = attachUiShadowRoot(restoreNoticeContainer);

        const style = document.createElement('style');
        style.textContent = PROMPT_CSS;
        shadow.appendChild(style);

        const root = createUiRoot();
        const card = createUiElement('div', 'card top');

        const head = createUiElement('div', 'head');
        const brand = createUiElement('div', 'app-icon');
        brand.appendChild(createSvgIcon('15', '2.25', ICON_LOGO));
        const headText = createUiElement('div', 'head-text');
        headText.appendChild(createUiElement('div', 'title', titleText || st.cacheRestoredTitle));
        const pairLabel = promptLanguagePairLabel();
        if (pairLabel) headText.appendChild(createUiElement('div', 'sub', pairLabel));
        const dismissButton = createIconButton(ICON_CLOSE, st.closeButton);
        head.appendChild(brand);
        head.appendChild(headText);
        head.appendChild(dismissButton);
        card.appendChild(head);

        const actions = [];
        const continueButton = createTextButton('btn btn-text', st.translateRestButton, translateRemainingFromNotice);
        actions.push(continueButton);
        if (offerRetranslate !== false) {
            const retranslateButton = createTextButton('btn btn-text', st.retranslateButton, function () {
                autoRetranslateRounds = 0;
                continueNoticeShown = false;
                clearPageCacheAndRetranslate().catch(() => { });
            });
            actions.push(retranslateButton);
        }
        card.appendChild(createActionsRow(actions));

        root.appendChild(card);
        shadow.appendChild(root);
        document.body.appendChild(restoreNoticeContainer);

        addUserClickListener(dismissButton, removeCacheRestoreNotice);
        restoreNoticeTimer = setTimeout(removeCacheRestoreNotice, RESTORE_NOTICE_TIMEOUT_MS);
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

    function isInsideExtensionUi(node) {
        let current = node;
        while (current) {
            if (current.nodeType === Node.ELEMENT_NODE && current.dataset?.geminiIgnore === 'true') return true;
            if (current.parentElement) {
                current = current.parentElement;
            } else if (current.getRootNode && current.getRootNode() instanceof ShadowRoot) {
                current = current.getRootNode().host;
            } else {
                break;
            }
        }
        return false;
    }

    function resetIfDivergedFromTranslation(block) {
        return false;
    }

    function withScanCache(fn) {
        if (scanCache) return fn();
        scanCache = { hiddenBlockStyles: new WeakMap(), documentHasReactCustomElement: null };
        try {
            return fn();
        } finally {
            scanCache = null;
        }
    }

    function hasUntranslatedDescendant(root) {
        return withScanCache(() => hasUntranslatedDescendantScan(root));
    }

    function hasUntranslatedDescendantScan(root) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return false;
        const status = root.dataset?.translationStatus;
        if (status === 'translated' || status === 'processing' || status === 'original' || status === 'failed') return false;
        for (const child of root.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && isTranslatableText(child.textContent)) {
                return true;
            }
        }
        try {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: (node) => {
                    if (!(node instanceof Element)) return NodeFilter.FILTER_REJECT;
                    const s = node.dataset?.translationStatus;
                    if (s === 'translated' || s === 'processing' || s === 'original' || s === 'failed') return NodeFilter.FILTER_REJECT;
                    if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
                    if (isFullyExcluded(node)) {
                        return isFullyExcluded(node, true) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
                    }
                    if (BLOCK_TAGS.has(node.nodeName) || isShadowHostingCustomElement(node) || isBlockLikeAnchorInShadowHost(node)) {
                        if (blockContainsReactCustomElement(node)) return NodeFilter.FILTER_SKIP;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            });
            let el;
            while (el = walker.nextNode()) {
                for (const child of el.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE && isTranslatableText(child.textContent)) {
                        return true;
                    }
                }
            }
        } catch (e) { }
        return false;
    }

    function hasUntranslatedTextInDocument() {
        return withScanCache(hasUntranslatedTextInDocumentScan);
    }

    function hasUntranslatedTextInDocumentScan() {
        if (!document.body) return false;
        const queue = [document.body];
        const visited = new WeakSet();
        while (queue.length > 0) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);
            if (hasUntranslatedDescendant(root)) return true;
            try {
                const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
                for (const el of elements) {
                    if (el.shadowRoot && !visited.has(el.shadowRoot)) {
                        queue.push(el.shadowRoot);
                    }
                }
            } catch (e) { }
        }
        return false;
    }

    function hasTranslatableUnitsInDocument() {
        return withScanCache(hasTranslatableUnitsInDocumentScan);
    }

    function hasTranslatableUnitsInDocumentScan() {
        const blocks = collectBlocksAcrossRoots((node) => {
            if (node.dataset?.translationStatus === 'translated') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.translationStatus === 'original') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.translationStatus === 'failed') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
            return 0;
        });

        for (const block of blocks) {
            if (!block || !block.isConnected) continue;
            if (block.dataset?.translationStatus === 'translated') continue;
            if (block.dataset?.translationStatus === 'processing') continue;
            if (block.dataset?.translationStatus === 'original') continue;
            if (block.dataset?.translationStatus === 'failed') continue;
            const tu = buildTU(block);
            if (tu && tu.hasTranslatableText) return true;
        }

        return false;
    }

    function containsTranslatableContent(node) {
        return withScanCache(() => containsTranslatableContentScan(node));
    }

    function containsTranslatableContentScan(node) {
        if (!node) return false;
        if (node.nodeType === Node.TEXT_NODE) {
            return isTranslatableText(node.textContent);
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        if (isFullyExcluded(node)) return false;
        if (node.dataset?.translationStatus === 'translated') return false;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let t;
        while (t = walker.nextNode()) {
            if (isTranslatableText(t.textContent)) {
                let ancestor = t.parentElement;
                let excluded = false;
                while (ancestor && ancestor !== node) {
                    if (isFullyExcluded(ancestor)) { excluded = true; break; }
                    ancestor = ancestor.parentElement;
                }
                if (!excluded) return true;
            }
        }
        return false;
    }

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
                if (!cacheRestoreActive && !hasUntranslatedTextInDocument()) return;
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

            const maxBatchLength = Math.min(Math.floor((config.maxToken || DEFAULTS.maxToken) * 3), DEFAULTS.maxBatchLength);
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
                if (!fatalError && translatedUnitsCount > 0) {
                    finishTranslationWithFailures(failures[0]);
                } else {
                    handleTranslationError(fatalError || failures[0], lang);
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

    function forEachMarkedElement(selector, visit) {
        const queue = [];
        if (document.body) queue.push(document.body);
        const visited = new WeakSet();
        while (queue.length > 0) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);
            try {
                root.querySelectorAll(selector).forEach(visit);
                for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot && !visited.has(el.shadowRoot)) queue.push(el.shadowRoot);
                }
            } catch (e) { }
        }
    }

    function cleanupProcessingMarkers() {
        forEachMarkedElement('[data-translation-status="processing"]', el => {
            delete el.dataset.translationStatus;
        });
    }

    function countVisibleFailedBlocks() {
        let count = 0;
        forEachMarkedElement('[data-translation-status="failed"]', el => {
            if (el.dataset?.translationFailReason !== 'oversized') count++;
        });
        return count;
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

    const ERROR_CODE_MESSAGE_KEYS = {
        apiKeyNotSet: 'errApiKeyNotSet',
        invalidApiKey: 'errInvalidApiKey',
        endpointNotSet: 'errEndpointNotSet',
        modelNotSet: 'errModelNotSet',
        insufficientQuota: 'errInsufficientQuota',
        modelNotFound: 'errModelNotFound',
        apiLimitReached: 'errRateLimited',
        requestTimeout: 'errTimeout',
        serverError: 'errServerError',
        fetchError: 'errNetwork',
        maxTokensError: 'errMaxTokens',
        jsonParseFailed: 'errBadResponse',
        jsonExtractFailed: 'errBadResponse',
        emptyResponse: 'errBadResponse',
        invalidRequest: 'errInvalidRequest',
        unknownError: 'errUnknown',
        extensionReloaded: 'errExtensionReloaded'
    };

    const ERROR_CODE_ACTIONS = {
        apiKeyNotSet: 'settings',
        invalidApiKey: 'settings',
        endpointNotSet: 'settings',
        modelNotSet: 'settings',
        insufficientQuota: 'settings',
        modelNotFound: 'settings',
        invalidRequest: 'settings',
        maxTokensError: 'settings',
        blockTooLong: 'settings',
        nothingTranslated: 'retry',
        apiLimitReached: 'retry',
        requestTimeout: 'retry',
        serverError: 'retry',
        fetchError: 'retry',
        emptyResponse: 'retry',
        jsonParseFailed: 'retry',
        jsonExtractFailed: 'retry',
        unknownError: 'close',
        extensionReloaded: 'close'
    };

    function localizedErrorCause(code) {
        const messageKey = ERROR_CODE_MESSAGE_KEYS[code];
        if (!messageKey) return '';
        if (typeof TRANSLATIONS === 'undefined') return '';
        const table = TRANSLATIONS[currentUiLang] || TRANSLATIONS['en'];
        return (table && table[messageKey]) || '';
    }

    function errorActionFor(code, errorMessage) {
        if (ERROR_CODE_ACTIONS[code]) return ERROR_CODE_ACTIONS[code];
        if (code) return 'close';
        const mentionsOptions = errorMessage.includes('options page') || errorMessage.includes('オプションページ');
        return mentionsOptions ? 'legacySettings' : 'close';
    }

    function openExtensionOptions() {
        sendRuntimeMessage({ action: 'openOptionsPage' });
    }

    function retryTranslationFromPanel() {
        removeStatusIndicator();
        translationStarted = true;
        translationHasError = false;
        translationCancelled = false;
        startTranslation(true);
    }

    function createTechnicalDetails(errorMessage) {
        const details = document.createElement('details');
        details.className = 'raw';
        const summary = document.createElement('summary');
        summary.appendChild(createSvgIcon('11', '2.4', ICON_CHEVRON));
        summary.appendChild(document.createTextNode(st.errorDetails));
        details.appendChild(summary);
        const raw = document.createElement('pre');
        raw.id = 'errorText';
        raw.textContent = errorMessage;
        details.appendChild(raw);
        return details;
    }

    function createErrorActionButtons(code, errorMessage) {
        const action = errorActionFor(code, errorMessage);
        if (action === 'settings') {
            return [
                createTextButton('btn btn-text', st.retryButton, retryTranslationFromPanel),
                createTextButton('btn btn-filled', st.openOptions, openExtensionOptions)
            ];
        }
        if (action === 'retry') {
            return [
                createTextButton('btn btn-text', st.openOptions, openExtensionOptions),
                createTextButton('btn btn-filled', st.retryButton, retryTranslationFromPanel)
            ];
        }
        if (action === 'legacySettings') {
            return [
                createTextButton('btn btn-text', st.closeButton, removeStatusIndicator),
                createTextButton('btn btn-filled', st.openOptions, openExtensionOptions)
            ];
        }
        return [createTextButton('btn btn-text', st.closeButton, removeStatusIndicator)];
    }

    function showErrorPopup(errorMessage, code) {
        renderStatusPanel('error', { message: errorMessage, code: code || '' });
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

    function findBlockAncestor(node) {
        let current = node;
        while (current && current !== document.documentElement) {
            if (current.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(current.nodeName)) {
                return current;
            }
            current = current.parentElement || (current.getRootNode?.() instanceof ShadowRoot ? current.getRootNode().host : null);
        }
        return null;
    }

    function isFullyExcluded(element, ignoreVisibilityHidden) {
        if (!element || !(element instanceof Element) || !element.isConnected) return true;
        if (INLINE_SKIP_TAGS.has(element.nodeName)) return true;
        if (element.isContentEditable === true) return true;
        const editableAttr = element.getAttribute('contenteditable');
        if (typeof editableAttr === 'string' && editableAttr.toLowerCase() !== 'false') return true;
        if (element.getAttribute('role') === 'textbox') return true;
        if (element.getAttribute('translate') === 'no') return true;
        if (element.classList && element.classList.contains('notranslate')) return true;
        if (element.dataset?.geminiIgnore === 'true') return true;
        if (element.dataset?.translationWrapper === 'true') return true;
        if (element.hidden === true) return true;
        if (element.hasAttribute && element.hasAttribute('hidden')) return true;
        if (element.namespaceURI && element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return true;
        if (BLOCK_TAGS.has(element.nodeName)) {
            let hidden;
            const cached = scanCache ? scanCache.hiddenBlockStyles.get(element) : undefined;
            if (cached !== undefined) {
                hidden = cached;
            } else {
                hidden = isHiddenByComputedStyle(element);
                if (scanCache) scanCache.hiddenBlockStyles.set(element, hidden);
            }
            if (ignoreVisibilityHidden && hidden === 'visibility') return false;
            return hidden !== '';
        }
        return false;
    }

    function isHiddenByComputedStyle(element) {
        try {
            const style = window.getComputedStyle(element);
            if (style.display === 'none') return 'display';
            if (style.visibility === 'hidden') return 'visibility';
            return '';
        } catch (e) {
            return '';
        }
    }

    function isInsideEditableHost(node) {
        let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (current.isContentEditable === true) return true;
            if (typeof current.getAttribute === 'function') {
                const editableAttr = current.getAttribute('contenteditable');
                if (typeof editableAttr === 'string' && editableAttr.toLowerCase() !== 'false') return true;
                if (current.getAttribute('role') === 'textbox') return true;
            }
            current = current.parentElement || (current.getRootNode?.() instanceof ShadowRoot ? current.getRootNode().host : null);
        }
        return false;
    }

    function blockContainsReactCustomElement(node) {
        try {
            if (scanCache) {
                if (scanCache.documentHasReactCustomElement === null) {
                    scanCache.documentHasReactCustomElement = !!document.querySelector('react-app, react-partial');
                }
                if (!scanCache.documentHasReactCustomElement && node.getRootNode() === document) return false;
            }
            return !!node.querySelector('react-app, react-partial');
        } catch (e) { return false; }
    }

    function isShadowHostingCustomElement(node) {
        return !!(node && node.nodeName && node.nodeName.includes('-') && node.shadowRoot);
    }

    function isBlockLikeAnchorInShadowHost(node) {
        if (!node || node.nodeName !== 'A') return false;
        if (node.children.length > 0) return false;
        if (!node.textContent?.trim()) return false;
        let anc = node.parentElement;
        let depth = 0;
        while (anc && depth < 6) {
            if (isShadowHostingCustomElement(anc)) return true;
            anc = anc.parentElement;
            depth++;
        }
        return false;
    }

    function isInsideShadowHostingCustomElement(node) {
        let anc = node?.parentElement;
        while (anc && anc !== document.documentElement) {
            if (isShadowHostingCustomElement(anc)) return true;
            anc = anc.parentElement;
        }
        return false;
    }

    function isTranslatableText(text) {
        if (!text) return false;
        const trimmed = text.trim();
        if (trimmed.length === 0) return false;
        return /\p{L}/u.test(trimmed);
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function collectTranslationUnits() {
        return withScanCache(collectTranslationUnitsScan);
    }

    function collectBlocksAcrossRoots(rejectNode) {
        const blocks = [];
        const queue = [];
        if (document.body) queue.push(document.body);

        const visited = new WeakSet();

        while (queue.length > 0) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);

            if (root.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(root.nodeName)) {
                blocks.push(root);
            }

            try {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                    acceptNode: (node) => {
                        if (!node || !(node instanceof Element)) return NodeFilter.FILTER_REJECT;
                        const rejected = rejectNode(node);
                        if (rejected) return rejected;
                        if (isFullyExcluded(node)) {
                            return isFullyExcluded(node, true) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
                        }
                        if (node.shadowRoot) queue.push(node.shadowRoot);
                        if (BLOCK_TAGS.has(node.nodeName) || isShadowHostingCustomElement(node) || isBlockLikeAnchorInShadowHost(node)) {
                            if (blockContainsReactCustomElement(node)) return NodeFilter.FILTER_SKIP;
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
                });
                let el;
                while (el = walker.nextNode()) blocks.push(el);
            } catch (e) { continue; }
        }

        return blocks;
    }

    function collectTranslationUnitsScan() {
        const tus = [];
        translationUnits.clear();
        let tuIdCounter = 0;

        const blocks = collectBlocksAcrossRoots((node) => {
            if (node.dataset?.translationStatus === 'translated') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.translationStatus === 'original') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.translationStatus === 'failed') return NodeFilter.FILTER_REJECT;
            if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
            return 0;
        });

        for (const block of blocks) {
            if (!block || !block.isConnected) continue;
            if (block.dataset?.translationStatus === 'translated') continue;
            if (block.dataset?.translationStatus === 'processing') continue;
            if (block.dataset?.translationStatus === 'original') continue;
            if (block.dataset?.translationStatus === 'failed') continue;
            const tu = buildTU(block);
            if (tu && tu.hasTranslatableText) {
                tu.id = `tu_${translationRunGeneration}_${tuIdCounter++}`;
                tus.push(tu);
                translationUnits.set(tu.id, tu);
            }
        }

        return tus;
    }

    function buildTU(block) {
        const placeholders = [];
        const textRuns = [];
        const commentAnchors = [];
        let commentAnchorCount = 0;
        let template = '';
        let hasTranslatableText = false;
        let anchorDepth = 0;
        let runOpen = false;
        let rebuiltScope = block;

        function visit(node) {
            if (node.nodeType === Node.COMMENT_NODE) {
                commentAnchors.push({ scope: rebuiltScope, node });
                commentAnchorCount++;
                return;
            }
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!runOpen) {
                    textRuns.push({ nodes: [], translatable: false });
                    runOpen = true;
                }
                const run = textRuns[textRuns.length - 1];
                run.nodes.push(node);
                if (isTranslatableText(text)) {
                    hasTranslatableText = true;
                    run.translatable = true;
                }
                template += escapeHtml(text);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            if (node === block) {
                for (const child of node.childNodes) visit(child);
                return;
            }

            const childStatus = node.dataset?.translationStatus;
            if (childStatus === 'translated' || childStatus === 'original') {
                const idx = placeholders.length;
                placeholders.push({ type: 'skip', ph: `s${idx}`, node });
                commentAnchors.push({ scope: rebuiltScope, node });
                template += `<s${idx}></s${idx}>`;
                runOpen = false;
                return;
            }

            if (BLOCK_TAGS.has(node.nodeName) || isShadowHostingCustomElement(node) || isBlockLikeAnchorInShadowHost(node)) {
                const idx = placeholders.length;
                placeholders.push({ type: 'block', ph: `b${idx}`, node });
                commentAnchors.push({ scope: rebuiltScope, node });
                template += `<b${idx}></b${idx}>`;
                runOpen = false;
                return;
            }

            if (isFullyExcluded(node)) {
                const idx = placeholders.length;
                placeholders.push({ type: 'skip', ph: `s${idx}`, node });
                commentAnchors.push({ scope: rebuiltScope, node });
                template += `<s${idx}></s${idx}>`;
                runOpen = false;
                return;
            }

            if (node.nodeName === 'A') {
                if (anchorDepth > 0) {
                    for (const child of node.childNodes) visit(child);
                    return;
                }
                const idx = placeholders.length;
                const originalText = (node.textContent || '').trim();
                placeholders.push({ type: 'anchor', ph: `a${idx}`, node, originalText });
                commentAnchors.push({ scope: rebuiltScope, node });
                template += `<a${idx}>`;
                runOpen = false;
                anchorDepth++;
                const outerAnchorScope = rebuiltScope;
                rebuiltScope = node;
                for (const child of node.childNodes) visit(child);
                rebuiltScope = outerAnchorScope;
                anchorDepth--;
                template += `</a${idx}>`;
                runOpen = false;
                return;
            }

            const idx = placeholders.length;
            placeholders.push({ type: 'tag', ph: `t${idx}`, node });
            commentAnchors.push({ scope: rebuiltScope, node });
            template += `<t${idx}>`;
            runOpen = false;
            const outerTagScope = rebuiltScope;
            rebuiltScope = node;
            for (const child of node.childNodes) visit(child);
            rebuiltScope = outerTagScope;
            template += `</t${idx}>`;
            runOpen = false;
        }

        for (const child of block.childNodes) visit(child);

        const normalizedTemplate = template.replace(/[\t\n\r\f]+/g, ' ').replace(/ +/g, ' ').trim();
        if (!normalizedTemplate) return null;

        return {
            block,
            template: normalizedTemplate,
            placeholders,
            textRuns,
            commentAnchors: commentAnchorCount > 0 ? commentAnchors : null,
            hasTranslatableText,
            originalInnerHTML: block.innerHTML
        };
    }

    function createBatches(tus, batchSize, maxBatchLength) {
        const batches = [];
        let current = [];
        let currentLength = 0;
        let currentCount = 0;
        for (const tu of tus) {
            const tuLength = tu.template.length;
            if (current.length > 0 && (currentCount + 1 > batchSize || currentLength + tuLength > maxBatchLength)) {
                batches.push(current);
                current = [];
                currentLength = 0;
                currentCount = 0;
            }
            current.push({ id: tu.id, template: tu.template });
            currentLength += tuLength;
            currentCount += 1;
        }
        if (current.length > 0) batches.push(current);
        return batches;
    }

    function unitsNotReturned(batch, translations) {
        const returnedIds = new Set();
        if (Array.isArray(translations)) {
            for (const translated of translations) {
                if (translated && typeof translated.translatedTemplate === 'string') returnedIds.add(translated.id);
            }
        }
        const missing = [];
        if (Array.isArray(batch)) {
            for (const item of batch) {
                if (!returnedIds.has(item.id)) missing.push(item.id);
            }
        }
        return missing;
    }

    function markMissingBatchUnitsFailed(batch, translations) {
        for (const id of unitsNotReturned(batch, translations)) {
            const block = translationUnits.get(id)?.block;
            if (!block || !block.isConnected) continue;
            if (block.dataset?.translationStatus === 'translated') continue;
            try {
                block.dataset.translationStatus = 'failed';
                block.dataset.translationFailReason = 'missing';
            } catch (e) { }
        }
    }

    function markOversizedUnitsSkipped(oversizedTus) {
        for (const tu of oversizedTus) {
            const block = tu?.block;
            if (!block || !block.isConnected) continue;
            if (block.dataset?.translationStatus === 'translated') continue;
            try {
                block.dataset.translationStatus = 'failed';
                block.dataset.translationFailReason = 'oversized';
            } catch (e) { }
        }
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

    async function resendOnce(unitIds, runGeneration) {
        const ids = Array.from(unitIds).slice(0, AUTO_RESEND_MAX_UNITS);
        for (const id of ids) {
            if (translationCancelled || fatalErrorCancelPending) break;
            if (runGeneration !== translationRunGeneration) break;
            const tu = translationUnits.get(id);
            if (!tu || !tu.block || !tu.block.isConnected) continue;
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

    function createOrShowProgressPopup(lang) {
        if (!statusContainer) {
            createStatusIndicator(lang);
        } else {
            statusContainer.style.display = 'block';
            removeMinimizedIndicator();
            renderStatusPanel('progress', { lang });
        }
        updateProgress();
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

    function createStatusIndicator(lang) {
        removeStatusIndicator();
        statusContainer = document.createElement('div');
        statusContainer.id = 'gemini-translator-status-container';
        statusContainer.dataset.geminiIgnore = 'true';
        statusContainer.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;';
        statusShadowRoot = attachUiShadowRoot(statusContainer);

        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        statusShadowRoot.appendChild(style);

        const root = createUiRoot();
        const card = createUiElement('div', 'card bottom');
        card.id = 'translationStatus';
        root.appendChild(card);
        statusShadowRoot.appendChild(root);
        document.body.appendChild(statusContainer);

        renderStatusPanel('progress', { lang });
    }

    function ensureStatusPanelForError() {
        if (!IS_TOP_FRAME) return false;
        if (!statusContainer || !statusShadowRoot) {
            createStatusIndicator();
        } else {
            statusContainer.style.display = 'block';
        }
        removeMinimizedIndicator();
        return !!statusShadowRoot;
    }

    function getStatusCard() {
        return statusShadowRoot ? statusShadowRoot.querySelector('#translationStatus') : null;
    }

    function cancelStatusAutoDismiss() {
        if (statusAutoDismissTimer === null) return;
        clearTimeout(statusAutoDismissTimer);
        statusAutoDismissTimer = null;
    }

    function showCacheSaveFailureNote(message) {
        if (!IS_TOP_FRAME) return;
        if (!message) return;
        cancelStatusAutoDismiss();
        if (!ensureStatusPanelForError()) return;
        if (statusPanelPhase !== 'done' && statusPanelPhase !== 'error') renderStatusPanel('done');
        const card = getStatusCard();
        const headText = card ? card.querySelector('.head-text') : null;
        if (!headText) return;
        const existing = headText.querySelector('#translationCacheNote');
        if (existing) {
            existing.textContent = message;
            return;
        }
        const note = createUiElement('div', 'sub', message);
        note.id = 'translationCacheNote';
        headText.appendChild(note);
    }

    function statusPanelTitle(phase) {
        if (phase === 'done') return st.translationCompleted;
        if (phase === 'cancelled') return st.translationCancelled;
        if (phase === 'empty') return st.noTextFound;
        if (phase === 'error') return st.errorTitle || st.errorOccurred;
        return st.translating;
    }

    function createStatusLeadIcon(phase) {
        if (phase === 'progress') {
            const brand = createUiElement('div', 'app-icon');
            brand.appendChild(createSvgIcon('15', '2.25', ICON_LOGO));
            return brand;
        }
        if (phase === 'done') {
            const done = createUiElement('div', 'status-ico ok');
            done.appendChild(createSvgIcon('15', '2.6', ICON_CHECK));
            return done;
        }
        if (phase === 'error') {
            const failed = createUiElement('div', 'status-ico err');
            failed.appendChild(createSvgIcon('15', '2.4', ICON_ALERT));
            return failed;
        }
        const stopped = createUiElement('div', 'status-ico neutral');
        stopped.appendChild(createSvgIcon('15', '2', ICON_BLOCKED));
        return stopped;
    }

    function translatedBlocksLabel() {
        if (!st.blocksTemplate) return '';
        return st.blocksTemplate
            .replace('{translated}', translatedUnitsCount)
            .replace('{total}', expectedTotalUnits);
    }

    function renderStatusPanel(phase, detail) {
        const card = getStatusCard();
        if (!card) return;
        statusPanelPhase = phase;
        const options = detail || {};
        while (card.firstChild) card.removeChild(card.firstChild);

        const head = createUiElement('div', 'head');
        head.appendChild(createStatusLeadIcon(phase));

        const headText = createUiElement('div', 'head-text');
        const title = createUiElement('div', 'title', statusPanelTitle(phase));
        title.id = 'translationHeaderText';
        headText.appendChild(title);
        if (phase === 'progress') {
            const note = createUiElement('div', 'sub', st.streamingNote);
            note.id = 'translationStreamNote';
            note.hidden = true;
            headText.appendChild(note);
        } else if (phase === 'done') {
            const blocks = translatedBlocksLabel();
            if (blocks) headText.appendChild(createUiElement('div', 'sub', blocks));
            if (oversizedSkippedCount > 0) {
                const skipped = oversizedSkippedLabel();
                if (skipped) headText.appendChild(createUiElement('div', 'sub', skipped));
            }
            const failedCount = countVisibleFailedBlocks();
            if (failedCount > 0 && st.someBlocksFailed) {
                headText.appendChild(createUiElement('div', 'sub', st.someBlocksFailed.replace('{count}', failedCount)));
            }
        }
        head.appendChild(headText);

        head.appendChild(phase === 'progress'
            ? createIconButton(ICON_MINIMIZE, st.minimizeLabel, 'minimizeStatusBtn')
            : createIconButton(ICON_CLOSE, st.closeButton, 'closeStatusBtn'));
        card.appendChild(head);

        if (phase === 'progress') {
            const bar = createUiElement('div', 'progress-bar');
            bar.id = 'translationProgressBar';
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-valuemin', '0');
            bar.setAttribute('aria-valuemax', '100');
            bar.setAttribute('aria-valuenow', '0');
            const fill = createUiElement('div', 'progress-fill');
            fill.id = 'translationProgressFill';
            bar.appendChild(fill);
            card.appendChild(bar);

            const caption = createUiElement('div', 'caption');
            const percent = createUiElement('span', 'pct', '0%');
            percent.id = 'translationProgressText';
            const stats = createUiElement('span', 'stats');
            stats.id = 'translationStats';
            caption.appendChild(percent);
            caption.appendChild(stats);
            card.appendChild(caption);

            const cancelButton = createTextButton('btn btn-danger-text', st.cancelButton, () => handleCancelButtonClick(options.lang), 'cancelTranslationBtn');
            card.appendChild(createActionsRow([cancelButton]));
        } else if (phase === 'error') {
            const rawMessage = options.message || st.errorOccurred;
            const cause = localizedErrorCause(options.code);
            card.appendChild(createUiElement('div', 'cause', cause || rawMessage));
            if (cause && rawMessage && rawMessage !== cause) {
                card.appendChild(createTechnicalDetails(rawMessage));
            }
            card.appendChild(createActionsRow(createErrorActionButtons(options.code, rawMessage)));
        } else if (phase === 'done') {
            const failedCount = countVisibleFailedBlocks();
            if (failedCount > 0 && st.retryFailedButton) {
                card.appendChild(createActionsRow([createTextButton('btn btn-text', st.retryFailedButton, retryFailedBlocks, 'retryFailedBtn')]));
            }
        }

        const closeStatusBtn = card.querySelector('#closeStatusBtn');
        if (closeStatusBtn) addUserClickListener(closeStatusBtn, removeStatusIndicator);
        const minimizeButton = card.querySelector('#minimizeStatusBtn');
        if (minimizeButton) {
            addUserClickListener(minimizeButton, function (e) {
                e.stopPropagation();
                minimizeStatusIndicator();
            });
        }
        if (phase === 'progress' && streamingActive) applyStreamingIndicator();
    }

    function applyStreamingIndicator() {
        if (!statusShadowRoot) return;
        const bar = statusShadowRoot.querySelector('#translationProgressBar');
        if (bar) bar.classList.add('streaming');
        const note = statusShadowRoot.querySelector('#translationStreamNote');
        if (note) {
            note.textContent = st.streamingNote;
            note.hidden = false;
        }
    }

    function markStreamingActive() {
        if (!streamingEnabled || streamingActive) return;
        streamingActive = true;
        applyStreamingIndicator();
    }

    function removeMinimizedIndicator() {
        if (minimizedDiv && minimizedDiv.parentNode) {
            minimizedDiv.parentNode.removeChild(minimizedDiv);
        }
        minimizedDiv = null;
        minimizedShadowRoot = null;
    }

    function restoreStatusPanelFromMinimized() {
        if (statusContainer) statusContainer.style.display = 'block';
        removeMinimizedIndicator();
    }

    function removeStatusIndicator() {
        statusPanelPhase = '';
        if (statusContainer && statusContainer.parentNode) {
            statusContainer.parentNode.removeChild(statusContainer);
            statusContainer = null;
            statusShadowRoot = null;
        }
        removeMinimizedIndicator();
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    const MINI_RING_RADIUS = 17;

    function createMiniProgressRing() {
        const ring = document.createElementNS(SVG_NS, 'svg');
        ring.setAttribute('class', 'ring');
        ring.setAttribute('viewBox', '0 0 40 40');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('aria-hidden', 'true');
        const circumference = 2 * Math.PI * MINI_RING_RADIUS;
        for (const role of ['track', 'value']) {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('class', role);
            circle.setAttribute('cx', '20');
            circle.setAttribute('cy', '20');
            circle.setAttribute('r', String(MINI_RING_RADIUS));
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke-width', '3');
            if (role === 'value') {
                circle.id = 'minimizedProgressRing';
                circle.setAttribute('stroke-linecap', 'round');
                circle.setAttribute('stroke-dasharray', circumference.toFixed(1));
                circle.setAttribute('stroke-dashoffset', circumference.toFixed(1));
                circle.setAttribute('transform', 'rotate(-90 20 20)');
            }
            ring.appendChild(circle);
        }
        return ring;
    }

    function renderMiniProgress(percent) {
        if (!minimizedDiv || !minimizedShadowRoot) return;
        const label = minimizedShadowRoot.getElementById('minimizedProgressText');
        if (label) label.textContent = percent.toFixed(0) + '%';
        const ring = minimizedShadowRoot.getElementById('minimizedProgressRing');
        if (ring) {
            const circumference = 2 * Math.PI * MINI_RING_RADIUS;
            const clamped = Math.max(0, Math.min(100, percent));
            ring.setAttribute('stroke-dashoffset', (circumference * (1 - clamped / 100)).toFixed(1));
        }
    }

    function minimizeStatusIndicator() {
        if (!statusContainer) return;
        statusContainer.style.display = 'none';
        if (!minimizedDiv) {
            minimizedDiv = document.createElement('div');
            minimizedDiv.id = 'gemini-translator-minimized-container';
            minimizedDiv.dataset.geminiIgnore = 'true';
            minimizedDiv.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;';
            minimizedShadowRoot = attachUiShadowRoot(minimizedDiv);
            const style = document.createElement('style');
            style.textContent = MINI_CSS;
            const root = createUiRoot();
            const miniButton = createUiElement('button', 'mini');
            miniButton.type = 'button';
            miniButton.title = st.restoreLabel;
            miniButton.setAttribute('aria-label', st.restoreLabel);
            miniButton.appendChild(createMiniProgressRing());
            const label = createUiElement('span', 'pct-label', '0%');
            label.id = 'minimizedProgressText';
            miniButton.appendChild(label);
            root.appendChild(miniButton);
            minimizedShadowRoot.appendChild(style);
            minimizedShadowRoot.appendChild(root);
            document.body.appendChild(minimizedDiv);
            addUserClickListener(miniButton, function () {
                if (statusContainer) statusContainer.style.display = 'block';
                removeMinimizedIndicator();
            });
        }
        renderMiniProgress(translationProgress);
    }

    function updateProgress(forcePercent = null) {
        if (typeof forcePercent === 'number') {
            translationProgress = Math.max(0, Math.min(100, forcePercent));
        } else {
            translationProgress = (expectedTotalUnits > 0)
                ? parseFloat(((translatedUnitsCount / expectedTotalUnits) * 100).toFixed(1))
                : (translationCancelled || !isTranslating ? 100 : 0);
        }
        if (statusShadowRoot) {
            const progressBar = statusShadowRoot.querySelector('#translationProgressBar');
            const progressFill = statusShadowRoot.querySelector('#translationProgressFill');
            const progressText = statusShadowRoot.querySelector('#translationProgressText');
            const statsElem = statusShadowRoot.querySelector('#translationStats');
            if (progressFill && progressText) {
                progressFill.style.width = translationProgress + '%';
                progressText.textContent = translationProgress.toFixed(1) + '%';
            }
            if (progressBar) {
                progressBar.style.setProperty('--stream-offset', translationProgress + '%');
                progressBar.setAttribute('aria-valuenow', translationProgress.toFixed(0));
            }
            if (statsElem) {
                statsElem.textContent = st.progressTemplate
                    .replace('{currentBatch}', batchesProcessed)
                    .replace('{totalBatch}', totalBatches)
                    .replace('{translatedUnits}', translatedUnitsCount)
                    .replace('{totalUnits}', expectedTotalUnits);
            }
        }
        renderMiniProgress(translationProgress);
        sendRuntimeMessage({
            action: "updateProgress",
            progress: translationProgress,
            stats: {
                batches: batchesProcessed,
                totalBatches,
                translatedFragments: translatedUnitsCount,
                totalFragments: expectedTotalUnits
            }
        });
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
                    if (!hasUntranslatedTextInDocument()) return;
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

    function computeHasRemainingForPopup() {
        if (isTranslating || isApplyingUpdates) return false;
        const now = Date.now();
        if (now - popupRemainingMemo.ts < 1500) return popupRemainingMemo.value;
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
            restorableChars: (cacheCoverageMemo && cacheCoverageMemo.matched) || 0,
            totalChars: (cacheCoverageMemo && cacheCoverageMemo.total) || 0,
            cacheReadError: (cacheCoverageMemo && cacheCoverageMemo.error) || '',
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
        const maxBatchLength = Math.min(Math.floor((config.maxToken || DEFAULTS.maxToken) * 3), DEFAULTS.maxBatchLength);

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
})();
