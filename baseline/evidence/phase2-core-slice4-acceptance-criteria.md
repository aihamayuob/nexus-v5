# Core Slice 4 / C1 — معايير القبول (مُعرَّفة قبل أي تعديل على كود الإنتاج)

الأساس: HEAD `9c95fbd` على `v5.0-polish`، الشجرة نظيفة. هذا الملف + اختبارات الوحدة + سكربت الـE2E كُتبت وشُغِّلت على الشجرة
**غير المعدَّلة** أولاً (سجلات `phase2-core-slice4-PRE-*`) لإثبات أن الاختبارات تفشل/تتفاوت كما هو متوقع قبل الرقعة.

## النطاق (ثابت)
استخراج منطق التكرار على السجل فقط: `snapshotPersistableState` / `restorePersistableState` / `resetPersistableState`
(المونوليث L4953–4966) إلى دوال نقيّة تأخذ السجل معاملاً صريحاً، بنمط bridge (ADR-002)، وبقاء الأسماء.
**ممنوع**: نقل `PERSISTABLE_STATE` أو أي من المتغيرات الـ16؛ تعديل `persistState` / `autoInitApp` / ADR-003؛ نقل ملكية `messages`
أو غيره؛ Evidence Integrity؛ أي إعادة هيكلة أخرى.

## قرارات واجهة (تُقرَّر داخل الشريحة كما نصّ CP-10 §4)
- **المنزل**: نهاية `frontend/modules/storage.mjs` (لا ملف module جديد، كي لا يتسع عائق `sw.js` المعلَّق).
- **الأغلفة الكلاسيكية**: تبقى في المونوليث `snapshotPersistableState()` / `restorePersistableState(decrypted)` / `resetPersistableState()`
  بنفس الأسماء والتواقيع (arity 0/1/0)، جسم كل منها سطر واحد يمرّر `PERSISTABLE_STATE` صراحةً، ⇒ **لا نداء** في `persistState`/`autoInitApp`/
  `pushSync`/`pullSyncIfNewer`/`resolveSyncConflict`/`resetAllData` يتغيّر.
- **الجسر**: لا يمكن `window.snapshotPersistableState = <دالة الوحدة>` لأن الاسم محجوز للغلاف الكلاسيكي (إسناد main.js سيستبدله فتنكسر
  النداءات ذات التوقيع القديم). لذلك الجسر يكشف الدوال الثلاث (بأسمائها كما هي) داخل كائن واحد `window.PersistableStateCore`
  يُسنَد في main.js قبل نداءات startup. هذا هو الانحراف الوحيد عن شكل `window.fn = fn` ويُوثَّق في CP-11.

## المعايير
**AC-1 اختبارات وحدة** (`frontend/modules/persistable-state.test.mjs`): snapshot / restore / reset، تشمل: مفتاح غائب ⇒ `default()` طازج مستقل
(كائنان مختلفان عند استعادتين؛ تعديل أحدهما لا يؤثر في `default()` التالي)؛ `undefined` ⇒ افتراضي بينما `null`/`0`/`''`/`false`/`[]` تُحفظ؛
`decrypted` = null/undefined/غير كائن ⇒ كلها افتراضية؛ مفاتيح زائدة تُتجاهل؛ ترتيب المفاتيح = ترتيب السجل؛ اختبار تفاضلي (differential)
ضد **النص الأصلي الحرفي من HEAD** على سيناريوهات متعددة؛ وتشغيل ضد **نص السجل الحقيقي** المقروء من المونوليث (16 مفتاحاً، افتراضيات طازجة).

**AC-2 دليل استخراج على مستوى البايت** (`phase2-core-slice4-extract-script.mjs`): (أ) يمتنع إن اختلف المونوليث عن HEAD أو لم تُوجد الكتلة الأصلية
مرة واحدة بالضبط؛ (ب) الكتلة الأصلية O (3 دوال) تساوي بايت-ببايت تحويلَ الوحدة العكسي (إزالة `export `، `registry`→`PERSISTABLE_STATE`، إزالة
المعامل)؛ (ج) تبايُن الرموز (token-level) بين O والوحدة = قائمة التعديلات المسموحة فقط؛ (د) المونوليث بعد الرقعة مع إعادة الغلاف W→O يساوي blob HEAD
بايت-ببايت (أي لا بايت آخر تغيّر)؛ (هـ) sha256 قبل/بعد لـ: كتلة `PERSISTABLE_STATE`، جسم `persistState`، جسم `autoInitApp`، أسطر تصريح
الـ16 متغيراً، `ADR/003-*.md`، `storage.test.mjs` وبقية الوحدات: **كلها متطابقة**؛ (و) `git diff` على `storage.mjs`/`main.js` إضافات فقط
(بلا أسطر محذوفة إلا ما يُسمّى صراحةً). يُنتج JSON حتمياً + log، ووضع `--verify <baseRef>` يعيد الإثبات بعد الـcommit.

**AC-3 E2E عبر `autoInitApp` الحقيقي** (`e2e/phase2-core-slice4-flows.mjs`، Chromium حقيقي، بلا mocks): (i) كتابة قيم مميِّزة للمفاتيح الـ16 عبر
السجل، `persistState()` حقيقي، reload، استعادة **الـ16** عبر `autoInitApp`؛ (ii) blob مشفَّر ينقصه عدة مفاتيح (`[]` و`['general']` و`null`) ⇒ بعد reload
تُستعاد الغائبة لقيمها الافتراضية الصحيحة والحاضرة تبقى، والافتراضيات الغائبة كائنات **مستقلة** (تعديل أحدها لا يغيّر الآخر ولا `default()`)؛
(iii) الأغلفة الكلاسيكية تُفوِّض للـbridge وتمرّر **نفس كائن** `PERSISTABLE_STATE` (spy)؛ (iv) `resetAllData()` الحقيقي يصفّر الـ16 ويمسح الـblob.
فحوص خاصة بالرقعة (متوقَّع فشلها قبلها): `bridge-core-namespace`, `wrappers-delegate-explicit-registry`. الباقي سلوكي ويجب أن ينجح على الجانبين.

**AC-4 سلوك التعديل وحماية الحالة**: snapshot لا يعدّل الحالة ولا السجل (سجل مُجمَّد `Object.freeze` يعمل)، وبنيته العلوية مستقلة (حذف/إسناد على
اللقطة لا يغيّر الحالة)؛ **توصيف مُوثَّق (لا حماية)**: القيم داخل اللقطة مراجع حيّة (shallow) وكذلك القيم المستعادة تُسند بالمرجع — سلوك قائم مُحافَظ عليه
حرفياً لا ميزة جديدة؛ restore لا يعدّل كائن `decrypted` العلوي؛ reset يُعيد ربط الـbinding (لا يمسح المصفوفة القديمة في المكان)؛ الافتراضيات لا تتأثر
بتعديل القيم المُسندة. **Mutation testing**: ≥6 تعديلات على الدوال المستخرجة (تخزين افتراضي مشترك، `!== undefined`→truthiness، snapshot يعيد الحالة نفسها،
restore يتخطى المفاتيح الغائبة، reset ينسى مفتاحاً، تغيير ترتيب/نطاق التكرار) يفشل كلٌّ منها ≥1 اختبار وحدة؛ ≥2 تعديل على الجسر/الغلاف يفشل E2E؛
كل ملف يُستعاد وsha256 مطابق.

**AC-5 انحدار (يُعاد القياس ولا تُحمل أرقام تاريخية)**: Vitest (الأساس المقاس اليوم قبل الرقعة: 132 في 4 ملفات + الجديد)، E2E `baseline-flows`، `phase1-security-flows`،
`phase2-core-seed-flows` (الأساس المقاس اليوم: 12/16/16)، + السكربت الجديد. تُسجَّل الأعداد الفعلية.

**AC-6 أمان ترتيب التنفيذ** (ADR-002 Consequences): فحص AST ثابت يثبت أنه لا تعليمة load-time في الـclassic script تبلغ الدوال الثلاث (مباشرة أو عبر
نداءات متزامنة)، أو — إن بلغتها — أن bridge يسبقها. المسار المعروف: `main.js` يسند الـbridge ثم ينادي `autoInitApp` (الذي ينادي `restorePersistableState`).

**AC-7 حراسة النطاق**: `git diff --stat` يقتصر على: `frontend/modules/storage.mjs`، `frontend/modules/persistable-state.test.mjs` (جديد)، `frontend/main.js`،
المونوليث (كتلة L4953–4966 فقط)، `e2e/phase2-core-slice4-flows.mjs` (جديد)، `baseline/evidence/*`، وثائق (CP-11، CURRENT-STATE، CONTINUATION، CHANGELOG). لا تغيير في
`src-baseline/`، ولا في ADR، ولا في `PHASE2-MODULARIZE.md`.

**AC-8 قرار Backend / tsc**: يُحسم من سطح التغيير الفعلي (يُتحقَّق بـ`git diff --stat -- src-baseline` فارغ، وبحث عن أي اعتماد من الـbackend على ملفات frontend).
القاعدة: إن كان الـbackend بلا diff وبلا اعتماد على الـfrontend فإعادة تشغيل `npm test`/`tsc --noEmit` **غير مطلوبة** بحكم النطاق؛ وإن شُغِّلا فكتأكيد
منخفض الكلفة لا كشرط، ويُسجَّل ذلك صراحةً. لا يُعدّ أي فحص غير منفَّذ ناجحاً. (E2E يستعمل `dist` المبني للـbackend كخادم فقط.)

**AC-9 توثيق/تغليف**: `docs/checkpoints/CP-11.md`؛ تحديث أدنى لـ`NEXUS-CURRENT-STATE.md` و`NEXUS-CONTINUATION.md` و`CHANGELOG.md`؛ commit بعد التحقق؛ ZIP بعد الـcommit؛
شجرة نظيفة؛ فك الـZIP والتحقق أن HEAD داخله = الـcommit النهائي. Evidence Integrity يبقى **BLOCKED** ومنفصلاً.

## شروط التوقف (بلا توسيع نطاق)
تعذُّر تحقيق AC-1…AC-6 دون: نقل ملكية حالة، أو تعديل جزء محمي (`PERSISTABLE_STATE`/`persistState`/`autoInitApp`/ADR-003)، أو إنشاء تجريد موازٍ ⇒ توقّف، سجّل العائق
والحل المحدود المقترح، ولا تفرض الرقعة.
