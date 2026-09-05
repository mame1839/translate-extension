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
