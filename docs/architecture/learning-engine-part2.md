# Phase 2 — Learning Intelligence & Student Modeling Audit (Part 2)

> **Sections 6-10 · Sections 1-5 in Part 1**

---

## 6. Student Signals Inventory

Every learning signal tracked in the system:

| Signal | Description | Source | Storage | Update Logic | Consumers |
|---|---|---|---|---|---|
| `easeFactor` | SM-2 ease factor controlling interval growth | SM-2 engine `calculateNextState()` | `concept_mastery.ease_factor` | SM-2 formula on each review; -0.15 on fail; min 1.3 | Revision priority, forgetting probability |
| `intervalDays` | Current review interval | SM-2 engine | `concept_mastery.interval_days` | 1→3→interval×EF progression; reset to 1 on fail; max 90 | Next review scheduling, mastery classification |
| `repetitionCount` | Consecutive successful reviews | SM-2 engine | `concept_mastery.repetition_count` | +1 on pass; reset to 0 on fail | Mastery classification |
| `masteryLevel` | Concept mastery classification | `classifyMastery()` | `concept_mastery.mastery_level` | Derived from reps, interval, EF, counts | Revision UI, adaptive intelligence, question surfacing |
| `confidenceScore` | Accuracy ratio | SM-2 engine | `concept_mastery.confidence_score` | `correct / (correct + incorrect)` | Revision priority, adaptive intelligence, question surfacing |
| `correctCount` | Total correct responses | SM-2 engine | `concept_mastery.correct_count` | +1 on quality >= 3 | Confidence calculation, adaptive difficulty |
| `incorrectCount` | Total incorrect responses | SM-2 engine | `concept_mastery.incorrect_count` | +1 on quality < 3 | Confidence, weak detection, adaptive difficulty |
| `skipCount` | Total skipped reviews | `handleSkip()` | `concept_mastery.skip_count` | +1 on skip | Weak area detection |
| `isWeakArea` | Whether concept has weak signals | `detectWeakSignals()` | `concept_mastery.is_weak_area` | `weakSignals.length > 0` | Revision priority (+0.25), question surfacing (+100), adaptive engine |
| `weakSignals` | Array of signal strings | `detectWeakSignals()` | `concept_mastery.weak_signals` | Recomputed on every review | Weak area details UI |
| `lastReviewedAt` | Timestamp of last review | `recordReview()` | `concept_mastery.last_reviewed_at` | Set to `now` on review | Forgetting probability, days since review |
| `nextReviewAt` | Scheduled next review | SM-2 engine | `concept_mastery.next_review_at` | `now + intervalDays` | Due-for-revision query, overdue calculation |
| `extractionConfidence` | AI extraction quality score | `computeConfidence()` | `concepts.extraction_confidence` | Set once at extraction time (5-signal formula) | Revision priority importance signal |
| `qualityRating` | SM-2 quality per event | User input / MCQ result | `revision_events.quality_rating` | Stored per event; 0-5 scale | SM-2 state transition |
| `mcqCorrect` | MCQ correctness per event | MCQ answer comparison | `revision_events.mcq_correct` | Stored per event | Event audit trail |
| `generationConfidence` | AI question generation quality | Question intelligence service | `concept_questions.generation_confidence` | Set once at generation time | Not consumed by any learning engine |
| `mappingConfidence` | GS mapping quality | Context intelligence service | `concept_context_intelligence.mapping_confidence` | Set once at generation time | Not consumed by any learning engine |
| `contextConfidence` | Context dimension quality | Context intelligence service | `concept_context_intelligence.context_confidence` | Set once at generation time | Not consumed by any learning engine |
| `relationship strength` | Cross-concept link strength | Relationship extraction | `concept_relationships.strength` | Set once at extraction | Revision priority connectivity signal |
| `subjectStrengths.score` | Per-subject strength 0-1 | `computeSubjectStrengths()` | `learner_adaptive_profile.subject_strengths` | Weighted mastery distribution / concept count | Insights UI, recommendations |
| `subjectBalance` | Study distribution evenness 0-1 | `analyzeStudyPatterns()` | `learner_adaptive_profile.study_patterns` | `1 - (CV / 1.5)` where CV = coefficient of variation | Insights UI, recommendations |
| `coveragePercent` | Syllabus coverage per GS paper | `computeSyllabusCoverage()` | `learner_adaptive_profile.syllabus_coverage` | `coveredSubtopics / totalSubtopics × 100` | Insights UI, gap detection |
| `weaknessScore` | Per-subject weakness 0-1 | `computeSubjectWeaknesses()` | `learner_adaptive_profile.subject_weaknesses` | Sum of 4 signals (weak ratio, low strength, low confidence, high unseen) | Insights UI, recommendations |
| `priorityScore` (revision) | Revision urgency 0-1 | `calculateRevisionPriority()` | Not persisted (computed on request) | Sum of 5 weighted signals | Revision recommendation ranking |
| `forgettingProbability` | Estimated forgetting 0-1 | `estimateForgettingProbability()` | Not persisted (computed on request) | Exponential decay model | Revision UI display |
| `priorityScore` (surfacing) | Practice surfacing priority | `scoreConcept()` | Not persisted (computed on request) | Base weight + boosts per reason | Question surfacing order |
| `streak` | Consecutive study days | `getStreakDays()` | Not persisted (computed on request) | Count backward from today through consecutive log dates | Dashboard QuickStats |

---

## 7. Dashboard & Analytics Calculations

### Dashboard Page (`/dashboard`)

**Data source:** Server Component in [dashboard/page.tsx](file:///home/rahul/web_devlopment/Upsc_app_2/src/app/dashboard/page.tsx#L10-L43). Fetches from `profileRepository`, `dailyLogService.getRecentLogs()`, `dailyLogService.getQuickStats()`.

#### QuickStats (4 metrics)

| Metric | Calculation | Source | Update Trigger |
|---|---|---|---|
| **Study Streak** | Count consecutive days backward from today that have a daily log entry | `getStreakDays(dates)` in `date.ts` consuming `dailyLogRepository.getLogDates()` | New daily log created |
| **Total Sessions** | `dates.length` — total count of unique log dates | `dailyLogRepository.getLogDates()` | New daily log created |
| **This Month** | `recentLogs.length` from last 30 logs query | `dailyLogRepository.findRecentByUser(userId, 30)` | New daily log created |
| **Subjects Covered** | Count of unique subjects across all recent logs | Set of subjects from recent logs | New daily log created |

**Important:** Dashboard metrics come ONLY from `daily_logs`. They do NOT reflect mastery, revision, or practice activity.

### Revision Page (`/dashboard/revision`)

**Data source:** Client component `RevisionList.tsx` fetches from `/api/revision`.

#### Stats Summary (8 metrics)

| Metric | Calculation | Source |
|---|---|---|
| **Due Now** | Count of mastery records where `nextReviewAt <= now` | `revisionIntelligenceService.getStats()` |
| **Mastered** | Count where `masteryLevel === "mastered"` | Same |
| **Reviewing** | Count where `masteryLevel === "reviewing"` | Same |
| **Learning** | Count where `masteryLevel === "learning"` | Same |
| **Unseen** | Count where masteryLevel is anything else | Same |
| **Weak Areas** | Count where `isWeakArea === true` | Same |
| **Total Concepts** | Total mastery records | Same |
| **Avg Confidence** | `sum(confidenceScore) / count` | Same |

### Practice Page (`/dashboard/practice`)

| Metric | Calculation | Source |
|---|---|---|
| **Concepts surfaced** | `surfaced.length` from daily practice set | Surfacing engine |
| **Deferred count** | `scored.length - selected.length` | Surfacing engine |
| **Hydrated percent** | `inventorySize / totalConcepts × 100` | Practice API |
| **Composition** | Count per reason (weak_area, revision_due, new_concept, deferred) | Surfacing engine |

### Insights Page (`/dashboard/insights`)

| Metric | Calculation | Source |
|---|---|---|
| **Subject Strength %** | `(mastered×1.0 + reviewing×0.6 + learning×0.3) / conceptCount × 100` | `computeSubjectStrengths()` |
| **GS Coverage %** | `coveredSubtopics / totalSubtopics × 100` per paper | `computeSyllabusCoverage()` |
| **Concept Gaps count** | Number of detected gaps (max 15) | `detectConceptGaps()` |
| **Study Balance %** | `max(0, (1 - CV/1.5)) × 100` where CV = stdDev/mean of subject distribution | `analyzeStudyPatterns()` |
| **Dominant Subject** | Subject with most concepts | Same |
| **Neglected Subject** | Subject with fewest concepts (or first untouched) | Same |
| **Untouched Subjects** | Subjects with zero concepts | Same |

---

## 8. AI Decision Logic

### Decision 1: Mastery Classification

- **Engine:** `classifyMastery()` in `spaced-repetition.engine.ts`
- **Inputs:** repetitionCount, intervalDays, easeFactor, correctCount, incorrectCount
- **Logic:** Rule-based thresholds (see Section 2)
- **Output:** `"unseen" | "learning" | "reviewing" | "mastered"`

### Decision 2: Weak Area Detection

- **Engine:** `detectWeakSignals()` in `spaced-repetition.engine.ts`
- **Inputs:** correctCount, incorrectCount, skipCount, repetitionCount, lastQuality
- **Logic:** 4 threshold-based rules (see Section 2)
- **Output:** Array of signal strings; `isWeakArea = signals.length > 0`

### Decision 3: Revision Priority Ranking

- **Engine:** `calculateRevisionPriority()` in `spaced-repetition.engine.ts`
- **Inputs:** mastery state, review dates, extraction confidence, hasGSMapping, hasPYQMatch, relationshipCount
- **Logic:** 5 weighted signals summed (see Section 3)
- **Output:** Priority score 0-1 with signal breakdown

### Decision 4: Question Surfacing

- **Engine:** `computeDailyPractice()` in `question-surfacing.engine.ts`
- **Inputs:** Question inventory, mastery signals
- **Logic:** Score each concept by reason (weak > revision_due > new > deferred > balance), enforce budget limits, rotate questions by attempt offset
- **Output:** Curated daily practice set with composition metadata

### Decision 5: Adaptive Difficulty

- **Engine:** `computeAdaptiveDifficulty()` in `adaptive-intelligence.engine.ts`
- **Inputs:** masteryLevel, confidenceScore, correctCount, incorrectCount
- **Logic:**
  - mastered + accuracy >= 0.8 → `"hard"`
  - reviewing + accuracy >= 0.6 → `"moderate"`
  - learning or accuracy < 0.5 → `"easy"`
  - default → `"moderate"`
- **Output:** Recommended difficulty with reason string
- **Note:** This is exposed via `GET /api/adaptive?action=difficulty&conceptId=xxx` but is NOT consumed by any UI component or question generation service.

### Decision 6: Subject Strength Scoring

- **Engine:** `computeSubjectStrengths()` in `adaptive-intelligence.engine.ts`
- **Inputs:** All concepts, all mastery records
- **Logic:** Group by subject → weighted mastery distribution (mastered×1.0, reviewing×0.6, learning×0.3) / count
- **Output:** Per-subject score 0-1, sorted weakest-first

### Decision 7: Concept Gap Detection

- **Engine:** `detectConceptGaps()` in `adaptive-intelligence.engine.ts`
- **Inputs:** Syllabus coverage, subject strengths
- **Logic:** Find partially-studied domains with missing subtopics; find subjects with zero concepts when others are active
- **Output:** Up to 15 gaps with severity (high/moderate/low)

### Decision 8: Recommendation Generation

- **Engine:** `generateRecommendations()` in `adaptive-intelligence.engine.ts`
- **Inputs:** All engine outputs (strengths, weaknesses, gaps, patterns, coverage)
- **Logic:** 5 recommendation types: focus weak subjects, explore untouched, fill high-severity gaps, balance study, improve low-coverage papers
- **Output:** Up to 8 recommendations sorted by priority

### Decision 9: Forgetting Probability Estimation

- **Engine:** `estimateForgettingProbability()` in `spaced-repetition.engine.ts`
- **Inputs:** lastReviewedAt, intervalDays, easeFactor
- **Logic:** Exponential decay: `P = 1 - exp(-decayRate × max(0, ratio - 0.5))` where `ratio = elapsed/interval`, `decayRate = 1/EF`
- **Output:** Probability 0-1. Displayed in Revision UI as "X% forgotten"

---

## 9. Hidden Scores & Internal Intelligence

| Score/Signal | Created In | Used In | Notes |
|---|---|---|---|
| `extractionConfidence` (0-1) | `computeConfidence()` in `confidence.ts` — 5 weighted signals: keyword richness (0.20), completeness (0.20), subject certainty (0.25), specificity (0.20), parsing reliability (0.15) | `calculateRevisionPriority()` → importance signal (+0.05 if >= 0.7) | Computed once at extraction; never updated |
| `confidenceScore` (0-1) | SM-2 engine: `correct/(correct+incorrect)` | Revision priority (low confidence signal), question surfacing (confidence penalty), adaptive strength, adaptive weakness | Updated on every review |
| `priorityScore` (revision, 0-1) | `calculateRevisionPriority()` — 5 signals summed | Revision recommendation ranking (sort descending) | Computed on-demand, not persisted |
| `priorityScore` (surfacing, 0-130+) | `scoreConcept()` — base weight + boosts | Question surfacing order (sort descending) | Computed on-demand, not persisted |
| `forgettingProbability` (0-1) | `estimateForgettingProbability()` — exponential decay | RevisionList UI display | Computed on-demand, not persisted |
| `subjectStrengths.score` (0-1) | `computeSubjectStrengths()` — weighted mastery distribution | InsightsDashboard, gap detection, recommendations | Persisted in adaptive profile JSONB |
| `weaknessScore` (0-1) | `computeSubjectWeaknesses()` — sum of 4 signals (max 1.0) | Recommendations priority: `0.3 + weaknessScore × 0.5` | Persisted in adaptive profile JSONB |
| `subjectBalance` (0-1) | `analyzeStudyPatterns()` — `1 - CV/1.5` | InsightsDashboard, balance recommendation trigger (< 0.4) | Persisted in adaptive profile JSONB |
| `coveragePercent` (0-100) | `computeSyllabusCoverage()` — `covered/total × 100` | InsightsDashboard, low-coverage recommendation trigger (< 20%) | Persisted in adaptive profile JSONB |
| `relationship.strength` (0-1) | AI extraction (LLM-reported) | `calculateRevisionPriority()` → connectivity signal (count × 0.02, max 0.10) | Persisted in concept_relationships |
| `generationConfidence` (0-1) | Question intelligence service (LLM-reported) | **Not consumed by any engine** | Stored in concept_questions, unused |
| `mappingConfidence` (0-1) | Context intelligence service | **Not consumed by any engine** | Stored in concept_context_intelligence, unused |
| `contextConfidence` (0-1) | Context intelligence service | **Not consumed by any engine** | Stored in concept_context_intelligence, unused |
| `recommendation.priority` (0-1) | `generateRecommendations()` — type-specific formula | Recommendation sort order | Persisted in adaptive profile JSONB |
| `gap.severity` (low/moderate/high) | `detectConceptGaps()` — based on coverage ratio | Gap sort order, high-severity gaps feed recommendations | Persisted in adaptive profile JSONB |
| `hydratedPercent` (0-100) | Practice API: `inventorySize / totalConcepts × 100` | PracticeList UI indicator | Computed on-demand, not persisted |

---

## 10. Repair System Readiness

| Capability | Status | Evidence |
|---|---|---|
| **Concept Mastery** | ✅ Fully Implemented | `concept_mastery` table with SM-2 state, 4-level classification, confidence score. Updated on every review via `calculateNextState()`. |
| **Knowledge Retention** | ✅ Fully Implemented | `estimateForgettingProbability()` uses exponential decay model based on elapsed time, interval, and ease factor. Displayed in Revision UI. |
| **Forgetting** | ✅ Fully Implemented | Forgetting is modeled via the SM-2 interval system. Failed reviews (quality < 3) reset interval to 1 day and decay ease factor. `forgettingProbability` is computed and displayed. |
| **Weak Areas** | ✅ Fully Implemented | `detectWeakSignals()` checks 4 conditions (high error rate, repeated skips, complete blackout, repeated resets). `isWeakArea` boolean + `weakSignals` array stored and used by revision priority (+0.25) and question surfacing (+100 base score). Weak area list accessible via `GET /api/revision?action=weak-areas`. |
| **Learning Progress** | 🟡 Partially Implemented | Progress is trackable through mastery level transitions (unseen→learning→reviewing→mastered) and confidence score trends. However, there is no **temporal progress tracking** — no history of mastery level changes over time. Only current state is stored. `revision_events` provides raw event history but no aggregated progress view. |
| **Subject Strength** | ✅ Fully Implemented | `computeSubjectStrengths()` produces per-subject score (0-1) using weighted mastery distribution. Includes concept count, mastery breakdown, average confidence, weak count, and evidence trails. Displayed in InsightsDashboard. |
| **Concept Confidence** | ✅ Fully Implemented | Two distinct confidence signals: (1) `extractionConfidence` — AI extraction quality (5-signal formula, set once); (2) `confidenceScore` — learning confidence (correct/total, updated on every review). Both are used in priority scoring. |
| **Revision Effectiveness** | 🟡 Partially Implemented | The system tracks `correctCount`, `incorrectCount`, `skipCount`, and logs every review event with metadata (previous/new interval and ease). However, there is **no aggregate analysis** of revision effectiveness — no measurement of how reviews improve retention over time, no comparison of pre/post review performance, no session-level analytics. Raw data exists but is not analyzed. |
| **Practice Effectiveness** | ❌ Not Implemented | MCQ attempts update mastery state, but there is no tracking of: (1) practice session performance (% correct per session), (2) improvement trends across sessions, (3) question difficulty vs. performance, (4) time spent per question, (5) which question types (prelims/mains/interview) are most effective. The `PracticeCard` component does not aggregate or report practice outcomes. Mains and Interview prompts have **zero tracking** — they are display-only with no interaction recording. |

### Summary Table

| Capability | Status |
|---|---|
| Concept Mastery | ✅ |
| Knowledge Retention | ✅ |
| Forgetting | ✅ |
| Weak Areas | ✅ |
| Learning Progress | 🟡 |
| Subject Strength | ✅ |
| Concept Confidence | ✅ |
| Revision Effectiveness | 🟡 |
| Practice Effectiveness | ❌ |

---

## End of Phase 2 Audit

**Files referenced in this audit:**

- [spaced-repetition.engine.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/spaced-repetition.engine.ts) — Core SM-2 engine
- [revision-intelligence.service.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/revision-intelligence.service.ts) — Revision orchestration
- [adaptive-intelligence.engine.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/adaptive-intelligence.engine.ts) — 6 pure-function adaptive engines
- [adaptive-intelligence.service.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/adaptive-intelligence.service.ts) — Adaptive profile service
- [question-surfacing.engine.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/services/question-surfacing.engine.ts) — Daily practice selection
- [revision.repository.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/repositories/revision.repository.ts) — Mastery + event persistence
- [adaptive-profile.repository.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/repositories/adaptive-profile.repository.ts) — Adaptive profile persistence
- [confidence.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/ai/utils/confidence.ts) — Extraction confidence scoring
- [concept-mastery.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/db/schema/concept-mastery.ts) — Schema
- [revision-events.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/db/schema/revision-events.ts) — Schema
- [learner-adaptive-profile.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/db/schema/learner-adaptive-profile.ts) — Schema
- [PracticeCard.tsx](file:///home/rahul/web_devlopment/Upsc_app_2/src/components/features/practice/PracticeCard.tsx) — MCQ interaction + mastery firing
- [RevisionList.tsx](file:///home/rahul/web_devlopment/Upsc_app_2/src/components/features/revision/RevisionList.tsx) — Revision UI
- [InsightsDashboard.tsx](file:///home/rahul/web_devlopment/Upsc_app_2/src/components/features/insights/InsightsDashboard.tsx) — Adaptive analytics UI
- [QuickStats.tsx](file:///home/rahul/web_devlopment/Upsc_app_2/src/components/features/dashboard/QuickStats.tsx) — Dashboard metrics
- [daily-log.service.ts](file:///home/rahul/web_devlopment/Upsc_app_2/src/lib/services/daily-log.service.ts) — Streak/stats computation
