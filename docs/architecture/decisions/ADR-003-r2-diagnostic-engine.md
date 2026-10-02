# ADR-003: R2 Diagnostic Engine Architecture

> **Status:** Proposed
> **Date:** 2026-08-03
> **Context:** Design how the Repair System reasons from R1 evidence to produce actionable learning diagnoses.
> **Scope:** Concept Gap, Memory Gap, Calibration Gap, Revision Gap only.

---

## 1. Diagnostic Definitions

### 1.1 Concept Gap

**What it represents:**
The learner does not understand the underlying concept well enough to apply it. When tested, they select wrong answers not because they forgot, but because their mental model of the concept is incorrect or incomplete.

**What it does NOT represent:**
- Forgetting something previously understood (that is Memory Gap)
- Knowing the concept but misreading the question (that is Application/Interpretation Gap — future)
- Low confidence on a topic they actually get right (that is Calibration Gap)

**Why it matters:**
A concept gap cannot be fixed by more revision. Repeating spaced repetition on a misconception reinforces the misconception. The student needs re-learning: new explanations, different angles, or foundational prerequisite concepts.

**Eventual interventions:**
- Surface the concept's study notes for re-reading
- Suggest related prerequisite concepts
- Flag for deeper AI-generated explanation
- Reduce SM-2 ease factor to increase exposure frequency

### 1.2 Memory Gap

**What it represents:**
The learner previously demonstrated understanding (got MCQs correct, or self-assessed "remembered") but later fails to recall or apply the concept. The knowledge was formed but did not consolidate into durable memory.

**What it does NOT represent:**
- Never having understood the concept (that is Concept Gap)
- Skipping revision because of disinterest (that is Revision Gap)
- Being confident but wrong (that is Calibration Gap)

**Why it matters:**
Memory gaps are the primary target of spaced repetition. Detecting them helps the system distinguish between "needs more review" and "needs re-teaching." The SM-2 engine already handles scheduling, but the diagnostic engine can detect systematic memory failures that SM-2's mechanical interval resets don't surface — for example, a concept that keeps decaying despite correct scheduling.

**Eventual interventions:**
- Tighten revision intervals for this concept
- Suggest memory hooks / mnemonics from notes
- Increase the concept's revision priority score
- Recommend active recall practice (not just passive review)

### 1.3 Calibration Gap

**What it represents:**
A mismatch between the learner's subjective confidence and their actual performance. Two variants:

- **Overconfidence:** High confidence (2-3) but incorrect answers. The learner *thinks* they know it but doesn't.
- **Underconfidence:** Low confidence (1) but correct answers. The learner knows more than they believe.

**What it does NOT represent:**
- Simply getting questions wrong (that could be Concept Gap or Memory Gap)
- Simply being unsure (uncertainty without performance data is not a gap)
- One-off lucky guesses or careless errors

**Why it matters:**
Overconfidence is dangerous for UPSC preparation because the student skips studying concepts they believe they've mastered. Underconfidence wastes study time on concepts already known. Calibration awareness helps the student allocate study time more effectively.

**Eventual interventions:**
- For overconfidence: flag that self-perceived mastery may be unreliable; suggest more MCQ testing
- For underconfidence: reassure the student; consider reducing revision frequency
- Show calibration feedback in the dashboard

### 1.4 Revision Gap

**What it represents:**
The learner is not engaging with the revision system. They skip recommended revisions, accumulate overdue concepts, or avoid revision entirely. This is a behavioral/engagement gap, not a knowledge gap.

**What it does NOT represent:**
- Forgetting because intervals are wrong (that is Memory Gap)
- Not understanding the concept (that is Concept Gap)
- Having nothing to revise (that is normal)

**Why it matters:**
A student who never revises will inevitably develop memory gaps. The revision gap is a *leading indicator* — it predicts future memory gaps before they manifest. Early detection allows the system to adjust (e.g., reduce daily revision load, highlight most critical concepts).

**Eventual interventions:**
- Reduce recommended daily revision count to reduce overwhelm
- Surface only the highest-priority concepts
- Highlight consequences: "3 concepts are becoming overdue"
- Track engagement patterns over time

---

## 2. Evidence Mapping Matrix

All evidence references the R1 `NormalizedEvidence` contract.

### Legend

- **Required:** Diagnosis cannot be made without at least one observation of this type
- **Supporting:** Strengthens confidence in the diagnosis when present
- **Weak:** Provides some signal but should not anchor a diagnosis alone
- **Never alone:** Must be combined with other evidence; dangerous to use in isolation

### 2.1 Concept Gap

| Evidence | Classification | How It's Used |
|---|---|---|
| `mcqCorrect = false` (repeated, same concept) | Required | Core signal — repeated failure suggests misunderstanding |
| `selectedAnswer` patterns (same wrong answer repeatedly) | Supporting | Choosing the same wrong option suggests a systematic misconception, not random guessing |
| `selfAssessment = "forgot"` after recent review | Supporting | "Forgot" immediately after studying may indicate never understanding rather than forgetting |
| `confidence = 3` + `mcqCorrect = false` | Supporting | Confidently wrong suggests a misconception, not a memory lapse |
| `previousInterval` resetting repeatedly (via SM-2 failures) | Supporting | Repeated SM-2 resets indicate the concept keeps failing despite re-exposure |
| Single `mcqCorrect = false` | **Never alone** | One wrong answer could be carelessness, bad question, or memory lapse |
| `selfAssessment = "partially"` | Weak | Ambiguous — could be memory or concept issue |

### 2.2 Memory Gap

| Evidence | Classification | How It's Used |
|---|---|---|
| `mcqCorrect = true` followed later by `mcqCorrect = false` (same concept) | Required | Previously correct → now wrong = knowledge decayed |
| `selfAssessment = "remembered"` followed later by `mcqCorrect = false` | Required (alternative) | Said they remembered, but MCQ proves otherwise |
| `selfAssessment = "forgot"` after a period where concept was previously known | Supporting | Explicit admission of forgetting |
| `newInterval` dropping (interval decreased from prior value) | Supporting | SM-2 interval shrinkage confirms retention failure |
| Time elapsed since last correct answer | Supporting | Longer gaps increase memory gap likelihood |
| Single `selfAssessment = "forgot"` on first encounter | **Never alone** | First encounter "forgot" is normal — no prior memory to lose |
| `mcqCorrect = false` without prior correct history | **Never alone** | Could be Concept Gap instead |

### 2.3 Calibration Gap

| Evidence | Classification | How It's Used |
|---|---|---|
| `confidence = 3` + `mcqCorrect = false` (repeated) | Required | Systematic overconfidence across multiple attempts |
| `confidence = 1` + `mcqCorrect = true` (repeated) | Required (alternative) | Systematic underconfidence |
| Calibration ratio across N events | Supporting | Aggregate confidence-vs-outcome across the concept or across all concepts |
| `confidence = 2` + `mcqCorrect = false` | Weak | Moderate confidence + wrong is ambiguous |
| Single high-confidence incorrect | **Never alone** | Could be a single bad question or careless error |
| `confidence = null` (legacy events) | Not usable | No confidence data — cannot assess calibration |

### 2.4 Revision Gap

| Evidence | Classification | How It's Used |
|---|---|---|
| Multiple `eventType = "skip"` on same concept | Required | Repeated skipping = avoidance |
| `skipCount` ≥ 3 (from mastery state) | Supporting | System already flagged as "repeated_skips" weak signal |
| No events for a concept that is overdue | Supporting | Absence of engagement with a due concept |
| `selfAssessment` events are rare relative to due concepts | Weak | Low revision completion rate |
| Single skip | **Never alone** | One skip could be a time constraint, not a pattern |
| `eventType = "skip"` after long absence | Supporting | Returns after a break but still skips |

---

## 3. Diagnostic Philosophy

### 3.1 Core Principle: Accumulation, Not Classification

A single observation is NEVER a diagnosis. Diagnoses emerge from the **accumulation and convergence** of multiple evidence signals over time.

```
One wrong answer ≠ Concept Gap
One "forgot" ≠ Memory Gap
One overconfident error ≠ Calibration Gap
One skip ≠ Revision Gap
```

Instead, the engine maintains a **running evidence weight** per diagnosis per concept. Each new observation adjusts the weight up or down.

### 3.2 Evidence Weighting Model

Each piece of evidence contributes a **signed weight** to one or more diagnoses. Positive weights increase diagnostic confidence; negative weights decrease it (counter-evidence).

```
For concept C, after observing event E:

  conceptGapWeight += weightContribution(E, "concept_gap")
  memoryGapWeight  += weightContribution(E, "memory_gap")
  calibrationWeight += weightContribution(E, "calibration_gap")
  revisionWeight   += weightContribution(E, "revision_gap")
```

**Example weight contributions for a single event:**

| Event | Concept Gap | Memory Gap | Calibration | Revision |
|---|---|---|---|---|
| MCQ incorrect, confidence=3, no prior correct | +0.3 | 0 | +0.2 | 0 |
| MCQ incorrect, had prior correct, confidence=2 | +0.1 | +0.3 | 0 | 0 |
| MCQ correct, confidence=1 | -0.1 | -0.1 | +0.2 (under) | 0 |
| selfAssessment="forgot", had prior correct | 0 | +0.3 | 0 | 0 |
| selfAssessment="remembered", later MCQ correct | -0.2 | -0.2 | 0 | 0 |
| skip | 0 | 0 | 0 | +0.2 |
| 3rd skip on same concept | 0 | 0 | 0 | +0.4 |

*These are illustrative. Exact weights will be tuned during R2.2 implementation.*

### 3.3 Temporal Decay

Evidence freshness matters. A wrong answer from 30 days ago is weaker evidence than one from yesterday.

**Principle:** Evidence contributions should decay over time so that stale observations do not dominate current diagnosis.

The specific decay function (exponential, linear, step) and its tuning parameters (half-life, floor value) are implementation details to be determined during R2 validation. The architecture requires only that:

- Recent evidence has more influence than old evidence
- Very old evidence retains a minimum floor influence (not zero)
- The decay parameters are configurable constants, not hardcoded into the engine logic

### 3.4 Minimum Evidence Threshold

No diagnosis is emitted until the accumulated weight exceeds a minimum threshold. This prevents premature diagnosis from sparse data.

```
Suggested thresholds (tunable):
  concept_gap:     0.5  (requires ~2-3 convergent signals)
  memory_gap:      0.5
  calibration_gap: 0.6  (higher bar — needs clear pattern)
  revision_gap:    0.4  (lower bar — behavioral, easier to detect)
```

### 3.5 Counter-Evidence

Positive events actively *reduce* diagnostic weights:

- MCQ correct on a concept with Concept Gap weight → reduces the weight
- Student revises a concept they'd been skipping → reduces Revision Gap weight
- Confidence aligns with outcome → reduces Calibration Gap weight

This means diagnoses naturally decay if the learner improves.

### 3.6 No LLM Involvement

All diagnostic reasoning is arithmetic over evidence weights. Deterministic. Testable. Reproducible. No LLM calls.

---

## 4. Multiple Diagnoses

### 4.1 Diagnoses Can Coexist

A concept can have multiple simultaneous diagnoses. This is expected and common:

| Combination | Example |
|---|---|
| Concept Gap + Calibration Gap | Student is confidently wrong — they have a misconception AND are overconfident about it |
| Memory Gap + Revision Gap | Student forgets a concept AND is skipping revisions — the skipping causes the forgetting |
| Concept Gap + Memory Gap | Rare — if both weights exceed threshold, it suggests the concept was never fully learned (concept) AND what partial understanding existed has decayed (memory) |

### 4.2 Memory Gap Eligibility

Memory Gap is only eligible if there is sufficient evidence that the concept was **previously learned**.

Evidence of prior learning includes:
- At least one `mcqCorrect = true` event in the concept's history
- At least one `selfAssessment = "remembered"` event

If no such evidence exists, Memory Gap should remain inactive regardless of its accumulated weight. The learner cannot have forgotten something they never demonstrably knew.

Once prior learning has been established, Memory Gap and Concept Gap can coexist independently — each driven by its own evidence accumulation.

### 4.3 Diagnosis Ranking

When multiple diagnoses exist, they should be ranked by weight. The highest-weight diagnosis is the **primary diagnosis** — the one most likely to benefit from targeted intervention.

---

## 5. Diagnosis Output Contract

```typescript
/**
 * A single diagnostic finding for one concept.
 */
interface ConceptDiagnosis {
  /** The concept being diagnosed. */
  conceptId: string;

  /** Diagnosis type. */
  type: "concept_gap" | "memory_gap" | "calibration_gap" | "revision_gap";

  /**
   * Diagnostic confidence (0.0–1.0).
   * Derived from accumulated evidence weight, normalized.
   * NOT a probability — it's a confidence-in-diagnosis score.
   */
  score: number;

  /**
   * Whether the accumulated weight exceeds the emission threshold.
   * Only diagnoses with active=true should be shown to users.
   */
  active: boolean;

  /**
   * For calibration_gap: which direction.
   * null for other diagnosis types.
   * Deferred — will be introduced after scoring engine validation.
   */
  // calibrationDirection: "overconfident" | "underconfident" | null;  // R2.5+

  /**
   * Evidence citations — the specific events that contributed
   * most to this diagnosis. For explainability (Task 6).
   * Ordered by contribution weight (highest first).
   * Capped at 5 citations to keep output bounded.
   */
  topEvidence: EvidenceCitation[];

  /**
   * Human-readable explanation of why this diagnosis was made.
   * Generated deterministically from the evidence pattern.
   */
  explanation: string;

  /** Timestamp of the most recent contributing event. */
  lastEvidenceAt: Date;
}

/**
 * A reference to a specific event that contributed to a diagnosis.
 */
interface EvidenceCitation {
  /** The event that contributed to this diagnosis. */
  eventId: string;

  /** When the event occurred. */
  timestamp: Date;

  /** What type of event. */
  eventType: EvidenceEventType;

  /** How much this event contributed to the diagnosis weight. */
  contributionWeight: number;

  /**
   * Short human-readable description of what this event showed.
   * Example: "MCQ incorrect with high confidence (3)"
   * Example: "Self-assessed 'forgot' after 6-day interval"
   */
  description: string;
}

/**
 * Complete diagnostic report for one concept.
 */
interface ConceptDiagnosticReport {
  conceptId: string;

  /** All four diagnoses, including inactive ones (for monitoring). */
  diagnoses: ConceptDiagnosis[];

  /** The highest-scoring active diagnosis, or null if none active. */
  primaryDiagnosis: ConceptDiagnosis | null;

  /** Total events analyzed for this concept. */
  evidenceCount: number;

  /** When this report was generated. */
  generatedAt: Date;
}
```

### Design Rationale

- **All four diagnoses always present** (even if inactive) — allows monitoring trends before they cross the threshold
- **`active` flag** separates "above threshold" from "tracked but not actionable yet"
- **`topEvidence`** provides the specific events that drove the diagnosis — essential for explainability
- **`explanation`** is deterministic text, not LLM-generated
- **`calibrationDirection`** distinguishes overconfident from underconfident — they require different interventions
- **Bounded citations (max 5)** — prevents output bloat while preserving explainability

---

## 6. Explainability Strategy

### 6.1 Principle: Every Diagnosis Answers "Why?"

The engine must never produce a diagnosis that cannot be justified by citing specific evidence. If asked "Why does the system think this?", the answer is always a list of concrete observations.

### 6.2 Explanation Templates

Each diagnosis type has a deterministic explanation template populated from evidence:

**Concept Gap:**
```
"You answered {incorrectCount} of {totalAttempts} MCQs incorrectly on this concept.
{IF selectedAnswer pattern} You selected option '{mostCommonWrong}' in {repeatCount} attempts, suggesting a specific misconception.
{IF confidence pattern} You were confident (level {avgConfidence}) despite incorrect answers, which suggests the issue is understanding rather than forgetting.
{IF no prior correct} You have not yet answered an MCQ correctly on this concept."
```

**Memory Gap:**
```
"You previously answered correctly on {correctDate} but got it wrong on {incorrectDate} ({daysBetween} days later).
{IF selfAssessment} You self-assessed as '{assessment}' during revision, confirming recall difficulty.
{IF interval dropped} Your review interval decreased from {prev}d to {new}d, indicating retention loss."
```

**Calibration Gap (overconfident):**
```
"In {overconfidentCount} of {totalWithConfidence} MCQ attempts, you reported high confidence (level {confidence}) but answered incorrectly.
Your calibration accuracy for this concept is {calibrationPct}%."
```

**Calibration Gap (underconfident):**
```
"In {underconfidentCount} of {totalWithConfidence} MCQ attempts, you reported low confidence (level 1 — 'guessing') but answered correctly.
You may know this concept better than you think."
```

**Revision Gap:**
```
"You have skipped revision for this concept {skipCount} times.
{IF overdue} This concept has been overdue for review for {overdueDays} days.
{IF no recent events} You have not engaged with this concept in {daysSinceLastEvent} days."
```

### 6.3 Evidence Trail

Every `EvidenceCitation` in the diagnosis output contains:
- The exact event ID (traceable to `revision_events`)
- A human-readable description of the observation
- The weight contribution to the diagnosis

This creates a complete audit trail from diagnosis back to raw evidence.

### 6.4 No Black Boxes

The entire diagnostic process is:
1. Retrieve chronological evidence for a concept
2. Apply deterministic weight contributions per event
3. Apply temporal decay
4. Sum weights per diagnosis type
5. Apply suppression rules
6. Emit diagnoses above threshold with top evidence citations

Every step is inspectable. No neural networks, no embeddings, no opaque scoring.

---

## 7. R2 Implementation Roadmap

### R2.2 — Feature Extraction Layer

**Goal:** Extract a compact set of meaningful learning features from raw normalized evidence.

**Scope:**
- `src/lib/diagnostic/feature.types.ts` — Feature contract (typed interface)
- `src/lib/diagnostic/feature.extractor.ts` — Pure function: `NormalizedEvidence[] → ConceptFeatures`
- Feature-to-diagnosis mapping documentation

**Pipeline:** `NormalizedEvidence[] → Feature Extraction → ConceptFeatures`

**No DB calls.** No API. No UI. Pure logic, fully testable.

### R2.3 — Diagnostic Scoring Engine

**Goal:** Implement the weight accumulation engine as a pure function.

**Scope:**
- `src/lib/diagnostic/diagnostic.types.ts` — Diagnostic output types from Section 5
- `src/lib/diagnostic/diagnostic.engine.ts` — Pure function: `ConceptFeatures → ConceptDiagnosticReport`
- Weight contribution table (tunable constants)
- Temporal decay function (parameters determined in validation)
- Memory Gap eligibility check
- Explanation template renderer

**Pipeline:** `ConceptFeatures → Diagnostic Engine → ConceptDiagnosticReport`

**No DB calls.** No API. No UI. Pure logic, fully testable.

### R2.3 — Diagnostic Validation

**Goal:** Validate the engine against realistic learning histories.

**Scope:**
- Unit tests with synthetic evidence sequences for each diagnosis type
- Edge cases: sparse evidence, legacy events, mixed diagnosis, counter-evidence recovery
- Threshold tuning based on test results
- Verify suppression rules

### R2.4 — Diagnostic API & Persistence

**Goal:** Wire the engine to the application.

**Scope:**
- `GET /api/diagnostic?conceptId=X` — run diagnosis for one concept
- `GET /api/diagnostic?action=overview` — run diagnosis for all concepts with evidence
- Decide whether to cache diagnostic reports or compute on-demand
- At UPSC-student scale (~100 concepts, ~2000 events), on-demand computation is likely sufficient

### R2.5 — Diagnostic UI

**Goal:** Surface diagnoses to the student.

**Scope:**
- Dashboard widget showing active diagnoses
- Per-concept diagnostic detail with evidence citations
- Calibration accuracy visualization
- Revision engagement indicators
- Design decisions about how much diagnostic detail to show

### R2.6 — R3 Handoff Preparation

**Goal:** Define the R3 Repair Session contract.

**Scope:**
- How diagnoses trigger specific repair actions
- What a "Repair Session" looks like for each diagnosis type
- Integration points with existing Practice / Revision / Notes features

---

## Appendix: Evidence Availability Summary

| Evidence Field | Available Since | Present In |
|---|---|---|
| `eventType` | Always | All events |
| `qualityRating` | Always | Non-skip events |
| `mcqCorrect` | Always | mcq_attempt events |
| `mcqQuestionIndex` | Always | mcq_attempt events |
| `questionId` | R1.2 | New mcq_attempt events |
| `selectedAnswer` | R1.2 | New mcq_attempt events |
| `correctAnswer` | R1.2 | New mcq_attempt events |
| `confidence` | R1.2 | New mcq_attempt events |
| `selfAssessment` | R1.3 | self_assessment events |
| `previousInterval` / `newInterval` | Always | Non-skip events |
| `previousEase` / `newEase` | Always | Non-skip events |
| `skipCount` | Always | skip events |
| `rawEventType` | R1.4 | All events (normalizer) |
