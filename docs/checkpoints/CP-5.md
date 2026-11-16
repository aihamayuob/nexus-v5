# CP-5 — Phase 2 (/nexus-modularize), boundary 3/9 "utilities" complete

**ما أُنجز فعلاً**: استخراج 11 دالة عامة نقية (evaluateMathExpression,
chunkText, agentShortDesc, cosineSimilarity, parseOneSSEFrame,
estimateQuestionComplexity, reEl, localTimeStringToUTCHourMinute,
describeRecurrence, truncateText, wsUid) إلى `modules/utilities.mjs` —
مطابقة حرفياً (byte-diff، استخراج+تحقق مُبرمَج بالكامل هذه المرة).

**قرار تصنيف واعٍ**: من أصل 76 دالة self-contained، اخترت فقط الفئة
"عامة/غير مرتبطة بمجال" الحقيقية. استبعدت عمداً: settings getters (~22
دالة، ستُلحق بـUI لاحقاً)، UI chrome helpers (closeModal/showToast)،
ورندرة خاصة بمجال (DAG/thought-tree/veto) — هذه تخص boundaries أخرى وليس
"utilities" فعلياً.

**خطأ اختبار مُكتشف ومُصحَّح (وليس خطأ في المنتج)**: اختبار
chunkText استخدم نصاً قصيراً جداً فوقع بفلتر "≤20 حرف" الموجود أصلاً في
الدالة نفسها. صُحِّح بنص أطول.

**الاختبارات**: 38 اختبار جديد، Coverage: 91.13%/83.01%/90.9%/98.27%.
المجموع الآن: **84/84**.

**الانحدار (fresh)**: backend 406/406 (بدون تغيير)، `baseline-flows.mjs`
12/12، `phase1-security-flows.mjs` 16/16. **صفر انحدار هذه المرة.**

**حالة Phase 2 الإجمالية: PARTIAL** — 3 من 9. المتبقي: core (يشمل
PERSISTABLE_STATE المؤجَّل)، agents، modes، ops-center، workspace، UI
(يشمل الآن settings getters المكتشفة).

**متابعة sw.js التراكمية**: يحتاج الآن 4 ملفات: `/main.js`,
`/modules/security.mjs`, `/modules/storage.mjs`, `/modules/utilities.mjs`.

**الخطوة التالية الحرفية**: انتظار توجيه Aiham للـboundary التالي.
