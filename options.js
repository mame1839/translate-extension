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

let currentProvider = DEFAULTS.apiProvider;

function applyI18n(t) {
    document.title = t.pageTitle;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (t[key] !== undefined) el.textContent = t[key];
    });
}

function populateLanguageSelect(selected) {
    const sel = document.getElementById('targetLanguage');
    sel.innerHTML = '';
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
    document.getElementById('apiKey').value = settings.apiKey;
    document.getElementById('aiModel').value = settings.model;
    document.getElementById('aiModel').placeholder = MODEL_PLACEHOLDERS[provider] || '';
    const endpointGroup = document.getElementById('endpointGroup');
    if (provider === 'openai-compatible') {
        document.getElementById('endpointUrl').value = settings.endpoint || '';
        endpointGroup.style.display = '';
    } else {
        endpointGroup.style.display = 'none';
    }
}

function saveCurrentProviderToMemory() {
    const settings = providerSettings[currentProvider];
    if (!settings) return;
    settings.apiKey = document.getElementById('apiKey').value;
    settings.model = document.getElementById('aiModel').value;
    if (currentProvider === 'openai-compatible') {
        settings.endpoint = document.getElementById('endpointUrl').value;
    }
}

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
            'toggleBlueBackground', 'realTimeTranslation', 'showProgressPopup', 'excludeList', 'hidePromptAllSites', 'showContextMenu'
        ]);

        const lang = items.targetLanguage || 'en';
        populateLanguageSelect(lang);
        applyI18n(getT(lang));

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
        document.getElementById('apiProvider').value = currentProvider;
        updateProviderUI(currentProvider);

        document.getElementById('delayBetweenRequests').value = Math.round((items.delayBetweenRequests ?? DEFAULTS.delayBetweenRequests) / 1000);
        document.getElementById('maxToken').value = items.maxToken ?? DEFAULTS.maxToken;
        document.getElementById('concurrencyLimit').value = items.concurrencyLimit ?? DEFAULTS.concurrencyLimit;
        document.getElementById('maxRetries').value = items.maxRetries ?? DEFAULTS.maxRetries;
        document.getElementById('timeout').value = items.timeout ?? DEFAULTS.timeout;
        document.getElementById('toggleBlueBackground').checked = items.toggleBlueBackground === true;
        document.getElementById('realTimeTranslation').checked = items.realTimeTranslation === true;
        document.getElementById('showProgressPopup').checked = items.showProgressPopup !== false;
        document.getElementById('hidePromptAllSites').checked = items.hidePromptAllSites === true;
        document.getElementById('showContextMenu').checked = items.showContextMenu !== false;
        document.getElementById('excludeList').value = (items.excludeList && Array.isArray(items.excludeList)) ? items.excludeList.join('\n') : '';
    } catch (error) {
        console.error('Error loading settings:', error);
    }

    const maxTokenInput = document.getElementById('maxToken');

    const resetHandlers = {
        language: () => {
            populateLanguageSelect('en');
            document.getElementById('targetLanguage').value = 'en';
            applyI18n(getT('en'));
        },
        api: () => {
            providerSettings.gemini = { apiKey: '', model: DEFAULTS.geminiModel };
            providerSettings.openai = { apiKey: '', model: DEFAULTS.openaiModel };
            providerSettings.anthropic = { apiKey: '', model: DEFAULTS.anthropicModel };
            providerSettings['openai-compatible'] = { apiKey: '', model: DEFAULTS.compatibleModel, endpoint: '' };
            currentProvider = DEFAULTS.apiProvider;
            document.getElementById('apiProvider').value = currentProvider;
            updateProviderUI(currentProvider);
        },
        output: () => {
            maxTokenInput.value = DEFAULTS.maxToken;
        },
        network: () => {
            document.getElementById('delayBetweenRequests').value = Math.round(DEFAULTS.delayBetweenRequests / 1000);
            document.getElementById('concurrencyLimit').value = DEFAULTS.concurrencyLimit;
            document.getElementById('maxRetries').value = DEFAULTS.maxRetries;
            document.getElementById('timeout').value = DEFAULTS.timeout;
        },
        display: () => {
            document.getElementById('toggleBlueBackground').checked = false;
            document.getElementById('realTimeTranslation').checked = false;
            document.getElementById('showProgressPopup').checked = true;
            document.getElementById('hidePromptAllSites').checked = false;
            document.getElementById('showContextMenu').checked = true;
        },
        exclude: () => {
            document.getElementById('excludeList').value = '';
        },
    };

    document.querySelectorAll('.btn-reset').forEach(btn => {
        btn.addEventListener('click', () => {
            const t = getT(document.getElementById('targetLanguage').value);
            if (confirm(t.resetConfirm)) {
                resetHandlers[btn.dataset.reset]?.();
            }
        });
    });
});

document.getElementById('targetLanguage').addEventListener('change', () => {
    const lang = document.getElementById('targetLanguage').value;
    applyI18n(getT(lang));
});

document.getElementById('apiProvider').addEventListener('change', () => {
    saveCurrentProviderToMemory();
    currentProvider = document.getElementById('apiProvider').value;
    updateProviderUI(currentProvider);
});

document.getElementById('saveBtn').addEventListener('click', async () => {
    saveCurrentProviderToMemory();

    const targetLanguage = document.getElementById('targetLanguage').value;
    const delayBetweenRequests = clampInt(document.getElementById('delayBetweenRequests').value, 0, 3600, Math.round(DEFAULTS.delayBetweenRequests / 1000)) * 1000;
    const maxToken = clampInt(document.getElementById('maxToken').value, 1, 1000000, DEFAULTS.maxToken);
    const concurrencyLimit = clampInt(document.getElementById('concurrencyLimit').value, 1, 50, DEFAULTS.concurrencyLimit);
    const maxRetries = clampInt(document.getElementById('maxRetries').value, 0, 10, DEFAULTS.maxRetries);
    const timeout = clampInt(document.getElementById('timeout').value, 1, 600, DEFAULTS.timeout);
    const toggleBlueBackground = document.getElementById('toggleBlueBackground').checked;
    const realTimeTranslation = document.getElementById('realTimeTranslation').checked;
    const showProgressPopup = document.getElementById('showProgressPopup').checked;
    const hidePromptAllSites = document.getElementById('hidePromptAllSites').checked;
    const showContextMenu = document.getElementById('showContextMenu').checked;
    const excludeList = document.getElementById('excludeList').value.split(/\r?\n/).map(url => url.trim()).filter(url => url);

    const saveData = {
        targetLanguage,
        apiProvider: currentProvider,
        geminiApiKey: providerSettings.gemini.apiKey,
        geminiModel: providerSettings.gemini.model.trim() || DEFAULTS.geminiModel,
        openaiApiKey: providerSettings.openai.apiKey,
        openaiModel: providerSettings.openai.model.trim() || DEFAULTS.openaiModel,
        anthropicApiKey: providerSettings.anthropic.apiKey,
        anthropicModel: providerSettings.anthropic.model.trim() || DEFAULTS.anthropicModel,
        compatibleApiKey: providerSettings['openai-compatible'].apiKey,
        compatibleModel: providerSettings['openai-compatible'].model.trim(),
        compatibleEndpoint: providerSettings['openai-compatible'].endpoint.trim(),
        delayBetweenRequests, maxToken,
        concurrencyLimit, maxRetries, timeout,
        toggleBlueBackground, realTimeTranslation, showProgressPopup, hidePromptAllSites, showContextMenu, excludeList
    };

    try {
        await chrome.storage.local.set(saveData);
        const t = getT(targetLanguage);
        showStatus(t.saved, 'success');
    } catch (error) {
        console.error('Error saving settings:', error);
        const t = getT(document.getElementById('targetLanguage').value);
        showStatus(t.saveError, 'error');
    }
});

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = type;
    setTimeout(() => {
        status.className = '';
        status.textContent = '';
    }, 3000);
}
