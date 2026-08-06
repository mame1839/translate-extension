const DEFAULTS = Object.freeze({
    apiProvider: 'gemini',
    geminiModel: 'gemini-3.1-flash-lite',
    openaiModel: 'gpt-5.4-nano-2026-03-17',
    anthropicModel: 'claude-haiku-4-5-20251001',
    compatibleModel: '',
    batchSize: 500,
    maxBatchLength: 65535,
    delayBetweenRequests: 10000,
    maxToken: 65536,
    concurrencyLimit: 10,
    maxRetries: 3,
    timeout: 180
});

const MODEL_PLACEHOLDERS = {
    gemini: 'gemini-3.1-flash-lite',
    openai: 'gpt-5.4-nano-2026-03-17',
    anthropic: 'claude-haiku-4-5-20251001',
    'openai-compatible': ''
};

const BUILTIN_PROVIDER = 'chrome-builtin';

const BUILTIN_PREPARE_FAILURE_KEYS = {
    unsupportedBrowser: 'builtinUnsupportedBrowser',
    engineUnavailable: 'builtinEngineUnavailable',
    unsupportedLanguage: 'builtinUnsupportedLanguage',
    prepareFailed: 'builtinPrepareFailed'
};

const providerSettings = {
    'chrome-builtin': { apiKey: '', model: '' },
    gemini: { apiKey: '', model: DEFAULTS.geminiModel },
    openai: { apiKey: '', model: DEFAULTS.openaiModel },
    anthropic: { apiKey: '', model: DEFAULTS.anthropicModel },
    'openai-compatible': { apiKey: '', model: DEFAULTS.compatibleModel, endpoint: '' }
};

const RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);
const STYLE_PRESETS = ['', 'formal', 'casual', 'technical'];
const SECTION_IDS = ['general', 'provider', 'behavior', 'style', 'sites', 'advanced', 'data'];

const USAGE_PROVIDER_LABELS = {
    gemini: 'Google (Gemini)',
    openai: 'OpenAI (ChatGPT)',
    anthropic: 'Anthropic (Claude)',
    'openai-compatible': 'OpenAI Compatible'
};

const USAGE_PROVIDER_ORDER = ['gemini', 'openai', 'anthropic', 'openai-compatible'];

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

const NUMBER_FIELDS = {
    maxToken: { min: 1, max: 1000000, fallback: DEFAULTS.maxToken },
    delayBetweenRequests: { min: 0, max: 3600, fallback: Math.round(DEFAULTS.delayBetweenRequests / 1000) },
    concurrencyLimit: { min: 1, max: 50, fallback: DEFAULTS.concurrencyLimit },
    maxRetries: { min: 0, max: 10, fallback: DEFAULTS.maxRetries },
    timeout: { min: 1, max: 600, fallback: DEFAULTS.timeout }
};

let currentProvider = DEFAULTS.apiProvider;
let excludeEntries = [];
let alwaysEntries = [];
let saveTimer = null;
let snackTimer = null;
let builtinStatusToken = 0;
let builtinPreparing = false;
let usageStats = null;
let cacheStats = null;

function el(id) {
    return document.getElementById(id);
}

function getUiLang() {
    return el('targetLanguage').value || 'en';
}

function currentT() {
    return getT(getUiLang());
}

function applyI18n(t) {
    document.title = t.pageTitle;
    document.querySelectorAll('[data-i18n]').forEach(node => {
        const key = node.dataset.i18n;
        if (t[key] !== undefined) node.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(node => {
        const key = node.dataset.i18nTitle;
        if (t[key] !== undefined) {
            node.title = t[key];
            node.setAttribute('aria-label', t[key]);
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
        const key = node.dataset.i18nPlaceholder;
        if (t[key] !== undefined) node.placeholder = t[key];
    });
    renderSiteLists();
    renderUsageStats();
    renderCacheStats();
}

function applyDir(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.has(lang.split('-')[0]) ? 'rtl' : 'ltr';
}

function populateLanguageSelect(selected) {
    const sel = el('targetLanguage');
    sel.replaceChildren();
    LANGUAGES.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = `${lang.native}  —  ${lang.name}`;
        if (lang.code === selected) opt.selected = true;
        sel.appendChild(opt);
    });
}

function updateProviderUI(provider) {
    const settings = providerSettings[provider] || providerSettings.gemini;
    const isBuiltin = provider === BUILTIN_PROVIDER;
    el('apiKey').value = settings.apiKey;
    el('aiModel').value = settings.model;
    el('aiModel').placeholder = MODEL_PLACEHOLDERS[provider] || '';
    el('apiKeyGroup').hidden = isBuiltin;
    el('modelGroup').hidden = isBuiltin;
    el('builtinGroup').hidden = !isBuiltin;
    const endpointGroup = el('endpointGroup');
    if (provider === 'openai-compatible') {
        el('endpointUrl').value = settings.endpoint || '';
        endpointGroup.style.display = '';
    } else {
        endpointGroup.style.display = 'none';
    }
    if (isBuiltin) refreshBuiltinStatus();
}

function languageNativeName(code) {
    const entry = LANGUAGES.find(lang => lang.code === code);
    return entry ? entry.native : code;
}

function setBuiltinStatus(text, tone) {
    const status = el('builtinStatus');
    status.textContent = text;
    status.classList.toggle('is-ready', tone === 'ready');
    status.classList.toggle('is-error', tone === 'error');
}

function setBuiltinProgress(percent) {
    const wrap = el('builtinProgress');
    if (percent === null) {
        wrap.hidden = true;
        return;
    }
    wrap.hidden = false;
    el('builtinProgressBar').style.inlineSize = `${clampInt(percent, 0, 100, 0)}%`;
}

function builtinMessage(key) {
    const text = currentT()[key] || '';
    return text.replace('{language}', languageNativeName(getUiLang()));
}

async function refreshBuiltinStatus() {
    if (builtinPreparing) return;
    const token = ++builtinStatusToken;
    setBuiltinProgress(null);
    setBuiltinStatus(builtinMessage('builtinChecking'), '');
    el('builtinPrepareBtn').hidden = true;
    let status = null;
    try {
        status = await chrome.runtime.sendMessage({ action: 'builtinTranslatorStatus', targetLanguage: getUiLang() });
    } catch (e) { }
    if (token !== builtinStatusToken) return;
    if (!status || !status.supported) {
        setBuiltinStatus(builtinMessage('builtinUnsupportedBrowser'), 'error');
        return;
    }
    if (status.availability === 'available') {
        setBuiltinStatus(builtinMessage('builtinReady'), 'ready');
        return;
    }
    if (status.availability === 'downloadable' || status.availability === 'downloading') {
        setBuiltinStatus(builtinMessage('builtinNeedsDownload'), '');
        el('builtinPrepareBtn').hidden = false;
        return;
    }
    setBuiltinStatus(builtinMessage(status.engineReachable ? 'builtinUnsupportedLanguage' : 'builtinEngineUnavailable'), 'error');
}

async function prepareBuiltinEngine() {
    if (builtinPreparing) return;
    builtinPreparing = true;
    builtinStatusToken++;
    el('builtinPrepareBtn').disabled = true;
    setBuiltinStatus(currentT().builtinPreparing.replace('{percent}', '0'), '');
    setBuiltinProgress(0);
    let result = null;
    try {
        result = await chrome.runtime.sendMessage({ action: 'builtinTranslatorPrepare', targetLanguage: getUiLang() });
    } catch (e) { }
    builtinPreparing = false;
    el('builtinPrepareBtn').disabled = false;
    setBuiltinProgress(null);
    if (result && result.ok) {
        setBuiltinStatus(builtinMessage('builtinReady'), 'ready');
        el('builtinPrepareBtn').hidden = true;
        return;
    }
    const failureKey = BUILTIN_PREPARE_FAILURE_KEYS[result?.reason] || 'builtinPrepareFailed';
    setBuiltinStatus(builtinMessage(failureKey), 'error');
    el('builtinPrepareBtn').hidden = failureKey !== 'builtinPrepareFailed';
}

function handleBuiltinProgressMessage(message) {
    if (!message || message.action !== 'builtinTranslatorProgress' || !builtinPreparing) return;
    const percent = clampInt(message.percent, 0, 100, 0);
    setBuiltinProgress(percent);
    setBuiltinStatus(currentT().builtinPreparing.replace('{percent}', String(percent)), '');
}

function saveCurrentProviderToMemory() {
    const settings = providerSettings[currentProvider];
    if (!settings) return;
    settings.apiKey = el('apiKey').value;
    settings.model = el('aiModel').value;
    if (currentProvider === 'openai-compatible') {
        settings.endpoint = el('endpointUrl').value;
    }
}

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function readNumberField(id) {
    const spec = NUMBER_FIELDS[id];
    return clampInt(el(id).value, spec.min, spec.max, spec.fallback);
}

function normalizeNumberField(id) {
    el(id).value = readNumberField(id);
}

function normalizeSiteList(value) {
    if (Array.isArray(value)) return value.map(entry => String(entry).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean);
    return [];
}

function normalizeSiteEntry(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
}

function renderSiteRows(containerId, entries) {
    const container = el(containerId);
    if (!container) return;
    const t = currentT();
    container.replaceChildren();
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.textContent = t.optEmptyList;
        container.appendChild(empty);
        return;
    }
    entries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'chip-row';
        const host = document.createElement('span');
        host.className = 'host';
        host.textContent = entry;
        host.title = entry;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn';
        removeBtn.title = t.optRemove;
        removeBtn.setAttribute('aria-label', t.optRemove);
        removeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        removeBtn.addEventListener('click', () => {
            entries.splice(index, 1);
            renderSiteRows(containerId, entries);
            scheduleSave();
        });
        row.appendChild(host);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
}

function renderSiteLists() {
    renderSiteRows('alwaysRows', alwaysEntries);
    renderSiteRows('excludeRows', excludeEntries);
}

function addSiteEntry(inputId, entries, opposingEntries) {
    const input = el(inputId);
    const entry = normalizeSiteEntry(input.value);
    if (!entry) return;
    if (!entries.includes(entry)) {
        entries.push(entry);
        const opposingIndex = opposingEntries.indexOf(entry);
        if (opposingIndex !== -1) opposingEntries.splice(opposingIndex, 1);
        renderSiteLists();
        scheduleSave();
    }
    input.value = '';
    input.focus();
}

function isValidEndpoint(raw) {
    try {
        const parsed = new URL(raw);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (e) {
        return false;
    }
}

function showSnackbar(message, isError) {
    const snackbar = el('snackbar');
    el('snackbarText').textContent = message;
    snackbar.classList.toggle('error', !!isError);
    snackbar.classList.add('show');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => snackbar.classList.remove('show'), 2400);
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveCurrentProviderToMemory();
    const t = currentT();

    const compatibleEndpointRaw = providerSettings['openai-compatible'].endpoint.trim();
    if (currentProvider === 'openai-compatible' && compatibleEndpointRaw && !isValidEndpoint(compatibleEndpointRaw)) {
        showSnackbar(t.optInvalidEndpoint, true);
        return;
    }

    const saveData = {
        targetLanguage: getUiLang(),
        apiProvider: currentProvider,
        geminiApiKey: providerSettings.gemini.apiKey,
        geminiModel: providerSettings.gemini.model.trim() || DEFAULTS.geminiModel,
        openaiApiKey: providerSettings.openai.apiKey,
        openaiModel: providerSettings.openai.model.trim() || DEFAULTS.openaiModel,
        anthropicApiKey: providerSettings.anthropic.apiKey,
        anthropicModel: providerSettings.anthropic.model.trim() || DEFAULTS.anthropicModel,
        compatibleApiKey: providerSettings['openai-compatible'].apiKey,
        compatibleModel: providerSettings['openai-compatible'].model.trim(),
        compatibleEndpoint: compatibleEndpointRaw,
        delayBetweenRequests: readNumberField('delayBetweenRequests') * 1000,
        maxToken: readNumberField('maxToken'),
        concurrencyLimit: readNumberField('concurrencyLimit'),
        maxRetries: readNumberField('maxRetries'),
        timeout: readNumberField('timeout'),
        toggleBlueBackground: el('toggleBlueBackground').checked,
        realTimeTranslation: el('realTimeTranslation').checked,
        showProgressPopup: el('showProgressPopup').checked,
        hidePromptAllSites: el('hidePromptAllSites').checked,
        showContextMenu: el('showContextMenu').checked,
        autoRetranslateDomain: el('autoRetranslateDomain').checked,
        streamingTranslation: el('streamingTranslation').checked,
        translationStyle: el('translationStyle').value,
        customInstruction: el('customInstruction').value.trim(),
        glossaryText: el('glossaryText').value,
        excludeList: excludeEntries.slice(),
        alwaysTranslateList: alwaysEntries.slice()
    };

    try {
        await chrome.storage.local.set(saveData);
        showSnackbar(t.saved, false);
    } catch (e) {
        showSnackbar(t.saveError, true);
    }
}

function formatNumber(value, lang) {
    const safe = Number.isFinite(value) ? value : 0;
    try {
        return safe.toLocaleString(lang);
    } catch (e) {
        return String(safe);
    }
}

function formatBytes(bytes, lang) {
    let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${formatNumber(rounded, lang)} ${BYTE_UNITS[unit]}`;
}

function formatDate(timestamp, lang) {
    try {
        return new Date(timestamp).toLocaleDateString(lang);
    } catch (e) {
        return new Date(timestamp).toISOString().slice(0, 10);
    }
}

function buildStatTile(label, value) {
    const tile = document.createElement('div');
    tile.className = 'stat';
    const labelNode = document.createElement('div');
    labelNode.className = 'stat-label';
    labelNode.textContent = label;
    const valueNode = document.createElement('div');
    valueNode.className = 'stat-value';
    valueNode.textContent = value;
    tile.appendChild(labelNode);
    tile.appendChild(valueNode);
    return tile;
}

function buildUsageRow(provider, entry, t, lang) {
    const row = document.createElement('div');
    row.className = 'row stack';
    const main = document.createElement('div');
    main.className = 'row-main';
    const name = document.createElement('div');
    name.className = 'provider-name';
    name.textContent = USAGE_PROVIDER_LABELS[provider] || provider;
    main.appendChild(name);
    const tiles = document.createElement('div');
    tiles.className = 'row-control stat-row';
    tiles.appendChild(buildStatTile(t.usageInputTokens, formatNumber(entry.inputTokens, lang)));
    tiles.appendChild(buildStatTile(t.usageOutputTokens, formatNumber(entry.outputTokens, lang)));
    tiles.appendChild(buildStatTile(t.usageRequests, formatNumber(entry.requests, lang)));
    row.appendChild(main);
    row.appendChild(tiles);
    return row;
}

function buildUsageEmptyRow(t) {
    const row = document.createElement('div');
    row.className = 'row';
    const main = document.createElement('div');
    main.className = 'row-main';
    const desc = document.createElement('div');
    desc.className = 'row-desc';
    desc.textContent = t.usageEmpty;
    main.appendChild(desc);
    row.appendChild(main);
    return row;
}

function usedProviderNames(providers) {
    const used = Object.keys(providers).filter(name => {
        const entry = providers[name];
        return !!entry && (entry.requests > 0 || entry.inputTokens > 0 || entry.outputTokens > 0);
    });
    used.sort((a, b) => {
        const rankA = USAGE_PROVIDER_ORDER.indexOf(a);
        const rankB = USAGE_PROVIDER_ORDER.indexOf(b);
        if (rankA === rankB) return a.localeCompare(b);
        if (rankA < 0) return 1;
        if (rankB < 0) return -1;
        return rankA - rankB;
    });
    return used;
}

function renderUsageStats() {
    const container = el('usageBody');
    const since = el('usageSince');
    if (!container || !since) return;
    const t = currentT();
    const lang = getUiLang();
    const providers = (usageStats && usageStats.providers) || {};
    const names = usedProviderNames(providers);
    container.replaceChildren();
    if (names.length === 0) {
        container.appendChild(buildUsageEmptyRow(t));
        since.textContent = '';
        return;
    }
    names.forEach(name => container.appendChild(buildUsageRow(name, providers[name], t, lang)));
    since.textContent = usageStats.since
        ? t.usageSince.replace('{date}', formatDate(usageStats.since, lang))
        : '';
}

function renderCacheStats() {
    const entriesNode = el('cacheEntries');
    const sizeNode = el('cacheSize');
    if (!entriesNode || !sizeNode) return;
    const lang = getUiLang();
    entriesNode.textContent = cacheStats ? formatNumber(cacheStats.entries, lang) : '—';
    sizeNode.textContent = cacheStats ? formatBytes(cacheStats.bytes, lang) : '—';
}

async function refreshUsageStats() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'usageStatsGet' });
        usageStats = (response && response.stats) || null;
    } catch (e) {
        usageStats = null;
    }
    renderUsageStats();
}

async function refreshCacheStats() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'pageCacheStats' });
        cacheStats = (response && response.stats) || null;
    } catch (e) {
        cacheStats = null;
    }
    renderCacheStats();
}

function refreshDataSection() {
    refreshUsageStats();
    refreshCacheStats();
}

async function resetUsageCounters() {
    const t = currentT();
    if (!confirm(t.usageResetConfirm)) return;
    try {
        const response = await chrome.runtime.sendMessage({ action: 'usageStatsReset' });
        if (!response || response.ok !== true) throw new Error('usage reset rejected');
        usageStats = response.stats || null;
        renderUsageStats();
        showSnackbar(t.usageResetDone, false);
    } catch (e) {
        showSnackbar(t.dataActionFailed, true);
    }
}

async function clearPageCache() {
    const t = currentT();
    if (!confirm(t.dataClearConfirm)) return;
    try {
        const response = await chrome.runtime.sendMessage({ action: 'pageCacheClearAll' });
        if (!response || response.cleared !== true) throw new Error('cache clear rejected');
        cacheStats = { entries: 0, bytes: 0 };
        renderCacheStats();
        showSnackbar(t.dataClearDone, false);
    } catch (e) {
        showSnackbar(t.dataActionFailed, true);
    }
}

function activateSection(id) {
    const target = SECTION_IDS.includes(id) ? id : SECTION_IDS[0];
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === target);
    });
    document.querySelectorAll('main > section').forEach(section => {
        section.hidden = section.dataset.panel !== target;
    });
    try { history.replaceState(null, '', '#' + target); } catch (e) { }
    if (target === 'data') refreshDataSection();
}

const resetHandlers = {
    general: () => {
        populateLanguageSelect('en');
        applyDir('en');
        applyI18n(getT('en'));
        el('toggleBlueBackground').checked = false;
    },
    provider: () => {
        providerSettings[BUILTIN_PROVIDER] = { apiKey: '', model: '' };
        providerSettings.gemini = { apiKey: '', model: DEFAULTS.geminiModel };
        providerSettings.openai = { apiKey: '', model: DEFAULTS.openaiModel };
        providerSettings.anthropic = { apiKey: '', model: DEFAULTS.anthropicModel };
        providerSettings['openai-compatible'] = { apiKey: '', model: DEFAULTS.compatibleModel, endpoint: '' };
        currentProvider = DEFAULTS.apiProvider;
        el('apiProvider').value = currentProvider;
        updateProviderUI(currentProvider);
    },
    behavior: () => {
        el('realTimeTranslation').checked = false;
        el('hidePromptAllSites').checked = false;
        el('streamingTranslation').checked = false;
        el('showProgressPopup').checked = true;
        el('showContextMenu').checked = true;
        el('autoRetranslateDomain').checked = true;
    },
    style: () => {
        el('translationStyle').value = '';
        el('customInstruction').value = '';
        el('glossaryText').value = '';
    },
    advanced: () => {
        el('maxToken').value = DEFAULTS.maxToken;
        el('delayBetweenRequests').value = Math.round(DEFAULTS.delayBetweenRequests / 1000);
        el('concurrencyLimit').value = DEFAULTS.concurrencyLimit;
        el('maxRetries').value = DEFAULTS.maxRetries;
        el('timeout').value = DEFAULTS.timeout;
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const items = await chrome.storage.local.get([
            'targetLanguage', 'apiProvider',
            'geminiApiKey', 'geminiModel',
            'openaiApiKey', 'openaiModel',
            'anthropicApiKey', 'anthropicModel',
            'compatibleApiKey', 'compatibleModel', 'compatibleEndpoint',
            'delayBetweenRequests', 'maxToken', 'concurrencyLimit',
            'maxRetries', 'timeout',
            'toggleBlueBackground', 'realTimeTranslation', 'showProgressPopup', 'excludeList', 'alwaysTranslateList', 'hidePromptAllSites', 'showContextMenu', 'autoRetranslateDomain', 'streamingTranslation',
            'translationStyle', 'customInstruction', 'glossaryText'
        ]);

        const lang = items.targetLanguage || 'en';
        populateLanguageSelect(lang);
        applyDir(lang);

        providerSettings.gemini.apiKey = items.geminiApiKey || '';
        providerSettings.gemini.model = items.geminiModel || DEFAULTS.geminiModel;
        providerSettings.openai.apiKey = items.openaiApiKey || '';
        providerSettings.openai.model = items.openaiModel || DEFAULTS.openaiModel;
        providerSettings.anthropic.apiKey = items.anthropicApiKey || '';
        providerSettings.anthropic.model = items.anthropicModel || DEFAULTS.anthropicModel;
        providerSettings['openai-compatible'].apiKey = items.compatibleApiKey || '';
        providerSettings['openai-compatible'].model = items.compatibleModel || DEFAULTS.compatibleModel;
        providerSettings['openai-compatible'].endpoint = items.compatibleEndpoint || '';

        currentProvider = items.apiProvider || DEFAULTS.apiProvider;
        el('apiProvider').value = currentProvider;
        updateProviderUI(currentProvider);

        el('delayBetweenRequests').value = Math.round((items.delayBetweenRequests ?? DEFAULTS.delayBetweenRequests) / 1000);
        el('maxToken').value = items.maxToken ?? DEFAULTS.maxToken;
        el('concurrencyLimit').value = items.concurrencyLimit ?? DEFAULTS.concurrencyLimit;
        el('maxRetries').value = items.maxRetries ?? DEFAULTS.maxRetries;
        el('timeout').value = items.timeout ?? DEFAULTS.timeout;
        el('toggleBlueBackground').checked = items.toggleBlueBackground === true;
        el('realTimeTranslation').checked = items.realTimeTranslation === true;
        el('showProgressPopup').checked = items.showProgressPopup !== false;
        el('hidePromptAllSites').checked = items.hidePromptAllSites === true;
        el('showContextMenu').checked = items.showContextMenu !== false;
        el('autoRetranslateDomain').checked = items.autoRetranslateDomain !== false;
        el('streamingTranslation').checked = items.streamingTranslation === true;
        el('translationStyle').value = STYLE_PRESETS.includes(items.translationStyle) ? items.translationStyle : '';
        el('customInstruction').value = items.customInstruction || '';
        el('glossaryText').value = items.glossaryText || '';
        excludeEntries = normalizeSiteList(items.excludeList);
        alwaysEntries = normalizeSiteList(items.alwaysTranslateList);

        applyI18n(getT(lang));
    } catch (e) {
        applyI18n(getT('en'));
    }

    activateSection((location.hash || '').replace('#', ''));

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => activateSection(btn.dataset.section));
    });

    window.addEventListener('hashchange', () => {
        activateSection((location.hash || '').replace('#', ''));
    });

    el('targetLanguage').addEventListener('change', () => {
        const lang = getUiLang();
        applyDir(lang);
        applyI18n(getT(lang));
        if (currentProvider === BUILTIN_PROVIDER) refreshBuiltinStatus();
        scheduleSave();
    });

    el('builtinPrepareBtn').addEventListener('click', prepareBuiltinEngine);

    try {
        chrome.runtime.onMessage.addListener(handleBuiltinProgressMessage);
    } catch (e) { }

    el('apiProvider').addEventListener('change', () => {
        saveCurrentProviderToMemory();
        currentProvider = el('apiProvider').value;
        updateProviderUI(currentProvider);
        scheduleSave();
    });

    ['apiKey', 'aiModel', 'endpointUrl', 'customInstruction', 'glossaryText'].forEach(id => {
        el(id).addEventListener('input', scheduleSave);
    });

    el('translationStyle').addEventListener('change', scheduleSave);

    Object.keys(NUMBER_FIELDS).forEach(id => {
        el(id).addEventListener('input', scheduleSave);
        el(id).addEventListener('change', () => {
            normalizeNumberField(id);
            scheduleSave();
        });
    });

    ['toggleBlueBackground', 'realTimeTranslation', 'showProgressPopup', 'hidePromptAllSites', 'showContextMenu', 'autoRetranslateDomain', 'streamingTranslation'].forEach(id => {
        el(id).addEventListener('change', scheduleSave);
    });

    el('toggleKeyVisibility').addEventListener('click', () => {
        const input = el('apiKey');
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        el('eyeShow').hidden = reveal;
        el('eyeHide').hidden = !reveal;
    });

    el('usageResetBtn').addEventListener('click', resetUsageCounters);
    el('cacheClearBtn').addEventListener('click', clearPageCache);

    const siteListInputs = [
        { addBtn: 'excludeAddBtn', input: 'excludeInput', entries: () => excludeEntries, opposing: () => alwaysEntries },
        { addBtn: 'alwaysAddBtn', input: 'alwaysInput', entries: () => alwaysEntries, opposing: () => excludeEntries }
    ];

    siteListInputs.forEach(spec => {
        const submit = () => addSiteEntry(spec.input, spec.entries(), spec.opposing());
        el(spec.addBtn).addEventListener('click', submit);
        el(spec.input).addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        });
    });

    document.querySelectorAll('[data-reset]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm(currentT().resetConfirm)) return;
            resetHandlers[btn.dataset.reset]?.();
            scheduleSave();
        });
    });

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            let changed = false;
            if (changes.excludeList) {
                const incoming = normalizeSiteList(changes.excludeList.newValue);
                if (JSON.stringify(incoming) !== JSON.stringify(excludeEntries)) {
                    excludeEntries = incoming;
                    changed = true;
                }
            }
            if (changes.alwaysTranslateList) {
                const incoming = normalizeSiteList(changes.alwaysTranslateList.newValue);
                if (JSON.stringify(incoming) !== JSON.stringify(alwaysEntries)) {
                    alwaysEntries = incoming;
                    changed = true;
                }
            }
            if (changed) renderSiteLists();
        });
    } catch (e) { }
});
