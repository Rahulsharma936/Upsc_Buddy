/**
 * Question Surfacing Engine — Phase 4.5.
 *
 * Pure-function engine that selects WHAT to show from the question inventory.
 * Separates "generated questions" from "surfaced questions."
 *
 * Design:
 * - 100% deterministic (no AI calls)
 * - Reads from existing persisted inventory
 * - Integrates revision mastery signals for prioritization
 * - Budgets daily cognitive load
 * - Defers remaining questions for future sessions
 *
 * Generated Questions ≠ Immediately Surfaced Questions
 */

import type { ConceptMasteryRecord } from "@/types/database.types";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ConceptInventory {
  conceptId: string;
  conceptName: string;
  subject: string;
  difficulty: string;
  createdAt: Date;
  prelimsMcqs: any[];
  mainsQuestions: any[];
  interviewPrompts: any[];
}

export interface MasterySignal {
  conceptId: string;
  masteryLevel: string;
  isWeakArea: boolean;
  confidenceScore: number;
  nextReviewAt: Date | null;
  daysOverdue: number;
  /** Total MCQ attempts (correct + incorrect). Used for question rotation offset. */
  totalAttempts: number;
}

export type SurfaceReason =
  | "new_concept"      // Studied recently, not yet practiced
  | "revision_due"     // Spaced repetition interval expired
  | "weak_area"        // Detected as weak
  | "deferred"         // Previously deferred, resurfacing
  | "subject_balance"; // Ensuring subject coverage

export interface SurfacedQuestion {
  conceptId: string;
  conceptName: string;
  subject: string;
  reason: SurfaceReason;
  priorityScore: number;
  /** Only the questions selected for this session, not the full inventory */
  prelimsMcqs: any[];
  mainsQuestions: any[];
  interviewPrompts: any[];
}

export interface DailyPracticeSet {
  date: string;
  surfaced: SurfacedQuestion[];
  deferredCount: number;
  budget: {
    maxConcepts: number;
    maxMcqs: number;
    maxMains: number;
    maxInterview: number;
    totalInventory: number;
  };
  composition: {
    revisionLinked: number;
    weakArea: number;
    newConcept: number;
    deferred: number;
    subjectBalance: number;
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUDGET CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Daily cognitive budget — controls how much surfaces per session.
 * Designed for sustainable learning, not engagement maximization.
 */
const DAILY_BUDGET = {
  /** Max concepts to surface practice for */
  maxConcepts: 6,
  /** Max MCQs total across all concepts */
  maxMcqs: 8,
  /** Max mains questions */
  maxMains: 4,
  /** Max interview prompts */
  maxInterview: 2,
  /** Questions per concept (not all inventory surfaces) */
  mcqsPerConcept: 2,
  mainsPerConcept: 1,
  interviewPerConcept: 1,
};

/**
 * Priority weights for different surfacing reasons.
 * Higher = surfaces first.
 */
const PRIORITY_WEIGHTS = {
  weak_area: 100,
  revision_due: 80,
  new_concept: 50,
  deferred: 40,
  subject_balance: 30,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUESTION ROTATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Select a rotated subset from a question array.
 * Uses an offset (derived from attempt count) to cycle through
 * questions sequentially across sessions.
 *
 * Example: arr=[A,B,C,D,E], budget=2, offset=4
 *   → start = 4 % 5 = 4
 *   → returns [E, A] (wraps around)
 *
 * Guarantees every question eventually surfaces.
 */
function rotateSlice<T>(arr: T[], budget: number, offset: number): T[] {
  if (arr.length === 0 || budget <= 0) return [];
  const count = Math.min(budget, arr.length);
  const start = offset % arr.length;
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[(start + i) % arr.length]);
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SURFACING ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Select today's practice set from question inventory.
 * Pure function — no side effects, no AI calls, no persistence.
 */
export function computeDailyPractice(params: {
  inventory: ConceptInventory[];
  mastery: MasterySignal[];
  now?: Date;
}): DailyPracticeSet {
  const now = params.now ?? new Date();
  const today = now.toISOString().split("T")[0];
  const masteryMap = new Map(params.mastery.map((m) => [m.conceptId, m]));

  // ─── Step 1: Score each concept ────────────────────────
  const scored: Array<{
    inventory: ConceptInventory;
    reason: SurfaceReason;
    score: number;
  }> = [];

  for (const inv of params.inventory) {
    // Skip concepts with no questions at all
    if (
      inv.prelimsMcqs.length === 0 &&
      inv.mainsQuestions.length === 0 &&
      inv.interviewPrompts.length === 0
    ) {
      continue;
    }

    const mastery = masteryMap.get(inv.conceptId);
    const { reason, score } = scoreConcept(inv, mastery, now);
    scored.push({ inventory: inv, reason, score });
  }

  // ─── Step 2: Sort by priority score (highest first) ────
  scored.sort((a, b) => b.score - a.score);

  // ─── Step 3: Select within budget ─────────────────────
  const selected: SurfacedQuestion[] = [];
  let totalMcqs = 0;
  let totalMains = 0;
  let totalInterview = 0;

  // Track subject representation for balance
  const subjectCounts = new Map<string, number>();

  for (const item of scored) {
    if (selected.length >= DAILY_BUDGET.maxConcepts) break;

    // Subject balance: don't let one subject dominate
    const subjectCount = subjectCounts.get(item.inventory.subject) ?? 0;
    if (subjectCount >= 3 && selected.length >= 3) continue;

    // Select restrained subset from inventory
    const mcqBudget = Math.min(
      DAILY_BUDGET.mcqsPerConcept,
      DAILY_BUDGET.maxMcqs - totalMcqs,
      item.inventory.prelimsMcqs.length
    );
    const mainsBudget = Math.min(
      DAILY_BUDGET.mainsPerConcept,
      DAILY_BUDGET.maxMains - totalMains,
      item.inventory.mainsQuestions.length
    );
    const interviewBudget = Math.min(
      DAILY_BUDGET.interviewPerConcept,
      DAILY_BUDGET.maxInterview - totalInterview,
      item.inventory.interviewPrompts.length
    );

    // Skip if nothing left to budget
    if (mcqBudget <= 0 && mainsBudget <= 0 && interviewBudget <= 0) continue;

    // Rotation offset: use total MCQ attempts to cycle through questions
    const conceptMastery = masteryMap.get(item.inventory.conceptId);
    const rotationOffset = conceptMastery?.totalAttempts ?? 0;

    selected.push({
      conceptId: item.inventory.conceptId,
      conceptName: item.inventory.conceptName,
      subject: item.inventory.subject,
      reason: item.reason,
      priorityScore: item.score,
      // Rotate through inventory based on attempt count
      prelimsMcqs: rotateSlice(item.inventory.prelimsMcqs, mcqBudget, rotationOffset),
      mainsQuestions: rotateSlice(item.inventory.mainsQuestions, mainsBudget, rotationOffset),
      interviewPrompts: rotateSlice(item.inventory.interviewPrompts, interviewBudget, rotationOffset),
    });

    totalMcqs += mcqBudget;
    totalMains += mainsBudget;
    totalInterview += interviewBudget;
    subjectCounts.set(item.inventory.subject, subjectCount + 1);
  }

  // ─── Step 4: Compose result ───────────────────────────
  const composition = {
    revisionLinked: selected.filter((s) => s.reason === "revision_due").length,
    weakArea: selected.filter((s) => s.reason === "weak_area").length,
    newConcept: selected.filter((s) => s.reason === "new_concept").length,
    deferred: selected.filter((s) => s.reason === "deferred").length,
    subjectBalance: selected.filter((s) => s.reason === "subject_balance").length,
  };

  return {
    date: today,
    surfaced: selected,
    deferredCount: Math.max(0, scored.length - selected.length),
    budget: {
      maxConcepts: DAILY_BUDGET.maxConcepts,
      maxMcqs: DAILY_BUDGET.maxMcqs,
      maxMains: DAILY_BUDGET.maxMains,
      maxInterview: DAILY_BUDGET.maxInterview,
      totalInventory: params.inventory.length,
    },
    composition,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCORING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scoreConcept(
  inventory: ConceptInventory,
  mastery: MasterySignal | undefined,
  now: Date
): { reason: SurfaceReason; score: number } {
  // ─── Weak area: highest priority ──────────────────────
  if (mastery?.isWeakArea) {
    const overdueBoost = Math.min(mastery.daysOverdue * 5, 30);
    return {
      reason: "weak_area",
      score: PRIORITY_WEIGHTS.weak_area + overdueBoost,
    };
  }

  // ─── Revision due: overdue concepts get priority ──────
  if (mastery?.nextReviewAt && mastery.daysOverdue > 0) {
    const overdueBoost = Math.min(mastery.daysOverdue * 8, 40);
    const confidencePenalty = (1 - mastery.confidenceScore) * 20;
    return {
      reason: "revision_due",
      score: PRIORITY_WEIGHTS.revision_due + overdueBoost + confidencePenalty,
    };
  }

  // ─── New concept: studied within last 48h ─────────────
  const hoursSinceCreation = (now.getTime() - inventory.createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceCreation < 48) {
    const recencyBoost = Math.max(0, 30 - hoursSinceCreation);
    return {
      reason: "new_concept",
      score: PRIORITY_WEIGHTS.new_concept + recencyBoost,
    };
  }

  // ─── Deferred: older concepts with low mastery ────────
  if (mastery && mastery.masteryLevel !== "mastered") {
    return {
      reason: "deferred",
      score: PRIORITY_WEIGHTS.deferred + (1 - mastery.confidenceScore) * 20,
    };
  }

  // ─── Subject balance fill ─────────────────────────────
  return {
    reason: "subject_balance",
    score: PRIORITY_WEIGHTS.subject_balance,
  };
}
