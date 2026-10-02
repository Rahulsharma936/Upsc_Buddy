# Repair System & Remediation Log

> **Last Updated:** 2026-07-26
> **Status:** Living document — update after each repair/fix implementation

---

## 1. Repair System Readiness (as of Phase 2 audit)

| Capability | Status | Evidence |
|---|---|---|
| Concept Mastery | ✅ Fully Implemented | `concept_mastery` with SM-2 state, 4-level classification, confidence score |
| Knowledge Retention | ✅ Fully Implemented | `estimateForgettingProbability()` — exponential decay model |
| Forgetting | ✅ Fully Implemented | SM-2 interval system; failed reviews reset interval + decay ease |
| Weak Areas | ✅ Fully Implemented | 4-condition `detectWeakSignals()` + `isWeakArea` boolean |
| Learning Progress | 🟡 Partial | Mastery level transitions trackable but no temporal history stored |
| Subject Strength | ✅ Fully Implemented | `computeSubjectStrengths()` per-subject weighted score |
| Concept Confidence | ✅ Fully Implemented | Two signals: extraction confidence + learning confidence |
| Revision Effectiveness | 🟡 Partial | Raw event data exists but no aggregate analysis |
| Practice Effectiveness | ❌ Not Implemented | No session performance, improvement trends, or question-type analysis |

---

## 2. Implemented Repairs (Chronological)

### Repair 1: Concept Extraction Reliability (2026-06-04)

**Root Cause:** Subject alias gaps + completed-empty cache lock
- AI returned subjects like `"History & Culture"` → `resolveSubject()` returned `null` → all concepts silently dropped → job marked "completed" with 0 persisted → idempotency guard cached empty result permanently

**5 Fixes Applied:**

| # | Fix | File | Severity |
|---|---|---|---|
| 1 | Added missing subject aliases (`"history & culture"` → History, `"polity & governance"` → Polity, etc.) | `subjects.ts` | 🔴 Critical |
| 2 | Completed-empty cache buster: jobs with 0 concepts marked `superseded`, allow re-extraction | `concept-extraction.service.ts`, `ai-job.repository.ts` | 🔴 Critical |
| 3 | Re-extract button in UI: calls API with `{ force: true }` | `LogCard.tsx` | 🟡 High |
| 4 | Extraction error visibility: classified statuses (`ai_unavailable`, `partial`, `empty`, `success`, `error`) | `extract-concepts/route.ts`, `LogCard.tsx` | 🟡 High |
| 5 | Pre-flight Ollama health check before job creation | `concept-extraction.service.ts` | 🟡 High |

**Verified:** TypeScript compiles clean. Alias fixes deterministic. Cache-bust tested.

---

### Repair 2: Practice Visibility — Historical Concepts (2026-06-09)

**Root Cause:** `findByUser(userId, 50)` with `ORDER BY created_at DESC LIMIT 50` excluded all concepts beyond 50 most recent from practice surfacing.

**Fix Applied:** Replaced concept loading + N+1 loop with inventory-first JOIN query.

| Metric | Before | After |
|---|---|---|
| SQL queries per practice load | 51 (1 + N) | 2 (JOIN + COUNT) |
| Visibility | 50 newest only | ALL hydrated concepts |
| Latency (est.) | ~255ms | ~15-35ms |

**Files Changed:**
- `concept-questions.repository.ts` — added `findAllWithConceptByUser()` JOIN query
- `concept.repository.ts` — added `countByUser()` COUNT query  
- `practice/route.ts` — replaced old loading with new queries

**Query (after):**
```sql
SELECT c.id, c.display_name, c.subject, c.difficulty, c.created_at,
       cq.prelims_mcqs, cq.mains_questions, cq.interview_prompts
FROM concept_questions cq
INNER JOIN concepts c ON cq.concept_id = c.id
WHERE c.user_id = $1
  AND (jsonb_array_length(cq.prelims_mcqs) > 0
    OR jsonb_array_length(cq.mains_questions) > 0
    OR jsonb_array_length(cq.interview_prompts) > 0);
```

---

### Repair 3: Learning Feedback Loop (2026-06-23)

**Root Cause:** MCQ answers in Practice were handled entirely in React `useState` — no `fetch()` call existed. Mastery was permanently frozen at initialized defaults.

**Fix Applied:** Added fire-and-forget `POST /api/revision` call in `handleMCQAnswer()`.

**Files Changed:** `PracticeCard.tsx` (1 file, ~35 lines)

**Before/After:**
- Before: User answers MCQ → local state only → mastery frozen forever
- After: User answers MCQ → local state + background `POST /api/revision` → SM-2 updates mastery → future practice sessions reflect performance

**Quality Mapping:** Correct → quality 4, Incorrect → quality 1

**Backend reused (zero new code):** `POST /api/revision`, `recordReview()`, `calculateNextState()`, `logEvent()`, `upsertMastery()`

---

### Repair 4: Question Rotation (2026-06-24)

**Root Cause:** `slice(0, N)` always returned same first N questions. No rotation mechanism existed.

**Fix Applied:** Attempt-count offset rotation using `totalAttempts = correctCount + incorrectCount` from already-loaded mastery data.

**Files Changed:** `question-surfacing.engine.ts`, `practice/route.ts` (2 files, ~30 lines)

**Algorithm:**
```typescript
function rotateSlice<T>(arr: T[], budget: number, offset: number): T[] {
  const start = offset % arr.length;
  // wrapping slice from start position
}
```

**Result:** 5 MCQs cycle across sessions (all surface within 3 sessions, full cycle every 5). Zero new queries, zero schema changes.

---

## 3. Known Remaining Issues

| Issue | Severity | Notes |
|---|---|---|
| No automatic hydration for historical concepts | 🟡 Medium | User must click "Hydrate more" manually |
| No anti-starvation for deferred concepts | 🟢 Low | Same high-priority concepts may dominate daily practice |
| Mains/Interview have zero tracking | 🟡 Medium | Display-only, no answer input or evaluation |
| Revision page is read-only | ✅ Resolved | R1.3: Retrieval-first revision workflow with self-assessment |
| No student-reported confidence | ✅ Resolved | R1.2: Pre-outcome confidence captured in PracticeCard |
| No response timing anywhere | 🟢 Low | No MCQ timer, no session duration — deferred to R2 |
| `skip` and `self_assessment` event types are dead code | ✅ Resolved | R1.3: RevisionList triggers both `self_assessment` and `skip` |
| No `lastSurfacedAt` tracking | 🟢 Low | Cannot boost concepts not surfaced in N days |
| Concept selection deterministic for tied scores | 🟢 Low | Stable sort preserves insertion order |
| No stable question identity | ✅ Resolved | R1.2: `questionId: UUID` injected at generation time |
| Selected MCQ answer not persisted | ✅ Resolved | R1.2: `selectedAnswer` + `correctAnswer` in eventMetadata |

---

## 4. Repair Decision Principles

1. **Reuse existing infrastructure** — all 4 repairs used existing API routes, services, and schema
2. **Fire-and-forget for UI responsiveness** — mastery updates don't block the UI
3. **Zero schema migrations** — all fixes were query-level or code-level
4. **Preserve idempotency** — cache-busting only for genuinely empty completed jobs
5. **Sequential, activity-driven rotation** — rotation advances only when user engages

---

## 5. R1 Evidence Architecture (2026-07-26)

> **Full design:** [ADR-002](decisions/ADR-002-r1-evidence-architecture.md)
> **R1.2 MCQ Evidence:** ✅ Implemented (2026-07-26)
> **R1.3 Revision Self-Assessment:** ✅ Implemented (2026-07-26)
> **R1.4 Evidence Integration:** ✅ Implemented (2026-07-26)
> **R1.5 Validation:** ✅ Passed — 126/126 assertions (2026-07-31)
> **R1 Status:** ✅ **READY FOR R2**

### New evidence signals for R1

| Signal | Where Stored | Purpose | Status |
|---|---|---|---|
| `questionId` (UUID) | `eventMetadata` + MCQ JSONB | Stable question identity across regeneration | ✅ R1.2 |
| `selectedAnswer` ("a"/"b"/"c"/"d") | `eventMetadata` | Raw chosen option | ✅ R1.2 |
| `correctAnswer` ("a"/"b"/"c"/"d") | `eventMetadata` | Raw correct option | ✅ R1.2 |
| `confidence` (1/2/3) | `eventMetadata` | Pre-outcome belief state | ✅ R1.2 |
| `selfAssessment` ("remembered"/"partially"/"forgot") | `eventMetadata` | Raw recall assessment | ✅ R1.3 |

### R1.2 — MCQ Evidence Implementation (2026-07-26)

| Task | Files | Change |
|---|---|---|
| Inject `questionId: UUID` into each MCQ at generation | `question-intelligence.service.ts` | Added `crypto.randomUUID()` per MCQ post-sanitization |
| Pre-outcome confidence capture (inline "How sure?" bar) | `PracticeCard.tsx` | Two-step answer flow: select → confidence → reveal outcome |
| Send `questionId` + `selectedAnswer` + `correctAnswer` + `confidence` in POST | `PracticeCard.tsx` | New fields in `fetch("/api/revision")` body |
| Accept + forward new MCQ evidence fields | `revision/route.ts` | Destructure + forward 4 new optional params |
| Include R1.2 evidence in `eventMetadata` | `revision-intelligence.service.ts` | Additive fields when present; SM-2 unchanged |

**Zero new APIs. Zero new tables. Zero schema changes. SM-2 quality derivation unchanged.**

### R1.3 — Revision Self-Assessment Implementation (2026-07-26)

| Task | Files | Change |
|---|---|---|
| Retrieval-first revision workflow | `RevisionList.tsx` | Full rewrite: recall cue → reveal material → self-assess |
| Accept + forward `selfAssessment` in API | `revision/route.ts` | Added `selfAssessment` to destructured body + forwarded |
| Include `selfAssessment` in `eventMetadata` | `revision-intelligence.service.ts` | Added to recordReview params + eventMetadata |
| Self-assessment → SM-2 quality mapping | `RevisionList.tsx` | remembered→4, partially→3, forgot→1 via `self_assessment` event |
| Skip integration | `RevisionList.tsx` | Uses existing `skip` action, existing skip infrastructure |

**Revision workflow:** concept cue → mental recall → reveal (coreIdea, examTriggers, memoryHooks) → Remembered/Partially/Forgot/Skip.
**Zero new APIs. Zero new tables. Zero schema changes.**

### R1.4 — Evidence Integration (2026-07-26)

| Task | Files | Change |
|---|---|---|
| R2 evidence contract (typed interfaces) | `src/lib/evidence/evidence.types.ts` | `NormalizedEvidence`, `ConceptEvidenceSequence`, query params |
| Evidence normalizer (JSONB → typed) | `src/lib/evidence/evidence.normalizer.ts` | `normalizeEvent()`, `normalizeEvents()` — pure, stateless |
| Barrel export | `src/lib/evidence/index.ts` | Re-exports types + functions for `@/lib/evidence` |
| Chronological evidence retrieval | `revision.repository.ts` | `getConceptHistory()` (ASC per concept), `getEventsByUser()` (ASC all) |

**R2 evidence contract:** `NormalizedEvidence` — flat typed interface combining revision_events columns + extracted eventMetadata JSONB. Legacy events normalize safely with null for missing R1.2/R1.3 fields. Unknown event types explicitly represented as `"unknown"` with `rawEventType` preserved.

**Reconstructable sequences:** MCQ trajectory (correct→incorrect), calibration (high confidence→wrong), revision→MCQ cross-check, repeated skips, exact-question history (via questionId).

### R1.5 — Evidence Foundation Validation (2026-07-31)

**Result:** ✅ 126/126 assertions passed — R1 READY FOR R2

| # | Scenario | Result |
|---|---|---|
| 1 | MCQ correct → later MCQ incorrect | ✅ Trajectory + evidence |
| 2 | MCQ incorrect → later correct | ✅ Recovery trajectory |
| 3 | High confidence → incorrect | ✅ Calibration gap detectable |
| 4 | Low confidence → correct | ✅ Lucky guess detectable |
| 5 | Same `questionId` multiple attempts | ✅ Per-question trajectory |
| 6 | Revision Remembered → later MCQ fail | ✅ Cross-check detectable |
| 7 | Revision Forgot → later recovery | ✅ forgot→partially→correct |
| 8 | Repeated revision skips | ✅ Weak area + evidence |
| 9 | Legacy event without R1 fields | ✅ Missing fields → null |
| 10 | Unknown event type | ✅ `"unknown"` + rawEventType |

**Regression:** SM-2 engine, mastery counters, weak signals, forgetting probability, interval scheduling — all invariants hold.

**Defects found:** 0

**Remaining evidence limitations (acceptable for R2):**
- No response-time telemetry (deferred to R2)
- Legacy MCQ events lack `questionId` — concept-level evidence only
- No `lastSurfacedAt` tracking — cannot measure surfacing→engagement gap
- `mcqQuestionIndex` in legacy events is not stable across regeneration

**Validation test:** `src/lib/evidence/__tests__/r1-validation.test.ts` — run with `npx tsx`

---

## 6. R2 Diagnostic Engine (2026-08-03)

> **Architecture:** [ADR-003](decisions/ADR-003-r2-diagnostic-engine.md)
> **R2.1 Architecture:** ✅ Designed (2026-08-03)
> **R2.2 Feature Extraction:** ✅ Implemented (2026-08-04)
> **R2.3 Scoring Engine:** ✅ Implemented (2026-08-04)

### Pipeline

```
NormalizedEvidence[] → Feature Extraction → ConceptFeatures → Diagnostic Engine → ConceptDiagnosticReport
                       (R2.2 ✅)                              (R2.3 ✅)
```

### R2.1 — Diagnostic Architecture (2026-08-03)

Designed four diagnostic categories: Concept Gap, Memory Gap, Calibration Gap, Revision Gap. Defined evidence mapping, weighted accumulation philosophy, temporal decay principles, Memory Gap eligibility rules, and diagnosis output contract.

### R2.2 — Feature Extraction Layer (2026-08-04)

| Task | Files | Change |
|---|---|---|
| Feature contract | `src/lib/diagnostic/feature.types.ts` | `ConceptFeatures` interface (15 features) |
| Feature extractor | `src/lib/diagnostic/feature.extractor.ts` | Pure function: `NormalizedEvidence[] → ConceptFeatures` |
| Barrel export | `src/lib/diagnostic/index.ts` | Re-exports for `@/lib/diagnostic` |
| Feature validation | `src/lib/diagnostic/__tests__/feature-extraction.test.ts` | 48/48 assertions |

**Features implemented (15):**

| Feature | Supports | Description |
|---|---|---|
| `accuracy` | Concept Gap | Overall MCQ accuracy (0.0–1.0) |
| `recentAccuracy` | Concept/Memory Gap | Accuracy over last N MCQ attempts |
| `hasSuccessHistory` | Memory Gap eligibility | Ever demonstrated understanding |
| `daysSinceLastSuccess` | Memory Gap | Days since last correct/remembered |
| `consecutiveFailures` | Concept Gap | Current streak of MCQ failures |
| `hasRepeatedWrongAnswer` | Concept Gap | Same wrong option ≥50% of errors |
| `intervalDecreasing` | Memory Gap | SM-2 interval shrinking |
| `confidenceMismatchRate` | Calibration Gap | Rate of confidence≠outcome events |
| `eventsWithConfidence` | Calibration Gap | Statistical significance guard |
| `recallSuccessRate` | Memory Gap | Revision "remembered" rate |
| `skipCount` | Revision Gap | Total skip events |
| `skipRate` | Revision Gap | Skips / (skips + revisions) |
| `daysSinceLastEvent` | Revision Gap | Engagement recency |
| `lastEventAt` | All | Temporal reference |
| `totalEvents` / `mcqAttemptCount` / `revisionAttemptCount` | All | Volume guards |

**Zero new telemetry. Zero schema changes. Pure function, fully testable.**

### R2.3 — Diagnostic Scoring Engine (2026-08-04)

| Task | Files | Change |
|---|---|---|
| Diagnostic output types | `src/lib/diagnostic/diagnostic.types.ts` | `ConceptDiagnosis`, `ConceptDiagnosticReport`, `ScoringConfig` |
| Scoring engine | `src/lib/diagnostic/diagnostic.engine.ts` | Pure function: `ConceptFeatures → ConceptDiagnosticReport` |
| Barrel export | `src/lib/diagnostic/index.ts` | Added R2.3 exports |
| Engine validation | `src/lib/diagnostic/__tests__/diagnostic-engine.test.ts` | 84/84 assertions |

**Scoring approach:**
- Weighted accumulation: each feature contributes configurable weights to each diagnosis
- Counter-evidence: positive features actively reduce diagnosis scores
- Minimum data guards: `minMcqAttempts`, `minConfidenceEvents` prevent premature diagnosis
- Memory Gap eligibility: requires `hasSuccessHistory = true`
- Score clamping: all scores in [0.0, 1.0]
- Configurable activation thresholds per diagnosis type
- All 4 diagnoses always present in output (including inactive)
- Primary = highest-scoring active diagnosis
- Deterministic explanations from feature contributions (no LLM)

**Validated scenarios (84 assertions):**
- Each diagnosis independently (Concept, Memory, Calibration, Revision)
- Counter-evidence reducing scores
- Memory Gap eligibility gate
- Calibration data guards
- Multiple simultaneous diagnoses
- Primary diagnosis selection and ranking
- Threshold boundaries with custom config
- Score clamping at extremes
- Conflicting evidence resolution
- Realistic mixed learning history
- Explanation quality (active + insufficient data)
- Contribution bounding and sorting
- Determinism (same input → identical output)

**Zero new telemetry. Zero schema changes. Pure function, fully testable.**

### R2.4 — Diagnostic Validation & Threshold Tuning (2026-08-05)

| Task | Files | Change |
|---|---|---|
| E2E validation | `src/lib/diagnostic/__tests__/e2e-validation.test.ts` | 66/66 assertions across 16 test sections |
| Threshold tuning | `src/lib/diagnostic/diagnostic.engine.ts` | 3 weight/threshold adjustments |

**E2E Scenarios validated (11 realistic learning histories):**

| # | Scenario | Expected | Actual |
|---|---|---|---|
| S1 | Never understood | Concept Gap active | ✅ CG=1.0, primary |
| S2 | Mastered then forgot | Memory Gap > Concept Gap | ✅ MG=0.45 > CG=0.05 |
| S3 | Gradual recovery | All inactive | ✅ No active diagnoses |
| S4 | Consistently overconfident | Calibration Gap active | ✅ Cal=0.72 |
| S5 | Consistently underconfident | Calibration Gap active | ✅ Cal=0.72 |
| S6 | Repeated revision skipper | Revision Gap active | ✅ RG=0.80 |
| S7 | Multi-diagnosis | CG + Cal + RG active | ✅ 3 simultaneous |
| S8 | Healthy learner | No diagnoses | ✅ All inactive |
| S9 | Sparse evidence | Modest scores | ✅ CG=0.80, no extreme |
| S10 | Long history (20 events) | Memory Gap dominates | ✅ MG=0.90, primary |
| S11 | Legacy events (no R1 fields) | Graceful degradation | ✅ CG from mcqCorrect only |

**Threshold tuning decisions:**

| Parameter | Before | After | Rationale |
|---|---|---|---|
| `highSkipRate` weight | 0.30 | 0.20 | Prevented sparse revision data from inflating Revision Gap |
| `highSkipRateThreshold` | 0.40 | 0.50 | Required majority skips, not just slight imbalance |
| `daysSinceEvent` weight | 0.01/day | 0.008/day | Tempered inactivity contribution to prevent it dominating |

**Feature interaction findings:**
- `accuracy` vs `recentAccuracy`: Overlap acknowledged; both fire when all events are recent. Accepted — they measure different things (lifetime vs recent window) and combined score remains within bounds.
- `skipCount` vs `skipRate`: After tuning, 1 skip in 2 events → RG=0.28 (reasonable). Before tuning was 0.62 (too sensitive).
- `consecutiveFailures` vs `recentAccuracy`: Both contribute to Concept Gap. Accepted — consecutive streak is qualitatively different from recent window average.

### R2.5 — Diagnostic API Integration (2026-08-05)

| Task | Files | Change |
|---|---|---|
| Diagnostic service | `src/lib/diagnostic/diagnostic.service.ts` | Pipeline orchestrator |
| API route | `src/app/api/diagnostic/route.ts` | `GET /api/diagnostic` |

**API Endpoints:**

```
GET /api/diagnostic?conceptId=<id>     → ConceptDiagnosticReport + features
GET /api/diagnostic?action=overview    → DiagnosticOverviewResponse
```

**Pipeline flow:**
```
Auth → Retrieve Events (revisionRepository) → Normalize → Extract Features → Diagnose → JSON Response
```

**Single concept response:** `{ report: ConceptDiagnosticReport, features: ConceptFeatures }`

**Overview response:** `{ totalConcepts, conceptsWithDiagnosis, byDiagnosis, highestPriority, summary }`

On-demand computation. No caching. No background workers. Reuses existing evidence repository.

### R2.6 — Diagnostic Experience (2026-08-05)

| Task | Files | Change |
|---|---|---|
| Route constant | `src/lib/constants/routes.ts` | Added `DIAGNOSTIC` route |
| Sidebar navigation | `src/components/features/dashboard/DashboardSidebar.tsx` | Added "Repair" section |
| Dashboard page | `src/app/dashboard/diagnostic/page.tsx` | Server component with PageHeader |
| Diagnostic view | `src/components/features/diagnostic/DiagnosticView.tsx` | Client component — full diagnostic experience |

**Three views implemented:**

1. **Health Summary** — Card grid showing concepts tracked, healthy count, attention needed, top priority
2. **Diagnosis Breakdown** — Per-type counts with color-coded cards (Concept, Memory, Calibration, Revision)
3. **Priority Queue / Concept List** — Expandable concept cards with:
   - Primary diagnosis badge and short description
   - Score indicator (severity-colored percentage)
   - "Why?" section with human-readable evidence explanations
   - Supporting diagnoses listed
   - All-clear state for healthy concepts

**Explainability:** Technical feature descriptions are translated to student-friendly language via `humanizeDescription()`. No raw feature names, no "mismatch rates", no "normalized evidence" exposed.

**Empty/edge states:** No data, all healthy, error, loading — all handled.

### R2.7 — R3 Handoff Contract (2026-08-05)

| Task | Files | Change |
|---|---|---|
| Architecture decision | `docs/architecture/decisions/ADR-004-r3-repair-engine-contract.md` | Repair philosophy, mapping, contracts, success criteria |
| Typed contract | `src/lib/diagnostic/repair.types.ts` | `RepairRequest`, `RepairSession`, `RepairActivity`, `RepairOutcome` |
| Barrel export | `src/lib/diagnostic/index.ts` | Added R2.7 repair type exports |

**Contract design:**
- `RepairRequest` — sole input to R3. Contains diagnosis type, score, human-readable reasons, co-existing diagnoses, and minimal context. Opaque to R2 internals.
- `RepairSession` — output from R3. Contains objective, strategy, ordered activities, lifecycle status, and outcome.
- `RepairStrategy` — enum of pedagogical approaches per diagnosis type (re_explain, retrieval_burst, calibration_drill, etc.)
- Future-compatible: new diagnosis types add union members, no interface redesign.

### R2 Complete ✅

| Phase | Goal | Status |
|---|---|---|
| ~~R2.1~~ | Diagnostic Architecture | ✅ Done |
| ~~R2.2~~ | Feature Extraction Layer | ✅ Done |
| ~~R2.3~~ | Diagnostic Scoring Engine | ✅ Done |
| ~~R2.4~~ | Diagnostic Validation & Tuning | ✅ Done |
| ~~R2.5~~ | Diagnostic API Integration | ✅ Done |
| ~~R2.6~~ | Diagnostic Experience | ✅ Done |
| ~~R2.7~~ | R3 Handoff Contract | ✅ Done |

### R3 Roadmap (Repair Engine)

| Phase | Goal | Status |
|---|---|---|
| R3.1 | RepairRequest builder (R2 → RepairRequest) | Pending |
| R3.2 | Concept Gap repair strategy | Pending |
| R3.3 | Memory Gap repair strategy | Pending |
| R3.4 | Repair session UI | Pending |
| R3.5 | Calibration Gap repair strategy | Pending |
| R3.6 | Revision Gap repair strategy | Pending |
| R3.7 | Repair API | Pending |
| R4.1 | Repair verification (re-diagnosis) | Pending |
| R4.2 | Repair cycle (retry on failure) | Pending |
