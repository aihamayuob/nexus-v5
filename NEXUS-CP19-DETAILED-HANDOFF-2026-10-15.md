# NEXUS v5.0 — تقرير التسليم التفصيلي (CP-19) — 2026-10-15

> وثيقة تسليم وتوثيق فقط. لا تطوير جديد، ولا تعديل لكود الإنتاج أو للمعايير المجمّدة.
> **المستودع هو المرجع.** إن اختلف هذا التقرير مع المستودع أو الأدلة المحفوظة فالمستودع والأدلة تغلب، ويُسجَّل الاختلاف.
> لا يُستخدم «DONE» حالةً. الحالات المعتمدة فقط: `VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED`.

## 0) ما الذي تحقّقتُ منه الآن وما الذي هو دليل محفوظ

**تحقّقتُ منه فعليًا أثناء إعداد هذه الحزمة (2026-10-15):**
- الفرع `v5.0-polish`، HEAD `80c558a2378eefc7748fe0af41d4a381e41c19d9`، الأب `bc05f58247ea837f3df4fd8343fdc52ed21eeedd`.
- بصمة ملف CP-19 في الشجرة وفي الـblob الملتزَم: `89842de0c5e71ed9c1d43cd7ab4c601e4d4554b9f411a31a3e6266077a840093` (مطابقة).
- بصمة `FROZEN-CRITERIA.md`: `b82d27c2a52667becb72b29b72d0e094fd2e0915c5614fb5d147b93978d98979` (مطابقة، لم يتغير).
- حالة الشجرة: **8 ملفات معدّلة (M) + 82 غير متتبَّعة (??)**، stash = 0، لا remote مضبوط في `.git/config`.
- قائمة الملفات القابلة للتضمين: 583 ملفًا (501 متتبَّعًا + 82 غير متتبَّع)، فُحصت بحثًا عن أنماط أسرار (مفاتيح API/PEM/توكنات): **لا نتائج**. `.env.example` قيمه فارغة (لا أسرار).
- (تُستكمل نتائج فحص الـZIP نفسه في §«التحقق من الحزمة» أدناه وفي `MANIFEST-SHA256.txt`.)

**لم أُعد تشغيل أي اختبار في مهمة التغليف هذه.** كل نتائج الاختبارات الواردة أدناه هي **أدلة محفوظة** من جلسة CP-19 (2026-10-14/15) أو من جلسات سابقة، وسجلاتها داخل الحزمة. لا تُعدّ «متحقَّقًا منها الآن».

## 1) ملخص المشروع وبنيته الحالية

**NEXUS v5.0 / Neural Nexus AI Agents** — منصة وكلاء ذكاء اصطناعي عربية يبنيها مالك واحد (Aiham). بنية المستودع (مسار الجذر داخل الحزمة: `nexus-v5/`):

| الطبقة | المحتوى | ملاحظات |
|---|---|---|
| **الواجهة (Frontend)** | `frontend/neural_nexus_ai_agents-4-3-5-3.html` — مونوليث HTML/JS (~943 KB، ~11.7 ألف سطر) + وحدات ES: `modules/{security,storage,utilities,settings,state}.mjs` + `frontend/main.js` | الوحدات تُربط بالسكربت الكلاسيكي عبر جسور `window.*` (ADR-002). دوال/`let`/`const` الأعلى مستوى في السكربت الكلاسيكي مرئية بالاسم المجرد؛ الدوال فقط خصائص `window`. |
| **الـBackend** | `src-baseline/nexus-backend` — Node ≥ 22.5، TypeScript، SQLite (`node:sqlite`)، **بلا اعتماديات تشغيل خارجية** | وحدات: gateway, orchestrator, providers, council, swarm, warden, evaluation, memory, knowledge, observability, persistence (migrations)… |
| **بوابة النماذج (Gateway/Providers)** | `src-baseline/nexus-backend/src/gateway` و`src/providers` (محوّلات Anthropic/OpenAI/DeepSeek/Gemini/Ollama/LM Studio) | لا بيانات اعتماد حقيقية في بيئة العمل ⇒ مسارات النجاح الكاملة «مُتحقَّق منها بنيويًا لا بنتيجة حية» عبر كل المراحل. |
| **الاختبارات** | (أ) Vitest للواجهة (jsdom + fake-indexeddb): 6 ملفات؛ (ب) اختبارات الـBackend `tsx --test` (51 ملف `*.test.ts` في `test/`)؛ (ج) سكربتات E2E بـPlaywright في `e2e/` (مونوليث حقيقي + وحدات حقيقية + شبكة مُعترَضة)؛ (د) أدوات دليل في `baseline/evidence/` (probe الشريحة 2، محلل الشريحة 3، سكربتات الشريحة 4 وسكربتات طفرات الشرائح 4–8/10) | الأرقام في §3 |
| **التوثيق** | `NEXUS-CURRENT-STATE.md` (الحالة الديناميكية)، `NEXUS-CONTINUATION.md`, `PHASE2-MODULARIZE.md`, `PLAN.md`, `ROADMAP.md`, `ADR/000…005`, `docs/checkpoints/CP-1…CP-18`, `baseline/evidence/*` | **لا يوجد `CP-19.md` في المستودع** وحالة CP-19 غير مسجَّلة في `NEXUS-CURRENT-STATE.md` (محظور في تلك الشريحة). سجل CP-19 موجود فقط في هذه الحزمة (`CP19-evidence/`) وفي هذا التقرير. |

حالة التقسيم (Phase 2 — `/nexus-modularize`): الحدود 1–4 (security, storage, utilities, settings) VERIFIED تاريخيًا؛ **الحد 5 «core» PARTIAL**؛ الحدود 6–9 (agents, modes, ops-center, workspace) وبقية الواجهة PENDING. **Phase 2: PARTIAL.** Evidence Integrity (فصل عن core): VERIFIED ضمن حدود CP-16.

## 2) حالة Git والتغييرات المحلية

- الفرع `v5.0-polish`؛ HEAD `80c558a…` (commit CP-19: ملف الاختبار وحده، 665 سطرًا مضافًا)؛ الأب `bc05f58…` (Evidence Integrity, CP-16).
- آخر سلسلة: `bc05f58` ← `b811065` (slice 8) ← `389813f` (slice 7) ← `5770104` (slice 6) ← `fbd7236` (slice 5) ← `669386b` (slice 4)… (19 commit إجمالًا).
- **الـ8 ملفات المعدّلة وغير الملتزمة (من Slice 9/CP-17 وSlice 10/CP-18، فوق bc05f58):**
  `ADR/003-phase2-storage-boundary.md` (Erratum)، `CHANGELOG.md`، `NEXUS-CONTINUATION.md`، `NEXUS-CURRENT-STATE.md`، `baseline/evidence/phase2-core-slice3-state-map.mjs` (تكييف مسجّل)، `baseline/evidence/phase2-core-slice4-extract-script.mjs` (تكييف مسجّل)، **`frontend/main.js`** (+5/−0)، **`frontend/neural_nexus_ai_agents-4-3-5-3.html`** (+1/−1).
- **الـ82 غير المتتبَّعة:** `ADR/005-…`، `docs/checkpoints/CP-17.md` و`CP-18.md`، `e2e/phase2-core-slice10-flows.mjs`، **`frontend/modules/state.mjs`** و`state.test.mjs`، وبقية الملفات أدلة في `baseline/evidence/phase2-core-slice9-*` و`phase2-core-slice10-*` (سجلات ونتائج وسكربتات ومعايير).
- **Slice 10 غير ملتزم.** إنتاجه المعدّل: المونوليث + `main.js` + `state.mjs` الجديد. حالة Slice 10: **VERIFIED محليًا** لسلوك تجربة `agentOrder` فقط (Chromium 141 headless)؛ **جاهزية الإصدار BLOCKED/UNVERIFIED** بسبب `sw.js` (انظر §6).
- بصمات الإنتاج (ثابتة قبل/بعد CP-19): المونوليث `b58210df2e30d1175545f8b983df15e228b1fae74f749866471ff05e957e949d`، `main.js` `ae059a3f986268ba76ee3b83510a2d1f3ceee31d9a3d2ef044b6d6c12ed66c77`، `state.mjs` `2eb6668d64834c57f70ceb2134def87ec76d94f45075d08cae4e45bbb992c2fc`، `state.test.mjs` `589b6323c76bdfad4b308bd2f99e2441d80412f9f734fbd2174f039387edc179`. مونوليث HEAD (قبل Slice 10): يبدأ بـ`48ba9008…`. (القيم نفسها في `CP19-evidence/state-snapshots/POST/summary.txt`.)

## 3) سجل CP-19

**الهدف:** اختبار توصيفي (characterization) لسلوك `fullAgentPrompt(agent, q) = agent.prompt + (await ContextFabric.build(agent, q)).text` **كما هو اليوم**، دون حكم بصحته، ودون تعديل إنتاجي. جاء بعد قرار المالك D5 (§5).

**ما نُفّذ:**
1. تجميد معايير القبول قبل كتابة أي ملف: `CP19-evidence/FROZEN-CRITERIA.md` (15 فحص VALID، 42 PRES، 26 طفرة، خطة انحدار وقواعد سلوك).
2. ملف E2E واحد: `e2e/phase2-core-slice11-context-characterization-flows.mjs` (665 سطرًا). مونوليث حقيقي + وحدات حقيقية؛ كل الشبكة مُعترَضة: `https://nexus.test` من الملفات، `https://backend.test` بنقطتين فقط (`POST /api/embed`, `GET /api/market-context`)، وغير ذلك يُجهَض؛ الساعة مثبّتة (`2026-10-14T12:00:00.000Z`)، المنطقة UTC، اللغة en-US؛ لا نموذج حي. النتائج تُكتب خارج المستودع (`NEXUS_S11_RESULTS`، الافتراضي `os.tmpdir()`).
3. يغطي: بنية الناتج وترتيب الأجزاء، بوابة المُحسّنات (`requiredEvidence || complexity!=='low' || freshness!=='static'`)، المعرفة المثبّتة (تُحقن حتى عند النية المنخفضة)، الذاكرة طويلة المدى (عتبة 0.72 وtopK=3)، ملفات المستخدم (توجيه بالتضمين/TF-IDF، تضمين كسول مع أثر جانبي)، سياق السوق (شرط `agent.id==='financial'` + `freshness`/نطاق `business`، كاش 5 دقائق)، العزل غير القاتل لكل مصدر (`NexusContext._safe`)، وسطر حالة المهمة (يُختبر عبر `build(...,{taskId})` لأن `fullAgentPrompt` لا تمرّر opts).
4. توضيحات التنفيذ مسجّلة قبل التشغيل/أثناءه في `CP19-evidence/DEVIATIONS-LOG.md` (D-1…D-8) بملف منفصل كي تبقى بصمة FROZEN صالحة.

**النتائج الفعلية (أدلة محفوظة من جلسة CP-19):**
| الفحص | النتيجة | الحالة |
|---|---|---|
| الاختبار الجديد، شجرة Slice 10 (6 تشغيلات) | `ACCEPTED`، VALID 19/19، PRES 42/42، بلا `pageerror`، سجلات متطابقة بايتًا | VERIFIED ضمن حدوده |
| نفس الاختبار على clone نظيف عند `bc05f58` (3 تشغيلات) | `ACCEPTED` 19/19 + 42/42، السجل متطابق بايتًا مع سجل شجرة Slice 10 | VERIFIED (استقلال عن Slice 10) |
| نفس الاختبار على clone نظيف عند `80c558a` بعد الالتزام (3 تشغيلات) | `ACCEPTED` 19/19 + 42/42، متطابق | VERIFIED |
| الطفرات (CTRL + 26) | CTRL `ACCEPTED`؛ **24 `REJECTED`**؛ **MU23 ناجية (متوقع)**؛ **MU05 `INVALID`** | **PARTIAL** |
| انحدار (نسخة معزولة كاملة) | Vitest 178/178؛ E2E 12/12، 16/16، 16/16، 21/21؛ slice5 27/27 `SURVIVES`؛ slice6 35/35؛ slice7 40/40 `NOT-STUCK`؛ slice8 79/79؛ slice10 28/28؛ EI UI 26/26؛ slice11 61/61 | VERIFIED لما شُغّل |
| أدوات slice 2/3 | على الشجرة غير الملتزمة (مع الملف الجديد وبدونه): probe 18/19 (فحص `C5` قراءة-فقط/نظافة الشجرة) وanalyzer 22/23 (فحص نظافة `git status` للمسارات الإنتاجية)، والفشل نفسه في الحالتين؛ على clone معزول ملتزَم: **19/19 و23/23** | فشل **أداة تحقق** بسبب الشجرة غير الملتزمة لا فشل اختبار |
| اختبارات الـBackend، سكربتات الطفرات القديمة | لم تُشغَّل في CP-19 | **UNVERIFIED / NOT-RUN** (لم تُمسّ) |
| E-1 (`ciphertext-hides-plaintext`) | لم يظهر في تشغيل CP-19 | لا دليل على حلّه (ظهور واحد/غياب لا يثبت شيئًا) |

**تفاصيل الطفرات:** 26 طفرة بنصّ مرساة يظهر مرة واحدة بالضبط (لا خطأ مراسي). MU08 (حذف شرط freshness من البوابة) تُقتل بـP15 وحدها (شرط freshness مشمول منطقيًا بـ`requiredEvidence` عبر `analyze`). **MU23** (فرع `catch` داخل `now()`): ناجية لأن اللغة `ar` مدعومة فالفرع غير قابل للبلوغ. **MU05** (البوابة دائمًا false): مكشوفة بـ26 فحصًا أحمر، لكن حكم الأداة `INVALID` لأن فحصي V09/V10 (استبدال دالتي الذاكرة والملفات يجب أن يغيّر الناتج) غير قابلين للتحقق عندما تُغلق البوابة دائمًا. أول تشغيل للطفرات (قبل تصحيح D-7) محفوظ في `CP19-evidence/mutation/FIRST-RUN-before-D7-correction/`.

**حدود الاختبار:** Chromium 141.0.7390.37 headless فقط؛ خلفية وهمية بنقطتين؛ لا LLM ولا جلب حقيقي؛ فرع `taskId` لا يُبلَغ عبر `fullAgentPrompt` (موصَّف عبر `build` مباشرة)؛ `buildAgentContext` بلا مستدعٍ حي (P41 توصيف فقط)؛ لا يغطي `knowledgeContext` (قاعدة معرفة المستخدم العامة) ولا `callClaude`؛ يوصّف السلوك ولا يحكم بصحته؛ P42 يقارن 14 متغيرًا (16 عدا `activityLog`/`errorLog`).

## 4) تفسير التصنيفات (دون دمج أو مبالغة)

- **VERIFIED** — ثبت بدليل حالي قابل لإعادة الإنتاج **ضمن الحدود المعلنة فقط** (متصفح، بيئة، نطاق). ليس «صحيحًا مطلقًا» ولا «مكتملًا».
- **PARTIAL** — بعض ما طُلب ثبت وبعضه لا؛ يجب ذكر ما نقص. مثال هنا: الطفرات (24 مقتولة + ناجية متوقعة + MU05 بتصنيف INVALID).
- **INVALID** — حكم أداة القياس (`S11-VERDICT = INVALID`) حين يفشل فحص صلاحية (VALID): **لا يُعدّ حكمًا على السلوك**. MU05 مصنّفة INVALID لأسباب تصميم القياس (V09/V10)، لا لأن الطفرة غير مكتشَفة.
- **UNVERIFIED** — لم يُقاس أو لم يتوفر دليل (مثل اختبارات الـBackend في CP-19، وسلوك Firefox/Safari، و`sw.js`). لا يعني «يعمل» ولا «لا يعمل».
- **BLOCKED** — يتوقف التقدم على مدخل خارج ما أملكه (ملف `sw.js`، قرار مالك).
- **FAILED / PENDING** — ما فشل بدليل / ما لم يبدأ.
- نجاح CP-19 **لا يغلق** boundary 5 ولا Phase 2 ولا Slice 10.

## 5) قرارات معتمدة لا تُفتح دون دليل جديد

1. **D5 (المالك):** `ContextFabric` يبقى كلاسيكيًا (الخيار ج). `NexusContext` لا يُنقل الآن. أي نقل لاحق: **حقن صريح للتبعيات (أ) مفضّل؛ الوصول بالاسم المجرد (ب) ممنوع.** الاختبار التوصيفي (CP-19) شرط سابق، وهو الآن موجود.
2. **ADR-005:** مالك `agentOrder` وحده عبر global accessor (`modules/state.mjs`)؛ `messages` و`selectedAgentIds` (C3) **لم تُمسّ** ولا تُنقل. قرار ADR-003 (Decision) لم يتغير (Erratum وقائعي مُلحق). D2 (ملكية مركزية في `state.mjs`) **مفترض وغير مؤكَّد**.
3. **MU05 يبقى `INVALID` وحالة الطفرات `PARTIAL`** (قرار المالك). لا تُضاف فحوص جديدة في CP-19 ولا يُعاد تصنيفها.
4. **`FROZEN-CRITERIA.md` لا يُعدَّل.** التوضيحات في `DEVIATIONS-LOG.md` فقط.
5. **استقلال ملف CP-19 عن Slice 10: VERIFIED** (clone نظيف عند `bc05f58`: ACCEPTED 19/19 + 42/42، سجل مطابق بايتًا). لا يُعاد.
6. **Evidence Integrity (CP-16, ADR-004)** مغلق ضمن حدوده: لا يُعاد فتحه. و`isSendingMessage` (slice 8) وI-1/O2 (slice 6) مغلقان: لا يُعاد.
7. **لا commit/ZIP تلقائيان** ولا شريحة جديدة دون موافقة صريحة؛ لا تُستخدم GitHub شرطًا افتراضيًا.

## 6) ما لم يُنفَّذ وما بقي معلّقًا

- **`sw.js` الحقيقي غير موجود** في أي مكان محلي (شجرة/Git/مرفقات). Slice 10 غيّر `main.js` ليستورد `./modules/state.mjs` ⇒ يجب إضافة `/modules/state.mjs` لقائمة الـcache (5→6 ملفات) والتحقق من الإقلاع دون اتصال. **BLOCKED/UNVERIFIED** (مخاطرة ADR-005 R1، حاجز إصدار). مستودع GitHub `aihamayuob/nexus-v5` لم يكن قابلًا للوصول من الجلسة (غير مربوط)، ولا يوجد remote في `.git/config`.
- **Slice 10 و CP-17/18 وملفاتها غير ملتزمة** (8 M + 82 ??). التزامها قرار مالك منفصل.
- **CP-19 غير مسجَّل في وثائق حالة المستودع** (`NEXUS-CURRENT-STATE.md`، `docs/checkpoints/CP-19.md`، `CHANGELOG`) — شريحة توثيق مستقلة تحتاج موافقة.
- نقل `NexusContext`/`ContextFabric`: **لم يبدأ** (D5).
- بقية core: `PERSISTABLE_STATE` وبقية المتغيرات الـ15 الأخرى (ملكية)، ثم الحدود 6–9 والـUI المتبقي، وبوابة خروج Phase 2.
- قرارات مالك مفتوحة: D2 (تأكيد)، R2 (انكشاف المتغيرات الحساسة على `window`؛ سابقة `messages`)، R5 (لا تعميم)، أي ترحيل لمتغير آخر، إصلاح وميض E-1 كشريحة أدوات مستقلة (اختياري).
- Phase بعد Phase 2: Reliability/Production Hardening ← Commercial Readiness ← Research/Advanced ← Real-world Validation/Productization: **لم تبدأ**. لا تُنفَّذ ميزات لمجرد ورودها في القائمة.

## 7) تبعيات ومخاطر قد تمنع المتابعة، ونقص الأدلة

| # | الخطر/النقص | الأثر | حالة الدليل |
|---|---|---|---|
| 1 | `sw.js` مفقود | لا إصدار لـSlice 10؛ لا تحقق من الإقلاع دون اتصال | BLOCKED/UNVERIFIED |
| 2 | شجرة غير ملتزمة (8 M + 82 ??) | أدوات slice 2/3 تفشل بفحص النظافة على الشجرة الحالية؛ خطر فقدان العمل إن ضاعت الحزمة/النسخة | مقاس (A/B/C في CP-19) |
| 3 | سجل CP-19 خارج المستودع | الأدلة الأصلية (`FROZEN-CRITERIA.md` وغيرها) موجودة هنا فقط | واقعي |
| 4 | E-1 وميض متقطّع (~3.5% سابقًا) | قد يظهر في seed-flows؛ سجِّله كما يظهر | قياس سابق، غير محلول |
| 5 | الاختبارات: Chromium 141 فقط | سلوك Firefox/Safari للـaccessor على `window` غير مقاس | UNVERIFIED |
| 6 | أسماء على `window` (R2) | `window.agentOrder` قابل للقراءة/الكتابة من أي سكربت؛ مقبول لقائمة معرّفات، لا للمتغيرات الحساسة | قرار مالك مفتوح |
| 7 | سكربتات E2E القديمة تثبّت المسار `/home/claude/nexus-v5` وتكتب نتائجها في `baseline/evidence` | تشغيلها في المستودع الحقيقي يلوّث الشجرة | واقعي (عولج في CP-19 بنسخة معزولة) |
| 8 | لا مفاتيح مزوّدين حقيقية | لا تحقق حي لمسارات النجاح مع النماذج | قيد دائم |
| 9 | اختبارات الـBackend لم تُعاد في CP-19 | آخر رقم محفوظ 472/472 (CP-18، جلسة سابقة) | UNVERIFIED الآن |
| 10 | وثائق مشروع claude.ai (Nexus Project docs) قد تتأخر عن المستودع | قد تتناقض مع الحالة الحالية | المستودع يغلب |

## 8) ترتيب الخطوات المقترحة (اقتراح — لا شريحة معتمدة تلقائيًا)

**المسار الهندسي (الأولوية: correctness → security → architecture → compatibility → reliability → performance → intelligence → UX):**
1. **تثبيت الاستمرارية (قيمة عالية، مخاطرة منخفضة):** قرار المالك حول التزام Slice 10 (محليًا، مع بقاء «الإصدار BLOCKED على sw.js») وحول شريحة توثيق تسجّل CP-19 في المستودع. يزيل خطر فقدان العمل ويعيد أدوات slice 2/3 إلى الأخضر على شجرة نظيفة.
2. **فكّ حاجز `sw.js`:** تزويد الملف الحقيقي (أو ربط GitHub) ثم إضافة `/modules/state.mjs` والتحقق دون اتصال بمعايير مجمّدة أولًا.
3. **قرارات المالك المفتوحة** (D2، R2، سياسة C3) قبل أي ترحيل جديد للحالة.
4. **المتابعة الموثقة في core بالاستقلالية عن sw.js:** إن أراد المالك: شريحة تعتمد على اختبار CP-19 (نقل `NexusContext` بالحقن الصريح فقط، بقرار جديد)، أو شرائح ملكية المتغيرات الأخرى بعد حسم R2.
5. إكمال الحدود 6–9 ثم بوابة خروج Phase 2 (حسب `PHASE2-MODULARIZE.md`).
6. Reliability/Production Hardening (دلتا persistence، إلغاء/AbortController، CSP…) — **بعد** إغلاق Phase 2، وبأهداف قابلة للقياس.

**مسار الواجهة (UX) — منفصل عن الهندسة:** تحديث/تحسين الواجهة لا يبدأ قبل ثبات الاعتمادية والأمن؛ يحتاج هدفًا وحدود قبول (RTL/وصولية/أداء مقيس).
**مسار الاستعداد التجاري/البيع — منفصل:** (Commercial Readiness ثم Real-world Validation) يحتاج أرقامًا مقيسة (Lighthouse/FCP/حجم الحزمة، مراجعة CSP/HSTS)، ومتطلبات ترخيص وبيانات اعتماد لا يملكها الوكيل. **لا يُستنتج جاهزية تجارية من نجاح اختبارات حالية.**

## 9) ما يقرؤه Claude الجديد أولًا (بالترتيب)

مسارات داخل الحزمة بعد فكّها:
1. `START-HERE-NEW-CHAT.md` ثم `CLAUDE-NEW-CHAT-PROMPT-AR.md` (جذر الحزمة).
2. `nexus-v5/NEXUS-CURRENT-STATE.md` (الحالة الديناميكية؛ لا تتضمن CP-19 بعد) ثم `nexus-v5/docs/checkpoints/CP-18.md` و`nexus-v5/ADR/005-global-accessor-state-ownership.md`.
3. `CP19-evidence/FROZEN-CRITERIA.md` و`CP19-evidence/DEVIATIONS-LOG.md` (سجل CP-19 الأصلي).
4. `nexus-v5/NEXUS-CONTINUATION.md`، `nexus-v5/PHASE2-MODULARIZE.md` (جدول الحدود المتبقية)، `nexus-v5/PLAN.md`/`ROADMAP.md` عند الحاجة.
5. الاختبار نفسه: `nexus-v5/e2e/phase2-core-slice11-context-characterization-flows.mjs`.
وثائق مشروع claude.ai (مثل `ADR-005`, `CP-18`, `CP-17`, `NEXUS-PROJECT-MASTER-CONTEXT`) نسخ سابقة؛ عند التعارض يغلب المستودع.

## 10) أوامر الفحص والتشغيل الضرورية فقط (لا تُكرَّر الاختبارات دون سبب محدد)

```bash
# فكّ الحزمة والتحقق منها
unzip NEXUS-CP19-HANDOFF-2026-10-15.zip -d <مجلد-فارغ-جديد> && cd <مجلد>/NEXUS-CP19-HANDOFF-2026-10-15
sha256sum -c MANIFEST-SHA256.txt            # بصمات كل الملفات داخل الحزمة

# التحقق من حالة المستودع (للقراءة فقط)
cd nexus-v5
git rev-parse HEAD HEAD^                    # 80c558a… / bc05f58…
git status --porcelain | awk '{print substr($0,1,2)}' | sort | uniq -c   # متوقع: 8 M و82 ??
sha256sum e2e/phase2-core-slice11-context-characterization-flows.mjs     # 89842de0…0093
sha256sum frontend/neural_nexus_ai_agents-4-3-5-3.html frontend/main.js frontend/modules/state.mjs
sha256sum ../CP19-evidence/FROZEN-CRITERIA.md                            # b82d27c2…8979
```
تشغيل اختبار CP-19 (فقط عند سبب فني؛ يحتاج `npm ci` في `e2e/` وChromium لـPlaywright، ويقرأ `../frontend`، ويكتب نتيجته خارج المستودع):
```bash
cd nexus-v5/e2e && npm ci && NEXUS_S11_RESULTS=/tmp/s11.json node phase2-core-slice11-context-characterization-flows.mjs   # متوقع: S11-VERDICT = ACCEPTED
```
**تحذيرات:** سكربتات E2E الأخرى تثبّت المسار `/home/claude/nexus-v5` وتكتب نتائجها في `baseline/evidence`؛ شغّلها من **نسخة معزولة** بعد `sed` للمسار. أداتا slice 2/3 تتطلبان شجرة `frontend src-baseline e2e ADR` نظيفة ومُلتزَمة، و`ACORN_DIR` لمحلل slice 3 (acorn 8.x خارج المستودع).

## 11) محتويات الحزمة والاستثناءات

**لقطة عمل (working snapshot) تشمل التغييرات غير الملتزمة** — ليست `git archive` ولا HEAD وحده:
- `nexus-v5/`: كل ملف **متتبَّع** (501) + كل ملف **غير متتبَّع وغير مُتجاهَل** (82) بمحتواه الحالي في الشجرة = **583 ملفًا**، **مع** مجلد `.git` كما هو (نسخة قراءة فقط؛ تاريخ 19 commit، HEAD `80c558a`)، بحيث يعيد `git status` بعد الفك 8 M + 82 ??.
- `CP19-evidence/`: المعايير المجمّدة وبصمتها، سجل الانحرافات، لقطات الحالة PRE/POST/POST2، سجلات التشغيل الستة، الطفرات (نهائية والأولى)، الانحدار، أدوات slice 2/3 (3 نسخ)، وتشغيلات الـclones النظيفة. السكربتات فيها تشير إلى مسارات scratch مطلقة: **للاطلاع لا للتشغيل كما هي**.

**مستبعد عمدًا (قابل لإعادة التوليد/غير لازم):** `node_modules` (e2e, frontend, backend)، `src-baseline/nexus-backend/dist` (ناتج بناء)، `src-baseline/nexus-backend/data` (قاعدة بيانات تشغيل SQLite)، النسخ المعزولة والـclones (مئات الميغابايت)، أي مفاتيح/أسرار (لم يُعثر على أي منها). **غير متاح للتحقق/التضمين:** `sw.js` (غير موجود)، وثائق مشروع claude.ai (تعيش في المشروع لا على القرص)، الـZIP القديم للشريحة 10 (`94dcbb4e…`) — محتواه محتوى في الشجرة الحالية بتأكيد سابق.

**بما أن `node_modules` و`dist` مستبعدان:** الحزمة **ليست نسخة قابلة للتشغيل فورًا** ولا «مطابقة للمستودع الكامل بما فيه المولَّدات»؛ تتطلب `npm ci` (frontend, e2e, backend) و`npm run build` للـbackend عند الحاجة.
