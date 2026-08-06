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
        showOriginal: 'Show original',
        errorTitle: 'Translation failed',
        errorDetails: 'Technical details',
        retryButton: 'Retry'
    };

    const RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);
    let currentUiLang = 'en';

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
            showOriginal: t.panelShowOriginal,
            errorTitle: t.errTitle,
            errorDetails: t.errDetails,
            retryButton: t.errRetry
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

    let isTranslating = false;
    let translationStarted = false;
    let translationCancelled = false;
    let translationHasError = false;

    let translationProgress = 0;
    let translatedUnitsCount = 0;
    let expectedTotalUnits = 0;
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
    let promptContainer = null;
    let promptShadowRoot = null;
    let minimizedDiv = null;
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
    let pendingRetranslation = false;
    let cacheRestoreMap = null;
    let cacheRestoreActive = false;
    let postNavigationCooldownUntil = 0;
    let highlightTranslated = false;
    let lastFinishTime = 0;
    let postFinishScanCount = 0;
    const POST_FINISH_MAX_SCANS = 1;
    const POST_FINISH_SCAN_DELAYS = [3000];

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
            const reloaded = isPageReloaded();
            chrome.storage.local.get(
                ['targetLanguage', 'realTimeTranslation', 'excludeList', 'hidePromptAllSites', 'autoRetranslateDomain', 'toggleBlueBackground'],
                async function (items) {
                    try { watchForNewContent(); } catch (e) { }
                    try { watchUserInteractions(); } catch (e) { }
                    try { watchSpaUrlChanges(); } catch (e) { }
                    try { watchScrollForNewContent(); } catch (e) { }

                    const pageLang = getPageLanguage();
                    const chosenLang = items.targetLanguage || 'en';
                    applyStrings(chosenLang);

                    const isReactSpa = isLikelyReactApp();
                    const currentUrl = window.location.href;
                    const excludeList = items.excludeList || [];
                    let siteOrigin = '';
                    try { siteOrigin = new URL(currentUrl).origin; } catch (e) { }
                    const isExcluded = excludeList.some(prefix => currentUrl.startsWith(prefix) || siteOrigin === prefix);
                    if (reloaded) {
                        cacheRestoreMap = null;
                        cacheRestoreActive = false;
                        await clearPageCache();
                    } else if (!isReactSpa && !isExcluded && items.autoRetranslateDomain !== false) {
                        const restored = await tryRestoreFromCache(chosenLang);
                        if (restored || cacheRestoreActive) {
                            translationStarted = true;
                            if (items.toggleBlueBackground) {
                                try {
                                    document.querySelectorAll('[data-translation-status="translated"]').forEach(b => {
                                        if (b.dataset && b.dataset.geminiIgnore !== 'true') b.classList.add('translated-text');
                                    });
                                } catch (e) { }
                            }
                            rememberTranslatedDomain();
                            pendingRetranslation = true;
                            scheduleRetranslationIfNeeded();
                            return;
                        }
                    }
                    const languageDecision = resolvePageLanguageDecision(await detectContentLanguage(), pageLang, chosenLang);

                    const translationStarter = () => {
                        if (isTranslating) return;
                        if (!translationStarted) return;
                        startTranslation();
                    };

                    const autoRetranslateEnabled = items.autoRetranslateDomain !== false;

                    const beginAutoTranslation = () => {
                        if (isExcluded) return;
                        if (languageDecision.skipAutoTranslation) return;
                        translationStarted = true;
                        setTimeout(translationStarter, 100);
                        setTimeout(translationStarter, 1500);
                    };

                    if (items.realTimeTranslation === true && !isReactSpa) {
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

                    function showPromptIfNeeded() {
                        if (!IS_TOP_FRAME) return;
                        if (!languageDecision.pageIsTargetLanguage) {
                            if (items.hidePromptAllSites !== true) {
                                createTranslationPrompt(false);
                            }
                        }
                    }
                }
            );
        } catch (error) { }
    }

    function querySessionDomainKnown(callback) {
        try {
            chrome.runtime.sendMessage({ action: 'sessionIsDomainKnown' }, (response) => {
                if (chrome.runtime.lastError) { callback(false); return; }
                callback(!!response?.known);
            });
        } catch (e) { callback(false); }
    }

    function rememberTranslatedDomain() {
        try {
            chrome.runtime.sendMessage({ action: 'sessionMarkTranslated' }).catch(() => { });
        } catch (e) { }
    }

    const PAGE_CACHE_PREFIX = 'pageCache_';
    const PAGE_CACHE_MAX_ENTRIES = 500;

    function computeStringHash(s) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            hash ^= s.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        return hash.toString(36);
    }

    function isPageReloaded() {
        try {
            const navEntries = performance.getEntriesByType('navigation');
            if (navEntries && navEntries.length > 0) return navEntries[0].type === 'reload';
        } catch (e) { }
        try { if (performance.navigation && performance.navigation.type === 1) return true; } catch (e) { }
        return false;
    }

    function getCurrentPageKey() {
        try {
            const url = new URL(window.location.href);
            return PAGE_CACHE_PREFIX + computeStringHash(url.origin + url.pathname + url.search);
        } catch (e) { return null; }
    }

    function collectCacheableBlocks() {
        const result = [];
        if (!document.body) return result;
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
                acceptNode: (node) => {
                    if (!node || !(node instanceof Element)) return NodeFilter.FILTER_REJECT;
                    if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
                    if (node.dataset?.geminiIgnore === 'true') return NodeFilter.FILTER_REJECT;
                    if (isFullyExcluded(node)) return NodeFilter.FILTER_REJECT;
                    if (BLOCK_TAGS.has(node.nodeName) || isShadowHostingCustomElement(node) || isBlockLikeAnchorInShadowHost(node)) {
                        if (blockContainsReactCustomElement(node)) return NodeFilter.FILTER_SKIP;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            });
            let el;
            while (el = walker.nextNode()) result.push(el);
        } catch (e) { }
        return result;
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

    function getPageCache() {
        return new Promise(resolve => {
            try {
                const key = getCurrentPageKey();
                if (!key) { resolve(null); return; }
                chrome.runtime.sendMessage({ action: 'pageCacheGet', key }, (response) => {
                    if (chrome.runtime.lastError || !response) { resolve(null); return; }
                    resolve(response.cache || null);
                });
            } catch (e) { resolve(null); }
        });
    }

    function savePageCache(cache) {
        return new Promise(resolve => {
            try {
                const key = getCurrentPageKey();
                if (!key) { resolve(false); return; }
                chrome.runtime.sendMessage({ action: 'pageCacheSet', key, cache }, (response) => {
                    if (chrome.runtime.lastError || !response) { resolve(false); return; }
                    resolve(!!response.saved);
                });
            } catch (e) { resolve(false); }
        });
    }

    function clearPageCache() {
        return new Promise(resolve => {
            try {
                const key = getCurrentPageKey();
                if (!key) { resolve(); return; }
                chrome.runtime.sendMessage({ action: 'pageCacheDelete', key }, () => {
                    void chrome.runtime.lastError;
                    resolve();
                });
            } catch (e) { resolve(); }
        });
    }

    function pruneOldCaches() {
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage({ action: 'pageCachePrune', maxEntries: PAGE_CACHE_MAX_ENTRIES }, () => {
                    void chrome.runtime.lastError;
                    resolve();
                });
            } catch (e) { resolve(); }
        });
    }

    function compositeBlockKey(textKey, tagName) {
        return textKey + '|' + (tagName || '');
    }

    async function tryRestoreFromCache(targetLanguage) {
        if (!cacheRestoreMap) {
            if (!targetLanguage) return false;
            const cache = await getPageCache();
            if (!cache || !Array.isArray(cache.blocks)) return false;
            if (cache.lang !== targetLanguage) {
                await clearPageCache();
                return false;
            }
            const map = new Map();
            for (const entry of cache.blocks) {
                if (entry && entry.textKey && entry.tagName) {
                    map.set(compositeBlockKey(entry.textKey, entry.tagName), entry);
                }
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

    async function saveCurrentTranslationToCache() {
        const blocks = collectCacheableBlocks();
        if (blocks.length === 0) return;
        const entries = [];
        const seen = new Set();
        for (const block of blocks) {
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
        const lang = await getStoredTargetLanguage();
        if (!lang) return;
        let pageUrl = '';
        try { pageUrl = window.location.href; } catch (e) { }
        const saved = await savePageCache({
            url: pageUrl,
            lang,
            blocks: entries,
            savedAt: Date.now()
        });
        if (saved) pruneOldCaches().catch(() => { });
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
                    if (hasUntranslatedTextInDocument()) {
                        startTranslation();
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
        pendingRetranslation = false;
        lastScrollScanHeight = -1;
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

    function resolvePageLanguageDecision(detected, pageLang, chosenLang) {
        const pageLangPrimary = pageLang ? pageLang.split('-')[0].toLowerCase() : null;
        const chosenLangPrimary = chosenLang.split('-')[0].toLowerCase();
        const attributeSaysTargetLanguage = !!(pageLangPrimary && pageLangPrimary === chosenLangPrimary);
        const detectionUsable = !!(detected && detected.confidence >= LANGUAGE_DETECTION_MIN_CONFIDENCE);
        const pageIsTargetLanguage = detectionUsable
            ? detectedLanguageMatchesTarget(detected, chosenLang)
            : attributeSaysTargetLanguage;
        const skipAutoTranslation = !!(detected
            && detected.confidence >= LANGUAGE_DETECTION_AUTO_SKIP_CONFIDENCE
            && detectedLanguageMatchesTarget(detected, chosenLang));
        return { pageIsTargetLanguage, skipAutoTranslation };
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

    function createTextButton(className, label, onClick, elementId) {
        const button = createUiElement('button', className, label);
        button.type = 'button';
        if (elementId) button.id = elementId;
        if (onClick) button.addEventListener('click', onClick);
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
        const pageLang = getPageLanguage();
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
        promptShadowRoot = promptContainer.attachShadow({ mode: 'open' });

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

        dismissButton.addEventListener('click', function () { removePrompt(); });
        yesButton.addEventListener('click', function () {
            removePrompt();
            translationStarted = true;
            rememberTranslatedDomain();
            startTranslation(true);
            try { chrome.runtime.sendMessage({ action: 'startTranslationAllFrames' }).catch(() => { }); } catch (e) { }
        });
        noButton.addEventListener('click', function () { removePrompt(); });
        neverButton.addEventListener('click', function () {
            chrome.storage.local.get(['excludeList'], function (items) {
                let excludeList = items.excludeList || [];
                try {
                    const siteOrigin = new URL(window.location.href).origin;
                    if (!excludeList.includes(siteOrigin)) {
                        excludeList.push(siteOrigin);
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
            if (isTranslating || isApplyingUpdates) {
                pendingRetranslation = true;
            } else {
                clearTimeout(observerDebounceTimer);
                observerDebounceTimer = setTimeout(() => {
                    if (translationStarted && !isTranslating && !translationCancelled) {
                        startTranslation();
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
                    if (isFullyExcluded(node)) return NodeFilter.FILTER_REJECT;
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
                pendingRetranslation = false;
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
                    pendingRetranslation = true;
                    return;
                }
                if (cacheRestoreActive || hasUntranslatedTextInDocument()) {
                    startTranslation();
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
        }
        const cooldownRemaining = postNavigationCooldownUntil - Date.now();
        if (cooldownRemaining > 0) {
            pendingRetranslation = true;
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
        await waitForPendingApply();
        const runGeneration = ++translationRunGeneration;
        pendingRetranslation = false;
        translationCancelled = false;
        translationHasError = false;
        translatedUnitsCount = 0;
        totalBatches = 0;
        batchesProcessed = 0;
        expectedTotalUnits = 0;
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
            applyStrings(lang);

            const allTus = collectTranslationUnits();
            if (allTus.length === 0) {
                isTranslating = false;
                chrome.runtime.sendMessage({ action: "translationComplete", message: st.noTextFound }).catch(() => { });
                return;
            }

            const maxBatchLength = Math.min(Math.floor((config.maxToken || DEFAULTS.maxToken) * 3), DEFAULTS.maxBatchLength);
            const tus = allTus.filter(tu => tu.template.length <= maxBatchLength);
            if (tus.length === 0) {
                isTranslating = false;
                chrome.runtime.sendMessage({ action: "translationComplete", message: st.noTextFound }).catch(() => { });
                return;
            }
            expectedTotalUnits = tus.length;

            const batches = createBatches(tus, config.batchSize || DEFAULTS.batchSize, maxBatchLength);
            totalBatches = batches.length;

            for (const tu of tus) {
                if (tu.block && tu.block.isConnected) {
                    tu.block.dataset.translationStatus = 'processing';
                    try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }
                }
            }

            if (config.showProgressPopup !== false && IS_TOP_FRAME) {
                createOrShowProgressPopup(lang);
                if (progressInterval) clearInterval(progressInterval);
                progressInterval = setInterval(() => updateProgress(), 300);
            }
            updateProgress();

            const failures = [];
            let cancelledBatchCount = 0;
            let fatalCancelSent = false;
            const batchPromises = batches.map(batch =>
                processBatch(batch, runGeneration)
                    .then(translations => {
                        if (runGeneration !== translationRunGeneration || translationCancelled) return;
                        batchesProcessed++;
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
                        failures.push(error);
                        if (error?.translationFatal === true && !fatalCancelSent && !translationCancelled) {
                            fatalCancelSent = true;
                            try {
                                chrome.runtime.sendMessage({ action: "cancelTranslation" })
                                    ?.catch?.(() => { });
                            } catch (e) { }
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
            } else {
                finishTranslation();
            }
        } catch (error) {
            if (!translationCancelled) handleTranslationError(error, lang);
        } finally {
            isTranslating = false;
            if (progressInterval) clearInterval(progressInterval);
            cleanupProcessingMarkers();
            scheduleRetranslationIfNeeded();
        }
    }

    function scheduleRetranslationIfNeeded() {
        if (!translationStarted) return;
        if (translationCancelled || translationHasError) return;
        if (isTranslating || isApplyingUpdates) return;
        if (!pendingRetranslation) return;
        pendingRetranslation = false;
        clearTimeout(observerDebounceTimer);
        observerDebounceTimer = setTimeout(() => {
            if (translationStarted && !isTranslating && !translationCancelled && !translationHasError) {
                startTranslation();
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
        if (ensureStatusPanelForError()) showErrorPopup(errorMessage, errorCode);
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        cleanupProcessingMarkers();
        chrome.runtime.sendMessage({ action: "translationError", error: errorMessage, code: errorCode }).catch(() => { });
    }

    function translationErrorCodeOf(error) {
        return typeof error?.translationErrorCode === 'string' ? error.translationErrorCode : '';
    }

    function cleanupProcessingMarkers() {
        const queue = [];
        if (document.body) queue.push(document.body);
        const visited = new WeakSet();
        while (queue.length > 0) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);
            try {
                root.querySelectorAll('[data-translation-status="processing"]').forEach(el => {
                    delete el.dataset.translationStatus;
                });
                for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot && !visited.has(el.shadowRoot)) queue.push(el.shadowRoot);
                }
            } catch (e) { }
        }
    }

    const ERROR_CODE_MESSAGE_KEYS = {
        apiKeyNotSet: 'errApiKeyNotSet',
        invalidApiKey: 'errInvalidApiKey',
        endpointNotSet: 'errEndpointNotSet',
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
        unknownError: 'errUnknown'
    };

    const ERROR_CODE_ACTIONS = {
        apiKeyNotSet: 'settings',
        invalidApiKey: 'settings',
        endpointNotSet: 'settings',
        insufficientQuota: 'settings',
        modelNotFound: 'settings',
        invalidRequest: 'settings',
        maxTokensError: 'settings',
        apiLimitReached: 'retry',
        requestTimeout: 'retry',
        serverError: 'retry',
        fetchError: 'retry',
        emptyResponse: 'retry',
        jsonParseFailed: 'retry',
        jsonExtractFailed: 'retry',
        unknownError: 'close'
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
        try { chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(() => { }); } catch (e) { }
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
        renderStatusPanel('cancelled');
        cleanupProcessingMarkers();
        chrome.runtime.sendMessage({ action: "translationCancelled" }).catch(() => { });
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

    function isFullyExcluded(element) {
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
            if (scanCache) {
                const cached = scanCache.hiddenBlockStyles.get(element);
                if (cached !== undefined) return cached;
                const hidden = isHiddenByComputedStyle(element);
                scanCache.hiddenBlockStyles.set(element, hidden);
                return hidden;
            }
            return isHiddenByComputedStyle(element);
        }
        return false;
    }

    function isHiddenByComputedStyle(element) {
        try {
            const style = window.getComputedStyle(element);
            return style.display === 'none' || style.visibility === 'hidden';
        } catch (e) {
            return false;
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

    function collectTranslationUnitsScan() {
        const tus = [];
        translationUnits.clear();
        let tuIdCounter = 0;

        const queue = [];
        if (document.body) queue.push(document.body);

        const visited = new WeakSet();

        while (queue.length > 0) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);

            const blocks = [];
            if (root.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(root.nodeName)) {
                blocks.push(root);
            }

            try {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                    acceptNode: (node) => {
                        if (!node || !(node instanceof Element)) return NodeFilter.FILTER_REJECT;
                        if (node.dataset?.translationStatus === 'translated') return NodeFilter.FILTER_REJECT;
                        if (node.dataset?.translationStatus === 'original') return NodeFilter.FILTER_REJECT;
                        if (node.dataset?.translationStatus === 'failed') return NodeFilter.FILTER_REJECT;
                        if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
                        if (isFullyExcluded(node)) return NodeFilter.FILTER_REJECT;
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
        }

        return tus;
    }

    function buildTU(block) {
        const placeholders = [];
        const textRuns = [];
        let template = '';
        let hasTranslatableText = false;
        let anchorDepth = 0;
        let runOpen = false;

        function visit(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!text) return;
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
                template += `<s${idx}></s${idx}>`;
                runOpen = false;
                return;
            }

            if (BLOCK_TAGS.has(node.nodeName) || isShadowHostingCustomElement(node) || isBlockLikeAnchorInShadowHost(node)) {
                const idx = placeholders.length;
                placeholders.push({ type: 'block', ph: `b${idx}`, node });
                template += `<b${idx}></b${idx}>`;
                runOpen = false;
                return;
            }

            if (isFullyExcluded(node)) {
                const idx = placeholders.length;
                placeholders.push({ type: 'skip', ph: `s${idx}`, node });
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
                template += `<a${idx}>`;
                runOpen = false;
                anchorDepth++;
                for (const child of node.childNodes) visit(child);
                anchorDepth--;
                template += `</a${idx}>`;
                runOpen = false;
                return;
            }

            const idx = placeholders.length;
            placeholders.push({ type: 'tag', ph: `t${idx}`, node });
            template += `<t${idx}>`;
            runOpen = false;
            for (const child of node.childNodes) visit(child);
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

    async function processBatch(batch, runGeneration) {
        if (translationCancelled) return [];
        const batchId = `${streamingBatchSeed}_${++streamingBatchCounter}`;
        const keyToTuId = new Map();
        batch.forEach((item, index) => keyToTuId.set(`TU_${index}`, item.id));
        streamingBatchRegistry.set(batchId, { keyToTuId, generation: runGeneration });
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "translateBatch", batch, batchId }, response => {
                streamingBatchRegistry.delete(batchId);
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
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
        return true;
    }

    function applyTranslation(tu, translatedTemplate, fromCacheRestore) {
        if (!tu || !tu.block || !tu.block.isConnected) return;
        if (shouldUseTextOnlyApply(tu.block)) {
            applyTranslationInPlace(tu, translatedTemplate, fromCacheRestore);
            return;
        }
        try {
            try { tu.block.dataset.tuTranslatedTemplate = translatedTemplate; } catch (e) { }
            try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }

            if (!('originalHtml' in tu.block.dataset)) {
                tu.block.dataset.originalHtml = tu.originalInnerHTML;
            }

            if (!applyTemplateWithPlaceholders(tu, translatedTemplate)) return;

            tu.block.dataset.translatedHtml = tu.block.innerHTML;
            tu.block.dataset.translationStatus = 'translated';
            if (highlightTranslated) {
                tu.block.classList.add('translated-text');
            } else {
                tu.block.classList.remove('translated-text');
            }
            countTranslatedUnitOnce(tu, fromCacheRestore);
        } catch (e) {
            if (tu.block && tu.block.dataset) {
                delete tu.block.dataset.translationStatus;
            }
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
                    if (!text) continue;
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

    function applyTemplateTextOnly(tu, template) {
        const normalized = normalizeTranslatedTemplate(template, tu.placeholders);
        const parsed = parseTemplateFragment(normalized);
        if (!parsed) return false;

        const translatedTexts = [];
        const parsedWalker = document.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
        let t;
        while (t = parsedWalker.nextNode()) {
            if (isTranslatableText(t.nodeValue)) translatedTexts.push(t.nodeValue);
        }

        let runs = tu.textRuns;
        const runsAreLive = Array.isArray(runs) &&
            runs.every(run => run.nodes.every(node => tu.block.contains(node)));
        if (!runsAreLive) runs = collectLiveTextRuns(tu.block);

        const translatableRuns = runs.filter(run => run.translatable);
        if (translatableRuns.length === 0 || translatableRuns.length !== translatedTexts.length) return false;

        translatableRuns.forEach((run, index) => {
            run.nodes.forEach((node, nodeIndex) => {
                node.nodeValue = nodeIndex === 0 ? translatedTexts[index] : '';
            });
        });
        return true;
    }

    function applyTranslationInPlace(tu, translatedTemplate, fromCacheRestore) {
        try {
            try { tu.block.dataset.tuTranslatedTemplate = translatedTemplate; } catch (e) { }
            try { tu.block.dataset.tuTemplate = tu.template; } catch (e) { }
            if (!applyTemplateTextOnly(tu, translatedTemplate)) {
                try { tu.block.dataset.translationStatus = 'failed'; } catch (e) { }
                return false;
            }
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
            try { tu.block.dataset.translationStatus = 'failed'; } catch (_) { }
            return false;
        }
    }

    function normalizeTranslatedTemplate(tpl, placeholders) {
        let s = (tpl || '').trim();
        s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
        s = s.replace(/<([atbs])(\d+)\s*\/>/g, '<$1$2></$1$2>');
        const present = new Set();
        const tagRe = /<\/?([atbs])(\d+)\b[^>]*>/g;
        let m;
        while ((m = tagRe.exec(s)) !== null) present.add(`${m[1]}${m[2]}`);
        for (let i = 0; i < placeholders.length; i++) {
            const ph = placeholders[i];
            if (present.has(ph.ph)) continue;
            if (ph.type === 'block' || ph.type === 'skip') {
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

    function revertBlockToOriginal(block) {
        const textOnly = shouldUseTextOnlyApply(block);
        const originalTemplate = block.dataset.tuTemplate;
        if (typeof originalTemplate === 'string' && originalTemplate) {
            try {
                const tu = buildTU(block);
                if (tu) {
                    if (textOnly) return applyTemplateTextOnly(tu, originalTemplate);
                    if (applyTemplateWithPlaceholders(tu, originalTemplate)) return true;
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

    function toggleAllTranslations() {
        if (isTranslating) return;
        clearTimeout(observerDebounceTimer);
        disconnectAllObservers();
        try {
            const blocks = Array.from(document.querySelectorAll(
                '[data-translation-status="translated"], [data-translation-status="original"]'
            ));
            if (blocks.length === 0) return;
            const shouldRevert = blocks.some(block => block.dataset.translationStatus === 'translated');
            blocks.forEach(block => {
                if (shouldRevert) {
                    if (block.dataset.translationStatus === 'translated' && revertBlockToOriginal(block)) {
                        block.dataset.translationStatus = 'original';
                        block.classList.remove('translated-text');
                    }
                    return;
                }
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
        try {
            chrome.runtime.sendMessage({ action: "cancelTranslation", allFrames: true }, () => {
                if (chrome.runtime.lastError) handleCancellation();
            });
        } catch (err) {
            handleCancellation();
        }
    }

    function createStatusIndicator(lang) {
        removeStatusIndicator();
        statusContainer = document.createElement('div');
        statusContainer.id = 'gemini-translator-status-container';
        statusContainer.dataset.geminiIgnore = 'true';
        statusContainer.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;';
        statusShadowRoot = statusContainer.attachShadow({ mode: 'open' });

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

    function statusPanelTitle(phase) {
        if (phase === 'done') return st.translationCompleted;
        if (phase === 'cancelled') return st.translationCancelled;
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
        } else if (phase === 'done') {
            card.appendChild(createActionsRow([
                createTextButton('btn btn-text', st.showOriginal, toggleAllTranslations)
            ]));
        } else if (phase === 'error') {
            const rawMessage = options.message || st.errorOccurred;
            const cause = localizedErrorCause(options.code);
            card.appendChild(createUiElement('div', 'cause', cause || rawMessage));
            if (cause && rawMessage && rawMessage !== cause) {
                card.appendChild(createTechnicalDetails(rawMessage));
            }
            card.appendChild(createActionsRow(createErrorActionButtons(options.code, rawMessage)));
        }

        const closeStatusBtn = card.querySelector('#closeStatusBtn');
        if (closeStatusBtn) closeStatusBtn.addEventListener('click', removeStatusIndicator);
        const minimizeButton = card.querySelector('#minimizeStatusBtn');
        if (minimizeButton) {
            minimizeButton.addEventListener('click', function (e) {
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
    }

    function removeStatusIndicator() {
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
        if (!minimizedDiv || !minimizedDiv.shadowRoot) return;
        const label = minimizedDiv.shadowRoot.getElementById('minimizedProgressText');
        if (label) label.textContent = percent.toFixed(0) + '%';
        const ring = minimizedDiv.shadowRoot.getElementById('minimizedProgressRing');
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
            const shadowRoot = minimizedDiv.attachShadow({ mode: 'open' });
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
            shadowRoot.appendChild(style);
            shadowRoot.appendChild(root);
            document.body.appendChild(minimizedDiv);
            miniButton.addEventListener('click', function () {
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
        chrome.runtime.sendMessage({
            action: "updateProgress",
            progress: translationProgress,
            stats: {
                batches: batchesProcessed,
                totalBatches,
                translatedFragments: translatedUnitsCount,
                totalFragments: expectedTotalUnits
            }
        }).catch(() => { });
    }

    function finishTranslation() {
        const now = Date.now();
        if (now - lastFinishTime < 1500) return;
        lastFinishTime = now;
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        cacheRestoreMap = null;
        cacheRestoreActive = false;
        updateProgress(100);
        renderStatusPanel('done');
        chrome.runtime.sendMessage({ action: "translationComplete", message: st.translationCompleted }).catch(() => { });
        saveCurrentTranslationToCache().catch(() => { });
        setTimeout(() => { if (!isTranslating) removeStatusIndicator(); }, 3000);
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
        if (ensureStatusPanelForError()) showErrorPopup(errorMessage, errorCode);
        chrome.runtime.sendMessage({ action: "translationError", error: errorMessage, code: errorCode }).catch(() => { });
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
                    if (hasUntranslatedTextInDocument()) {
                        postFinishScanCount++;
                        translationHasError = false;
                        startTranslation();
                    }
                } catch (e) { }
            }, delay);
        }
    }

    function collectPopupPageState() {
        let translatedBlocks = 0;
        let revertedBlocks = 0;
        try {
            translatedBlocks = document.querySelectorAll('[data-translation-status="translated"]').length;
            revertedBlocks = document.querySelectorAll('[data-translation-status="original"]').length;
        } catch (e) { }
        let translationStatus = 'idle';
        if (isTranslating || isApplyingUpdates) translationStatus = 'translating';
        else if (translationHasError) translationStatus = 'error';
        else if (translatedBlocks > 0 || revertedBlocks > 0) translationStatus = 'translated';
        return {
            translationStatus,
            showingOriginal: translatedBlocks === 0 && revertedBlocks > 0,
            progress: translationProgress,
            stats: {
                batches: batchesProcessed,
                totalBatches,
                translatedFragments: translatedUnitsCount,
                totalFragments: expectedTotalUnits
            }
        };
    }

    function respondPopupPageState(sendResponse) {
        const pageState = collectPopupPageState();
        try {
            chrome.storage.local.get(['excludeList'], function (items) {
                const list = Array.isArray(items.excludeList) ? items.excludeList : [];
                const currentUrl = window.location.href;
                let siteOrigin = '';
                try { siteOrigin = new URL(currentUrl).origin; } catch (e) { }
                pageState.excluded = list.some(prefix => currentUrl.startsWith(prefix) || siteOrigin === prefix);
                sendResponse(pageState);
            });
            return true;
        } catch (e) {
            pageState.excluded = false;
            sendResponse(pageState);
            return false;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initTranslation);
    } else {
        setTimeout(initTranslation, 100);
    }

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
                        sendResponse({ status: "cancelling" });
                        return false;
                    case "startTranslationFromPopup":
                        if (isTranslating) {
                            sendResponse({ status: "alreadyTranslating" });
                            return false;
                        }
                        removePrompt();
                        translationStarted = true;
                        rememberTranslatedDomain();
                        startTranslation(true);
                        sendResponse({ status: "starting" });
                        return false;
                    case "toggleTranslation":
                        if (isTranslating) {
                            sendResponse({ status: "Translating" });
                        } else {
                            toggleAllTranslations();
                            sendResponse({ status: "toggled" });
                        }
                        return false;
                    case "translationCancelled":
                        if (!translationCancelled && !translationHasError) handleCancellation();
                        sendResponse({ status: "cancelled_ack" });
                        return false;
                    case "streamingTranslationUpdate":
                        handleStreamingUpdate(request.batchId, request.translations);
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
