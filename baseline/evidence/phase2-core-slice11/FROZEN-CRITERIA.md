# CP-19 — الاختبار التوصيفي لـ `fullAgentPrompt` — معايير القبول المجمَّدة (تقرير مؤقت خارج المستودع)

كُتب هذا الملف **قبل** أي ملف اختبار أو سكربت طفرات أو تشغيل. أي تغيير لاحق في المعايير يُسجَّل في قسم «سجل الانحرافات» أدناه مع السبب، ولا يُخفَّف أي معيار بعد رؤية النتائج.

## 0) النطاق والحدود (من تفويض المالك)
- ملف E2E **واحد** جديد في المستودع: `e2e/phase2-core-slice11-context-characterization-flows.mjs`. لا تعديل لأي ملف موجود (إنتاج/إعدادات/اختبارات/اعتماديات/Git).
- الاختبار يُنفَّذ من **نسخة معزولة** (`scratchpad/CP19/iso/nexus-v5`) وبقراءة frontend من مسار قابل للتوجيه بـ`NEXUS_FRONTEND_DIR`. نتائجه تُكتب خارج المستودع حصرًا (`NEXUS_S11_RESULTS`، الافتراضي `os.tmpdir()`).
- سكربت الطفرات وسجلاتها وهذا التقرير **خارج المستودع** (لا يُضاف إليه ملف ثانٍ).
- كل الشبكة مُعترَضة بـ`context.route('**/*')` + `serviceWorkers:'block'`: الأصل `https://nexus.test` يُخدَّم من الملفات، والخلفية الوهمية `https://backend.test` بنقطتين فقط (`POST /api/embed`، `GET /api/market-context`)، وكل ما عدا ذلك يُجهَض أو يُرجَع 404. لا نموذج حي ولا خدمة خارجية.
- الساعة مثبّتة بـ`page.clock.setFixedTime('2026-10-14T12:00:00.000Z')` (تبقى المؤقّتات تعمل)، و`timezoneId:'UTC'`، و`locale:'en-US'`.
- ممنوع: تحديث وثائق الحالة، commit/ZIP، نقل `NexusContext`/`ContextFabric`، معالجة `sw.js` أو E-1.
- حالات النتيجة: VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED فقط.

## 1) الهدف المُختبَر
السلوك **الحالي** لـ`fullAgentPrompt(agent, queryText)` = `agent.prompt + (await ContextFabric.build(agent, queryText)).text`، ولما تستدعيه: `NexusContext._safe`، `agentKnowledgeContext`، `retrieveLongTermMemoryContext`، `fileDocsContext`، `getMarketContext`، `NexusIntentEngine.analyze`، `PromptInjectionGuard.fence`، `ExecutionCheckpoint.peek`. هذا توصيف لا حكم بصحة السلوك.

حقائق مقروءة من الكود (قبل التجميد) تحكم التصميم:
1. `fullAgentPrompt` تستدعي `build(agent, queryText)` **دون opts** ⇒ فرع `taskId` غير قابل للوصول عبرها؛ يُوصَّف عبر `ContextFabric.build(agent,q,{taskId})` مباشرة (موسوم `[build]`).
2. `wantsMemoryAndFiles = requiredEvidence || complexity!=='low' || freshness!=='static'`؛ و`analyze` يجعل `requiredEvidence = risk!=='low' || freshness!=='static' || intent∈{analyze,compare}` ⇒ شرط `freshness` مشمول منطقيًا عبر `fullAgentPrompt`؛ لا يُعزل إلا بتمرير `opts.intent` صريح إلى `build`.
3. سياق السوق: `agent.id==='financial' && (freshness!=='static' || domain==='business')`؛ و`financial`∈نطاق `business` ⇒ لعزل شرط الحداثة نختار `selectedAgentIds=['tech']` (نطاق `tech`) والوكيل الممرَّر `id:'financial'`.
4. ثوابت العتبات: ذاكرة طويلة المدى `score > 0.72` (صارمة) وtopK=3؛ ملفات `topK=3, minScore=0.15`؛ معرفة الوكيل topK=3.
5. تنسيق `fence(label,text)`: `\n\n--- {label} (بيانات خارجية) ---\n{text}\n--- نهاية {label} ---` (نص فارغ ⇒ `''`).
6. الذاكرة طويلة المدى **غير** محاطة بـfence داخل `ContextFabric`؛ معرفة الوكيل محاطة داخل `agentKnowledgeContext`؛ الملفات والسوق محاطان داخل `ContextFabric`.

## 2) تصنيف الفحوص وقاعدة الحكم
- **VALID**: صلاحية القياس/الضوابط؛ فشل أيٌّ منها ⇒ `S11-VERDICT = INVALID` (لا أحكام على PRES).
- **PRES**: سلوك حالي محفوظ؛ يجب أن ينجح كله على الشجرة غير المطفَّرة، وإلا `REJECTED` (أو يُصنَّف عيب اختبار إن ثبت أنه خطأ توقع مني — انظر §7).
- لا PS (لا تغيير إنتاجي). الحكم النهائي: `ACCEPTED` (كل VALID وPRES خضراء) | `REJECTED` | `INVALID`. رمز الخروج 0 فقط عند ACCEPTED. النتائج حتمية (بلا طوابع زمنية/مدد).
- الشجرة المطفَّرة: المتوقع `REJECTED` (≥1 PRES أحمر مع كل VALID أخضر)، أو `INVALID` فقط حيث تُسجَّل مسبقًا أدناه.

## 3) الحقيبة (fixtures) المثبّتة
- **الوكيل الأساسي**: `{id:'financial', name:'م', prompt:'PROMPT-FIN', knowledge:[k1,k2]}`؛ `k1={id:'k1',title:'ك١',content:'ملاحظة عن الذهب',embedding:[1,0,0]}`، `k2={id:'k2',title:'ك٢',content:'ملاحظة ثانية',embedding:[0.9,0.4359,0]}`.
- **الاستعلام الأساسي** `Q='ما سعر الذهب اليوم'`؛ تضمينه من الخلفية الوهمية `[1,0,0]`؛ أي نص آخر غير معرَّف ⇒ `[0,0,1]`.
- **الذاكرة طويلة المدى** (بتضمينات جاهزة، cos مع Q): `m1` [1,0,0] =1.00؛ `m4` [0.9,0.43589,0] =0.90؛ `m2` [0.8,0.6,0] =0.80؛ `m5` [0.75,0.661438,0] =0.75؛ `m3` [0.7,0.714143,0] =0.70. المتوقع للمخرجات: `m1,m4,m2` بهذا الترتيب (m5 يسقط بـtopK، m3 بالعتبة).
- **الملفات**: `uploadedDocs=[{id:'d1',name:'f',chunks:[c1 (title t1,content ملف١, embedding [1,0,0]), c2 (t2, [0,1,0]), c3 (t3, [0.9,0.43589,0])]}]` ⇒ مع الخلفية: `c1,c3` (c2 يسقط بـminScore).
- **السوق**: استجابة وهمية `{fetchedAt:'2026-10-14T11:00:00.000Z', goldPriceUsdPerOz:2000, goldPriceUsdPerGram:64.3, usdToLocalRate:1.5, goldPriceLocalPerGram:96.45}`.
- الإعدادات (localStorage بعد الإقلاع): `nexus_backend_url='https://backend.test'` (أو فارغ)، `nexus_ltm_enabled='1'`، `nexus_market_context_enabled='true'`.
- `selectedAgentIds=['financial']` للخلية الأساسية. قبل كل خلية: تصفير `marketContextCacheClient=null`، `_embeddingCache.clear()`، `ExecutionCheckpoint._mem=null`، واستعادة أي دالة استُبدلت.

## 4) قائمة الفحوص المجمَّدة (الأسماء مرجع الطفرات)
**VALID**
- V01 boot-init: `encryptionKey` تعيّن.
- V02 clock-fixed: `Date.now()` ثابتة = القيمة المثبّتة قبل/بعد 100ms؛ و`new Date().toISOString()==='2026-10-14T12:00:00.000Z'`.
- V03 now-matches-Intl: `ContextFabric.now() === new Intl.DateTimeFormat('ar',{dateStyle:'full',timeStyle:'short',timeZone:'UTC'}).format(FIXED)` وغير فارغة (إثبات أن ICU العربية والساعة المثبّتة فاعلتان).
- V04 network-intercepted: `fetch('https://example.com/')` داخل الصفحة يُجهَض؛ وطلب `backend.test` لمسار غير معرَّف يعيد 404؛ ولا طلب خرج خارج المسار الموجَّه.
- V05 fixtures-yield-all-five-segments: خلية الأساس تنتج الأجزاء الخمسة (وقت، معرفة، ذاكرة، ملفات، سوق).
- V06 determinism-same-page: استدعاءان متتاليان ⇒ نص متطابق حرفيًا.
- V07 determinism-fresh-context: سياق/صفحة جديدان ⇒ SHA-256 متطابق.
- V08–V11 inj-target-{agentKnowledgeContext, retrieveLongTermMemoryContext, fileDocsContext, getMarketContext}: استبدال `window.<fn>` بدالة تعيد sentinel يغيّر ناتج `fullAgentPrompt` (يظهر الـsentinel) — إثبات أن الاستبدال يستهدف المرجع الذي يستدعيه `ContextFabric`.
- V12 restore-returns-baseline: بعد الاستعادة يعود الناتج مطابقًا للأساس.
- V13 spy-records-labels: لفّ `NexusContext._safe` يسجّل التسميات (ليست فارغة في الأساس).
- V14-<cell> intent-as-declared: لكل خلية بوابة عبر `fullAgentPrompt` حقول `intent` المقاسة = المعلنة أدناه.
- V15 checkpoint-seeded: `ExecutionCheckpoint.peek('t1')` يعيد السجل المزروع (لخلايا المهمة).

**PRES**
- P01 prompt-plus-build-text: `fullAgentPrompt(a,q) === a.prompt + (await ContextFabric.build(a,q)).text` (تحت الساعة الثابتة)؛ و`build` يعيد `{text:string,intent:object}` بمفاتيح intent المحددة (intent,domain,subdomain,complexity,risk,freshness,requiredEvidence,requiredTools,expectedOutput,confidenceTarget,confidence).
- P02 time-segment-first-exact: الناتج يبدأ بـ`PROMPT-FIN` ثم `\n\n[السياق الزمني: الآن ${V03expected}]` حرفيًا.
- P03 segment-order: مواضع الأجزاء تزداد: وقت < معرفة < ذاكرة < ملفات < سوق؛ وتسلسل تسميات `_safe` = ['agent knowledge','long-term memory','uploaded documents','market context'].
- P04 baseline-segments-exact: كل جزء يطابق نصه المتوقع الحرفي (معرفة k1 ثم k2 داخل fence 'معرفة وكيل مخصص' برأس «معرفة خاصة بهذا الوكيل المخصص (مُنتقاة تلقائياً حسب صلتها بسؤالك):»؛ الذاكرة m1,m4,m2 برأسها غير محاطة؛ الملفات c1,c3 داخل fence 'مستند مرفوع'؛ السوق داخل fence 'بيانات سوقية' بالأرقام 2,000 و64.3 و1.5 و96.45).
- P05 pinned-knowledge-on-low-intent: خلية G0 (انظر أدناه): جزء المعرفة موجود وتسمية `agent knowledge` مُستدعاة.
- P06 no-knowledge-no-segment: وكيل بلا `knowledge` ⇒ لا جزء معرفة (والتسمية مُستدعاة).
- P07 knowledge-topK-3: وكيل بأربع إدخالات (بلا خلفية، TF-IDF) ⇒ ≤3 مدخلات.
- P08 knowledge-fenced-label: جزء المعرفة يحمل fence `معرفة وكيل مخصص` (الأساس).
- P09 gate-G0-low-static: [selected=tech، استعلام `كيف حالك يا صديقي`، backend+LTM+docs موجودة] ⇒ التسميات = ['agent knowledge'] فقط؛ لا نص ذاكرة/ملفات/سوق؛ صفر طلبات `/api/embed` من هذه النافذة.
- P10 gate-G1-risk-only: [selected=legal، استعلام قصير ساكن `أريد شرح عقد إيجار`] ⇒ تسميات المعرفة+الذاكرة+الملفات وأجزاؤها حاضرة.
- P11 gate-G2-complexity-only: [selected=tech، استعلام `اكتب` طويل >120 حرفًا بلا كلمات حداثة/سوق/مخاطرة] ⇒ تسميات الذاكرة والملفات حاضرة.
- P12 gate-G3-freshness: [selected=tech، `ما أحدث ما حدث اليوم`] ⇒ حاضرة.
- P13..P16 build-intent-cells (مباشر مع `opts.intent`): P13 requiredEvidence وحده ⇒ حاضرة؛ P14 complexity='medium' وحده ⇒ حاضرة؛ P15 freshness='recent' وحده ⇒ حاضرة (يعزل الشرط المشمول)؛ P16 الثلاثة سلبية ⇒ المعرفة فقط، و`NexusIntentEngine.analyze` لم تُستدعَ (عدّاد) .
- P17 analyze-called-once-without-intent: `build` بلا `opts.intent` تستدعي `analyze` مرة واحدة (وعبر `fullAgentPrompt` مرة واحدة).
- P18 ltm-selection-exact: m1,m4,m2 بالترتيب، m3 (0.70) مستبعد بالعتبة، m5 (0.75) مستبعد بـtopK، الرأس «ذاكرة طويلة المدى (مقتطفات ذات صلة من محادثات سابقة مع هذا المستخدم):» وغير محاطة.
- P19 ltm-gates: (علم LTM مُطفأ | لا backend | ذاكرة فارغة) ⇒ لا جزء ذاكرة (كل حالة على حدة).
- P20 ltm-embed-500-non-fatal: `/api/embed` يعيد 500 ⇒ لا جزء ذاكرة، بقية الأجزاء كما هي؛ سُجّل `Long-term memory retrieval failed (non-fatal)`.
- P21 files-backend-routing: c1,c3 بالترتيب، c2 مستبعد (minScore)؛ السطر `- [من ملف "t1"]: …`؛ الرأس «مقاطع ذات صلة من ملفات رفعها المستخدم:» داخل fence 'مستند مرفوع'.
- P22 files-no-backend-tfidf: بلا backend ⇒ مقطع يحمل مصطلحات الاستعلام يتصدر؛ ≤3 مقاطع؛ داخل fence.
- P23 files-empty-no-segment: `uploadedDocs=[]` ⇒ لا fence.
- P24 files-embed-500-falls-back-to-tfidf: ⇒ نص المستند ما زال حاضرًا؛ سُجّل `Context router embeddings failed, falling back to local TF-IDF`.
- P25 files-lazy-embed-side-effect: مقاطع بلا `embedding` ⇒ بعد الاستدعاء كل مقطع له `embedding` (مصفوفة) وعدد طلبات `/api/embed` = عدد غير المضمَّنة + 1 للاستعلام وتم استدعاء `persistState` (عدّاد).
- P26 market-financial-domain-business: [agent financial، selected financial، استعلام ساكن] ⇒ جزء السوق حاضر ومحاط، طلب `/api/market-context` واحد.
- P27 market-freshness-branch: [agent financial، selected tech، استعلام `ما سعر الذهب`] ⇒ حاضر.
- P28 market-excluded-static-nonbusiness: [agent financial، selected tech، استعلام ساكن] ⇒ لا تسمية `market context`.
- P29 market-excluded-non-financial-agent: [agent id≠financial، selected financial، استعلام سوق] ⇒ لا تسمية `market context`.
- P30 market-gates: (علم السوق مُطفأ | لا backend) ⇒ التسمية مُستدعاة وبلا جزء وبلا طلب.
- P31 market-500-non-fatal-no-cache: ⇒ لا جزء، وبعدها استدعاء ناجح يجلب ويظهر الجزء (لم يُخزَّن فشل).
- P32 market-client-cache: استدعاءان متتاليان ⇒ طلب واحد فقط.
- P33–P36 fault-isolation-{agentKnowledgeContext, retrieveLongTermMemoryContext, fileDocsContext, getMarketContext}: دالة ترمي ⇒ الناتج = الأساس بلا ذلك الجزء حرفيًا؛ ورسالة console `NexusContext: <label> failed (non-fatal): inj-<fn>` بالتسمية الصحيحة (`agent knowledge`/`long-term memory`/`uploaded documents`/`market context`).
- P37 sentinel-placement: sentinel للملفات والسوق يظهر داخل fence؛ وللمعرفة والذاكرة بلا fence إضافي.
- P38 safe-direct: `_safe` تعيد قيمة الدالة؛ وعند الرمي تعيد `''` وتسجل التسمية+الرسالة.
- P39 fullAgentPrompt-never-includes-task-state: مع سجل مزروع (V15) لا يظهر `[حالة المهمة`.
- P40 build-taskId-line-exact: `build(a,q,{taskId:'t1'})` ⇒ آخر جزء `\n\n[حالة المهمة: المرحلة الحالية "phaseA"، مراحل مكتملة سابقاً: a، b]`؛ نتائج فارغة ⇒ `لا شيء بعد`؛ taskId مغاير أو بلا سجل ⇒ لا سطر.
- P41 buildAgentContext-characterization: ناتجه = معرفة+ذاكرة+ملفات خام (بلا وقت ولا بوابة ولا fence للملفات) + سوق خام فقط إن `agent.id==='financial'`؛ تسلسل التسميات مطابق. (توصيف فقط: لا مستدعٍ حي — لا قيمة حماية.)
- P42 baseline-no-state-mutation: بصمة المتغيرات الستة عشر (عدا activityLog/errorLog) لا تتغير باستدعاء الأساس (بتضمينات جاهزة).

إعلانات intent للخلايا: G0: risk=low, freshness=static, complexity=low, requiredEvidence=false؛ G1: risk=medium, requiredEvidence=true, complexity=low؛ G2: risk=low, freshness=static, complexity=medium, requiredEvidence=false, intent=create؛ G3: freshness=realtime, requiredEvidence=true.

## 5) الطفرات المجمَّدة (على نسخ scratch لـfrontend؛ المرساة يجب أن تظهر مرة واحدة بالضبط وإلا exit 2)
CTRL = نسخة غير مطفَّرة ⇒ المتوقع ACCEPTED. لكل طفرة: المتوقع REJECTED بكسر واحد على الأقل من الفحوص المذكورة (VALID كلها خضراء).
| id | الطفرة | الفحوص المتوقع كسرها |
|---|---|---|
| MU01 | `_safe` بلا try/catch | P33–P36، P38 |
| MU02 | `_safe` يعيد `undefined` عند الفشل | P33–P36، P38 |
| MU03 | `_safe` بلا `console.error` | P33–P36، P38 |
| MU04 | البوابة دائمًا true | P09 |
| MU05 | البوابة دائمًا false | P10–P12، P13–P15، P03/P04 |
| MU06 | البوابة بلا شرط complexity | P11، P14 |
| MU07 | البوابة بلا شرط requiredEvidence | P10، P13 |
| MU08 | البوابة بلا شرط freshness | P15 فقط (P12 لا ينكسر لأن freshness مشمول عبر analyze — مسجّل مسبقًا) |
| MU09 | معرفة الوكيل داخل البوابة | P05 |
| MU10 | إزالة سطر الوقت | P02، P03 |
| MU11 | الوقت بعد المعرفة | P02، P03 |
| MU12 | إزالة fence الملفات | P04، P21، P37 |
| MU13 | إزالة fence السوق | P04، P26، P37 |
| MU14 | إزالة شرط `agent.id==='financial'` للسوق | P29 |
| MU15 | إزالة بديل `domain==='business'` | P26 |
| MU16 | إزالة بديل `freshness` للسوق | P27 |
| MU17 | عتبة الذاكرة 0.72→0.5 | P18 |
| MU18 | topK الذاكرة 3→2 | P18 |
| MU19 | `fullAgentPrompt` تعيد `text+prompt` | P01، P02 |
| MU20 | topK الملفات 3→1 | P21 |
| MU21 | إزالة كتلة `taskId` | P40 |
| MU22 | `build` يعيد `{text}` بلا intent | P01 |
| MU23 | تغيير فرع `catch` داخل `now()` | **ناجية متوقعة (SURVIVES)**: فرع `toISOString` غير قابل للوصول لأن اللغة `ar` مدعومة؛ مطفَّرة بلا أثر ملاحَظ |
| MU24 | `buildAgentContext` بلا فرع financial | P41 |
| MU25 | الملفات قبل الذاكرة | P03 |
| MU26 | تغيير نص تسمية `'agent knowledge'` | P03، P33 |
| MU27 | إزالة استدعاء `fence` للسوق مع بقاء النص (مماثل MU13) — يُحذف من القائمة إن كرّر MU13 | — |
أي ناجٍ غير MU23 يُبلَّغ بسببه كـ«ناجٍ» بلا تعديل المعايير.

## 6) الانحدار والسلامة
**بصمات/Git قبل وبعد** (يجب ألا تتغير): sha256 لـ`frontend/neural_nexus_ai_agents-4-3-5-3.html`, `frontend/main.js`, `frontend/modules/state.mjs`, `frontend/modules/state.test.mjs`؛ تجزئة شجرة لـ`frontend/` و`src-baseline/` و`ADR/` (دون `node_modules`/`dist`/`data`)؛ `git status --porcelain` كاملًا (`GIT_OPTIONAL_LOCKS=0`)، HEAD، refs، `count-objects`، sha256 لـ`.git/index`. **المسموح الوحيد**: ظهور سطر `??` واحد جديد للملف الجديد.
**الانحدار من نسخة معزولة كاملة** (نسخة من المستودع؛ مسارات `/home/claude/nexus-v5` المثبّتة في سكربتات النسخة تُستبدل بمسار النسخة فقط): Vitest (توقع 178/178)؛ E2E: baseline 12/12، phase1 16/16، seed 16/16، slice4 21/21، slice5 27/27 `SURVIVES`، slice6 35/35، slice7 40/40 `NOT-STUCK`، slice8 79/79، slice10 28/28، EI UI 26/26. أرقام التوقع من الوثائق (مرجع للمقارنة لا دليل).
**أدوات slice 2/3** (تفحص نظافة الشجرة): تُشغَّل (أ) على النسخة المعزولة كما هي مع الملف الجديد، (ب) على نسخة معزولة بلا الملف الجديد (ضابط)، (ج) على clone معزول مُلتزَم (commit عابر داخل النسخة المعزولة فقط، كما في CP-18) ⇒ المتوقع 19/19 و23/23. إن فشلت (أ) و(ب) بنفس الفحص ⇒ السبب شجرة غير مُلتزَمة سابقة (8 ملفات معدَّلة)، لا الملف الجديد؛ وإن فشلت (أ) فقط بفحص النظافة ⇒ الملف الجديد. تُصنَّف كـ«فشل أداة التحقق» وليس فشل اختبار.
**لا يُشغَّل**: اختبارات الخلفية (لا صلة؛ لم تُمسّ)، سكربتات الطفرات القديمة (لا تغيير إنتاجي). تُعلن UNVERIFIED/NOT-RUN في التقرير.
E-1 (`ciphertext-hides-plaintext`): تُسجَّل النتيجة كما ظهرت؛ ظهور واحد ليس دليل فشل ثابت ولا عدم ظهوره دليل زواله.

## 7) قواعد السلوك أثناء التنفيذ (مسجَّلة قبل التشغيل)
- شروط الاحتياط: فشل V02/V03 ⇒ INVALID وتوقف (لا تطبيع بديل). فشل V08–V11 لأي دالة ⇒ INVALID لفحوص تلك الدالة وتوقف.
- فشل PRES على الشجرة غير المطفَّرة: يُحقَّق في الكود؛ إن كان خطأ توقع مني ⇒ يُصحَّح التوقع ويُسجَّل (أول تشغيل محفوظ)، لا يُخفَّف أي VALID؛ وإن كان سلوكًا حقيقيًا مفاجئًا ⇒ يُوصَّف كما هو إن كان حتميًا ومفهومًا السبب، ويُسجَّل كاكتشاف.
- أي تغيير في بصمات الإنتاج/ADR أو تعديل لملف موجود ⇒ FAILED وإيقاف.
- لا commit/ZIP، لا تحديث وثائق، لا لمس `sw.js`/E-1/NexusContext/ContextFabric.
- الحالات المتوقعة في التقرير: الاختبار الجديد VERIFIED ضمن حدوده (Chromium 141 headless، خلفية وهمية، بلا LLM/جلب حقيقي) إن ACCEPTED؛ والطفرات VERIFIED إن قُتلت كلها عدا MU23؛ وإلا PARTIAL مع التفصيل.

## 8) سجل الانحرافات (يُملأ أثناء التنفيذ فقط)
(فارغ عند التجميد)
