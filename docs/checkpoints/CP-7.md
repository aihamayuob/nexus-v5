# CP-7 — Phase 2 (/nexus-modularize), boundary 5/9 "core": TARGET SLICE 1

**STATUS (الشريحة): VERIFIED** — **boundary core: PARTIAL** — **Phase 2: PARTIAL**

**الشريحة**: نقل `encryptState` و`decryptState` من المونوليث إلى
`frontend/modules/security.mjs` (حرفياً، أُضيفت `export` فقط) مع bridge
في `main.js` قبل استدعاءات startup. الأساس: commit `3a2796f`.

**ما لم يُلمس (عمداً)**: `PERSISTABLE_STATE`، متغيرات الحالة الـ16،
`NexusContext`، `ContextFabric`، ADR-003، `sw.js`، الـbackend.

**INSPECT/MAP (من المستودع)**: الدالتان تعتمدان فقط على `bufToB64`/
`b64ToBuf` (موجودتان في security.mjs) وglobals قياسية؛ المفتاح معامل.
مستدعيان فقط: `autoInitApp` و`persistState` (وقت الاستدعاء). لا معالج
inline ولا تنفيذ علوي مباشر. المسار الوحيد المتعدّي هو تسجيل
`window.onerror` → `logError` → `persistState`، وهذه الأخيرة تبدأ بـ
`if(!encryptionKey) return` ولا يُضبط المفتاح إلا داخل `autoInitApp`
بعد الـbridge — فلا افتراض ترتيب جديد.

**الأدلة (كلها fresh في هذه الجلسة على الشجرة النهائية)**
- Vitest: **132/132** (كان 116، +16). security.mjs: 100% أسطر/دوال.
- مكافئة السلوك: envelope مطابق بايت-ببايت للأصل (نفس المفتاح والـIV)،
  cross-decrypt في الاتجاهين، نفس نوع الخطأ عند الإدخال السيئ، ومتجه
  ذهبي مولَّد من كود HEAD الأصلي (يفكّ ويعيد إنتاج نفس الـenvelope).
- الرفض: مفتاح خاطئ، ciphertext/IV معبوث به، ciphertext مبتور، payload
  معطوب، plaintext غير JSON.
- Fault injection على الدالتين (5 تعديلات): كلها فشلت ≥2 اختبار؛
  استُعيد الملف بنفس sha256. (التعديل الخامس مُسمّى خطأً "AES-CBC" في
  echo؛ فعلياً يضيف بايتاً للنص الصريح.)
- E2E حقيقي (Chromium عبر Playwright، HTML الحقيقي بلا mocks):
  `phase2-core-seed-flows.mjs` **16/16** بعد الاستخراج؛ على الشجرة
  السابقة **15/16** والفاشل الوحيد `bridge-identity` (خاص بالرقعة، كما
  صُمّم). دورة persist→reload→restore الحقيقية تعمل. حذف
  `window.decryptState` وحده يُفشل `state-restored-after-reload` ويظهر
  "Decrypt error (starting fresh)" (سيناريو ضياع البيانات الصامت): 11 من 17 فحصاً تفشل؛ وحذف الاثنين يُفشل 13 من 17. النسخة الأولى من
  السكربت كانت تنهار (ReferenceError ثم انهيار ثانٍ في localStore.get)
  بدل أن تُبلّغ، فقُوّي الموضعان ثم أُعيد تشغيل pre/post/mutations بالسكربت
  النهائي.
- انحدار: `baseline-flows` **12/12**، `phase1-security-flows` **16/16**،
  backend `npm test` **406/406** و`tsc --noEmit` بلا أخطاء (الـbackend لم
  يُعدَّل؛ شُغِّل لتأكيد عدم وجود أثر جانبي).
- السجلات: `baseline/evidence/phase2-core-slice1-*`.

**القيود (غير مُتحقَّق منه)**: Chromium فقط (لا Firefox/Safari)؛ لا يوجد
typecheck/build للـfrontend؛ `sw.js` غير متوفر (المتابعة التراكمية ما
زالت 5 ملفات، هذه الشريحة لم تضف ملفاً جديداً).

**Deferred documentation finding (لا إجراء)**: فحص V8 (`vm.SourceTextModule`)
أظهر أن وحدة ES تقرأ/تكتب `let`/`const` العلوية في سكربت classic بالاسم
المجرد، وهذا يتعارض مع صياغة ADR-003. لم يُعدَّل الـADR ولم يُبنَ شيء
على هذا الفحص. الحسم يحتاج دليلاً على مستوى المتصفح. (Chromium متاح في
هذه البيئة عبر `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`؛ تصحيح لقولي
السابق إنه غير متاح — كنت قد فحصت `~/.cache` فقط.)

**ملاحظة بيئية**: سكربتات E2E تحمل المسار `/home/claude/nexus-v5/`؛ في هذه
الجلسة أُنشئ symlink خارج المستودع يشير إلى النسخة المفككة.

**الخطوة التالية الحرفية (واحدة)**: Core — Slice 2: اختبار browser-level
(Chromium) لتعارض ADR-003، دليل فقط بلا تعديل إنتاجي ولا تعديل ADR.
