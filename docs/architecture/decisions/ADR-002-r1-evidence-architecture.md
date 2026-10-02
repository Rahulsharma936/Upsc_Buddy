# ADR-002: R1 Evidence Architecture

> **Status:** Accepted
> **Date:** 2026-07-26
> **Context:** Minimum evidence architecture decisions for Repair Diagnostic Engine R1

---

## Decision 1: Stable Question Identity via JSONB `questionId`

**Context:** MCQ questions are stored as JSONB arrays in `concept_questions.prelims_mcqs`. Historical evidence references questions by `mcqQuestionIndex` (array position). Regeneration (`force: true`) deletes and replaces all questions, causing index-based identity to point to a different question after regeneration.

**Decision:** Inject a `questionId: UUID` into each MCQ object inside the JSONB array at generation time (post-validation, pre-persistence). Persist `questionId` in `eventMetadata` alongside MCQ attempt events.

**Alternatives Rejected:**
| Strategy | Why Rejected |
|---|---|
| Separate `questions` table with per-row IDs | Unnecessary complexity — violates "no new table" constraint for R1 |
| Content hash as ID | Fragile — minor AI output variations change the hash |
| `conceptId + mcqQuestionIndex` (original) | Not semantically stable across regeneration |

**Rationale:**
- Zero schema migration — lives inside existing JSONB
- Backwards compatible — old questions without `questionId` treated as legacy concept-level evidence
- Survives reordering — UUID attached to object, not position
- Distinguishes regeneration — new questions get new UUIDs
- Minimal implementation: `crypto.randomUUID()` per MCQ in `question-intelligence.service.ts`

**Consequences:**
- ✅ Future Repair engine can reliably group attempts by exact question
- ✅ No migration, no new table, no Zod schema change for AI output
- ⚠️ Existing questions in DB won't have `questionId` until regenerated or backfilled
- ⚠️ Historical events without `questionId` must be handled as legacy evidence

---

## Decision 2: Evidence Storage in `eventMetadata` JSONB

**Context:** R1 needs to store new evidence signals (selectedAnswer, correctAnswer, confidence, selfAssessment, questionId) alongside existing revision events.

**Decision:** Store all new evidence as additive fields in the existing `revision_events.eventMetadata` JSONB column. No new columns. No new tables.

**Rationale:**
- `eventMetadata` already exists and is written on every event
- At UPSC-student scale (~2000 events/year), JSONB extraction is negligible
- Zero schema migration needed
- Existing data remains valid — old events simply lack new fields
- Future: can add GIN index or promote hot fields to columns if needed

---

## Decision 3: Raw/Derived Signal Separation

**Context:** New evidence signals (confidence, selectedAnswer, selfAssessment) must coexist with the existing SM-2 mastery system without altering its behavior.

**Decision:** Store raw learner evidence unchanged in `eventMetadata`. SM-2 quality derivation remains independent. New evidence is invisible to the SM-2 engine.

**Examples:**
- `selfAssessment = "partially"` → stored raw → mapped to `quality = 3` → SM-2
- `confidence = 3` + `selectedAnswer = "b"` → stored raw → SM-2 sees only `quality = 4|1` from `mcqCorrect`

**Rationale:**
- Preserves original learner signal for future probabilistic diagnosis
- SM-2 behavior unchanged — no regression risk
- Mapping is explicit and tunable without invalidating historical data

---

## Decision 4: Pre-Outcome Confidence Capture

**Context:** Calibration evidence requires knowing the learner's confidence BEFORE they see whether their answer is correct.

**Decision:** Confidence must be captured before outcome revelation. The architecture does NOT mandate a specific UI mechanism (e.g., "locked options"). R1.2 should implement the lowest-friction interaction that satisfies the pre-outcome constraint.

**Model:** 3-level ordinal — Guessing (1), Somewhat sure (2), Very sure (3).

---

## Decision 5: Retrieval-First Revision Workflow

**Context:** Revision self-assessment has higher evidence quality when the learner has genuinely attempted recall before seeing material.

**Decision:** The revision UX must show a concept cue first, allow the learner to attempt recall, then reveal material, then collect self-assessment. Do NOT show all material upfront.

**Rationale:** Showing material first measures recognition, not retrieval. Retrieval practice produces stronger memory consolidation and more reliable self-assessment evidence.

---

## Decision 6: Evidence-Only in R1 — No Diagnostic Classification

**Context:** R1.1 originally associated evidence directly with diagnoses (e.g., "Consistent Forgot → Understanding Gap").

**Decision:** R1 collects evidence. R1 does NOT classify observations into diagnostic categories. The same observation may have multiple explanations. Diagnosis is R2's responsibility.

**Removed:**
- "Always picks option A = guessing"
- "Consistent Forgot → Understanding Gap"
- "Forgot after correct → Memory Gap"
- All deterministic observation → diagnosis mappings

**Rationale:** Deterministic diagnosis from single signals is unreliable. R2 will combine multiple evidence signals probabilistically.
