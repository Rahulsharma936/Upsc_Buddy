/**
 * Diagnostic Types — R2.3
 *
 * Typed output contract for the Diagnostic Scoring Engine.
 * Based on ADR-003 §5 (Diagnosis Output Contract).
 *
 * Pipeline: ConceptFeatures → Diagnostic Engine → ConceptDiagnosticReport
 *
 * @see ADR-003-r2-diagnostic-engine.md §5
 */

// ─── Diagnosis Types ────────────────────────────────────────

/** The four diagnostic categories for R2. */
export type DiagnosisType =
  | "concept_gap"
  | "memory_gap"
  | "calibration_gap"
  | "revision_gap";

/** All diagnosis types in canonical order. */
export const ALL_DIAGNOSIS_TYPES: DiagnosisType[] = [
  "concept_gap",
  "memory_gap",
  "calibration_gap",
  "revision_gap",
];

// ─── Evidence Citation ──────────────────────────────────────

/**
 * A feature-level contribution to a diagnosis score.
 *
 * ADR-003 specified EvidenceCitation referencing raw event IDs.
 * Since the scoring engine operates on features (not raw events),
 * we cite feature contributions instead. The feature extractor
 * already traced features back to evidence.
 */
export interface FeatureContribution {
  /** Which feature contributed to this diagnosis. */
  featureName: string;

  /** The feature's value at time of scoring. */
  featureValue: string | number | boolean | null;

  /** How much this feature contributed to the diagnosis weight. */
  contributionWeight: number;

  /**
   * Short human-readable description of what this feature showed.
   * Example: "MCQ accuracy is 25% (1 of 4 correct)"
   * Example: "3 consecutive MCQ failures"
   */
  description: string;
}

// ─── Concept Diagnosis ──────────────────────────────────────

/**
 * A single diagnostic finding for one concept.
 */
export interface ConceptDiagnosis {
  /** The concept being diagnosed. */
  conceptId: string;

  /** Diagnosis type. */
  type: DiagnosisType;

  /**
   * Diagnostic confidence (0.0–1.0).
   * Derived from accumulated feature weights, clamped.
   * NOT a probability — it's a confidence-in-diagnosis score.
   */
  score: number;

  /**
   * Whether the accumulated weight exceeds the emission threshold.
   * Only diagnoses with active=true should be shown to users.
   */
  active: boolean;

  /**
   * Feature contributions — the features that contributed
   * most to this diagnosis. For explainability.
   * Ordered by |contributionWeight| (highest first).
   * Capped at 5 contributions to keep output bounded.
   */
  topContributions: FeatureContribution[];

  /**
   * Human-readable explanation of why this diagnosis was made.
   * Generated deterministically from the feature pattern.
   */
  explanation: string;
}

// ─── Concept Diagnostic Report ──────────────────────────────

/**
 * Complete diagnostic report for one concept.
 */
export interface ConceptDiagnosticReport {
  /** Concept UUID. */
  conceptId: string;

  /** All four diagnoses, including inactive ones (for monitoring). */
  diagnoses: ConceptDiagnosis[];

  /** The highest-scoring active diagnosis, or null if none active. */
  primaryDiagnosis: ConceptDiagnosis | null;

  /** Total events analyzed for this concept (from features). */
  evidenceCount: number;

  /** When this report was generated. */
  generatedAt: Date;
}

// ─── Scoring Configuration ──────────────────────────────────

/**
 * Configurable weights for the scoring engine.
 * Each weight controls how much a feature contributes to a diagnosis.
 * Positive = increases diagnosis score. Negative = counter-evidence.
 */
export interface ScoringWeights {
  conceptGap: {
    lowAccuracy: number;         // accuracy < threshold
    lowRecentAccuracy: number;   // recentAccuracy < threshold
    consecutiveFailures: number; // per consecutive failure
    repeatedWrongAnswer: number; // hasRepeatedWrongAnswer
    correctMcq: number;         // counter-evidence (negative)
    selfReport: number;          // R2 Enhancement: student self-report support
  };
  memoryGap: {
    daysSinceSuccess: number;    // per day since last success
    intervalDecreasing: number;  // interval shrinkage
    lowRecallRate: number;       // recallSuccessRate < threshold
    accuracyDecline: number;     // recentAccuracy < accuracy
    recentCorrect: number;       // counter-evidence (negative)
    selfReport: number;          // R2 Enhancement: student self-report support
  };
  calibrationGap: {
    highMismatchRate: number;    // confidenceMismatchRate > threshold
    perMismatchEvent: number;    // per miscalibrated event
    alignedConfidence: number;   // counter-evidence (negative)
    selfReport: number;          // R2 Enhancement: student self-report support
  };
  revisionGap: {
    perSkip: number;             // per skip event
    highSkipRate: number;        // skipRate > threshold
    daysSinceEvent: number;      // per day of inactivity
    recentEngagement: number;    // counter-evidence (negative)
    selfReport: number;          // R2 Enhancement: student self-report support
  };
}

/**
 * Configurable thresholds for the scoring engine.
 */
export interface ScoringThresholds {
  /** Minimum score to activate a diagnosis. */
  activation: {
    concept_gap: number;
    memory_gap: number;
    calibration_gap: number;
    revision_gap: number;
  };
  /** Feature thresholds for triggering weight contributions. */
  features: {
    /** Accuracy below this triggers Concept Gap weight. */
    lowAccuracyThreshold: number;
    /** Recall success rate below this triggers Memory Gap weight. */
    lowRecallThreshold: number;
    /** Mismatch rate above this triggers Calibration Gap weight. */
    highMismatchThreshold: number;
    /** Skip rate above this triggers Revision Gap weight. */
    highSkipRateThreshold: number;
    /** Days since success above this contributes to Memory Gap. */
    memoryStaleDays: number;
    /** Days since any event above this contributes to Revision Gap. */
    inactivityDays: number;
    /** Minimum MCQ attempts to score Concept Gap. */
    minMcqAttempts: number;
    /** Minimum events with confidence to score Calibration Gap. */
    minConfidenceEvents: number;
  };
}

/**
 * Complete scoring configuration.
 */
export interface ScoringConfig {
  weights: ScoringWeights;
  thresholds: ScoringThresholds;
}
