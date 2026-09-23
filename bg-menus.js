const LEGACY_DEFAULT_MAX_TOKEN = 65536;

const MAX_TOKEN_AUTO_SINCE = '7.1.0';

const LEGACY_DEFAULT_TIMEOUT = 180;

const TIMEOUT_RAISED_SINCE = '7.1.0';

function versionIsBefore(version, reference) {
    const parse = text => String(text || '').split('.').map(part => parseInt(part, 10) || 0);
    const left = parse(version);
    const right = parse(reference);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const a = left[i] || 0;
        const b = right[i] || 0;
        if (a !== b) return a < b;
    }
    return false;
}

function storedMaxTokenIsLegacyDefault(details, items) {
    return details.reason === 'update'
        && items.maxToken === LEGACY_DEFAULT_MAX_TOKEN
        && versionIsBefore(details.previousVersion, MAX_TOKEN_AUTO_SINCE);
}

function storedTimeoutIsLegacyDefault(details, items) {
    return details.reason === 'update'
        && items.timeout === LEGACY_DEFAULT_TIMEOUT
        && versionIsBefore(details.previousVersion, TIMEOUT_RAISED_SINCE);
}

function handleExtensionInstalled(details) {
    if (details.reason === 'install') {
        chrome.runtime.openOptionsPage();
    }
    cleanupLegacyPageCache();
    chrome.storage.local.get(
        ['apiProvider', 'targetLanguage', 'geminiModel', 'openaiModel', 'anthropicModel', 'deepseekModel', 'compatibleModel',
         'batchSize', 'maxBatchLength', 'delayBetweenRequests', 'maxToken', 'concurrencyLimit', 'maxRetries', 'timeout', 'showContextMenu', 'autoRetranslateDomain'],
        function (items) {
            const toSet = {};
            if (!items.apiProvider) toSet.apiProvider = DEFAULTS.apiProvider;
            if (!items.targetLanguage) toSet.targetLanguage = 'en';
            if (!items.geminiModel) toSet.geminiModel = DEFAULTS.geminiModel;
            if (!items.openaiModel) toSet.openaiModel = DEFAULTS.openaiModel;
            if (!items.anthropicModel) toSet.anthropicModel = DEFAULTS.anthropicModel;
            if (!items.deepseekModel) toSet.deepseekModel = DEFAULTS.deepseekModel;
            if (items.batchSize === undefined) toSet.batchSize = DEFAULTS.batchSize;
            if (items.maxBatchLength === undefined) toSet.maxBatchLength = DEFAULTS.maxBatchLength;
            if (items.delayBetweenRequests === undefined) toSet.delayBetweenRequests = DEFAULTS.delayBetweenRequests;
            if (storedMaxTokenIsLegacyDefault(details, items)) toSet.maxToken = DEFAULTS.maxToken;
            if (items.concurrencyLimit === undefined) toSet.concurrencyLimit = DEFAULTS.concurrencyLimit;
            if (items.maxRetries === undefined) toSet.maxRetries = DEFAULTS.maxRetries;
            if (items.timeout === undefined || storedTimeoutIsLegacyDefault(details, items)) toSet.timeout = DEFAULTS.timeout;
            if (items.showContextMenu === undefined) toSet.showContextMenu = DEFAULTS.showContextMenu;
            if (items.autoRetranslateDomain === undefined) toSet.autoRetranslateDomain = DEFAULTS.autoRetranslateDomain;
            if (Object.keys(toSet).length > 0) chrome.storage.local.set(toSet);
            chrome.contextMenus.removeAll(() => {
                chrome.contextMenus.create({
                    id: TOGGLE_MENU_ID,
                    title: contextMenuTitle('selMenuToggle', items.targetLanguage),
                    contexts: ["all"],
                    visible: items.showContextMenu !== false
                });
                chrome.contextMenus.create({
                    id: SELECTION_MENU_ID,
                    title: contextMenuTitle('selMenuTranslate', items.targetLanguage),
                    contexts: ["selection"],
                    visible: items.showContextMenu !== false
                });
                chrome.contextMenus.create({
                    id: REPLACE_MENU_ID,
                    title: contextMenuTitle('selMenuReplace', items.targetLanguage),
                    contexts: ["selection"],
                    visible: items.showContextMenu !== false
                });
            });
        }
    );
}

const TOGGLE_MENU_ID = 'toggleTranslation';

const SELECTION_MENU_ID = 'translateSelection';

const REPLACE_MENU_ID = 'translateReplaceSelection';

const CONTEXT_MENU_TITLE_FALLBACKS = {
    selMenuToggle: 'Toggle translation',
    selMenuTranslate: 'Translate selection',
    selMenuReplace: 'Translate and replace selection'
};

function contextMenuTitle(key, langCode) {
    try {
        if (typeof getT === 'function') {
            const strings = getT((langCode || 'en').trim());
            if (strings && strings[key]) return strings[key];
        }
    } catch (e) { }
    return CONTEXT_MENU_TITLE_FALLBACKS[key];
}

function handleContextMenuSettingsChange(changes, areaName) {
    if (areaName !== 'local') return;
    const shared = {};
    if (changes.showContextMenu !== undefined) {
        shared.visible = changes.showContextMenu.newValue !== false;
    }
    const languageChanged = changes.targetLanguage !== undefined;
    if (!languageChanged && Object.keys(shared).length === 0) return;
    const newLanguage = languageChanged ? changes.targetLanguage.newValue : null;
    const menus = [
        { id: TOGGLE_MENU_ID, key: 'selMenuToggle' },
        { id: SELECTION_MENU_ID, key: 'selMenuTranslate' },
        { id: REPLACE_MENU_ID, key: 'selMenuReplace' }
    ];
    for (const menu of menus) {
        const update = { ...shared };
        if (languageChanged) update.title = contextMenuTitle(menu.key, newLanguage);
        try {
            const updating = chrome.contextMenus.update(menu.id, update);
            if (updating && typeof updating.catch === 'function') updating.catch(() => { });
        } catch (e) { }
    }
}
