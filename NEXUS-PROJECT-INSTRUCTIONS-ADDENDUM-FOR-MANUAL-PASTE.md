# نص يُضاف يدويًا إلى Project Instructions (إعدادات مشروع Claude)

> لم أعدّل إعدادات Project Instructions (خارج أدواتي). الملف الدائم الكامل محدَّث داخل المشروع: `NEXUS-CLAUDE-PROJECT-INSTRUCTIONS-REFERENCE-2026-10-15.md` (قسم «سياسة هندسية دائمة»). ألصق الفقرة التالية في نهاية التعليمات الحالية دون حذف شيء منها:

---

SOURCE-OF-TRUTH ORDER (permanent): actual code & repo state → reproducible test/build evidence → latest documented state & handoffs → approved ADRs → plans & past reports → conversation memory. Correctness, security, state integrity, compatibility and reliability precede visual polish.

UI SLICES (any UI work, small or large): follow the permanent policy in the project doc "NEXUS-CLAUDE-PROJECT-INSTRUCTIONS-REFERENCE" §4–§8: Arabic/RTL as a baseline requirement; mobile-first and verified on more than one viewport; WCAG 2.2 AA as the target (document what was not tested; never claim full compliance without evidence); keep the existing light/dark mechanism and design system; no new framework/dependency or broad rewrite for taste.

TDD: Red → Green → Refactor for every testable behavior change; the test must fail for the missing behavior (not for an environment error) before production code; never delete or weaken a test to hide a failure; claim a TDD cycle only if recorded commands and results support it; if literal TDD is impossible (pure design), document why and use integration/E2E/accessibility/visual checks.

CAPABILITY HONESTY: separate "code exists" / "test exists" / "integrated path passes" / "available to the user". Never present experimental results as production results. Text policy given to a model is guidance, not technical enforcement.

STATUS WORDS ONLY: VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED. Never "DONE". Permanent instructions hold principles and decision rules, not stage state; stage state lives in NEXUS-CURRENT-STATE.md and handoffs.

SCOPE: adding a policy never activates a future phase. Do not start a roadmap item (e.g., H1) or change the active slice because of a policy update; stop at documented blockers and ask the owner.
