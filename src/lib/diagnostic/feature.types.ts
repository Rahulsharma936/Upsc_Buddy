/**
 * Diagnostic Feature Types — R2.2
 *
 * Defines the compact feature set extracted from raw normalized
 * evidence. The Diagnostic Engine (R2.3) will consume these
 * features — not raw events — to produce diagnostic reports.
 *
 * Pipeline: NormalizedEvidence[] → Feature Extraction → ConceptFeatures
 *           ConceptFeatures → Diagnostic Engine → ConceptDiagnosticReport
 *
 * Every feature is:
 * - Clearly defined (what it measures)
 * - Deterministically calculated (same input → same output)
 * - Independently testable
 * - Reusable by future diagnostic categories
 *
 * @see ADR-003-r2-diagnostic-engine.md
 */

import type { StudentDifficulty } from "@/lib/evidence/evidence.types";

// ─── Feature Set ────────────────────────────────────────────

/**
 * Complete feature set for one concept for one user.
 *
 * This is the sole input to the Diagnostic Scoring Engine.
 * All values are computed from the chronological evidence
 * sequence for a single concept.
 */
export interface ConceptFeatures {
  // ─── Identity ────────────────────────────────────────
  /** Concept UUID */
  conceptId: string;

  // ─── Volume ──────────────────────────────────────────
  /**
   * Total number of evidence events analyzed.
   * Needed to guard against premature diagnosis from sparse data.
   */
  totalEvents: number;

  /**
   * Number of MCQ attempt events (eventType = "mcq_attempt").
   */
  mcqAttemptCount: number;

  /**
   * Number of revision self-assessment events
   * (eventType = "self_assessment").
   */
  revisionAttemptCount: number;

  // ─── Accuracy ────────────────────────────────────────
  /**
   * Overall MCQ accuracy: correct / total MCQ attempts.
   * Range: 0.0–1.0. null if no MCQ attempts.
   *
   * Supports: Concept Gap (low = weak understanding).
   */
  accuracy: number | null;

  /**
   * Accuracy over the most recent N MCQ attempts only.
   * Captures current performance trend, not lifetime average.
   * null if fewer than 2 MCQ attempts.
   *
   * Supports: Concept Gap, Memory Gap (decline from historical).
   */
  recentAccuracy: number | null;

  // ─── Prior Learning Evidence ─────────────────────────
  /**
   * Whether the learner has EVER demonstrated understanding.
   * true if any mcqCorrect=true OR selfAssessment="remembered".
   *
   * Critical for Memory Gap eligibility — you cannot forget
   * what you never demonstrably knew.
   */
  hasSuccessHistory: boolean;

  /**
   * Number of days since the most recent successful event.
   * "Successful" = mcqCorrect=true OR selfAssessment="remembered".
   * null if hasSuccessHistory is false.
   *
   * Supports: Memory Gap (larger gap = more decay likelihood).
   */
  daysSinceLastSuccess: number | null;

  // ─── Failure Patterns ────────────────────────────────
  /**
   * Current streak of consecutive MCQ failures.
   * Resets to 0 on any correct MCQ. Counts only mcq_attempt events.
   *
   * Supports: Concept Gap (long streak = persistent misunderstanding).
   */
  consecutiveFailures: number;

  /**
   * Whether the same wrong answer option appears in ≥50% of
   * incorrect MCQ attempts (when selectedAnswer is available).
   * Indicates a systematic misconception, not random guessing.
   *
   * Supports: Concept Gap.
   */
  hasRepeatedWrongAnswer: boolean;

  // ─── Mastery Trajectory ──────────────────────────────
  /**
   * Whether SM-2 intervals have been shrinking recently.
   * true if the most recent newInterval < previousInterval
   * for a non-skip event. null if no interval transition data.
   *
   * Supports: Memory Gap (interval shrinkage = retention failure).
   */
  intervalDecreasing: boolean | null;

  // ─── Confidence vs Performance ───────────────────────
  /**
   * Rate of "miscalibrated" MCQ attempts: events where
   * confidence does not match outcome.
   *
   * Miscalibrated = (confidence ≥ 2 AND incorrect)
   *              OR (confidence = 1 AND correct).
   *
   * Range: 0.0–1.0. null if no events have confidence data.
   *
   * Supports: Calibration Gap.
   */
  confidenceMismatchRate: number | null;

  /**
   * Number of MCQ events that have confidence data.
   * Needed to assess statistical significance of calibration features.
   */
  eventsWithConfidence: number;

  // ─── Revision Behavior ───────────────────────────────
  /**
   * Revision self-assessment success rate.
   * Proportion of self_assessment events where the learner
   * chose "remembered" (vs "partially" or "forgot").
   * Range: 0.0–1.0. null if no revision events.
   *
   * Supports: Memory Gap (low recall = decay).
   */
  recallSuccessRate: number | null;

  /**
   * Number of skip events for this concept.
   *
   * Supports: Revision Gap.
   */
  skipCount: number;

  /**
   * Skip rate: skips / (skips + revision attempts).
   * Range: 0.0–1.0. null if no revision engagement at all.
   *
   * Supports: Revision Gap (high skip rate = avoidance).
   */
  skipRate: number | null;

  // ─── Student Self-Report (R2 Enhancement) ─────────────
  /**
   * Most recent student self-reported difficulty for this concept.
   * null if the student has never provided a self-report.
   *
   * This is a supporting signal only — the engine uses it to
   * modestly support or contextualize diagnoses, never to
   * override behavioral evidence.
   */
  studentDifficulty: StudentDifficulty | null;

  // ─── Temporal ────────────────────────────────────────
  /**
   * Days since the most recent event of any type for this concept.
   * 0 if the most recent event is today.
   *
   * Supports: Revision Gap (large gap = disengagement).
   */
  daysSinceLastEvent: number;

  /**
   * Timestamp of the most recent event.
   * Used for temporal decay in the scoring engine.
   */
  lastEventAt: Date;
}

// ─── Feature Extraction Config ──────────────────────────────

/**
 * Configuration for feature extraction.
 * Allows tuning without changing code.
 */
export interface FeatureExtractionConfig {
  /**
   * Number of most recent MCQ attempts used for recentAccuracy.
   * Default: 5.
   */
  recentWindowSize: number;
}

/** Default feature extraction configuration. */
export const DEFAULT_FEATURE_CONFIG: FeatureExtractionConfig = {
  recentWindowSize: 5,
};
