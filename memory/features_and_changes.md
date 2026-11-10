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

