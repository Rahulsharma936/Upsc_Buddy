/**
 * Spaced Repetition Engine — Phase 3C.
 *
 * Modified SM-2 algorithm adapted for UPSC preparation.
 *
 * SM-2 quality ratings:
 *   0 — Complete blackout
 *   1 — Incorrect, recognized after reveal
 *   2 — Incorrect, but concept was familiar
 *   3 — Correct with significant difficulty
 *   4 — Correct with some hesitation
 *   5 — Perfect recall
 *
 * Modifications for UPSC:
 * - Longer initial intervals (UPSC prep is months-long)
 * - Slower ease decay (concepts need sustained retention)
 * - Mastery level classification
 * - Weak area detection
 *
 * This is a PURE FUNCTION engine — no side effects, no DB calls.
 */

// ─── Types ──────────────────────────────────────────────────

export interface MasteryState {
  easeFactor: number;
  intervalDays: number;
  repetitionCount: number;
  masteryLevel: "unseen" | "learning" | "reviewing" | "mastered";
  confidenceScore: number;
  correctCount: number;
  incorrectCount: number;
  skipCount: number;
  isWeakArea: boolean;
  weakSignals: string[];
}

export interface SchedulingResult {
  nextState: MasteryState;
  nextReviewAt: Date;
  intervalDays: number;
}

// ─── Constants ──────────────────────────────────────────────

/** Minimum ease factor (SM-2 default floor). */
const MIN_EASE_FACTOR = 1.3;

/** Maximum interval in days (cap to prevent concepts vanishing). */
const MAX_INTERVAL_DAYS = 90;

/** Quality threshold: below this, the concept is "failed". */
const PASS_THRESHOLD = 3;

/** Weak area: if incorrect_rate exceeds this after N reviews. */
const WEAK_AREA_THRESHOLD = 0.5;
const WEAK_AREA_MIN_REVIEWS = 3;

/** Skip threshold for weak area flag. */
const SKIP_WEAK_THRESHOLD = 3;

// ─── Core SM-2 Engine ───────────────────────────────────────

/**
 * Calculate next spaced repetition state given a quality rating.
 *
 * @param current Current mastery state
 * @param quality SM-2 quality rating (0-5)
 * @returns New state + next review date
 */
export function calculateNextState(
  current: MasteryState,
  quality: number
): SchedulingResult {
  // Clamp quality
  const q = Math.max(0, Math.min(5, Math.round(quality)));

  let ef = current.easeFactor;
  let interval = current.intervalDays;
  let reps = current.repetitionCount;
  let correct = current.correctCount;
  let incorrect = current.incorrectCount;

  if (q >= PASS_THRESHOLD) {
    // ─── Successful recall ──────────────────────────────
    correct++;

    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 3; // Slightly longer than SM-2's 1→6 for UPSC
    } else {
      interval = Math.round(interval * ef);
    }

    reps++;

    // Update ease factor (SM-2 formula)
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  } else {
    // ─── Failed recall ──────────────────────────────────
    incorrect++;

    // Reset to learning
    reps = 0;
    interval = 1;

    // Decay ease factor more gently than SM-2
    ef = Math.max(MIN_EASE_FACTOR, ef - 0.15);
  }

  // Enforce bounds
  ef = Math.max(MIN_EASE_FACTOR, Math.round(ef * 100) / 100);
  interval = Math.min(interval, MAX_INTERVAL_DAYS);

  // Determine mastery level
  const masteryLevel = classifyMastery(reps, interval, ef, correct, incorrect);

  // Calculate confidence
  const totalAttempts = correct + incorrect;
  const confidenceScore = totalAttempts > 0
    ? Math.round((correct / totalAttempts) * 100) / 100
    : 0;

  // Weak area detection
  const weakSignals = detectWeakSignals(
    correct,
    incorrect,
    current.skipCount,
    reps,
    q
  );
  const isWeakArea = weakSignals.length > 0;

  // Next review date
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return {
    nextState: {
      easeFactor: ef,
      intervalDays: interval,
      repetitionCount: reps,
      masteryLevel,
      confidenceScore,
      correctCount: correct,
      incorrectCount: incorrect,
      skipCount: current.skipCount,
      isWeakArea,
      weakSignals,
    },
    nextReviewAt,
    intervalDays: interval,
  };
}

/**
 * Handle a skipped revision (user chose not to review).
 */
export function handleSkip(current: MasteryState): SchedulingResult {
  const skipCount = current.skipCount + 1;

  // Don't change interval, but push review back by 1 day
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + 1);

  const weakSignals = [...current.weakSignals];
  if (skipCount >= SKIP_WEAK_THRESHOLD && !weakSignals.includes("repeated_skips")) {
    weakSignals.push("repeated_skips");
  }

  return {
    nextState: {
      ...current,
      skipCount,
      isWeakArea: weakSignals.length > 0,
      weakSignals,
    },
    nextReviewAt,
    intervalDays: 1,
  };
}

/**
 * Initialize mastery state for a new concept.
 */
export function initializeMastery(): MasteryState {
  return {
    easeFactor: 2.5,
    intervalDays: 1,
    repetitionCount: 0,
    masteryLevel: "unseen",
    confidenceScore: 0,
    correctCount: 0,
    incorrectCount: 0,
    skipCount: 0,
    isWeakArea: false,
    weakSignals: [],
  };
}

// ─── Helpers ────────────────────────────────────────────────

function classifyMastery(
  reps: number,
  interval: number,
  ef: number,
  correct: number,
  incorrect: number
): MasteryState["masteryLevel"] {
  if (reps === 0) return correct + incorrect === 0 ? "unseen" : "learning";
  if (interval >= 21 && ef >= 2.0 && reps >= 4) return "mastered";
  if (reps >= 2) return "reviewing";
  return "learning";
}

function detectWeakSignals(
  correct: number,
  incorrect: number,
  skipCount: number,
  reps: number,
  lastQuality: number
): string[] {
  const signals: string[] = [];
  const total = correct + incorrect;

  // High error rate after sufficient reviews
  if (total >= WEAK_AREA_MIN_REVIEWS) {
    const errorRate = incorrect / total;
    if (errorRate >= WEAK_AREA_THRESHOLD) {
      signals.push("high_error_rate");
    }
  }

  // Repeated skips
  if (skipCount >= SKIP_WEAK_THRESHOLD) {
    signals.push("repeated_skips");
  }

  // Complete blackout (quality 0) after previous reviews
  if (lastQuality === 0 && reps > 0) {
    signals.push("complete_blackout");
  }

  // Repeated resets (has incorrect but low reps = keeps failing)
  if (incorrect >= 3 && reps <= 1) {
    signals.push("repeated_resets");
  }

  return signals;
}

// ─── Priority Scoring ───────────────────────────────────────

/**
 * Calculate revision priority score for a concept.
 * Higher = more urgent.
 *
 * Deterministic, explainable scoring.
 */
export function calculateRevisionPriority(params: {
  mastery: MasteryState;
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
  extractionConfidence: number;
  hasGSMapping: boolean;
  hasPYQMatch: boolean;
  relationshipCount: number;
}): {
  score: number;
  signals: Record<string, number>;
} {
  const now = Date.now();
  const signals: Record<string, number> = {};

  // Signal 1: Overdue factor (0-0.35)
  if (params.nextReviewAt) {
    const overdueMs = now - params.nextReviewAt.getTime();
    const overdueDays = overdueMs / (1000 * 60 * 60 * 24);
    if (overdueDays > 0) {
      // Logarithmic scaling — first few days matter most
      signals.overdue = Math.min(0.35, Math.log2(1 + overdueDays) * 0.07);
    } else {
      signals.overdue = 0;
    }
  } else {
    // Never scheduled — moderate urgency
    signals.overdue = 0.15;
  }

  // Signal 2: Weakness (0-0.25)
  signals.weakness = params.mastery.isWeakArea ? 0.25 : 0;

  // Signal 3: Low confidence (0-0.15)
  signals.lowConfidence = Math.max(0, (1 - params.mastery.confidenceScore) * 0.15);

  // Signal 4: UPSC importance (0-0.15)
  let importance = 0;
  if (params.hasGSMapping) importance += 0.05;
  if (params.hasPYQMatch) importance += 0.05;
  if (params.extractionConfidence >= 0.7) importance += 0.05;
  signals.importance = importance;

  // Signal 5: Connectivity bonus (0-0.10)
  signals.connectivity = Math.min(0.10, params.relationshipCount * 0.02);

  // Total
  const score = Object.values(signals).reduce((sum, v) => sum + v, 0);

  return {
    score: Math.round(Math.min(score, 1.0) * 100) / 100,
    signals,
  };
}

/**
 * Estimate forgetting probability based on time elapsed and interval.
 * Uses exponential decay model.
 */
export function estimateForgettingProbability(
  lastReviewedAt: Date | null,
  intervalDays: number,
  easeFactor: number
): number {
  if (!lastReviewedAt) return 0.5; // Unknown — moderate probability

  const elapsedMs = Date.now() - lastReviewedAt.getTime();
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  // Exponential decay: P(forget) increases as elapsed > interval
  const ratio = elapsedDays / Math.max(intervalDays, 1);
  const decayRate = 1 / easeFactor; // Higher ease = slower decay

  const probability = 1 - Math.exp(-decayRate * Math.max(0, ratio - 0.5));

  return Math.round(Math.max(0, Math.min(1, probability)) * 100) / 100;
}
