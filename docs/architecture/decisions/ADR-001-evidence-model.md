# ADR-001: Evidence-Based Learning Model

> **Status:** Accepted
> **Date:** 2026-06-04
> **Context:** Multiple architectural decisions from Phase 1-4 audits and repairs

---

## Decision 1: Inventory-First JOIN for Practice Loading

**Context:** Practice API loaded 50 newest concepts via `findByUser(userId, 50)` then ran N+1 queries for question inventory. Historical concepts were permanently invisible.

**Decision:** Replace with a single JOIN query from `concept_questions` → `concepts`, returning only hydrated concepts with non-empty question arrays. No LIMIT.

**Rationale:**
- Naturally bounded result set (only hydrated concepts)
- Eliminates N+1 (51 queries → 2)
- Uses existing indexes
- No schema changes needed
- Surfacing engine already budgets to 6 concepts

**Consequences:**
- ✅ All hydrated concepts visible regardless of age
- ✅ 85% query reduction
- ⚠️ Payload grows with hydration count (manageable at UPSC scale)

---

## Decision 2: Fire-and-Forget MCQ Mastery Updates

**Context:** MCQ answers need to update mastery (SM-2) but must not block the UI.

**Decision:** `PracticeCard.tsx` sends `POST /api/revision` as fire-and-forget after updating local UI state. API errors are caught and logged but don't affect user experience.

**Rationale:**
- User sees answer + explanation immediately (local state)
- Mastery update is background work
- All backend services already existed — zero new code on server side

**Consequences:**
- ✅ Instant UI feedback
- ⚠️ If API fails, mastery doesn't update (logged, not retried)
- ⚠️ User has no visibility into mastery update success/failure

---

## Decision 3: Attempt-Count Offset for Question Rotation

**Context:** `slice(0, N)` always returned the same first N questions from JSONB arrays. All rotation alternatives were evaluated.

**Decision:** Use `totalAttempts = correctCount + incorrectCount` from already-loaded mastery data as a modular offset into question arrays.

**Alternatives Rejected:**
| Strategy | Why Rejected |
|---|---|
| Pure random | Non-deterministic; same questions could repeat |
| Daily seed | Rotates without interaction; pseudo-random |
| Round-robin cursor | Requires new schema column |
| Attempt-history scan | Expensive query per concept |

**Rationale:**
- Zero new queries, zero schema changes
- Sequential cycling guarantees full coverage
- Activity-driven (no interaction = no rotation = correct behavior)
- Deterministic and debuggable

---

## Decision 4: Completed-Empty Cache Bust via Superseded Status

**Context:** When concept extraction completed with 0 concepts (due to subject alias failures), the idempotency guard permanently returned the empty cached result.

**Decision:** When a `completed` job has 0 concepts in DB, mark it `superseded` (a new transition from `completed → failed`) and allow re-extraction.

**Rationale:**
- Existing `markFailed()` correctly guards against invalid transitions
- Dedicated `markSuperseded()` is an explicit escape hatch
- Only affects completed-with-0 jobs — completed-with-results still cached correctly

---

## Decision 5: Engines vs Services Naming Convention

**Context:** The AI subsystem has both pure-function modules and stateful service modules.

**Decision:**
- **Engines** (`.engine.ts`) — Pure functions, no DB, no AI calls. Testable without mocking.
- **Services** (`.service.ts`) — Call LLMs, databases, or other services. Require infrastructure.

**Examples:**
- `spaced-repetition.engine.ts` — Pure SM-2 algorithm
- `question-surfacing.engine.ts` — Pure scoring + selection
- `revision-intelligence.service.ts` — Orchestrates review recording (calls engine + repository)

---

## Decision 6: Modified SM-2 Parameters for UPSC

**Context:** Standard SM-2 algorithm adapted for UPSC preparation cadence.

**Modifications from standard SM-2:**
| Parameter | Standard SM-2 | UPSC Modification | Reason |
|---|---|---|---|
| Second interval | 6 days | **3 days** | UPSC requires faster early reinforcement |
| Max interval | Unlimited | **90 days** | Exam date is finite; prevent intervals exceeding prep period |
| Fail ease decay | Standard formula | **-0.15 (gentler)** | Avoid overly aggressive penalization |
| Quality mapping (MCQ) | Self-reported 0-5 | **4 (correct) / 1 (incorrect)** | Binary MCQ outcome → mapped to SM-2 scale |

---

## Decision 7: Drizzle ORM over Prisma

**Rationale:**
- Lighter weight, closer to raw SQL
- Better compatibility with Supabase connection pooler (Supavisor)
- `prepare: false` required by pooler — Drizzle handles this cleanly
- Type-safe without code generation step
