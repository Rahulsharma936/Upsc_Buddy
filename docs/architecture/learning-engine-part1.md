# Phase 2 — Learning Intelligence & Student Modeling Audit (Part 1)

> **Sections 1-5 · Sections 6-10 in Part 2**

---

## 1. Student Learning Model

### How the Application Models a Student's Knowledge

The application models learning through **four interconnected entity layers**:

```
concepts (what was studied)
    ↓
concept_mastery (SM-2 state per concept)
    ↓
revision_events (append-only interaction log)
    ↓
learner_adaptive_profile (computed analytics cache)
```

**Entity 1: `concepts`** — Raw knowledge units extracted by AI from study logs. Each concept has a `subject`, `difficulty`, `extractionConfidence`, and `keywords`. This is the **input** to the learning model.

**Entity 2: `concept_mastery`** — The core learning state. One row per user+concept. Stores SM-2 scheduling state (ease factor, interval, repetition count), performance counters (correct/incorrect/skip), mastery classification (unseen/learning/reviewing/mastered), confidence score, weak area flag, and next review date.

**Entity 3: `revision_events`** — Append-only audit log of every learning interaction (review, skip, MCQ attempt, self-assessment). Stores quality rating, MCQ correctness, and metadata about state transitions.

**Entity 4: `learner_adaptive_profile`** — Single cached row per user containing computed analytics: subject strengths, syllabus coverage, concept gaps, study patterns, weaknesses, and recommendations. Recomputed when stale (>1 hour).

### How They Interact

1. A **daily log** creates **concepts** via AI extraction
2. The orchestration pipeline initializes a **concept_mastery** row (unseen, ease=2.5, interval=1, first review=tomorrow)
3. When the user reviews (or answers MCQs), a **revision_event** is logged and **concept_mastery** is updated via the SM-2 engine
4. After orchestration or review, the **learner_adaptive_profile** is recomputed from all concepts + all mastery records

### Supporting Entities (Not Direct Learning State)

| Entity | Role in Learning Model |
|---|---|
| `concept_questions` | Question inventory consumed by the surfacing engine |
| `concept_context_intelligence` | GS mapping + analytical dimensions (used for revision priority scoring) |
| `concept_relationships` | Cross-concept links (used for revision priority connectivity bonus) |
| `pyq_concept_matches` | PYQ links (used for revision priority importance signal) |

---

## 2. Concept Mastery (Deep Dive)

### Database Schema

**Table:** `concept_mastery` · **Schema file:** [concept-mastery.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/db/schema/concept-mastery.ts)

| Field | Type | Default | Purpose |
|---|---|---|---|
| `id` | UUID | random | Primary key |
| `user_id` | UUID (FK→profiles) | required | Owner |
| `concept_id` | UUID (FK→concepts) | required | Target concept |
| `ease_factor` | numeric(4,2) | `2.50` | SM-2 ease factor. Controls interval growth rate. Min=1.30 |
| `interval_days` | integer | `1` | Current review interval in days |
| `repetition_count` | integer | `0` | Consecutive successful reviews. Reset to 0 on failure |
| `mastery_level` | text | `"unseen"` | Classification: unseen/learning/reviewing/mastered |
| `confidence_score` | numeric(3,2) | `0.00` | correct/(correct+incorrect). Range 0.00-1.00 |
| `last_reviewed_at` | timestamptz | null | Last review timestamp |
| `next_review_at` | timestamptz | null | Next scheduled review |
| `correct_count` | integer | `0` | Total correct responses |
| `incorrect_count` | integer | `0` | Total incorrect responses |
| `skip_count` | integer | `0` | Total skipped reviews |
| `is_weak_area` | boolean | `false` | Whether weak signals exist |
| `weak_signals` | jsonb | `[]` | Array of signal strings |
| `created_at` | timestamptz | now() | Record creation |
| `updated_at` | timestamptz | now() | Last modification |

**Unique constraint:** `(user_id, concept_id)` — one mastery record per user per concept.

**Indexes:** `user_id`, `concept_id`, `(user_id, next_review_at)`.

### Initial Values (on creation)

Set by `initializeMastery()` in [spaced-repetition.engine.ts:187-200](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts#L187-L200):

```
easeFactor: 2.5, intervalDays: 1, repetitionCount: 0,
masteryLevel: "unseen", confidenceScore: 0,
correctCount: 0, incorrectCount: 0, skipCount: 0,
isWeakArea: false, weakSignals: []
```

`nextReviewAt` is set to **tomorrow** by `initializeForConcept()` in [revision-intelligence.service.ts:350-369](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/revision-intelligence.service.ts#L343-L369).

### Trigger Events

| Trigger | Source | Effect |
|---|---|---|
| Concept extraction completes | `cognitive-orchestration.service.ts` revision layer | Creates mastery record via `initializeForConcept()` |
| MCQ answered in Practice | `PracticeCard.tsx` → POST `/api/revision` | Calls `recordReview()` with quality 4 (correct) or 1 (incorrect) |
| Manual review recorded | POST `/api/revision` action=review | Calls `recordReview()` with provided quality (0-5) |
| Self-assessment | POST `/api/revision` action=self_assessment | Calls `recordReview()` |
| Skip | POST `/api/revision` action=skip | Calls `recordSkip()` |
| Initialize | POST `/api/revision` action=initialize | Calls `initializeForConcept()` |
| Backfill | POST `/api/ai/hydrate` with layers=["revision"] | Calls `initializeForConcept()` for uninitialized concepts |

### Mastery Classification Rules

Implemented in `classifyMastery()` at [spaced-repetition.engine.ts:204-215](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts#L204-L215):

| Level | Condition |
|---|---|
| `"unseen"` | `reps === 0` AND `correct + incorrect === 0` |
| `"learning"` | `reps === 0` AND has attempts, OR `reps === 1` |
| `"reviewing"` | `reps >= 2` (but not meeting mastered criteria) |
| `"mastered"` | `interval >= 21` AND `easeFactor >= 2.0` AND `reps >= 4` |

### Weak Area Detection

Implemented in `detectWeakSignals()` at [spaced-repetition.engine.ts:217-251](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts#L217-L251):

| Signal | Condition | Constants |
|---|---|---|
| `"high_error_rate"` | `incorrect/total >= 0.5` after `total >= 3` reviews | `WEAK_AREA_THRESHOLD=0.5`, `WEAK_AREA_MIN_REVIEWS=3` |
| `"repeated_skips"` | `skipCount >= 3` | `SKIP_WEAK_THRESHOLD=3` |
| `"complete_blackout"` | `quality === 0` AND `reps > 0` (previously reviewed) | — |
| `"repeated_resets"` | `incorrect >= 3` AND `reps <= 1` (keeps failing) | — |

`isWeakArea = weakSignals.length > 0`

### Confidence Score Formula

```
confidenceScore = correctCount / (correctCount + incorrectCount)
```

Rounded to 2 decimal places. Returns 0 if no attempts.

### Related Services, Repositories, Routes, Components

| Layer | File | Role |
|---|---|---|
| **Engine** | `spaced-repetition.engine.ts` | Pure SM-2 functions |
| **Service** | `revision-intelligence.service.ts` | Orchestrates review recording, recommendations, stats |
| **Repository** | `revision.repository.ts` | CRUD for concept_mastery + revision_events |
| **API** | `api/revision/route.ts` | GET (recommendations/stats/weak-areas), POST (record events) |
| **UI** | `RevisionList.tsx` | Displays recommendations, stats, weak areas |
| **UI** | `PracticeCard.tsx` | Fires MCQ attempt events to revision API |
| **UI** | `InsightsDashboard.tsx` | Consumes mastery data via adaptive intelligence |

---

## 3. Revision Intelligence

### SM-2 Implementation

**File:** [spaced-repetition.engine.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts)

The engine implements a **modified SM-2** algorithm. All functions are pure (no side effects).

### Quality Ratings (SM-2 Standard)

| Rating | Meaning |
|---|---|
| 0 | Complete blackout |
| 1 | Incorrect, recognized after reveal |
| 2 | Incorrect, but concept was familiar |
| 3 | Correct with significant difficulty |
| 4 | Correct with some hesitation |
| 5 | Perfect recall |

**Pass threshold:** `quality >= 3` (constant `PASS_THRESHOLD = 3`)

### What Happens When a Review is Completed

**Entry point:** `revisionIntelligenceService.recordReview()` in [revision-intelligence.service.ts:80-152](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/revision-intelligence.service.ts#L80-L152)

**Step 1: Load current state** — Get existing mastery from DB, or initialize defaults if none exists.

**Step 2: Calculate next state** via `calculateNextState(currentState, quality)`:

**If quality >= 3 (pass):**
- `correctCount++`
- Interval progression:
  - `reps === 0` → interval = **1 day**
  - `reps === 1` → interval = **3 days** (SM-2 standard uses 6; UPSC modification uses 3)
  - `reps >= 2` → interval = `round(interval × easeFactor)`
- `repetitionCount++`
- Ease factor update (standard SM-2 formula): `ef = ef + (0.1 - (5 - q) × (0.08 + (5 - q) × 0.02))`

**If quality < 3 (fail):**
- `incorrectCount++`
- `repetitionCount` reset to **0**
- `interval` reset to **1 day**
- Ease factor decay: `ef = max(1.3, ef - 0.15)` (gentler than SM-2's standard decay)

**Bounds enforcement:**
- `easeFactor` minimum: **1.3** (`MIN_EASE_FACTOR`)
- `interval` maximum: **90 days** (`MAX_INTERVAL_DAYS`)
- `easeFactor` rounded to 2 decimal places

**Step 3: Classify mastery level** using the rules in Section 2.

**Step 4: Compute confidence** as `correct / (correct + incorrect)`.

**Step 5: Detect weak signals** using the rules in Section 2.

**Step 6: Set `nextReviewAt`** to `now + interval days`.

**Step 7: Log revision event** (append-only) with metadata including previous/new interval and ease.

**Step 8: Upsert mastery record** to database.

### Skip Handling

`handleSkip()` at [spaced-repetition.engine.ts:160-182](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts#L160-L182):

- `skipCount++`
- Does NOT change interval or ease factor
- Pushes `nextReviewAt` back by **1 day**
- Adds `"repeated_skips"` weak signal if `skipCount >= 3`

### Priority Calculation (Revision Recommendations)

`calculateRevisionPriority()` at [spaced-repetition.engine.ts:261-314](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts#L261-L314):

| Signal | Weight Range | Formula |
|---|---|---|
| **Overdue** | 0–0.35 | `min(0.35, log2(1 + overdueDays) × 0.07)` |
| **Weakness** | 0 or 0.25 | 0.25 if `isWeakArea`, else 0 |
| **Low confidence** | 0–0.15 | `(1 - confidenceScore) × 0.15` |
| **UPSC importance** | 0–0.15 | +0.05 per: hasGSMapping, hasPYQMatch, extractionConfidence≥0.7 |
| **Connectivity** | 0–0.10 | `min(0.10, relationshipCount × 0.02)` |

**Total:** Sum of all signals, capped at 1.0. Higher = more urgent.

### Forgetting Probability

`estimateForgettingProbability()` at [spaced-repetition.engine.ts:320-337](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts#L320-L337):

```
ratio = elapsedDays / max(intervalDays, 1)
decayRate = 1 / easeFactor
probability = 1 - exp(-decayRate × max(0, ratio - 0.5))
```

Returns 0.5 if never reviewed. Clamped to [0, 1].

### Recommendation Generation

`getRecommendations()` in [revision-intelligence.service.ts:197-265](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/revision-intelligence.service.ts#L197-L265):

1. Query all concepts where `nextReviewAt <= now` (due for revision)
2. For each: load concept, context, PYQ matches, relationships
3. Compute priority score and forgetting probability
4. Sort by priority (highest first)
5. Return top N (default 15)

---

## 4. Practice Intelligence — Complete Lifecycle

### Step 1: Student Opens Practice Page

`PracticeList.tsx` fetches `GET /api/practice` → `practice/route.ts` runs.

### Step 2: Question Selection (Surfacing Engine)

The route loads all hydrated concepts with questions via `conceptQuestionsRepository.findAllWithConceptByUser()`, loads all mastery records, then calls `computeDailyPractice()`.

**Surfacing engine** ([question-surfacing.engine.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/question-surfacing.engine.ts)):

**Scoring** (`scoreConcept()` at lines 273-320):

| Condition | Reason | Base Score |
|---|---|---|
| `mastery.isWeakArea` | `"weak_area"` | 100 + min(daysOverdue×5, 30) |
| `mastery.daysOverdue > 0` | `"revision_due"` | 80 + min(daysOverdue×8, 40) + (1-confidence)×20 |
| Concept < 48 hours old | `"new_concept"` | 50 + max(0, 30-hoursSinceCreation) |
| Non-mastered, older | `"deferred"` | 40 + (1-confidence)×20 |
| Everything else | `"subject_balance"` | 30 |

**Budget:** max 6 concepts, 8 MCQs, 4 Mains, 2 Interview per day. Max 3 concepts from same subject.

**Question rotation:** Uses `totalAttempts` as offset to cycle through question arrays so different questions surface each session.

### Step 3: Question Answered (MCQ)

User clicks an option in `PracticeCard.tsx` → `handleMCQAnswer()` (lines 70-104):

1. Updates local UI state (selected answer, show explanation)
2. **Fire-and-forget** POST to `/api/revision`:
   - `action: "mcq_attempt"`
   - `quality: 4` (correct) or `quality: 1` (incorrect)
   - `mcqCorrect: boolean`
   - `mcqQuestionIndex: number`

### Step 4: What Gets Updated

The `/api/revision` POST handler calls `revisionIntelligenceService.recordReview()`:

- ✅ **Revision event logged** (append-only in `revision_events`)
- ✅ **Concept mastery updated** (ease factor, interval, mastery level, confidence, weak signals)
- ✅ **Next review date recalculated**

### Step 5: What Does NOT Happen

- ❌ **Analytics NOT refreshed** — The practice route does NOT call `refreshAdaptive()`. Only the orchestration and hydration routes do.
- ❌ **Dashboard NOT updated** — Dashboard stats (streak, total sessions, etc.) come from `daily_logs`, not from practice/revision.
- ❌ **Adaptive profile NOT recomputed** — It uses a 1-hour staleness check, so it will refresh on the next Insights page visit if stale.
- ❌ **No real-time feedback** — The MCQ result is fire-and-forget; the UI doesn't wait for the mastery update response.
- ❌ **Mains/Interview answers NOT tracked** — Only MCQ answers trigger mastery updates. Mains questions and interview prompts are display-only.

### Complete Data Flow

```
User answers MCQ in PracticeCard
    │
    ├─► Local UI: show correct/incorrect + explanation
    │
    └─► Fire-and-forget POST /api/revision
            │
            ├─► revision_events: INSERT (event log)
            │
            └─► concept_mastery: UPDATE
                  ├─ easeFactor recalculated
                  ├─ intervalDays recalculated
                  ├─ repetitionCount updated
                  ├─ correctCount or incorrectCount++
                  ├─ confidenceScore recalculated
                  ├─ masteryLevel reclassified
                  ├─ weakSignals recomputed
                  ├─ isWeakArea recomputed
                  ├─ lastReviewedAt = now
                  └─ nextReviewAt = now + interval

    ❌ learner_adaptive_profile: NOT updated
    ❌ Dashboard stats: NOT updated
    ❌ Question surfacing: NOT re-run
```

---

## 5. Learner Adaptive Profile

### Database Schema

**Table:** `learner_adaptive_profile` · **Schema file:** [learner-adaptive-profile.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/db/schema/learner-adaptive-profile.ts)

**One row per user.** Unique constraint on `user_id`.

| Field | Type | Default | Purpose | Update Source | Update Frequency | Consumers |
|---|---|---|---|---|---|---|
| `subject_strengths` | jsonb | `{}` | Array of `SubjectStrength` objects (score, mastery distribution, weak count per subject) | `computeSubjectStrengths()` engine | On recomputation (stale >1h or forced) | InsightsDashboard |
| `syllabus_coverage` | jsonb | `{}` | Array of `PaperCoverage` objects (per GS paper: domains, subtopics covered/total) | `computeSyllabusCoverage()` engine | Same | InsightsDashboard |
| `concept_gaps` | jsonb | `[]` | Array of `ConceptGap` objects (type, description, severity, evidence) | `detectConceptGaps()` engine | Same | InsightsDashboard |
| `study_patterns` | jsonb | `{}` | `StudyPatterns` object (balance score, dominant/neglected subject, distribution) | `analyzeStudyPatterns()` engine | Same | InsightsDashboard |
| `subject_weaknesses` | jsonb | `{}` | Array of `SubjectWeakness` objects (weakness score, signals) | `computeSubjectWeaknesses()` engine | Same | InsightsDashboard |
| `recommendations` | jsonb | `[]` | Array of `AdaptiveRecommendation` objects (type, target, reason, priority) | `generateRecommendations()` engine | Same | InsightsDashboard |
| `computation_metadata` | jsonb | `{}` | Stats: totalConcepts, totalMasteryRecords, mappedSubtopics, computationTimeMs | Service metadata | Same | InsightsDashboard (stats) |
| `last_computed_at` | timestamptz | now() | Staleness check timestamp | Set on each computation | Same | Staleness check |

### How the Profile is Generated

**Service:** [adaptive-intelligence.service.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/adaptive-intelligence.service.ts) · `computeAndPersist()` method.

**Step 1:** Load all user concepts (up to 500) and all mastery records.

**Step 2:** Load context intelligence records and extract mapped subtopics from `gsMappings`.

**Step 3:** Run 6 pure-function engines from [adaptive-intelligence.engine.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/adaptive-intelligence.engine.ts):

1. `computeSubjectStrengths(concepts, mastery)` — Weighted score: mastered×1.0 + reviewing×0.6 + learning×0.3, divided by concept count
2. `computeSyllabusCoverage(ontologyNodes, mappedSubtopics)` — Compare mapped subtopics against full UPSC syllabus ontology
3. `detectConceptGaps(coverage, strengths)` — Find partially-covered domains and untouched subjects
4. `analyzeStudyPatterns(concepts)` — Coefficient of variation for balance, dominant/neglected subjects
5. `computeSubjectWeaknesses(strengths, mastery)` — Score based on weak ratio, low strength, low confidence, high unseen ratio
6. `generateRecommendations(all above)` — Max 8 recommendations: focus weak, explore untouched, fill gaps, balance study, low coverage

**Step 4:** Upsert the computed profile to `learner_adaptive_profile`.

### Staleness & Caching

- **Threshold:** 1 hour (`STALENESS_THRESHOLD_MS = 60 * 60 * 1000`)
- If cached profile exists and `lastComputedAt` is within 1 hour, return cached
- Otherwise recompute from scratch
- `force: true` parameter bypasses cache

### Computation Triggers

| Trigger | Source |
|---|---|
| User visits Insights page | `GET /api/adaptive?action=profile` → checks staleness |
| After orchestration | `cognitiveOrchestrationService.refreshAdaptive(userId)` |
| After hydration | `POST /api/ai/hydrate` → `refreshAdaptive()` |
| Force recompute | `POST /api/adaptive` with `force: true` |

> **Part 2 continues with Sections 6-10: Signal Inventory, Dashboard Calculations, AI Decision Logic, Hidden Scores, and Repair System Readiness.**
