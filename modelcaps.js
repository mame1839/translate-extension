const ANTHROPIC_MAX_OUTPUT_TOKENS = 64000;

const REASONING_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const GEMINI_NON_TEXT_MODEL_PATTERN = /-(image|tts|live|native-audio|embedding)|omni|transcribe|robotics|^gemma-/;
const GEMINI_LATEST_ALIAS_PATTERN = /^gemini-(flash-lite|flash|pro)-latest$/;
const GEMINI_MODEL_ID_PATTERN = /^gemini-(\d+)(?:\.(\d+))?-(flash-lite|flash|pro)/;

const OPENAI_NON_CHAT_MODEL_PATTERN = /-chat(-|$)|-pro(-|$)|codex|-cyber|^o1-mini/;
const OPENAI_GPT_MODEL_ID_PATTERN = /^gpt-(\d+)(?:\.(\d+))?/;
const OPENAI_O_SERIES_PATTERN = /^o[134](-|$)/;

const ANTHROPIC_MODEL_ID_PATTERN = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

const EXTRA_PARAM_RESERVED_KEYS = Object.freeze(['model', 'messages', 'stream', '__proto__']);

function createModelCaps(fields) {
    return {
        recognized: fields.recognized === true,
        mechanism: fields.mechanism || null,
        levels: Array.isArray(fields.levels) ? fields.levels.slice() : [],
        defaultLevel: fields.defaultLevel || '',
        budgets: fields.budgets || null,
        maxOutputTokens: Number.isFinite(fields.maxOutputTokens) ? fields.maxOutputTokens : null
    };
}

function modelCapsForGemini(id) {
    if (GEMINI_NON_TEXT_MODEL_PATTERN.test(id)) return createModelCaps({ recognized: true, maxOutputTokens: 65536 });
    const alias = GEMINI_LATEST_ALIAS_PATTERN.exec(id);
    const match = GEMINI_MODEL_ID_PATTERN.exec(id);
    if (!alias && !match) return createModelCaps({});
    const family = alias ? alias[1] : match[3];
    const major = alias ? 3 : parseInt(match[1], 10);
    const minor = alias || match[2] === undefined ? NaN : parseInt(match[2], 10);
    const known = { recognized: true, maxOutputTokens: 65536 };
    if (major >= 3) {
        const byLevel = Object.assign({ mechanism: 'thinkingLevel' }, known);
        if (family === 'pro') {
            return createModelCaps(Object.assign(byLevel, { levels: ['low', 'medium', 'high'], defaultLevel: alias ? '' : 'high' }));
        }
        if (family === 'flash-lite') {
            return createModelCaps(Object.assign(byLevel, { levels: ['minimal', 'low', 'medium', 'high'], defaultLevel: alias ? '' : 'minimal' }));
        }
        if (major === 3 && minor === 7) {
            return createModelCaps(Object.assign(byLevel, { levels: ['low', 'medium', 'high'], defaultLevel: 'medium' }));
        }
        let defaultLevel = '';
        if (!alias && major === 3) {
            if (minor === 5 || minor === 6) defaultLevel = 'medium';
            else if (Number.isNaN(minor)) defaultLevel = 'high';
        }
        return createModelCaps(Object.assign(byLevel, { levels: ['minimal', 'low', 'medium', 'high'], defaultLevel }));
    }
    if (major === 2 && minor === 5) {
        const byBudget = Object.assign({ mechanism: 'thinkingBudget' }, known);
        if (family === 'pro') {
            return createModelCaps(Object.assign(byBudget, {
                levels: ['low', 'medium', 'high'],
                defaultLevel: '',
                budgets: { low: 1024, medium: 8192, high: 32768 }
            }));
        }
        return createModelCaps(Object.assign(byBudget, {
            levels: ['off', 'low', 'medium', 'high'],
            defaultLevel: family === 'flash-lite' ? 'off' : '',
            budgets: { off: 0, low: 1024, medium: 8192, high: 24576 }
        }));
    }
    return createModelCaps(known);
}

function modelCapsForOpenAI(id) {
    if (OPENAI_NON_CHAT_MODEL_PATTERN.test(id)) return createModelCaps({ recognized: true });
    const gpt = OPENAI_GPT_MODEL_ID_PATTERN.exec(id);
    if (gpt) {
        const major = parseInt(gpt[1], 10);
        const minor = gpt[2] === undefined ? 0 : parseInt(gpt[2], 10);
        if (major < 5) return createModelCaps({ recognized: true });
        const byEffort = { recognized: true, mechanism: 'reasoningEffort' };
        if (major === 5 && minor === 0) {
            return createModelCaps(Object.assign(byEffort, { levels: ['minimal', 'low', 'medium', 'high'], defaultLevel: 'medium' }));
        }
        if (major === 5 && minor === 1) {
            return createModelCaps(Object.assign(byEffort, { levels: ['off', 'low', 'medium', 'high'], defaultLevel: 'off' }));
        }
        const levels = ['off', 'low', 'medium', 'high', 'xhigh'];
        if (major === 5 && minor <= 4) return createModelCaps(Object.assign(byEffort, { levels, defaultLevel: 'off' }));
        if (major === 5 && minor <= 6) return createModelCaps(Object.assign(byEffort, { levels, defaultLevel: 'medium' }));
        return createModelCaps(Object.assign(byEffort, { levels, defaultLevel: '' }));
    }
    if (OPENAI_O_SERIES_PATTERN.test(id)) {
        return createModelCaps({ recognized: true, mechanism: 'reasoningEffort', levels: ['low', 'medium', 'high'], defaultLevel: 'medium' });
    }
    return createModelCaps({});
}

function modelCapsForAnthropic(id) {
    const mythosPreview = id === 'claude-mythos-preview';
    const match = mythosPreview ? null : ANTHROPIC_MODEL_ID_PATTERN.exec(id);
    if (!match && !mythosPreview) return createModelCaps({});
    const family = mythosPreview ? 'mythos' : match[1];
    const alwaysThinking = family === 'fable' || family === 'mythos';
    const generation = mythosPreview
        ? 50
        : parseInt(match[2], 10) * 10 + (match[3] === undefined ? 0 : parseInt(match[3], 10));
    if (alwaysThinking || generation >= 47) {
        const levels = (alwaysThinking ? [] : ['off']).concat(['low', 'medium', 'high', 'xhigh', 'max']);
        return createModelCaps({
            recognized: true,
            mechanism: 'adaptiveEffort',
            levels,
            defaultLevel: alwaysThinking || generation >= 50 ? 'high' : 'off',
            maxOutputTokens: 128000
        });
    }
    if (generation === 46) {
        return createModelCaps({
            recognized: true,
            mechanism: 'adaptiveEffort',
            levels: ['off', 'low', 'medium', 'high', 'max'],
            defaultLevel: 'off',
            maxOutputTokens: 128000
        });
    }
    if (generation === 45) {
        return createModelCaps({
            recognized: true,
            mechanism: 'enabledBudget',
            levels: ['off', 'low', 'medium', 'high'],
            defaultLevel: 'off',
            budgets: { low: 1024, medium: 8192, high: 24576 },
            maxOutputTokens: 64000
        });
    }
    return createModelCaps({ recognized: true, maxOutputTokens: 64000 });
}

function modelCapsForCompatible() {
    return createModelCaps({ recognized: false, mechanism: 'passthrough', levels: REASONING_LEVELS, defaultLevel: '' });
}

function resolveModelCapabilities(provider, modelId) {
    const id = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
    if (provider === 'gemini') return modelCapsForGemini(id);
    if (provider === 'openai') return modelCapsForOpenAI(id);
    if (provider === 'anthropic') return modelCapsForAnthropic(id);
    if (provider === 'openai-compatible') return modelCapsForCompatible();
    return createModelCaps({});
}

function resolveReasoningLevel(stored, modelIsDefault, defaultLevel) {
    if (typeof stored === 'string') return stored;
    return modelIsDefault && typeof defaultLevel === 'string' ? defaultLevel : '';
}

function applyExtraParams(target, extras) {
    if (extras === undefined) return target;
    if (typeof extras !== 'object' || extras === null || Array.isArray(extras)) {
        throw new Error('extra parameters must be a JSON object');
    }
    for (const key of Object.keys(extras)) {
        if (EXTRA_PARAM_RESERVED_KEYS.includes(key)) throw new Error(`extra parameter "${key}" is reserved`);
        if (extras[key] === null) delete target[key];
        else target[key] = extras[key];
    }
    return target;
}

function geminiThinkingConfig(thinkingConfig, streamThoughtSummaries) {
    if (streamThoughtSummaries) thinkingConfig.includeThoughts = true;
    return { thinkingConfig };
}

function buildReasoningFields(caps, level, maxTokens, streaming) {
    if (!caps || typeof level !== 'string' || !level) return null;
    if (!caps.levels.includes(level)) return null;
    const streamThoughtSummaries = streaming === true && level !== 'off';
    switch (caps.mechanism) {
        case 'thinkingLevel':
            return geminiThinkingConfig({ thinkingLevel: level }, streamThoughtSummaries);
        case 'thinkingBudget':
            return geminiThinkingConfig({ thinkingBudget: caps.budgets[level] }, streamThoughtSummaries);
        case 'reasoningEffort':
        case 'passthrough':
            return { reasoning_effort: level === 'off' ? 'none' : level };
        case 'adaptiveEffort':
            if (level === 'off') return { thinking: { type: 'disabled' } };
            return { thinking: { type: 'adaptive', display: streamThoughtSummaries ? 'summarized' : 'omitted' }, output_config: { effort: level } };
        case 'enabledBudget': {
            if (level === 'off') return { thinking: { type: 'disabled' } };
            const room = Number.isFinite(maxTokens) ? Math.floor(maxTokens / 2) : Infinity;
            const budget = Math.min(caps.budgets[level], room);
            if (budget < 1024) return null;
            return { thinking: { type: 'enabled', budget_tokens: budget } };
        }
        default:
            return null;
    }
}
