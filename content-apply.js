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

    tu.block.replaceChildren(...newChildren);
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
    entry.node.replaceChildren(...wanted);
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
    return !!findAncestor(node?.parentElement, el => el.nodeName === 'REACT-APP' || el.nodeName === 'REACT-PARTIAL', false);
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
    block.replaceChildren(...newChildren);
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
            originalNode.replaceChildren(...newChildren);
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
