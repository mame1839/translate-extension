const USAGE_STATS_KEY = 'usageStats';

const USAGE_FLUSH_DELAY_MS = 1500;

const pendingUsage = new Map();

let usageFlushTimer = null;

let usageWriteChain = Promise.resolve();

function toUsageCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function readUsageFromEnvelope(source) {
    if (!source || typeof source !== 'object') return null;
    const geminiUsage = source.usageMetadata;
    if (geminiUsage && typeof geminiUsage === 'object') {
        return {
            input: toUsageCount(geminiUsage.promptTokenCount),
            output: toUsageCount(geminiUsage.candidatesTokenCount) + toUsageCount(geminiUsage.thoughtsTokenCount)
        };
    }
    const usage = source.usage;
    if (usage && typeof usage === 'object') {
        return {
            input: toUsageCount(usage.prompt_tokens) + toUsageCount(usage.input_tokens),
            output: toUsageCount(usage.completion_tokens) + toUsageCount(usage.output_tokens)
        };
    }
    return null;
}

function readUsageTokens(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return readUsageFromEnvelope(payload) || readUsageFromEnvelope(payload.message);
}

function createUsageTokens() {
    return { input: 0, output: 0 };
}

function mergeMaxUsage(target, counts) {
    if (!target || !counts) return;
    if (counts.input > target.input) target.input = counts.input;
    if (counts.output > target.output) target.output = counts.output;
}

function createProviderUsage() {
    return { inputTokens: 0, outputTokens: 0, requests: 0 };
}

function recordApiUsage(provider, counts) {
    const name = (provider || DEFAULTS.apiProvider).trim();
    if (!name) return;
    let entry = pendingUsage.get(name);
    if (!entry) {
        entry = createProviderUsage();
        pendingUsage.set(name, entry);
    }
    entry.requests += 1;
    if (counts) {
        entry.inputTokens += toUsageCount(counts.input);
        entry.outputTokens += toUsageCount(counts.output);
    }
    scheduleUsageFlush();
}

function scheduleUsageFlush() {
    if (usageFlushTimer !== null) return;
    usageFlushTimer = setTimeout(() => {
        usageFlushTimer = null;
        flushPendingUsage();
    }, USAGE_FLUSH_DELAY_MS);
}

function flushPendingUsage() {
    if (pendingUsage.size === 0) return usageWriteChain;
    const delta = new Map(pendingUsage);
    pendingUsage.clear();
    usageWriteChain = usageWriteChain.then(() => storeUsageDelta(delta)).catch(() => { });
    return usageWriteChain;
}

function createUsageStats() {
    return { since: 0, updatedAt: 0, providers: {} };
}

function normalizeUsageStats(raw) {
    const stats = createUsageStats();
    if (!raw || typeof raw !== 'object') return stats;
    stats.since = toUsageCount(raw.since);
    stats.updatedAt = toUsageCount(raw.updatedAt);
    if (!raw.providers || typeof raw.providers !== 'object') return stats;
    for (const [name, entry] of Object.entries(raw.providers)) {
        if (!entry || typeof entry !== 'object') continue;
        stats.providers[name] = {
            inputTokens: toUsageCount(entry.inputTokens),
            outputTokens: toUsageCount(entry.outputTokens),
            requests: toUsageCount(entry.requests)
        };
    }
    return stats;
}

function readStoredUsageStats() {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get([USAGE_STATS_KEY], items => {
                void chrome.runtime.lastError;
                resolve(normalizeUsageStats(items && items[USAGE_STATS_KEY]));
            });
        } catch (e) { resolve(createUsageStats()); }
    });
}

function writeUsageStats(stats) {
    return new Promise(resolve => {
        try {
            chrome.storage.local.set({ [USAGE_STATS_KEY]: stats }, () => {
                void chrome.runtime.lastError;
                resolve();
            });
        } catch (e) { resolve(); }
    });
}

async function storeUsageDelta(delta) {
    const stats = await readStoredUsageStats();
    const now = Date.now();
    for (const [name, entry] of delta) {
        const target = stats.providers[name] || createProviderUsage();
        target.inputTokens += entry.inputTokens;
        target.outputTokens += entry.outputTokens;
        target.requests += entry.requests;
        stats.providers[name] = target;
    }
    if (!stats.since) stats.since = now;
    stats.updatedAt = now;
    await writeUsageStats(stats);
}

async function getUsageStatsSnapshot() {
    await flushPendingUsage();
    return readStoredUsageStats();
}

async function resetUsageStats() {
    if (usageFlushTimer !== null) {
        clearTimeout(usageFlushTimer);
        usageFlushTimer = null;
    }
    pendingUsage.clear();
    const cleared = createUsageStats();
    usageWriteChain = usageWriteChain.then(() => writeUsageStats(cleared)).catch(() => { });
    await usageWriteChain;
    return cleared;
}
