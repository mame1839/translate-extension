const SHARED_FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;

const UI_TOKEN_VARS = `
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
            --ease: cubic-bezier(0.2, 0, 0, 1);`;

const UI_TOKEN_VARS_DARK = `
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
                --elev-3: 0 8px 24px -6px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);`;

const UI_TOKENS_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .root {${UI_TOKEN_VARS}
            font-family: ${SHARED_FONT};
            font-size: 13.5px;
            line-height: 1.5;
            color: var(--text);
            font-feature-settings: "kern" 1, "liga" 1, "palt" 1;
            -webkit-font-smoothing: antialiased;
        }
        @media (prefers-color-scheme: dark) {
            .root {${UI_TOKEN_VARS_DARK}
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

function createNoticeCard(id, title) {
    const container = document.createElement('div');
    container.id = id;
    container.dataset.geminiIgnore = 'true';
    container.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;';
    const shadow = attachUiShadowRoot(container);

    const style = document.createElement('style');
    style.textContent = PROMPT_CSS;
    shadow.appendChild(style);

    const root = createUiRoot();
    const card = createUiElement('div', 'card top');

    const head = createUiElement('div', 'head');
    const brand = createUiElement('div', 'app-icon');
    brand.appendChild(createSvgIcon('15', '2.25', ICON_LOGO));
    const headText = createUiElement('div', 'head-text');
    headText.appendChild(createUiElement('div', 'title', title));
    const pairLabel = promptLanguagePairLabel();
    if (pairLabel) headText.appendChild(createUiElement('div', 'sub', pairLabel));
    const dismissButton = createIconButton(ICON_CLOSE, st.closeButton);
    head.appendChild(brand);
    head.appendChild(headText);
    head.appendChild(dismissButton);
    card.appendChild(head);
    return { container, shadow, root, card, dismissButton };
}

function createTranslationPrompt(showWarning) {
    if (promptContainer || document.getElementById('gemini-translator-prompt-container')) return;
    const { container, shadow, root, card, dismissButton } = createNoticeCard('gemini-translator-prompt-container', promptMessage);
    promptContainer = container;
    promptShadowRoot = shadow;

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
    continueNoticeCooldownUntil = Date.now() + CONTINUE_NOTICE_COOLDOWN_MS;
    showCacheRestoreNotice(st.newContentTitle, false);
}

function showCacheRestoreNotice(titleText, offerRetranslate) {
    if (!IS_TOP_FRAME) return;
    if (restoreNoticeContainer) return;
    if (!document.body) return;
    const { container, shadow, root, card, dismissButton } = createNoticeCard('gemini-translator-restore-container', titleText || st.cacheRestoredTitle);
    restoreNoticeContainer = container;

    const actions = [];
    const continueButton = createTextButton('btn btn-text', st.translateRestButton, translateRemainingFromNotice);
    actions.push(continueButton);
    if (offerRetranslate !== false) {
        const retranslateButton = createTextButton('btn btn-text', st.retranslateButton, function () {
            autoRetranslateRounds = 0;
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
    contentRefused: 'errContentRefused',
    reasoningNotSupported: 'errReasoningNotSupported',
    reasoningTimeout: 'errReasoningTimeout',
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
    reasoningNotSupported: 'settings',
    reasoningTimeout: 'settings',
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
    contentRefused: 'close',
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
        const failed = countFailedBlocksByReason();
        if (failed.other > 0 && st.someBlocksFailed) {
            headText.appendChild(createUiElement('div', 'sub', st.someBlocksFailed.replace('{count}', failed.other)));
        }
        if (failed.timedOut > 0 && st.blocksTimedOut) {
            headText.appendChild(createUiElement('div', 'sub', st.blocksTimedOut.replace('{count}', failed.timedOut)));
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

function isWaitingForModel() {
    return isTranslating && !translationCancelled && !translationHasError
        && modelWaitStartedAt > 0 && !modelResponded && typeof st.waitingForModel === 'string';
}

function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(totalSeconds / 60) + ':' + String(totalSeconds % 60).padStart(2, '0');
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
            statsElem.textContent = isWaitingForModel()
                ? st.waitingForModel.replace('{elapsed}', formatElapsed(Date.now() - modelWaitStartedAt))
                : st.progressTemplate
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
