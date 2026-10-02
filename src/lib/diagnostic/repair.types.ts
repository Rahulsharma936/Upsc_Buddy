/**
 * Repair Contract Types — R2.7 / R3
 *
 * Defines the handoff contract between Diagnosis (R2) and Repair (R3).
 *
 * R3 consumes RepairRequest to generate RepairSession.
 * R3 must never inspect raw evidence, features, or scoring internals.
 * Everything R3 needs is in RepairRequest.
 *
 * Pipeline: ConceptDiagnosticReport → buildRepairRequest() → RepairRequest → R3
 *
 * @see ADR-004-r3-repair-engine-contract.md
 */

import type { DiagnosisType } from "./diagnostic.types";

// ─── Repair Request ─────────────────────────────────────────

/**
 * The sole input to R3.
 * Contains everything needed to generate a repair session.
 * Opaque to R2 internals — no features, no weights, no thresholds.
 */
export interface RepairRequest {
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
     * From topContributions — already student-friendly.
     */
    reasons: string[];
  };

  /**
   * All active diagnoses for this concept, ordered by score.
   * R3 repairs the primary but should not contradict co-existing gaps.
   */
  coexistingDiagnoses: Array<{
    type: DiagnosisType;
    score: number;
  }>;

  /** Situational context R3 may need. */
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

// ─── Repair Strategy ────────────────────────────────────────

/**
 * Pedagogical approach for the repair session.
 * Each strategy maps to a specific diagnosis type.
 */
export type RepairStrategy =
  | "re_explain"           // Concept Gap: new angle on the concept
  | "targeted_mcq"         // Concept Gap: isolate the misconception
  | "retrieval_burst"      // Memory Gap: compressed recall practice
  | "spaced_recall"        // Memory Gap: immediate spaced retrieval
  | "calibration_drill"    // Calibration Gap: confidence-outcome feedback
  | "gentle_re_engagement" // Revision Gap: low-friction re-entry
  | "custom";              // Future / mixed

// ─── Repair Activity ────────────────────────────────────────

/**
 * A single step within a repair session.
 */
export interface RepairActivity {
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

// ─── Repair Outcome ─────────────────────────────────────────

/**
 * Post-session result. Filled after the student completes (or abandons)
 * a repair session. Full verification requires re-diagnosis (R4).
 */
export interface RepairOutcome {
  /** Did the student complete the session? */
  completed: boolean;

  /** Activities completed out of total. */
  activitiesCompleted: number;
  activitiesTotal: number;

  /**
   * Preliminary success signal based on session evidence.
   * Real verification requires re-diagnosis.
   */
  appearSuccessful: boolean;

  /** Summary shown to the student. */
  summary: string;
}

// ─── Repair Session ─────────────────────────────────────────

/**
 * A bounded learning intervention produced by R3.
 * Contains everything needed to run and track a repair session.
 */
export interface RepairSession {
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
     */
    successCriteria: string;
  };

  /** The repair strategy selected for this diagnosis. */
  strategy: RepairStrategy;

  /** Ordered list of activities in this session. */
  activities: RepairActivity[];

  /** Estimated session duration. */
  estimatedMinutes: number;

  /** When this session was created. */
  createdAt: Date;

  /** Session lifecycle. */
  status: "pending" | "in_progress" | "completed" | "abandoned";
  completedAt: Date | null;

  /** Post-session outcome (filled after completion). */
  outcome: RepairOutcome | null;
}
