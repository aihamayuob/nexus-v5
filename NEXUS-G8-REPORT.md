# NEXUS-G8-REPORT — تصنيف الأثر الإلزامي للأدوات (VEL gap G8)

**Final Status: PARTIAL.** البوابة تعمل وتُنفَّذ عند التسجيل/الإقلاع وتُثبتها الاختبارات؛ لكنها إقرار لا إثبات، ولم تُطبَّق على مستودعك الحي. لا commit ولا push. ADR الخاص بـVEL ما زال **PROPOSED**.

> فصل الأدلة: **[كود]** قراءة مصدر · **[عُدِّل]** تغيير فعلي · **[اختُبر]** نُفِّذ في هذه الجولة (2026-10-21) مع سجل في `B-evidence/G8/evidence/` · **[لم يُختبر]**.

## قرارات المالك المنفَّذة في هذه الجولة
1. الشريحة التالية = **G8** (بند واحد فقط).
2. تعديل سطر AC-7 في `evidenceIntegrity.test.ts` **مقبول** (لم يُمَس هنا).

## خط الأساس (أُعيد التحقق منه من الحزمة، لا من التقرير)
- **[اختُبر]** SHA256SUMS: 905/905 مطابقة. `tsc` exit 0. اختبارات VEL **44/44**. المجموعة الكاملة **590/590**. `npm run build` exit 0. تشغيل `dist`: `/v2/health` 200، `/v2/execution-receipts` `{"receipts":[]}`، `status=BOGUS` ⇒ 400. (سجلات `00-baseline-*`). يطابق تقرير VEL.
- لا `.git` في الحزمة؛ الفرع/HEAD غير مُتحقَّق منهما. ADR-006 ما زال غير موجود في المصدر المتاح.

## الفجوة (G8) [كود]
قبل الشريحة: `ToolRegistry.register()` يقبل أي أداة. من يكتب أداة بأثر خارجي بـ`execute()` عادية يتجاوز VEL بصمت؛ و`effect`+`execute` معًا كان مقبولًا (خط الأنابيب يتجاهل `execute` بصمت).

## ما عُدِّل [عُدِّل] — 7 ملفات (6 معدّلة/1 جديد)، بصماتها في `changed-file-hashes.txt`
| الملف | التغيير |
|---|---|
| `src/tools/effectTypes.ts` | نوع `EffectClassification`: `pure` · `read_only` · `legacy_exempt`(+`compensatingControls`) |
| `src/tools/registry.ts` | `register()` يرفض: `effect`+`execute`؛ `effect`+`effectClass`؛ `execute` بلا `effectClass` صالح (kind معروف، reason ≥10 أحرف، controls لـlegacy). المخزَّن نسخة سطحية مجمَّدة (والتصنيف مجمَّد). `listLegacyExemptions()` |
| `src/tools/bootstrap.ts` | تحذير إقلاع لكل `legacy_exempt` |
| `builtin/calculateTool.ts` | `pure` |
| `builtin/webFetchTool.ts` | `read_only` (GET فقط عبر `safeFetch`؛ أثر GET على خادم بعيد غير مغطّى — مذكور في السبب) |
| `builtin/codeExecutionTool.ts` | **`legacy_exempt`** — لأن `sandbox.ts` نفسه يقرّ: لا jail للملفات ولا عزل شبكة ولا حد عمليات. لم أصنّفه `pure/read_only` لأن ذلك كذب. مغلقة افتراضيًا + تدقيق + بيئة مصغّرة |
| `test/toolEffectClassification.test.ts` (جديد) | 10 اختبارات G8-1…G8-10 |

**لا تغيير** في سلوك الأدوات الثلاث ولا في `pipeline.ts` ولا الهجرات ولا الواجهة ولا أي اختبار قائم. توثيق: `docs/VEL-VERTICAL-SLICE.md` (قسم G8) و`ADR/PROPOSED-…` (ملحق) — هذان لا تشملهما الرقعة.

## النتائج الفعلية [اختُبر]
| الفحص | النتيجة |
|---|---|
| `npx tsx --test test/toolEffectClassification.test.ts` | **10/10**، 3 تشغيلات متتالية |
| طفرات تخريبية (`mutations/run_mutations.py`) | **12/12 اكتُشفت** (حذف كل فحص على حدة؛ إضعاف الحد الأدنى؛ تصنيف `code_execution` كـread_only؛ تصنيف `web_fetch` كـlegacy بلا تعديل التثبيت؛ إزالة تصنيف من `calculate` فيفشل bootstrap؛ تسجيل مسرَّب `.register(` في `src/`). الملفات أُعيدت مطابقة بالبصمة |
| `tsc --noEmit` | exit 0 |
| المجموعة الكاملة | **600/600** (590 + 10)، 0 فشل/إلغاء/تخطٍّ |
| `npm run build` + تشغيل `dist` | exit 0؛ `/v2/health` 200؛ يظهر تحذير `legacy_exempt` لـ`code_execution` في سجل الإقلاع |
| الرقعة | تُطبَّق نظيفة على نسخة VEL (`patch -p1`) والناتج مطابق للقطة الجديدة |

ما تثبته الاختبارات: الفحوص الثلاثة تعمل، المخزَّن غير قابل للتعديل في مكانه، التصنيفات الحالية مطلوبة، قائمة `legacy_exempt` مثبَّتة = `['code_execution']`، مسار الإقلاع الحقيقي (`bootstrapTools`) يمر، ولا ملف في `src/` غير `bootstrap.ts` يستدعي `.register(`.

## حدود معروفة (لا تُفسَّر كأمان)
1. **إقرار لا إثبات:** لا شيء يتحقق أن تصنيف `pure/read_only` صحيح. الحد الأدنى للطول حاجز أمام الحشو فقط.
2. من يستورد دوال موصل ويستدعيها مباشرة يتجاوز البوابة (حد مراجعة كود، كما في VEL).
3. حارس مواقع التسجيل (G8-10) فحص نصي لـ`.register(` في `src/`؛ لا يلتقط التفافًا مثل `bind` أو تسجيلًا ديناميكيًا.
4. التجميد **سطحي**: كائن `effect` و`def` المتداخلان يبقيان قابلين للتعديل.
5. إعادة التسجيل بالاسم نفسه ما زالت تستبدل بصمت (سلوك قائم لم يُغيَّر): أداة مصنَّفة قد تحلّ محل أداة VEL إن سُجّلت بالاسم نفسه. لم أعالجه (خارج الشريحة؛ قرار).
6. **`code_execution` يبقى بلا بوابة VEL** عند تفعيله — هذه فجوة حقيقية موثَّقة، ليست مُعالَجة.
7. G7 (IoT push، رفع fine-tuning، webResearch، `/api/tools/fetch`، المجدول) لم تُمَس.
8. لم يُشغَّل: e2e Chromium، vitest، عملية حقيقية، المستودع الحي. الواجهة لم تتغير.

## قرارات تنتظرك
1. **`code_execution`:** (أ) إبقاؤه `legacy_exempt` كما هو، (ب) تحويله إلى مسار VEL (يغيّر سلوكه: سياسة+إيصالات)، (ج) إزالته من التسجيل الافتراضي.
2. سياسة إعادة التسجيل بالاسم نفسه (رفض/السماح فقط بعد `clear()`).
3. تجميد عميق لـ`effect`/`def`؟
4. باقي بنود تقرير VEL المفتوحة: رقم ADR وتعريف VERIFIED (وADR-006)، G7، واجهة الحالات، موافقة لكل فعل، سلسلة تجزئة، commit/push، وتطبيق الرقع (VEL ثم G8) على المستودع الحي.

## إعادة التشغيل
```bash
cd A-source-snapshot/src-baseline/nexus-backend
npm i --no-save tsx typescript @types/node
npx tsx --test test/toolEffectClassification.test.ts        # 10/10
npx tsx --test 'test/**/*.test.ts' 'test/*.test.ts'          # 600 / 0 فشل
npx tsc -p tsconfig.json --noEmit && npm run build
# رقعة G8 فوق لقطة VEL:  patch -p1 < B-evidence/G8/G8-changes.patch   (من src-baseline/nexus-backend)
```
التراجع: عكس الرقعة. لا هجرات ولا بيانات متأثرة.
