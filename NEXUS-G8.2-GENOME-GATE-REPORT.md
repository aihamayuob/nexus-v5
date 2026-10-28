# NEXUS-G8.2-GENOME-GATE-REPORT — بوابة أمان الجينوم ضد ادعاءات القدرات غير المتاحة

**الحالة العامة: PARTIAL.** كل ما يلي VERIFIED **ضمن حدود** (نسخة عمل مستعادة من الحزمة، Node 22.23.4، مزوّد وهمي محلي). لا commit ولا push. لا تطبيق على المستودع الحي. لا G7 ولا MCP ولا واجهة. لا ادعاء أن NEXUS آمن أو جاهز تجاريًا، ولا أن الفحص النصي إنفاذ تقني.

## 1) حالة كل معيار قبول (من خطة الفحص + شروط قرارك)
| # | المعيار | الحالة | الدليل |
|---|---|---|---|
| AC1 | RED قبل الرقعة بسبب السلوك | **VERIFIED** | `evidence/01-red.log`: 55 اختبارًا، 30 فشلت وكلها `ERR_ASSERTION` (لا خطأ بيئة) مع هياكل فارغة للوحدات الجديدة. **ملاحظة صدق:** 6 اختبارات (V12–V15, P8, P9) أُضيفت **بعد** الرقعة بسبب نتائج الطفرات، فلم تُشغَّل RED؛ دليل فعاليتها أنها تقتل M6/X15/X17 |
| AC2 | GREEN في 3 تشغيلات متتالية | **VERIFIED** | `F2-repeat-1..3.log`: 61/61 ثلاث مرات |
| AC3 | المجموعة القائمة سليمة، وتعديل القائم محصور في fixture G82C-2b | **VERIFIED** | خط أساس قسته: 620/620 (`00-baseline-full.log`). بعد الرقعة: **681/681** (620 + 61) (`04-full-suite.log`). قبل تعديل الـfixture فشل **اختبار واحد فقط** هو G82C-2b (`02-full-before-fixture-change.log`) كما تنبأت الخطة. الفرق في الاختبارات القائمة: دالة مساعدة + استدعاء واحد؛ **لا assertion تغيّر** |
| AC4 | الطفرات الـ14 | **VERIFIED** | **14/14 قُتلت** + 4 طفرات إضافية قُتلت (18/18)، والملفات استُعيدت مطابقة بالبصمة (`03-mutations.log`، التفصيل في §4) |
| AC5 | عيّنة التخصيص (**in-sample فقط**) | **VERIFIED (محدود)** | رفض 14/14 نصًّا يَعِد بقدرة (P1–P9 + O1–O5)، قبول كل النصوص الصحيحة (V1–V15 وN1–N3) بلا findings، و24/24 من شخصيات الوكلاء الثابتة تمر. العيّنة من تأليفي: ليست دقة عامة |
| AC6 | الدالة القديمة (التي يستخدمها fineTuning) لم تتغير | **VERIFIED** | GC-7: مخرجاتها مطابقة بايتًا على 12 نصًا ثابتًا التُقطت من النسخة الأصلية؛ وبصمة `fineTuning.ts` مطابقة لخط الأساس |
| AC7 | `tsc` والبناء وdist | **VERIFIED** | `tsc` exit 0؛ `npm run build` exit 0؛ `dist-check-gate.mjs`: **PASS** (`04-dist-check.log`) |
| AC8 | بلا اعتماديات/هجرة/تغيير في `agentRegistry.ts` أو `fineTuning.ts` أو الـAPI | **VERIFIED** | الرقعة 6 ملفات (§2)؛ `package.json` والهجرات والمستودع وعقود المسارات لم تُمَس؛ بصمات `agentRegistry.ts` و`fineTuning.ts` و`agentGenomeRepo.ts` مطابقة لخط الأساس |
| AC9 | الرقعة تُطبَّق وتُعكَس | **VERIFIED** | تُطبَّق نظيفة على لقطة G8.2-CLOSURE فينتج الشجرة النهائية بايتًا ببايت، والعكس يعيد اللقطة مطابقة؛ بلا `.orig/.rej` |
| D5 | تدقيق القاعدة الحية للقراءة فقط | **BLOCKED** | لا توجد قاعدة Nexus في بيئتي ولم أُنشئ نتائج مفترضة. السكربت جاهز ومُجرَّب **على قاعدة اصطناعية** (يفتحها `readOnly`، وبايتات القاعدة لم تتغير) |
| — | التزام نموذج حقيقي بأي نص | **UNVERIFIED** | لم يُقَس؛ نجاح المزوّد الوهمي لا يدل عليه |
| — | المستودع الحي / الفرع / HEAD | **BLOCKED** | لا `.git` ولا وصول |

## 2) الملفات المتغيرة (6) ولماذا
| الملف | التغيير |
|---|---|
| `src/evolution/genomeCapabilityCheck.ts` (جديد، ~130 سطرًا) | دالة نقية `checkCapabilityClaims(text, {offeredToolNames, knownToolNames})`: تطبيع (NFKC، حذف صفري العرض والتشكيل والتطويل، جدول أحرف متشابهة)، ثم مسح جملة جملة لـ(أ) اسم أداة غير معروضة، (ب) وعد/ادعاء تنفيذ كود أو برامج أو استعلامات، (ج) وعد بالوصول للإنترنت. استثناء: النفي/الحظر، وسياق «المستخدم»/الشرح. أي نتيجة = رفض (D3) |
| `src/agents/agentToolResolution.ts` (جديد) | `resolveAgentTools` منقولة **حرفيًا** من `agentRunner.ts` + `resolveAgentToolNames`. مصدر واحد لـ«ما يُعرض فعلًا» (D4) |
| `src/agents/agentRunner.ts` | يستورد الدالة بدل نسختها المحلية (حذف الدالة والاستيرادات غير المستعملة فقط) |
| `src/evolution/agentGenome.ts` | `checkGenomePromptRisk` (= القديمة ∪ فحص القدرات حسب أدوات الوكيل المعروضة)؛ تستبدل الاستدعاء في `propose`؛ وتُستدعى في `approve` و`rollback` عبر `assertGenomePassesCurrentCheck` (يرفض، يدقّق، ولا يغيّر أي صف). `checkGenomeSecurityRisk` **لم تتغير** |
| `test/genomeCapabilityGate.test.ts` (جديد، 61 اختبارًا) | GC-1…GC-9 |
| `test/agentDataFixedPolicy.test.ts` | **fixture G82C-2b فقط** (إذن D1): خيار `legacyRowAlreadyActive` يفعّل الصف عبر `agentGenomes.activate` كما وُجدت صفوف قديمة قبل البوابة. لا assertion تغيّرت. الدليل أنه ليس تجاوزًا لبوابة الإنتاج: GC-6g يثبت أن `activate()` لا يُستدعى إلا من `approve` و`rollback` (كلاهما يعيد الفحص)، وGC-6a/6d/6h تثبت رفض الاعتماد/التراجع/HTTP |

الفرق الكامل: `B-evidence/G8.2-GENOME-GATE/G8.2-GENOME-GATE-changes.patch` (13 هنكًا). فرق `agentGenome.ts` بنصه:
```diff
@@ -8,6 +8,9 @@
 import { logger } from '../core/logger.js';
 import { auditSecurityEvent } from '../security/audit.js';
 import { assertCloudEgressAllowed } from '../security/cloudEgressGuard.js';
+import { checkCapabilityClaims } from './genomeCapabilityCheck.js';
+import { resolveAgentToolNames } from '../agents/agentToolResolution.js';
+import { getToolRegistry } from '../tools/registry.js';
 
 /**
  * Controlled Agent Evolution ("Digital Genome"). This is the ONE place in
@@ -73,6 +76,24 @@
   return { passed: findings.length === 0, findings };
 }
 
+/**
+ * The check applied to a genome's actual `systemPrompt` text at propose, approve AND rollback: the legacy jailbreak/length check (checkGenomeSecurityRisk —
+ * unchanged, still the one fineTuning.ts uses) PLUS the capability-claim check against what THIS agent is really offered. A stored `securityCheckPassed` flag
+ * is never a substitute for running this (it may predate the rule). Lexical only: see genomeCapabilityCheck.ts for what it cannot see.
+ */
+export function checkGenomePromptRisk(candidateSystemPrompt: string, agentId: string): SecurityCheckResult {
+  const legacy = checkGenomeSecurityRisk(candidateSystemPrompt);
+  let offeredToolNames: string[] = [];
+  try {
+    offeredToolNames = resolveAgentToolNames(AgentRegistry.get(agentId));
+  } catch {
+    offeredToolNames = []; // unknown agent id: nothing is offered (and such an agent can never run), so the stricter reading applies
+  }
+  const capability = checkCapabilityClaims(candidateSystemPrompt, { offeredToolNames, knownToolNames: getToolRegistry().list().map((t) => t.name) });
+  const findings = [...legacy.findings, ...capability.findings];
+  return { passed: findings.length === 0, findings };
+}
+
 function baselineSystemPromptFor(agentId: string): string {
   const active = getRepos().agentGenomes.active(agentId);
   if (active) return active.systemPrompt;
@@ -146,7 +167,7 @@
     throw Errors.internal('تعذّر توليد اقتراح تطوّر حقيقي — مزود الحكم الثابت (anthropic) غير متاح أو لم يُعِد نصاً صالحاً.');
   }
   const candidate = proposalRaw.trim();
-  const security = checkGenomeSecurityRisk(candidate);
+  const security = checkGenomePromptRisk(candidate, agentId);
 
   let evaluationVerdict: GenomeEvaluationVerdict | null = null;
   let evaluationRationale: string | null = null;
@@ -199,6 +220,14 @@
   return record;
 }
 
+/** Re-runs the CURRENT check on the stored text (never trusts the stored flag). A failure refuses the transition, audits it, and leaves every row exactly as it was. */
+function assertGenomePassesCurrentCheck(record: AgentGenomeRecord, action: 'approval' | 'rollback'): void {
+  const recheck = checkGenomePromptRisk(record.systemPrompt, record.agentId);
+  if (recheck.passed) return;
+  auditSecurityEvent('warn', `Digital Genome: ${action} refused by security re-check`, { agentId: record.agentId, genomeId: record.id, version: record.version, findings: recheck.findings });
+  throw Errors.validation(`لا يمكن ${action === 'approval' ? 'اعتماد' : 'استعادة'} إصدار لا يجتاز الفحص الأمني الحالي (إعادة الفحص عند ${action === 'approval' ? 'الاعتماد' : 'التراجع'}؛ لا يُعتدّ بعلم securityCheckPassed المخزَّن): ${recheck.findings.join(' | ')}`);
+}
+
 /** The ONLY function in this codebase that can make a genome candidate actually govern real agent behavior. Requires an explicit human identity string (decidedBy) — never a system/automatic caller (contrast with the security-check auto-rejection in proposeGenomeMutation(), which is allowed to be automatic precisely because it can only ever say no, never yes). */
 export function approveGenomeVersion(genomeId: string, approvedBy: string): AgentGenomeRecord {
   if (!approvedBy || !approvedBy.trim()) throw Errors.validation('approvedBy مطلوب — لا يمكن اعتماد إصدار تطوّر بلا هوية بشرية حقيقية.');
@@ -207,6 +236,7 @@
   if (!record) throw Errors.notFound('إصدار التطوّر غير موجود.');
   if (record.status !== 'proposed') throw Errors.validation(`لا يمكن اعتماد إصدار في حالة ${record.status} — يجب أن يكون 'proposed'.`);
   if (!record.securityCheckPassed) throw Errors.validation('لا يمكن اعتماد إصدار فشل الفحص الأمني — هذا حد صارم غير قابل للتجاوز حتى بموافقة بشرية.');
+  assertGenomePassesCurrentCheck(record, 'approval');
   const activated = repos.agentGenomes.activate(record.agentId, genomeId, approvedBy);
   auditSecurityEvent('warn', 'Digital Genome: version approved and activated — real agent behavior changed', { agentId: record.agentId, genomeId, version: record.version, approvedBy });
   return activated;
@@ -233,6 +263,7 @@
     throw Errors.validation(`لا يمكن التراجع إلى إصدار بحالة ${target.status} — يجب أن يكون إصداراً فعّالاً سابقاً (superseded) أو الفعّال حالياً.`);
   }
   if (target.status === 'active') return target; // already the active one — a no-op, not an error
+  assertGenomePassesCurrentCheck(target, 'rollback');
   const activated = repos.agentGenomes.activate(agentId, target.id, approvedBy);
   auditSecurityEvent('warn', 'Digital Genome: rolled back to a prior version — real agent behavior changed', { agentId, genomeId: target.id, targetVersion, approvedBy });
   return activated;
```
فرق `agentRunner.ts` (الأسطر المتغيرة فقط):
```diff
@@ -1,39 +1,12 @@
-import type { AgentDefinition, AgentExecutionContext, AgentResult, AgentRuntimeState } from './agentTypes.js';
+import type { AgentExecutionContext, AgentResult, AgentRuntimeState } from './agentTypes.js';
-import { getToolRegistry } from '../tools/registry.js';
-import type { ToolDef } from '../providers/contract.js';
-
-/**
- * Resolves an agent's declared tool NAMES (agentTypes.ts's
- * AgentDefinition.tools — a list of tools/registry.ts tool names, never
- * trusted blindly) into real ToolDef objects the provider adapter can
- * actually see, applying constraints.allowedToolsOverride (deny-by-default
- * allowlist, if set) and constraints.deniedTools on top. A name that
- * isn't in the tool registry (typo, or a tool removed after an agent was
- * defined) is silently dropped rather than thrown — an agent should
- * degrade to fewer tools, not fail entirely, for a config drift issue.
- * Returns undefined (not []) when the agent ends up with no tools, so
- * chatService.ts's `needsTools` check behaves exactly as it does for an
- * agent that never requested tools at all.
- */
-function resolveAgentTools(def: AgentDefinition): ToolDef[] | undefined {
-  if (!def.tools.length) return undefined;
-  const denied = new Set(def.constraints.deniedTools ?? []);
-  const allowList = def.constraints.allowedToolsOverride;
-  const candidateNames = allowList && allowList.length ? def.tools.filter((t) => allowList.includes(t)) : def.tools;
-  const registry = getToolRegistry();
-  const defs = candidateNames
-    .filter((name) => !denied.has(name))
-    .map((name) => registry.get(name)?.def)
-    .filter((d): d is ToolDef => !!d);
-  return defs.length ? defs : undefined;
-}
+import { resolveAgentTools } from './agentToolResolution.js';
```

## 3) النتائج الفعلية
- **الجديدة:** 61/61 (3 تشغيلات). **الكاملة:** 681/681، 0 فشل/إلغاء/تخطٍّ. **المرتبطة** (genome، G82C، fineTuning، agentToolLoop، productionHardening، resilience): 76/76.
- **GC-6 (approve/rollback):** علم قديم + جينوم غير صالح ← اعتماد مرفوض (400 عبر HTTP) وبلا تفعيل وبلا تغيير صفوف مع مدخل تدقيق؛ علم false ← رسالته القديمة كما هي؛ جينوم صالح ← يُعتمد؛ rollback إلى صف superseded فشل فحصه ← مرفوض ويبقى الفعّال؛ rollback لصالح ← يعمل؛ جينوم **فعّال قديم** يبقى فعّالًا ولا يُعطَّل (D5) ويمكن استبداله باعتماد صالح.
- **جميع الوكلاء (24):** شخصياتهم الثابتة تمر؛ وعد بأداة غير معروضة يُرفض لكل واحد منهم (لا `data` وحده)؛ لا وكيل يُعرض عليه أي أداة اليوم؛ ولوكيل مُنح `web_fetch` تجريبيًا يُقبل الاسم له ويُرفض لغيره ويُرفض له عند وضعه في `deniedTools` (الدليل أن المرجع الموحد يحترم `deniedTools`/`allowedToolsOverride`/الأسماء غير المسجلة)، ويظل المُشغِّل يرسل الأداة المعروضة فقط كما كان.

## 4) الطفرات: كل طفرة والاختبار الذي قتلها
| الطفرة | الاختبار القاتل |
|---|---|
| M1 حذف NFKC | GC-2 O3 |
| M2 حذف إزالة صفري العرض | GC-2 O2 |
| M3 حذف إزالة التشكيل/التطويل | GC-2 (O1) + GC-1 (P6, P7, …) — 4 اختبارات |
| M4 حذف جدول الأحرف المتشابهة | GC-2 O5 |
| M5 تعطيل استثناء النفي | GC-3 V1, V2, N1–N3 (6) |
| M6 تعطيل استثناء المستخدم/الشرح | GC-3 V12, V13, V14, V15 |
| M7 تجاهل مجموعة المعروض | GC-4, 4b, 4c, 4d + GC-8e |
| M8 `propose` بالفحص القديم فقط | GC-5 |
| M9 فحص baseline بدل candidate | GC-5 |
| M10 `approve` بلا إعادة فحص | GC-6a, GC-6f, GC-6h |
| M11 `rollback` بلا إعادة فحص | GC-6d |
| M12 `passed=true` دائمًا | GC-1 (22 اختبارًا) |
| M13 fineTuning يتحول للفحص الجديد | GC-7b |
| M14 حذف `web_fetch` من القائمة | GC-1 P5 + GC-4 |
| X15–X18 (إضافية): الشرح فقط / استثناء «لا تتردد» / القاعدة الأمرية / طبقة الويب | GC-3 V14,V15 / N6 / P8,P9 / P4 |

الحارس: الطفرة «تُقتل» فقط إذا طُبِّقت مرة واحدة بالضبط، وحُمِّل ملف الاختبار كاملًا (61)، وفشل اختبار واحد على الأقل بـ`ERR_ASSERTION`، واستُعيد الملف بايتًا ببايت. **سجل أخطاء:** في أول تشغيل ظهرت M2/M3 `INVALID` (نمط البحث لا يطابق الشيفرة) وX15 `SURVIVED` (استثناء الشرح بلا اختبار يقتله)؛ لم أحسبها نجاحًا: صُحّح النمط وأُضيفت V14/V15 فقُتلت. وأثناء الكتابة اكتشفت أن أداة الكتابة حوّلت `\uXXXX` إلى محارف فعلية (بما فيها محارف صفرية العرض غير مرئية داخل المصدر)؛ استبدلتها بتهريبات صريحة قبل أي نتيجة معتمدة.

## 5) حالات الرفض الخاطئ والتغطية غير الكافية (بصدق)
- **رفض خاطئ مقصود (D2/D3):** نص يذكر اسم أداة غير معروضة بصيغة **إيجابية** يُرفض؛ ونص ينفيها أو يحظر ادعاءها يُقبل. بقي تعارض معروف: جملة تذكر الاسم دون ادعاء ولا نفي (مثل «الأداة code_execution موثقة في دليل المستخدم») قد تُرفض إذا ظهر معها سياق أداة.
- **سلبيات كاذبة معروفة، مثبتة باختبارات GC-9 (KNOWN-LIMIT):** ادعاء ضمني بلا مفردات (L1)، لغة غير العربية/الإنجليزية (L2)، نفي مزدوج «لا تقل إنك لا تملك code_execution» (L3). وغير مغطّى أيضًا: وعد موزَّع على جمل، أو مشفَّر، أو عبر أمثلة few-shot، وادعاءات الوصول لقواعد البيانات/الملفات/البريد دون كلمة تنفيذ. **لا ادعاء أن الفحص يفهم كل سياق.**
- **قاعدة النفي واسعة بالتصميم:** أي كلمة نفي في الجملة تُسقط الجملة من الفحص (عدا «لا تتردد…»)، فقد يفوت وعدٌ صيغ بنفي مضلّل.
- **جدول الأحرف المتشابهة صغير** (سيريلي/يوناني شائع)، وليس TR39.
- **عيّنة التخصيص من تأليفي.** لا أعرف معدل الرفض الخاطئ على جينومات حقيقية.

## 6) جينومات قديمة خطرة
**لم أكتشف أي جينوم قديم خطر، لأنه لا توجد قاعدة حية في بيئتي (BLOCKED / UNVERIFIED).** لم أفترض نتائج. للتدقيق على قاعدتك (قراءة فقط، لا يغيّر شيئًا):
```
node --experimental-sqlite B-evidence/G8.2-GENOME-GATE/evidence/audit-genomes-readonly.mjs file:///ABS/dist /ABS/nexus.db
```
(يتطلب `npm run build` أولًا). يطبع لكل جينوم: المعرّف، الوكيل، النسخة، الحالة، العلم المخزَّن، نتيجة الفحص الحالي، والادعاء المكتشف، والأثر. جُرِّب على قاعدة اصطناعية بأربعة صفوف (`06-audit-synthetic.log`): اكتشف الفعّال والمقترح الفاشلين، وبقيت بايتات القاعدة كما هي. لا تعطيل تلقائي لأي جينوم فعّال.

## 7) نتائج فحص `fineTuning.ts` (دون إدخال السياسة فيه)
بصمته مطابقة لخط الأساس (`00-baseline-hashes.txt`)؛ ما زال يستدعي `checkGenomeSecurityRisk` القديمة؛ GC-7b: مجموعة بيانات أمثلتها وعد بأداة تبقى `proposed` و`securityCheckPassed=true` كما قبل (أي أن بيانات الضبط الدقيق **لم تتأثر**، وهذه فجوة معروفة خارج النطاق)؛ وطفرة M13 (تحويله للفحص الجديد) قُتلت؛ واختبارات `fineTuning.test.ts` ضمن 76/76. ما زال يبني التدريب من `def.systemPrompt` دون السياسة الثابتة (قرار سابق لم يُحسم).

## 8) تعارض/ملاحظة تحتاج علمك
- بعد اعتماد هذه الرقعة، **أي جينوم فعّال قديم يَعِد بأداة يبقى فعّالًا** (D5) ولن يظهر إلا في التدقيق أو عند محاولة استعادة نسخة مشابهة.
- `legacy/chat.ts` يمرّر `system` من العميل مباشرة؛ ليس مسار جينوم ولم يُفحص (UNVERIFIED) ولا تغطيه هذه البوابة.

## 9) إعادة التشغيل والتراجع
```bash
cd A-source-snapshot/src-baseline/nexus-backend
npm i --no-save tsx typescript @types/node
npx tsx --test test/genomeCapabilityGate.test.ts                    # 61/61
npx tsx --test 'test/**/*.test.ts' 'test/*.test.ts'                  # 681/681
npx tsc -p tsconfig.json --noEmit && npm run build
node --experimental-sqlite ../../../B-evidence/G8.2-GENOME-GATE/evidence/dist-check-gate.mjs "file://$PWD/dist"   # DIST-CHECK: PASS
python3 ../../../B-evidence/G8.2-GENOME-GATE/mutations/run_mutations_gate.py "$PWD" 61                           # 18/18 (يعدّل الملفات مؤقتًا ويستعيدها)
# الرقعة فوق لقطة G8.2-CLOSURE (من src-baseline/nexus-backend):  patch -p1 < ../../../B-evidence/G8.2-GENOME-GATE/G8.2-GENOME-GATE-changes.patch
```
التراجع: `patch -R -p1` بالرقعة نفسها (مُجرَّب). لا هجرات ولا بيانات متأثرة. الاختبارات تُنشئ `data/` فاحذفه قبل أي حزمة. ترتيب الرقع على المستودع الحي إن أُذن: VEL ← G8 ← G8.1 ← G8.2 ← G8.2-CLOSURE ← **G8.2-GENOME-GATE**؛ وبعد الأخيرة سيُبلّغ S0 عن `DIFF` لـ`agentRunner.ts` و`agentGenome.ts` (متوقع).

**SHA-256 للحزمة النهائية** وسجل التحقق بعد الضغط وإعادة التشغيل منها في ملفين منفصلين بجانب الأرشيف (لا يمكن تضمين بصمة الأرشيف داخله).
