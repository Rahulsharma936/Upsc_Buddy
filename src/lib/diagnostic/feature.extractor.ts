/**
 * Feature Extractor — R2.2
 *
 * Pure function that transforms a chronological sequence of
 * NormalizedEvidence into a compact ConceptFeatures object.
 *
 * Pipeline position:
 *   NormalizedEvidence[] → extractFeatures() → ConceptFeatures
 *
 * Guarantees:
 * - Pure function: no side effects, no DB calls, no mutations
 * - Deterministic: same input always produces same output
 * - Handles legacy events gracefully (missing fields = null)
 * - No diagnostic scoring — that is R2.3's responsibility
 *
 * @see feature.types.ts for the output contract
 * @see evidence.types.ts for the input contract
 */

import type { NormalizedEvidence } from "@/lib/evidence/evidence.types";
import type { ConceptFeatures, FeatureExtractionConfig } from "./feature.types";
import { DEFAULT_FEATURE_CONFIG } from "./feature.types";

// ─── Helpers ────────────────────────────────────────────────

/** Calculate days between two dates (fractional). */
function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

/** Check if an event represents a successful learning demonstration. */
function isSuccessEvent(e: NormalizedEvidence): boolean {
  return (
    (e.eventType === "mcq_attempt" && e.mcqCorrect === true) ||
    (e.eventType === "self_assessment" && e.selfAssessment === "remembered")
  );
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Extract learning features from a chronological evidence sequence
 * for a single concept.
 *
 * @param events - Chronological (oldest-first) evidence for one concept.
 *                 All events MUST share the same conceptId.
 * @param now - Reference timestamp for "days since" calculations.
 *              Defaults to current time. Injectable for testing.
 * @param config - Feature extraction configuration.
 * @returns Computed features for the concept.
 */
export function extractFeatures(
  events: NormalizedEvidence[],
  now: Date = new Date(),
  config: FeatureExtractionConfig = DEFAULT_FEATURE_CONFIG
): ConceptFeatures {
  // ── Guard: empty sequence ──────────────────────────────
  if (events.length === 0) {
    return emptyFeatures("unknown");
  }

  const conceptId = events[0].conceptId;

  // ── Partition by event type ────────────────────────────
  const mcqEvents = events.filter((e) => e.eventType === "mcq_attempt");
  const revisionEvents = events.filter((e) => e.eventType === "self_assessment");
  const skipEvents = events.filter((e) => e.eventType === "skip");

  // ── Accuracy ───────────────────────────────────────────
  const mcqCorrectCount = mcqEvents.filter((e) => e.mcqCorrect === true).length;
  const accuracy = mcqEvents.length > 0 ? mcqCorrectCount / mcqEvents.length : null;

  // Recent accuracy: last N MCQ attempts
  const recentMcqs = mcqEvents.slice(-config.recentWindowSize);
  const recentCorrect = recentMcqs.filter((e) => e.mcqCorrect === true).length;
  const recentAccuracy = recentMcqs.length >= 2 ? recentCorrect / recentMcqs.length : null;

  // ── Prior learning evidence ────────────────────────────
  const successEvents = events.filter(isSuccessEvent);
  const hasSuccessHistory = successEvents.length > 0;

  let daysSinceLastSuccess: number | null = null;
  if (hasSuccessHistory) {
    const lastSuccess = successEvents[successEvents.length - 1];
    daysSinceLastSuccess = Math.round(daysBetween(lastSuccess.timestamp, now) * 100) / 100;
  }

  // ── Failure patterns ───────────────────────────────────
  // Consecutive failures: count backwards from most recent MCQ
  let consecutiveFailures = 0;
  for (let i = mcqEvents.length - 1; i >= 0; i--) {
    if (mcqEvents[i].mcqCorrect === false) {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  // Repeated wrong answer pattern
  const incorrectWithAnswer = mcqEvents.filter(
    (e) => e.mcqCorrect === false && e.selectedAnswer !== null
  );
  let hasRepeatedWrongAnswer = false;
  if (incorrectWithAnswer.length >= 2) {
    const answerCounts = new Map<string, number>();
    for (const e of incorrectWithAnswer) {
      const ans = e.selectedAnswer!;
      answerCounts.set(ans, (answerCounts.get(ans) ?? 0) + 1);
    }
    const maxCount = Math.max(...answerCounts.values());
    hasRepeatedWrongAnswer = maxCount / incorrectWithAnswer.length >= 0.5;
  }

  // ── Mastery trajectory ─────────────────────────────────
  // Check the most recent non-skip event with interval data
  let intervalDecreasing: boolean | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.previousInterval !== null && e.newInterval !== null) {
      intervalDecreasing = e.newInterval < e.previousInterval;
      break;
    }
  }

  // ── Confidence vs performance ──────────────────────────
  const mcqsWithConfidence = mcqEvents.filter((e) => e.confidence !== null);
  let confidenceMismatchRate: number | null = null;
  if (mcqsWithConfidence.length > 0) {
    const mismatchCount = mcqsWithConfidence.filter((e) => {
      // Overconfident: confident (≥2) but wrong
      if (e.confidence! >= 2 && e.mcqCorrect === false) return true;
      // Underconfident: guessing (1) but right
      if (e.confidence === 1 && e.mcqCorrect === true) return true;
      return false;
    }).length;
    confidenceMismatchRate = mismatchCount / mcqsWithConfidence.length;
  }

  // ── Revision behavior ──────────────────────────────────
  const rememberedCount = revisionEvents.filter(
    (e) => e.selfAssessment === "remembered"
  ).length;
  const recallSuccessRate = revisionEvents.length > 0
    ? rememberedCount / revisionEvents.length
    : null;

  const totalRevisionEngagements = skipEvents.length + revisionEvents.length;
  const skipRate = totalRevisionEngagements > 0
    ? skipEvents.length / totalRevisionEngagements
    : null;

  // ── Temporal ───────────────────────────────────────────
  const lastEvent = events[events.length - 1];
  const daysSinceLastEvent = Math.round(daysBetween(lastEvent.timestamp, now) * 100) / 100;

  // ── Student self-report (R2 Enhancement) ────────────────
  // Use the most recent self-report for this concept.
  let studentDifficulty: ConceptFeatures["studentDifficulty"] = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].studentDifficulty !== null) {
      studentDifficulty = events[i].studentDifficulty;
      break;
    }
  }

  // ── Assemble ───────────────────────────────────────────
  return {
    conceptId,

    totalEvents: events.length,
    mcqAttemptCount: mcqEvents.length,
    revisionAttemptCount: revisionEvents.length,

    accuracy,
    recentAccuracy,

    hasSuccessHistory,
    daysSinceLastSuccess,

    consecutiveFailures,
    hasRepeatedWrongAnswer,

    intervalDecreasing,

    confidenceMismatchRate,
    eventsWithConfidence: mcqsWithConfidence.length,

    recallSuccessRate,
    skipCount: skipEvents.length,
    skipRate,

    studentDifficulty,

    daysSinceLastEvent,
    lastEventAt: lastEvent.timestamp,
  };
}

/**
 * Create an empty feature set for a concept with no evidence.
 * All features reflect "no data" state.
 */
function emptyFeatures(conceptId: string): ConceptFeatures {
  return {
    conceptId,
    totalEvents: 0,
    mcqAttemptCount: 0,
    revisionAttemptCount: 0,
    accuracy: null,
    recentAccuracy: null,
    hasSuccessHistory: false,
    daysSinceLastSuccess: null,
    consecutiveFailures: 0,
    hasRepeatedWrongAnswer: false,
    intervalDecreasing: null,
    confidenceMismatchRate: null,
    eventsWithConfidence: 0,
    recallSuccessRate: null,
    skipCount: 0,
    skipRate: null,
    studentDifficulty: null,
    daysSinceLastEvent: 0,
    lastEventAt: new Date(0),
  };
}
