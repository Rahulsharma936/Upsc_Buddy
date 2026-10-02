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

## [Entry 004] R3.9 Rewrite & R3 Roadmap Alignment
- **Date**: 2026-10-02
- **Type**: Refactor / Architecture

### What We Did
1. Completely rewrote the `error-awareness.executor.ts` (R3.9) to ensure high-quality, production-ready AI prompt engineering.
2. Formally updated our working roadmap to pause frontend UI development and focus strictly on finishing the backend R3.x executors first (specifically R3.6 and R3.7 next).

### Why
- The initial R3.9 was written by a lower-end model and its system prompts and interfaces were not up to par. A stronger model rewrote it to enforce strict boundaries (no reteaching, no diagnosis) with better few-shot style instructions ("Bad: Read carefully. Good: Underline negations").
- We paused building the standalone `/repair` page because jumping straight to UI without finishing the core repair backend would lead to fragmented architecture. The Repair UI should emerge naturally from the Practice and Revision flows.

### How It Works (R3.9 improvements)
- **Structured Prompts**: AI system prompts are now sectioned (`RESPONSE FORMAT`, `CONTENT RULES`, `BOUNDARIES`) for better alignment.
- **Pedagogical JSDoc**: Interface fields document *why* they exist and what student question they answer, not just their data type.
- **Preserved Contract**: Validation, execution flow, and testing APIs were preserved exactly so it continues to pass the 147 test assertions flawlessly.

### Next Concrete Steps (recorded for handoff)
The next task for any agent picking up this conversation is to run a quality-assurance rewrite on **R3.6 (Question Interpretation)** and **R3.7 (Uncertainty Resolution)** just like we did for R3.9, ensuring they meet the high bar set for the backend repair engine.
