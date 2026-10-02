# ADR-004: R3 Repair Engine Contract

> **Status:** Proposed
> **Date:** 2026-08-05
> **Context:** Define the handoff contract between Diagnosis (R2) and Repair (R3). R3 should never inspect raw evidence, features, or scoring internals.
> **Scope:** Contract design only. No implementation.

---

## 1. Repair Philosophy

### 1.1 What Repair Is

A **repair session** is a targeted, time-bounded learning intervention that exists for one purpose: **to resolve a specific diagnosed learning problem.**

Repair is not:

| Activity | Purpose | When it applies |
|---|---|---|
| **Practice** | Apply knowledge to new problems. Build fluency. | The student understands the concept and wants to sharpen it. |
| **Revision** | Maintain existing knowledge through spaced retrieval. | The student learned the concept and needs to keep it in memory. |
| **Diagnosis** | Identify learning gaps from evidence patterns. | Before repair — to determine what is wrong. |
| **Repair** | Fix a specific identified gap. | After diagnosis — to resolve a known problem. |

### 1.2 Core Principles

1. **Repair is prescription, not exploration.** Every repair session exists because a diagnosis was made. The session target, strategy, and success criteria come from the diagnosis — they are not improvised.

2. **Repair is bounded.** A repair session has a clear objective and a defined completion state. It is not an open-ended study session.

3. **Repair is verifiable.** After a repair session, the system can determine whether the repair worked by observing new evidence against the original diagnosis.

4. **Different gaps require different strategies.** A Concept Gap cannot be repaired by revision. A Memory Gap cannot be repaired by re-reading notes. The repair strategy must match the diagnosis.

5. **Repair is a cycle.** Diagnose → Repair → Re-diagnose → Repeat (if needed) → Resolved.

---

## 2. Diagnosis → Repair Mapping

### 2.1 Concept Gap

**Repair objective:** Rebuild or correct the student's mental model of the concept.

**Strategy:**
- Present the concept from a different angle (alternative explanation)
- Surface prerequisite concepts that may be missing
- Use targeted MCQs that isolate the misconception
- Provide immediate explanation after each attempt
- Focus on *why* the correct answer is correct, not just *what* it is

**Success criteria:**
- Consecutive correct MCQ attempts on this concept (≥2)
- Correct answer selection changes from repeated wrong pattern to correct pattern
- Concept Gap score drops below activation threshold on next diagnosis

**What NOT to do:**
- Do not simply repeat the same notes — the student already read them and has a misconception
- Do not use spaced repetition mechanics — you cannot space-repeat a wrong understanding
- Do not show all four options; consider scaffolded questions first

---

### 2.2 Memory Gap

**Repair objective:** Re-consolidate knowledge that was previously learned but has decayed.

**Strategy:**
- Retrieval practice: prompt recall before showing any material
- Spaced retrieval bursts: multiple short recall attempts over a compressed timeframe
- Re-exposure to memory hooks and mnemonics from existing notes
- Active recall followed by immediate feedback
- Reset SM-2 interval for a fresh start if decay is severe

**Success criteria:**
- Successful recall (self-assessed "remembered" or correct MCQ) on the next 2 attempts
- `daysSinceLastSuccess` resets to 0
- Memory Gap score drops below activation threshold
- SM-2 interval begins increasing again (not decreasing)

**What NOT to do:**
- Do not re-teach the concept from scratch — the student understood it before
- Do not show notes passively — passive review does not build memory
- Do not ignore SM-2 — update intervals after repair events

---

### 2.3 Calibration Gap

**Repair objective:** Align the student's confidence with their actual performance.

**Strategy:**
- Present MCQs and ask for confidence *before* answering
- Show calibration feedback immediately: "You said confident, but the answer was wrong"
- Track calibration improvement across the repair session
- For overconfidence: emphasize that uncertainty is acceptable
- For underconfidence: highlight correct answers and build awareness of what they know

**Success criteria:**
- Confidence-outcome alignment improves (mismatch rate decreases)
- Student demonstrates appropriate confidence levels (high when correct, low when unsure)
- Calibration Gap score drops below activation threshold

**What NOT to do:**
- Do not penalize students for being honest about uncertainty
- Do not conflate calibration repair with concept repair — the student may understand the concept
- Do not remove confidence tracking — calibration awareness is the intervention itself

---

### 2.4 Revision Gap

**Repair objective:** Re-engage the student with the concept.

**Strategy:**
- Surface the concept in a low-friction review session
- Remind the student why this concept matters (exam relevance)
- Use a single quick recall prompt, not a full repair session
- Schedule a follow-up revision to establish engagement momentum
- If the student was avoiding due to difficulty, assess whether a Concept Gap should be diagnosed instead

**Success criteria:**
- Student completes at least one non-skip revision event
- Skip rate for this concept decreases
- `daysSinceLastEvent` resets to 0
- Revision Gap score drops below activation threshold

**What NOT to do:**
- Do not force lengthy sessions — the student is disengaged, not confused
- Do not generate guilt or urgency — calm re-engagement, not pressure
- Do not treat skipping as a knowledge problem — it is a behavioral pattern

---

## 3. Repair Request Contract

The Repair Request is the sole input to R3. It carries everything R3 needs to generate a repair session. R3 must never read raw evidence or diagnostic internals.

```typescript
interface RepairRequest {
  /** Unique request ID for tracking. */
  requestId: string;

  /** Student receiving the repair. */
  userId: string;

  /** Concept being repaired. */
  conceptId: string;

  /** The diagnosed gap being repaired. */
  diagnosis: {
    /** Diagnosis type. */
    type: DiagnosisType;

    /** Diagnosis score at time of request (0.0–1.0). */
    score: number;

    /**
     * Human-readable reasons this diagnosis was made.
     * From topContributions descriptions — already student-friendly.
     * R3 can display these to the student during repair.
     */
    reasons: string[];
  };

  /**
   * All active diagnoses for this concept, ordered by score.
   * Allows R3 to be aware of co-occurring gaps.
   * R3 repairs the primary diagnosis but should not contradict others.
   */
  coexistingDiagnoses: Array<{
    type: DiagnosisType;
    score: number;
  }>;

  /** Context R3 may need but should not have to compute. */
  context: {
    /** Total evidence events for this concept. */
    evidenceCount: number;

    /** Whether the student has ever demonstrated understanding. */
    hasSuccessHistory: boolean;

    /** Days since the student last engaged with this concept. */
    daysSinceLastEvent: number;

    /** Current MCQ accuracy (null if no MCQ data). */
    accuracy: number | null;
  };

  /** When this request was created. */
  createdAt: Date;
}
```

### Design Decisions

- **`reasons`** are pre-computed human-readable strings, not raw feature values. R3 never reverse-engineers diagnostics.
- **`coexistingDiagnoses`** lets R3 avoid contradictory strategies (e.g., don't re-teach a concept during a Memory Gap repair if no Concept Gap exists).
- **`context`** provides minimal situational data. R3 can use `hasSuccessHistory` to decide tone ("let's rebuild" vs. "let's refresh").
- **No raw features, no weights, no thresholds.** The contract is opaque to R2 internals.

---

## 4. Repair Session Contract

The Repair Session is what R3 produces. It defines a bounded learning intervention.

```typescript
interface RepairSession {
  /** Unique session ID. */
  sessionId: string;

  /** Links back to the originating request. */
  requestId: string;

  /** Student and concept. */
  userId: string;
  conceptId: string;

  /** What this session aims to fix. */
  objective: {
    /** The diagnosis being repaired. */
    diagnosisType: DiagnosisType;

    /** Human-readable goal shown to the student. */
    description: string;

    /**
     * Measurable success criteria.
     * Example: "Answer 2 consecutive MCQs correctly"
     * Example: "Successfully recall this concept from memory"
     */
    successCriteria: string;
  };

  /** The repair strategy selected for this diagnosis. */
  strategy: RepairStrategy;

  /**
   * Ordered list of activities in this session.
   * R3 generates these based on the strategy.
   */
  activities: RepairActivity[];

  /** Session metadata. */
  estimatedMinutes: number;
  createdAt: Date;

  /** Session lifecycle. */
  status: "pending" | "in_progress" | "completed" | "abandoned";
  completedAt: Date | null;

  /** Post-session outcome (filled after completion). */
  outcome: RepairOutcome | null;
}

/** Strategy type determines the session's pedagogical approach. */
type RepairStrategy =
  | "re_explain"           // Concept Gap: new angle on the concept
  | "targeted_mcq"         // Concept Gap: isolate the misconception
  | "retrieval_burst"      // Memory Gap: compressed recall practice
  | "spaced_recall"        // Memory Gap: immediate spaced retrieval
  | "calibration_drill"    // Calibration Gap: confidence-outcome feedback
  | "gentle_re_engagement" // Revision Gap: low-friction re-entry
  | "custom";              // Future / mixed

interface RepairActivity {
  /** Activity order (1-indexed). */
  order: number;

  /** Activity type. */
  type:
    | "read_explanation"    // Show concept explanation (different angle)
    | "recall_prompt"       // Ask student to recall before seeing answer
    | "mcq_attempt"         // Targeted MCQ with immediate feedback
    | "confidence_check"    // Ask confidence, then verify
    | "reflection"          // "Why do you think you got this wrong?"
    | "summary";            // Session summary with next steps

  /** Content for this activity. */
  content: {
    /** Main text/prompt shown to student. */
    prompt: string;

    /** Optional structured data (MCQ options, explanation text, etc). */
    data?: Record<string, unknown>;
  };

  /** Whether this activity was completed. */
  completed: boolean;

  /** Student's response to this activity (filled during session). */
  response?: Record<string, unknown>;
}

interface RepairOutcome {
  /** Did the student complete the session? */
  completed: boolean;

  /** Activities completed out of total. */
  activitiesCompleted: number;
  activitiesTotal: number;

  /**
   * Whether the repair appears successful based on session evidence.
   * This is a preliminary signal — full verification requires re-diagnosis.
   */
  appearSuccessful: boolean;

  /** Summary shown to the student. */
  summary: string;
}
```

### Design Decisions

- **`RepairStrategy`** is an enum, not free text. This ensures R3 follows defined pedagogical approaches and new strategies can be added explicitly.
- **`RepairActivity`** is generic enough for any activity type but structured enough to render consistently.
- **`RepairOutcome`** captures session-level results but defers real verification to re-diagnosis (R4).
- **`status`** tracks lifecycle without needing a separate state machine.

---

## 5. Repair Success Criteria (R4 Verification)

After a repair session completes, the system must determine whether the repair worked. This happens by re-running diagnosis and comparing scores.

### 5.1 Per-Diagnosis Verification

| Diagnosis | Success Evidence | Failure Evidence | Re-repair Trigger |
|---|---|---|---|
| **Concept Gap** | Consecutive correct MCQs (≥2). `hasRepeatedWrongAnswer` becomes false. CG score < activation threshold. | Continued incorrect answers. Same wrong answer pattern persists. CG score unchanged or increased. | CG score still ≥ activation threshold after 2+ new events post-repair. |
| **Memory Gap** | Successful recall. `daysSinceLastSuccess` resets. MG score < activation threshold. Interval starts increasing. | Failed recall. Interval continues decreasing. MG score unchanged. | MG score still ≥ activation threshold after 2+ new events post-repair. |
| **Calibration Gap** | Mismatch rate decreases. Confidence aligns with outcomes on next 3+ events. Cal score < activation threshold. | Mismatch rate unchanged. Persistent overconfidence or underconfidence. | Cal score still ≥ activation threshold after 3+ new events with confidence data. |
| **Revision Gap** | Non-skip engagement. `daysSinceLastEvent` resets. Skip rate decreases. RG score < activation threshold. | Continued skipping. No engagement within 7 days of repair. | RG score still ≥ activation threshold after next scheduled revision. |

### 5.2 Verification Process

```
Repair Session Completed
        ↓
Wait for N new evidence events (N depends on diagnosis type)
        ↓
Re-run diagnostic pipeline: Evidence → Features → Diagnose
        ↓
Compare new score to pre-repair score
        ↓
If score < activation threshold → Repair successful
If score unchanged or increased → Repair failed → Generate new RepairRequest
```

### 5.3 Verification Rules

- **Minimum new evidence:** Do not re-diagnose until the student has generated at least 2 new evidence events for the concept post-repair.
- **Grace period:** Allow 48 hours before declaring repair failure — the student may not have encountered the concept again yet.
- **Diminishing returns:** If 3 consecutive repair sessions for the same diagnosis fail, escalate the diagnosis severity and try a different repair strategy.
- **Cross-diagnosis:** A repair may inadvertently resolve a co-existing diagnosis (e.g., Concept Gap repair may also fix Calibration Gap). Check all diagnoses after repair.

---

## 6. Future Compatibility

The contract is designed to support future diagnosis types without structural changes:

| Future Diagnosis | How It Fits |
|---|---|
| **Application Gap** | New `DiagnosisType` value. New `RepairStrategy` entries (e.g., `"case_study"`, `"application_drill"`). Same `RepairRequest`/`RepairSession` structure. |
| **Mains Answer Writing** | New `DiagnosisType`. New `RepairActivity.type` entries (e.g., `"write_answer"`, `"structure_review"`). Same contract. |
| **Interview** | New `DiagnosisType`. New activity types for verbal/structured responses. Same contract. |
| **Essay** | New `DiagnosisType`. Writing-specific activities. Same contract. |

### Extensibility Points

- `DiagnosisType` — union type, add new string literal.
- `RepairStrategy` — union type, add new strategy string.
- `RepairActivity.type` — union type, add new activity type string.
- `RepairRequest.context` — add new optional fields for future diagnosis needs.
- `RepairOutcome` — future verification can add structured metrics.

No interface redesign required. The contract is additive.

---

## 7. R3 Implementation Roadmap

| Phase | Goal | Dependencies |
|---|---|---|
| **R3.1** | Implement `RepairRequest` builder (R2 report → RepairRequest) | R2.6 ✅ |
| **R3.2** | Implement Concept Gap repair strategy (re-explain + targeted MCQ) | R3.1, existing notes/MCQ system |
| **R3.3** | Implement Memory Gap repair strategy (retrieval burst) | R3.1, existing revision system |
| **R3.4** | Implement repair session UI (activity flow, progress, completion) | R3.2 or R3.3 |
| **R3.5** | Implement Calibration Gap repair strategy (confidence drill) | R3.1, existing MCQ confidence system |
| **R3.6** | Implement Revision Gap repair strategy (gentle re-engagement) | R3.1, existing revision system |
| **R3.7** | Implement Repair API (`POST /api/repair`, `GET /api/repair/:id`) | R3.2+ |
| **R4.1** | Implement repair verification (re-diagnosis after repair) | R3.7, R2 pipeline |
| **R4.2** | Implement repair cycle (failed repair → new request → retry) | R4.1 |

**Recommended first implementation:** Start with Concept Gap (R3.2) — it is the most impactful diagnosis and has the clearest repair strategy. Memory Gap (R3.3) follows naturally since it reuses the revision system.
