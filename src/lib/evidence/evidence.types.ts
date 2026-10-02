/**
 * R2 Evidence Contract — R1.4
 *
 * Typed interfaces that define the normalized evidence boundary
 * between the raw `revision_events` table and the future R2
 * Diagnostic Engine.
 *
 * This is a READ-ONLY normalization layer. It does NOT:
 * - Calculate diagnostic scores (Concept/Memory/Calibration Gap)
 * - Modify or write evidence
 * - Affect SM-2 quality derivation or mastery state
 *
 * All fields are optional where the underlying data may be absent
 * (legacy events, non-MCQ events, etc.).
 *
 * @see ADR-002-r1-evidence-architecture.md
 */

/**
 * Type-only import. Erased at compile time, so this does NOT create a
 * runtime dependency from the evidence layer onto the repair layer
 * (repair-request.builder.ts type-imports FailureReason from this file).
 */
import type { RepairIntent } from "@/lib/repair/repair-request.builder";

// ─── Event Types ────────────────────────────────────────────

/**
 * Canonical event types produced by the R1 evidence pipeline.
 * Each event type has a distinct evidence shape.
 */
export type EvidenceEventType =
  | "mcq_attempt"       // R1.2: MCQ answer with correctness + confidence
  | "self_assessment"   // R1.3: Revision recall self-report
  | "skip"              // R1.3: Revision skip
  | "review"            // Legacy/future: generic review event
  | "initialize"        // System: mastery initialization (no evidence)
  | "self_report"       // R2 Enhancement: student difficulty self-report
  | "repair_verification" // R3.3: outcome of a repair's verification MCQ
  | "repair_understanding" // R3.3: student's own post-repair understanding report
  | "unknown";          // Unrecognized — preserves evidence integrity for R2

/**
 * Raw self-assessment values from R1.3 revision workflow.
 * Mapped to SM-2 quality: remembered→4, partially→3, forgot→1.
 */
export type SelfAssessmentValue = "remembered" | "partially" | "forgot";

/**
 * Student self-reported difficulty perception.
 * R2 Enhancement: student-facing descriptions mapped to internal values.
 * This is a supporting evidence signal, NOT an authoritative diagnosis.
 *
 * Student sees:
 *   "I don't understand the concept"      → concept_understanding
 *   "I understand it but forget it"        → memory_retrieval
 *   "I understand it but make mistakes"    → question_performance
 *   "I haven't revised it enough"          → revision_need
 *   "I'm not sure what's going wrong"      → uncertain
 */
export type StudentDifficulty =
  | "concept_understanding"
  | "memory_retrieval"
  | "question_performance"
  | "revision_need"
  | "uncertain";

/**
 * Student's authoritative self-reported reason for a wrong MCQ answer.
 * Captured immediately after the student sees their incorrect result.
 *
 * This is the PRIMARY cause signal — R3 will consume this directly.
 * It is NOT automatically mapped to the old 4-gap taxonomy.
 *
 * Student sees:
 *   "I didn't understand the concept"         → concept_not_understood
 *   "I knew it, but couldn't recall it"        → could_not_recall
 *   "I misunderstood the question/options"     → misunderstood_question
 *   "I wasn't sure and guessed"                → guessed
 *   "I was confident, but got it wrong"        → overconfident
 *   "I made a careless mistake"                → careless_mistake
 *   "I'm not sure"                             → not_sure
 */
export type FailureReason =
  | "concept_not_understood"
  | "could_not_recall"
  | "misunderstood_question"
  | "guessed"
  | "overconfident"
  | "careless_mistake"
  | "not_sure";

/**
 * How the student says they feel about the concept AFTER a repair was
 * delivered and its verification MCQ answered (R3.3).
 *
 * EXPLICITLY REPORTED BY THE STUDENT AND NEVER INFERRED. The system does
 * not derive this from the verification outcome, from MCQ accuracy, or from
 * any diagnostic computation — it is exactly what the student tapped.
 *
 * These are opaque categorical values, NOT grades: there is no ordering,
 * no numeric score, and no implied "better"/"worse". They are deliberately
 * kept separate from `confidence` (1-3, R1.2), `selfAssessment` (R1.3),
 * `studentDifficulty` (R2) and `failureReason` — each answers a different
 * question at a different moment, and none of them may be conflated.
 *
 * Student sees:
 *   "I understand it"                → understood
 *   "I'm somewhat unsure"            → somewhat_unsure
 *   "I still don't understand it"    → still_not_understood
 */
export type PostRepairUnderstanding =
  | "understood"
  | "somewhat_unsure"
  | "still_not_understood";

// ─── Normalized Evidence Record ─────────────────────────────

/**
 * A single normalized evidence record.
 *
 * This is the canonical shape R2 will consume. It combines
 * top-level `revision_events` columns with extracted JSONB
 * `eventMetadata` fields into a flat, typed interface.
 *
 * Legacy events (pre-R1.2/R1.3) will have many optional fields
 * as undefined — R2 must handle missing fields gracefully.
 */
export interface NormalizedEvidence {
  // ─── Identity ────────────────────────────────────────
  /** Event UUID from revision_events.id */
  eventId: string;
  /** User UUID */
  userId: string;
  /** Concept UUID */
  conceptId: string;
  /** Event timestamp */
  timestamp: Date;

  // ─── Event Classification ────────────────────────────
  /**
   * Canonical event type. Set to "unknown" when the raw value
   * is not a recognized type — R2 should inspect rawEventType.
   */
  eventType: EvidenceEventType;
  /**
   * Original event type string from revision_events.event_type.
   * Always preserved verbatim. Useful when eventType is "unknown".
   */
  rawEventType: string;

  // ─── SM-2 Derived Values ─────────────────────────────
  /** SM-2 quality rating (0-5). Null for skip events. */
  qualityRating: number | null;

  // ─── MCQ Evidence (R1.2) ─────────────────────────────
  /** Whether the MCQ answer was correct. Only for mcq_attempt. */
  mcqCorrect: boolean | null;
  /** Array index of the question in the concept's MCQ set. */
  mcqQuestionIndex: number | null;
  /**
   * Stable question UUID from MCQ JSONB (R1.2).
   * Null for legacy events or non-MCQ events.
   * Allows exact-question history tracking across sessions.
   */
  questionId: string | null;
  /** Selected answer option ("a"/"b"/"c"/"d"). R1.2 MCQ evidence. */
  selectedAnswer: string | null;
  /** Correct answer option ("a"/"b"/"c"/"d"). R1.2 MCQ evidence. */
  correctAnswer: string | null;
  /**
   * Learner-reported confidence (1-3).
   * For correct MCQ attempts: captured AFTER outcome is shown.
   *   1 = It was a guess
   *   2 = I was somewhat confident
   *   3 = I was confident
   * R1.2 MCQ evidence. Does NOT affect SM-2.
   */
  confidence: number | null;

  // ─── Revision Evidence (R1.3) ────────────────────────
  /**
   * Raw revision self-assessment.
   * "remembered" | "partially" | "forgot"
   * Stored separately from the derived qualityRating.
   * R1.3 evidence. Only for self_assessment events.
   */
  selfAssessment: SelfAssessmentValue | null;

  // ─── Student Self-Report (R2 Enhancement) ────────────
  /**
   * Student's perception of what feels difficult about this concept.
   * A supporting evidence signal, NOT an authoritative diagnosis.
   * Stored in eventMetadata, extracted during normalization.
   */
  studentDifficulty: StudentDifficulty | null;

  // ─── Failure Reason (Post-R2 Architecture) ───────────
  /**
   * Student's authoritative self-reported reason for a wrong MCQ answer.
   * Captured AFTER the student sees their incorrect result.
   * This is the primary cause signal — R3 will consume this directly.
   * null for correct attempts, non-MCQ events, and legacy events.
   */
  failureReason: FailureReason | null;

  // ─── Repair Verification (R3.3) ──────────────────────
  // These three are declared OPTIONAL for backward compatibility: evidence
  // records constructed before R3.3 remain valid `NormalizedEvidence`.
  // `normalizeEvent()` always populates them, so anything read through the
  // normalizer carries a concrete value (never undefined).
  /**
   * The R3.1 requestId of the repair intervention this event verifies.
   * Correlates a repair_verification event back to the repair that
   * produced it. null for every other event type.
   */
  repairRequestId?: string | null;
  /**
   * The repair intent that was executed and is being verified.
   * Derived server-side from the student's failureReason via the R3.1
   * mapping — never client-supplied. null for every other event type.
   */
  repairIntent?: RepairIntent | null;
  /**
   * Whether the student answered the post-repair verification MCQ correctly.
   * This is evidence about whether the repair worked — it is NOT an MCQ
   * outcome and never reaches SM-2. null for every other event type.
   */
  verificationCorrect?: boolean | null;

  // ─── Post-Repair Understanding (R3.3) ────────────────
  /**
   * The student's own report of how they feel about the concept after the
   * repair and its verification MCQ.
   *
   * EXPLICITLY REPORTED BY THE STUDENT AND NEVER INFERRED — it is not
   * derived from `verificationCorrect`, `mcqCorrect`, or any score. It is a
   * raw fact about what the student said, carrying no resolution verdict.
   *
   * Optional for backward compatibility (pre-R3.3 evidence records remain
   * valid `NormalizedEvidence`); `normalizeEvent()` always populates it.
   * null for every event type other than repair_understanding.
   */
  postRepairUnderstanding?: PostRepairUnderstanding | null;

  // ─── Mastery Transition Metadata ─────────────────────
  /** Interval before this event (days). */
  previousInterval: number | null;
  /** Interval after this event (days). */
  newInterval: number | null;
  /** Ease factor before this event. */
  previousEase: number | null;
  /** Ease factor after this event. */
  newEase: number | null;

  // ─── Skip Metadata ──────────────────────────────────
  /** Cumulative skip count at time of this skip event. */
  skipCount: number | null;
}

// ─── Evidence Query Parameters ──────────────────────────────

/**
 * Parameters for retrieving evidence history.
 * Used by the evidence repository methods.
 */
export interface EvidenceQueryParams {
  userId: string;
  /** If provided, filter to this concept only. */
  conceptId?: string;
  /** Maximum number of events to return. Default: 100. */
  limit?: number;
  /** Filter to specific event types. */
  eventTypes?: EvidenceEventType[];
}

// ─── Evidence Sequence Types ────────────────────────────────

/**
 * A chronologically ordered sequence of evidence for one concept.
 * This is the primary input shape for R2 diagnostic analysis.
 */
export interface ConceptEvidenceSequence {
  conceptId: string;
  /** Events in chronological order (oldest first). */
  events: NormalizedEvidence[];
  /** Total event count (may exceed events.length if limited). */
  totalCount: number;
}
