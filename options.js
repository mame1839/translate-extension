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

const providerSettings = {
    gemini: { apiKey: '', model: DEFAULTS.geminiModel },
    openai: { apiKey: '', model: DEFAULTS.openaiModel },
    anthropic: { apiKey: '', model: DEFAULTS.anthropicModel },
    'openai-compatible': { apiKey: '', model: DEFAULTS.compatibleModel, endpoint: '' }
};

const RTL_LANGS = new Set(['ar', 'ur', 'he', 'fa']);
const STYLE_PRESETS = ['', 'formal', 'casual', 'technical'];
const SECTION_IDS = ['general', 'provider', 'behavior', 'style', 'sites', 'advanced'];

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
    el('apiKey').value = settings.apiKey;
    el('aiModel').value = settings.model;
    el('aiModel').placeholder = MODEL_PLACEHOLDERS[provider] || '';
    const endpointGroup = el('endpointGroup');
    if (provider === 'openai-compatible') {
        el('endpointUrl').value = settings.endpoint || '';
        endpointGroup.style.display = '';
    } else {
        endpointGroup.style.display = 'none';
    }
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

function activateSection(id) {
    const target = SECTION_IDS.includes(id) ? id : SECTION_IDS[0];
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === target);
    });
    document.querySelectorAll('main > section').forEach(section => {
        section.hidden = section.dataset.panel !== target;
    });
    try { history.replaceState(null, '', '#' + target); } catch (e) { }
}

const resetHandlers = {
    general: () => {
        populateLanguageSelect('en');
        applyDir('en');
        applyI18n(getT('en'));
        el('toggleBlueBackground').checked = false;
    },
    provider: () => {
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
