# نص بدء المحادثة الجديدة (انسخه كما هو مع إرفاق ZIP وتقرير التسليم)

أنت تعمل على NEXUS. اتبع تعليمات المشروع الدائمة: الاستنتاج من المستودع والأدلة فقط، INSPECT → MAP → DIAGNOSE → PATCH → TEST → VERIFY → DOCUMENT، أصغر شريحة آمنة، ثم التوقف.

**المرفقات:** `nexus-v5-repo-20261014-slice10-uncommitted-on-bc05f58.zip` (SHA-256 `94dcbb4e30cece6005eeb98081b39b801efbfe6e7601d0395c67bfed17b21a41`، 8396403 بايت) + `NEXUS-slice10-final-delivery-report.md`.

**أولًا (قبل أي تغيير):** استخرج الـ ZIP في مجلد جديد فارغ، وتحقق من SHA-256 والفرع `v5.0-polish` وHEAD `bc05f58247ea837f3df4fd8343fdc52ed21eeedd` وgit status (8 معدّل + 82 غير متتبَّع). ثم اقرأ `NEXUS-CURRENT-STATE.md` ثم `docs/checkpoints/CP-18.md` و`ADR/005-global-accessor-state-ownership.md`. لا تفترض شيئًا ولا تعتمد على ذاكرة المحادثة. البيئة: `npm ci` في frontend وe2e (Playwright 1.56.1) وbackend (+`npm run build`)، والسكربتات القديمة تثبّت `/home/claude/nexus-v5`.

**الحالة:**
- Slice 10 (`agentOrder` عبر global accessor): **VERIFIED ضمن نطاق محدود** (متغيّر واحد، Chromium 141 headless).
- **جاهزية الإصدار: BLOCKED/UNVERIFIED** — `sw.js` الحقيقي غير متوفر (لا في الشجرة ولا في git). لا تفترضه ولا تنشئ بديلًا.
- boundary 5 core وPhase 2: PARTIAL. Evidence Integrity لا يُعاد فتحه.
- `messages` و`selectedAgentIds` والمتغيرات الـ13 الأخرى: لم تُمسّ، BLOCKED على قرار.
- لا commit لشريحتي 9 و10. لا شريحة تالية معتمدة تلقائيًا.

**القرارات المعتمدة:** global-accessor لـ`agentOrder` وحده؛ عدم مسّ `messages`/`selectedAgentIds`؛ لا تخفيف للمعايير بعد رؤية النتائج؛ لا commit/ZIP دون طلب صريح؛ التوقف بعد كل شريحة. D2 (`frontend/modules/state.mjs` مركزية) مُفترَضة وتحتاج تأكيدي.

**الخطوة التالية:** إن أرفقتُ `sw.js` الحقيقي: الشريحة = إضافة `/modules/state.mjs` إلى قائمة الـ cache (5 → 6) والتحقق من الإقلاع دون اتصال في Chromium، بمعايير تُكتب وتُجمَّد قبل التنفيذ. وإن لم أرفقه: لا تُنفّذ شيئًا إنتاجيًا؛ اسألني عن القرارات المعلّقة (تأكيد D2، سياسة أمنية للمتغيرات الحساسة R2، commit لـ9 و10). اذكر الأدلة والقيود والمتبقي، ولا تستخدم "DONE".
