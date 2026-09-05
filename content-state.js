let promptMessage = 'Translate this page?';

let translateButtonText = { yes: 'Translate', no: 'No', never: 'Never show for this site' };

let st = TRANSLATIONS.en;

let currentUiLang = 'en';

let detectedPageLanguage = '';

function applyStrings(lang) {
    const hasLang = !!TRANSLATIONS[lang];
    const t = TRANSLATIONS[hasLang ? lang : 'en'];
    currentUiLang = hasLang ? lang : 'en';
    promptMessage = t.promptMessage;
    translateButtonText = { yes: t.promptYes, no: t.promptNo, never: t.promptNever };
    st = t;
}

const BLOCK_TAGS = new Set([
    'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'DT', 'DD', 'TD', 'TH', 'CAPTION',
    'BLOCKQUOTE', 'PRE', 'ADDRESS',
    'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'MAIN',
    'FIGURE', 'FIGCAPTION',
    'UL', 'OL', 'DL',
    'TR', 'TBODY', 'THEAD', 'TFOOT', 'TABLE',
    'FORM', 'FIELDSET', 'LEGEND',
    'DETAILS', 'SUMMARY',
    'DIALOG', 'OUTPUT'
]);

const INLINE_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'CANVAS',
    'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT', 'OPTION', 'OPTGROUP',
    'VIDEO', 'AUDIO', 'EMBED', 'OBJECT', 'MATH', 'TEMPLATE',
    'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'MAP', 'AREA',
    'BR', 'HR', 'WBR', 'META', 'LINK', 'TITLE', 'HEAD'
]);

const DEFAULTS = Object.freeze({
    batchSize: 500,
    maxBatchLength: 65535
});

const IS_TOP_FRAME = (function () {
    try { return window.top === window; } catch (e) { return false; }
})();

const translatingSubframes = new Set();

let subframeFailures = [];

let isTranslating = false;

let translationStarted = false;

let translationCancelled = false;

let translationHasError = false;

let extensionContextLost = false;

let translationProgress = 0;

let translatedUnitsCount = 0;

let expectedTotalUnits = 0;

let oversizedSkippedCount = 0;

const AUTO_RESEND_MAX_UNITS = 50;

const TEMPORARY_BATCH_ERROR_CODES = new Set(['serverError', 'requestTimeout', 'jsonParseFailed', 'jsonExtractFailed', 'emptyResponse']);

let totalBatches = 0;

let batchesProcessed = 0;

let modelWaitStartedAt = 0;

let modelResponded = false;

let translationUnits = new Map();

let activeObservers = [];

let observedRoots = new WeakSet();

let replayingDrainedMutations = false;

let scanCache = null;

let observerDebounceTimer = null;

let userInteractionTimer = null;

let userInteractionListenersAttached = false;

let scrollListenersAttached = false;

let scrollDebounceTimer = null;

let lastScrollScanHeight = -1;

let domChangedSinceScrollScan = true;

let progressInterval = null;

let statusContainer = null;

let statusShadowRoot = null;

let statusPanelPhase = '';

let promptContainer = null;

let promptShadowRoot = null;

let minimizedDiv = null;

let minimizedShadowRoot = null;

let domUpdateQueue = [];

let isApplyingUpdates = false;

let pendingApplyPromise = null;

let translationRunGeneration = 0;

let pendingStartTimer = null;

let pendingStartIsUserInitiated = false;

let streamingBatchRegistry = new Map();

let streamingBatchCounter = 0;

let streamingEnabled = false;

let streamingActive = false;

const streamingBatchSeed = Math.random().toString(36).slice(2, 10);

let pendingNewContentRetranslation = false;

let pendingAuthorizedRetranslation = false;

let cacheRestoreMap = null;

let cacheRestoreActive = false;

let cacheReadError = '';

const POPUP_STATE_MEMO_MS = 1500;

let cacheCoverageMemo = null;

let popupRemainingMemo = { ts: 0, value: false };

const sessionTranslationMemo = new Map();

let sessionTranslationMemoLang = '';

const SESSION_MEMO_MAX_ENTRIES = 2000;

const blockTranslationLanguage = new WeakMap();

let statusAutoDismissTimer = null;

let restoreNoticeContainer = null;

let restoreNoticeTimer = null;

const RESTORE_NOTICE_TIMEOUT_MS = 12000;

let postNavigationCooldownUntil = 0;

let highlightTranslated = false;

let fatalErrorCancelPending = false;

let postFinishScanCount = 0;

const POST_FINISH_MAX_SCANS = 1;

const POST_FINISH_SCAN_DELAYS = [3000];

let autoTranslateNewContent = false;

let hidePromptForAllSites = false;

let currentExcludeList = [];

let settingWatcherAttached = false;

let autoRetranslateRounds = 0;

const AUTO_RETRANSLATE_MAX_ROUNDS = 3;

let continueNoticeCooldownUntil = 0;

const CONTINUE_NOTICE_COOLDOWN_MS = 60000;
