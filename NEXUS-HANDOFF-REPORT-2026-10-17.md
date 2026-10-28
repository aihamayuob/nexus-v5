# NEXUS v5 — تقرير التسليم الهندسي — 2026-10-17

**نوع الوثيقة:** توثيق وتغليف فقط (لا تطوير). لم يُعدَّل أي ملف إنتاج أو اختبار أو أداة أدلة أو إعداد بناء، ولا commit ولا push.
**قاعدة القراءة:** كل رقم هنا مصدره سجل فعلي داخل الحزمة (انظر `TEST-EVIDENCE-INDEX.md`). ما لم أستطع إثباته مكتوب **PENDING VERIFICATION**. نجاح الاختبارات يثبت ما تختبره فقط، ولا يثبت خلو المشروع من الأخطاء.
**الحالات المستخدمة:** VERIFIED / COMPLETED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED / PENDING VERIFICATION.
**لا يوجد إعلان جاهزية إصدار.** عائق إلزامي واحد على الأقل ما زال مفتوحًا (§3، §8).

---

## 1) الملخص التنفيذي وهوية النسخة المسلَّمة

| البند | القيمة (مصدرها: أوامر Git فعلية، `GIT-STATE.txt`) |
|---|---|
| المستودع (نسخة العمل، خارج الـZIP) | `/tmp/claude-0/-home-claude/32993d6c-3079-5c91-b5d3-407731a6cd59/scratchpad/release/nexus-v5` |
| الفرع | `v5.0-polish` |
| HEAD | `cbdc898a3ba605211d9791979a6415f314ba1c8f` — «Release V1 B4: local-release security (deployment guard, key hygiene, CSP)» (2026-10-17 04:55:21 +03:00) |
| عدد الـcommits / الملفات المتتبعة | 23 commit / 854 ملفًا |
| تغييرات مرحَّلة / غير مرحَّلة على ملفات متتبعة | لا شيء / لا شيء |
| ملفات غير متتبعة | **7** — كلها `eval/arabic-v1/*` (حزمة B6، غير ملتزَم بها) |
| remote / upstream | **لا يوجد أي remote ولا upstream**. أي push غير ممكن من هذه النسخة كما هي مضبوطة؛ لا يمكن إثبات وجود نسخة أخرى في مكان آخر (PENDING VERIFICATION) |
| stash | فارغ. يوجد worktree إضافي مسجَّل: `scratchpad/work/b4-pre` (detached `711f353`) — أثر جانبي لقياس PRE في B4 |
| الواجهة | `frontend/neural_nexus_ai_agents-4-3-5-3.html` — 944,812 بايت، 11,764 سطرًا، sha256 `271cf4c9651684a246df58a12e2ffa4f36293a9919d3034e9dd3bc0e35ba2b0b`؛ `frontend/package.json` الإصدار `5.0.0-modularize` |
| الخلفية | `src-baseline/nexus-backend` الإصدار `2.0.0`، Node ≥ 22.5، TypeScript، SQLite، **صفر تبعيات تشغيل** |
| وقت التقاط الحالة | 2026-10-17 (انظر `GIT-STATE.txt` للطابع الزمني الدقيق) |

**الخلاصة بحسب الأدلة:**
- Phase 2 (Modularization): **PARTIAL**. الحدود 1–4 VERIFIED (أدلة تاريخية)، الحد 5 «core»: **PARTIAL** (الشرائح 1–11 مسجّلة أدناه)، الحدود 6–9: **PENDING**.
- تعزيز الإصدار الأول (Release V1): B1 (Service Worker) و B4 (الأمان المحلي) **COMPLETED وVERIFIED ضمن الحدود** (Chromium 141 headless فقط، خلفية حقيقية أو وهمية بحسب الاختبار). B2 (إعادة تشغيل الاختبارات ذات الصلة وتوثيق الأوامر والنتائج والبيئة) VERIFIED ضمن حدود §3.2–§3.3. B3 (مزوّد حي) **PENDING**. B5 (أداء) **PENDING (لم يبدأ)**. B6 (تقييم عربي) حزمة جاهزة + Scorer مُختبَر على بيانات اصطناعية، التقييم الحقيقي **PENDING — DATA NOT EXECUTED**.
- الانحدار: 14 سكربت E2E على clone نظيف من `cbdc898`: كلها نجحت (جدول في `TEST-EVIDENCE-INDEX.md` §A). لم يُكتشف انحدار بهذه السكربتات.
- **عوائق/ديون معلنة:** (1) تشغيل من جهاز آخر عبر HTTP عادي **BLOCKED** (قيد المتصفح)؛ HTTPS/وكيل عكسي **UNVERIFIED**. (2) وثائق الحالة قديمة (لا CP-20؛ `NEXUS-CURRENT-STATE.md` ما زال يقول إن `sw.js` غير موجود). (3) أداة التحقق من الشريحة 4 تفشل 6/17 بعد B4 (3 منها تعود إلى B4). (4) حزمة B6 غير ملتزَم بها وفيها عيوب توثيقية. (5) `tsx` غير مُصرَّح به في تبعيات الخلفية (§7).

---

## 2) سجل المراحل والشرائح (الحالة والدليل)

المصدر: `git log` (في `GIT-STATE.txt`) + `docs/checkpoints/CP-*.md` + `NEXUS-CURRENT-STATE.md`. الحالات منقولة عن الوثائق الأصلية وعن سجلات هذه الجلسة؛ إعادة التحقق الحية تخص ما هو مذكور في §3 فقط.

| Commit | العمل | الحالة | الدليل / الحدود |
|---|---|---|---|
| `7f7a5f8`…`1fb1587` | Phase 0 — Baseline (ADR-000, CP-1) | VERIFIED (تاريخي) | `ADR/000-baseline.md`، `docs/checkpoints/CP-1.md` |
| `3f02b37` | Phase 1 — Security (ADR-001, CP-2) | VERIFIED (تاريخي) | `CP-2.md`؛ أعيد تأكيده بصريًا عبر `phase1-security-flows` 16/16 في الانحدار الأخير |
| `dd3c3a7`, `e58dab9`, `140c892`, `3a2796f` | Phase 2 الحدود 1–4: security / storage / utilities / settings (CP-3…CP-6) | VERIFIED (تاريخي؛ أُعيد تأكيدها بصورة غير مباشرة فقط) | وحدات `security.mjs`, `storage.mjs`, `utilities.mjs`, `settings.mjs` + اختباراتها (Vitest 186/186 ضمنًا) |
| `4c3e169` | core slice 1: نقل `encryptState/decryptState` إلى `security.mjs` (CP-7) | VERIFIED | `CP-7.md` |
| `0520af7` | core slice 2 (دليل فقط): مسبار المتصفح لوصول الوحدات إلى bindings السكربت الكلاسيكي (CP-8) | VERIFIED (دليل فقط، Chromium 141) | أداة `tool-slice2-probe` 19/19 على clone ملتزَم |
| `b9d4808` | Evidence Integrity — فحص فقط (CP-9) | VERIFIED كفحص؛ الحاجز كان BLOCKED على قرارات المالك | `CP-9.md` |
| `9c95fbd` | core slice 3 (قراءة فقط): خريطة `PERSISTABLE_STATE` والمتغيرات الـ16 (CP-10) | VERIFIED كخريطة ساكنة؛ السلوك وقت التشغيل UNVERIFIED | `tool-slice3-analyzer` 23/23 |
| `669386b` | core slice 4 / C1: snapshot/restore/reset بتمرير السجل صراحةً (CP-11) | VERIFIED (Chromium 141) | `slice4-flows` 21/21، exec-order 9/9، unit-vs-original 36/36. **أداة `extract-verify` الآن 11/17 = PENDING (تحديث أدلة)** |
| `fbd7236` | core slice 5 (دليل فقط): فقدان `activityLog` في إقلاع offline (I-1) (CP-12) | VERIFIED (كان LOST حينها) | اليوم `slice5-flows` 27/27 بحكم `SURVIVES` على الشجرة المُصلَحة |
| `5770104` | core slice 6: معالجة I-1 بالخيار O2 (CP-13) | VERIFIED (`activityLog` فقط؛ بقية المتغيرات UNVERIFIED) | `slice6-flows` VALID 12/12 PRES 12/12 PS 11/11 |
| `389813f` | core slice 7 (دليل فقط): `isSendingMessage` عالق (CP-14) | VERIFIED (كان CONFIRMED STUCK حينها) | اليوم `slice7-flows` 40/40 بحكم `NOT-STUCK` |
| `b811065` | core slice 8: إصلاح `isSendingMessage` في `sendMessage()` (CP-15) | VERIFIED (Chromium 141 + offline مُحاكى + أعطال محقونة) | `slice8-flows` 79/79 |
| `bc05f58` | Evidence Integrity guard — fail-closed + `kind` صريح + `integrityReason` عبر الهجرة 016 (CP-16, ADR-004) | VERIFIED ضمن حدود CP-16 (قاضٍ وهمي، Chromium 141) | `ei-ui-flows` 26/26 |
| `80c558a` | core slice 11: اختبار توصيفي لـ `fullAgentPrompt` (CP-19) | VERIFIED ضمن الحدود؛ الطفرات **PARTIAL** (24 REJECTED، MU23 ناجية متوقعة، MU05 = INVALID قرار مالك) | `slice11-flows` VALID 19/19 PRES 42/42 |
| `e17c76d` | core slices 9+10: قياس ملكية C2/C3 + تجربة `agentOrder` عبر global accessor (CP-17, CP-18, ADR-005) | VERIFIED محليًا لسلوك `agentOrder` فقط (متغير واحد، Chromium 141) | `slice10-flows` 28/28. **كُتب هذا الـcommit في هذه الجلسة لحماية عمل غير ملتزَم به وُجد في الشجرة** (انظر `EXT/recovery/`) |
| `1ff20c9` | توثيق CP-19 داخل المستودع (docs فقط) | COMPLETED | — |
| `711f353` | **Release V1 / B1**: `frontend/sw.js` (مؤلَّف، لا استرجاع للأصل) + E2E حقيقي | VERIFIED (Chromium 141 headless فقط): PRE REJECTED (PS 2/11) → POST ACCEPTED (PS 11/11) | `release-v1-b1-*` |
| `cbdc898` | **Release V1 / B4**: الأمان المحلي | VERIFIED ضمن حدود §3 | `release-v1-b4-*` |
| (غير ملتزَم) | **Release V1 / B6**: حزمة التقييم العربي | PARTIAL — جاهزة، لم يُنفَّذ تقييم | `eval/arabic-v1/` (7 ملفات غير متتبعة) |

**الحد 5 «core» ما زال PARTIAL.** المتبقي (بحسب `NEXUS-CURRENT-STATE.md`/CP-19): `PERSISTABLE_STATE` و15 متغيرًا من الـ16 (ملكية C2/C3 — تنتظر قرارات المالك)، و`NexusContext`/`ContextFabric` (لم يبدأ — قرار D5، §6). تنبيه: **اكتمال شريحة لا يعني اكتمال حد، واكتمال حد لا يعني اكتمال مرحلة.**

---

## 3) B4 ونتائج الانحدار والسكربتات المتاحة

### 3.1 ما غيّره B4 (commit `cbdc898`، 40 ملفًا، +6421/−21)
**الخلفية:**
- `src/config/deploymentGuard.ts` (جديد): `evaluateDeployment()` و`enforceDeployment()`. القاعدة: لا إقلاع على عنوان غير loopback بدون `NEXUS_GATEWAY_KEYS`؛ المفاتيح ≥16 حرفًا، بلا فراغ، بلا تكرار عند التعرّض للشبكة؛ **لا يوجد علم تجاوز**؛ الرسائل لا تحوي قيمة مفتاح.
- `src/config/env.ts`: المضيف الافتراضي `127.0.0.1`. `src/index.ts`: يستدعي `enforceDeployment()` أول `main()`.
- `src/gateway/middleware/auth.ts`: هوية المعدّل/التدقيق للطلبات ذات المفتاح صارت `key:<بادئة sha256>`؛ ويُضبط `ownerKey` (sha256 للمفتاح الخام) ليبقى عنونة سجلات `/api/sync` كما كانت (عيب تصميم اكتُشف قبل الالتزام: تغيير `clientKey` وحده كان سيُيتّم السجلات؛ عولج باختبار).
- `.env.example`: المضيف loopback، وتوثيق خيار LAN، و`NEXUS_GATEWAY_KEYS=` فارغ.
**الواجهة:** مفتاح البوابة في **ذاكرة الصفحة فقط** (`settings.mjs`: `getGatewayKey/setGatewayKey/purgeLegacyGatewayKey`)، يُحذف المفتاح القديم المخزَّن عند الإقلاع ولا يُتبنّى؛ CSP عبر `<meta>`؛ `sw.js` لا يلمس `/api` ولا `/v2` ولا يخزّن ترويسات.
**التوثيق:** `docs/DEPLOYMENT-LAN.md` (يقول صراحةً: لا يصلح للإنترنت العام).

### 3.2 أدلة B4 (PRE يجب أن يفشل وPOST أن ينجح)
- الخلفية: PRE (الحارس غير موصول) 6/9 و16/21 → REJECTED. POST: **502/502** كاملة، و36/36 للاختبارات الجديدة. `tsc` build خرج 0.
- الواجهة: Vitest **186/186** (7 ملفات) بعد استبدال صف واحد صراحةً مع تبرير (`release-v1-b4-superseded-tests.md`؛ السجل قبل الاستبدال محفوظ: 1 فاشل/186).
- المتصفح الحقيقي (Chromium 141): `b4fe` PRE PS 5/20 REJECTED → POST PS 20/20 ACCEPTED (مرّتان)؛ `b4rb` (خلفية حقيقية عبر CORS): VALID 2/2، PS 7/7 — **مسار المصادقة فقط**.
- حدود: الأرقام 502/186 سُجلت على شجرة العمل قبل الالتزام، وكان `src` غير متغير بعدها بحسب سجل الجلسة؛ لم تُعَد على clone نظيف في هذه المهمة (PENDING VERIFICATION).

### 3.3 الانحدار (14 سكربت E2E على clone نظيف من `cbdc898`) — VERIFIED
كلها `exit=0`: baseline 12/12، phase1-security 16/16، seed 16/16، slice4 21/21، slice5 27/27، slice6 35/35، slice7 40/40، slice8 79/79 (ACCEPTED)، slice10 28/28، ei-ui 26/26، slice11 61/61 (ACCEPTED)، b1 18/18، b4fe 29/29، b4rb 9/9. الجدول الكامل بمسارات السجلات: `TEST-EVIDENCE-INDEX.md` §A. هذه الأرقام **قُرئت من سجلات الجولة (04:56–05:00 يوم 2026-10-17) ولم تُعَد في مهمة التسليم**.
**ما لا تثبته:** لا Firefox/Safari/جهاز حقيقي؛ لا مزوّد حي؛ فحوصات slice 5/7 هي اختبارات أدلة تاريخية أُعيد تشغيلها على الشجرة المُصلَحة.

### 3.4 العائق المعروف والحدود الأمنية (من `docs/DEPLOYMENT-LAN.md`)
- **BLOCKED (سابق لـB4 ومُقاس):** من عنوان غير loopback عبر HTTP عادي: `isSecureContext=false`، لا `crypto.subtle`، لا Service Worker، والإقلاع لا يكتمل (سجلات `release-v1-lan-secure-context-probe-*`). أي أن تعريض الخلفية على LAN **لا يعني** إمكان فتح التطبيق من جهاز آخر. الحل المحتمل (وكيل HTTPS عكسي أمام الواجهة) **غير مُنفَّذ ولا مُختبَر** = UNVERIFIED.
- HTTP عادي: المفتاح يمرّ بلا تشفير. CSP تحوي `'unsafe-inline'` (سكربت مضمَّن + معالجات `onclick`) فهي لا تمنع XSS عبر سكربت مضمَّن. `frame-ancestors`/HSTS لا تُضبط عبر `<meta>`. `X-Forwarded-For` يُصدَّق دائمًا في المسارات العامة (قابل للتزوير). وسيط MQTT (معطّل افتراضيًا) لم يُشدَّد. المفتاح لا يُشارَك بين تبويبين ويُفقد عند التحديث (سلوك مقصود). تنفيذ الشيفرة (sandbox) معطّل افتراضيًا وليس حدًّا أمنيًا حقيقيًا إن فُعِّل.
- B3 (محادثة/بث/إلغاء/fallback/ميزانية بمزوّد حقيقي): **PENDING — DATA NOT EXECUTED** (لا مفتاح مزوّد في بيئة البناء). لم يُستخدَم خادم وهمي لإثبات نجاح حي.

---

## 4) الأعمال المعلّقة في Slice 2/3/4 (أدوات الأدلة المرتبطة ببايتات الـMonolith)
هذه الأدوات تقارن/تحلل بايتات الـHTML و`main.js`؛ وقد تغيّرت البايتات بعد B1/B4 (وبعد الشريحتين 9/10). **لم تُنفَّذ أي أعمال تحديث في هذه المهمة.** النتائج الحالية على clone `cbdc898`:

| الأداة | النتيجة | الحالة |
|---|---|---|
| Slice 2 probe | 19/19 | VERIFIED |
| Slice 3 analyzer | 23/23 | VERIFIED |
| Slice 4 exec-order | 9/9 | VERIFIED |
| Slice 4 unit-vs-original | 36/36 | VERIFIED |
| Slice 4 extract-verify | **11/17** — فشل: P2b, P5, P6c, P7, P7b, P7c | **PENDING — تحديث الأدلة** |

- P2b/P5/P7c تنجح عند `711f353` وتفشل على شجرة B4 ⇒ **تُنسَب إلى B4** (مقارنات بايت-ببايت مع «قاعدة» الشريحة 4).
- P6c/P7/P7b تفشل أصلًا عند `711f353` (فحوص نطاق التغيير الزمني) ⇒ سابقة لـB4.
- هذا استنتاج مبني على مقارنة سجلّين (`tool-slice4-extract-verify*.log`)، وليس تشخيصًا لكل فحص.
- **المطلوب لاحقًا (لم يُنفَّذ):** إعادة تأسيس «قاعدة» صريحة ومُسجَّلة للأداة (لا إضعاف للفحوص)، أو توثيق أن فحوص النطاق مستبدلة بأدلة أحدث. انظر §9 البند 4.

---

## 5) حالة B6 وطريقة تشغيل الـScorer وحدود 37/37
**الملفات (`eval/arabic-v1/`، غير ملتزَم بها، 7 ملفات، `sha256sum -c` سليم):**
`dataset.jsonl` (38 عنصرًا، sha256 `52ab8e80…42ec`) · `build_dataset.py` · `criteria.frozen.md` (معايير مجمّدة، sha256 `ac152b00…c493a`) · `judge-prompt.md` · `score.mjs` · `README.md` · `SHA256SUMS.txt`.

**ما تحقق منه فعلًا:** Scorer يعمل: `node score.mjs --self-test` ⇒ `SELF-TEST (SYNTHETIC responses — validates the scorer, NOT any model): 37/37` (أُعيد تشغيله عند التغليف، قراءة فقط: `EXT/b6-self-test-rerun-at-packaging.log`).

**كيف يُشغَّل:**
1. اختبار ذاتي: `cd eval/arabic-v1 && node score.mjs --self-test`
2. تقييم حقيقي (للمالك، بمفتاح مزوّد حقيقي): أرسل كل `prompt` عبر مسار NEXUS الحقيقي (الواجهة أو `POST /api/chat` على خلفية بمفاتيح)، اكتب `responses.jsonl` (`{"id","response"}` في كل سطر) مع تسجيل المزوّد والنموذج والتاريخ وcommit؛ ثم `node score.mjs --dataset dataset.jsonl --responses responses.jsonl --out results.json`؛ ثم بروتوكول القاضي في `criteria.frozen.md` §3 مع `judge-prompt.md` وبنموذج **مختلف**.

**حدود 37/37 (مهمة):**
- الاستجابات **اصطناعية** كتبتها أنا لاختبار منطق الفحوص (نجاح/فشل متوقَّع)؛ لا تقول شيئًا عن جودة أي نموذج.
- يغطي الفحوص الآلية (regex/وجود حقائق/…) فقط؛ لا يقيّم السلامة اللغوية أو الدقة الدلالية — هذه مهمة القاضي (لم يُشغَّل).
- العناصر 38 والاختبار الذاتي 37 (عدّادان مختلفان: العناصر ≠ حالات الاختبار الذاتي).
- فحص الطفرات للـScorer: بحسب سجل الجلسة نجت طفرة «n-of-facts» أولًا فأُضيفت حالات اختبار ذاتي حتى قُتلت. **لا سجل محفوظ لهذه الطفرات داخل الحزمة** (PENDING VERIFICATION)، ولا أدّعي أن الفحوص كاملة.
- **تقييم النماذج الحقيقي: PENDING — DATA NOT EXECUTED.** العتبات في `criteria.frozen.md` مقترحة ولم تُختبر على بيانات حقيقية.
- **عيوب توثيقية معروفة (لم تُصلَح لأن المهمة تمنع تعديل الملفات):** `README.md` يشير إلى سجلات `release-v1-b6-*.log` غير موجودة ويذكر «5 mutants» دون دليل محفوظ؛ `criteria.frozen.md` يذكر «8 categories» والبيانات 7. لا يُعدَّل الملف المجمَّد لإصلاح ذلك؛ يُصحَّح عبر ملف errata (§9).

---

## 6) القرارات المعمارية المرجعية
| القرار | الخلاصة | المصدر الأصلي |
|---|---|---|
| ADR-000 Baseline | تثبيت الأساس والتحقق بـ MD5/diff | `ADR/000-baseline.md` |
| ADR-001 Phase 1 Security | فصل التخزين، تعقيم السجل، تأكيد الاستيراد | `ADR/001-phase1-security.md` (Accepted) |
| ADR-002 Phase 2 Modularize | استخراج مع حفظ السلوك، لا إعادة كتابة | `ADR/002…` (Accepted) |
| ADR-003 | `PERSISTABLE_STATE` والمتغيرات الـ16 تبقى في السكربت الكلاسيكي. Erratum 2026-10-12 يصحّح ادعاءات واقعية (Chromium 141) **دون تغيير القرار** | `ADR/003…` (Accepted) |
| ADR-004 | Evidence Integrity: اتفاق الوكلاء وحده لا يرفع الحالة؛ Evidence Delta حقيقي مطلوب؛ fail-closed | `ADR/004…` (Accepted) |
| ADR-005 | ملكية الحالة بـ global accessor: **انتقالي، لكل متغير، لـ`agentOrder` فقط**؛ `messages`/`selectedAgentIds` لم تُمسّ | `ADR/005…` (Accepted كمرحلة انتقالية) |
| D5 (قرار المالك 2026-10-14) | **ContextFabric يبقى classic**؛ `NexusContext` **لا يُنقل الآن**؛ الاختبار التوصيفي لـ`fullAgentPrompt` شرط سابق (أُنجز: CP-19)؛ أي نقل لاحق يُفضَّل بحقن تبعية صريح (أ)؛ الوصول بالاسم المجرّد (ب) ممنوع؛ التنفيذ يحتاج موافقة صريحة لاحقة | انظر التحقق أدناه |

**التحقق من استمرار D5 بالرجوع إلى الوثائق الأصلية (نتيجة فعلية):**
- `docs/checkpoints/CP-19.md` (المستودع): «نقل `NexusContext`/`ContextFabric`: **لم يبدأ** (قرار D5)» و«الاختبار التوصيفي شرط سابق (قرار D5) لأي نقل لاحق». ✔ متسق.
- `NEXUS-CURRENT-STATE.md` (المستودع) و`PHASE2-MODULARIZE.md`: `NexusContext`/`ContextFabric` ضمن المتبقي في core (PENDING) ولم تُمسّ. ✔ متسق.
- مرجع المشروع `NEXUS-CLAUDE-PROJECT-INSTRUCTIONS-REFERENCE-2026-10-15.md`: «لم يُحسم نقل `NexusContext/ContextFabric`؛ لا تبدأ دون تشخيص وقرار صريح». ✔ لا يتعارض (لا نقل بلا قرار صريح).
- **نص الخيارات (ج/أ/ب) لا يظهر حرفيًا في وثائق المستودع ولا في وثائق المشروع المرفوعة** التي رجعت إليها؛ مصدره الوحيد الذي وجدته هو سجل قرارات المالك المحفوظ في ذاكرة المشروع (مؤرَّخ 2026-10-14). لذا: **جوهر القرار (لا نقل الآن، التوصيف أولًا) = VERIFIED في الوثائق؛ تفاصيل الخيارات (ج/أ/ب) = PENDING VERIFICATION مقابل وثيقة أصلية** — يُنصح بإدراجها في ADR أو CP-20.
- مراجع إضافية تبقى سارية: ADR-003 (16 متغيرًا تبقى)، ADR-005 (آلية accessor لـ`agentOrder` فقط، لا تعميم دون قرار مالك).

---

## 7) البناء والاختبارات والبيئة والتبعيات والتراخيص والملكية الفكرية
**البيئة المقاسة:** Node v22.22.0، npm 10.9.4، Chromium 141.0.7390.37 (مُوفَّر من البيئة عند `/opt/pw-browsers`)، Playwright 1.56.1، Linux.

**أوامر البناء والاختبار (من `package.json` والسجلات):**
- الخلفية (`src-baseline/nexus-backend`): `npm ci` → `npm run build` (`tsc -p tsconfig.build.json` + نسخ migrations) → `npm start` (`node --experimental-sqlite … dist/index.js`)؛ `npm run typecheck`؛ `npm test` (`tsx --test test/**/*.test.ts`).
- الواجهة (`frontend`): `npm ci` → `npm test` (`vitest run`، 7 ملفات). تُقدَّم كملفات ثابتة عبر HTTP (`python3 -m http.server 8080 --bind 127.0.0.1`)؛ لا يوجد `index.html` (الصفحة `neural_nexus_ai_agents-4-3-5-3.html`) ولا تعمل من `file://`.
- E2E (`e2e`): **لا يوجد lockfile**. التثبيت: `npm install --no-package-lock --no-save playwright@1.56.1`. تعمل بـ`node e2e/<script>.mjs` ضد الواجهة والخلفية (بعضها يتطلب خلفية مبنية؛ انظر `NEXUS-CONTINUATION.md`).
- مجموعات الاختبار المُسجَّلة: Backend 502/502، Frontend 186/186 (قبل الالتزام، §3.2)، 14 E2E (على clone نظيف).

**التبعيات (مباشرة) وتراخيصها كما تُقرأ من `package.json` المثبّتة محليًا:**
| الحزمة | الإصدار المثبّت | الترخيص |
|---|---|---|
| vitest | 4.1.11 | MIT |
| jsdom | 30.0.1 | MIT |
| fake-indexeddb | 6.2.5 | Apache-2.0 |
| @vitest/coverage-v8 | (devDependency ^4.1.11؛ مثبّت محليًا) | MIT |
| playwright (E2E) | 1.56.1 | Apache-2.0 |
| typescript (الخلفية) | 7.0.2 (المُعلَن `"*"` — غير مثبّت) | Apache-2.0 |
| @types/node | 22.20.1 | MIT |
| tsx (يُستخدم في `npm test`/`dev`) | 4.23.12 | MIT — **غير مُصرَّح به** (انظر أدناه) |

**نتائج وجدتها أثناء التوثيق (لم تُصلَح؛ لا تعديل ملفات في هذه المهمة):**
1. **`tsx` غير مُصرَّح به** في `package.json` ولا في `package-lock.json` للخلفية (القفل 24 مدخلًا يشمل الجذر، ولا يتضمنه؛ `node_modules/.bin` فيه `tsc` فقط). السكربتان `test` و`dev` يستدعيانه، وفي هذه البيئة يُحَلّ من تثبيت عام (`/home/claude/.npm-global/bin/tsx`, نسخة `/opt/npm-tools`). على جهاز بلا `tsx` عام يُرجَّح فشل `npm test` بعد `npm ci` — لكن **لم أختبر ذلك** (PENDING VERIFICATION). التثبيت نفسه موجود منذ لقطة الأساس `7f7a5f8`.
2. `typescript: "*"` غير مثبّت؛ المُثبَّت في القفل/البيئة 7.0.2.
3. E2E بلا lockfile.
4. لا يوجد ملف `LICENSE` في المستودع. `package.json` للواجهة والخلفية `"private": true` بلا حقل ترخيص؛ `e2e/package.json` فيه `"license": "ISC"` وهو قيمة افتراضية من `npm init` وليست بيانًا عن الملكية.
5. **الملكية الفكرية: PENDING VERIFICATION.** لا ترويسات حقوق نشر/SPDX في المصدر، وسجل Git يحمل مؤلِّفين محليين فقط (`NEXUS Baseline Agent <nexus-baseline@local>` ×22، `nexus <nexus@localhost>` ×1). **لا أستنتج ملكية قانونية للكود**؛ يلزم مستند من المالك (اتفاقية/ترخيص/إقرار). لم يُجرَ أي فحص لتراخيص التبعيات غير المباشرة (24 مدخلًا في قفل الخلفية، وقفل الواجهة لم يُحلَّل).

**ما استُبعد من الـZIP وأثره على إعادة الاختبار (انظر `MANIFEST.md`):**
| المُستبعَد | الأثر | المعالجة |
|---|---|---|
| `.git` | يفقد التاريخ | استُبدل بـ`git/nexus-v5-v5.0-polish.bundle` (تحقق بـ`git bundle verify` ثم clone: HEAD `cbdc898`، 23 commit، 854 ملفًا). **انحراف معلن عن «استبعد .git»** لأنه لا يوجد remote للاستعادة منه |
| `node_modules` (الثلاث) | لا يمكن تشغيل الاختبارات قبل التثبيت | `npm ci` في الواجهة والخلفية؛ E2E: الأمر أعلاه |
| `src-baseline/nexus-backend/dist` | يلزم بناء | `npm run build` |
| `src-baseline/nexus-backend/data/` (قاعدة SQLite تجريبية مُتجاهَلة، ~389 KB) | تُنشأ من جديد | لا إجراء |
| Chromium | مطلوب لـE2E | مُوفَّر من البيئة (`PLAYWRIGHT_BROWSERS_PATH`) أو ثبّته بنفسك |
| أي `.env`/أسرار | لا أثر | لا يوجد `.env` في المستودع؛ `.env.example` فقط |

**فحص الأسرار على الملفات المُجهَّزة:** لا ملف `.env`؛ لا أنماط توكنات؛ مطابقات `NEXUS_*KEY` هي تعيينات فارغة أو ثوابت اختبار وهمية معروفة (FAKE) في ملفات اختبار وسجلاتها. (فحص إضافي على المحتوى المفكوك يُجرى في التحقق النهائي ويُذكر في الرد.)

---

## 8) وظائف المنتج وحالة واجهة HTML والمخاطر والفجوات
**الوظائف الموجودة في الشيفرة (وجود الكود ≠ تحقق وظيفي):**
- الخلفية (`src/`): وحدات `agents, capability, config, core, council, dreaming, evaluation, evolution, finetuning, gateway, intent, iot, knowledge, memory, metacognition, observability, orchestrator, persistence (16 migrations), providers, research, routes (v2 + legacy), sandbox, scheduler, security, streaming, swarm, tools, warden`. مهايئات المزوّدين: Anthropic, OpenAI, DeepSeek, Gemini, Ollama, LM Studio + موجّه نماذج وصحة ومرونة. مسارات legacy: `auditVeto, chat, embed, runtime, schedules, sync, toolsAndMarket`.
- التحقق الفعلي منها: 502 اختبار خلفية (وحدات/تكامل بـmock). **لا يوجد أي تحقق حي مع مزوّد حقيقي** (B3 PENDING).
- الواجهة: تطبيق HTML واحد أحادي (~945 KB) + `main.js` + 5 وحدات ES (`security, storage, utilities, settings, state`) + `sw.js` للعمل دون اتصال (VERIFIED في Chromium headless: إقلاع offline مع SW حقيقي).

**حالة الواجهة:** الحدود 6–9 (agents, modes, ops-center, workspace) وبقية الواجهة **ما زالت داخل المونوليث (PENDING)**. `agentOrder` المتغير الوحيد المنقول بآلية الـaccessor؛ `window.agentOrder` قابل للقراءة/الكتابة من أي سكربت في الصفحة (مخاطرة معلنة في ADR-005). `sw.js` مؤلَّف حديثًا وليس مُسترجَعًا.

**المخاطر والفجوات (مرتبة بالأثر):**
1. **BLOCKED:** الاستخدام من جهاز آخر على LAN عبر HTTP (قيد السياق الآمن). HTTPS/وكيل: UNVERIFIED.
2. B3/B6 الحقيقيان لم يُنفَّذا ⇒ لا دليل على جودة الإجابات العربية ولا على سلوك المزوّد الحي (بث، إلغاء، fallback، ميزانية).
3. B5 (الأداء) لم يبدأ: لا Lighthouse/FCP/حجم الحزمة/زمن `persistState` عند سقف الرسائل. حجم الملف الواحد 945 KB.
4. حالة المشروع في الوثائق قديمة وفيها تناقض مع المستودع (`NEXUS-CURRENT-STATE.md` لا يزال يقول إن `sw.js` غير موجود ويصف الشريحة 10 كالهدف الحالي؛ لا CP-20؛ لا سجل لـB1/B4/B6 فيه). المستودع هو المرجع.
5. أداة الشريحة 4 تفشل 6/17 (§4). حزمة B6 غير ملتزَم بها (خطر فقدان) وبها عيوب توثيقية (§5).
6. أمنيًا (معلن): CSP `'unsafe-inline'`، XFF قابل للتزوير، MQTT غير مشدَّد، لا TLS، لا multi-tenant، تنفيذ الشيفرة ليس حدًّا أمنيًا.
7. إعادة الإنتاج: `tsx` غير مُصرَّح به، `typescript: "*"`، لا lockfile لـE2E.
8. فلاكي معروف **E-1** (ظهر مرة في `seed-flows`: 15/16 ثم 16/16؛ مُسجَّل في `NEXUS-CURRENT-STATE.md`) — سببه لم يُشخَّص.
9. تغطية المتصفحات: Chromium 141 headless فقط.
10. آثار جانبية للجلسة: worktree مسجَّل `scratchpad/work/b4-pre` ورابط رمزي `/home/claude/nexus-v5` (يشير إلى clone الانحدار `scratchpad/work/regress/nexus-v5`) — لم أحذفهما (المهمة تمنع). IP/ترخيص: §7.

---

## 9) خطة العمل التالية (بحسب الاعتماديات والأولوية، مع معايير قبول قابلة للتحقق)
> كل بند = شريحة هدف صغيرة منفصلة: INSPECT → MAP → DIAGNOSE → PATCH → TEST → VERIFY → DOCUMENT → STOP. لا يبدأ بند يعتمد على آخر قبل إغلاق الاعتماد. البنود 1–2 تحتاج موافقة المالك على commit.

| # | البند | يعتمد على | معيار قبول قابل للتحقق |
|---|---|---|---|
| 1 | **حماية الحزمة B6 والحالة**: commit لملفات `eval/arabic-v1/` (بموافقة صريحة) | موافقة المالك | `git status --porcelain=v1 -uall` فارغ؛ `sha256sum -c eval/arabic-v1/SHA256SUMS.txt` سليم؛ لا تغيير في ملفات الإنتاج |
| 2 | **CP-20 (docs فقط)** + تحديث `NEXUS-CURRENT-STATE.md`: HEAD الفعلي، `sw.js` موجود (B1)، B4، B6، العوائق، قرار D5 بنصّه، ADR/ملحق errata لعيوب B6 (دون تعديل الملف المجمَّد) | 1 | كل جملة حالة في الوثيقة تقابل سجلًا؛ لا كلمة DONE؛ `git diff --stat` لا يمس غير `*.md`؛ مطابقة الأرقام مع `TEST-EVIDENCE-INDEX.md` |
| 3 | **إصلاح قابلية إعادة الإنتاج** (بموافقة): تصريح `tsx` في devDependencies وتثبيت `typescript` وlockfile لـE2E | 2 | على جهاز/مجلد بلا `tsx` عام: `npm ci && npm test` في الخلفية ⇒ 502/502 أو ما يُنتج لاحقًا مع تفسير الفرق؛ `npm ci` يمرّ بلا تغيير في القفل |
| 4 | **تحديث أدلة الشريحة 4** (أداة `extract-verify`) بقاعدة صريحة جديدة | 2 | 17/17 على «قاعدة» موثّقة مع تبرير لكل فحص مُعدَّل، أو توثيق صريح بأن فحوص النطاق مستبدلة؛ **لا إضعاف** لأي فحص؛ سجلا PRE/POST محفوظان |
| 5 | **B5 خط أساس الأداء** (لا يحتاج مفاتيح) | 2 | تقرير رقمي: Lighthouse (الإصدار/الإعدادات/الجهاز المحاكى)، FCP، حجم الحزمة بالبايت، زمن `persistState` عند سقف الرسائل — كل رقم بطريقة قياس قابلة للتكرار ≥3 تشغيلات وبانحراف مُعلَن؛ لا ادعاء «سريع/بطيء» بلا عتبة مجمَّدة مسبقًا |
| 6 | **B3 تحقق مزوّد حي** (يحتاج مفتاح المالك) | مفتاح مزوّد؛ 2 | تشغيل فعلي مسجَّل لـ: محادثة، بث، إلغاء، fallback، سقف الميزانية — بلا مفتاح في السجلات (فحص grep موثّق)؛ كل عنصر PASS/FAIL مع سجل |
| 7 | **B6 تقييم عربي حقيقي** | 6، 2 | `responses.jsonl` من تشغيل حقيقي (لا نصوص مكتوبة يدويًا)؛ نتائج `score.mjs`؛ تقييم قاضٍ بنموذج مختلف وفق `criteria.frozen.md` §3؛ العتبات كما جُمِّدت؛ إن فشلت: تُسجَّل FAILED لا تُعدَّل العتبات |
| 8 | **قرار مسار LAN/HTTPS** (قرار مالك ثم تنفيذ) | قرار المالك | من أصل غير loopback عبر HTTPS: `isSecureContext=true`، SW يُسجَّل، الإقلاع يكتمل، CSP بلا انتهاكات، مسار المفتاح يعمل (نفس سكربتات B1/B4 مكيَّفة) — وإلا يبقى BLOCKED/UNVERIFIED |
| 9 | **ديون التحصين**: XFF، إزالة `'unsafe-inline'` تدريجيًا، MQTT، Firefox/Safari، تشخيص E-1، إزالة worktree الجانبي (بموافقة) | 2 | لكل بند: اختبار PRE يفشل → POST ينجح؛ لا تراجع في الـ14 E2E |
| 10 | **استئناف Phase 2** (core المتبقي: `PERSISTABLE_STATE` والمتغيرات الـ15، `ContextFabric`/`NexusContext`، ثم الحدود 6–9) | قرارات المالك (ADR-005 R5، D1–D4، D5) وإغلاق 2 | لكل شريحة معايير مجمَّدة قبل الكود، PRE/POST، وانحدار كامل؛ **لا يبدأ نقل ContextFabric إلا بموافقة صريحة وبحقن تبعية صريح (أ)** |

---

## 10) NEXT SESSION — START HERE

**نقطة الاستئناف (حقائق قابلة للتحقق، لا افتراضات):**
- الفرع `v5.0-polish`، HEAD `cbdc898a3ba605211d9791979a6415f314ba1c8f`، لا remote، 7 ملفات `eval/arabic-v1/*` غير متتبعة، لا تغييرات على ملفات متتبعة.
- لا تفترض أن شجرة العمل نظيفة: أعد تشغيل `git status --porcelain=v1 -uall` أولًا. **لا إعلان جاهزية إصدار.**

**استعادة المشروع من هذه الحزمة (جُرِّبت فعليًا عند التغليف في مجلد معزول: النتيجة HEAD `cbdc898`، 0 ملفات معدّلة، 7 غير متتبعة):**
```bash
unzip NEXUS-HANDOFF-2026-10-17.zip && cd NEXUS-HANDOFF-2026-10-17
sha256sum -c SHA256SUMS.txt                 # تحقق من السلامة
git clone git/nexus-v5-v5.0-polish.bundle nexus-v5     # التاريخ + الفرع
cp -a repo-snapshot/nexus-v5/. nexus-v5/                # يعيد ملفات B6 غير المتتبعة (الملفات المتتبعة مطابقة لـHEAD)
cd nexus-v5 && git status --porcelain=v1 -uall          # المتوقع: 7 سطور ?? eval/arabic-v1/* فقط
# تبعيات: (frontend) npm ci ؛ (src-baseline/nexus-backend) npm ci && npm run build ؛ (e2e) npm install --no-package-lock --no-save playwright@1.56.1
# ملاحظة: اختبارات الخلفية تحتاج tsx (غير مُصرَّح به — §7).
```

**اقرأ أولًا بهذا الترتيب (كلها داخل الحزمة):**
1. هذا التقرير، ثم `GIT-STATE.txt` و`TEST-EVIDENCE-INDEX.md`.
2. `repo-snapshot/nexus-v5/NEXUS-CURRENT-STATE.md` (**قديم جزئيًا — المستودع يتغلّب عليه**) و`NEXUS-CONTINUATION.md`.
3. `docs/checkpoints/CP-19.md` ثم `CP-17.md`/`CP-18.md`، و`ADR/003` و`ADR/005`.
4. `docs/DEPLOYMENT-LAN.md` و`baseline/evidence/release-v1-b4-acceptance-criteria.md` و`release-v1-b1-acceptance-criteria.md`.
5. `eval/arabic-v1/README.md` و`criteria.frozen.md` (مجمَّد: لا يُعدَّل).
6. مرجع المشروع: `NEXUS-CLAUDE-PROJECT-INSTRUCTIONS-REFERENCE-2026-10-15.md` وتعليمات المشروع الدائمة (خارج الحزمة، في Claude Project).

**الخطوة الهندسية التالية (أصغر شريحة آمنة):** البند 1 ثم 2 من §9 — **حماية حزمة B6 بـcommit (بموافقة صريحة من المالك) ثم CP-20 كوثائق فقط** لإزالة تناقض وثائق الحالة مع المستودع؛ بلا أي تغيير في كود الإنتاج. بعدها، إن أراد المالك أسرع تقدّم لا يحتاج مفاتيح: البند 5 (B5). البنود المعتمدة على مفتاح مزوّد (3→6→7) تنتظر المالك. **لا تبدأ نقل ContextFabric/NexusContext ولا شرائح 2/3/4 ولا تقييم B6 دون قرار/موافقة صريحة.** ثم STOP بعد كل شريحة.

**ما هو ممنوع افتراضه:** أن الاختبارات التاريخية «أُعيدت» اليوم؛ أن B3/B6 تحقّقا؛ أن LAN يعمل من جهاز آخر؛ أن الكود مملوك قانونيًا لجهة معيّنة؛ أن `sw.js` أصلي؛ أن غياب الأخطاء مُثبَت.
