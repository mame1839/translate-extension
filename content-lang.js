function getPageLanguage() {
    try {
        const htmlLang = document.documentElement?.getAttribute('lang');
        if (htmlLang) return htmlLang.trim();
        const metaLang = document.querySelector('meta[http-equiv="Content-Language"]');
        if (metaLang) {
            const content = metaLang.getAttribute('content');
            if (content) return content.trim();
        }
    } catch (e) { }
    return '';
}

const LANGUAGE_DETECTION_SAMPLE_LIMIT = 1500;

const LANGUAGE_DETECTION_MIN_SAMPLE_LENGTH = 40;

const LANGUAGE_DETECTION_MIN_CONFIDENCE = 0.5;

const LANGUAGE_DETECTION_AUTO_SKIP_CONFIDENCE = 0.85;

const LANGUAGE_DETECTION_TIMEOUT_MS = 1500;

const LANGUAGE_DETECTION_SAMPLE_RETRY_DELAYS = [700, 1500];

const LANGUAGE_SAMPLE_SKIP_SELECTOR = 'script,style,noscript,template,svg,math,code,pre,kbd,samp,var,textarea,[aria-hidden="true"],[data-gemini-ignore="true"]';

const CHINESE_SCRIPT_MIN_SIGNAL = 4;

const CHINESE_SCRIPT_TRADITIONAL_RATIO = 0.5;

const TRADITIONAL_ONLY_CHARS = new Set('個為這們來時說會學發對國開關門問間東車書長點電話語讀寫聽買賣見現頭顯體麼還進過動務業產網頁圖資訊應該條從樂愛兒幾機號處報讓與經濟給結統專區單華費邊連選錢銀難題響觀歡舊灣風飛馬鳥島齊備標檢測環總聯龍記計設訪評識護議證貝負貨質購輸農遠違郵醫錯鍵陽陳際隨雖雙雜離術壓廠廣異溫滿漢無獲盤禮絡繼續舉藝藥衛裝訂訓詞詢誰調謝譯變豐賽軟輕輪辦運達適嗎後裡');

const SIMPLIFIED_ONLY_CHARS = new Set('个为这们来时说会学发对国开关门问间东车书长点电话语读写听买卖见现头显体么还进过动务业产网页图资讯应该条从乐爱儿几机号处报让与经济给结统专区单华费边连选钱银难题响观欢旧湾风飞马鸟岛齐备标检测环总联龙记计设访评识护议证贝负货质购输农远违邮医错键阳陈际随虽双杂离术压厂广异温满汉无获盘礼络继续举艺药卫装订训词询谁调谢译变丰赛软轻轮办运达适吗');

function waitForMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveWithTimeout(promise, timeoutMs, timeoutValue) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            () => { clearTimeout(timer); resolve(timeoutValue); }
        );
    });
}

function collectLanguageDetectionSample() {
    if (!document.body) return '';
    let sample = '';
    try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const value = node.nodeValue;
                if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest(LANGUAGE_SAMPLE_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while ((node = walker.nextNode()) && sample.length < LANGUAGE_DETECTION_SAMPLE_LIMIT) {
            sample += node.nodeValue.replace(/\s+/g, ' ').trim() + ' ';
        }
    } catch (e) { }
    return sample.trim();
}

function classifyChineseScript(sample) {
    let traditionalCount = 0;
    let simplifiedCount = 0;
    for (const ch of sample) {
        if (TRADITIONAL_ONLY_CHARS.has(ch)) traditionalCount++;
        else if (SIMPLIFIED_ONLY_CHARS.has(ch)) simplifiedCount++;
    }
    if (traditionalCount + simplifiedCount < CHINESE_SCRIPT_MIN_SIGNAL) return null;
    const ratio = traditionalCount / (traditionalCount + simplifiedCount);
    return ratio >= CHINESE_SCRIPT_TRADITIONAL_RATIO ? 'Hant' : 'Hans';
}

function detectedLanguageMatchesTarget(detected, targetLang) {
    const sourcePrimary = detected.lang.split('-')[0].toLowerCase();
    const targetPrimary = targetLang.split('-')[0].toLowerCase();
    if (sourcePrimary !== targetPrimary) return false;
    if (sourcePrimary !== 'zh') return true;
    if (!detected.chineseScript) return true;
    const targetIsTraditional = /-(hant|tw|hk|mo)/i.test(targetLang);
    return (detected.chineseScript === 'Hant') === targetIsTraditional;
}

async function runLanguageDetector(sample) {
    const detector = await LanguageDetector.create();
    try {
        const results = await detector.detect(sample);
        return Array.isArray(results) && results.length > 0 ? results[0] : null;
    } finally {
        try { detector.destroy(); } catch (e) { }
    }
}

async function detectContentLanguage() {
    try {
        if (typeof LanguageDetector === 'undefined') return null;
        const availability = await resolveWithTimeout(LanguageDetector.availability(), LANGUAGE_DETECTION_TIMEOUT_MS, null);
        if (availability !== 'available') return null;
        let sample = collectLanguageDetectionSample();
        for (const retryDelay of LANGUAGE_DETECTION_SAMPLE_RETRY_DELAYS) {
            if (sample.length >= LANGUAGE_DETECTION_MIN_SAMPLE_LENGTH) break;
            await waitForMs(retryDelay);
            sample = collectLanguageDetectionSample();
        }
        if (sample.length < LANGUAGE_DETECTION_MIN_SAMPLE_LENGTH) return null;
        const top = await resolveWithTimeout(runLanguageDetector(sample), LANGUAGE_DETECTION_TIMEOUT_MS, null);
        if (!top || typeof top.detectedLanguage !== 'string' || top.detectedLanguage === 'und') return null;
        const confidence = typeof top.confidence === 'number' ? top.confidence : 0;
        const sourcePrimary = top.detectedLanguage.split('-')[0].toLowerCase();
        let chineseScript = null;
        if (sourcePrimary === 'zh') {
            chineseScript = classifyChineseScript(sample);
            if (!chineseScript && /hant/i.test(top.detectedLanguage)) chineseScript = 'Hant';
        }
        return { lang: top.detectedLanguage, confidence, chineseScript };
    } catch (e) { return null; }
}

function detectedLanguageTag(detected) {
    const primary = detected.lang.split('-')[0].toLowerCase();
    if (primary === 'zh' && detected.chineseScript) {
        return detected.chineseScript === 'Hant' ? 'zh-Hant' : 'zh';
    }
    return detected.lang;
}

function resolvePageLanguageDecision(detected, pageLang, chosenLang) {
    const pageLangPrimary = pageLang ? pageLang.split('-')[0].toLowerCase() : null;
    const chosenLangPrimary = chosenLang.split('-')[0].toLowerCase();
    const attributeSaysTargetLanguage = !!(pageLangPrimary && pageLangPrimary === chosenLangPrimary);
    const detectionUsable = !!(detected && detected.confidence >= LANGUAGE_DETECTION_MIN_CONFIDENCE);
    const pageIsTargetLanguage = detectionUsable
        ? detectedLanguageMatchesTarget(detected, chosenLang)
        : attributeSaysTargetLanguage;
    const skipAutoTranslation = detectionUsable
        ? (detected.confidence >= LANGUAGE_DETECTION_AUTO_SKIP_CONFIDENCE && detectedLanguageMatchesTarget(detected, chosenLang))
        : attributeSaysTargetLanguage;
    const skipAutoTranslationIsLowConfidence = !detectionUsable && skipAutoTranslation;
    const detectedSourceLanguage = detectionUsable ? detectedLanguageTag(detected) : '';
    return { pageIsTargetLanguage, skipAutoTranslation, skipAutoTranslationIsLowConfidence, detectedSourceLanguage };
}
