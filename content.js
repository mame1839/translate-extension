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
        openOptions: 'Open settings'
    };

    function applyStrings(lang) {
        const t = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[lang]) ? TRANSLATIONS[lang] : TRANSLATIONS['en'];
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
            openOptions: t.openOptions
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
        'DIALOG', 'OUTPUT',
        'BODY'
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

    const PROMPT_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .prompt {
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            z-index: 2147483647 !important;
            width: 280px;
            padding: 18px;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: saturate(180%) blur(18px);
            -webkit-backdrop-filter: saturate(180%) blur(18px);
            border: 1px solid rgba(15, 23, 42, 0.08);
            border-radius: 14px;
            box-shadow: 0 20px 40px -16px rgba(15, 23, 42, 0.24), 0 6px 14px -4px rgba(15, 23, 42, 0.1);
            color: #0f172a;
            font-family: ${SHARED_FONT};
            font-size: 13px;
            line-height: 1.5;
            font-feature-settings: "kern" 1, "liga" 1, "palt" 1;
            -webkit-font-smoothing: antialiased;
            animation: promptIn 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes promptIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .prompt-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
        }
        .prompt-icon {
            width: 30px;
            height: 30px;
            border-radius: 9px;
            background: linear-gradient(135deg, #6366f1 0%, #a855f7 60%, #ec4899 100%);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            box-shadow: 0 4px 12px -2px rgba(99, 102, 241, 0.45);
        }
        .prompt-text {
            font-weight: 600;
            color: #0f172a;
            letter-spacing: -0.005em;
        }
        .prompt-buttons {
            display: flex;
            gap: 8px;
        }
        .btn {
            flex: 1;
            padding: 9px 14px;
            font-size: 13px;
            font-weight: 600;
            font-family: inherit;
            border: 1px solid transparent;
            border-radius: 8px;
            cursor: pointer;
            transition: background-color 150ms, color 150ms, border-color 150ms, transform 100ms, box-shadow 150ms;
            letter-spacing: -0.005em;
        }
        .btn.primary {
            background: #6366f1;
            color: #ffffff;
            box-shadow: 0 1px 2px rgba(79, 70, 229, 0.2), 0 4px 10px -2px rgba(79, 70, 229, 0.3);
        }
        .btn.primary:hover { background: #4f46e5; transform: translateY(-1px); }
        .btn.primary:active { transform: translateY(0); background: #4338ca; }
        .btn.ghost {
            background: transparent;
            color: #475569;
            border-color: rgba(15, 23, 42, 0.14);
        }
        .btn.ghost:hover {
            background: rgba(15, 23, 42, 0.05);
            color: #0f172a;
        }
        .btn.subtle {
            display: block;
            width: 100%;
            margin-top: 10px;
            padding: 7px 10px;
            font-size: 12px;
            font-weight: 500;
            color: #94a3b8;
            background: transparent;
            border: none;
            cursor: pointer;
            border-radius: 6px;
            transition: color 150ms, background-color 150ms;
            font-family: inherit;
        }
        .btn.subtle:hover { color: #64748b; background: rgba(15, 23, 42, 0.04); }
        @media (prefers-color-scheme: dark) {
            .prompt {
                background: rgba(20, 26, 40, 0.95);
                border-color: rgba(255, 255, 255, 0.1);
                color: #f1f5f9;
            }
            .prompt-text { color: #f1f5f9; }
            .btn.ghost {
                color: #cbd5e1;
                border-color: rgba(255, 255, 255, 0.14);
            }
            .btn.ghost:hover { background: rgba(255, 255, 255, 0.06); color: #f1f5f9; }
            .btn.subtle { color: #64748b; }
            .btn.subtle:hover { color: #94a3b8; background: rgba(255, 255, 255, 0.05); }
        }
    `;

    const PANEL_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
            position: fixed !important;
            bottom: 16px !important;
            right: 16px !important;
            z-index: 2147483647 !important;
            width: 288px;
            padding: 16px;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: saturate(180%) blur(18px);
            -webkit-backdrop-filter: saturate(180%) blur(18px);
            border: 1px solid rgba(15, 23, 42, 0.08);
            border-radius: 14px;
            box-shadow: 0 20px 40px -16px rgba(15, 23, 42, 0.24), 0 6px 14px -4px rgba(15, 23, 42, 0.1);
            color: #0f172a;
            font-family: ${SHARED_FONT};
            font-size: 13px;
            line-height: 1.5;
            font-feature-settings: "kern" 1, "liga" 1, "palt" 1;
            -webkit-font-smoothing: antialiased;
            animation: panelIn 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes panelIn {
            from { opacity: 0; transform: translateY(8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .title {
            display: flex;
            align-items: center;
            gap: 9px;
            font-weight: 600;
            font-size: 13px;
            letter-spacing: -0.005em;
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #6366f1;
            box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.22);
            animation: pulse 1.5s ease-in-out infinite;
            flex-shrink: 0;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.22); }
            50% { opacity: 0.7; transform: scale(1.2); box-shadow: 0 0 0 7px rgba(99, 102, 241, 0); }
        }
        .dot.done {
            background: #10b981;
            box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.22);
            animation: none;
        }
        .dot.error {
            background: #ef4444;
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.22);
            animation: none;
        }
        .icon-btn {
            width: 26px;
            height: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            border-radius: 6px;
            padding: 0;
            transition: background-color 150ms, color 150ms;
        }
        .icon-btn:hover {
            background: rgba(15, 23, 42, 0.06);
            color: #0f172a;
        }
        .progress-bar {
            width: 100%;
            height: 6px;
            background: rgba(15, 23, 42, 0.06);
            border-radius: 999px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #6366f1, #8b5cf6);
            border-radius: 999px;
            transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        .progress-fill::after {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
            animation: shimmer 1.6s infinite;
        }
        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        .progress-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-top: 8px;
        }
        .progress-text {
            font-size: 13px;
            font-weight: 600;
            color: #0f172a;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.005em;
        }
        .stats {
            font-size: 11px;
            color: #94a3b8;
            font-variant-numeric: tabular-nums;
            text-align: right;
        }
        .action-btn {
            width: 100%;
            margin-top: 14px;
            padding: 9px 14px;
            font-size: 13px;
            font-weight: 600;
            font-family: inherit;
            border: 1px solid transparent;
            border-radius: 8px;
            cursor: pointer;
            transition: background-color 150ms, color 150ms, border-color 150ms;
            letter-spacing: -0.005em;
        }
        .action-btn.danger {
            background: rgba(239, 68, 68, 0.12);
            color: #dc2626;
        }
        .action-btn.danger:hover { background: rgba(239, 68, 68, 0.2); }
        .action-btn.primary {
            background: #6366f1;
            color: #ffffff;
            box-shadow: 0 1px 2px rgba(79, 70, 229, 0.2);
        }
        .action-btn.primary:hover { background: #4f46e5; }
        .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .error-box {
            background: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.22);
            border-radius: 8px;
            padding: 10px 12px;
            margin-top: 10px;
            font-size: 12px;
            color: #b91c1c;
            line-height: 1.5;
            word-break: break-word;
            max-height: 180px;
            overflow-y: auto;
            white-space: pre-wrap;
        }
        .error-link {
            display: inline-block;
            margin-top: 8px;
            font-size: 12px;
            font-weight: 500;
            color: #6366f1;
            text-decoration: none;
        }
        .error-link:hover { text-decoration: underline; }
        @media (prefers-color-scheme: dark) {
            .panel {
                background: rgba(20, 26, 40, 0.95);
                border-color: rgba(255, 255, 255, 0.1);
                color: #f1f5f9;
            }
            .title, .progress-text { color: #f1f5f9; }
            .icon-btn { color: #94a3b8; }
            .icon-btn:hover { background: rgba(255, 255, 255, 0.06); color: #f1f5f9; }
            .progress-bar { background: rgba(255, 255, 255, 0.08); }
            .stats { color: #64748b; }
            .error-box {
                background: rgba(248, 113, 113, 0.14);
                border-color: rgba(248, 113, 113, 0.3);
                color: #fca5a5;
            }
            .error-link { color: #a5b4fc; }
            .action-btn.danger { background: rgba(248, 113, 113, 0.2); color: #fca5a5; }
            .action-btn.danger:hover { background: rgba(248, 113, 113, 0.3); }
        }
    `;

    const MINI_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .minimized {
            position: fixed !important;
            bottom: 16px !important;
            right: 16px !important;
            z-index: 2147483647 !important;
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: saturate(180%) blur(16px);
            -webkit-backdrop-filter: saturate(180%) blur(16px);
            border: 1px solid rgba(15, 23, 42, 0.08);
            box-shadow: 0 12px 28px -10px rgba(15, 23, 42, 0.24), 0 4px 10px -3px rgba(15, 23, 42, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: #6366f1;
            font-family: ${SHARED_FONT};
            font-size: 12px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.01em;
            -webkit-font-smoothing: antialiased;
            transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 150ms;
            animation: miniIn 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes miniIn {
            from { opacity: 0; transform: scale(0.6); }
            to { opacity: 1; transform: scale(1); }
        }
        .minimized:hover {
            transform: scale(1.08);
            box-shadow: 0 16px 32px -8px rgba(15, 23, 42, 0.28), 0 6px 12px -3px rgba(15, 23, 42, 0.14);
        }
        @media (prefers-color-scheme: dark) {
            .minimized {
                background: rgba(20, 26, 40, 0.95);
                border-color: rgba(255, 255, 255, 0.1);
                color: #a5b4fc;
            }
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
    const observedRoots = new WeakSet();
    let observerDebounceTimer = null;
    let progressInterval = null;
    let statusContainer = null;
    let statusShadowRoot = null;
    let promptContainer = null;
    let promptShadowRoot = null;
    let minimizedDiv = null;
    let domUpdateQueue = [];
    let isApplyingUpdates = false;

    const observerConfig = { childList: true, subtree: true, characterData: true };

    function initTranslation() {
        try {
            chrome.storage.local.get(['targetLanguage', 'realTimeTranslation', 'excludeList', 'hidePromptAllSites'], function (items) {
                try { watchForNewContent(); } catch (e) { }

                const pageLang = getPageLanguage();
                const chosenLang = items.targetLanguage || 'en';
                applyStrings(chosenLang);
                const pageLangPrimary = pageLang ? pageLang.split('-')[0].toLowerCase() : null;
                const chosenLangPrimary = chosenLang.split('-')[0].toLowerCase();

                const translationStarter = () => {
                    if (isTranslating) return;
                    if (!translationStarted) return;
                    startTranslation();
                };

                if (items.realTimeTranslation === true) {
                    const currentUrl = window.location.href;
                    const excludeList = items.excludeList || [];
                    let siteOrigin = '';
                    try { siteOrigin = new URL(currentUrl).origin; } catch (e) { }
                    if (excludeList.some(prefix => currentUrl.startsWith(prefix) || siteOrigin === prefix)) return;
                    translationStarted = true;
                    setTimeout(translationStarter, 100);
                    setTimeout(translationStarter, 1500);
                } else {
                    if (!IS_TOP_FRAME) return;
                    if (!pageLangPrimary || pageLangPrimary !== chosenLangPrimary) {
                        if (items.hidePromptAllSites !== true) {
                            createTranslationPrompt();
                        }
                    }
                }
            });
        } catch (error) { }
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

    function createTranslationPrompt() {
        if (promptContainer || document.getElementById('gemini-translator-prompt-container')) return;
        promptContainer = document.createElement('div');
        promptContainer.id = 'gemini-translator-prompt-container';
        promptContainer.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;';
        promptShadowRoot = promptContainer.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = PROMPT_CSS;
        promptShadowRoot.appendChild(style);

        const promptDiv = document.createElement('div');
        promptDiv.className = 'prompt';

        const header = document.createElement('div');
        header.className = 'prompt-header';
        const iconWrap = document.createElement('div');
        iconWrap.className = 'prompt-icon';
        iconWrap.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"></path><path d="m4 14 6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="m22 22-5-10-5 10"></path><path d="M14 18h6"></path></svg>';
        const textDiv = document.createElement('div');
        textDiv.className = 'prompt-text';
        textDiv.textContent = promptMessage;
        header.appendChild(iconWrap);
        header.appendChild(textDiv);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'prompt-buttons';
        const yesButton = document.createElement('button');
        yesButton.className = 'btn primary';
        yesButton.type = 'button';
        yesButton.textContent = translateButtonText.yes;
        const noButton = document.createElement('button');
        noButton.className = 'btn ghost';
        noButton.type = 'button';
        noButton.textContent = translateButtonText.no;
        buttonsDiv.appendChild(yesButton);
        buttonsDiv.appendChild(noButton);

        const neverButton = document.createElement('button');
        neverButton.className = 'btn subtle';
        neverButton.type = 'button';
        neverButton.textContent = translateButtonText.never;

        promptDiv.appendChild(header);
        promptDiv.appendChild(buttonsDiv);
        promptDiv.appendChild(neverButton);
        promptShadowRoot.appendChild(promptDiv);
        document.body.appendChild(promptContainer);

        yesButton.addEventListener('click', function () {
            removePrompt();
            translationStarted = true;
            startTranslation();
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
        let hasRelevantChange = false;
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                const parent = mutation.target.parentElement;
                if (parent && !isFullyExcluded(parent) && isTranslatableText(mutation.target.textContent)) {
                    const block = findBlockAncestor(parent);
                    if (block && block.dataset?.translationStatus !== 'translated' && block.dataset?.translationStatus !== 'processing' && block.dataset?.translationStatus !== 'original') {
                        hasRelevantChange = true;
                    }
                }
                continue;
            }
            if (mutation.type !== 'childList') continue;
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    attachObserversTo(node);
                }
                if (containsTranslatableContent(node)) {
                    hasRelevantChange = true;
                }
            }
        }
        if (hasRelevantChange && translationStarted && !isTranslating && !translationCancelled) {
            clearTimeout(observerDebounceTimer);
            observerDebounceTimer = setTimeout(() => {
                if (translationStarted && !isTranslating && !translationCancelled) {
                    startTranslation();
                }
            }, 600);
        }
    };

    function containsTranslatableContent(node) {
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
        if (observedRoots.has(root)) return;
        try {
            const observer = new MutationObserver(mutationCallback);
            observer.observe(root, observerConfig);
            activeObservers.push(observer);
            observedRoots.add(root);
        } catch (e) { return; }
        if (root.nodeType === Node.ELEMENT_NODE) {
            if (root.shadowRoot) attachObserversTo(root.shadowRoot);
            const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const el of elements) {
                if (el.shadowRoot && !observedRoots.has(el.shadowRoot)) {
                    attachObserversTo(el.shadowRoot);
                }
            }
        } else if (root instanceof ShadowRoot) {
            const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const el of elements) {
                if (el.shadowRoot && !observedRoots.has(el.shadowRoot)) {
                    attachObserversTo(el.shadowRoot);
                }
            }
        }
    }

    function watchForNewContent() {
        disconnectAllObservers();
        if (document.body) {
            attachObserversTo(document.body);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body) attachObserversTo(document.body);
            });
        }
    }

    function disconnectAllObservers() {
        activeObservers.forEach(obs => {
            try { obs.disconnect(); } catch (e) { }
        });
        activeObservers = [];
    }

    async function startTranslation() {
        if (isTranslating) return;
        isTranslating = true;
        translationCancelled = false;
        translationHasError = false;
        translatedUnitsCount = 0;
        totalBatches = 0;
        batchesProcessed = 0;
        expectedTotalUnits = 0;
        translationProgress = 0;
        domUpdateQueue = [];
        isApplyingUpdates = false;
        let lang = 'en';
        try {
            const config = await new Promise(resolve => {
                chrome.storage.local.get(['targetLanguage', 'showProgressPopup', 'batchSize', 'maxToken'], resolve);
            });
            lang = config.targetLanguage || 'en';
            applyStrings(lang);

            const tus = collectTranslationUnits();
            if (tus.length === 0) {
                isTranslating = false;
                chrome.runtime.sendMessage({ action: "translationComplete", message: st.noTextFound }).catch(() => { });
                return;
            }
            expectedTotalUnits = tus.length;

            const maxBatchLength = Math.min(Math.floor((config.maxToken || DEFAULTS.maxToken) * 3), DEFAULTS.maxBatchLength);
            const batches = createBatches(tus, config.batchSize || DEFAULTS.batchSize, maxBatchLength);
            totalBatches = batches.length;

            for (const tu of tus) {
                if (tu.block && tu.block.isConnected) {
                    tu.block.dataset.translationStatus = 'processing';
                }
            }

            if (config.showProgressPopup !== false && IS_TOP_FRAME) {
                createOrShowProgressPopup(lang);
                if (progressInterval) clearInterval(progressInterval);
                progressInterval = setInterval(() => updateProgress(), 300);
            }
            updateProgress();

            const batchPromises = batches.map(batch =>
                processBatch(batch)
                    .then(translations => {
                        if (translationCancelled || translationHasError) return;
                        batchesProcessed++;
                        domUpdateQueue.push(translations);
                        if (!isApplyingUpdates) {
                            applyQueuedUpdates();
                        }
                    })
                    .catch(error => {
                        const msg = error?.message || '';
                        if (msg.includes(st.translationCancelled)) return;
                        if (!translationCancelled && !translationHasError) {
                            translationHasError = true;
                            try {
                                chrome.runtime.sendMessage({ action: "cancelTranslation" })
                                    ?.catch?.(() => { });
                            } catch (e) { }
                            throw error;
                        }
                    })
            );

            try {
                await Promise.all(batchPromises);
            } catch (error) {
                handleTranslationError(error, lang);
                isTranslating = false;
                if (progressInterval) clearInterval(progressInterval);
                return;
            }

            await new Promise(resolve => {
                const interval = setInterval(() => {
                    if (!isApplyingUpdates && domUpdateQueue.length === 0) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 50);
            });

            if (translationCancelled) {
                handleCancellation(lang);
            } else if (!translationHasError) {
                finishTranslation();
            }
        } catch (error) {
            if (!translationCancelled) handleTranslationError(error, lang);
        } finally {
            isTranslating = false;
            if (progressInterval) clearInterval(progressInterval);
        }
    }

    async function applyQueuedUpdates() {
        if (isApplyingUpdates) return;
        isApplyingUpdates = true;
        disconnectAllObservers();
        try {
            while (domUpdateQueue.length > 0) {
                if (translationCancelled) { domUpdateQueue = []; break; }
                const translatedBatch = domUpdateQueue.shift();
                if (Array.isArray(translatedBatch)) {
                    for (const translated of translatedBatch) {
                        const tu = translationUnits.get(translated.id);
                        if (tu && tu.block && tu.block.isConnected) {
                            applyTranslation(tu, translated.translatedTemplate);
                        }
                    }
                }
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        } finally {
            watchForNewContent();
            isApplyingUpdates = false;
        }
    }

    function handleTranslationError(error, lang) {
        const cancelledMsg = st.translationCancelled;
        if (!translationHasError && (error?.message?.includes(cancelledMsg) || error?.name === 'AbortError' || translationCancelled)) {
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
        updateProgress();
        if (statusShadowRoot) showErrorPopup(errorMessage, lang);
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        cleanupProcessingMarkers();
        chrome.runtime.sendMessage({ action: "translationError", error: errorMessage }).catch(() => { });
    }

    function cleanupProcessingMarkers() {
        for (const tu of translationUnits.values()) {
            if (tu.block && tu.block.isConnected && tu.block.dataset?.translationStatus === 'processing') {
                delete tu.block.dataset.translationStatus;
            }
        }
    }

    function showErrorPopup(errorMessage, lang) {
        if (!statusShadowRoot) return;
        const panel = statusShadowRoot.querySelector('.panel');
        if (!panel) return;
        while (panel.firstChild) panel.removeChild(panel.firstChild);

        const header = document.createElement('div');
        header.className = 'panel-header';
        const title = document.createElement('div');
        title.className = 'title';
        const dot = document.createElement('span');
        dot.className = 'dot error';
        const headerText = document.createElement('span');
        headerText.textContent = st.errorOccurred;
        title.appendChild(dot);
        title.appendChild(headerText);
        header.appendChild(title);
        panel.appendChild(header);

        const errorBox = document.createElement('div');
        errorBox.className = 'error-box';
        errorBox.id = 'errorText';
        errorBox.textContent = errorMessage;
        panel.appendChild(errorBox);

        if (errorMessage.includes('options page') || errorMessage.includes('オプションページ')) {
            const optionsLink = document.createElement('a');
            optionsLink.className = 'error-link';
            optionsLink.href = chrome.runtime.getURL('options.html');
            optionsLink.target = '_blank';
            optionsLink.rel = 'noopener noreferrer';
            optionsLink.textContent = st.openOptions;
            panel.appendChild(optionsLink);
        }

        const closeButton = document.createElement('button');
        closeButton.className = 'action-btn primary';
        closeButton.type = 'button';
        closeButton.textContent = st.closeButton;
        closeButton.addEventListener('click', removeStatusIndicator);
        panel.appendChild(closeButton);
    }

    function handleCancellation(lang) {
        translationCancelled = true;
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        updateProgress();
        if (statusShadowRoot) {
            const panel = statusShadowRoot.querySelector('.panel');
            const headerElem = statusShadowRoot.querySelector('#translationHeaderText');
            const progressBar = statusShadowRoot.querySelector('.progress-bar');
            const progressRow = statusShadowRoot.querySelector('.progress-row');
            const cancelButton = statusShadowRoot.querySelector('#cancelTranslationBtn');
            const minimizeButton = statusShadowRoot.querySelector('#minimizeStatusBtn');
            const dot = statusShadowRoot.querySelector('#translationDot');
            if (headerElem) headerElem.textContent = st.translationCancelled;
            if (dot) { dot.classList.remove('done'); dot.classList.add('error'); }
            if (progressBar) progressBar.style.display = 'none';
            if (progressRow) progressRow.style.display = 'none';
            if (cancelButton) cancelButton.remove();
            if (minimizeButton) minimizeButton.style.display = 'none';
            let closeButton = panel?.querySelector('.action-btn.primary');
            if (panel && !closeButton) {
                closeButton = document.createElement('button');
                closeButton.className = 'action-btn primary';
                closeButton.type = 'button';
                closeButton.textContent = st.closeButton;
                closeButton.addEventListener('click', removeStatusIndicator);
                panel.appendChild(closeButton);
            } else if (closeButton) {
                closeButton.style.display = 'block';
            }
        }
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
        return document.body;
    }

    function isFullyExcluded(element) {
        if (!element || !(element instanceof Element) || !element.isConnected) return true;
        if (INLINE_SKIP_TAGS.has(element.nodeName)) return true;
        if (!BLOCK_TAGS.has(element.nodeName)) {
            if (element.getAttribute('translate') === 'no') return true;
            if (element.classList && element.classList.contains('notranslate')) return true;
        }
        if (element.dataset?.geminiIgnore === 'true') return true;
        if (element.dataset?.translationWrapper === 'true') return true;
        try {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') return true;
        } catch (e) { }
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
            .replace(/>/g, '&gt;');
    }

    function collectTranslationUnits() {
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
                        if (node.dataset?.translationWrapper === 'true') return NodeFilter.FILTER_REJECT;
                        if (isFullyExcluded(node)) return NodeFilter.FILTER_REJECT;
                        if (node.shadowRoot) queue.push(node.shadowRoot);
                        if (BLOCK_TAGS.has(node.nodeName)) return NodeFilter.FILTER_ACCEPT;
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
                const tu = buildTU(block);
                if (tu && tu.hasTranslatableText) {
                    tu.id = `tu_${tuIdCounter++}`;
                    tus.push(tu);
                    translationUnits.set(tu.id, tu);
                }
            }
        }

        return tus;
    }

    function buildTU(block) {
        const placeholders = [];
        let template = '';
        let hasTranslatableText = false;

        function appendText(text) {
            if (!text) return;
            template += escapeHtml(text);
        }

        function visit(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (isTranslatableText(text)) hasTranslatableText = true;
                appendText(text);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            if (node === block) {
                for (const child of node.childNodes) visit(child);
                return;
            }

            if (node.dataset?.translationStatus === 'translated') {
                appendText(node.textContent || '');
                return;
            }

            if (BLOCK_TAGS.has(node.nodeName)) {
                const idx = placeholders.length;
                placeholders.push({ type: 'block', ph: `b${idx}`, node });
                template += `<b${idx}></b${idx}>`;
                return;
            }

            if (isFullyExcluded(node)) {
                const idx = placeholders.length;
                placeholders.push({ type: 'skip', ph: `s${idx}`, node });
                template += `<s${idx}></s${idx}>`;
                return;
            }

            if (node.nodeName === 'A') {
                const idx = placeholders.length;
                const originalText = (node.textContent || '').trim();
                placeholders.push({ type: 'anchor', ph: `a${idx}`, node, originalText });
                template += `<a${idx}>`;
                for (const child of node.childNodes) visit(child);
                template += `</a${idx}>`;
                return;
            }

            const idx = placeholders.length;
            placeholders.push({ type: 'tag', ph: `t${idx}`, node });
            template += `<t${idx}>`;
            for (const child of node.childNodes) visit(child);
            template += `</t${idx}>`;
        }

        for (const child of block.childNodes) visit(child);

        const normalizedTemplate = template.replace(/[\t\n\r\f]+/g, ' ').replace(/ +/g, ' ').trim();
        if (!normalizedTemplate) return null;

        return {
            block,
            template: normalizedTemplate,
            placeholders,
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

    async function processBatch(batch) {
        if (translationCancelled) return [];
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "translateBatch", batch }, response => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (!response) return reject(new Error('No response from background'));
                if (response.success) return resolve(response.translations || []);
                reject(new Error(response.error || 'Translation failed'));
            });
        });
    }

    function applyTranslation(tu, translatedTemplate) {
        if (!tu || !tu.block || !tu.block.isConnected) return;
        try {
            const normalized = normalizeTranslatedTemplate(translatedTemplate, tu.placeholders);
            const parsed = parseTemplateFragment(normalized);
            if (!parsed) return;

            const newChildren = [];
            for (const child of parsed.childNodes) {
                const restored = restoreNode(child, tu.placeholders);
                if (restored) newChildren.push(restored);
            }

            const originalNodeSet = new Set();
            for (const ph of tu.placeholders) {
                if (ph.node) originalNodeSet.add(ph.node);
            }

            if (!('originalHtml' in tu.block.dataset)) {
                tu.block.dataset.originalHtml = tu.originalInnerHTML;
            }

            while (tu.block.firstChild) tu.block.removeChild(tu.block.firstChild);
            for (const child of newChildren) tu.block.appendChild(child);

            tu.block.dataset.translatedHtml = tu.block.innerHTML;
            tu.block.dataset.translationStatus = 'translated';
            let ancestor = tu.block.parentElement;
            while (ancestor && ancestor !== document.documentElement) {
                if ('translatedHtml' in ancestor.dataset) {
                    ancestor.dataset.translatedHtml = ancestor.innerHTML;
                }
                ancestor = ancestor.parentElement;
            }
            try {
                chrome.storage.local.get(['toggleBlueBackground'], (items) => {
                    if (items.toggleBlueBackground) {
                        tu.block.classList.add('translated-text');
                    } else {
                        tu.block.classList.remove('translated-text');
                    }
                });
            } catch (e) { }
            translatedUnitsCount++;
        } catch (e) {
            if (tu.block && tu.block.dataset) {
                delete tu.block.dataset.translationStatus;
            }
        }
    }

    function normalizeTranslatedTemplate(tpl, placeholders) {
        let s = (tpl || '').trim();
        s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
        s = s.replace(/<([atbs])(\d+)\s*\/>/g, '<$1$2></$1$2>');
        const present = new Set();
        const tagRe = /<\/?([atbs])(\d+)\b[^>]*>/g;
        let m;
        while ((m = tagRe.exec(s)) !== null) present.add(`${m[1]}${m[2]}`);
        for (let i = 0; i < placeholders.length; i++) {
            const ph = placeholders[i];
            if (!present.has(ph.ph)) {
                if (ph.type === 'anchor' && ph.originalText) {
                    s += `<${ph.ph}>${escapeHtml(ph.originalText)}</${ph.ph}>`;
                } else {
                    s += `<${ph.ph}></${ph.ph}>`;
                }
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
            if (!entry) return null;
            if (entry.type === 'tag' || entry.type === 'anchor') {
                const originalNode = entry.node;
                if (!originalNode) return null;
                while (originalNode.firstChild) originalNode.removeChild(originalNode.firstChild);
                for (const child of parsedNode.childNodes) {
                    const restored = restoreNode(child, placeholders);
                    if (restored) originalNode.appendChild(restored);
                }
                return originalNode;
            }
            if (entry.type === 'block' || entry.type === 'skip') {
                return entry.node || null;
            }
            return null;
        }

        try {
            const clone = document.createElement(parsedNode.nodeName);
            if (parsedNode.attributes) {
                for (const attr of parsedNode.attributes) {
                    try { clone.setAttribute(attr.name, attr.value); } catch (e) { }
                }
            }
            for (const child of parsedNode.childNodes) {
                const restored = restoreNode(child, placeholders);
                if (restored) clone.appendChild(restored);
            }
            return clone;
        } catch (e) {
            return document.createTextNode(parsedNode.textContent || '');
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
                if (shouldRevert && 'originalHtml' in block.dataset) {
                    block.innerHTML = block.dataset.originalHtml;
                    block.dataset.translationStatus = 'original';
                    block.classList.remove('translated-text');
                } else if (!shouldRevert && 'translatedHtml' in block.dataset) {
                    block.innerHTML = block.dataset.translatedHtml;
                    block.dataset.translationStatus = 'translated';
                    try {
                        chrome.storage.local.get(['toggleBlueBackground'], (items) => {
                            if (items.toggleBlueBackground) block.classList.add('translated-text');
                            else block.classList.remove('translated-text');
                        });
                    } catch (e) {}
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
            createStatusIndicator();
        } else {
            statusContainer.style.display = 'block';
            if (minimizedDiv) minimizedDiv.remove();
            const cancelButton = statusShadowRoot?.querySelector('#cancelTranslationBtn');
            const progressBar = statusShadowRoot?.querySelector('.progress-bar');
            const progressRow = statusShadowRoot?.querySelector('.progress-row');
            const headerElem = statusShadowRoot?.querySelector('#translationHeaderText');
            const dot = statusShadowRoot?.querySelector('#translationDot');
            const closeButton = statusShadowRoot?.querySelector('.action-btn.primary');
            const minimizeButton = statusShadowRoot?.querySelector('#minimizeStatusBtn');
            if (headerElem) headerElem.textContent = st.translating;
            if (dot) { dot.classList.remove('done', 'error'); }
            if (progressBar) progressBar.style.display = 'block';
            if (progressRow) progressRow.style.display = 'flex';
            if (closeButton) closeButton.remove();
            if (minimizeButton) minimizeButton.style.display = 'flex';
            if (cancelButton) {
                cancelButton.disabled = false;
                cancelButton.textContent = st.cancelButton;
                cancelButton.style.display = 'block';
                const newCancelButton = cancelButton.cloneNode(true);
                cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);
                newCancelButton.addEventListener('click', () => handleCancelButtonClick(lang));
            } else {
                const panel = statusShadowRoot?.querySelector('.panel');
                if (panel) {
                    const newCancelButton = document.createElement('button');
                    newCancelButton.id = 'cancelTranslationBtn';
                    newCancelButton.className = 'action-btn danger';
                    newCancelButton.type = 'button';
                    newCancelButton.textContent = st.cancelButton;
                    newCancelButton.addEventListener('click', () => handleCancelButtonClick(lang));
                    panel.appendChild(newCancelButton);
                }
            }
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
            chrome.runtime.sendMessage({ action: "cancelTranslation" }, () => {
                if (chrome.runtime.lastError) handleCancellation();
            });
        } catch (err) {
            handleCancellation();
        }
    }

    function createStatusIndicator() {
        removeStatusIndicator();
        statusContainer = document.createElement('div');
        statusContainer.id = 'gemini-translator-status-container';
        statusContainer.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;';
        statusShadowRoot = statusContainer.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        statusShadowRoot.appendChild(style);

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.id = 'translationStatus';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.id = 'translationStatusHeader';

        const title = document.createElement('div');
        title.className = 'title';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.id = 'translationDot';
        const headerText = document.createElement('span');
        headerText.id = 'translationHeaderText';
        headerText.textContent = st.translating;
        title.appendChild(dot);
        title.appendChild(headerText);

        const minimizeBtn = document.createElement('button');
        minimizeBtn.className = 'icon-btn';
        minimizeBtn.id = 'minimizeStatusBtn';
        minimizeBtn.type = 'button';
        minimizeBtn.title = 'Minimize';
        minimizeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

        header.appendChild(title);
        header.appendChild(minimizeBtn);

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        progressFill.id = 'translationProgressFill';
        progressBar.appendChild(progressFill);

        const progressRow = document.createElement('div');
        progressRow.className = 'progress-row';
        const progressText = document.createElement('div');
        progressText.className = 'progress-text';
        progressText.id = 'translationProgressText';
        progressText.textContent = '0%';
        const stats = document.createElement('div');
        stats.className = 'stats';
        stats.id = 'translationStats';
        stats.textContent = '';
        progressRow.appendChild(progressText);
        progressRow.appendChild(stats);

        const cancelButton = document.createElement('button');
        cancelButton.className = 'action-btn danger';
        cancelButton.id = 'cancelTranslationBtn';
        cancelButton.type = 'button';
        cancelButton.textContent = st.cancelButton;
        cancelButton.addEventListener('click', () => handleCancelButtonClick());

        panel.appendChild(header);
        panel.appendChild(progressBar);
        panel.appendChild(progressRow);
        panel.appendChild(cancelButton);
        statusShadowRoot.appendChild(panel);
        document.body.appendChild(statusContainer);

        minimizeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            minimizeStatusIndicator();
        });
    }

    function removeStatusIndicator() {
        if (statusContainer && statusContainer.parentNode) {
            statusContainer.parentNode.removeChild(statusContainer);
            statusContainer = null;
            statusShadowRoot = null;
        }
        if (minimizedDiv && minimizedDiv.parentNode) {
            minimizedDiv.parentNode.removeChild(minimizedDiv);
            minimizedDiv = null;
        }
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    function minimizeStatusIndicator() {
        if (!statusContainer) return;
        statusContainer.style.display = 'none';
        if (!minimizedDiv) {
            minimizedDiv = document.createElement('div');
            minimizedDiv.id = 'gemini-translator-minimized-container';
            minimizedDiv.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;';
            const shadowRoot = minimizedDiv.attachShadow({ mode: 'open' });
            const style = document.createElement('style');
            style.textContent = MINI_CSS;
            const circleDiv = document.createElement('div');
            circleDiv.className = 'minimized';
            circleDiv.id = 'minimizedProgressText';
            circleDiv.title = 'Click to restore';
            circleDiv.setAttribute('role', 'button');
            circleDiv.setAttribute('tabindex', '0');
            shadowRoot.appendChild(style);
            shadowRoot.appendChild(circleDiv);
            document.body.appendChild(minimizedDiv);
            circleDiv.addEventListener('click', function () {
                if (statusContainer) statusContainer.style.display = 'block';
                if (minimizedDiv && minimizedDiv.parentNode) {
                    minimizedDiv.parentNode.removeChild(minimizedDiv);
                }
                minimizedDiv = null;
            });
        }
        const minimizedTextElem = minimizedDiv?.shadowRoot?.getElementById('minimizedProgressText');
        if (minimizedTextElem) {
            let progText = "0%";
            if (statusShadowRoot) {
                const txt = statusShadowRoot.querySelector('#translationProgressText');
                if (txt) progText = txt.textContent;
            }
            minimizedTextElem.textContent = progText;
        }
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
            const progressFill = statusShadowRoot.querySelector('#translationProgressFill');
            const progressText = statusShadowRoot.querySelector('#translationProgressText');
            const statsElem = statusShadowRoot.querySelector('#translationStats');
            if (progressFill && progressText) {
                progressFill.style.width = translationProgress + '%';
                progressText.textContent = translationProgress.toFixed(1) + '%';
            }
            if (statsElem) {
                statsElem.textContent = st.progressTemplate
                    .replace('{currentBatch}', batchesProcessed)
                    .replace('{totalBatch}', totalBatches)
                    .replace('{translatedUnits}', translatedUnitsCount)
                    .replace('{totalUnits}', expectedTotalUnits);
            }
        }
        if (minimizedDiv && minimizedDiv.shadowRoot) {
            const circleDiv = minimizedDiv.shadowRoot.querySelector('#minimizedProgressText');
            if (circleDiv) circleDiv.textContent = translationProgress.toFixed(0) + '%';
        }
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
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        updateProgress(100);
        if (statusShadowRoot) {
            const headerElem = statusShadowRoot.querySelector('#translationHeaderText');
            const dot = statusShadowRoot.querySelector('#translationDot');
            const cancelButton = statusShadowRoot.querySelector('#cancelTranslationBtn');
            const panel = statusShadowRoot.querySelector('.panel');
            const minimizeButton = statusShadowRoot.querySelector('#minimizeStatusBtn');
            if (headerElem) headerElem.textContent = st.translationCompleted;
            if (dot) { dot.classList.remove('error'); dot.classList.add('done'); }
            if (cancelButton) cancelButton.remove();
            if (minimizeButton) minimizeButton.style.display = 'none';
            let closeButton = panel?.querySelector('.action-btn.primary');
            if (panel && !closeButton) {
                closeButton = document.createElement('button');
                closeButton.className = 'action-btn primary';
                closeButton.type = 'button';
                closeButton.textContent = st.closeButton;
                closeButton.addEventListener('click', removeStatusIndicator);
                panel.appendChild(closeButton);
            } else if (closeButton) {
                closeButton.style.display = 'block';
            }
        }
        chrome.runtime.sendMessage({ action: "translationComplete", message: st.translationCompleted }).catch(() => { });
        setTimeout(() => { if (!isTranslating) removeStatusIndicator(); }, 3000);
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
                    case "startTranslationFromPopup":
                        removePrompt();
                        if (!isTranslating) {
                            translationStarted = true;
                            startTranslation();
                            sendResponse({ status: "starting" });
                        } else {
                            sendResponse({ status: "alreadyTranslating" });
                        }
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
                    default:
                        return false;
                }
            } catch (e) {
                return false;
            }
        });
    } catch (error) { }
})();
