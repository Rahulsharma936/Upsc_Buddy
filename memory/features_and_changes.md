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

### Next Concrete Steps (recorded for handoff)
The next task for any agent picking up this conversation is to implement **R3.10 — Clarification Repair Executor** (`failureReason = "not_sure"` → `repairIntent = "clarification"`).
1. Create `src/lib/repair/clarification.executor.ts` following the R3.9 gold-standard template.
2. Create deterministic test suite `src/lib/repair/__tests__/clarification.test.ts`.
3. Wire into `src/app/api/repair/route.ts` and add `"clarification"` to `VERIFIABLE_REPAIR_INTENTS` in `src/lib/repair/repair-verification.ts`.
4. Run all test suites to confirm full 7/7 executor completion.
