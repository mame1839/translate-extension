const DEFAULTS = Object.freeze({
    apiProvider: 'gemini',
    geminiModel: 'gemini-3.5-flash-lite',
    openaiModel: 'gpt-5.6-luna',
    anthropicModel: 'claude-haiku-4-5-20251001',
    compatibleModel: '',
    geminiReasoning: '',
    openaiReasoning: 'off',
    anthropicReasoning: '',
    compatibleReasoning: '',
    batchSize: 500,
    maxBatchLength: 65535,
    delayBetweenRequests: 10000,
    maxToken: null,
    concurrencyLimit: 10,
    maxRetries: 3,
    timeout: 300
});

const MODEL_PLACEHOLDERS = {
    gemini: DEFAULTS.geminiModel,
    openai: DEFAULTS.openaiModel,
    anthropic: DEFAULTS.anthropicModel,
    'openai-compatible': DEFAULTS.compatibleModel
};

const REASONING_LEVEL_LABEL_KEYS = {
    off: 'reasoningOff',
    minimal: 'reasoningMinimal',
    low: 'reasoningLow',
    medium: 'reasoningMedium',
    high: 'reasoningHigh',
    xhigh: 'reasoningXhigh',
    max: 'reasoningMax'
};

const PROVIDER_ROW_DESCS = {
    apiKeyDesc: { base: 'optApiKeyDesc', 'openai-compatible': 'optCompatibleApiKeyDesc' },
    aiModelDesc: { base: 'optModelDesc', 'openai-compatible': 'optCompatibleModelDesc' },
    maxTokenDesc: { base: 'optMaxTokenDesc', anthropic: 'optAnthropicMaxTokenDesc' }
};

const providerSettings = {
    gemini: { apiKey: '', model: DEFAULTS.geminiModel, reasoning: DEFAULTS.geminiReasoning },
    openai: { apiKey: '', model: DEFAULTS.openaiModel, reasoning: DEFAULTS.openaiReasoning },
    anthropic: { apiKey: '', model: DEFAULTS.anthropicModel, reasoning: DEFAULTS.anthropicReasoning },
    'openai-compatible': { apiKey: '', model: DEFAULTS.compatibleModel, reasoning: DEFAULTS.compatibleReasoning, endpoint: '', extraParams: {} }
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
let extraParamsMode = 'list';
let extraParamsErrorKind = '';
let extraParamsErrorDetail = '';
let excludeEntries = [];
let alwaysEntries = [];
let saveTimer = null;
let snackTimer = null;
let usageStats = null;
let usageFailureReason = '';
let cacheStats = null;
let cacheFailureReason = '';
let backgroundUnreachable = false;
let backgroundVersion = null;
let cachePages = [];
let cachePagesTotal = 0;
let cachePagesUnreadable = false;
let cachePagesLoaded = false;

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
    updateProviderRowDescs(currentProvider);
    renderReasoningControl();
    renderExtraParams();
    renderSiteLists();
    renderUsageStats();
    renderCacheStats();
    renderCachePages();
    renderStaleBackgroundBanner();
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

function normalizeProvider(provider) {
    return Object.prototype.hasOwnProperty.call(providerSettings, provider) ? provider : DEFAULTS.apiProvider;
}

function modelIdFor(provider) {
    return el('aiModel').value.trim() || MODEL_PLACEHOLDERS[provider] || '';
}

function modelCapsFor(provider) {
    return resolveModelCapabilities(provider, modelIdFor(provider));
}

function updateProviderRowDescs(provider) {
    const t = currentT();
    const lang = getUiLang();
    const outputLimit = modelCapsFor(provider).maxOutputTokens ?? ANTHROPIC_MAX_OUTPUT_TOKENS;
    Object.keys(PROVIDER_ROW_DESCS).forEach(id => {
        const variants = PROVIDER_ROW_DESCS[id];
        const key = variants[provider] || variants.base;
        const node = el(id);
        node.dataset.i18n = key;
        if (t[key] !== undefined) {
            node.textContent = t[key].replace('{limit}', formatNumber(outputLimit, lang));
        }
    });
}

function reasoningLevelLabel(t, level) {
    const key = REASONING_LEVEL_LABEL_KEYS[level];
    return key && t[key] !== undefined ? t[key] : level;
}

function renderReasoningControl() {
    const select = el('reasoningLevel');
    const desc = el('reasoningDesc');
    const stale = el('reasoningStale');
    if (!select || !desc || !stale) return;
    const t = currentT();
    const caps = modelCapsFor(currentProvider);
    const settings = providerSettings[currentProvider] || providerSettings.gemini;
    const stored = typeof settings.reasoning === 'string' ? settings.reasoning : '';
    const storedSupported = caps.levels.includes(stored);
    select.replaceChildren();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = REASONING_LEVEL_LABEL_KEYS[caps.defaultLevel]
        ? t.reasoningDefaultIs.replace('{level}', reasoningLevelLabel(t, caps.defaultLevel))
        : t.reasoningDefault;
    select.appendChild(defaultOption);
    caps.levels.forEach(level => {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = reasoningLevelLabel(t, level);
        select.appendChild(option);
    });
    select.disabled = caps.levels.length === 0;
    select.value = storedSupported ? stored : '';
    if (caps.levels.length === 0) {
        desc.textContent = t.optReasoningNotSent;
    } else {
        desc.textContent = currentProvider === 'openai-compatible' ? t.optReasoningCompatibleDesc : t.optReasoningDesc;
    }
    const showStale = caps.levels.length > 0 && stored !== '' && !storedSupported;
    stale.hidden = !showStale;
    stale.textContent = showStale
        ? t.optReasoningStale.replace('{level}', reasoningLevelLabel(t, stored)).replace('{model}', modelIdFor(currentProvider))
        : '';
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function acceptsExtraParams(candidate) {
    try {
        applyExtraParams({}, candidate);
        return true;
    } catch (e) {
        return false;
    }
}

function parseExtraParamValue(raw) {
    const text = String(raw || '').trim();
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

function setExtraParamsError(kind, detail) {
    extraParamsErrorKind = kind || '';
    extraParamsErrorDetail = detail || '';
    renderExtraParamsError();
}

function renderExtraParamsError() {
    const node = el('extraParamError');
    if (!node) return;
    const t = currentT();
    let text = '';
    if (extraParamsErrorKind === 'reserved') {
        text = t.optExtraParamReserved;
    } else if (extraParamsErrorKind === 'invalid') {
        text = extraParamsErrorDetail ? t.optExtraParamInvalid + ' ' + extraParamsErrorDetail : t.optExtraParamInvalid;
    }
    node.hidden = !text;
    node.textContent = text;
}

function renderExtraParamRows(params, t) {
    const container = el('extraParamRows');
    container.replaceChildren();
    const entries = Object.entries(params);
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.textContent = t.optExtraParamEmpty;
        container.appendChild(empty);
        return;
    }
    entries.forEach(([key, value]) => {
        const row = document.createElement('div');
        row.className = 'chip-row';
        const main = document.createElement('div');
        main.className = 'chip-main';
        const name = document.createElement('span');
        name.className = 'host';
        name.textContent = key;
        name.title = key;
        const shown = document.createElement('span');
        shown.className = 'chip-meta';
        const literal = document.createElement('bdi');
        literal.textContent = JSON.stringify(value);
        shown.appendChild(literal);
        main.appendChild(name);
        main.appendChild(shown);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn';
        removeBtn.title = t.optRemove;
        removeBtn.setAttribute('aria-label', t.optRemove);
        removeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        removeBtn.addEventListener('click', () => {
            delete providerSettings['openai-compatible'].extraParams[key];
            setExtraParamsError('');
            renderExtraParams();
            scheduleSave();
        });
        row.appendChild(main);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
}

function renderExtraParams() {
    const group = el('extraParamsGroup');
    if (!group) return;
    const t = currentT();
    const params = providerSettings['openai-compatible'].extraParams;
    const raw = extraParamsMode === 'raw';
    el('extraParamsMode').value = extraParamsMode;
    el('extraParamRows').hidden = raw;
    el('extraParamAddRow').hidden = raw;
    el('extraParamRawRow').hidden = !raw;
    renderExtraParamRows(params, t);
    const textarea = el('extraParamRaw');
    if (document.activeElement !== textarea) textarea.value = JSON.stringify(params, null, 2);
    renderExtraParamsError();
}

function addExtraParam() {
    const keyInput = el('extraParamKey');
    const valueInput = el('extraParamValue');
    const key = String(keyInput.value || '').trim();
    if (!key) {
        keyInput.focus();
        return;
    }
    const candidate = {};
    Object.defineProperty(candidate, key, { value: parseExtraParamValue(valueInput.value), enumerable: true, writable: true, configurable: true });
    if (!acceptsExtraParams(candidate)) {
        setExtraParamsError('reserved');
        return;
    }
    const settings = providerSettings['openai-compatible'];
    settings.extraParams = Object.assign({}, settings.extraParams, candidate);
    keyInput.value = '';
    valueInput.value = '';
    setExtraParamsError('');
    renderExtraParams();
    scheduleSave();
    keyInput.focus();
}

function readExtraParamsRaw() {
    let parsed;
    try {
        parsed = JSON.parse(el('extraParamRaw').value);
    } catch (e) {
        setExtraParamsError('invalid', e && e.message ? e.message : '');
        return;
    }
    if (!isPlainObject(parsed)) {
        setExtraParamsError('invalid', '');
        return;
    }
    if (!acceptsExtraParams(parsed)) {
        setExtraParamsError('reserved');
        return;
    }
    providerSettings['openai-compatible'].extraParams = parsed;
    setExtraParamsError('');
    renderExtraParamRows(parsed, currentT());
    scheduleSave();
}

function updateProviderUI(provider) {
    const settings = providerSettings[provider] || providerSettings.gemini;
    el('apiKey').value = settings.apiKey;
    el('aiModel').value = settings.model;
    el('aiModel').placeholder = MODEL_PLACEHOLDERS[provider] || '';
    const endpointGroup = el('endpointGroup');
    const extraParamsGroup = el('extraParamsGroup');
    if (provider === 'openai-compatible') {
        el('endpointUrl').value = settings.endpoint || '';
        endpointGroup.style.display = '';
        extraParamsGroup.hidden = false;
    } else {
        endpointGroup.style.display = 'none';
        extraParamsGroup.hidden = true;
    }
    updateProviderRowDescs(provider);
    renderReasoningControl();
    setExtraParamsError('');
    renderExtraParams();
}

function languageNativeName(code) {
    const entry = LANGUAGES.find(lang => lang.code === code);
    return entry ? entry.native : code;
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
    el(id).value = readNumberField(id) ?? '';
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
    const raw = String(input.value || '').trim();
    if (!raw) return;
    if (!isUsableSiteEntry(raw)) {
        showSnackbar(currentT().optInvalidEndpoint, true);
        return;
    }
    const entry = normalizeSiteEntry(raw);
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
        geminiReasoning: providerSettings.gemini.reasoning,
        openaiReasoning: providerSettings.openai.reasoning,
        anthropicReasoning: providerSettings.anthropic.reasoning,
        compatibleReasoning: providerSettings['openai-compatible'].reasoning,
        compatibleExtraParams: providerSettings['openai-compatible'].extraParams,
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
        autoTranslateNewContent: el('autoTranslateNewContent').checked,
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

function buildUsageErrorRow(message) {
    const row = document.createElement('div');
    row.className = 'row';
    const main = document.createElement('div');
    main.className = 'row-main';
    const desc = document.createElement('div');
    desc.className = 'row-desc warn-text';
    desc.textContent = message;
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
    container.replaceChildren();
    if (usageFailureReason) {
        container.appendChild(buildUsageErrorRow(backgroundUnreachable
            ? t.bgUnavailable + ' (' + usageFailureReason + ')'
            : t.usageUnreadable.replace('{reason}', usageFailureReason)));
        since.textContent = '';
        return;
    }
    if (!usageStats) {
        since.textContent = '';
        return;
    }
    const providers = usageStats.providers || {};
    const names = usedProviderNames(providers);
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
    const t = currentT();
    const lang = getUiLang();
    const readable = !!cacheStats && !cacheFailureReason;
    const sizeReadable = readable && !cacheStats.bytesError;
    entriesNode.textContent = readable ? formatNumber(cacheStats.entries, lang) : '—';
    sizeNode.textContent = sizeReadable ? formatBytes(cacheStats.bytes, lang) : '—';
    const errorRow = el('cacheErrorRow');
    const errorNode = el('cacheError');
    if (!errorRow || !errorNode) return;
    errorRow.hidden = readable && sizeReadable;
    if (readable && sizeReadable) { errorNode.textContent = ''; return; }
    if (readable) {
        errorNode.textContent = t.dataCacheSizeUnreadable.replace('{reason}', cacheStats.bytesError);
        return;
    }
    errorNode.textContent = backgroundUnreachable
        ? t.bgUnavailable + (cacheFailureReason ? ' (' + cacheFailureReason + ')' : '')
        : t.dataCacheUnreadable.replace('{reason}', cacheFailureReason);
}

async function refreshUsageStats() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'usageStatsGet' });
        if (!response || !response.stats) throw new Error(describeResponseFailure(response));
        usageStats = response.stats;
        usageFailureReason = '';
    } catch (e) {
        usageStats = null;
        usageFailureReason = describeBackgroundFailure(e) || 'unknown';
    }
    renderUsageStats();
}

function describeBackgroundFailure(e) {
    const message = e && typeof e.message === 'string' ? e.message : '';
    return message ? message.slice(0, 200) : '';
}

function describeResponseFailure(response) {
    return (response && typeof response.error === 'string' && response.error) ? response.error : '';
}

function pageVersion() {
    try { return chrome.runtime.getManifest().version || ''; } catch (e) { return ''; }
}

function renderStaleBackgroundBanner() {
    const banner = el('staleBackgroundBanner');
    const text = el('staleBackgroundText');
    if (!banner || !text) return;
    const t = currentT();
    const mine = pageVersion();
    if (backgroundVersion && backgroundVersion === mine) {
        banner.hidden = true;
        text.textContent = '';
        return;
    }
    if (!backgroundVersion && !backgroundUnreachable) {
        banner.hidden = true;
        text.textContent = '';
        return;
    }
    banner.hidden = false;
    text.textContent = backgroundVersion
        ? t.bgVersionMismatch.replace('{swVersion}', backgroundVersion).replace('{pageVersion}', mine)
        : t.bgUnavailable;
}

async function checkBackgroundVersion() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'backgroundVersion' });
        backgroundVersion = (response && typeof response.version === 'string' && response.version) ? response.version : null;
        backgroundUnreachable = !backgroundVersion;
    } catch (e) {
        backgroundVersion = null;
        backgroundUnreachable = true;
    }
    renderStaleBackgroundBanner();
}

async function refreshCacheStats() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'pageCacheStats' });
        if (!response || !response.stats) throw new Error(describeResponseFailure(response));
        cacheStats = response.stats;
        cacheFailureReason = typeof cacheStats.error === 'string' ? cacheStats.error : '';
        backgroundUnreachable = false;
        if (typeof response.version === 'string' && response.version) backgroundVersion = response.version;
    } catch (e) {
        cacheStats = null;
        cacheFailureReason = describeBackgroundFailure(e);
        backgroundUnreachable = true;
    }
    renderCacheStats();
    renderStaleBackgroundBanner();
}

function cachePageLabel(page) {
    if (!page.url) return page.key;
    try {
        const parsed = new URL(page.url);
        return parsed.host + parsed.pathname + parsed.search;
    } catch (e) { return page.url; }
}

function renderCachePages() {
    const container = el('cacheRows');
    const moreRow = el('cacheMoreRow');
    if (!container || !moreRow) return;
    const t = currentT();
    const lang = getUiLang();
    container.replaceChildren();
    if (!cachePagesLoaded) {
        moreRow.hidden = true;
        return;
    }
    if (cachePages.length === 0) {
        const empty = document.createElement('div');
        empty.className = cachePagesUnreadable ? 'empty-list warn-text' : 'empty-list';
        empty.textContent = cachePagesUnreadable ? t.bgUnavailable : t.dataCacheNoPages;
        container.appendChild(empty);
        moreRow.hidden = true;
        return;
    }
    cachePages.forEach(page => {
        const row = document.createElement('div');
        row.className = 'chip-row';
        const main = document.createElement('div');
        main.className = 'chip-main';
        const host = document.createElement('span');
        host.className = 'host';
        host.textContent = cachePageLabel(page);
        host.title = page.url || page.key;
        const meta = document.createElement('span');
        meta.className = 'chip-meta';
        const parts = [];
        if (page.savedAt) parts.push(formatDate(page.savedAt, lang));
        if (page.lang) parts.push(languageNativeName(page.lang));
        parts.push(t.dataCacheBlocksLabel.replace('{count}', formatNumber(page.blocks, lang)));
        parts.forEach((part, index) => {
            if (index > 0) meta.appendChild(document.createTextNode(' · '));
            const piece = document.createElement('bdi');
            piece.textContent = part;
            meta.appendChild(piece);
        });
        main.appendChild(host);
        main.appendChild(meta);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn';
        removeBtn.title = t.optRemove;
        removeBtn.setAttribute('aria-label', t.optRemove);
        removeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        removeBtn.addEventListener('click', () => removeCachePage(page.key));
        row.appendChild(main);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
    moreRow.hidden = cachePages.length >= cachePagesTotal;
}

async function loadCachePages(append) {
    try {
        const offset = append ? cachePages.length : 0;
        const response = await chrome.runtime.sendMessage({ action: 'pageCacheList', offset });
        if (!response || !Array.isArray(response.pages)) throw new Error(describeResponseFailure(response));
        if (response.error) throw new Error(response.error);
        cachePagesTotal = Number.isFinite(response.total) ? response.total : response.pages.length;
        cachePages = append ? cachePages.concat(response.pages) : response.pages;
        cachePagesUnreadable = false;
    } catch (e) {
        if (!append) {
            cachePages = [];
            cachePagesTotal = 0;
        }
        cachePagesUnreadable = true;
        if (append) showSnackbar(currentT().dataActionFailed, true);
    }
    cachePagesLoaded = true;
    renderCachePages();
}

async function removeCachePage(key) {
    const t = currentT();
    try {
        const response = await chrome.runtime.sendMessage({ action: 'pageCacheRemove', key });
        if (!response || response.removed !== true) throw new Error('cache remove rejected');
        cachePages = cachePages.filter(page => page.key !== key);
        cachePagesTotal = Math.max(0, cachePagesTotal - 1);
        renderCachePages();
        refreshCacheStats();
        showSnackbar(t.dataClearDone, false);
    } catch (e) {
        showSnackbar(t.dataActionFailed, true);
    }
}

function refreshDataSection() {
    checkBackgroundVersion();
    refreshUsageStats();
    refreshCacheStats();
    loadCachePages(false);
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
        cacheFailureReason = '';
        cachePages = [];
        cachePagesTotal = 0;
        cachePagesUnreadable = false;
        cachePagesLoaded = true;
        renderCacheStats();
        renderCachePages();
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
        providerSettings.gemini = { apiKey: '', model: DEFAULTS.geminiModel, reasoning: DEFAULTS.geminiReasoning };
        providerSettings.openai = { apiKey: '', model: DEFAULTS.openaiModel, reasoning: DEFAULTS.openaiReasoning };
        providerSettings.anthropic = { apiKey: '', model: DEFAULTS.anthropicModel, reasoning: DEFAULTS.anthropicReasoning };
        providerSettings['openai-compatible'] = { apiKey: '', model: DEFAULTS.compatibleModel, reasoning: DEFAULTS.compatibleReasoning, endpoint: '', extraParams: {} };
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
        el('autoTranslateNewContent').checked = false;
    },
    style: () => {
        el('translationStyle').value = '';
        el('customInstruction').value = '';
        el('glossaryText').value = '';
    },
    advanced: () => {
        el('maxToken').value = '';
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
            'compatibleApiKey', 'compatibleModel', 'compatibleEndpoint', 'compatibleExtraParams',
            'geminiReasoning', 'openaiReasoning', 'anthropicReasoning', 'compatibleReasoning',
            'delayBetweenRequests', 'maxToken', 'concurrencyLimit',
            'maxRetries', 'timeout',
            'toggleBlueBackground', 'realTimeTranslation', 'showProgressPopup', 'excludeList', 'alwaysTranslateList', 'hidePromptAllSites', 'showContextMenu', 'autoRetranslateDomain', 'autoTranslateNewContent', 'streamingTranslation',
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
        providerSettings['openai-compatible'].extraParams = isPlainObject(items.compatibleExtraParams) ? items.compatibleExtraParams : {};
        providerSettings.gemini.reasoning = resolveReasoningLevel(items.geminiReasoning,
            providerSettings.gemini.model === DEFAULTS.geminiModel, DEFAULTS.geminiReasoning);
        providerSettings.openai.reasoning = resolveReasoningLevel(items.openaiReasoning,
            providerSettings.openai.model === DEFAULTS.openaiModel, DEFAULTS.openaiReasoning);
        providerSettings.anthropic.reasoning = resolveReasoningLevel(items.anthropicReasoning,
            providerSettings.anthropic.model === DEFAULTS.anthropicModel, DEFAULTS.anthropicReasoning);
        providerSettings['openai-compatible'].reasoning = resolveReasoningLevel(items.compatibleReasoning,
            providerSettings['openai-compatible'].model === DEFAULTS.compatibleModel, DEFAULTS.compatibleReasoning);

        currentProvider = normalizeProvider(items.apiProvider || DEFAULTS.apiProvider);
        if (items.apiProvider && items.apiProvider !== currentProvider) {
            chrome.storage.local.set({ apiProvider: currentProvider }).catch(() => { });
        }
        el('apiProvider').value = currentProvider;
        updateProviderUI(currentProvider);

        el('delayBetweenRequests').value = Math.round((items.delayBetweenRequests ?? DEFAULTS.delayBetweenRequests) / 1000);
        el('maxToken').value = items.maxToken ?? '';
        el('concurrencyLimit').value = items.concurrencyLimit ?? DEFAULTS.concurrencyLimit;
        el('maxRetries').value = items.maxRetries ?? DEFAULTS.maxRetries;
        el('timeout').value = items.timeout ?? DEFAULTS.timeout;
        el('toggleBlueBackground').checked = items.toggleBlueBackground === true;
        el('realTimeTranslation').checked = items.realTimeTranslation === true;
        el('showProgressPopup').checked = items.showProgressPopup !== false;
        el('hidePromptAllSites').checked = items.hidePromptAllSites === true;
        el('showContextMenu').checked = items.showContextMenu !== false;
        el('autoRetranslateDomain').checked = items.autoRetranslateDomain !== false;
        el('autoTranslateNewContent').checked = items.autoTranslateNewContent === true;
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

    checkBackgroundVersion();

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
        scheduleSave();
    });

    el('apiProvider').addEventListener('change', () => {
        saveCurrentProviderToMemory();
        currentProvider = el('apiProvider').value;
        updateProviderUI(currentProvider);
        scheduleSave();
    });

    ['apiKey', 'aiModel', 'endpointUrl', 'customInstruction', 'glossaryText'].forEach(id => {
        el(id).addEventListener('input', scheduleSave);
    });

    el('aiModel').addEventListener('input', () => {
        updateProviderRowDescs(currentProvider);
        renderReasoningControl();
    });

    el('reasoningLevel').addEventListener('change', () => {
        const settings = providerSettings[currentProvider];
        if (settings) settings.reasoning = el('reasoningLevel').value;
        renderReasoningControl();
        scheduleSave();
    });

    el('extraParamsMode').addEventListener('change', () => {
        extraParamsMode = el('extraParamsMode').value === 'raw' ? 'raw' : 'list';
        el('extraParamRaw').blur();
        setExtraParamsError('');
        renderExtraParams();
    });

    el('extraParamAddBtn').addEventListener('click', addExtraParam);
    ['extraParamKey', 'extraParamValue'].forEach(id => {
        el(id).addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addExtraParam();
            }
        });
    });

    el('extraParamRaw').addEventListener('input', readExtraParamsRaw);

    el('translationStyle').addEventListener('change', scheduleSave);

    Object.keys(NUMBER_FIELDS).forEach(id => {
        el(id).addEventListener('input', scheduleSave);
        el(id).addEventListener('change', () => {
            normalizeNumberField(id);
            scheduleSave();
        });
    });

    ['toggleBlueBackground', 'realTimeTranslation', 'showProgressPopup', 'hidePromptAllSites', 'showContextMenu', 'autoRetranslateDomain', 'autoTranslateNewContent', 'streamingTranslation'].forEach(id => {
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
    el('cacheMoreBtn').addEventListener('click', () => loadCachePages(true));

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
