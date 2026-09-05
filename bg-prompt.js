const PROMPT_EXAMPLE_OUTPUTS = {
    en: {
        anchorWithPreposition: '<t0><a1>Siverek</a1></t0> and <t2><a3>Onikişubat</a3></t2> shootings leave 12 dead.',
        anchorAtSentenceStart: 'Click <a0>here</a0> to see <t1>our products</t1>.',
        inlineLinks: 'Read our <a0>Terms</a0> and <a1>Privacy Policy</a1>.',
        nestedEmphasisAnchor: 'See the <t0>official <a1>documentation</a1></t0>.',
        disappearingArticle: 'Read <t0></t0><t1>the guide</t1>.',
        blockAndSkipPlaceholders: 'Overview <b0></b0> See the <s1></s1> icon.'
    },
    zh: {
        anchorWithPreposition: '<t0><a1>锡韦雷克</a1></t0>和<t2><a3>奥尼基舒巴特</a3></t2>的枪击事件造成12人死亡。',
        anchorAtSentenceStart: '点击<a0>此处</a0>查看<t1>我们的产品</t1>。',
        inlineLinks: '请阅读我们的<a0>服务条款</a0>和<a1>隐私政策</a1>。',
        nestedEmphasisAnchor: '请参阅<t0>官方<a1>文档</a1></t0>。',
        disappearingArticle: '请阅读<t0></t0><t1>指南</t1>。',
        blockAndSkipPlaceholders: '概述 <b0></b0> 参见<s1></s1>图标。'
    },
    'zh-Hant': {
        anchorWithPreposition: '<t0><a1>錫韋雷克</a1></t0>和<t2><a3>奧尼基舒巴特</a3></t2>的槍擊事件造成12人死亡。',
        anchorAtSentenceStart: '點擊<a0>這裡</a0>查看<t1>我們的產品</t1>。',
        inlineLinks: '請閱讀我們的<a0>服務條款</a0>和<a1>隱私權政策</a1>。',
        nestedEmphasisAnchor: '請參閱<t0>官方<a1>文件</a1></t0>。',
        disappearingArticle: '請閱讀<t0></t0><t1>指南</t1>。',
        blockAndSkipPlaceholders: '概覽 <b0></b0> 請參閱<s1></s1>圖示。'
    },
    hi: {
        anchorWithPreposition: '<t0><a1>सिवेरेक</a1></t0> और <t2><a3>ओनिकिशुबात</a3></t2> में गोलीबारी से 12 लोगों की मौत।',
        anchorAtSentenceStart: '<t1>हमारे उत्पाद</t1> देखने के लिए <a0>यहाँ</a0> क्लिक करें।',
        inlineLinks: 'कृपया हमारी <a0>शर्तें</a0> और <a1>गोपनीयता नीति</a1> पढ़ें।',
        nestedEmphasisAnchor: '<t0>आधिकारिक <a1>दस्तावेज़</a1></t0> देखें।',
        disappearingArticle: '<t0></t0><t1>गाइड</t1> पढ़ें।',
        blockAndSkipPlaceholders: 'अवलोकन <b0></b0> <s1></s1> आइकन देखें।'
    },
    es: {
        anchorWithPreposition: 'Tiroteos en <t0><a1>Siverek</a1></t0> y en <t2><a3>Onikişubat</a3></t2> dejan 12 muertos.',
        anchorAtSentenceStart: 'Haga clic <a0>aquí</a0> para ver <t1>nuestros productos</t1>.',
        inlineLinks: 'Lea nuestros <a0>Términos</a0> y nuestra <a1>Política de privacidad</a1>.',
        nestedEmphasisAnchor: 'Consulte la <t0><a1>documentación</a1> oficial</t0>.',
        disappearingArticle: 'Lea <t0></t0><t1>la guía</t1>.',
        blockAndSkipPlaceholders: 'Resumen <b0></b0> Vea el icono <s1></s1>.'
    },
    fr: {
        anchorWithPreposition: 'Des fusillades à <t0><a1>Siverek</a1></t0> et à <t2><a3>Onikişubat</a3></t2> font 12 morts.',
        anchorAtSentenceStart: 'Cliquez <a0>ici</a0> pour voir <t1>nos produits</t1>.',
        inlineLinks: 'Lisez nos <a0>Conditions</a0> et notre <a1>Politique de confidentialité</a1>.',
        nestedEmphasisAnchor: 'Consultez la <t0><a1>documentation</a1> officielle</t0>.',
        disappearingArticle: 'Lisez <t0></t0><t1>le guide</t1>.',
        blockAndSkipPlaceholders: 'Aperçu <b0></b0> Voir l\'icône <s1></s1>.'
    },
    ar: {
        anchorWithPreposition: 'إطلاق نار في <t0><a1>سيفيريك</a1></t0> و<t2><a3>أونيكيشوبات</a3></t2> يسفر عن مقتل 12 شخصًا.',
        anchorAtSentenceStart: 'انقر <a0>هنا</a0> لعرض <t1>منتجاتنا</t1>.',
        inlineLinks: 'يرجى قراءة <a0>الشروط</a0> و<a1>سياسة الخصوصية</a1>.',
        nestedEmphasisAnchor: 'راجع <t0><a1>الوثائق</a1> الرسمية</t0>.',
        disappearingArticle: 'اقرأ <t0></t0><t1>الدليل</t1>.',
        blockAndSkipPlaceholders: 'نظرة عامة <b0></b0> راجع أيقونة <s1></s1>.'
    },
    bn: {
        anchorWithPreposition: '<t0><a1>সিভেরেক</a1></t0> এবং <t2><a3>ওনিকিশুবাত</a3></t2>-এ গুলিবর্ষণে 12 জন নিহত।',
        anchorAtSentenceStart: '<t1>আমাদের পণ্য</t1> দেখতে <a0>এখানে</a0> ক্লিক করুন।',
        inlineLinks: 'অনুগ্রহ করে আমাদের <a0>শর্তাবলী</a0> এবং <a1>গোপনীয়তা নীতি</a1> পড়ুন।',
        nestedEmphasisAnchor: '<t0>অফিসিয়াল <a1>ডকুমেন্টেশন</a1></t0> দেখুন।',
        disappearingArticle: '<t0></t0><t1>গাইড</t1> পড়ুন।',
        blockAndSkipPlaceholders: 'সংক্ষিপ্ত বিবরণ <b0></b0> <s1></s1> আইকন দেখুন।'
    },
    ru: {
        anchorWithPreposition: 'Перестрелки в <t0><a1>Сивереке</a1></t0> и <t2><a3>Оникишубате</a3></t2> унесли жизни 12 человек.',
        anchorAtSentenceStart: 'Нажмите <a0>здесь</a0>, чтобы посмотреть <t1>наши продукты</t1>.',
        inlineLinks: 'Ознакомьтесь с нашими <a0>Условиями</a0> и <a1>Политикой конфиденциальности</a1>.',
        nestedEmphasisAnchor: 'См. <t0>официальную <a1>документацию</a1></t0>.',
        disappearingArticle: 'Прочитайте <t0></t0><t1>руководство</t1>.',
        blockAndSkipPlaceholders: 'Обзор <b0></b0> См. значок <s1></s1>.'
    },
    pt: {
        anchorWithPreposition: 'Tiroteios em <t0><a1>Siverek</a1></t0> e em <t2><a3>Onikişubat</a3></t2> deixam 12 mortos.',
        anchorAtSentenceStart: 'Clique <a0>aqui</a0> para ver <t1>nossos produtos</t1>.',
        inlineLinks: 'Leia nossos <a0>Termos</a0> e nossa <a1>Política de Privacidade</a1>.',
        nestedEmphasisAnchor: 'Consulte a <t0><a1>documentação</a1> oficial</t0>.',
        disappearingArticle: 'Leia <t0></t0><t1>o guia</t1>.',
        blockAndSkipPlaceholders: 'Visão geral <b0></b0> Veja o ícone <s1></s1>.'
    },
    ur: {
        anchorWithPreposition: '<t0><a1>سیوریک</a1></t0> اور <t2><a3>اونیکی شوبات</a3></t2> میں فائرنگ سے 12 افراد ہلاک۔',
        anchorAtSentenceStart: '<t1>ہماری مصنوعات</t1> دیکھنے کے لیے <a0>یہاں</a0> کلک کریں۔',
        inlineLinks: 'براہ کرم ہماری <a0>شرائط</a0> اور <a1>رازداری کی پالیسی</a1> پڑھیں۔',
        nestedEmphasisAnchor: '<t0>رسمی <a1>دستاویزات</a1></t0> دیکھیں۔',
        disappearingArticle: '<t0></t0><t1>گائیڈ</t1> پڑھیں۔',
        blockAndSkipPlaceholders: 'جائزہ <b0></b0> <s1></s1> آئیکن دیکھیں۔'
    },
    id: {
        anchorWithPreposition: 'Penembakan di <t0><a1>Siverek</a1></t0> dan di <t2><a3>Onikişubat</a3></t2> menewaskan 12 orang.',
        anchorAtSentenceStart: 'Klik <a0>di sini</a0> untuk melihat <t1>produk kami</t1>.',
        inlineLinks: 'Harap baca <a0>Ketentuan</a0> dan <a1>Kebijakan Privasi</a1> kami.',
        nestedEmphasisAnchor: 'Lihat <t0><a1>dokumentasi</a1> resmi</t0>.',
        disappearingArticle: 'Baca <t0></t0><t1>panduan</t1>.',
        blockAndSkipPlaceholders: 'Ikhtisar <b0></b0> Lihat ikon <s1></s1>.'
    },
    de: {
        anchorWithPreposition: 'Schießereien in <t0><a1>Siverek</a1></t0> und <t2><a3>Onikişubat</a3></t2> fordern 12 Todesopfer.',
        anchorAtSentenceStart: 'Klicken Sie <a0>hier</a0>, um <t1>unsere Produkte</t1> zu sehen.',
        inlineLinks: 'Bitte lesen Sie unsere <a0>Nutzungsbedingungen</a0> und unsere <a1>Datenschutzerklärung</a1>.',
        nestedEmphasisAnchor: 'Siehe die <t0>offizielle <a1>Dokumentation</a1></t0>.',
        disappearingArticle: 'Lesen Sie <t0></t0><t1>den Leitfaden</t1>.',
        blockAndSkipPlaceholders: 'Überblick <b0></b0> Siehe das <s1></s1>-Symbol.'
    },
    ja: {
        anchorWithPreposition: '<t0><a1>シヴェレク</a1></t0>と<t2><a3>オニキシュバト</a3></t2>での銃撃事件で12人が死亡。',
        anchorAtSentenceStart: '<t1>製品</t1>を見るには<a0>こちら</a0>をクリック。',
        inlineLinks: '<a0>利用規約</a0>と<a1>プライバシーポリシー</a1>をお読みください。',
        nestedEmphasisAnchor: '<t0>公式<a1>ドキュメント</a1></t0>を参照。',
        disappearingArticle: '<t0></t0><t1>ガイド</t1>をお読みください。',
        blockAndSkipPlaceholders: '概要 <b0></b0> <s1></s1>アイコンを参照。'
    },
    sw: {
        anchorWithPreposition: 'Watu 12 wameuawa katika milio ya risasi huko <t0><a1>Siverek</a1></t0> na <t2><a3>Onikişubat</a3></t2>.',
        anchorAtSentenceStart: 'Bofya <a0>hapa</a0> ili kuona <t1>bidhaa zetu</t1>.',
        inlineLinks: 'Tafadhali soma <a0>Masharti</a0> yetu na <a1>Sera ya Faragha</a1>.',
        nestedEmphasisAnchor: 'Tazama <t0><a1>nyaraka</a1> rasmi</t0>.',
        disappearingArticle: 'Soma <t0></t0><t1>mwongozo</t1>.',
        blockAndSkipPlaceholders: 'Muhtasari <b0></b0> Tazama ikoni <s1></s1>.'
    },
    mr: {
        anchorWithPreposition: '<t0><a1>सिवेरेक</a1></t0> आणि <t2><a3>ओनिकिशुबात</a3></t2> येथील गोळीबारात 12 जणांचा मृत्यू.',
        anchorAtSentenceStart: '<t1>आमची उत्पादने</t1> पाहण्यासाठी <a0>येथे</a0> क्लिक करा.',
        inlineLinks: 'कृपया आमच्या <a0>अटी</a0> आणि <a1>गोपनीयता धोरण</a1> वाचा.',
        nestedEmphasisAnchor: '<t0>अधिकृत <a1>दस्तऐवज</a1></t0> पहा.',
        disappearingArticle: '<t0></t0><t1>मार्गदर्शिका</t1> वाचा.',
        blockAndSkipPlaceholders: 'आढावा <b0></b0> <s1></s1> आयकॉन पहा.'
    },
    te: {
        anchorWithPreposition: '<t0><a1>సివెరెక్</a1></t0> మరియు <t2><a3>ఒనికిషుబాత్</a3></t2>లలో జరిగిన కాల్పుల్లో 12 మంది మరణించారు.',
        anchorAtSentenceStart: '<t1>మా ఉత్పత్తులను</t1> చూడటానికి <a0>ఇక్కడ</a0> క్లిక్ చేయండి.',
        inlineLinks: 'దయచేసి మా <a0>నియమాలను</a0> మరియు <a1>గోప్యతా విధానాన్ని</a1> చదవండి.',
        nestedEmphasisAnchor: '<t0>అధికారిక <a1>డాక్యుమెంటేషన్</a1></t0> చూడండి.',
        disappearingArticle: '<t0></t0><t1>గైడ్</t1> చదవండి.',
        blockAndSkipPlaceholders: 'అవలోకనం <b0></b0> <s1></s1> చిహ్నాన్ని చూడండి.'
    },
    tr: {
        anchorWithPreposition: '<t0><a1>Siverek</a1></t0> ve <t2><a3>Onikişubat</a3></t2>\'taki silahlı saldırılarda 12 kişi hayatını kaybetti.',
        anchorAtSentenceStart: '<t1>Ürünlerimizi</t1> görmek için <a0>buraya</a0> tıklayın.',
        inlineLinks: 'Lütfen <a0>Şartlarımızı</a0> ve <a1>Gizlilik Politikamızı</a1> okuyun.',
        nestedEmphasisAnchor: '<t0>Resmi <a1>belgelere</a1></t0> bakın.',
        disappearingArticle: '<t0></t0><t1>Kılavuzu</t1> okuyun.',
        blockAndSkipPlaceholders: 'Genel bakış <b0></b0> <s1></s1> simgesine bakın.'
    },
    ta: {
        anchorWithPreposition: '<t0><a1>சிவெரெக்</a1></t0> மற்றும் <t2><a3>ஒனிகிஷுபாத்</a3></t2> ஆகிய இடங்களில் நடந்த துப்பாக்கிச் சூட்டில் 12 பேர் உயிரிழந்தனர்.',
        anchorAtSentenceStart: '<t1>எங்கள் தயாரிப்புகளை</t1> பார்க்க <a0>இங்கே</a0> கிளிக் செய்யவும்.',
        inlineLinks: 'எங்கள் <a0>விதிமுறைகள்</a0> மற்றும் <a1>தனியுரிமைக் கொள்கை</a1> ஆகியவற்றைப் படிக்கவும்.',
        nestedEmphasisAnchor: '<t0>அதிகாரப்பூர்வ <a1>ஆவணங்களை</a1></t0> பார்க்கவும்.',
        disappearingArticle: '<t0></t0><t1>வழிகாட்டியைப்</t1> படிக்கவும்.',
        blockAndSkipPlaceholders: 'மேலோட்டம் <b0></b0> <s1></s1> ஐகானைப் பார்க்கவும்.'
    },
    vi: {
        anchorWithPreposition: 'Các vụ xả súng ở <t0><a1>Siverek</a1></t0> và <t2><a3>Onikişubat</a3></t2> khiến 12 người thiệt mạng.',
        anchorAtSentenceStart: 'Nhấp <a0>vào đây</a0> để xem <t1>sản phẩm của chúng tôi</t1>.',
        inlineLinks: 'Vui lòng đọc <a0>Điều khoản</a0> và <a1>Chính sách quyền riêng tư</a1> của chúng tôi.',
        nestedEmphasisAnchor: 'Xem <t0><a1>tài liệu</a1> chính thức</t0>.',
        disappearingArticle: 'Đọc <t0></t0><t1>hướng dẫn</t1>.',
        blockAndSkipPlaceholders: 'Tổng quan <b0></b0> Xem biểu tượng <s1></s1>.'
    },
    ko: {
        anchorWithPreposition: '<t0><a1>시베레크</a1></t0>와 <t2><a3>오니키슈바트</a3></t2>에서 발생한 총격으로 12명이 사망했다.',
        anchorAtSentenceStart: '<t1>제품</t1>을 보려면 <a0>여기</a0>를 클릭하세요.',
        inlineLinks: '<a0>이용약관</a0>과 <a1>개인정보처리방침</a1>을 읽어 주세요.',
        nestedEmphasisAnchor: '<t0>공식 <a1>문서</a1></t0>를 참조하세요.',
        disappearingArticle: '<t0></t0><t1>가이드</t1>를 읽어 주세요.',
        blockAndSkipPlaceholders: '개요 <b0></b0> <s1></s1> 아이콘을 참조하세요.'
    }
};

const STYLE_PROMPT_LINES = Object.freeze({
    formal: '- Regardless of the source register, write the translation in a consistently polite, formal register suitable for business and official documents.',
    casual: '- Regardless of the source register, write the translation in a relaxed, friendly, conversational register.',
    technical: '- Regardless of the source register, write the translation in precise, concise technical-documentation style with consistent terminology.'
});

function parseGlossaryPairs(glossaryText) {
    const pairs = new Map();
    if (typeof glossaryText !== 'string') return pairs;
    for (const line of glossaryText.split(/\r?\n/)) {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex < 0) continue;
        const source = line.slice(0, separatorIndex).trim();
        const target = line.slice(separatorIndex + 1).trim();
        if (source && target) pairs.set(source, target);
    }
    return pairs;
}

function buildGlossarySection(glossaryText) {
    const pairs = parseGlossaryPairs(glossaryText);
    if (pairs.size === 0) return '';
    const entryLines = [];
    for (const [source, target] of pairs) {
        entryLines.push(source === target
            ? `- "${source}" → keep "${source}" untranslated`
            : `- "${source}" → "${target}"`);
    }
    return `## Glossary (must follow)\nWhenever a source term below appears, render it exactly as the specified target form, adapting only inflection where the grammar of the target language requires it:\n${entryLines.join('\n')}`;
}

function buildStyleSection(translationStyle, customInstruction) {
    const styleLines = [];
    const presetLine = STYLE_PROMPT_LINES[translationStyle];
    if (typeof presetLine === 'string') styleLines.push(presetLine);
    const instruction = typeof customInstruction === 'string' ? customInstruction.replace(/\s+/g, ' ').trim() : '';
    if (instruction) styleLines.push(`- Additional instruction from the user (it never overrides the placeholder and output format rules): ${instruction}`);
    if (styleLines.length === 0) return '';
    return `## Style\n${styleLines.join('\n')}`;
}

function buildPromptCustomSections(translationStyle, customInstruction, glossaryText) {
    const sections = [buildGlossarySection(glossaryText), buildStyleSection(translationStyle, customInstruction)].filter(Boolean);
    if (sections.length === 0) return '';
    return sections.join('\n\n') + '\n\n';
}

async function getPromptCustomSections() {
    const { translationStyle, customInstruction, glossaryText } = await new Promise(resolve =>
        chrome.storage.local.get(['translationStyle', 'customInstruction', 'glossaryText'], resolve));
    return buildPromptCustomSections(translationStyle, customInstruction, glossaryText);
}

function createTranslationPrompt(jsonPayload, targetLanguage, targetLanguageCode, customSections = '') {
    const localizedExamples = PROMPT_EXAMPLE_OUTPUTS[targetLanguageCode];
    const exampleOutputs = localizedExamples || PROMPT_EXAMPLE_OUTPUTS.ja;
    const exampleLanguageNote = localizedExamples
        ? `All examples below show output in **${targetLanguage}**. Your output must also be in **${targetLanguage}**.`
        : `Note: the examples below use Japanese output only to illustrate placeholder structure rules. Your output must be in **${targetLanguage}**.`;
    return `You are an elite translation engine. Translate the provided JSON into fluent, natural **${targetLanguage}** that reads as if originally written by a native speaker, preserving the source meaning, tone, and nuance.

## Input Format
A single JSON object. Each key is a Translation Unit ID (e.g., "TU_0"). Each value is a string of source text interleaved with XML-like placeholder tags. Placeholders use a type prefix (a / t / b / s) followed by a numeric ID that is UNIQUE within the TU:

- \`<aN>...</aN>\` — **ANCHOR (hyperlink) placeholder.** The content inside is the clickable link text. It MUST remain a meaningful noun phrase that makes sense as a hyperlink label. NEVER reduce it to only particles, conjunctions, or grammatical markers; those belong OUTSIDE the tag. Prepositions in the source (in/at/of/for…) typically migrate outside the anchor as the target language's equivalent connective.
- \`<tN>...</tN>\` — paired placeholder for other inline elements (emphasis, bold, italic, span, code, etc.). Translate the inner content naturally. Reorder freely within the sentence.
- \`<bN></bN>\` — empty block placeholder. Represents a child block element translated separately. Preserve verbatim.
- \`<sN></sN>\` — empty skip placeholder. Represents non-translatable content. Preserve verbatim.

Any other characters (including HTML entities like \`&amp;\`, \`&lt;\`, \`&quot;\`) must be preserved as written.

## Translation Rules

1. **Fluency first** — Produce natural, idiomatic ${targetLanguage}. Prefer meaning-based translation over literal when literal would sound unnatural.
2. **Register** — Match the style of the source: formal prose stays formal, UI labels use concise imperative or nominal style, marketing copy uses engaging tone.
3. **Reorder freely** — Word order varies by language. Move placeholders wherever they fit best in ${targetLanguage}.
4. **Preserve every placeholder** — Every \`<aN>\`, \`<tN>\`, \`<bN>\`, \`<sN>\` in the input must appear exactly once in the output (same tag name, same ID). Never drop, duplicate, merge, rename, or swap IDs.
5. **Anchor content integrity (CRITICAL)** — The content inside \`<aN>...</aN>\` must remain a standalone meaningful referent. Do NOT place only grammatical particles, conjunctions, or auxiliary words inside an anchor; those go outside.
6. **Empty content** — Inside \`<tN>\`, if the wrapped content naturally disappears in ${targetLanguage} (e.g., articles), output \`<tN></tN>\`. Do NOT empty \`<aN>\` unless the source anchor was truly empty.
7. **Preserve nesting** — \`<t0>outer <a1>inner</a1> outer</t0>\` must remain nested with both tags intact.
8. **Translate nouns by default** — Personal names, place names, organization names, titles of works, and ordinary nouns are rendered the way ${targetLanguage} normally renders them: translated, or transliterated into the target script when that is the conventional form (Japanese katakana, Cyrillic or Chinese transcription, and so on). Do not leave a noun in the source language merely because it is a proper noun.
9. **Keep as written only in these cases** — (a) content that must not be translated: code identifiers, URLs, email addresses, file paths, numbers, currency symbols, HTML entities, and brand or product names used as such (for example "iPhone", "GitHub"); (b) terms whose translation would change the meaning or break a reference the reader has to match, such as an on-screen UI label, a command name, or a cited title in its official form; (c) names and abbreviations that readers of ${targetLanguage} conventionally see in the source language (for example "API", "NASA"). For a technical term, use the established ${targetLanguage} term when one exists, and otherwise the established loanword form written in the target language's own script.
10. **Do NOT add, summarize, explain, or annotate** — Output translation only.

## Output Format (STRICT — must be machine-parseable)

Return EXACTLY one JSON object and nothing else. Your entire response must satisfy ALL of:

- The very first character is \`{\`. The very last character is \`}\`. No leading or trailing whitespace, prose, comments, or extra characters.
- The closing \`}\` that balances the opening \`{\` is the FINAL character of the response. Never emit a second JSON object, a follow-up explanation, an apology, or any text after that \`}\`.
- Never wrap the response in markdown fences (\`\`\`json, \`\`\`, etc.) or HTML.
- Same keys as the input, exactly. Do not add, rename, omit, reorder, or duplicate keys.
- Each value is a JSON string containing the translation with all required placeholders preserved.

Inside every string value, you MUST produce valid JSON string syntax:

- Escape every literal \`"\` as \`\\"\`.
- Escape every literal \`\\\` as \`\\\\\`.
- Escape line breaks as \`\\n\` (or \`\\r\\n\`). Never emit a raw newline, carriage return, or tab inside a string value.
- Do not emit any other raw control character (U+0000–U+001F). Use \`\\uXXXX\` if absolutely necessary.
- The placeholder tags (\`<aN>\`, \`<tN>\`, \`<bN>\`, \`<sN>\`) are plain ASCII and do NOT need escaping; emit them verbatim inside the string.

If you cannot translate a value, still emit a syntactically valid JSON string for that key (e.g. the original text wrapped in valid quotes). Never omit a key.

## Examples
${exampleLanguageNote}

### Example 1 — anchor with preposition
Input:  {"TU_0":"Shootings <t0><a1>in Siverek</a1></t0> and <t2><a3>in Onikişubat</a3></t2> leave 12 dead."}
Output: {"TU_0":"${exampleOutputs.anchorWithPreposition}"}
(Place names stay inside anchors; prepositions move outside.)

### Example 2 — anchor at sentence start
Input:  {"TU_0":"<a0>Click here</a0> to see <t1>our products</t1>."}
Output: {"TU_0":"${exampleOutputs.anchorAtSentenceStart}"}

### Example 3 — inline links
Input:  {"TU_0":"Read our <a0>Terms</a0> and <a1>Privacy Policy</a1>."}
Output: {"TU_0":"${exampleOutputs.inlineLinks}"}

### Example 4 — nested emphasis + anchor
Input:  {"TU_0":"See the <t0>official <a1>documentation</a1></t0>."}
Output: {"TU_0":"${exampleOutputs.nestedEmphasisAnchor}"}

### Example 5 — disappearing article
Input:  {"TU_0":"Read <t0>the</t0> <t1>guide</t1>."}
Output: {"TU_0":"${exampleOutputs.disappearingArticle}"}

### Example 6 — block and skip placeholders
Input:  {"TU_0":"Overview <b0></b0> See the <s1></s1> icon."}
Output: {"TU_0":"${exampleOutputs.blockAndSkipPlaceholders}"}

${customSections}## Input JSON
${jsonPayload}`;
}
