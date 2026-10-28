# NEXUS v5.0 — PROJECT MASTER ENGINEERING CONTEXT & OPERATING CONTRACT

**Document role:** Permanent Project Knowledge / authoritative orientation document  
**Project:** NEXUS v5.0  
**Purpose:** Preserve the project's engineering intent, architecture, execution discipline, roadmap, verification standard, and continuity rules across new Claude Project conversations.

---

# 1. AUTHORITY AND SOURCE OF TRUTH

NEXUS is a serious **commercial-grade and research-grade AI agent platform**.

This document defines the project's enduring engineering context and operating contract. It does **not** override current repository evidence.

When information conflicts, use this authority order:

1. Current repository implementation and reproducible repository evidence
2. Current test results and actual command output
3. Latest valid `NEXUS-CURRENT-STATE.md`
4. Latest relevant checkpoint
5. Current ADRs / plans / roadmap
6. Older reports and historical documentation
7. Conversation memory or assumptions

Never treat this document, an old report, or a previous conversation as proof that something currently exists or works.

The repository is the implementation truth. Tests are evidence only for the behavior they actually exercise.

Never fabricate evidence.

---

# 2. PROJECT IDENTITY

**Project:** NEXUS v5.0

**Current frontend baseline reference:**
`neural_nexus_ai_agents-4-3-5-3.html`

**Primary engineering backend:**
`nexus-backend`

NEXUS is not merely:

- a chatbot;
- a UI prototype;
- a collection of AI features;
- a coding exercise;
- an AI-generated code demonstration.

The long-term objective is a trustworthy, modular, provider-agnostic AI agent platform capable of:

- executing real tasks;
- planning and coordinating work;
- coordinating multiple agents;
- using tools safely;
- using memory safely;
- routing work intelligently;
- operating across cloud and local providers;
- producing evidence-backed results;
- enforcing governance and safety controls;
- supporting research and controlled experimentation;
- becoming commercially credible through measurable real-world utility.

The project must prove value through real, repeatable, measurable end-to-end capabilities before broad feature expansion or commercialization claims.

---

# 3. LONG-TERM TARGET ARCHITECTURE

The intended architecture is:

**Frontend → `nexus-backend` → Universal AI Gateway → Model Registry / Router → Agents / Runtime / Tools / Memory → Provider Adapters → Cloud + Local Providers**

Target provider ecosystem includes:

- Anthropic / Claude
- OpenAI
- DeepSeek
- Google / Gemini
- Ollama
- LM Studio
- additional providers only where justified

Architectural properties to preserve:

- provider agnosticism;
- backend-controlled secrets;
- modularity;
- testability;
- observability without secrets or hidden chain-of-thought;
- local/private execution capability;
- controlled provider routing;
- explicit failure handling;
- compatibility with existing contracts.

Do not introduce provider-specific assumptions into provider-agnostic layers unless there is a documented architectural reason.

---

# 4. STRATEGIC PRODUCT / RESEARCH CAPABILITIES

These are the intended long-term differentiators.

They are **directional capabilities**, not automatic implementation requirements.

## 4.1 NEXUS Mission

Goal → planning → execution → result.

## 4.2 NEXUS Council

Multi-agent discussion, independent checking, structured cross-examination, and decision support where appropriate.

## 4.3 NEXUS Warden

Governance and execution control, including where appropriate:

- pause;
- resume;
- isolate;
- veto;
- approval;
- cancellation;
- controlled execution;
- safety boundaries.

## 4.4 NEXUS Evidence

Explicit evidence states such as:

- `VERIFIED`
- `SUPPORTED`
- `UNCERTAIN`
- `CONFLICTING`
- `UNVERIFIED`

Evidence status must never be used as decoration. It must correspond to actual evidence semantics.

## 4.5 Intelligent Routing

Potential routing policies:

- `BEST`
- `CHEAPEST`
- `FASTEST`
- `LOCAL_ONLY`
- `PRIVATE`
- `USER_SELECTED`

## 4.6 Longer-term research/platform directions

Potential future directions include:

- failure memory;
- permission-aware Tool Fabric;
- MCP/tool integrations;
- memory compression;
- synthetic/research memory workflows;
- dynamic swarm execution;
- controlled evaluation;
- evolution experiments;
- controlled fine-tuning/research paths;
- strong local/private execution;
- measurable agent capability evaluation.

These must not be implemented merely because they appear on a roadmap.

Every new capability requires:

1. a real objective;
2. bounded scope;
3. explicit acceptance criteria;
4. measurable validation;
5. compatibility with the existing architecture;
6. an explicit decision that it belongs in the current work slice.

---

# 5. CURRENT ENGINEERING OBJECTIVE

The immediate engineering objective is:

**Complete the required frontend modularization and architecture-preserving refactoring without broad rewrites or behavioral regressions.**

Only after the required modularization is sufficiently verified should the main emphasis move toward:

1. reliability / production hardening;
2. commercial readiness;
3. research / evaluation;
4. real-world end-to-end capability validation;
5. broader product expansion.

Do not add complexity simply because it is technically possible.

The current goal is not to maximize feature count.

The current goal is to make the existing system:

**correct → secure → modular → reliable → measurable → commercially useful → research-credible**

with evidence.

---

# 6. CURRENT ROADMAP

## Phase 0 — Baseline / Reality Lock

Purpose:

- establish actual repository state;
- establish known baseline;
- verify build/test/security evidence;
- document the starting point.

Historical/current status:

**VERIFIED**

---

## Phase 1 — Security Hardening

Purpose:

- harden dangerous frontend patterns;
- preserve security boundaries;
- verify prompt-injection protections and related safety behavior.

Historical/current status:

**VERIFIED**

The PromptInjectionGuard integration was explicitly tested through the live path, including intentional removal/bypass probes demonstrating that the relevant tests detect the failure.

---

## Phase 2 — Modularization

Status:

**PARTIAL until all required boundaries are verified.**

Planned boundaries:

1. Security — VERIFIED
2. Storage — VERIFIED
3. Utilities — VERIFIED
4. Settings UI sub-boundary — VERIFIED
5. Core — next / active area
6. Agents — PENDING
7. Modes — PENDING
8. Ops Center — PENDING
9. Workspace — PENDING

Important:

A boundary is not `VERIFIED` merely because code has been moved.

Each boundary requires:

- correct extraction;
- preserved behavior;
- preserved contracts;
- appropriate dependency evidence;
- tests;
- regression evidence;
- verification;
- documentation.

---

# 7. CURRENT CORE CONTEXT

Core is the next major modularization boundary.

Core is higher risk than the earlier boundaries because it contains significant application-state and execution-order dependencies.

In particular, prior analysis identified deferred work involving:

- `PERSISTABLE_STATE`;
- approximately 16 scattered state variables;
- dependencies around persistent state;
- initialization order;
- `persistState`;
- `autoInitApp`;
- related encryption/decryption functions.

This does **not** authorize extracting all Core state at once.

The correct strategy is:

1. inspect current repository state;
2. map actual dependencies;
3. map initialization/execution order;
4. identify the smallest safe seam;
5. extract only that seam;
6. test;
7. verify;
8. document;
9. stop.

Do not turn Core into a large rewrite.

A small successful Core slice is preferable to a large uncertain extraction.

---

# 8. CURRENT VERIFIED HISTORY

Known historical evidence includes:

- Phase 0 verified.
- Phase 1 verified.
- Phase 2 boundaries 1–4 verified.
- Frontend PromptInjectionGuard live-path integration verified.
- Frontend security integration testing previously reached `124/124` in the relevant slice.
- Previous backend verification recorded `406/406`.
- Previous frontend baseline verification recorded `116/116`.
- Previous E2E evidence recorded `12/12` and `16/16`.
- Earlier project milestones included verified Council, Warden, Dynamic Swarm, resilience, and related capabilities.

Important:

**These are historical evidence records.**

Do not describe any historical test count as freshly rerun unless the command was actually executed in the current repository state.

Evidence freshness must always be explicit.

---

# 9. OFFICIAL CURRENT STATUS VOCABULARY

The only permitted current project status values are:

`VERIFIED`
`PARTIAL`
`PENDING`
`BLOCKED`
`FAILED`
`UNVERIFIED`

## VERIFIED

The required scope was implemented and validated with sufficient concrete, reviewable evidence.

## PARTIAL

Some required scope is complete, but required scope or verification remains incomplete.

## PENDING

The relevant work has not started.

## BLOCKED

Execution cannot continue because of a real dependency, unavailable environment, missing credential, or required decision.

## FAILED

Execution was attempted and acceptance criteria were not achieved.

## UNVERIFIED

Implementation may exist, but evidence is insufficient to establish the required result.

## Hard rules

Never use `DONE` as a current project status.

Never infer `VERIFIED` merely because:

- code exists;
- code compiles;
- typecheck passes;
- unrelated tests pass;
- an old report says it passed;
- a previous conversation says it passed;
- a model believes the implementation is correct.

When evidence is insufficient, use `UNVERIFIED`.

---

# 10. EXECUTION PROTOCOL

The standard engineering protocol is:

**INSPECT → MAP → DIAGNOSE → PATCH → TEST → VERIFY → DOCUMENT**

Apply only the steps required for the current TARGET SLICE.

The fundamental execution unit is:

## TARGET SLICE

A TARGET SLICE must have:

- one clear objective;
- bounded scope;
- explicit acceptance criteria;
- explicit evidence requirements;
- minimal change surface;
- explicit stop point.

Do not turn a TARGET SLICE into an undeclared mini-phase.

Do not automatically continue into the next slice after success.

---

# 11. PRE-CHANGE DISCIPLINE

Before modifying code:

1. Establish repository path and Git branch.
2. Inspect working-tree status.
3. Establish the current commit.
4. Read the latest `NEXUS-CURRENT-STATE.md`.
5. Read the relevant checkpoint.
6. Read relevant ADRs.
7. Inspect affected source files.
8. Identify current tests.
9. Map dependencies.
10. Identify execution/initialization order where relevant.
11. Define the smallest safe extraction/change seam.
12. State acceptance criteria before patching.

If the actual repository state contradicts the expected plan, stop and reconcile reality before proceeding.

Do not patch based on assumptions.

---

# 12. PATCH DISCIPLINE

When changing code:

- make the smallest reversible change;
- preserve existing behavior;
- preserve contracts;
- preserve state semantics;
- preserve initialization order;
- preserve compatibility;
- preserve security boundaries;
- avoid unrelated cleanup;
- avoid opportunistic refactoring;
- do not change architecture without evidence.

For modular extraction specifically:

**Extraction is not rewriting.**

The default goal is behavior-preserving movement of existing functionality into a better boundary.

Where practical, prove that extracted logic is equivalent to the pre-extraction implementation.

Appropriate evidence may include:

- byte-level/source equivalence where meaningful;
- direct behavioral tests;
- cross-module compatibility tests;
- golden vectors;
- regression tests;
- mutation/fault-injection tests;
- initialization-order checks;
- dependency-graph checks.

Use the least invasive evidence that actually proves the required property.

---

# 13. TESTING STANDARD

Tests must prove the behavior relevant to the slice.

Use:

1. focused tests first;
2. mutation/fault-injection tests where useful;
3. boundary-specific regression tests;
4. broader regression tests when justified;
5. build/typecheck/syntax checks as appropriate;
6. E2E tests where the changed behavior crosses the application boundary.

A test that passes is evidence only for what it actually exercises.

Intentional mutation testing is valuable when it demonstrates that tests fail under a meaningful regression.

Examples:

- modify IV length;
- reuse IV;
- swap envelope fields;
- weaken authentication behavior;
- change algorithm;
- bypass security guard;
- break an initialization dependency.

Only use mutations that are safe, controlled, and restored afterward.

After intentional mutation:

**restore the repository and prove restoration.**

---

# 14. EVIDENCE STANDARD

Every meaningful slice should leave behind inspectable evidence.

Where practical record:

- exact command;
- exit status;
- test count;
- relevant test names;
- affected files;
- relevant line ranges;
- commit/hash where relevant;
- what property was actually proven;
- what remains unverified.

Evidence must distinguish:

**implemented** from **tested** from **verified**.

Do not use broad language such as "fully verified" when only a narrow test passed.

If a test cannot run:

- record why;
- distinguish `BLOCKED` from `UNVERIFIED`;
- do not convert missing evidence into success.

---

# 15. REGRESSION AND RESTORATION RULE

For every risky modularization slice, consider whether a controlled regression probe is appropriate.

If mutation/fault injection is used:

1. establish pre-mutation state;
2. apply one controlled mutation;
3. run the relevant tests;
4. prove that the expected tests fail;
5. restore the exact original state;
6. prove restoration;
7. rerun the relevant tests;
8. only then treat the evidence as valid.

Do not leave deliberate mutations in the working tree.

---

# 16. STOP CONDITIONS

Stop the current TARGET SLICE when:

- acceptance criteria are met and verified;
- evidence is insufficient;
- a real blocker exists;
- tests fail and the failure is not resolved within the slice;
- proceeding would require a broader architectural decision;
- a Critical/High correctness or security issue is discovered;
- a regression is unexplained;
- a security boundary is not adequately verified.

Do not silently continue into another slice.

Do not turn a finding into an automatic implementation task.

---

# 17. PRIORITY ORDER

When trade-offs occur:

**correctness → security → architecture → compatibility → reliability → performance → intelligence → UX**

A more advanced feature is never a valid reason to weaken:

- correctness;
- security;
- compatibility;
- reliability;
- evidence quality.

---

# 18. ARCHITECTURAL NON-NEGOTIABLES

Preserve decisive architectural choices unless strong technical evidence proves that they must change.

Do not:

- perform broad rewrites;
- replace architecture merely for elegance;
- create duplicate frontend/backend registries;
- break established contracts;
- remove legacy compatibility without evidence and migration justification;
- introduce speculative abstractions;
- introduce unnecessary coupling;
- fake credentials;
- fake integrations;
- fake provider responses;
- bypass security boundaries to simplify testing.

---

# 19. SECURITY NON-NEGOTIABLES

Maintain:

- authentication/authorization boundaries;
- CORS controls;
- rate limits;
- SSRF protections;
- prompt-injection defenses;
- auditing;
- safe error handling;
- timeout behavior;
- retry behavior;
- cancellation;
- fail-closed behavior where required.

Provider/API secrets must remain backend-only.

Never expose secrets in:

- logs;
- observability;
- checkpoints;
- test output;
- evidence artifacts;
- frontend source.

Never place hidden chain-of-thought into:

- logs;
- evidence;
- telemetry;
- persisted state;
- user-facing output.

---

# 20. COMPATIBILITY

Preserve legacy `/api/*` compatibility where it remains part of the current project contract.

Do not remove compatibility merely because a newer route or abstraction exists.

Any compatibility removal requires:

- evidence that it is no longer required;
- explicit architectural decision;
- migration reasoning;
- appropriate tests.

---

# 21. FRONTEND MODULARIZATION CONTRACT

The current frontend is a large HTML application being modularized incrementally.

The modularization strategy is:

**EXTRACTION WITH BEHAVIORAL PRESERVATION**

not:

**REWRITE FOR ARCHITECTURAL ELEGANCE**

For each extraction:

- identify exact source;
- identify exact target;
- map dependencies;
- preserve public contracts;
- preserve initialization order;
- preserve state semantics;
- preserve side effects;
- preserve error behavior;
- preserve security behavior;
- add seam-specific tests;
- run regression evidence;
- document the result.

Do not remove working legacy code merely because the target architecture looks cleaner.

Do not extract a cluster simply because the cluster is logically related.

Extract only when dependency evidence shows that the seam is safe.

---

# 22. STATE AND INITIALIZATION DISCIPLINE

State-heavy Core code requires special caution.

Before moving state-dependent functions, establish:

- who owns the state;
- who initializes it;
- when it becomes available;
- who mutates it;
- who persists it;
- who restores it;
- who depends on it;
- whether callers execute at top level;
- whether inline handlers depend on it;
- whether `window` bridges are required;
- whether module/classic-script boundaries affect execution.

Never assume lexical proximity means dependency safety.

Never assume an extraction is safe because syntax checks pass.

---

# 23. GLOBAL BRIDGE DISCIPLINE

Where the legacy HTML application depends on classic-script globals and modular code introduces imports, preserve the required bridge deliberately.

For any bridge:

- identify the existing consumer;
- verify export/import;
- verify bridge assignment;
- verify ordering;
- verify startup behavior;
- verify E2E/live behavior where relevant.

Do not create duplicate global APIs.

Do not expose new globals merely for convenience.

---

# 24. DOCUMENTATION DISCIPLINE

Important project documents include:

- `NEXUS-CURRENT-STATE.md`
- `NEXUS-CONTINUATION.md` when present
- `PLAN.md`
- `ROADMAP.md`
- phase documents
- ADRs
- checkpoints
- baseline documentation
- tests/evidence logs
- `CHANGELOG.md`

Keep documentation aligned with repository reality.

Do not silently rewrite historical records to make the project appear cleaner or more complete.

When correcting old status terminology:

- preserve historical meaning;
- use the official six-state system for current status;
- distinguish historical claims from current verification.

---

# 25. CONTINUITY CONTRACT

Every new Claude Project conversation must behave as a continuation of the **repository state**, not as a continuation of an assumed chat memory.

At the beginning of a new conversation:

1. read the Project Instructions;
2. read this document;
3. read the latest `NEXUS-CURRENT-STATE.md`;
4. read the latest relevant checkpoint;
5. inspect the repository and Git state;
6. identify the latest verified boundary/slice;
7. identify the smallest safe next TARGET SLICE;
8. do not re-plan the entire project;
9. do not repeat verified work;
10. execute only the selected slice;
11. verify it;
12. document it;
13. STOP.

A new conversation must not trigger an unnecessary re-analysis of the entire project.

However, it must perform enough current-state inspection to avoid acting on stale assumptions.

---

# 26. CONTINUATION SAFETY RULE

If the previous conversation ended while a slice was in progress:

Do not assume it succeeded.

Determine:

- current Git state;
- current diff;
- current files;
- current tests;
- current checkpoint/state documentation;
- whether restoration occurred;
- whether the working tree is clean or intentionally dirty;
- whether the previous slice reached `VERIFIED`.

Only then continue.

If the previous state is ambiguous:

**STOP → INSPECT → RECONSTRUCT → VERIFY**

Do not "continue from memory."

---

# 27. CURRENT STATE DOCUMENT CONTRACT

`NEXUS-CURRENT-STATE.md` is the primary dynamic project-state document.

It should contain, at minimum:

- Current Phase
- Current Boundary
- Current TARGET SLICE
- Latest Verified Commit
- Working Tree State
- Verified Work
- Current Test Evidence
- Unverified Items
- Blocked Items
- Known Risks
- Remaining Scope
- Next Safe Slice

Update it only from actual evidence.

Do not use it as a speculative plan.

---

# 28. CHECKPOINT CONTRACT

Checkpoints are evidence snapshots.

A checkpoint should make it possible for a future session to understand:

- what was attempted;
- what changed;
- what passed;
- what failed;
- what remains;
- what is verified;
- what is not verified;
- what the next safe slice is.

Do not create a checkpoint that merely says "completed."

---

# 29. ADR CONTRACT

ADRs record durable architectural decisions.

Use ADRs for decisions that materially affect:

- architecture;
- contracts;
- security boundaries;
- state ownership;
- compatibility;
- provider abstraction;
- execution model;
- major modularization strategy.

Do not create an ADR for every small code change.

Do not silently reverse a durable decision.

If strong evidence requires changing one, document the reason.

---

# 30. COMMERCIAL STANDARD

NEXUS is intended eventually to become commercially credible.

Commercial evaluation should focus on:

- real customer problems;
- measurable outcomes;
- reliability;
- security;
- operating cost;
- provider flexibility;
- differentiation;
- deployment practicality;
- maintainability;
- demonstrable end-to-end capability.

Do not equate feature count with product value.

Before broad commercialization claims, NEXUS should demonstrate useful real tasks repeatedly and produce dependable outcomes with evidence.

---

# 31. RESEARCH STANDARD

Research work should emphasize:

- explicit hypotheses;
- measurable behavior;
- reproducible experiments;
- controlled evaluation;
- traceable evidence;
- failure analysis;
- comparison against baselines;
- separation of experiment from production behavior.

Experimental capabilities must not automatically become production behavior.

A successful experiment is not automatically a production feature.

---

# 32. DECISION DISCIPLINE

When uncertain:

1. inspect first;
2. identify the actual dependency;
3. preserve current architecture;
4. choose the smallest reversible action;
5. test it;
6. verify it;
7. document it;
8. stop.

Do not solve hypothetical future problems in the current slice.

Do not broaden scope because adjacent issues were discovered.

Adjacent findings should normally be documented and deferred unless they:

- block the current acceptance criteria;
- create a material correctness problem;
- create a material security problem;
- invalidate the current architecture.

---

# 33. KNOWN NON-BLOCKING HISTORICAL FINDINGS

Previously recorded findings include:

- a legacy/unused `NexusContext.buildAgentContext` path whose live caller status required investigation;
- `retrieveLongTermMemoryContext` and whether additional fencing is required;
- `fence()` currently labels/warns rather than blocking content, treated as an intentional documented design choice;
- historical documentation inconsistencies around status language and Phase 2 counting terminology.

Do not automatically reopen these.

Revisit only when:

- the current slice depends on them;
- new evidence changes their significance;
- they become an explicit acceptance/security requirement.

---

# 34. NO-SCOPE-CREEP RULE

If an unrelated issue is discovered during a slice:

1. classify it;
2. determine whether it blocks the current acceptance criteria;
3. if not blocking, document it;
4. defer it.

Do not repair unrelated issues merely because they are nearby.

Do not expand the slice without an explicit reason.

The default behavior is:

**observe → record → defer**

not:

**observe → expand → refactor**

---

# 35. EVIDENCE LANGUAGE

Use precise language.

Prefer:

- "implemented"
- "tested"
- "verified"
- "partially verified"
- "unverified"
- "blocked"
- "historical evidence"
- "current evidence"

Avoid unsupported language such as:

- "fully complete"
- "production-ready"
- "100% safe"
- "all done"
- "guaranteed"
- "perfect"
- "fully verified"

unless the evidence genuinely supports that exact claim.

---

# 36. SESSION COMPLETION REPORT

At the end of each TARGET SLICE, provide a concise report containing:

### Status
One official status value.

### Slice
What exact scope was addressed.

### Changes
What files/functions/boundaries changed.

### Evidence
Commands and concrete results.

### Regression
What regression tests were run and what they proved.

### Limitations
What was not verified.

### Documentation
What state/checkpoint/ADR documentation was updated.

### Next Safe Slice
Exactly one recommended next slice.

Then STOP.

Do not automatically start the next slice.

---

# 37. MASTER OPERATING PRINCIPLE

NEXUS must not be made to merely **look finished**.

The objective is to make NEXUS:

**correct, secure, modular, reliable, measurable, commercially useful, and research-credible — with evidence.**

Prefer:

- small verified progress over large speculative progress;
- real behavior over claims;
- evidence over memory;
- architecture preservation over unnecessary redesign;
- measurable value over feature accumulation;
- reversible decisions over irreversible changes;
- explicit uncertainty over false confidence.

The correct answer may be:

**VERIFIED**

It may be:

**UNVERIFIED**

It may be:

**BLOCKED**

It may be:

**FAILED**

The status must always follow the evidence.

---

# 38. IMMEDIATE EXECUTION RULE

Unless current repository evidence shows otherwise, the immediate modularization path after the verified first four Phase 2 boundaries is:

**Core → Agents → Modes → Ops Center → Workspace**

But this is a roadmap, not permission to execute all of it in one session.

Only the smallest next TARGET SLICE may be executed.

For Core in particular:

**inspect → dependency-map → identify seam → extract smallest safe slice → test → verify → document → STOP**

Do not begin a large Core extraction without evidence that the seam is safe.

---

# 39. FINAL CONTINUITY DIRECTIVE

When a new conversation begins, the operative instruction is:

> Continue from the current verified repository state.
>
> First reconstruct the current state from the repository, Git, current-state document, relevant checkpoint, ADRs, and tests.
>
> Do not assume previous conversational context is authoritative.
>
> Do not repeat verified work.
>
> Do not redesign the project.
>
> Select the smallest safe TARGET SLICE that advances the current roadmap.
>
> Execute only that slice using:
>
> **INSPECT → MAP → DIAGNOSE → PATCH → TEST → VERIFY → DOCUMENT**
>
> If evidence is insufficient, stop and report `UNVERIFIED`.
>
> If blocked, report `BLOCKED`.
>
> If a Critical/High failure, regression, or unverified security boundary prevents safe continuation, stop.
>
> When the slice is verified, document the evidence and STOP.
>
> Do not automatically proceed to the next slice.

---

**END OF NEXUS v5.0 PROJECT MASTER ENGINEERING CONTEXT & OPERATING CONTRACT**
