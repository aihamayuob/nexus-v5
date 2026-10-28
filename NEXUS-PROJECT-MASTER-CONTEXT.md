# NEXUS v5.0 — PROJECT MASTER CONTEXT

> **Purpose:** Permanent project-level context for Claude Project Knowledge.
> This file is the central orientation document for NEXUS. It defines the project intent, architecture, execution philosophy, current roadmap, verification rules, and non-negotiable engineering constraints.
>
> **Authority rule:** This document explains the project and its operating principles. For the latest implementation status, repository evidence and the latest `NEXUS-CURRENT-STATE.md` / checkpoints take precedence. Code and reproducible repository evidence take precedence over memory, old reports, or unsupported claims.

---

## 1. PROJECT IDENTITY

**Project:** NEXUS v5.0  
**Current baseline reference:** `neural_nexus_ai_agents-4-3-5-3.html`  
**Primary engineering repository:** `nexus-backend` plus the current frontend/application sources and tests.

NEXUS is being developed as a **serious commercial and research-grade AI agent platform**.

It is not being treated as:
- a simple chatbot;
- a UI prototype;
- a collection of disconnected AI features;
- a code-generation exercise.

The long-term objective is a trustworthy, modular, provider-agnostic agent platform capable of executing real tasks, coordinating agents, using tools and memory safely, producing evidence-backed results, and operating across cloud and local AI providers.

The project should prove its value through **real, measurable end-to-end capabilities** before broad commercial expansion.

---

## 2. LONG-TERM VISION

Target architecture:

**Frontend → `nexus-backend` → Universal AI Gateway → Model Registry / Router → Agents / Runtime / Tools / Memory → Provider Adapters → Cloud + Local Providers**

Target provider model includes:
- Anthropic / Claude
- OpenAI
- DeepSeek
- Google / Gemini
- Ollama
- LM Studio
- other providers through provider adapters where justified

The architecture must remain:
- provider-agnostic;
- backend-controlled for secrets;
- modular;
- testable;
- observable without exposing secrets or hidden chain-of-thought;
- compatible with local/private execution;
- suitable for future research and production hardening.

---

## 3. STRATEGIC DIFFERENTIATORS

NEXUS is intended to evolve around several differentiated capabilities:

### NEXUS Mission
Goal → planning → execution → result.

### NEXUS Council
Multi-agent discussion, independent checking, and structured cross-examination where appropriate.

### NEXUS Warden
Governance and safety control for pause, resume, isolate, veto, approval, cancellation, and controlled execution.

### NEXUS Evidence
Explicit evidence states such as:
- `VERIFIED`
- `SUPPORTED`
- `UNCERTAIN`
- `CONFLICTING`
- `UNVERIFIED`

### Intelligent Routing
Support policy-driven routing such as:
- `BEST`
- `CHEAPEST`
- `FASTEST`
- `LOCAL_ONLY`
- `PRIVATE`
- `USER_SELECTED`

### Additional research / platform directions
Potential long-term capabilities include:
- failure memory;
- permission-aware tool fabric;
- MCP/tool integrations;
- memory compression;
- synthetic/research memory workflows;
- dynamic swarm execution;
- evaluation and evolution experiments;
- controlled fine-tuning/research paths;
- strong local/private execution.

These are **directional capabilities**, not permission to implement them automatically. Any new capability requires a real use case, bounded scope, and measurable validation.

---

## 4. CURRENT ENGINEERING OBJECTIVE

The immediate objective is to complete the **required modularization and architecture-preserving refactoring** of the current application without broad rewrites or behavioral regressions.

Only after the required modularization is sufficiently verified should the project shift its emphasis toward:
1. production reliability and hardening;
2. commercial readiness;
3. research/evaluation;
4. real-world end-to-end capability validation;
5. broader product expansion.

Do not add complexity merely because it is technically possible.

---

## 5. CURRENT PHASE ROADMAP

### Phase 0 — Baseline / Reality Lock
Purpose:
- establish the actual repository state;
- preserve a known baseline;
- verify build/test/security evidence;
- document the starting point.

**Current state: VERIFIED.**

### Phase 1 — Security Hardening
Purpose:
- remove/harden dangerous frontend patterns;
- preserve security boundaries;
- verify prompt-injection protections and related safety behavior.

**Current state: VERIFIED.**

The PromptInjectionGuard integration was specifically verified by testing the live path and demonstrating that intentional removal/bypass mutations are detected.

### Phase 2 — Modularization
Current state: **PARTIAL**

Nine planned boundaries:

1. Security — **VERIFIED**
2. Storage — **VERIFIED**
3. Utilities — **VERIFIED**
4. Settings UI sub-boundary — **VERIFIED**
5. Core — **PENDING / next major boundary**
6. Agents — **PENDING**
7. Modes — **PENDING**
8. Ops Center — **PENDING**
9. Workspace — **PENDING**

Core is expected to be the next boundary, but it must first be reduced to the **smallest safe, evidence-driven TARGET SLICE**.

Important: Core contains the deferred `PERSISTABLE_STATE` work and the associated state-variable dependencies discussed in the project ADRs. This does **not** authorize a large extraction in one step.

### After Phase 2
Once required modularization is verified:
- reliability / production hardening;
- commercial readiness;
- research/evaluation track;
- real-world capability validation.

The exact sequencing may be refined from repository evidence, but the underlying objective remains unchanged.

---

## 6. CURRENT VERIFIED BASELINE

Known verified evidence from the latest project work includes:

- Phase 0 verified.
- Phase 1 verified.
- Phase 2 boundaries 1–4 verified.
- Frontend PromptInjectionGuard integration verified.
- Frontend Vitest reached `124/124` in the latest security integration slice.
- The HTML application source was restored byte-for-byte / comparison-identical after intentional regression probes.
- Previous backend verification recorded `406/406`.
- Previous frontend baseline verification recorded `116/116` before the additional integration tests.
- Previous E2E evidence recorded `12/12` and `16/16`; do not describe these as freshly rerun unless they actually are.

**Evidence freshness rule:** Older evidence remains historical evidence. Never imply a test was rerun when it was not.

---

## 7. STATUS SYSTEM — OFFICIAL

The only current project status vocabulary is:

`VERIFIED / PARTIAL / PENDING / BLOCKED / FAILED / UNVERIFIED`

Definitions:

### VERIFIED
The required scope was implemented and validated with concrete, reviewable evidence.

### PARTIAL
Part of the scope is complete, but required scope or verification remains incomplete.

### PENDING
The slice or scope has not started yet.

### BLOCKED
Execution cannot continue because of a real dependency, unavailable environment, missing credential, or required decision.

### FAILED
Execution was attempted but acceptance criteria were not achieved.

### UNVERIFIED
Implementation may exist, but required verification evidence is insufficient or incomplete.

### Hard rule
**Never use `DONE` as a current status.**

Never infer `VERIFIED` merely from:
- code existing;
- compilation success;
- typecheck success;
- passing tests that do not exercise the required behavior;
- old reports;
- previous memory;
- claims that cannot be reproduced or audited.

When evidence is insufficient, prefer `UNVERIFIED` rather than guessing.

---

## 8. EXECUTION PROTOCOL

The project uses:

**INSPECT → MAP → DIAGNOSE → PATCH → TEST → VERIFY → DOCUMENT**

Apply only the steps required for the current TARGET SLICE.

The fundamental execution unit is a **small TARGET SLICE**:
- one clear objective;
- bounded scope;
- explicit acceptance/evidence;
- minimal changes;
- explicit stop point.

Do not turn a TARGET SLICE into a new large phase.

Do not automatically continue into the next slice.

---

## 9. PRIORITY ORDER

When trade-offs occur, use this priority order:

**correctness → security → architecture → compatibility → reliability → performance → intelligence → UX**

A more advanced feature is not a valid reason to weaken correctness, security, compatibility, or evidence quality.

---

## 10. ARCHITECTURAL PRINCIPLES

Preserve the existing architecture and decisive prior choices unless strong technical evidence proves a change is necessary.

Do not:
- perform broad rewrites;
- replace the architecture simply for elegance;
- create duplicate registries between frontend and backend;
- break existing contracts;
- remove legacy compatibility without evidence and a migration requirement;
- introduce speculative abstractions;
- create unnecessary coupling;
- implement fake credentials or fake integrations.

### Compatibility
Preserve legacy `/api/*` compatibility where required by the current project contract.

### Secrets
Provider/API secrets must remain backend-only.

### Security
Maintain:
- auth and authorization boundaries;
- CORS controls;
- rate limits;
- SSRF protections;
- prompt-injection defenses;
- auditing;
- safe error handling;
- appropriate timeout/retry/cancellation behavior;
- fail-closed behavior where required.

Never put secrets or hidden chain-of-thought into observability, logs, or evidence artifacts.

---

## 11. FRONTEND MODULARIZATION PRINCIPLES

The current frontend is a large HTML application being modularized incrementally.

The modularization strategy is **extraction with behavioral preservation**, not rewriting.

When extracting code:
- preserve behavior;
- preserve contracts;
- preserve state semantics;
- preserve initialization order;
- preserve compatibility;
- use the smallest safe seam;
- add or preserve tests around the seam;
- verify before moving onward.

Do not remove working legacy code merely to make the architecture appear cleaner.

---

## 12. CORE BOUNDARY RULE

Core is the next major boundary.

Because Core includes deferred persistent state and many state-variable dependencies, the first Core work must be **inspection and dependency mapping**, not a large extraction.

The preferred progression is:
1. inspect the actual repository;
2. map dependencies and execution order;
3. identify the smallest safe extraction seam;
4. stop and document before broad extraction when uncertainty remains.

Do not extract the 16 state variables or `PERSISTABLE_STATE` wholesale merely because they appear in the Core plan.

---

## 13. TESTING / EVIDENCE STANDARD

A slice is not complete because the code "looks correct."

Evidence should be reproducible where practical and should identify:
- command;
- result;
- affected files;
- relevant lines / test names;
- what behavior is actually proven.

Use the narrowest relevant tests first, then appropriate regression tests.

When an environment prevents a test from running:
- record it;
- do not convert the missing evidence into `VERIFIED`;
- distinguish `BLOCKED` from `UNVERIFIED` accurately.

Intentional fault-injection/regression probes are valuable when they demonstrate that a test catches the failure it is supposed to catch.

---

## 14. DOCUMENTATION / CONTINUITY

Important project documents include:

- `NEXUS-CURRENT-STATE.md`
- `NEXUS-CONTINUATION.md` (when present)
- `PLAN.md`
- `ROADMAP.md`
- phase documents
- ADRs
- checkpoints
- baseline documentation
- tests and evidence logs
- `CHANGELOG.md`

Keep documentation aligned with repository reality.

Do not silently rewrite historical records to make the project look cleaner.

When correcting old status terminology, preserve historical meaning while ensuring current operational status uses the official six-state system.

---

## 15. SOURCE-OF-TRUTH HIERARCHY

When information conflicts, use this order:

1. Current repository implementation and reproducible repository evidence
2. Current tests and their actual outputs
3. Latest valid `NEXUS-CURRENT-STATE.md`
4. Relevant current checkpoints
5. ADRs / plans / roadmap
6. Older reports and historical notes
7. Conversation memory or assumptions

A document never overrides contradictory current code/evidence merely because it says something was completed.

---

## 16. COMMERCIAL STANDARD

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

Before broad commercialization, the platform should demonstrate useful real tasks repeatedly and provide evidence that the system produces dependable outcomes.

---

## 17. RESEARCH STANDARD

The project also aims to be research-grade.

Research work should emphasize:
- explicit hypotheses;
- measurable behavior;
- reproducible experiments;
- controlled evaluation;
- traceable evidence;
- failure analysis;
- comparison against baselines;
- separation between experiment and production promotion.

Experimental capability must not automatically become production behavior merely because an experiment succeeds.

---

## 18. DECISION DISCIPLINE

When uncertain:

1. inspect first;
2. preserve the current architecture;
3. choose the smallest reversible action;
4. test it;
5. verify it;
6. document it;
7. stop.

Do not solve hypothetical future problems in the current slice.

Do not broaden scope because adjacent issues were discovered.

Adjacent findings may be documented as findings and deferred unless they block the current acceptance criteria or create a material security/correctness problem.

---

## 19. STOP CONDITIONS

Stop the current slice when:
- acceptance criteria are met and verified;
- evidence is insufficient;
- a real blocker exists;
- tests fail and the failure is not resolved within the slice;
- proceeding would require a broader architectural decision.

Never silently continue into another TARGET SLICE.

A `VERIFIED` result must be earned by evidence.

---

## 20. SESSION CONTINUITY RULE

For every new conversation in this project:

1. Read this file.
2. Read the latest `NEXUS-CURRENT-STATE.md`.
3. Inspect the current repository/working tree when available.
4. Do not re-plan the entire project.
5. Do not repeat previously verified work.
6. Determine the smallest next TARGET SLICE from current evidence.
7. Execute only that slice.
8. Stop with a concise Arabic report.

Typical continuation instruction:

> **Continue from the current verified repository state. Execute the smallest next TARGET SLICE only. Then STOP.**

---

## 21. IMPORTANT CURRENT CONTEXT

Known non-blocking findings that have previously been recorded include:
- a legacy/unused `NexusContext.buildAgentContext` path whose live caller status required investigation;
- `retrieveLongTermMemoryContext` and whether additional fencing is required;
- `fence()` currently labels/warns rather than blocking content, which was treated as an intentional documented design choice;
- historical documentation inconsistencies around status language and some Phase 2 counting terminology.

Do not reopen these automatically. Revisit them only when:
- the current slice depends on them;
- new evidence changes their significance;
- or they become an explicit acceptance/security requirement.

---

## 22. NON-NEGOTIABLE PROJECT BEHAVIOR

The goal is not to make NEXUS look finished.

The goal is to make NEXUS **correct, secure, modular, reliable, measurable, commercially useful, and research-credible — with evidence.**

Prefer:
- small verified progress over large speculative progress;
- real behavior over claims;
- evidence over memory;
- architecture preservation over unnecessary redesign;
- measurable value over feature accumulation.

When the correct answer is "not yet verified," say so.

When the correct answer is "blocked," say so.

When the correct answer is "verified," show the evidence.

**END OF MASTER CONTEXT**
