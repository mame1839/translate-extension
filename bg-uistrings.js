const UI_STRINGS_BATCH_CHARS = 3000;

const UI_STRINGS_MIN_BATCH_CHARS = 300;

let customUiStringsRun = null;

let customUiStringsLastOutcome = null;

let customUiStringsWriteChain = Promise.resolve();

function isOptionsPageSender(sender) {
    try {
        return typeof sender?.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('options.html'));
    } catch (e) {
        return false;
    }
}

function customUiStringsStatus() {
    const run = customUiStringsRun;
    return {
        running: !!run,
        name: run ? run.name : '',
        done: run ? run.done : 0,
        total: run ? run.total : 0,
        outcome: customUiStringsLastOutcome
    };
}

function startCustomUiStringsGeneration(requestedName, scope) {
    if (customUiStringsRun) return Promise.resolve({ busy: true });
    const run = { name: normalizeCustomLanguageName(requestedName), done: 0, total: 0 };
    customUiStringsRun = run;
    return generateCustomUiStrings(run, scope === 'missing' ? 'missing' : 'all')
        .catch(error => createUiStringsOutcome(run, { error: describeUiStringsError(error) }))
        .then(outcome => {
            customUiStringsLastOutcome = outcome;
            if (customUiStringsRun === run) customUiStringsRun = null;
            return { outcome };
        });
}

function createUiStringsOutcome(run, fields) {
    return Object.assign({
        name: run.name,
        requested: run.total,
        translated: 0,
        rejected: 0,
        stopped: false,
        error: null,
        finishedAt: Date.now()
    }, fields);
}

function describeUiStringsError(error) {
    const message = typeof error?.message === 'string' && error.message ? error.message : errorMessages.unknownError;
    const code = resolveTranslationErrorCode(error, message);
    const base = code ? errorMessages[code] || '' : '';
    const suffix = base && message.startsWith(base) ? message.slice(base.length) : message;
    const detail = suffix.trim().replace(/^:\s*/, '').replace(/^\(([^()]*)\)$/, '$1').trim();
    return { code, detail: detail.slice(0, 300), fatal: isFatalTranslationErrorMessage(message) };
}

function readUiStringsSettings(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, items => resolve(items || {})));
}

async function customUiNameIsCurrent(name) {
    const { customTargetLanguage } = await readUiStringsSettings(['customTargetLanguage']);
    return normalizeCustomLanguageName(customTargetLanguage) === name;
}

function uiStringsBatchChars(maxToken) {
    const explicit = explicitOutputTokens(maxToken);
    if (explicit === null) return UI_STRINGS_BATCH_CHARS;
    return Math.max(UI_STRINGS_MIN_BATCH_CHARS, Math.min(UI_STRINGS_BATCH_CHARS, Math.floor(explicit / 2)));
}

function planUiStringBatches(keys, budget) {
    const batches = [];
    let current = [];
    let size = 0;
    for (const key of keys) {
        const length = key.length + TRANSLATIONS.en[key].length;
        if (current.length > 0 && size + length > budget) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(key);
        size += length;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

function createUiStringsPrompt(jsonPayload, languageName, customSections = '') {
    return `You are localizing the user interface of a browser extension that translates web pages with AI. Translate the English interface strings in the JSON below into **${languageName}**.

## Rules
1. Translate every value into natural ${languageName} as it would appear in a well-localized app: short labels stay short, sentences stay complete sentences, and the tone stays polite and neutral.
2. Return the same keys, one value per key. Do not add, remove, rename, or merge keys. The key names only tell you what each string is for.
3. Copy every placeholder in curly braces, such as {count}, {reason}, or {total}, exactly as written, braces included. Do not translate, drop, or duplicate a placeholder; move it to wherever the grammar of ${languageName} needs it.
4. Keep as written: product and company names (Chrome, Gemini, OpenAI, Anthropic, Claude, DeepSeek, OpenRouter, Ollama, vLLM, llama.cpp, Groq), technical identifiers and JSON such as reasoning_effort, temperature, max_tokens, model, messages, stream, {"top_p": 0.9}, true, and "0.7", the abbreviations API, ID, JSON, and URL, and http:// and https://.
5. Keep line breaks (\\n) exactly where the source has them.

${customSections}## Output format
Output a single JSON object and nothing else. It starts with { and ends with }, with no markdown fences, comments, or explanations. Escape double quotes and backslashes inside values as JSON requires.

## Input
${jsonPayload}`;
}

async function translateUiStringBatch(spec, settings, keys, name, customSections, retryLimit) {
    const payload = {};
    for (const key of keys) payload[key] = TRANSLATIONS.en[key];
    const prompt = createUiStringsPrompt(JSON.stringify(payload, null, 2), name, customSections);
    const parsed = await requestProviderJson(spec, settings, prompt, retryLimit, null, null);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function acceptedUiStrings(keys, translated) {
    const accepted = {};
    for (const key of keys) {
        const value = ownValue(translated, key);
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (acceptsGeneratedUiString(key, trimmed)) accepted[key] = trimmed;
    }
    return accepted;
}

function saveGeneratedUiStrings(name, accepted) {
    const write = customUiStringsWriteChain.then(async () => {
        const { customUiStrings } = await readUiStringsSettings(['customUiStrings']);
        const sameName = ownValue(customUiStrings, 'name') === name;
        const previousStrings = sameName ? ownValue(customUiStrings, 'strings') : null;
        const previousSources = sameName ? ownValue(customUiStrings, 'sources') : null;
        const strings = {};
        const sources = {};
        for (const key of generatableUiStringKeys()) {
            if (ownValue(accepted, key) !== undefined) {
                strings[key] = accepted[key];
                sources[key] = uiSourceFingerprint(TRANSLATIONS.en[key]);
            } else if (typeof ownValue(previousStrings, key) === 'string' && typeof ownValue(previousSources, key) === 'string') {
                strings[key] = previousStrings[key];
                sources[key] = previousSources[key];
            }
        }
        await chrome.storage.local.set({ customUiStrings: { name, strings, sources, savedAt: Date.now() } });
    });
    customUiStringsWriteChain = write.catch(() => { });
    return write;
}

async function generateCustomUiStrings(run, scope) {
    const name = run.name;
    if (!name) return createUiStringsOutcome(run, { error: describeUiStringsError(createTranslationError('targetLanguageNotSet')) });
    const items = await readUiStringsSettings(['customTargetLanguage', 'customUiStrings', 'apiProvider', 'maxRetries', 'concurrencyLimit', 'delayBetweenRequests']);
    if (normalizeCustomLanguageName(items.customTargetLanguage) !== name) return createUiStringsOutcome(run, { stopped: true });
    const { spec, settings } = await loadConfiguredProvider((items.apiProvider || DEFAULTS.apiProvider).trim());
    const existing = usableCustomUiStrings(name, items.customUiStrings);
    const keys = generatableUiStringKeys().filter(key => scope === 'all' || ownValue(existing.strings, key) === undefined);
    run.total = keys.length;
    if (keys.length === 0) return createUiStringsOutcome(run, {});
    const customSections = await getPromptCustomSections();
    const batches = planUiStringBatches(keys, uiStringsBatchChars(settings.maxToken));
    const retryLimit = items.maxRetries ?? DEFAULTS.maxRetries;
    const workerCount = Math.max(1, Math.min(items.concurrencyLimit || DEFAULTS.concurrencyLimit, batches.length));
    const delayMs = Math.max(0, items.delayBetweenRequests ?? DEFAULTS.delayBetweenRequests);
    const tally = { translated: 0, rejected: 0, stopped: false, error: null };
    const halted = () => tally.stopped || !!(tally.error && tally.error.fatal);
    const pacing = new AbortController();
    const wakeSleepingWorkersIfHalted = () => {
        if (halted() && !pacing.signal.aborted) pacing.abort();
    };
    let nextBatch = 0;
    let nextFireTime = Date.now();
    const worker = async () => {
        while (nextBatch < batches.length && !halted()) {
            const batch = batches[nextBatch++];
            const fireTime = Math.max(Date.now(), nextFireTime);
            nextFireTime = fireTime + delayMs;
            const waitMs = fireTime - Date.now();
            if (waitMs > 0) {
                try {
                    await sleep(waitMs, pacing.signal);
                } catch (e) {
                    break;
                }
            }
            if (halted()) break;
            if (!(await customUiNameIsCurrent(name))) {
                tally.stopped = true;
                wakeSleepingWorkersIfHalted();
                break;
            }
            try {
                const accepted = acceptedUiStrings(batch, await translateUiStringBatch(spec, settings, batch, name, customSections, retryLimit));
                const count = Object.keys(accepted).length;
                if (count > 0) await saveGeneratedUiStrings(name, accepted);
                tally.translated += count;
                tally.rejected += batch.length - count;
            } catch (error) {
                tally.rejected += batch.length;
                if (error?.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
                    nextFireTime = Math.max(nextFireTime, Date.now() + error.retryAfterMs);
                }
                const described = describeUiStringsError(error);
                if (!tally.error || (described.fatal && !tally.error.fatal)) tally.error = described;
                wakeSleepingWorkersIfHalted();
            }
            run.done += batch.length;
        }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    return createUiStringsOutcome(run, tally);
}
