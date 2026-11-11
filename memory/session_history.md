# Session History

## Session 1: Documentation Audit & Memory System Setup
- **Date**: 2026-10-02
- **Objective**: Check existing documentation & establish memory tracking system.

### Key Discussions & Findings
1. **Existing Documentation Audit**:
   - Analyzed the codebase for documentation.
   - Identified the active technical knowledge base in [`docs/`](../docs/README.md), including:
     - [`docs/README.md`](../docs/README.md): Architecture documentation index and development workflow.
     - [`docs/architecture/repair-system.md`](../docs/architecture/repair-system.md): Remediation history (Repairs 1–4) and remaining issues.
     - Architecture Decision Records (ADRs 001–004) under [`docs/architecture/decisions/`](../docs/architecture/decisions/).
     - Noted that root [`README.md`](../README.md) is currently default Next.js boilerplate.
2. **Memory System Initiative**:
   - Established the [`memory/`](./README.md) directory to track ongoing conversations, features, architectural decisions, and step-by-step implementations in simple, efficient language.

3. **Bird's Eye View Summary**:
   - Created a comprehensive overview of the 3 core systems:
     - **Learning Engine** (fully built): SM-2 spaced repetition, MCQ practice, revision, insights.
     - **Diagnostic Engine** (fully built): 4 gap types (Concept, Memory, Calibration, Revision) with feature extraction, scoring, and human-friendly explanations.
     - **Repair Engine** (backend built, frontend pending): 4 executors (Concept Teaching, Active Recall, Uncertainty Resolution, Question Interpretation) with verification and next-action routing.
   - **Next milestone**: Build the Repair UI page.

---

## Session 2: R3.9 Rewrite & R3 Roadmap Alignment
- **Date**: 2026-10-02
- **Objective**: Quality assurance for R3 executors and roadmap alignment.

### Key Discussions & Findings
1. **R3.9 Error Awareness Rewrite**:
   - The initial draft of `error-awareness.executor.ts` (R3.9) was rewritten to ensure high-quality prompt engineering, strict separation from concept reteaching, and robust error handling.
   - Validated against the test suite: 147/147 assertions passing.

2. **Roadmap Correction - UI vs Backend**:
   - Decided **NOT** to build the standalone `/repair` UI page yet.
   - The priority is to finish all the R3.x backend executors first. Once R3.6 through R3.10 are complete, we will look at the complete system to determine where Repair should naturally appear in the Practice and Revision flows (rather than defaulting to a standalone page).

3. **Current State & Next Steps**:
   - The current track completion looks like this:
     - R3.1 RepairRequest ✅
     - R3.2a Concept Teaching ✅
     - R3.3 Verification ✅
     - Post-repair Understanding ✅
     - R3.4 Next Action ✅
     - R3.5 Active Recall ✅
     - R3.8 Calibration (Exists, needs quality check)
     - R3.9 Error Awareness ✅ (Rewritten today)
## Session 3: Massive Commit & QA Rewrite of R3.6, R3.7, and R3.8
- **Date**: 2026-10-02
- **Objective**: Commit entire pending system state, execute gold-standard QA rewrite for R3.6, R3.7, and R3.8 executors, and harmonize repair test suites.

### Key Discussions & Findings
1. **Committed Entire System Base**:
   - Committed 67 files (19,469 insertions) covering Diagnostic Engine, Evidence Layer, Repair Engine (R3.1 - R3.9), UI overhauls (PracticeCard, RevisionList), and architectural docs.
2. **QA Rewrite to Gold Standard (R3.9 parity)**:
   - **R3.6 Question Interpretation** (`question-interpretation.executor.ts`): Re-engineered system prompt into `RESPONSE FORMAT`, `CONTENT RULES` (with concrete good/bad reading-cue examples), and `BOUNDARIES`. Added pedagogical JSDoc mapping fields to student questions.
   - **R3.7 Uncertainty Resolution** (`uncertainty-resolution.executor.ts`): Re-engineered system prompt with strict no-diagnosis enforcement and actionable discrimination rules. Added student-inquiry JSDoc.
   - **R3.8 Calibration** (`calibration.executor.ts`): Re-engineered system prompt with mismatch-focused framing, self-check examples, and graceful `.catch(null)` schema degradation.
3. **Test Suite Harmonization**:
   - Updated `question-interpretation.test.ts` and `repair-verification.test.ts` to recognize all 6 active verifiable executors (`concept_teaching`, `active_recall`, `question_interpretation`, `uncertainty_resolution`, `calibration`, `error_awareness`).
   - Ran all 10 deterministic test suites: **100% passing across all 10 suites**.
   - Cleanly committed to Git.

## Session 4: R3.10 Completion & R3 Backend Finalization
- **Date**: 2026-10-07
- **Objective**: Implement R3.10 Clarification Executor and finalize the Repair Engine backend.

### Key Discussions & Findings
1. **R3.10 Clarification Executor**:
   - Implemented `clarification.executor.ts` for `failureReason = "not_sure"`.
   - Distinct from other executors: It doesn't assume a gap and **does not require verification** (since the student hasn't identified their failure mode yet).
   - Structured the AI response to output: `whatTheQuestionNeeded`, `possibleStumblingPoints` (2-3 options), `howToNarrowItDown`, and `nextTimeStrategy`.
2. **Test Suite Harmonization**:
   - Wrote deterministic test suite `clarification.test.ts` ensuring no verification MCQ is generated.
   - Fixed outdated `question-interpretation.test.ts` that assumed `not_sure` would return a null repair.
3. **Backend Complete**:
   - The backend repair engine is now 100% complete across all 7 failure reasons.
   - All 11 test suites passing perfectly.

## Session 5: Repair UI Integration Planning & Architecture
- **Date**: 2026-10-07
- **Objective**: Design the implementation plan for integrating the completed R3 backend into the frontend Practice & Revision flows.

### Key Discussions & Findings
1. **Frontend Architecture Research**:
   - Analyzed `PracticeCard.tsx` and `RevisionList.tsx`.
   - Practice flow currently has UI implementations for only 4 out of the 7 failure reasons.
   - Revision flow currently has **no repair integration**; when a student marks "Forgot", the item is just silently rescheduled by SM-2.
   
2. **Implementation Plan Finalized**:
   - **Phase 1 (Practice Flow)**: Update `PracticeCard.tsx` to handle the 3 missing failure reasons (`overconfident`, `careless_mistake`, `not_sure`). This requires mapping the new type interfaces (`CalibrationRepairData`, `ErrorAwarenessRepairData`, `ClarificationRepairData`) and specially handling `not_sure` (which returns `verification: null`).
   - **Phase 2 (Revision Flow)**: Add the repair lifecycle (button CTA, fetching repair, verification MCQ, self-report) to `RevisionList.tsx`. When a user clicks "Forgot" or "Partially", offer an optional repair CTA alongside the standard skip behavior.

### Current State & Next Steps (Ready for "continue")
- All 7 backend executors are complete and passing tests.
- We have a fully mapped implementation plan for the frontend UI.
- **IMMEDIATE NEXT TASK**: Execute the Phase 1 and Phase 2 frontend integration plan. The next agent should read the plan above and start modifying `PracticeCard.tsx` and `RevisionList.tsx`.

---

## Session 6: Recap & Orientation After 6-Day Gap
- **Date**: 2026-10-15
- **Objective**: Resume work after a break. Establish where we left off and what's next.

### Where We Left Off (Summary of Sessions 1–5)

**Project**: UPSC Buddy — an AI-powered UPSC exam preparation app built with **Next.js**, **Supabase**, **Drizzle ORM**, and **Groq API**.

**Three Core Systems**:
1. **Learning Engine** ✅ (SM-2 spaced repetition, MCQ practice, revision, insights) — fully built.
2. **Diagnostic Engine** ✅ (4 gap types: Concept, Memory, Calibration, Revision) — fully built.
3. **Repair Engine** ✅ backend, 🔧 frontend partially done.

**Repair Engine Backend (100% Complete)**:
All 7 failure reasons → 7 executors, all tested and passing (11 test suites):
| Executor | Failure Reason | Status |
|---|---|---|
| R3.2a Concept Teaching | `concept_not_understood` | ✅ |
| R3.5 Active Recall | `could_not_recall` | ✅ |
| R3.6 Question Interpretation | `misread_question` | ✅ |
| R3.7 Uncertainty Resolution | `eliminated_but_guessed` | ✅ |
| R3.8 Calibration | `overconfident` | ✅ |
| R3.9 Error Awareness | `careless_mistake` | ✅ |
| R3.10 Clarification | `not_sure` | ✅ |

**Frontend Integration (Complete ✅)**:
- **Phase 1 — PracticeCard.tsx** ✅ DONE (Session 5/Entry 008): All 7 failure reasons now handled in the practice flow UI. Clarification's `verification: null` special case is handled.
- **Phase 2 — RevisionList.tsx** ✅ DONE (Session 6/Entry 010): Full repair lifecycle wired into revision flow — CTA after "Forgot"/"Partially", repair fetch, verification MCQ, understanding self-report, and next-action routing.
- **TS Cleanup** ✅ DONE (Session 7): Fixed 3 pre-existing null-check errors on `repair.verification` in PracticeCard.tsx. Project compiles with 0 TS errors.

### Immediate Next Task
**All repair UI integration is complete.** Both Practice and Revision flows have the full repair lifecycle. The entire project compiles clean (0 TS errors).

---

## Session 7: Diagnostic & Post-Practice Intelligence Loop Audit
- **Date**: 2026-10-28
- **Objective**: Conduct comprehensive audit of `/dashboard/diagnostic` (why it's "all red" with UUIDs) and map the student learning loop: `Practice → Evidence → Repair → Reinforcement (Notes, MCQs, Dominoes, PYQs, Fillups, Mains) → Revision`.

### Key Discussions & Findings

1. **User Request & The Core Product Vision**:
   - User noted the diagnostic page (`/dashboard/diagnostic`) shows 4 concepts tracked, 0 healthy, 4 "Need Attention" ("all red"), with concepts displaying as cryptic UUIDs (`75d55a3b...`).
   - The user defined the intended cognitive loop:
     > *"Practice tells the app what happened → Repair fixes the immediate problem → related learning reinforces it → Revision remembers it over time. Practice → Evidence → Repair / Reinforcement → More learning material → Revision"*
   - Post-practice should dynamically serve:
     - **Notes**: Targeted micro-notes for the specific misconception/struggle (NOT generic chapter dumps).
     - **More MCQs**: Follow-up questions on the same/related concept to test whether improvement transfers.
     - **Dominoes**: Concept relationships where learning one unlocks/links the next relevant concept.
     - **PYQs**: UPSC Past Year Questions with relevance analysis.
     - **Active Recall / Fill-in-the-blank drills**: When retrieval is the root issue.
     - **Mains-oriented drills / analytical prompts**: When deeper conceptual reasoning is needed.
     - **Revision scheduling**: Explicitly feeding into the future revision queue.

2. **Audit Findings: Diagnostic Page (`/dashboard/diagnostic`)**:
   - **Bug 1: UUID Display**: `diagnostic.service.ts` only reads `revision_events` and groups by `conceptId` (UUID). It never queries the `concepts` table (`displayName`, `subject`). `DiagnosticView.tsx` uses `shortenId()` which truncates the UUID to 8 characters (`75d55a3b…`). The "Top Priority" card also shows UUIDs.
   - **Bug 2: "All Red" / Read-Only Dead End**: The scoring engine detects gaps accurately, but the page offers **zero action buttons** (no "Practice", "Repair", "Study Notes"). It is an analytics dead end.
   - **Bug 3: Disconnect between Diagnostic (R2) and Repair (R3)**:
     - Diagnostic classifies 4 gaps: `concept_gap`, `memory_gap`, `calibration_gap`, `revision_gap`.
     - Repair engine uses 7 failure reasons: `concept_not_understood`, `could_not_recall`, `misunderstood_question`, `guessed`, `overconfident`, `careless_mistake`, `not_sure`.
     - There is no bridge allowing a student to trigger a repair from the Diagnostic page.
   - **Bug 4: 500-Event Cap**: `getEventsByUser(userId, 500)` causes older concepts to drop off for active users.
   - **Bug 5: `learner_adaptive_profile` Untouched**: The profile table has `conceptGaps` and `recommendations` JSONB columns, but the diagnostic engine never syncs with it.

3. **Audit Findings: Post-Practice & Content Reality**:
   - **Crucial Clarification**: The existing `NoteCard` on the Knowledge page and the `Mains questions` in `PracticeCard` are **static, pre-generated batch content** from concept hydration. They are NOT the dynamic post-practice reinforcement the app is intended to provide.
   - **Post-Practice Dead Stop**: In `PracticeCard.tsx`, once an MCQ failure is diagnosed and repaired, the flow concludes with static text:
     - *"Repair complete — nothing more to do here for now."*
     - *"Noted. This concept will come back in your normal revision."*
   - There is no dynamic post-practice generation of targeted micro-notes, transfer MCQs, domino links, PYQs, fill-in-the-blank drills, or mains reasoning questions based on student feedback.
   - Fill-in-the-blank drills do not exist anywhere in the app yet.

### Current State & Next Steps (Ready for Next Session Catchup)

**Top Priorities for Next Session**:
1. **Fix Diagnostic Display & Usability (Phase 1)**:
   - In `diagnostic.service.ts`, batch-fetch `displayName` and `subject` from `concepts` table for all concept IDs in overview & concept reports.
   - Update `DiagnosticView.tsx` to display real names and add direct action buttons per gap type (e.g., "Practice Concept", "Start Repair", "Review in Revision").
2. **Build Post-Practice Orchestrator (Phase 2)**:
   - Create post-practice session summary & reinforcement flow.
   - Wire student failure mode + post-repair understanding to dynamic generation:
     - Dynamic targeted note for the misconception.
     - Transfer MCQ.
     - Concept dominoes / Related concepts drawer.
     - PYQ matching.
     - Fill-in-the-blank / active recall interactive drill.
     - Mains analytical reasoning drill.
     - Spaced repetition confirmation banner.


---

## Session 8: Vision Alignment & Steps 2–3 Audit (Practice → Repair, Post-Practice Reinforcement)
- **Date**: 2026-11-10
- **Objective**: Adopt the Product Vision document as standing context, verify implementation status against the real repository, then audit Step 2 (Practice → Repair integration) and Step 3 (post-practice reinforcement) read-only. No code changes.

### Verified Status (from the repo, not the docs)
- R3.6–R3.10 executors all exist in `src/lib/repair/` and are dispatched from `/api/repair`. All 7 failure reasons appear in `PracticeCard.tsx`.
- Fresh run: 16/16 test suites pass (1,835 assertions). `npx tsc --noEmit` clean.
- Architecture rules hold: `src/lib/repair/` imports nothing from `src/lib/diagnostic/`, SM-2, or the revision service. Verify/understanding routes write plain `revision_events` rows and never touch mastery. No technical gap labels rendered in Practice or Revision.
- Correction: the canonical failure-reason values are `misunderstood_question` and `guessed`. Earlier memory notes mentioning `misread_question` / `eliminated_but_guessed` are wrong.

### Step 2 Findings — Practice → Repair Integration
Works end to end for all 7 reasons. Gaps, in priority order:
1. **Verification result is client-trusted**: repair content is never stored server-side, so `/api/repair/verify` must accept `verificationCorrectAnswer` from the browser. Intent is server-derived; the result is not.
2. **`not_sure` (clarification) leaves no repair evidence**: no verification → no understanding → no next action. Only the original `mcq_attempt` event records it.
3. **Repair content is never persisted** for any intent — only the verification question text. Outcome is measurable; what was shown is not.
4. **"Try a different way" re-runs the same executor with identical input**; variation is LLM randomness only.
5. **Failed verification save silently loses the understanding too** (its POST 404s without the verification row).
6. **Page refresh erases all repair state** (session-local by design).
7. **Revision infers the failure reason** (Forgot → `concept_not_understood`) rather than the student choosing it — mild tension with Rule 2.
8. **Mains / Interview have no path to repair** (display-only).

### Step 3 Findings — Post-Practice Reinforcement
- **Real code**: Knowledge is a genuine repository (`/api/notes` + per-concept RelatedConcepts / PYQSection on the Knowledge page). Revision is the only place that resurfaces existing Knowledge (reads note coreIdea / examTriggers / memoryHooks for the recall step).
- **Still only an idea**: targeted micro-notes, transfer MCQs, dominoes, PYQ resurfacing after a miss, fill-in-the-blank drills, Mains drills. After next-action, Practice ends with a sentence of text and no link to anything.
- **Repair generates instead of retrieves**: executors receive only concept name / subject / keywords and never read the existing `ai_notes` row. A repair's "Core Idea" can contradict the Knowledge note's. Clearest Rule 13 violation today.
- **Nobody consumes repair events**: normalized by the evidence layer, but ignored by the diagnostic feature extractor, the surfacing engine (mastery only), and the adaptive engine (concepts + mastery only).
- **Bug**: `/api/notes` defaults to the 50 newest concepts (max 100). Knowledge hides older concepts, and `RevisionList.tsx` calls the same endpoint with no params, so due concepts outside the newest 50 show "No study notes generated" even when a note exists. Same class of defect as Repair 2.

### Current State & Next Steps
- Nothing implemented this session (user chose "Not yet" on Phase 1 diagnostic fixes).
- Smallest high-leverage Step 3 piece: a retrieval-only reinforcement query (concept + failureReason + verification outcome → existing note, related concepts, matched PYQs, one unseen MCQ; zero generation). Would also ground the repair executors.
- Step 4 (question-based Revision Session) remains unbuilt; Revision is still a concept list with recall-then-reveal.

---

## Session 9: Build Post-Practice Reinforcement (Step 3) + Executor Grounding + Notes Cap Fix
- **Date**: 2026-11-11
- **Objective**: Act on the Entry 014 audit. User brief: after a wrong answer, "throw them short notes, hooks, static↔current linkage, PYQs and domino questions then and there" — retrieval, not big regenerated notes.

### Key Discussions & Findings
1. Built the retrieval-only reinforcement layer (engine + service + API + panel), grounded all 7 repair executors in the existing Knowledge note, fixed the `/api/notes` 50-cap that starved Revision. Details in [Entry 015](./features_and_changes.md#entry-015-post-practice-reinforcement--retrieval-only-lock-it-in-layer).
2. Working tree is CRLF (`core.autocrlf=true`); scripted patches must normalize line endings.
3. The active-recall isolation test pins the executor's runtime import count; raised 3→4 for the pure `note-grounding` helper and added an assertion that the helper itself has no imports.

### Current State & Next Steps
- tsc clean, 17/17 suites (2,268 assertions). Nothing committed. UI panel not yet exercised with a logged-in session.
- Next: in-app walkthrough (miss → repair → panel), then Step 4 — a question-based Revision Session built on the same `/api/reinforce` + `MiniMcq` pieces.

---

## Session 10: Build the Revision Session (Step 4)
- **Date**: 2026-11-11
- **Objective**: Make Revision a question-based experience with a proper completion state, reusing the revision engine, question inventory, repair APIs and the new reinforcement layer.

### Key Discussions & Findings
1. Built engine + service + API + `RevisionSession` UI; extracted a shared `RepairFlow` so the session does not become a third inline copy of the repair loop. Details in [Entry 016](./features_and_changes.md#entry-016-revision-session--question-based-revision-step-4).
2. Resume-after-exit is done without any new storage: the client sends its local midnight as `since`, and any completing event at or after it marks the concept done today.
3. The recall fallback asks the student "What got in the way?" rather than mapping Forgot → `concept_not_understood` as RevisionList does — closes the Rule 2 tension flagged in Entry 014 for the new path.

### Current State & Next Steps
- tsc clean, 18/18 suites (2,319 assertions). Nothing committed. Steps 3 and 4 both unverified in-app (need a logged-in session with hydrated concepts).
- Next: in-app walkthrough of both; then Step 5 end-to-end validation; follow-up refactor to move PracticeCard / RevisionList onto `RepairFlow`.

---

## Session 11: End-to-End Student Journey (server side)
- **Date**: 2026-11-11
- **Objective**: Act as a student through Steps 3–4 and find issues.

### Key Discussions & Findings
See [Entry 017](./features_and_changes.md#entry-017-end-to-end-student-journey--findings--fixes). Headline: repair evidence (`repair_verification` / `repair_understanding`) has been rejected by a DB CHECK constraint since R3.3 — migration 00017 written, **awaiting manual apply**. Session assembly 58 s → 3.2 s by batching the recommendations enrichment.

### Current State & Next Steps
1. Apply `supabase/migrations/00017_repair_event_types.sql` in the Supabase SQL editor, then `npm run e2e:student` → expect 38/38.
2. Browser click-through of Practice → repair → panel and Revision → session (sign in first).
3. Nothing committed yet (23+ changed files across Sessions 9–11).

---

## Session 12: Browser Click-Through as a Student
- **Date**: 2026-11-11
- **Objective**: Finish E2E by driving the real UI (user signed in as the demo student in the browser pane).

### Key Discussions & Findings
See [Entry 018](./features_and_changes.md#entry-018-browser-click-through-as-a-student--findings--fixes). Practice and Revision both work end to end in the browser; five UX/dev issues found and fixed, one of them introduced and caught within the session. Migration 00017 was applied to the user's personal project (DATABASE_URL in .env.local), never via the teamargmac connector.

### Current State & Next Steps
- Nothing committed. ~30 changed files across Sessions 9–12.
- Suggested commits: (1) reinforcement layer + executor grounding + notes cap; (2) revision session + RepairFlow; (3) E2E script + batching + migration 00017 + click-through fixes.
- Follow-ups: migrate PracticeCard / RevisionList onto `RepairFlow`; refresh RevisionList after a session; migration guard script that asserts the target project ref.

---

## Session 13: Retire Post-Reveal Self-Assessment → Cloze Recall
- **Date**: 2026-11-11
- **Objective**: User judged "Remembered / Partially / Forgot" after the reveal to be weak evidence. Build produce-before-reveal recall checks from existing notes.

### Key Discussions & Findings
See [Entry 019](./features_and_changes.md#entry-019-cloze-recall--retire-remembered--partially--forgot). Deterministic cloze from exam triggers/hooks, graded locally, recorded via the existing `review` event; buttons only as a labelled last resort; old list retired from the page in favour of a read-only due list that refreshes after a session.

### Current State & Next Steps
- 19/19 suites, e2e 45/45, browser-verified. Nothing committed (~37 files).
- Next: commit; migrate PracticeCard onto RepairFlow; consider cloze on the Knowledge page as a "quick self-check" per note.

---

## Session 14: Serious Prep Pass
- **Date**: 2026-11-11
- **Objective**: Act on user feedback: no kids' vibe, no hints/emojis, no giveaway check questions, written answers with photo upload, UPSC-standard questions.

### Key Discussions & Findings
See [Entry 020](./features_and_changes.md#entry-020-serious-prep-pass--written-answers-upsc-standard-questions-answer-key-audit-no-emojis). Biggest catch: the note-grounding rule I first wrote propagated a factual error from an AI note into an answer key; fixed and backstopped by an independent answer-key audit.

### Current State & Next Steps
- Everything verified; nothing committed.
- Next: regenerate old-prompt questions for the remaining concepts (needs user OK); add a note audit; commit.
