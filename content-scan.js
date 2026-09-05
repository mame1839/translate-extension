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

function findAncestor(node, matches, crossShadow) {
    for (let current = node; current; current = current.parentElement || (crossShadow && current.getRootNode?.() instanceof ShadowRoot ? current.getRootNode().host : null)) {
        if (matches(current)) return current;
    }
    return null;
}

function isInsideExtensionUi(node) {
    return !!findAncestor(node, el => el.dataset?.geminiIgnore === 'true', true);
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

function countFailedBlocksByReason() {
    const counts = { timedOut: 0, other: 0 };
    forEachMarkedElement('[data-translation-status="failed"]', el => {
        const reason = el.dataset?.translationFailReason;
        if (reason === 'oversized') return;
        if (reason === 'timeout') counts.timedOut++;
        else counts.other++;
    });
    return counts;
}

function countVisibleFailedBlocks() {
    const counts = countFailedBlocksByReason();
    return counts.timedOut + counts.other;
}

function findBlockAncestor(node) {
    return findAncestor(node, el => BLOCK_TAGS.has(el.nodeName), true);
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

function isEditableHost(el) {
    if (el.isContentEditable === true) return true;
    const editableAttr = el.getAttribute('contenteditable');
    if (typeof editableAttr === 'string' && editableAttr.toLowerCase() !== 'false') return true;
    return el.getAttribute('role') === 'textbox';
}

function isInsideEditableHost(node) {
    const start = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!start || start.nodeType !== Node.ELEMENT_NODE) return false;
    return !!findAncestor(start, isEditableHost, true);
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
    return !!findAncestor(node?.parentElement, isShadowHostingCustomElement, false);
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

function markBatchUnitsTimedOut(batch) {
    if (!Array.isArray(batch)) return;
    for (const item of batch) {
        const block = translationUnits.get(item.id)?.block;
        if (!block || !block.isConnected) continue;
        if (block.dataset?.translationStatus === 'translated') continue;
        try {
            block.dataset.translationStatus = 'failed';
            block.dataset.translationFailReason = 'timeout';
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
