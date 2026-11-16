# CP-9 — Evidence Integrity micro-invariant (داخل Phase 2؛ ليست Phase جديدة)

**STATUS (الـ guard): BLOCKED** — يتطلب قراراً معمارياً/منتجياً قبل أي patch (انظر «القرارات المطلوبة»).
**هذه الشريحة: فحص + خريطة + تجربة معزولة + توثيق فقط. صفر تغيير في كود الإنتاج.**
**Phase 2: PARTIAL** — **boundary core: PARTIAL** (دون تغيير: slice 1 VERIFIED، slice 2 VERIFIED كـ evidence-only، slice 3 لم يبدأ).

**المبدأ المطلوب إدخاله**: لا يجوز رفع حالة الدليل أو مستوى الثقة لمجرد اتفاق عدة Agents؛
أي ترقية تتطلب Evidence Delta حقيقياً (مصدر مستقل، نتيجة أداة، تحقق قابل للتنفيذ، ملاحظة بيئية،
تأكيد بشري صريح). الأساس: commit `0520af7` على `v5.0-polish`، الشجرة نظيفة عند البدء (`git status --short` فارغ).

**ما لم يُلمس (عمداً)**: `src-baseline/`، `frontend/`، `e2e/`، ADRs، `PHASE2-MODULARIZE.md`، API، UI، الاختبارات الحالية.
لم يُنشأ registry/subsystem/pipeline. لم يُعدَّل أي اختبار. Core Slice 3 لم يُنفَّذ ولم يُخلط بهذا العمل.

## 1) INSPECT — أين تُنتج/تُحوَّل/تُحفظ حالات evidence وverdict وconfidence (من الكود الحالي)
- **المنتِج الوحيد** للـ taxonomy الخماسي (`VERIFIED/SUPPORTED/UNCERTAIN/CONFLICTING/UNVERIFIED`) هو
  `EvaluationEngine.evaluate()` — `src-baseline/nexus-backend/src/evaluation/evaluationEngine.ts`:
  النوع `EvaluationVerdict` (L28)، `EvidenceItem{source,content}` (L30–33)، `EvaluationResult` (L36–44)،
  مسار «لا أدلة» الحتمي بلا استدعاء مزود (L86–89)، تحليل حكم الـ LLM judge وتثبيت `verdict`/`confidence` (L109–118).
  prompt الحَكَم يعرّف VERIFIED بـ«عدة مصادر مستقلة وموثوقة» (L59) — أي أن الحاجز الوحيد أمام اتفاق مُقنَّع
  هو سلوك LLM وليس قاعدة حتمية.
- **مستدعيان فقط** لـ `evaluate()` (تحقّق بـ grep على `src/`): `research/webResearch.ts:165` (أدلة = مصادر
  `fetchOk` من `fetchAndExtract`، L164) و`routes/v2/evaluation.ts:43` (`POST /v2/evaluation/claim`، أدلة من جسم الطلب،
  تُرشَّح فقط بأن `source` و`content` نصّان، L42). ظهور الاسم في `orchestrator/planner.ts` تعليق فقط.
- **الحفظ**: `ClaimEvaluationRepo.save()` (`persistence/repositories/claimEvaluationRepo.ts` L40–63) → جدول
  `claim_evaluations` (migration 012؛ الأدلة تُحفظ كاملة في `evidence_json`، ولا عمود لسبب/مسوّغ الحالة).
- **ليس هناك مفهوم «ترقية» داخل المحرك**: `evaluate()` بلا حالة سابقة؛ كل استدعاء حكم جديد. «الترقية» = وصول
  الحكم إلى SUPPORTED/VERIFIED بينما خط الأساس بلا دليل هو UNVERIFIED (L88).
- **Council/Situation Room/Missions لا تستخدم هذا المحرك**: تستخدم `Verifier.verify()` (`ok|issues_found`، بلا taxonomy ولا
  evidence ولا confidence) — `council/councilRunner.ts` L159، L429؛ `orchestrator/missionRunner.ts`. لا seam هناك.
- تعليق migration 012 نفسه يتوقّع أن تكبر أنواع المواضيع لتشمل «council syntheses» و«missions» — أي أن المدخل
  المستقبلي المتوقع هو بالضبط مخرجات Agents كأدلة.

## 2) MAP — مسار البيانات المختصر ونقطة الفرض الوحيدة
```
Agent/user/tool outputs ──► EvidenceItem[] {source, content}   (لا kind، لا provenance، لا استقلالية)
   producers: webResearch.ts:164  |  POST /v2/evaluation/claim (evaluation.ts:42) ← واجهة Ops Center
        └──► EvaluationEngine.evaluate()  [L82]  ──► LLM judge ──► {verdict, confidence}  [L109–118]
                  └──► ClaimEvaluationRepo.save()  ──► claim_evaluations
```
**نقطة الفرض الحتمي الوحيدة** = `EvaluationEngine.evaluate()` (L82–123): نقطة اختناق مشتركة للمنتِجين قبل التخزين.
لا يلزم subsystem موازٍ. **الـ seam موجود.**

## 3) DIAGNOSE — لماذا لم يُطبَّق patch
**مسار «AGENT_AGREEMENT → ترقية» مفتوح كامناً (من قراءة الكود، لم يُجرَّب بحَكَم حقيقي):** أي مستدعٍ يمرّر
مخرجات عدة Agents كعناصر `EvidenceItem` (مثلاً عبر `POST /v2/evaluation/claim`) لا يجد المحرك ما يميّزها عن مصادر
مستقلة، وprompt الحَكَم يكافئ تعدد المصادر. لا يوجد مستدعٍ داخلي حالياً يفعل ذلك (مستدعيان فقط، كلاهما أعلاه).

**لماذا لا يمكن الفرض الحتمي دون كسر عقد قائم:** لا يستطيع المحرك معرفة أن عنصراً *ليس* مخرج Agent إلا بإقرار إيجابي
من المنتِج (`kind`). أي سياسة افتراضية أخرى (السماح لما بلا `kind`) تترك المسار مفتوحاً بالتعريف؛ فالفرض الفعلي =
**fail-closed**: عنصر بلا `kind` معلَن ليس Evidence Delta. وهذا يغيّر سلوك عقد قائم ومُتحقَّق منه.

**تجربة معزولة مقيسة (نسخة scratch خارج المستودع؛ لم تُطبَّق على الشجرة):** `kind?` اختياري + مرشّح واحد
`rawEvidence.filter(e => e.kind !== undefined)` في بداية `evaluate()`
(`phase2-evidence-integrity-failclosed-experiment.NOT-APPLIED.patch`). تشغيل
`evaluationEngine.test.ts + claimEvaluationRoutes.test.ts + webResearch.test.ts`:
**24 اختباراً: 15 نجح، 9 فشل** (`…-failclosed-experiment.log`). الفاشلة: 8 في `evaluationEngine.test.ts`
(VERIFIED، CONFLICTING، SUPPORTED، UNCERTAIN، حكم غير صالح، confidence خارج المدى، JSON غير صالح ×2) و1 في
`claimEvaluationRoutes.test.ts` (`POST /v2/evaluation/claim evaluates a real claim…`). اختبارات `webResearch` لم تتأثر
(تصل إلى مسار «لا أدلة» فقط في الـ sandbox). **ما تثبته التجربة**: أثر السياسة على الاختبارات الحالية فقط، وليس صحة
guard كامل (لم تُبنَ منطق CONFLICTING/reasons/تتبّع).

**واجهة Ops Center (من قراءة الكود، لم تُشغَّل في متصفح هذه الجلسة):** `opsRenderEvidenceRows` (HTML L9882) و`opsSubmitClaim`
(L9936–9945) يرسلان `{source, content}` فقط بلا `kind`؛ تحت fail-closed ستعود كل تقييمات الواجهة اليدوية UNVERIFIED
حتى تُعدَّل الواجهة. تعديلها يمسّ boundary 8 (Ops Center — PENDING) ويتطلب قراراً: أي `kind` يحمله صف أدلة يكتبه
إنسان يدوياً؟ هذا قرار منتج/معماري لا أتخذه بصمت.

⇒ تحقق شرط التوقف المنصوص عليه: الفرض الفعلي يتطلب تغيير عقد قائم (`EvidenceItem` + سلوك `POST /v2/evaluation/claim`
+ نموذج أدلة الواجهة) وتوسيع النطاق إلى UI — **لم أُجبر التنفيذ ولم أبنِ abstraction تعويضية.**

## 4) القرارات المطلوبة قبل أي patch (قرارات المالك)
1. **سياسة الافتراضي**: fail-closed (الموصى بها: عنصر بلا `kind` ليس Evidence Delta ⇒ النتيجة تساوي مسار «لا أدلة»
   L88 مع reason=`CONSENSUS_ONLY`) أم توافق رجعي مع بقاء المسار مفتوحاً؟ (الثانية لا تحقّق المبدأ.)
2. **نموذج الواجهة**: أي `kind` لصف أدلة بشري (`HUMAN_CONFIRMATION` أم `INDEPENDENT_SOURCE` بإقرار المستخدم أم محدِّد)؟
   وهل يُعالَج ضمن boundary 8 أم شريحة UI مُعلنة؟
3. **تتبّع السبب**: إضافة `integrityReason` اختياري إلى `EvaluationResult` + عمود migration 016، أم الاكتفاء
   بالحقل داخل النتيجة وإعادة اشتقاق السبب من `evidence_json`؟
4. **ADR**: تسجيل المبدأ كـ ADR-004 عند اتخاذ القرار (لم يُنشأ الآن لأن القرار لم يُتَّخذ بعد).

## 5) أفضل seam مستقبلي (موصى به — غير مطبَّق)
- `evaluationEngine.ts` L30–33: إضافة `kind?: EvidenceDeltaKind` (`INDEPENDENT_SOURCE | TOOL_RESULT |
  EXECUTABLE_VERIFICATION | ENVIRONMENTAL_OBSERVATION | HUMAN_CONFIRMATION | CONTRADICTORY_EVIDENCE`) — إضافة فقط؛ يُحفظ
  تلقائياً داخل `evidence_json`.
- داخل `evaluate()` فقط: (أ) تقسيم الأدلة إلى deltas/غير-deltas؛ (ب) لا deltas ⇒ نفس نتيجة المسار الحتمي L88 +
  reason=`CONSENSUS_ONLY` دون استدعاء مزود؛ (ج) تمرير الـ deltas وحدها إلى `buildEvidenceBlock` (L67–77) فلا يستطيع الحَكَم عدّ
  اتفاق Agents؛ (د) بعد L109–110: إن وُجد عنصر `CONTRADICTORY_EVIDENCE` والحكم ∈ {VERIFIED, SUPPORTED} ⇒ `CONFLICTING` +
  reason=`CONTRADICTORY_EVIDENCE` (الحارس لا يرفع أبداً، يخفض فقط)؛ (هـ) reason=`EXECUTABLE_VERIFICATION` أو
  `INDEPENDENT_EVIDENCE` حسب الأنواع الحاضرة. لا scoring ولا Bayesian ولا تجميع ثقة.
- المنتِجون: `webResearch.ts:164` يعلن `kind:'TOOL_RESULT'` لمصادر `fetchOk` (ناتج `fetchAndExtract` الحقيقي) ولا يعلن إجابة
  Gemini دليلاً؛ `evaluation.ts:42` يمرّر `kind` اختيارياً مُتحقَّقاً من قائمة الست قيم (غير الصالح ⇒ غير-delta).
- الاختبارات الحالية المتأثرة: 9 (8 في `evaluationEngine.test.ts` + 1 في `claimEvaluationRoutes.test.ts`) تحتاج fixtures بـ `kind`
  معلَن (تعديل fixtures وليس إضعافاً)، إضافة إلى اختبارات A–D الأربعة المطلوبة (consensus-only، independent، contradictory،
  traceability) — حتمية بالكامل بحكم مزوّد وهمي كما في الاختبارات الحالية.

## 6) حدود لا يعالجها حتى الـ patch الموصى به (تُسجَّل كي لا تُنسى)
- **الاستقلالية معلَنة لا مُتحقَّق منها**: المحرك لا يجلب ولا يتحقق من المصادر (يوثّقه تعليق L31). مستدعٍ مُصادَق عليه قادر
  على وسم مخرجات Agents بـ `INDEPENDENT_SOURCE` كذباً؛ الحماية هنا حدود المصادقة/نزاهة المنتِج الداخلي، لا المحرك.
- مصادر مرايا/نفس النطاق (حتى 5 روابط من `webResearch`) لا تُفحَص للاستقلال الفعلي — خارج النطاق.
- لا مفهوم ترقية عبر الزمن (المحرك بلا حالة سابقة)؛ المبدأ يُفرَض لكل استدعاء على حدة.

## 7) VERIFY — ما قيس فعلاً في هذه الجلسة (الشجرة الأصلية بلا أي تعديل)
- `git status --short` فارغ؛ `git diff --stat HEAD` فارغ؛ HEAD = `0520af7` (قبل التوثيق).
- `cd src-baseline/nexus-backend && npm ci` → exit 0؛ `tsc -p tsconfig.json --noEmit` → **exit 0، بلا مخرجات أخطاء**
  (`…-baseline-typecheck.log`)؛ `npm test` → **406/406 نجح، 0 فشل، 0 تخطّي**، 120.0s (`…-baseline-backend-test.log`).
- **لم يُشغَّل في هذه الجلسة**: `npm run build`، Vitest الواجهة، E2E (12/16/16)، probe slice 2 — لا تغيير إنتاج يستدعيها،
  ولا تُعدّ أرقامها السابقة دليلاً حالياً.
- **غير قابل للإثبات الآن**: «لا يوجد مسار يسمح بـ AGENT_AGREEMENT → ترقية». المسار الكامن ما زال مفتوحاً (القسم 3)؛ وجوده
  مستنتَج من الكود، ولم يُختبر بحَكَم LLM حقيقي.

## 8) الشريحة التالية الآمنة
**Core Slice 3** كما وُثِّق أصلاً في `NEXUS-CURRENT-STATE.md` (خريطة §22 للقراءة فقط: ملكية/تهيئة/كتابة `PERSISTABLE_STATE`
والمتغيرات الـ16؛ بلا تعديل إنتاج ولا استخراج ولا تعديل ADR-003) — **ما لم يقرّر المالك أولاً** فتح شريحة منفصلة لـ Evidence
Integrity بعد حسم القرارات في القسم 4. الشريحتان لا تُخلطان.
