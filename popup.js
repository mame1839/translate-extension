const RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);

const STATE_ICONS = {
    idle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',
    translating: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.56"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></path></svg>',
    translated: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    excluded: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>',
    unavailable: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};

const SEGMENT_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const STATE_LABEL_KEYS = {
    idle: 'popupStateIdle',
    translating: 'translating',
    translated: 'popupStateTranslated',
    excluded: 'popupStateExcluded',
    error: 'popupStateError',
    unavailable: 'popupStateUnavailable'
};

let t = null;
let els = {};
let activeTab = null;
let pageSupported = false;
let busy = false;
let lastSignature = '';
let lastView = '';

document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup() {
    const items = await chrome.storage.local.get(['targetLanguage']);
    const lang = items.targetLanguage || 'en';
    t = getT(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.has(lang.split('-')[0]) ? 'rtl' : 'ltr';

    els = {
        appTitle: document.getElementById('appTitle'),
        settingsBtn: document.getElementById('settingsBtn'),
        card: document.getElementById('statusCard'),
        ico: document.getElementById('statusIco'),
        label: document.getElementById('statusLabel'),
        host: document.getElementById('statusHost'),
        progressWrap: document.getElementById('progressWrap'),
        linearFill: document.getElementById('linearFill'),
        progressPct: document.getElementById('progressPct'),
        progressBlocks: document.getElementById('progressBlocks'),
        errorNote: document.getElementById('errorNote'),
        actionArea: document.getElementById('actionArea'),
        alwaysRow: document.getElementById('alwaysRow'),
        alwaysRowLabel: document.getElementById('alwaysRowLabel'),
        alwaysSwitch: document.getElementById('alwaysSwitch'),
        excludeRow: document.getElementById('excludeRow'),
        excludeRowLabel: document.getElementById('excludeRowLabel'),
        excludeSwitch: document.getElementById('excludeSwitch'),
        langChip: document.getElementById('langChip'),
        langChipLabel: document.getElementById('langChipLabel'),
        versionLabel: document.getElementById('versionLabel')
    };

    document.title = t.popupName;
    els.appTitle.textContent = t.popupName;
    els.settingsBtn.title = t.optionsBtn;
    els.settingsBtn.setAttribute('aria-label', t.optionsBtn);
    els.alwaysRowLabel.textContent = t.alwaysTranslateBtn;
    els.excludeRowLabel.textContent = t.excludeBtn;
    const langMeta = LANGUAGES.find(entry => entry.code === lang);
    els.langChipLabel.textContent = langMeta ? langMeta.native : lang;
    try { els.versionLabel.textContent = 'v' + chrome.runtime.getManifest().version; } catch (e) { }

    els.settingsBtn.addEventListener('click', openOptions);
    els.langChip.addEventListener('click', openOptions);
    els.alwaysSwitch.addEventListener('change', onAlwaysSwitchChange);
    els.excludeSwitch.addEventListener('change', onExcludeSwitchChange);

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tab || null;
    } catch (e) {
        activeTab = null;
    }
    pageSupported = isSupportedUrl(activeTab?.url);
    els.host.textContent = hostLabelFor(activeTab?.url);

    await refreshPageState(true);
    setInterval(() => { refreshPageState(false); }, 700);
}

function openOptions() {
    chrome.runtime.openOptionsPage();
}

function isSupportedUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function hostLabelFor(url) {
    if (!url) return '';
    try { return new URL(url).hostname || url; } catch (e) { return url; }
}

async function queryPageState() {
    if (!pageSupported || !activeTab) {
        return { translationStatus: 'unavailable', excluded: false, alwaysTranslate: false, progress: 0 };
    }
    try {
        const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'getPageState' }, { frameId: 0 });
        if (response && response.translationStatus) return response;
    } catch (e) { }
    return { translationStatus: 'unavailable', excluded: false, progress: 0 };
}

function resolveViewState(pageState) {
    if (pageState.translationStatus === 'unavailable') return 'unavailable';
    if (pageState.translationStatus === 'translating') return 'translating';
    if (pageState.translationStatus === 'error') return 'error';
    if (pageState.translationStatus === 'translated') return 'translated';
    if (pageState.excluded) return 'excluded';
    return 'idle';
}

async function refreshPageState(force) {
    const pageState = await queryPageState();
    const view = resolveViewState(pageState);
    const stats = pageState.stats || {};
    const signature = [
        view,
        pageState.excluded ? 1 : 0,
        pageState.alwaysTranslate ? 1 : 0,
        pageState.showingOriginal ? 1 : 0,
        Math.round(pageState.progress || 0),
        stats.translatedFragments || 0,
        stats.totalFragments || 0
    ].join('|');
    lastView = view;
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    render(view, pageState);
}

function render(view, pageState) {
    els.card.className = 'status-card status-' + view;
    els.ico.innerHTML = STATE_ICONS[view] || STATE_ICONS.idle;
    els.label.textContent = t[STATE_LABEL_KEYS[view]] || '';

    const translatingNow = view === 'translating';
    els.progressWrap.hidden = !translatingNow;
    if (translatingNow) {
        const pct = Math.max(0, Math.min(100, Math.round(pageState.progress || 0)));
        els.linearFill.style.width = pct + '%';
        els.progressPct.textContent = pct + '%';
        const stats = pageState.stats || {};
        els.progressBlocks.textContent = stats.totalFragments > 0
            ? t.popupBlocksTemplate
                .replace('{translated}', String(stats.translatedFragments ?? 0))
                .replace('{total}', String(stats.totalFragments))
            : '';
    }

    els.errorNote.hidden = true;

    const siteRowsDisabled = view === 'unavailable';
    els.alwaysSwitch.checked = !!pageState.alwaysTranslate;
    els.alwaysSwitch.disabled = siteRowsDisabled;
    els.alwaysRow.classList.toggle('disabled', siteRowsDisabled);
    els.excludeSwitch.checked = !!pageState.excluded;
    els.excludeSwitch.disabled = siteRowsDisabled;
    els.excludeRow.classList.toggle('disabled', siteRowsDisabled);

    renderActions(view, pageState);
}

function actionButton(className, label, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
}

function renderActions(view, pageState) {
    const area = els.actionArea;
    area.replaceChildren();
    if (view === 'idle') {
        area.appendChild(actionButton('btn btn-filled', t.popupTranslatePage, startTranslation));
    } else if (view === 'translating') {
        area.appendChild(actionButton('btn btn-danger-tonal', t.cancelBtn, cancelTranslation));
    } else if (view === 'translated') {
        area.appendChild(buildSegmented(pageState));
        const row = document.createElement('div');
        row.className = 'action-row';
        row.appendChild(actionButton('btn btn-text', t.popupRetranslate, retranslateFromScratch));
        area.appendChild(row);
    } else if (view === 'excluded') {
        area.appendChild(actionButton('btn btn-outlined', t.popupTranslateAnyway, startTranslation));
    } else if (view === 'error') {
        area.appendChild(actionButton('btn btn-filled', t.popupRetry, startTranslation));
        const row = document.createElement('div');
        row.className = 'action-row';
        row.appendChild(actionButton('btn btn-text', t.openOptions, openOptions));
        area.appendChild(row);
    }
}

function buildSegmented(pageState) {
    const seg = document.createElement('div');
    seg.className = 'segmented';
    const showingOriginal = !!pageState.showingOriginal;
    seg.appendChild(segmentButton(t.popupShowOriginal, showingOriginal, 'original'));
    seg.appendChild(segmentButton(t.popupShowTranslation, !showingOriginal, 'translation'));
    return seg;
}

function segmentButton(label, active, view) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(active));
    if (active) btn.innerHTML = SEGMENT_CHECK;
    btn.appendChild(document.createTextNode(label));
    btn.addEventListener('click', () => toggleTranslationView(view));
    return btn;
}

function setActionsDisabled(disabled) {
    els.actionArea.querySelectorAll('button').forEach(btn => { btn.disabled = disabled; });
}

async function startTranslation() {
    if (busy || !activeTab || !pageSupported) return;
    busy = true;
    setActionsDisabled(true);
    try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'startTranslationFromPopup' });
    } catch (e) { }
    busy = false;
    refreshPageState(true);
}

async function retranslateFromScratch() {
    if (busy || !activeTab || !pageSupported) return;
    busy = true;
    setActionsDisabled(true);
    try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'clearPageCacheAndRetranslate' });
    } catch (e) { }
    busy = false;
    refreshPageState(true);
}

async function cancelTranslation() {
    if (!activeTab) return;
    setActionsDisabled(true);
    try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'cancelTranslationFromPopup' }, { frameId: 0 });
    } catch (e) { }
    refreshPageState(true);
}

async function toggleTranslationView(view) {
    if (busy || !activeTab) return;
    busy = true;
    setActionsDisabled(true);
    try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'toggleTranslation', view });
    } catch (e) { }
    busy = false;
    refreshPageState(true);
}

function normalizeSiteList(value) {
    if (Array.isArray(value)) return value.map(entry => String(entry).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean);
    return [];
}

async function applySiteListChange(listKey, opposingKey, enabled) {
    if (!activeTab || !pageSupported) return false;
    let origin = '';
    try { origin = new URL(activeTab.url).origin; } catch (e) { return false; }
    const tabUrl = activeTab.url || '';
    const matches = entry => siteEntryMatchesUrl(entry, tabUrl);
    const items = await chrome.storage.local.get([listKey, opposingKey]);
    let list = normalizeSiteList(items[listKey]);
    let opposing = normalizeSiteList(items[opposingKey]);
    if (enabled) {
        if (!list.some(matches)) list.push(origin);
        opposing = opposing.filter(entry => !matches(entry));
    } else {
        list = list.filter(entry => !matches(entry));
    }
    await chrome.storage.local.set({ [listKey]: list, [opposingKey]: opposing });
    return true;
}

async function onExcludeSwitchChange() {
    await applySiteListChange('excludeList', 'alwaysTranslateList', els.excludeSwitch.checked);
    refreshPageState(true);
}

async function onAlwaysSwitchChange() {
    const enabled = els.alwaysSwitch.checked;
    const shouldStartNow = enabled && lastView === 'idle';
    const applied = await applySiteListChange('alwaysTranslateList', 'excludeList', enabled);
    if (applied && shouldStartNow) {
        await startTranslation();
        return;
    }
    refreshPageState(true);
}
