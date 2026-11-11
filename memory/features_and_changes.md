# Features & System Changes

This document tracks all features, refactors, and bug fixes introduced during our pair-programming sessions in a simple, practical, and efficient format.

---

## [Entry 001] Memory System Initialization
- **Date**: 2026-10-02
- **Type**: Tooling / Documentation

### What We Did
Created the [`memory/`](./README.md) directory to serve as a lightweight, persistent memory of our work together.

### Why
To maintain continuity across conversations, providing clear, human-readable records of what was built, why decisions were made, and how each feature was implemented.

### How It Works
- [`session_history.md`](./session_history.md): Records user goals, discussions, and high-level milestones per session.
- [`features_and_changes.md`](./features_and_changes.md): Records technical details, modified files, architecture patterns, and concise explanations of new features or bug fixes.

---

## [Entry 002] R3.8 — Calibration Repair Executor
- **Date**: 2026-10-02
- **Type**: Feature / Repair Engine

### What We Did
Built the calibration executor that handles `failureReason = "overconfident"`. When a student says "I was confident, but got it wrong", this executor surfaces the confidence-accuracy mismatch.

### Why
Before R3.8, if a student selected "I was confident but got it wrong", the API returned "not yet implemented". Now they get a targeted intervention that shows what they believed, what was actually correct, why their confidence was misplaced, and a concrete self-check for next time.

### How It Works
1. `overconfident` → maps to `calibration` intent in [`repair-request.builder.ts`](../src/lib/repair/repair-request.builder.ts)
2. [`calibration.executor.ts`](../src/lib/repair/calibration.executor.ts) generates a `CalibrationBreakdown`:
   - `whatYouBelieved` — the assumption the student held
   - `whatWasActuallyCorrect` — the fact that decided it
   - `whereConfidenceBroke` — why the belief felt right but was wrong
   - `selfCheck` — a question they can ask themselves next time
3. Plus a verification MCQ (same R3.3 flow as all other executors)
4. Wired into [`/api/repair`](../src/app/api/repair/route.ts) route
5. Added to `VERIFIABLE_REPAIR_INTENTS` in [`repair-verification.ts`](../src/lib/repair/repair-verification.ts)

### Files Changed
- **Created**: `src/lib/repair/calibration.executor.ts`, `src/lib/repair/__tests__/calibration.test.ts`
- **Modified**: `src/app/api/repair/route.ts`, `src/lib/repair/repair-verification.ts`

### Validation
- 136/136 test assertions passed
- TypeScript compiles clean
- Existing R3.7 tests still pass (125/125)

## [Entry 003] R3.9 — Error Awareness Repair Executor
- **Date**: 2026-10-02
- **Type**: Feature / Repair Engine

### What We Did
Built the error awareness executor that handles `failureReason = "careless_mistake"`. This executor explicitly avoids diagnosing a gap or reteaching the concept, instead focusing on the process error.

### Why
When a student selects "I made a careless mistake", they believe they knew the answer but failed to select it due to an oversight. Reteaching the concept here is frustrating. Instead, this executor surfaces the specific oversight (e.g., missed a "NOT" in the question), explains why it's a common trap, and provides a concrete verification procedure to avoid it next time.

### How It Works
1. `careless_mistake` → maps to `error_awareness` intent.
2. [`error-awareness.executor.ts`](../src/lib/repair/error-awareness.executor.ts) generates an `ErrorAwarenessBreakdown`:
   - `whatWasOverlooked` — the specific thing skipped or missed
   - `theTrap` — why this mistake is easy to make
   - `checkingStep` — concrete verification procedure
   - `patternAwareness` — what to watch for in similar questions
3. Includes a verification MCQ with a similar trap (e.g., another negated question) to test careful reading.
4. Wired into [`/api/repair`](../src/app/api/repair/route.ts).

### Validation
- 147/147 test assertions passed
- Verified complete isolation (no legacy R2 or SM-2 diagnosis triggered).

## [Entry 005] Gold-Standard QA Rewrite of R3.6, R3.7, and R3.8
- **Date**: 2026-10-02
- **Type**: Refactor / Repair Engine Quality Assurance

### What We Did
1. Rewrote **R3.6 (Question Interpretation)**, **R3.7 (Uncertainty Resolution)**, and **R3.8 (Calibration)** to achieve full quality parity with the R3.9 gold-standard executor pattern.
2. Updated and harmonized test assertions across `question-interpretation.test.ts` and `repair-verification.test.ts` to reflect the 6 active verifiable executors.
3. Verified 100% test passing rate across all 10 repair test suites (1,093+ deterministic test assertions).

### Why
The earlier versions of these executors had flat/unstructured prompts, minimal pedagogical typing, or informal comments. R3.9 set a new bar for production-grade AI prompt engineering:
- Explicit prompt sections (`RESPONSE FORMAT`, `CONTENT RULES`, `BOUNDARIES`) with concrete positive/negative examples.
- Pedagogical JSDoc mapping TypeScript interface fields directly to the student question they resolve.
- Documented two-mode generation (with vs. without question context) to prevent AI hallucination.
- Documented execution pipeline flow with standard section delimiters.

### How It Works
- **R3.6 (`question-interpretation.executor.ts`)**: Targets stem misreading, task verbs (`NOT`, `EXCEPT`), qualifiers, and option framing. Does not reteach. Verification tests interpretation, not answer recall.
- **R3.7 (`uncertainty-resolution.executor.ts`)**: Enforces strict NO-DIAGNOSIS boundaries. Targets the key distinction between correct and rival options with actionable discrimination rules.
- **R3.8 (`calibration.executor.ts`)**: Highlights the mismatch between belief and reality (`whereConfidenceBroke`), equips the student with pre-commit self-checks, and gracefully degrades invalid values using `.catch(null)`.

### Files Changed
- **Modified**:
  - `src/lib/repair/question-interpretation.executor.ts`
  - `src/lib/repair/uncertainty-resolution.executor.ts`
  - `src/lib/repair/calibration.executor.ts`
  - `src/lib/repair/__tests__/question-interpretation.test.ts`
  - `src/lib/repair/__tests__/repair-verification.test.ts`

### Validation
All 10 repair test suites passing:
- `active-recall.test.ts`: 117/117 ✅
- `calibration.test.ts`: 136/136 ✅
- `concept-teaching.test.ts`: 70/70 ✅
- `error-awareness.test.ts`: 147/147 ✅
- `question-interpretation.test.ts`: 98/98 ✅
- `repair-next-action.test.ts`: 59/59 ✅
- `repair-request.test.ts`: 103/103 ✅
- `repair-understanding.test.ts`: 299/299 ✅
- `repair-verification.test.ts`: 143/143 ✅
- `uncertainty-resolution.test.ts`: 125/125 ✅

---

## [Entry 006] R3.10 — Clarification Repair Executor
- **Date**: 2026-10-07
- **Type**: Feature / Repair Engine

### What We Did
Built the clarification executor that handles `failureReason = "not_sure"`. This handles cases where the student doesn't know what went wrong.

### Why
We needed a way to support students who are stuck without assuming a specific gap or reteaching a concept they might already know. This executor helps the student discover their own difficulty.

### How It Works
1. `not_sure` → maps to `clarification` intent.
2. [`clarification.executor.ts`](../src/lib/repair/clarification.executor.ts) generates a `ClarificationBreakdown`:
   - `whatTheQuestionNeeded` — neutral prerequisite knowledge context
   - `possibleStumblingPoints` — 2-3 concrete places to get stuck
   - `howToNarrowItDown` — self-diagnostic procedure
   - `nextTimeStrategy` — general approach strategy
3. **Unique feature**: `verificationRequired = false`. It deliberately returns `verification: null` because we cannot verify remediation of an unknown gap.
4. Wired into [`/api/repair`](../src/app/api/repair/route.ts).

### Files Changed
- **Created**: `src/lib/repair/clarification.executor.ts`, `src/lib/repair/__tests__/clarification.test.ts`
- **Modified**: `src/app/api/repair/route.ts`, `src/lib/repair/__tests__/question-interpretation.test.ts`

### Validation
- 163/163 test assertions passed for clarification.
- All 11 repair test suites passing.

---

## [Entry 007] Frontend Repair UI Architecture & Planning
- **Date**: 2026-10-07
- **Type**: Architecture / Planning

### What We Did
Researched the frontend `PracticeCard.tsx` and `RevisionList.tsx` components and mapped out exactly how to integrate the completed Repair Engine backend. Produced a detailed implementation plan.

### Why
To ensure a structured, two-phase approach to wiring up the UI:
1. Extending Practice to handle the 3 remaining failure reasons (`overconfident`, `careless_mistake`, `not_sure`).
2. Integrating the complete repair lifecycle into the Revision flow when students mark a concept as "Forgot".

### Validation
- Validated that `not_sure` (Clarification Executor) correctly handles `verification: null`.
- Validated state management patterns across the components.

---

## [Entry 008] Phase 1 Frontend UI Integration — PracticeCard
- **Date**: 2026-10-09
- **Type**: Feature / UI Integration

### What We Did
Updated `PracticeCard.tsx` to handle the final 3 failure reasons (`overconfident`, `careless_mistake`, `not_sure`), successfully bringing the entire completed backend repair engine into the practice UI.

### How It Works
1. Added 3 new inline interfaces (`CalibrationRepairData`, `ErrorAwarenessRepairData`, `ClarificationRepairData`) to the `RepairData` union.
2. Updated `REPAIRABLE_FAILURE_REASONS`, `REPAIR_CTA_LABEL`, and `REPAIR_MODES` (with new icons `Target`, `AlertTriangle`, `Compass`).
3. Added mapping logic inside `repairBlocks` to render the unique data shapes for these intents.
4. **Clarification Special Case**: Safely bypassed the verification MCQ, self-assessment, and next-action components for the `clarification` intent (which has `verification: null`), replacing it with a simple, supportive exit message.

### Files Changed
- **Modified**: `src/components/features/practice/PracticeCard.tsx`

---

## [Entry 009] Phase 2 Frontend UI Integration — RevisionList (Partial)
- **Date**: 2026-10-09
- **Type**: Architecture / UI Setup

### What We Did
Prepared `RevisionList.tsx` for the full repair lifecycle when a student selects "Forgot" or "Partially" during a revision session.

### How It Works
1. Ported all repair-related type definitions, blocks, and next-action utilities into the file.
2. Added state variables keyed by `conceptId` (since revision lists lack a `questionIndex`) to handle repair loading, verification, and understanding flows.
3. Created the `REVISION_REPAIR_CTA` mapping to automatically map "Forgot" to `concept_not_understood` and "Partially" to `could_not_recall`.
4. *Pending*: The UI actually rendering the repair CTA and block after self-assessment.

### Files Changed
- **Modified**: `src/components/features/revision/RevisionList.tsx`

---

## [Entry 010] Phase 2 Frontend UI Integration — RevisionList (Complete)
- **Date**: 2026-10-15
- **Type**: Feature / UI Integration

### What We Did
Completed the RevisionList.tsx repair lifecycle integration. When a student marks "Forgot" or "Partially" during revision, they now get an optional repair CTA instead of the concept being silently removed.

### How It Works
1. **Modified `handleSelfAssess`**: "Remembered" still removes the concept immediately. "Forgot"/"Partially" sets `repairOffered` state and keeps the card active.
2. **Repair CTA**: An amber-bordered CTA button appears with the mapped label from `REVISION_REPAIR_CTA` (e.g., "Help me re-learn this concept" for Forgot). A "Skip — I'll review it later" dismiss link is always available.
3. **5 handler functions added**:
   - `handleRequestRevisionRepair` — fetches repair from `/api/repair` using the mapped failure reason
   - `handleRevisionVerificationSelect` — grades + persists the verification MCQ answer
   - `handleRevisionUnderstandingSelect` — persists self-report + derives R3.4 next-action locally
   - `handleRevisionAnotherRepair` — clears state and re-fetches for re-offer budget
   - `handleDismissRepair` — cleans up all repair state and removes concept from list
4. **Full repair card rendering**: Repair mode header, content blocks (all 7 intents supported), active_recall retrieval-first flow, clarification special case (no verification), verification MCQ with grading, post-repair understanding self-report, and next-action routing (repair_complete, leave_for_revision, offer_another_repair).
5. **Keying**: All state maps keyed by `conceptId` (not question index, unlike PracticeCard).

### Files Changed
- **Modified**: `src/components/features/revision/RevisionList.tsx`

### Validation
- TypeScript compiles clean for RevisionList.tsx (0 errors).
- 3 pre-existing TS errors remain in PracticeCard.tsx (unrelated to this change).


---

## [Entry 011] PracticeCard.tsx — TypeScript Null-Check Fixes
- **Date**: 2026-10-15
- **Type**: Bugfix / TypeScript

### What We Did
Fixed the 3 pre-existing TypeScript errors in `PracticeCard.tsx` caused by accessing `repair.verification` without null-checking for the `clarification` intent (which has `verification: null`).

### Why
The `ClarificationRepairData` type correctly declares `verification: null`, but two handler functions (`handleVerificationSelect` and `handleUnderstandingSelect`) accessed `repair.verification.correctAnswer` and `repair.verification.question` without narrowing. These code paths are unreachable for clarification (the UI never renders verification MCQ or understanding report for it), but TypeScript couldn't statically prove that.

### How It Works
Added `if (!repair.verification) return;` early-return guards in both handlers, immediately after the existing `if (!repair) return;` check. This narrows the type and satisfies the compiler without changing any runtime behavior.

### Files Changed
- **Modified**: `src/components/features/practice/PracticeCard.tsx`

### Validation
- Full project: 0 TypeScript errors (`npx tsc --noEmit` exits clean).

---

## [Entry 012] PracticeCard.tsx — Fix Runtime TypeError (repairIntent on undefined)
- **Date**: 2026-10-15
- **Type**: Bugfix / UI Runtime Error

### What We Did
Fixed a runtime `TypeError: Cannot read properties of undefined (reading 'repairIntent')` in `PracticeCard.tsx`.

### Why
The JSX block for `clarification` intent guidance (`repair.repairIntent === "clarification"`) had been mistakenly placed directly in the MCQ item loop right after `{showPostOutcome && (...)}`. At render time, before any repair is requested or fetched for a question, `repairData[idx]` is `undefined`. Accessing `repair.repairIntent` caused an immediate crash when opening the Prelims MCQs list.

### How It Works
Moved the clarification message block into the `{repair && (...)}` container right after `repairBlocks(repair).map(...)`, ensuring `repair` is defined and active before its properties are accessed.

### Files Changed
- **Modified**: `src/components/features/practice/PracticeCard.tsx`

### Validation
- Next.js production build succeeded (`npm run build` exits 0).
- Deterministic repair tests passed (136/136).

---

## [Entry 013] Comprehensive Diagnostic & Post-Practice Loop Audit
- **Date**: 2026-10-28
- **Type**: Architecture Audit & Planning

### What We Did
Audited the entire Diagnostic system (`/dashboard/diagnostic`), Practice flow (`PracticeCard.tsx`, `PracticeList.tsx`), Repair engine (`repair-request.builder.ts`, 7 executors), and Content subsystems (`notes/NoteCard.tsx`, `RelatedConcepts.tsx`, `PYQSection.tsx`).

### Why
The user reported `/dashboard/diagnostic` showing 0 healthy concepts, all 4 in "Need Attention", and concept names displaying as raw truncated UUIDs (`75d55a3b...`). Furthermore, the intended pedagogical loop—*Practice → Evidence → Repair → Reinforcement (Targeted Notes, More MCQs, Dominoes, PYQs, Fill-in-the-blank, Mains) → Revision*—was completely stalled after practice repairs.

### Key Audit Findings
1. **Diagnostic UUID Bug**: `diagnostic.service.ts` groups `revision_events` by `conceptId` but never joins or retrieves `displayName` from `concepts` table. `DiagnosticView.tsx` `shortenId()` truncates raw UUIDs.
2. **Diagnostic Read-Only Dead End**: The diagnostic page classifies concepts into 4 gaps (`concept_gap`, `memory_gap`, `calibration_gap`, `revision_gap`) but offers zero interactive or corrective actions.
3. **Disconnection Between Diagnostic (R2) and Repair (R3)**: Diagnostic gap taxonomy is completely decoupled from Repair failure reasons (`concept_not_understood`, `could_not_recall`, etc.).
4. **Post-Practice Termination**: In `PracticeCard.tsx`, after repair verification and student self-assessment, the flow terminates with text messages (`repair_complete`, `leave_for_revision`).
5. **Static Content vs Dynamic Reinforcement**: The existing Knowledge notes and Practice Mains questions are static batch assets generated during initial hydration. No dynamic post-practice content engine exists to serve gap-specific targeted notes, transfer MCQs, domino links, PYQs, or fill-in-the-blank drills based on what went wrong in a session.

### Files Audited
- `src/components/features/diagnostic/DiagnosticView.tsx`
- `src/lib/diagnostic/diagnostic.service.ts`
- `src/lib/diagnostic/diagnostic.engine.ts`
- `src/app/api/diagnostic/route.ts`
- `src/components/features/practice/PracticeCard.tsx`
- `src/components/features/practice/PracticeList.tsx`
- `src/lib/repair/repair-request.builder.ts`
- `src/lib/repair/repair-next-action.ts`
- `src/components/features/notes/NoteCard.tsx`
- `src/components/features/notes/RelatedConcepts.tsx`
- `src/components/features/notes/PYQSection.tsx`

### Action Plan
- **Phase 1**: Concept name resolution in `diagnostic.service.ts` + action buttons in `DiagnosticView.tsx`.
- **Phase 2**: Build Post-Practice Orchestrator to generate and serve targeted reinforcement material (Notes, MCQs, Dominoes, PYQs, Fill-in-the-blank, Mains) and pipe into SM-2 revision.


---

## [Entry 014] Steps 2–3 Audit — Practice → Repair Integration & Post-Practice Reinforcement
- **Date**: 2026-11-10
- **Type**: Architecture Audit (read-only, no code changes)

### What We Did
Verified the Product Vision document against the repository (all 7 executors present and wired; 16/16 suites, 1,835 assertions; tsc clean; repair module isolated from legacy diagnostic and SM-2), then audited the Practice → Repair loop and the post-practice reinforcement experience.

### Why
The vision document marked R3.6–R3.10 as unverified and asked for an audit of the real student experience before building anything further.

### Findings — Practice → Repair (Step 2)
| # | Finding | Where | Severity |
|---|---|---|---|
| 1 | Verification correct answer is client-supplied; repair content never stored server-side | `repair-verification.ts`, `api/repair/verify/route.ts` | 🟡 Medium (trust gap) |
| 2 | `not_sure` / clarification leaves no repair evidence (no verification → no understanding → no next action) | `PracticeCard.tsx`, `clarification.executor.ts` | 🟡 Medium |
| 3 | Repair content (what was shown) never persisted; only verification question text | all executors, verify route | 🟡 Medium |
| 4 | "Try a different way" re-runs the same executor with identical input | `PracticeCard.tsx handleAnotherRepair` | 🟢 Low |
| 5 | Failed verification save → understanding POST 404s; both writes lost silently | `PracticeCard.tsx`, `api/repair/understanding/route.ts` | 🟢 Low |
| 6 | Repair state is session-local; refresh erases it (by design) | `PracticeCard.tsx`, `RevisionList.tsx` | 🟢 Low |
| 7 | Revision maps Forgot → `concept_not_understood` for the student (Rule 2 tension) | `RevisionList.tsx REVISION_REPAIR_CTA` | 🟢 Low |
| 8 | Mains / Interview have no repair path | `PracticeCard.tsx` | 🟡 Medium |

### Findings — Post-Practice Reinforcement (Step 3)
| # | Finding | Where | Severity |
|---|---|---|---|
| 9 | Repair executors generate from name/subject/keywords; never read existing `ai_notes` (Rule 13 violation) | `api/repair/route.ts executorInput`, `*.executor.ts` | 🔴 High |
| 10 | No consumer of `repair_verification` / `repair_understanding` events (diagnostic extractor, surfacing engine, adaptive engine all ignore them) | `feature.extractor.ts`, `question-surfacing.engine.ts`, `adaptive-intelligence.*` | 🔴 High |
| 11 | `/api/notes` default limit 50 (max 100) hides older concepts on Knowledge AND starves `RevisionList` note lookup → "No study notes generated" for due concepts outside newest 50 | `api/notes/route.ts`, `RevisionList.tsx` | 🔴 High (bug) |
| 12 | After next-action, Practice ends with static text; no link to note / related concepts / PYQs | `PracticeCard.tsx` | 🟡 Medium |
| 13 | Micro-notes, transfer MCQs, dominoes, PYQ resurfacing, fill-in-the-blank, Mains drills: not implemented anywhere | — | 🟡 Product gap |

### What Is Real vs Idea
- **Real**: Knowledge repository (notes + per-concept related concepts / PYQs on Knowledge page). Revision reuses Knowledge notes for its recall step — the only existing resurfacing path.
- **Idea only**: every post-practice reinforcement intervention listed in Section 3 of the vision document.

### Suggested Next Step (not started)
A retrieval-only reinforcement query: `(conceptId, failureReason, verificationOutcome) → { existing note, related concepts, matched PYQs, one unseen MCQ }`, zero generation. Fixes #9 by grounding executors, gives #10 a consumer, and is the foundation for Step 4's question-based Revision Session.

### Files Audited
- `src/components/features/practice/PracticeCard.tsx`, `PracticeList.tsx`
- `src/components/features/revision/RevisionList.tsx`
- `src/app/api/repair/route.ts`, `verify/route.ts`, `understanding/route.ts`
- `src/app/api/practice/route.ts`, `src/app/api/notes/route.ts`, `src/app/api/revision/route.ts`
- `src/lib/repair/repair-next-action.ts`, `repair-verification.ts`, `repair-understanding.ts`, `*.executor.ts`
- `src/lib/ai/services/question-surfacing.engine.ts`, `revision-intelligence.service.ts`
- `src/lib/evidence/evidence.normalizer.ts`, `src/lib/diagnostic/feature.extractor.ts`
- `src/components/features/notes/NotesList.tsx`, `NoteCard.tsx`, `RelatedConcepts.tsx`, `PYQSection.tsx`

---

## [Entry 015] Post-Practice Reinforcement — Retrieval-Only "Lock It In" Layer
- **Date**: 2026-11-11
- **Type**: Feature / Learning Loop (Step 3 of the vision roadmap)

### What We Did
Built the first post-practice reinforcement layer. After a repair finishes (any R3.4 next action) or a clarification is shown, the student gets a short, ready-made "Lock it in" panel assembled ENTIRELY from their existing Knowledge: the concept's own note (core idea, memory hooks, exam triggers, static↔current links), matched PYQs, one unseen transfer MCQ, and up to two related-concept "dominoes" each with its note's core idea and a question. Zero LLM calls. Also grounded all seven repair executors in the existing note, and fixed the `/api/notes` 50-concept cap.

### Why
Audit Entry 014 found that repairs regenerated content instead of reusing Knowledge (Rule 13), that repair events had no consumer, and that Practice dead-ended in a sentence of text after a repair. This entry closes all three with retrieval, not generation.

### How It Works
1. **Engine** — [`src/lib/reinforcement/reinforcement.engine.ts`](../src/lib/reinforcement/reinforcement.engine.ts): pure functions.
   - `summarizeHistory(events)` reads `mcq_attempt`, `repair_verification` and `repair_understanding` events → attempted question ids, repair count, last verification result, last self-report. **First consumer of repair events.**
   - `pickTransferMcq(inventory, history, exclude)` → an unseen MCQ from `concept_questions`, never the one just missed; falls back deterministically.
   - `orderSections({failureReason, outcome, history})` → up to 5 sections. Base order per failure reason (e.g. `could_not_recall` → hooks first, never re-teaches; `misunderstood_question` → transfer question first). `repair_complete` drops the core idea; a failed last verification or "still_not_understood" pulls it to the front.
2. **Service** — [`reinforcement.service.ts`](../src/lib/reinforcement/reinforcement.service.ts): parallel reads from concept, note, concept_questions, pyq matches, relationships, revision_events repositories. Dominoes = strongest `concept_relationships` edges → that concept's note core idea + one unseen MCQ. Sections with no content are dropped server-side.
3. **API** — `GET /api/reinforce?conceptId&failureReason&outcome&excludeQuestionId&excludeQuestionIndex`. Validates against `ALL_FAILURE_REASONS` and `ALL_REINFORCEMENT_OUTCOMES`. Ownership-checked. Never touches SM-2 or mastery.
4. **UI** — [`ReinforcementPanel.tsx`](../src/components/features/reinforcement/ReinforcementPanel.tsx): renders sections in server order. Questions are answerable; an answer posts a normal `mcq_attempt` to `/api/revision` (same quality mapping as PracticeCard, 4/1) so SM-2 treats it as ordinary practice — including for the domino concept.
   - `PracticeCard.tsx`: shown after `repair_complete`, `leave_for_revision`, and for clarification (which has no verification). Excludes the MCQ just missed.
   - `RevisionList.tsx`: same three insertion points, concept-level.
5. **Executor grounding** — [`note-grounding.ts`](../src/lib/repair/note-grounding.ts) formats the latest `ai_notes` row (core idea, ≤4 hooks, ≤4 triggers) into a "STUDENT'S EXISTING NOTE (ground truth — stay consistent)" block. `/api/repair` fetches the note once and passes `conceptNote` to every executor; all seven `buildUserPrompt` functions take it as an optional trailing parameter. Tests unchanged in behaviour (optional field).
6. **Notes cap fix** — `/api/notes` default limit 50→500 (max 1000) and new `?conceptId=` single-concept lookup. `RevisionList.handleRevealMaterial` now fetches `?conceptId=` instead of scanning the first 50.

### Files Changed
- **Created**: `src/lib/reinforcement/reinforcement.engine.ts`, `reinforcement.service.ts`, `__tests__/reinforcement-engine.test.ts`, `src/app/api/reinforce/route.ts`, `src/components/features/reinforcement/ReinforcementPanel.tsx`, `src/lib/repair/note-grounding.ts`
- **Modified**: all 7 `src/lib/repair/*.executor.ts`, `src/app/api/repair/route.ts`, `src/app/api/notes/route.ts`, `src/components/features/practice/PracticeCard.tsx`, `src/components/features/revision/RevisionList.tsx`, `src/lib/repair/__tests__/active-recall.test.ts` (runtime-import pin 3→4, asserts note-grounding is import-free)

### Validation
- `npx tsc --noEmit`: clean.
- 17/17 suites, 2,268 assertions (new engine suite: 431, incl. 120 reason×outcome×history combinations proven total + deterministic; isolation checks that engine has one type-only import and service never imports SM-2 / legacy R2 / AI client / `logEvent`).
- Dev server: `/api/reinforce` and `/api/notes?conceptId=` compile and return 401 unauthenticated. **UI not exercised end-to-end** (needs a logged-in session with hydrated concepts) — verify in-app: miss an MCQ → repair → self-report → panel appears below next action.

### Rules Respected
No new tables, migrations or event types. SM-2 untouched. Legacy R2 untouched. Student-reported failureReason is the only cause signal used for ordering. No technical labels shown.

### Still Open (deliberately not done)
- Repair content persistence / server-held verification answer (would need a new event type — needs a decision).
- Question-based Revision Session (Step 4). The panel is the first building block: it already serves questions from the inventory.

---

## [Entry 016] Revision Session — Question-Based Revision (Step 4)
- **Date**: 2026-11-11
- **Type**: Feature / Revision (Step 4 of the vision roadmap)

### What We Did
Built the question-based Revision Session on top of existing pieces. The Revision page now opens with a session launcher ("N concepts due, asked as questions where you have them"). Starting it walks one due concept at a time: answer an unseen MCQ from the concept's inventory → report confidence (correct) or failure reason (wrong) → see the SM-2 schedule ("Back in 3 days") → repair if wrong → reinforcement → next → completion summary. Concepts with no questions fall back to recall-then-reveal with the note, then self-assessment; if not remembered, the student picks the failure reason themselves (never inferred). The existing RevisionList remains below for browsing.

### Why
Audit Entry 014 / the vision doc: "Students must actually answer questions during Revision. It should not merely show a list of concepts." Revision was a concept list with recall-then-reveal; it did not serve questions and had no completion state.

### How It Works
1. **Engine** — [`src/lib/revision-session/revision-session.engine.ts`](../src/lib/revision-session/revision-session.engine.ts), pure:
   - `isCompletedSince(events, since)` — a concept with an `mcq_attempt` / `self_assessment` / `skip` at or after the client's local midnight is already done today → **resume after refresh or exit without repeating**. Repair events alone do not complete a concept.
   - `selectSessionQuestion(inventory, history)` — reuses the reinforcement engine's unseen-first pick.
   - `scheduleLabel(intervalDays)` — "Back tomorrow / in 3 days / about 2 weeks / about 1 month".
   - `summarizeSession(results)` — reviewed / held / repaired / skipped + retention rate.
2. **Service** — [`revision-session.service.ts`](../src/lib/revision-session/revision-session.service.ts): `revisionIntelligenceService.getRecommendations` (existing scheduler, no second one) → per concept, in parallel: question inventory, 200-event history, 20 most recent events, latest note. Read-only.
3. **API** — `GET /api/revision/session?limit=10&since=<ISO>`; validates `limit` (positive int, max 25) and `since` (ISO); default lookback 24h.
4. **Shared repair UI** — [`src/components/features/repair/repair-ui.ts`](../src/components/features/repair/repair-ui.ts) (types, labels, `repairBlocks`, `REPAIR_MODES`) and [`RepairFlow.tsx`](../src/components/features/repair/RepairFlow.tsx): the full R3 loop for one concept — `/api/repair` → render by intent → verification → `/api/repair/verify` → understanding → `/api/repair/understanding` → R3.4 next action → `ReinforcementPanel` → one re-offer. Mounting starts the repair; `onSettled` tells the parent when the loop reached a terminal state. **PracticeCard and RevisionList still carry their inline copies** (Rule 15: untouched); migrating them to `RepairFlow` is a follow-up refactor.
5. **UI** — [`RevisionSession.tsx`](../src/components/features/revision/RevisionSession.tsx): launcher → runner → summary. Per-item phases: `question → post_outcome → feedback` or `recall → reveal → (reason) → feedback`. Writes only via existing `POST /api/revision` actions (same bodies as PracticeCard / RevisionList) and RepairFlow.
6. **Page** — `src/app/dashboard/revision/page.tsx` renders `<RevisionSession />` above `<RevisionList />`.

### Edge Cases Covered
Nothing due · everything already done today · no question for a concept (recall fallback) · no note either ("No study notes generated") · API failure on load (retry) · attempt-save failure (shown, never blocks) · repair failure (retry inside RepairFlow) · duplicate taps (locked after first) · leaving midway (resume via `since`) · Next disabled until an open repair settles · narrow screens (single column, truncation).

### Files Changed
- **Created**: `src/lib/revision-session/revision-session.engine.ts`, `revision-session.service.ts`, `__tests__/revision-session-engine.test.ts`, `src/app/api/revision/session/route.ts`, `src/components/features/repair/repair-ui.ts`, `RepairFlow.tsx`, `src/components/features/revision/RevisionSession.tsx`
- **Modified**: `src/app/dashboard/revision/page.tsx`

### Validation
- `npx tsc --noEmit` clean; eslint 0 errors on all touched files.
- 18/18 suites, 2,319 assertions (new suite: 51 — resume cutoff incl. IST midnight, question selection, schedule wording, summary maths, isolation: engine's only import is the reinforcement engine; service never imports SM-2 / R2 / AI client / write methods and reuses `getRecommendations`).
- Dev server: `/api/revision/session` compiles, gates with 401, `/dashboard/revision` redirects unauthenticated. **Not yet exercised with a logged-in session** — walk through: Revision → Start session → answer → wrong → reason → repair → Next → Finish; refresh mid-session and confirm it resumes.

### Rules Respected
No new tables, migrations or event types. SM-2 untouched and reached only through existing POST actions. Student-reported failureReason authoritative (recall path asks, never maps Forgot → a reason). Legacy R2 untouched. No technical labels. Existing RevisionList preserved.

---

## [Entry 017] End-to-End Student Journey — Findings & Fixes
- **Date**: 2026-11-11
- **Type**: E2E Test Tooling / Bugfixes / Performance

### What We Did
Wrote [`scripts/e2e-student-session.ts`](../scripts/e2e-student-session.ts) (`npm run e2e:student`): plays a real student through the Step 3 + Step 4 backend against the REAL database and REAL Groq — session assembly → correct MCQ → wrong MCQ → active-recall repair → verification → understanding → next action → reinforcement → clarification → grounded concept teaching → recall self-assessment → skip → resume → summary. Snapshots the student's `concept_mastery` and `revision_events` first and restores both in a `finally` (verified `restored=true` on every run). Uses the same library functions the API routes call; routes themselves need a Supabase session cookie.

### Findings (in severity order)
1. **🔴 Repair evidence has NEVER persisted.** `revision_events.event_type` has a CHECK constraint from migration 00015 allowing only `review | mcq_attempt | skip | self_assessment`. Every `repair_verification` / `repair_understanding` insert since R3.3 was rejected; the UI degraded to "Couldn't save this result" and `/api/repair/understanding` 404'd. The live DB holds zero repair events. **Fix**: [`supabase/migrations/00017_repair_event_types.sql`](../supabase/migrations/00017_repair_event_types.sql) widens the constraint. **Not yet applied** — must be run in the Supabase SQL editor (DDL on the live project was intentionally not executed by the agent).
2. **🔴 Session assembly took 58 s.** `getRecommendations` ran 4 sequential queries per due concept (×50 due rows) and `conceptContextRepository.findByConceptIds` was itself a loop; the session service added 3 more per item. **Fix**: batch methods `pyqMatchRepository.findByConcepts`, `relationshipRepository.findByConcepts`, `conceptQuestionsRepository.findByConcepts`, `revisionRepository.getEventsForConcepts`; `findByConceptIds` is now one `inArray` query; `getRecommendations` enriches with 4 batch queries total (output unchanged); session service uses 3 batch queries. **58 s → 3.2 s.** RevisionList benefits too (same service).
3. **🟡 Reinforcement panel 3.4 s** → dominoes batched (4 queries for all dominoes) → **1.6 s**.
4. **🟡 "Already done today" never showed.** Answered concepts are rescheduled by SM-2 and leave the due set, so `completedToday` on due items was almost always false. **Fix**: `revisionRepository.countConceptsHandledSince(userId, since, types)` (distinct concepts across ALL events) → `doneToday` in the session payload; launcher copy now uses it. Resume-by-omission was already correct.
5. 🟢 Verified working: SM-2 schedule feedback, evidence fields (confidence / questionId / failureReason), note grounding reaches executors, verification question differs from the missed one, clarification has no verification and the server refuses to verify it, transfer MCQ never equals the missed question, every ordered reinforcement section has content, dominoes are distinct concepts, skip increments only skipCount, summary maths.

### Files Changed
- **Created**: `scripts/e2e-student-session.ts`, `supabase/migrations/00017_repair_event_types.sql`
- **Modified**: `src/lib/repositories/{pyq-match,relationship,concept-questions,concept-context,revision}.repository.ts`, `src/lib/ai/services/revision-intelligence.service.ts` (batch enrichment only; priority maths untouched), `src/lib/reinforcement/reinforcement.service.ts`, `src/lib/revision-session/revision-session.service.ts`, `src/components/features/revision/RevisionSession.tsx`, `package.json` (`e2e:student`)

### Validation
- E2E: 37/38 — the single failure is finding #1 until migration 00017 is applied; rerun `npm run e2e:student` afterwards and expect 38/38 (it then also proves the reinforcement engine reads repair events).
- tsc clean; 18/18 unit suites; eslint 0 errors on touched files.
- Not done: browser click-through (needs a signed-in session).

> **Update 2026-11-11 (later):** Migration 00017 applied to the live project at the user's request. `npm run e2e:student` → **41/41 PASSED** (restored=true): repair_verification and repair_understanding persist, duplicate guard works, understanding derives context from the stored verification, reinforcement reads the repair events. Session assembly ~2.7 s, reinforcement ~1.5 s.

---

## [Entry 018] Browser Click-Through (as a student) — Findings & Fixes
- **Date**: 2026-11-11
- **Type**: UI E2E / Bugfixes

### What We Did
Drove the real UI signed in as the demo student: Practice → wrong MCQ → "couldn't recall" → active-recall repair → verification → understanding → Lock-it-in panel; Practice → "not sure" → clarification → panel. Revision → launcher → session → wrong MCQ + "careless mistake" → in-session repair → panel → Next; correct MCQ + confidence; reload mid-session (resume); recall-only item → Reveal → Forgot → reason → repair offer; skip; completion summary. Every API call in every chain returned 200, including `repair/verify` and `repair/understanding` (first time ever after migration 00017).

### Findings → Fixes
| # | Finding | Fix |
|---|---|---|
| 1 | Practice panel's "Try a different question" was the concept's Q2, already visible on the same card (and answerable twice) | `/api/reinforce` accepts `excludeQuestionIds` / `excludeQuestionIndexes` (CSV); engine `pickTransferMcq` takes list exclusions; PracticeCard passes its whole on-screen inventory → section drops out, dominoes still serve questions |
| 2 | Session saves (5–7 s over the pooler) greyed the buttons with no feedback → felt frozen | "Saving…" line with spinner while `saving` in `RevisionSession` |
| 3 | `/api/repair` and `/api/reinforce` fired twice per use in dev (React Strict Mode double mount) → two LLM calls per repair in development | `useRef` request guard keyed by attempt / request key in `RepairFlow` and `ReinforcementPanel` |
| 3b | My first guard + `cancelled` flag stranded the one real request → panel stuck on "Pulling this from your notes…" (caught in the same session) | Staleness decided by key comparison at resolve time; no cleanup flag |
| 4 | Recall-only items offered "misunderstood the question" / "careless mistake" — no question existed | `RECALL_FAILURE_REASONS` subset (concept_not_understood, could_not_recall, overconfident, not_sure); still the student's choice |
| 5 | Summary said "You held 0% of what was due" after 9 skips + 1 forgot | Copy now: "held X% of the N you answered. K skipped — they come back tomorrow." |

### Verified in-browser after fixes
Single `/api/repair` + single `/api/reinforce` per use; panel resolves; Practice request carries `excludeQuestionIndexes=0,1` and shows no transfer question; "Saving…" visible; launcher counted 14 handled today across Practice + Revision.

### Noted, not changed
- The `RevisionList` below the session does not refresh after the session ends (stale due list until navigation).
- Summary is per session instance; items answered before a mid-session reload are not in the final summary (they are counted in `doneToday`).
- Domino concepts can coincide with other cards in today's Practice set.

### Validation
tsc clean; eslint 0 new errors; 18/18 suites (2,319 assertions); `npm run e2e:student` 41/41.

---

## [Entry 019] Cloze Recall — Retire "Remembered / Partially / Forgot"
- **Date**: 2026-11-11
- **Type**: Feature / Evidence quality (user decision)

### What We Did
Replaced the recall-then-reveal self-assessment with produce-before-reveal evidence. For a due concept with no question, the session now asks for a one-line typed recall, then up to three fill-in-the-blank checks built deterministically from the concept's own exam triggers and memory hooks. Grading is local and deterministic; the score maps onto SM-2 quality on the same scale the old buttons used (all → 4, ≥half → 3, some → 2, none → 1) and is recorded through the EXISTING `review` event with `clozeCorrect`, `clozeTotal`, `typedRecall` in metadata. The three buttons survive only as a labelled last resort when a note has nothing blankable. The old `RevisionList` is no longer rendered; a read-only `DueConceptsList` sits under the session and refreshes when a session ends.

### Why
User: "how does a student know if he now remembers the concept right away?" — correct. Post-reveal self-assessment measures recognition, inflates "Remembered", and fed SM-2 directly. This is the fill-in-the-blank drill from the vision document, with zero LLM cost.

### How It Works
- [`src/lib/revision-session/cloze.engine.ts`](../src/lib/revision-session/cloze.engine.ts) (pure, no imports): `pickKeyTerm` (article/year/number → longest capitalised run → longest non-stopword), `buildClozeItems` (≤3, distinct answers, hint = first letter + length), `normalize`, `isClozeCorrect` (exact / contained / one typo on 6+ chars; numbers exact), `clozeQuality`, `gradeCloze`.
- `revision-session.service.ts`: items carry `cloze: ClozeItem[]` (only when `mcq` is null).
- `revision-intelligence.service.ts` + `/api/revision`: optional `clozeCorrect`, `clozeTotal`, `typedRecall` (≤300 chars) → eventMetadata only. SM-2 untouched.
- `RevisionSession.tsx`: recall phase = textarea + blanks + hint toggles + Check (enabled once anything is typed; empty blanks are allowed and count as evidence); after Check: per-blank ✓/✗ with "you wrote …", the note's core idea, schedule; quality < 3 → student picks the reason (recall subset) → repair offer. `onSessionEnd` prop.
- `DueConceptsList.tsx` (read-only) + `RevisionWorkspace.tsx` (refresh key) replace `RevisionList` on the page; `RevisionList.tsx` kept with a SUPERSEDED header.

### Validation
- `cloze-engine.test.ts`: 45 assertions. 19/19 suites, 2,364 assertions. tsc clean; eslint 0 new errors.
- `npm run e2e:student`: 45/45 incl. step 6b (cloze built from a real note, graded, recorded, metadata verified, SM-2 quality equals cloze quality). Fixtures now also flagged weak so they rank into the session regardless of backlog.
- Browser: International Law recall item → typed recall + 3 blanks ("___: Promoting international peace" → Article 51, "Vienna Convention on ___" → Diplomatic Relations, "ICJ: Dispute ___ mechanism" → settlement) → 2 of 3 → quality 3 → "Back tomorrow"; "Saving…" shown; no Remembered/Partially/Forgot anywhere on the page.

### Files
- **Created**: `cloze.engine.ts`, `__tests__/cloze-engine.test.ts`, `DueConceptsList.tsx`, `RevisionWorkspace.tsx`
- **Modified**: `revision-session.service.ts`, `RevisionSession.tsx`, `revision-intelligence.service.ts`, `app/api/revision/route.ts`, `app/dashboard/revision/page.tsx`, `RevisionList.tsx` (header only), `scripts/e2e-student-session.ts`

---

## [Entry 020] Serious Prep Pass — Written Answers, UPSC-Standard Questions, Answer-Key Audit, No Emojis
- **Date**: 2026-11-11
- **Type**: Feature / Quality (user feedback on four screenshots)

### User Feedback
1. Cloze hints ("A… (10 characters)") make no sense; 2. remove emojis — not a kids' app; 3. repair shows the answer then asks the same thing (Chhattisgarh) — want brain-exercising work plus an answer box with photo upload of paper answers; 4. cloze items like "80°N Latitude = ___" are kid-level — want Prelims/Mains intermediate–advanced questions.

### What We Did
- **Written answers** (`src/lib/answer/`, `POST /api/answer/evaluate`, `WrittenAnswer.tsx`): type and/or attach up to 3 photos of a paper answer. Browser downscales to ≤1600 px JPEG. Server: photos → transcription by `qwen/qwen3.8-27b` on Groq (only vision model on the key; `GROQ_VISION_MODEL` overrides), then marking by the main text model with a strict UPSC-examiner prompt (score /10, verdict, covered, missed, inaccuracies, structure for Mains, one improvement). Mark → SM-2 quality (7+→4, 5+→3, 3+→2, else 1; never 5). Read-only; callers record via the existing `review` event (`writtenScore`, `writtenMaxScore`, `answerSource`, `answerMode`, `mainsQuestionIndex`, `answerExcerpt`). Word target: stated "(N words)" in the question wins, else marks.
- **Recall drill** (RepairFlow, active_recall): student writes/photographs the answer BEFORE the model answer appears; pre-written "How did you do?" removed (it was generated before the student answered).
- **Verification standard** (`note-grounding.ts` → `formatRepairGuidance`): every executor except clarification gets a UPSC Prelims standard for the check question (how-many-correct / Statement-I-II / pairs; not answerable from the repair text; no one-word recall). **Leak guard** (`verification-leak.ts`): if the correct option appears in the shown text and no distractor does, `/api/repair` regenerates once with that answer banned. Format options ("Only two", "1 and 3 only") never count as leaks. `/api/repair` rewritten as a single dispatcher.
- **Question generation 3b.2** (`prompts.ts`): UPSC 2023+ formats, intermediate–advanced, explanations cover every statement; Mains with word limits and concrete marking points. Grounded on the student's note for SCOPE only — "factual accuracy overrides the notes" (see finding below).
- **Answer-key audit** (`src/lib/ai/services/mcq-audit.ts`): independent solve without the stated key; disagreement / flawed / unanswerable → dropped before persistence. Fail-open if the audit call fails. ~2 s per concept, once.
- **Revision session**: cloze engine deleted. Concepts with no questions → questions generated on the spot (POST /api/ai/questions, persisted to inventory) → MCQ. No MCQ even then → Mains question from inventory or a subject-aware 100-word prompt, answered in writing and marked. Weak answer (<5) → student picks the reason → repair.
- **Practice**: PracticeCard rewritten on the shared `RepairFlow` (~500 duplicated lines gone); Mains questions get "Write answer" (marking points hidden until written, or revealed on request).
- **Tone**: all emojis removed (repair-ui, PracticeCard, RevisionSession, DiagnosticView), hints removed, plain labels ("Correct." / "Incorrect. Answer: (b)."), panel renamed "Consolidate", decorative icons and colour removed.

### Findings during verification
- **Note error propagated into a wrong key**: the student's note says "80°N Latitude = Arctic Circle" (actually ≈66.5°N). A first version of 3b.2 told the generator to stay consistent with the note → it produced a question keyed on 80°N "as per the core idea". Fixed (accuracy overrides notes) and the audit now catches it (auditor answered "only two" vs stated "all three"). The faulty set (created by this test, no attempts against it) was regenerated; all four new keys checked by hand.
- **Evaluator calibration**: a correct geography answer scored 5.5 because the fallback prompt demanded a "legal basis" and the examiner treated note items as mandatory → subject-aware prompts + "note is context only" → 7.5; a confidently wrong answer → 1/10 with 4 inaccuracies.

### Validation
21/21 suites, 2,391 assertions (new: answer-evaluation 41, verification-standard 27, mcq-audit 6). tsc clean; 0 new lint errors. `npm run e2e:student` 47/47 (restored=true). Browser: recall drill with a photographed page (transcribed verbatim, 7/10), statement-based check question, Consolidate panel; revision generated + audited questions for "Latitude and Longitude"; Mains typed answer 6.5/10 with structure + marking points, review event 200.

### Still open
- 20 concepts still hold questions from the old prompt (3b.1), unaudited — regenerate with `force` when the user agrees (replaces question IDs; mastery unaffected).
- AI notes can contain factual errors (the 80°N case) — a note audit pass would mirror the MCQ audit.
