# CP-4 — Phase 2 (/nexus-modularize), boundary 2/9 "storage" complete

**ما أُنجز فعلاً**: استخراج `localStore, ExecutionCheckpoint, ImageStore,
MessageArchive` إلى `modules/storage.mjs` — مطابق حرفياً (byte-diff
مؤكَّد). main.js يستورد الآن boundary-2 أيضاً، مع ترتيب صحيح (bridge قبل
autoInitApp، تعلّمناها من خطأ boundary 1). لا انحدار هذه المرة — طُبِّق
الدرس استباقياً.

**قرار معماري موثَّق**: `PERSISTABLE_STATE` استُبعِد عمداً من هذا
الـboundary — يعتمد على 16 متغيّر state مبعثر عبر الملف، نقله الآن يعني
دمج معظم core/agents/workspace في خطوة واحدة (broad rewrite). التفاصيل
الكاملة في `ADR/003-phase2-storage-boundary.md`.

**الاختبارات**: 27 اختبار جديد (`storage.test.mjs`)، استخدمت
`fake-indexeddb` لاختبار المسار الحقيقي (raw IndexedDB) الذي يعمل فعلياً
في تطبيق Aiham المنشور (window.storage غير موجود إلا في بيئة معاينة
Claude). Coverage: 89.2%/82.6%/86.11%/96%. المجموع الآن: **46/46**.

**الانحدار (fresh)**: backend 406/406 (بدون تغيير)، `baseline-flows.mjs`
12/12، `phase1-security-flows.mjs` 16/16 (يغطي ImageStore/MessageArchive
عبر flows حقيقية).

**حالة Phase 2 الإجمالية: PARTIAL** — 2 من 9. المتبقي: utilities, core
(يشمل PERSISTABLE_STATE المؤجَّل), agents, modes, ops-center, workspace,
UI.

**متابعة sw.js التراكمية**: يحتاج الآن `/main.js` +
`/modules/security.mjs` + `/modules/storage.mjs`.

**الخطوة التالية الحرفية**: انتظار توجيه Aiham للـboundary التالي.
