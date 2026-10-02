/**
 * Diagnostic Scoring Engine — R2.3
 *
 * Pure, deterministic function that converts ConceptFeatures
 * into a ConceptDiagnosticReport.
 *
 * Pipeline position:
 *   ConceptFeatures → diagnose() → ConceptDiagnosticReport
 *
 * Guarantees:
 * - Pure function: no side effects, no DB calls, no mutations
 * - Deterministic: same input always produces same output
 * - Configurable: all weights and thresholds are injectable
 * - Explainable: every diagnosis cites contributing features
 * - No LLM involvement
 *
 * @see diagnostic.types.ts for the output contract
 * @see feature.types.ts for the input contract
 * @see ADR-003 §3–§6
 */

import type { ConceptFeatures } from "./feature.types";
import type {
  ConceptDiagnosis,
  ConceptDiagnosticReport,
  DiagnosisType,
  FeatureContribution,
  ScoringConfig,
} from "./diagnostic.types";
import { ALL_DIAGNOSIS_TYPES } from "./diagnostic.types";

// ─── Default Configuration ──────────────────────────────────

/**
 * Default scoring configuration.
 * These values are starting points — intended to be tuned during
 * R2.4 validation against realistic learning histories.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: {
    conceptGap: {
      lowAccuracy: 0.35,
      lowRecentAccuracy: 0.25,
      consecutiveFailures: 0.10,
      repeatedWrongAnswer: 0.20,
      correctMcq: -0.15,
      selfReport: 0.10,            // R2 Enhancement: modest support from self-report
    },
    memoryGap: {
      daysSinceSuccess: 0.015,     // per day (e.g. 20 days → 0.30)
      intervalDecreasing: 0.25,
      lowRecallRate: 0.30,
      accuracyDecline: 0.20,
      recentCorrect: -0.20,
      selfReport: 0.10,
    },
    calibrationGap: {
      highMismatchRate: 0.40,
      perMismatchEvent: 0.08,
      alignedConfidence: -0.10,
      selfReport: 0.10,
    },
    revisionGap: {
      perSkip: 0.12,
      highSkipRate: 0.20,          // R2.4: reduced from 0.30 to prevent sparse-data dominance
      daysSinceEvent: 0.008,       // R2.4: reduced from 0.01 (per day, e.g. 14 days → 0.056)
      recentEngagement: -0.20,
      selfReport: 0.10,
    },
  },
  thresholds: {
    activation: {
      concept_gap: 0.40,
      memory_gap: 0.40,
      calibration_gap: 0.45,
      revision_gap: 0.35,
    },
    features: {
      lowAccuracyThreshold: 0.50,
      lowRecallThreshold: 0.50,
      highMismatchThreshold: 0.30,
      highSkipRateThreshold: 0.50,  // R2.4: raised from 0.40 — requires majority skips
      memoryStaleDays: 7,
      inactivityDays: 7,
      minMcqAttempts: 2,
      minConfidenceEvents: 2,
    },
  },
};

// ─── Public API ─────────────────────────────────────────────

/**
 * Run diagnostic scoring on a concept's extracted features.
 *
 * @param features - Extracted features for one concept (from R2.2).
 * @param now - Reference timestamp. Defaults to current time. Injectable for testing.
 * @param config - Scoring configuration. Defaults to DEFAULT_SCORING_CONFIG.
 * @returns Complete diagnostic report with all four diagnoses.
 */
export function diagnose(
  features: ConceptFeatures,
  now: Date = new Date(),
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ConceptDiagnosticReport {
  const diagnoses: ConceptDiagnosis[] = ALL_DIAGNOSIS_TYPES.map((type) => {
    const { score, contributions } = scoreForType(type, features, config);
    const threshold = config.thresholds.activation[type];
    const clampedScore = clamp(score, 0, 1);
    const active = clampedScore >= threshold;

    return {
      conceptId: features.conceptId,
      type,
      score: round(clampedScore),
      active,
      topContributions: topN(contributions, 5),
      explanation: buildExplanation(type, features, contributions, active),
    };
  });

  // Primary = highest-scoring active diagnosis
  const activeDiagnoses = diagnoses.filter((d) => d.active);
  const primaryDiagnosis = activeDiagnoses.length > 0
    ? activeDiagnoses.reduce((best, d) => d.score > best.score ? d : best)
    : null;

  return {
    conceptId: features.conceptId,
    diagnoses,
    primaryDiagnosis,
    evidenceCount: features.totalEvents,
    generatedAt: now,
  };
}

// ─── Scoring Per Diagnosis Type ─────────────────────────────

function scoreForType(
  type: DiagnosisType,
  f: ConceptFeatures,
  cfg: ScoringConfig
): { score: number; contributions: FeatureContribution[] } {
  switch (type) {
    case "concept_gap": return scoreConceptGap(f, cfg);
    case "memory_gap": return scoreMemoryGap(f, cfg);
    case "calibration_gap": return scoreCalibrationGap(f, cfg);
    case "revision_gap": return scoreRevisionGap(f, cfg);
  }
}

// ─── Concept Gap Scoring ────────────────────────────────────

function scoreConceptGap(
  f: ConceptFeatures,
  cfg: ScoringConfig
): { score: number; contributions: FeatureContribution[] } {
  const w = cfg.weights.conceptGap;
  const t = cfg.thresholds.features;
  const contributions: FeatureContribution[] = [];
  let score = 0;

  // Guard: need minimum MCQ attempts
  if (f.mcqAttemptCount < t.minMcqAttempts) {
    return { score: 0, contributions: [] };
  }

  // Low overall accuracy
  if (f.accuracy !== null && f.accuracy < t.lowAccuracyThreshold) {
    const weight = w.lowAccuracy;
    score += weight;
    const correctCount = Math.round(f.accuracy * f.mcqAttemptCount);
    contributions.push({
      featureName: "accuracy",
      featureValue: f.accuracy,
      contributionWeight: weight,
      description: `MCQ accuracy is ${pct(f.accuracy)} (${correctCount} of ${f.mcqAttemptCount} correct)`,
    });
  }

  // Low recent accuracy
  if (f.recentAccuracy !== null && f.recentAccuracy < t.lowAccuracyThreshold) {
    const weight = w.lowRecentAccuracy;
    score += weight;
    contributions.push({
      featureName: "recentAccuracy",
      featureValue: f.recentAccuracy,
      contributionWeight: weight,
      description: `Recent MCQ accuracy is ${pct(f.recentAccuracy)}`,
    });
  }

  // Consecutive failures
  if (f.consecutiveFailures >= 2) {
    const weight = w.consecutiveFailures * Math.min(f.consecutiveFailures, 5);
    score += weight;
    contributions.push({
      featureName: "consecutiveFailures",
      featureValue: f.consecutiveFailures,
      contributionWeight: weight,
      description: `${f.consecutiveFailures} consecutive MCQ failures`,
    });
  }

  // Repeated wrong answer pattern
  if (f.hasRepeatedWrongAnswer) {
    const weight = w.repeatedWrongAnswer;
    score += weight;
    contributions.push({
      featureName: "hasRepeatedWrongAnswer",
      featureValue: true,
      contributionWeight: weight,
      description: "Same wrong answer selected repeatedly — possible misconception",
    });
  }

  // Counter-evidence: if accuracy is decent, reduce score
  if (f.accuracy !== null && f.accuracy >= t.lowAccuracyThreshold) {
    const weight = w.correctMcq;
    score += weight;
    contributions.push({
      featureName: "accuracy",
      featureValue: f.accuracy,
      contributionWeight: weight,
      description: `MCQ accuracy is ${pct(f.accuracy)} — reducing Concept Gap`,
    });
  }

  // Student self-report: concept_understanding supports Concept Gap
  if (f.studentDifficulty === "concept_understanding") {
    const weight = w.selfReport;
    score += weight;
    contributions.push({
      featureName: "studentDifficulty",
      featureValue: f.studentDifficulty,
      contributionWeight: weight,
      description: "Student reported: \"I don't understand this concept\"",
    });
  }

  return { score: Math.max(0, score), contributions };
}

// ─── Memory Gap Scoring ─────────────────────────────────────

function scoreMemoryGap(
  f: ConceptFeatures,
  cfg: ScoringConfig
): { score: number; contributions: FeatureContribution[] } {
  const w = cfg.weights.memoryGap;
  const t = cfg.thresholds.features;
  const contributions: FeatureContribution[] = [];
  let score = 0;

  // Eligibility gate: must have prior demonstrated learning
  if (!f.hasSuccessHistory) {
    return { score: 0, contributions: [] };
  }

  // Days since last success
  if (f.daysSinceLastSuccess !== null && f.daysSinceLastSuccess > t.memoryStaleDays) {
    const staleDays = f.daysSinceLastSuccess - t.memoryStaleDays;
    const weight = w.daysSinceSuccess * Math.min(staleDays, 30);
    score += weight;
    contributions.push({
      featureName: "daysSinceLastSuccess",
      featureValue: f.daysSinceLastSuccess,
      contributionWeight: weight,
      description: `${Math.round(f.daysSinceLastSuccess)} days since last successful recall`,
    });
  }

  // Interval decreasing
  if (f.intervalDecreasing === true) {
    const weight = w.intervalDecreasing;
    score += weight;
    contributions.push({
      featureName: "intervalDecreasing",
      featureValue: true,
      contributionWeight: weight,
      description: "Review interval has decreased — retention loss detected",
    });
  }

  // Low recall success rate
  if (f.recallSuccessRate !== null && f.recallSuccessRate < t.lowRecallThreshold) {
    const weight = w.lowRecallRate;
    score += weight;
    contributions.push({
      featureName: "recallSuccessRate",
      featureValue: f.recallSuccessRate,
      contributionWeight: weight,
      description: `Revision recall success rate is ${pct(f.recallSuccessRate)}`,
    });
  }

  // Accuracy decline: recent worse than historical
  if (
    f.accuracy !== null &&
    f.recentAccuracy !== null &&
    f.recentAccuracy < f.accuracy - 0.15
  ) {
    const weight = w.accuracyDecline;
    score += weight;
    contributions.push({
      featureName: "recentAccuracy",
      featureValue: f.recentAccuracy,
      contributionWeight: weight,
      description: `Recent accuracy ${pct(f.recentAccuracy)} is below historical ${pct(f.accuracy)} — knowledge may be decaying`,
    });
  }

  // Counter-evidence: recent correct performance
  if (f.recentAccuracy !== null && f.recentAccuracy >= 0.75) {
    const weight = w.recentCorrect;
    score += weight;
    contributions.push({
      featureName: "recentAccuracy",
      featureValue: f.recentAccuracy,
      contributionWeight: weight,
      description: `Recent accuracy is ${pct(f.recentAccuracy)} — reducing Memory Gap`,
    });
  }

  // Student self-report: memory_retrieval supports Memory Gap
  if (f.studentDifficulty === "memory_retrieval") {
    const weight = w.selfReport;
    score += weight;
    contributions.push({
      featureName: "studentDifficulty",
      featureValue: f.studentDifficulty,
      contributionWeight: weight,
      description: "Student reported: \"I understand it but forget it\"",
    });
  }

  return { score: Math.max(0, score), contributions };
}

// ─── Calibration Gap Scoring ────────────────────────────────

function scoreCalibrationGap(
  f: ConceptFeatures,
  cfg: ScoringConfig
): { score: number; contributions: FeatureContribution[] } {
  const w = cfg.weights.calibrationGap;
  const t = cfg.thresholds.features;
  const contributions: FeatureContribution[] = [];
  let score = 0;

  // Guard: need minimum confidence events
  if (f.eventsWithConfidence < t.minConfidenceEvents) {
    return { score: 0, contributions: [] };
  }

  // High mismatch rate
  if (f.confidenceMismatchRate !== null && f.confidenceMismatchRate > t.highMismatchThreshold) {
    const weight = w.highMismatchRate;
    score += weight;
    contributions.push({
      featureName: "confidenceMismatchRate",
      featureValue: f.confidenceMismatchRate,
      contributionWeight: weight,
      description: `Confidence-outcome mismatch rate is ${pct(f.confidenceMismatchRate)}`,
    });
  }

  // Per miscalibrated event (accumulation)
  if (f.confidenceMismatchRate !== null && f.eventsWithConfidence > 0) {
    const mismatchCount = Math.round(f.confidenceMismatchRate * f.eventsWithConfidence);
    if (mismatchCount > 0) {
      const weight = w.perMismatchEvent * Math.min(mismatchCount, 5);
      score += weight;
      contributions.push({
        featureName: "eventsWithConfidence",
        featureValue: mismatchCount,
        contributionWeight: weight,
        description: `${mismatchCount} miscalibrated event${mismatchCount > 1 ? "s" : ""} out of ${f.eventsWithConfidence}`,
      });
    }
  }

  // Counter-evidence: low mismatch = well calibrated
  if (f.confidenceMismatchRate !== null && f.confidenceMismatchRate <= t.highMismatchThreshold) {
    const weight = w.alignedConfidence;
    score += weight;
    contributions.push({
      featureName: "confidenceMismatchRate",
      featureValue: f.confidenceMismatchRate,
      contributionWeight: weight,
      description: `Confidence is well-calibrated (${pct(f.confidenceMismatchRate)} mismatch) — reducing Calibration Gap`,
    });
  }

  // Student self-report: question_performance weakly supports Calibration Gap
  // Note: "I make mistakes in questions" does NOT automatically mean Calibration Gap.
  // Calibration evidence remains authoritative. Self-report is a weak signal here.
  if (f.studentDifficulty === "question_performance") {
    const weight = w.selfReport;
    score += weight;
    contributions.push({
      featureName: "studentDifficulty",
      featureValue: f.studentDifficulty,
      contributionWeight: weight,
      description: "Student reported: \"I make mistakes in questions\"",
    });
  }

  return { score: Math.max(0, score), contributions };
}

// ─── Revision Gap Scoring ───────────────────────────────────

function scoreRevisionGap(
  f: ConceptFeatures,
  cfg: ScoringConfig
): { score: number; contributions: FeatureContribution[] } {
  const w = cfg.weights.revisionGap;
  const t = cfg.thresholds.features;
  const contributions: FeatureContribution[] = [];
  let score = 0;

  // Per skip event (accumulation)
  if (f.skipCount > 0) {
    const weight = w.perSkip * Math.min(f.skipCount, 5);
    score += weight;
    contributions.push({
      featureName: "skipCount",
      featureValue: f.skipCount,
      contributionWeight: weight,
      description: `Skipped revision ${f.skipCount} time${f.skipCount > 1 ? "s" : ""}`,
    });
  }

  // High skip rate
  if (f.skipRate !== null && f.skipRate > t.highSkipRateThreshold) {
    const weight = w.highSkipRate;
    score += weight;
    contributions.push({
      featureName: "skipRate",
      featureValue: f.skipRate,
      contributionWeight: weight,
      description: `Skip rate is ${pct(f.skipRate)} of revision sessions`,
    });
  }

  // Days since last event (inactivity)
  if (f.daysSinceLastEvent > t.inactivityDays) {
    const inactiveDays = f.daysSinceLastEvent - t.inactivityDays;
    const weight = w.daysSinceEvent * Math.min(inactiveDays, 30);
    score += weight;
    contributions.push({
      featureName: "daysSinceLastEvent",
      featureValue: f.daysSinceLastEvent,
      contributionWeight: weight,
      description: `No engagement for ${Math.round(f.daysSinceLastEvent)} days`,
    });
  }

  // Counter-evidence: recent engagement
  if (f.daysSinceLastEvent <= 3 && (f.revisionAttemptCount > 0 || f.mcqAttemptCount > 0)) {
    const weight = w.recentEngagement;
    score += weight;
    contributions.push({
      featureName: "daysSinceLastEvent",
      featureValue: f.daysSinceLastEvent,
      contributionWeight: weight,
      description: "Recently engaged with this concept — reducing Revision Gap",
    });
  }

  // Student self-report: revision_need supports Revision Gap
  if (f.studentDifficulty === "revision_need") {
    const weight = w.selfReport;
    score += weight;
    contributions.push({
      featureName: "studentDifficulty",
      featureValue: f.studentDifficulty,
      contributionWeight: weight,
      description: "Student reported: \"I haven't revised this enough\"",
    });
  }

  return { score: Math.max(0, score), contributions };
}

// ─── Explanation Builder ────────────────────────────────────

function buildExplanation(
  type: DiagnosisType,
  f: ConceptFeatures,
  contributions: FeatureContribution[],
  active: boolean
): string {
  if (contributions.length === 0) {
    return insufficientDataExplanation(type, f);
  }

  if (!active) {
    const positiveContribs = contributions.filter((c) => c.contributionWeight > 0);
    if (positiveContribs.length === 0) {
      return `No ${formatType(type)} signals detected.`;
    }
    return `Some ${formatType(type)} signals detected but below threshold: ${positiveContribs.map((c) => c.description).join(". ")}.`;
  }

  // Active diagnosis — build full explanation
  const positiveContribs = contributions
    .filter((c) => c.contributionWeight > 0)
    .sort((a, b) => b.contributionWeight - a.contributionWeight);

  const sentences = positiveContribs.map((c) => c.description);
  return sentences.join(". ") + ".";
}

function insufficientDataExplanation(type: DiagnosisType, f: ConceptFeatures): string {
  switch (type) {
    case "concept_gap":
      return f.mcqAttemptCount === 0
        ? "No MCQ attempts yet — cannot assess concept understanding."
        : `Only ${f.mcqAttemptCount} MCQ attempt${f.mcqAttemptCount > 1 ? "s" : ""} — need more data.`;
    case "memory_gap":
      return !f.hasSuccessHistory
        ? "No prior successful recall — Memory Gap requires evidence of previous learning."
        : "Insufficient evidence to assess memory retention.";
    case "calibration_gap":
      return f.eventsWithConfidence === 0
        ? "No confidence data available — cannot assess calibration."
        : `Only ${f.eventsWithConfidence} event${f.eventsWithConfidence > 1 ? "s" : ""} with confidence data — need more.`;
    case "revision_gap":
      return "No revision engagement data available.";
  }
}

function formatType(type: DiagnosisType): string {
  switch (type) {
    case "concept_gap": return "Concept Gap";
    case "memory_gap": return "Memory Gap";
    case "calibration_gap": return "Calibration Gap";
    case "revision_gap": return "Revision Gap";
  }
}

// ─── Utilities ──────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Return the top N contributions by absolute weight, sorted descending.
 */
function topN(contributions: FeatureContribution[], n: number): FeatureContribution[] {
  return [...contributions]
    .sort((a, b) => Math.abs(b.contributionWeight) - Math.abs(a.contributionWeight))
    .slice(0, n);
}
