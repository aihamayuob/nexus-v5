# NEXUS VEL — Verified Execution Layer (vertical slice) — operator guide

> الحالة: **PARTIAL**. شريحة رأسية أولى، مُتحقَّق منها بموصل اختبار فقط. لا يوجد أي موصل إنتاجي بأثر خارجي في النظام اليوم. الأدلة والحدود في `NEXUS-VEL-VERTICAL-SLICE-REPORT.md`.

## ما هي
طبقة اختيارية (opt-in) فوق `tools/pipeline.ts`. أي أداة تُصرّح بأثر خارجي عبر `RegisteredTool.effect` (انظر `src/tools/effectTypes.ts`) تُنفَّذ **حصرًا** عبر:

`قرار سياسة (افتراضه المنع) → إيصال write-ahead (IN_FLIGHT) → إرسال → قراءة مستقلة لحالة النظام الهدف → مصالحة عند الالتباس → إيصال دائم`

الأدوات القائمة (`web_fetch`, `calculate`, `code_execution`) لا تُصرّح بـ`effect` ومسارها **لم يتغيّر** ولا تمر عبر VEL.

## الحالات (لا تخلط بينها)
- `status` (دورة حياة الفعل): `IN_FLIGHT | DENIED | FAILED | ACKED | OUTCOME_UNKNOWN | RECONCILED_APPLIED | RECONCILED_NOT_APPLIED`
- `verification` (حالات الأدلة الخمس القائمة، دون تعديل معناها لمحرك التقييم): `VERIFIED | SUPPORTED | UNCERTAIN | CONFLICTING | UNVERIFIED | null`
- لا يُعدّ الفعل «ناجحًا ومؤكَّدًا» إلا إذا: `status ∈ {ACKED, RECONCILED_APPLIED}` **و** `verification = VERIFIED`.
- ادعاء الموصل بالنجاح وحده لا يرفع إلى VERIFIED أبدًا. فشل غير مؤكَّد (مهلة، ضياع رد) = غامض: لا إعادة محاولة عمياء.

## التفعيل / التعطيل
| الغرض | كيف |
|---|---|
| قواعد السماح | `NEXUS_VEL_POLICY_JSON` = مصفوفة JSON من `{id, tool, resources[], actors?[], maxCallsPerTask?}`. الموارد: نص حرفي أو بادئة تنتهي بـ`*` واحدة؛ `*` وحدها مرفوضة. **قاعدة غائبة/غير صالحة = رفض الكل.** |
| مفتاح الإيقاف | `NEXUS_VEL_ENABLED=false` ⇒ **تُرفض** كل الأدوات ذات الأثر (لا تُنفَّذ بلا بوابة). افتراضيًا `true`. |
| الإيصالات | `GET /v2/execution-receipts?taskId=&status=&unresolved=1&limit=` · `GET /v2/execution-receipts/:id` · `POST /v2/execution-receipts/:id/reconcile` (قراءة فقط؛ لا إرسال أبدًا). |
| الاسترداد عند الإقلاع | تلقائي في `index.ts`: كل إيصال `IN_FLIGHT` بدأ قبل الإقلاع ⇒ `OUTCOME_UNKNOWN` ثم مصالحة بالقراءة (لا إعادة إرسال). |

## الرجوع عن التغيير (Rollback)
1. **تشغيليًا (فوري):** `NEXUS_VEL_ENABLED=false` — لا شيء من الأدوات القائمة يتأثر.
2. **شفرةً:** عكس الرقعة `B-evidence/VEL/VEL-changes.patch` (20 ملفًا، منها 12 جديدة).
3. **قاعدة البيانات:** الهجرة 017 إضافية فقط (جدول `execution_receipts` + فهارس)؛ لا شيء يعتمد عليها. للتراجع: `DROP TABLE execution_receipts;` و`DELETE FROM _migrations WHERE name='017_execution_receipts.sql';`. ترك الجدول بعد عكس الشفرة غير ضار.

## كتابة موصل جديد (شروط العقد)
- لا `execute()`؛ فقط `effect.dispatch` و`effect.observe` (مسار قراءة منفصل لا يستخدم ناتج dispatch).
- `EffectDispatchError(msg, true)` فقط حين يضمن الموصل أنه لم يُطبّق شيئًا؛ أي استثناء آخر = غامض.
- `idempotency: 'key_supported'` فقط إذا كان النظام الهدف يمنع التطبيق المزدوج فعلًا بالمفتاح `EffectCallContext.idempotencyKey`.
- `locator()` يجب أن يكون **مقصورًا على الفعل نفسه** (معرّف + بصمة محتوى) وغير سرّي؛ `summarize()` لا يحوي أسرارًا (يُحفظ).
- لا تخزّن المعاملات الخام في أي مكان من الإيصال.

## إعادة تشغيل الاختبارات
```bash
cd src-baseline/nexus-backend
npm i --no-save tsx typescript @types/node
npx tsx --test test/verifiedExecution.test.ts            # 44 اختبارًا
npx tsx --test 'test/**/*.test.ts' 'test/*.test.ts'      # المجموعة الكاملة (المتوقع 590 / 0 فشل قبل G8؛ 600 / 0 فشل بعدها)
npx tsc -p tsconfig.json --noEmit
```

## G8 — تصنيف الأثر الإلزامي للأدوات (شريحة 2026-10-21)
- `ToolRegistry.register()` يرفض: (1) `effect` مع `execute`، (2) `effect` مع `effectClass`، (3) أداة بـ`execute` بلا `effectClass` صالح. الرفض = استثناء عند الإقلاع (يفشل الإقلاع بدل تجاوز البوابة بصمت).
- `effectClass.kind`: `pure` (لا I/O) · `read_only` (قراءة خارجية بلا مسار كتابة مقصود) · `legacy_exempt` (قد يُحدث أثرًا خارجيًا وغير مُبوَّب بـVEL؛ يتطلب `compensatingControls`).
- **هذا إقرار قابل للمراجعة لا إثبات**: لا شيء يتحقق من صدق التصنيف. قيمته: وجوده، ومكانه الواحد، وتثبيت قائمة `legacy_exempt` باختبار (`test/toolEffectClassification.test.ts` G8-8) فتغييرها فعل مقصود ومرئي.
- المدخل المخزَّن في السجل نسخة سطحية مجمَّدة: لا يمكن لاحقًا إضافة `execute` أو حذف `effect` أو تعديل التصنيف في مكانه.
- التصنيف: `calculate`=pure، `web_fetch`=read_only، و`code_execution` يحمل التصنيف `legacy_exempt` في ملفه (الـsandbox بلا عزل ملفات/شبكة) **لكنه لم يعد مسجَّلًا افتراضيًا منذ G8.1**. يُسجَّل تحذير إقلاع لكل أداة `legacy_exempt` مسجَّلة (لا توجد حاليًا في المسار الافتراضي).
- أدوات جديدة: لا تستخدم `legacy_exempt`؛ إن كان لها أثر خارجي فاستخدم `effect`.
- التراجع: عكس `B-evidence/G8/G8-changes.patch` (7 ملفات).

## G8.1 — `code_execution` خارج التسجيل الافتراضي (قرار المالك، OPTION C)
- `tools/bootstrap.ts` لم يعد يسجّل `code_execution`؛ الشفرة (`tools/builtin/codeExecutionTool.ts`, `sandbox/sandbox.ts`) باقية للتطوير/المراجعة. **لا عزل أُضيف** — الإزالة تلغي الإتاحة الافتراضية فقط.
- `NEXUS_ENABLE_CODE_EXECUTION_TOOL=true` لا يعيد تسجيلها (يحكم `Sandbox.runCode` فقط). أي طلب لها (خط الأنابيب، دفعة الأدوات، حلقة الوكيل، مزوّد يطلبها دون عرضها، تعريف أداة من العميل) يفشل بـ«غير مسجّلة» **قبل** تشغيل أي كود.
- شروط إعادة الإدخال (كلها لازمة): بيئة تنفيذ معزولة؛ ربط الأداة ببوابة VEL (`effect` لا `execute` عادية)؛ نجاح اختبارات الأمان والاستعادة؛ قرار المالك. حارس `test/codeExecutionNotRegistered.test.ts` يمنع إضافة استيراد/تسجيل لها في `src/` دون تعديل مقصود للاختبار.
- التراجع: عكس `B-evidence/G8.1/G8.1-changes.patch`.

## G8.2 — وكيل `data` بلا وعد بـ`code_execution`
- أُزيل من `agents/agentRegistry.ts` (وكيل `data`): إعلان `tools:['code_execution']` وجملة «يمكنك استخدام أداة code_execution» من نصه؛ بقية النص والمهارات كما هي. لا أداة تعلنها أي وكيل مدمج الآن.
- حارس `test/agentDataNoCodeExecution.test.ts`: لا وكيل مدمج يعلن أداة غير مسجّلة افتراضيًا ولا يذكر `code_execution`؛ وما يُرسَل فعليًا إلى المزوّد لا يحويها.
- تنبيه: نصوص وكيل `data` المعدَّلة المخزَّنة سابقًا في قاعدة بيانات حية (جينوم الوكيل) لا تتأثر بهذا التغيير الثابت.
- التراجع: عكس `B-evidence/G8.2/G8.2-changes.patch`.

## G8.2-closure — سياسة ثابتة لوكيل `data` تُركَّب عند بناء الطلب (2026-10-24)
- **المشكلة:** إزالة وعد `code_execution` (G8.2) لا تمنع الوكيل من *ادّعاء* تنفيذ كود أو حساب فعلي، ولا من التلميح بأداة لم تُعرض عليه. وأي نص يُوضع في `systemPrompt` الثابت وحده يستبدله جينوم معتمد بالكامل (`agentRunner.ts`: `getActiveSystemPrompt(id) ?? def.systemPrompt`).
- **التغيير:** حقل اختياري `fixedPolicy` في `AgentDefinition`؛ وكيل `data` وحده يحمله. `agentRunner.ts` يُلحقه (بعد سطر فارغ) **بعد** اختيار النص الأساسي (الثابت أو الجينوم)، فلا يستطيع الجينوم إسقاطه باستبدال `systemPrompt`. بقية الوكلاء: النص المُرسَل مطابق لتعريفهم حرفيًا. السياسة لا تذكر اسم أي أداة (لا إعادة إعلان لـ`code_execution`) ولا تغيّر الأدوات المعروضة ولا اختيار الوكيل.
- **ما يثبته الاختبار** (`test/agentDataFixedPolicy.test.ts`, G82C-1…5 — يقرأ الجسم الفعلي المُرسَل لمزوّد محلي وهمي): السياسة موجودة مرة واحدة وبعد النص الأساسي مع التعريف الثابت ومع جينوم نشط مختلف (مفعَّل عبر مسار الاعتماد البشري الحقيقي)؛ لا حقل `tools` يُرسَل؛ بقية الوكلاء الـ23 دون تغيير؛ الاختيار والمهارات دون تغيير.
- **ما لا يثبته:** أن النموذج *يلتزم* بالنص (توجيه لا إنفاذ)؛ ولا شيئًا عن قاعدة بيانات حية أو مزوّد حقيقي. وفحص الجينوم الأمني الحالي (`checkGenomeSecurityRisk`) **يمرّر** نصًا يَعِد بأداة؛ فجينوم معتمد قد يناقض السياسة نثريًا (تبقى هي الأخيرة في الطلب لكنها لا تُبطل التناقض). لم يُعالَج هنا (قرار مالك).
- `fineTuning.ts` ما زال يبني بيانات التدريب من `def.systemPrompt` وحده (دون السياسة) — خارج النطاق.
- التراجع: عكس `B-evidence/G8.2-CLOSURE/G8.2-CLOSURE-changes.patch` (4 ملفات: 3 مصدر + اختبار جديد). لا هجرات ولا بيانات متأثرة.
