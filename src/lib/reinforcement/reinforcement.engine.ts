/**
 * Reinforcement Engine — pure functions.
 *
 * Decides WHAT existing Knowledge to resurface after a practice or revision
 * miss, and in what order. It never generates content and never calls the
 * database or an LLM. The service layer feeds it rows; it returns an order.
 *
 * Inputs it reasons over:
 *   - the student's reported failureReason (authoritative for this attempt)
 *   - the repair outcome (R3.4 next action, or "clarified" / "no_repair")
 *   - the concept's event history, including repair_verification and
 *     repair_understanding events — the first consumer of those events
 *
 * It does NOT touch SM-2, mastery, or the legacy diagnostic engine.
 */

import type { FailureReason } from "@/lib/evidence/evidence.types";

// ─── Contract ───────────────────────────────────────────────

/** Which block of existing Knowledge to show. */
export type ReinforcementSection =
  | "coreIdea"
  | "hooks"
  | "triggers"
  | "staticCurrent"
  | "transferMcq"
  | "pyqs"
  | "dominoes"
  | "mainsAngle";

/** Why the student is being reinforced right now. */
export type ReinforcementOutcome =
  | "repair_complete"
  | "leave_for_revision"
  | "offer_another_repair"
  | "clarified"
  | "no_repair";

export const ALL_REINFORCEMENT_OUTCOMES: readonly ReinforcementOutcome[] = [
  "repair_complete",
  "leave_for_revision",
  "offer_another_repair",
  "clarified",
  "no_repair",
];

/** The minimal event shape the engine reads. */
export interface ReinforcementEvent {
  eventType: string;
  mcqQuestionIndex: number | null;
  eventMetadata: unknown;
}

/** What the concept's history says, summarized deterministically. */
export interface ConceptHistorySummary {
  mcqAttempts: number;
  mcqCorrect: number;
  attemptedQuestionIds: Set<string>;
  attemptedQuestionIndexes: Set<number>;
  repairCount: number;
  /** Outcome of the most recent repair verification, if any. */
  lastVerificationCorrect: boolean | null;
  /** The student's most recent post-repair self-report, if any. */
  lastUnderstanding: string | null;
}

/** An MCQ pulled from the existing concept_questions inventory. */
export interface ReinforcementMcq {
  questionId: string | null;
  questionIndex: number;
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

export const MAX_SECTIONS = 5;

// ─── History ────────────────────────────────────────────────

function meta(e: ReinforcementEvent): Record<string, unknown> {
  return e.eventMetadata && typeof e.eventMetadata === "object"
    ? (e.eventMetadata as Record<string, unknown>)
    : {};
}

/**
 * Summarize a concept's chronological events. Reads repair_verification and
 * repair_understanding events — these had no consumer before this engine.
 */
export function summarizeHistory(events: ReinforcementEvent[]): ConceptHistorySummary {
  const summary: ConceptHistorySummary = {
    mcqAttempts: 0,
    mcqCorrect: 0,
    attemptedQuestionIds: new Set(),
    attemptedQuestionIndexes: new Set(),
    repairCount: 0,
    lastVerificationCorrect: null,
    lastUnderstanding: null,
  };

  for (const e of events) {
    const m = meta(e);
    if (e.eventType === "mcq_attempt") {
      summary.mcqAttempts++;
      if (m.mcqCorrect === true) summary.mcqCorrect++;
      const qid = m.questionId;
      if (typeof qid === "string" && qid.length > 0) summary.attemptedQuestionIds.add(qid);
      if (typeof e.mcqQuestionIndex === "number") summary.attemptedQuestionIndexes.add(e.mcqQuestionIndex);
    } else if (e.eventType === "repair_verification") {
      summary.repairCount++;
      if (typeof m.verificationCorrect === "boolean") {
        summary.lastVerificationCorrect = m.verificationCorrect;
      }
    } else if (e.eventType === "repair_understanding") {
      if (typeof m.postRepairUnderstanding === "string") {
        summary.lastUnderstanding = m.postRepairUnderstanding;
      }
    }
  }

  return summary;
}

// ─── MCQ selection ──────────────────────────────────────────

function isAnswerKey(v: unknown): v is "a" | "b" | "c" | "d" {
  return v === "a" || v === "b" || v === "c" || v === "d";
}

/** Validate one JSONB MCQ entry into the engine's shape, or null. */
export function normalizeMcq(raw: unknown, index: number): ReinforcementMcq | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const options = r.options as Record<string, unknown> | undefined;
  if (
    typeof r.question !== "string" ||
    !options ||
    typeof options.a !== "string" ||
    typeof options.b !== "string" ||
    typeof options.c !== "string" ||
    typeof options.d !== "string" ||
    !isAnswerKey(r.correctAnswer)
  ) {
    return null;
  }
  return {
    questionId: typeof r.questionId === "string" ? r.questionId : null,
    questionIndex: index,
    question: r.question,
    options: { a: options.a, b: options.b, c: options.c, d: options.d },
    correctAnswer: r.correctAnswer,
    explanation: typeof r.explanation === "string" ? r.explanation : "",
  };
}

/**
 * Pick one MCQ the student has not yet attempted, excluding the question they
 * just missed. Falls back to the first valid question other than the excluded
 * one, then to null. Deterministic: same inputs → same pick.
 */
export interface TransferMcqExclusion {
  /** The single question just missed. */
  questionId?: string | null;
  questionIndex?: number | null;
  /**
   * Every question already visible on the surface asking for reinforcement
   * (Practice shows a concept's whole inventory), so the panel never repeats
   * what is on screen. When all are excluded the section simply drops out.
   */
  questionIds?: readonly string[] | null;
  questionIndexes?: readonly number[] | null;
}

export function pickTransferMcq(
  rawMcqs: unknown[],
  history: Pick<ConceptHistorySummary, "attemptedQuestionIds" | "attemptedQuestionIndexes">,
  exclude: TransferMcqExclusion = {},
): ReinforcementMcq | null {
  const excludedIds = new Set<string>(exclude.questionIds ?? []);
  if (exclude.questionId) excludedIds.add(exclude.questionId);
  const excludedIndexes = new Set<number>(exclude.questionIndexes ?? []);
  // An index-only exclusion is used for legacy MCQs that carry no id.
  if (typeof exclude.questionIndex === "number" && !exclude.questionId) {
    excludedIndexes.add(exclude.questionIndex);
  }

  const candidates = rawMcqs
    .map((raw, i) => normalizeMcq(raw, i))
    .filter((m): m is ReinforcementMcq => m !== null)
    .filter((m) => {
      if (m.questionId && excludedIds.has(m.questionId)) return false;
      if (excludedIndexes.has(m.questionIndex)) return false;
      return true;
    });

  if (candidates.length === 0) return null;

  const unseen = candidates.find((m) => {
    if (m.questionId) return !history.attemptedQuestionIds.has(m.questionId);
    return !history.attemptedQuestionIndexes.has(m.questionIndex);
  });

  return unseen ?? candidates[0];
}

// ─── Ordering ───────────────────────────────────────────────

const BASE_ORDER: Record<FailureReason, ReinforcementSection[]> = {
  could_not_recall: ["hooks", "triggers", "transferMcq", "pyqs", "dominoes"],
  concept_not_understood: ["coreIdea", "hooks", "dominoes", "transferMcq", "pyqs"],
  misunderstood_question: ["transferMcq", "triggers", "pyqs", "coreIdea"],
  careless_mistake: ["transferMcq", "triggers", "pyqs"],
  guessed: ["coreIdea", "transferMcq", "hooks", "pyqs"],
  overconfident: ["coreIdea", "transferMcq", "pyqs", "hooks"],
  not_sure: ["coreIdea", "hooks", "transferMcq", "dominoes"],
};

const NO_REASON_ORDER: ReinforcementSection[] = [
  "transferMcq",
  "pyqs",
  "staticCurrent",
  "dominoes",
];

function dedupe(sections: ReinforcementSection[]): ReinforcementSection[] {
  const seen = new Set<ReinforcementSection>();
  const out: ReinforcementSection[] = [];
  for (const s of sections) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Decide which existing Knowledge to show, in what order.
 *
 * Rules (all deterministic):
 *   1. The student's failureReason sets the base order.
 *   2. The repair outcome adjusts it: a completed repair drops the core idea
 *      (they just demonstrated it) and leads with a transfer question; an
 *      unresolved one leads with the core idea.
 *   3. History adjusts it: a failed last verification, or a last self-report
 *      of "still_not_understood", pulls the core idea to the front.
 *   4. Capped at MAX_SECTIONS.
 */
export function orderSections(params: {
  failureReason: FailureReason | null;
  outcome: ReinforcementOutcome;
  history: Pick<ConceptHistorySummary, "lastVerificationCorrect" | "lastUnderstanding">;
}): ReinforcementSection[] {
  const { failureReason, outcome, history } = params;

  let order: ReinforcementSection[] = failureReason
    ? [...BASE_ORDER[failureReason]]
    : [...NO_REASON_ORDER];

  if (outcome === "repair_complete") {
    order = order.filter((s) => s !== "coreIdea");
    order = ["transferMcq", ...order, "staticCurrent", "mainsAngle"];
  } else if (outcome === "leave_for_revision" || outcome === "clarified") {
    order = [...order, "staticCurrent"];
  } else if (outcome === "offer_another_repair") {
    order = ["coreIdea", ...order];
  }

  const struggling =
    history.lastVerificationCorrect === false ||
    history.lastUnderstanding === "still_not_understood";

  if (struggling && outcome !== "repair_complete") {
    order = ["coreIdea", ...order];
  }

  return dedupe(order).slice(0, MAX_SECTIONS);
}
