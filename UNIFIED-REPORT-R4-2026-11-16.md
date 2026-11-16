# NEXUS — التقرير الموحّد R4 (2026-11-16)

كلمات الحالة فقط: VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED.

## 0. حالة المصدر (مهم)
شجرة R3 التي راجعها تقرير 2026-11-15 **لم تكن متاحة** (بحثتُ: المرفقات، GitHub، Drive، Dropbox، وثائق Project؛ المستودع الحي `aihamayuob/nexus-v5` مجرد dump لـzip/HTML للقراءة فقط). عملتُ على baseline 2026-11-14 (upstream `fba63d5`، commit محلي `e08f70b`) وأعدتُ تنفيذ تغييرات R3 المعتمدة من مواصفاتها الموثّقة. الدمج الحرفي مع شجرة R3 = **PENDING**.

## 1. الشرائح المنفَّذة (فرع محلي `work/r4-continue`، لم يُدفع، بلا tag)
| الشريحة | Commit | الحالة | الدليل |
|---|---|---|---|
| F06-a `NEXUS_TRUST_PROXY` (مغلق افتراضيًا؛ `true`/`*` تُتجاهل) | 2144f40 | VERIFIED | +12 اختبارًا، RED→GREEN |
| D-10 ترميز اسم نموذج Gemini | 79b9695 | VERIFIED | +3 |
| D-2 مسند seed-flows على البايتات المفكوكة + sentinel | c2cf2d2 | VERIFIED | سكربت قياس |
| D-9 verify-all بلا .git (snapshot/restore + تقرير drift) | 4e38448 | VERIFIED | اختبار الحارس |
| F-05 مكتبات محلية بـSHA-256 مثبّت، CSP بلا cdnjs، `isEvalSupported:false` | b9a4a30 | VERIFIED (قابلية استغلال pdf.js نفسها UNVERIFIED) | +6 Vitest، E2E 10 فحوص |
| F-03 يتيم PLANNING → FAILED عند الاستئناف | a9f76c3 | VERIFIED | mutants 4/4 |
| F-04 الـfallback يستعمل نموذج المزوّد الفعلي؛ صف المهمة يسجّل المزوّد/النموذج المُقدِّم | e895695 | VERIFIED (محوّلات محاكاة فقط) | +9 اختبارات (مصفوفة 20 زوجًا) |
| تحسين تبعيات الواجهة (audit 0/0) + SBOM CycloneDX 1.6 (192 مكوّنًا) | 8f0bb29 | VERIFIED (صلاحية المخطط، وليس ملكية/ترخيصًا) | مدقّق المخطط الرسمي + عيّنة سلبية |
| إصلاح TS18048 في اختبار متبنّى | 8275d2a | VERIFIED | اكتُشف بخطوة typecheck |
| ADR-007 (مقترَح) + وثائق الاستمرارية | 64469d7 | وثائق فقط | — |

## 2. التحقق النهائي على 8275d2a
`scripts/verify-all.sh`: 27/27 خطوة exit=0، OVERALL=0؛ backend **663/663**، Vitest **192/192**، سيناريوهات تشغيلية **39/39**، واجهة المشغّل **7/7** (390px بلا overflow، RTL/ar). الشجرة نظيفة بعد التشغيل. ملاحظة: التشغيل الأول كشف خطأ typecheck حقيقيًا (أصلحته وأعدتُ التشغيل كاملًا).

## 3. المزوّدون: حقيقي مقابل محاكاة
كل ما سبق **محاكاة**. المزوّدون الحقيقيون (Claude/OpenAI/Gemini/DeepSeek/Ollama/LM Studio) = **BLOCKED**: لا مفاتيح ولا مسار شبكة ولا سقف إنفاق مفوَّض. السكربت `e2e/real-provider-validation.mjs` جاهز ليشغّله المالك بمتغيرات بيئة.

## 4. التبعيات والتراخيص وSBOM وIP
SBOM: `evidence/nexus-sbom.cdx.json` (+ sha256 + `validation.out.txt`: 0 أخطاء مخطط). لم أنشئ LICENSE/NOTICE ولا أي إقرار ملكية. بقيت 6 صور base64 مجهولة المصدر؛ مكتبات الواجهة المضمّنة (qrcodejs/jsQR/pdf.js) تحمل تراخيصها في `frontend/vendor/`. قرار الترخيص وسجل IP = **PENDING (قرار المالك)**.

## 5. المخاطر المتبقية
CSP ما زالت `unsafe-inline` (~168 معالج)؛ pdf.js 3.11.174 < 4.2.67 (مخفَّف فقط)؛ لا TLS (HTTP/LAN)؛ identity الـkeyless للـrate-limit؛ لا اختبار أجهزة/Safari/Firefox/أداء/تغطية؛ تطابق cdnjs البايتي غير مُثبَت.

## 6. المحجوب وأسبابه
دفع/دمج للمستودع الحي (يحتاج موافقتك)؛ شجرة R3؛ مفاتيح المزوّدين وسقف الإنفاق؛ MCP M1/A2A/Connector SDK لم تبدأ (ADR-007 مقترَح، بحاجة قرارك على الحدود 30ث/1MiB/64 أداة وعلى نطاق M1). تحققتُ من مواصفة MCP الأولية: الإصدار الحالي 2026-07-28 (إصدار الإصدار لكل طلب عبر `_meta`، و`server/discover`)؛ تفاصيل A2A v1.0 ما زالت UNVERIFIED.

## 7. الخطوات إلى نسخة جاهزة للعرض/المشتري
1) شجرة R3 → دمج ثلاثي. 2) موافقة على دفع `work/r4-continue` لفرع مراجعة. 3) مفاتيح + سقف إنفاق → تحقق مزوّدين حقيقي. 4) ترقية pdf.js وإزالة `unsafe-inline`. 5) TLS عبر reverse proxy موثّق (F06-b). 6) ADR-007 → M1 ثم A2A. 7) قرار الترخيص/NOTICE وأصل الصور. 8) اختبار أجهزة/متصفحات/أداء.

## 8. ملاحظة على الحزمة
ملفات patches مرجعها للمراجعة؛ **الـbundle هو المرجع الحرفي** (ملف `LICENSE-qrcodejs.txt` بنهايات CRLF يطبّعها `git am`).
