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
        ['apiProvider', ...UI_LANGUAGE_SETTING_KEYS, 'geminiModel', 'openaiModel', 'anthropicModel', 'deepseekModel', 'compatibleModel',
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
            const target = resolveTargetLanguage(items);
            chrome.contextMenus.removeAll(() => {
                chrome.contextMenus.create({
                    id: TOGGLE_MENU_ID,
                    title: contextMenuTitle('selMenuToggle', target),
                    contexts: ["all"],
                    visible: items.showContextMenu !== false
                });
                chrome.contextMenus.create({
                    id: SELECTION_MENU_ID,
                    title: contextMenuTitle('selMenuTranslate', target),
                    contexts: ["selection"],
                    visible: items.showContextMenu !== false
                });
                chrome.contextMenus.create({
                    id: REPLACE_MENU_ID,
                    title: contextMenuTitle('selMenuReplace', target),
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

function contextMenuTitle(key, target) {
    const title = target && target.strings ? target.strings[key] : '';
    return (typeof title === 'string' && title) ? title : CONTEXT_MENU_TITLE_FALLBACKS[key];
}

function handleContextMenuSettingsChange(changes, areaName) {
    if (areaName !== 'local') return;
    const shared = {};
    if (changes.showContextMenu !== undefined) {
        shared.visible = changes.showContextMenu.newValue !== false;
    }
    const languageChanged = UI_LANGUAGE_SETTING_KEYS.some(key => changes[key] !== undefined);
    if (!languageChanged) {
        if (Object.keys(shared).length > 0) updateContextMenus(shared, null);
        return;
    }
    try {
        chrome.storage.local.get(UI_LANGUAGE_SETTING_KEYS, items => {
            const readFailed = !!chrome.runtime.lastError || !items;
            updateContextMenus(shared, readFailed ? null : resolveTargetLanguage(items));
        });
    } catch (e) {
        if (Object.keys(shared).length > 0) updateContextMenus(shared, null);
    }
}

function updateContextMenus(shared, target) {
    const menus = [
        { id: TOGGLE_MENU_ID, key: 'selMenuToggle' },
        { id: SELECTION_MENU_ID, key: 'selMenuTranslate' },
        { id: REPLACE_MENU_ID, key: 'selMenuReplace' }
    ];
    for (const menu of menus) {
        const update = { ...shared };
        if (target) update.title = contextMenuTitle(menu.key, target);
        if (Object.keys(update).length === 0) continue;
        try {
            const updating = chrome.contextMenus.update(menu.id, update);
            if (updating && typeof updating.catch === 'function') updating.catch(() => { });
        } catch (e) { }
    }
}
