/**
 * R3.1 — RepairRequest Builder
 *
 * Converts a student's self-reported `failureReason` into a bounded RepairRequest.
 *
 * This is the NEW R3 entry point. It does NOT use the old R2 diagnostic scoring engine.
 * The student has already told us what went wrong — R3.1 respects that signal directly.
 *
 * Pipeline:
 *   failureReason + conceptId + questionContext
 *   → buildRepairRequest()
 *   → RepairRequest
 *   → R3.2 Executor (future)
 *
 * Design principles:
 *   - Student's failureReason is the authoritative cause signal
 *   - No automatic mapping to old Concept/Memory/Calibration/Revision Gap taxonomy
 *   - Repair should be small and targeted — not a content dump
 *   - Verification is always required (except "not_sure" / clarification)
 *   - Pure function — no DB, no AI, no side effects
 *
 * @see FailureReason in evidence.types.ts
 */

import type { FailureReason } from "@/lib/evidence/evidence.types";

// ─── Repair Intent ──────────────────────────────────────────

/**
 * The type of intervention R3 should perform.
 * Each intent maps to a distinct pedagogical approach.
 * These are NOT the old 4-gap diagnoses.
 */
export type RepairIntent =
  | "concept_teaching"          // Targeted explanation of the specific concept
  | "active_recall"             // Retrieval practice — student must recall, not re-read
  | "question_interpretation"   // Focus on reading/interpreting questions, not concept knowledge
  | "uncertainty_resolution"    // Determine what the student doesn't know before intervening
  | "calibration"               // Align confidence with actual performance
  | "error_awareness"           // Deliberate verification and error-checking practice
  | "clarification";            // Cause unknown — collect information before intervening

// ─── Question Context ───────────────────────────────────────

/**
 * Context about the specific MCQ that triggered the repair.
 * All fields optional — older events may not have full context.
 */
export interface RepairQuestionContext {
  /** Index of the question within the practice set. */
  questionIndex?: number;
  /** The answer the student selected. */
  selectedAnswer?: string;
  /** The correct answer. */
  correctAnswer?: string;
  /** The question text (if available). */
  questionText?: string;
  /** Stable question ID (R1.2). */
  questionId?: string;
}

// ─── RepairRequest ──────────────────────────────────────────

/**
 * The sole input to R3.2 (Repair Executor).
 *
 * Built from a student's self-reported failureReason.
 * Does NOT contain R2 diagnostic scores or gap classifications.
 *
 * R3.2 consumes this to generate the actual repair content.
 */
export interface RepairRequest {
  /** Unique request ID for tracking. */
  requestId: string;

  /** The student's original, authoritative failure reason. Preserved exactly. */
  failureReason: FailureReason;

  /** The concept this repair targets. */
  conceptId: string;

  /** Context about the triggering MCQ (if available). */
  questionContext: RepairQuestionContext | null;

  /** What kind of intervention R3 should perform. */
  repairIntent: RepairIntent;

  /**
   * Human-readable objective for this repair.
   * Describes what the repair should accomplish in plain language.
   */
  objective: string;

  /**
   * Whether verification is required after the repair.
   * True for most intents. False only for "clarification" where
   * the cause is still unknown.
   */
  verificationRequired: boolean;

  /** Lifecycle status. Created as "pending". */
  status: "pending";

  /** When this request was created. */
  createdAt: Date;
}

// ─── Builder Input ──────────────────────────────────────────

/**
 * Input to `buildRepairRequest()`.
 * Everything needed to create a RepairRequest from a student's reported failure.
 */
export interface RepairRequestInput {
  /** The student's self-reported failure reason. */
  failureReason: FailureReason;
  /** The concept the student failed on. */
  conceptId: string;
  /** Optional context about the triggering MCQ. */
  questionContext?: RepairQuestionContext;
}

// ─── Failure → Intent Mapping ───────────────────────────────

/**
 * Static, deterministic mapping from failureReason to repairIntent + objective.
 * No old diagnostic scoring involved.
 *
 * Each entry describes:
 *   - repairIntent: the type of intervention
 *   - objective: what the repair should accomplish
 *   - verificationRequired: whether post-repair verification is needed
 */
const FAILURE_TO_REPAIR: Record<FailureReason, {
  repairIntent: RepairIntent;
  objective: string;
  verificationRequired: boolean;
}> = {
  concept_not_understood: {
    repairIntent: "concept_teaching",
    objective: "Provide a focused, concise explanation of the specific concept. Cover the core idea, why it matters, a simple example, and a key distinction. Verify understanding afterward.",
    verificationRequired: true,
  },
  could_not_recall: {
    repairIntent: "active_recall",
    objective: "Guide the student to actively retrieve the relevant knowledge rather than passively re-reading. Use cues and reconstruction prompts. Verify recall with a targeted question.",
    verificationRequired: true,
  },
  misunderstood_question: {
    repairIntent: "question_interpretation",
    objective: "Help the student identify what the question actually asked, interpret qualifiers and option distinctions, and recognize wording traps. This is NOT a concept lesson.",
    verificationRequired: true,
  },
  guessed: {
    repairIntent: "uncertainty_resolution",
    objective: "Determine whether the uncertainty stems from missing knowledge, weak recall, or inability to distinguish options. Collect enough information to identify the root cause before intervening.",
    verificationRequired: true,
  },
  overconfident: {
    repairIntent: "calibration",
    objective: "Explicitly connect what the student believed, their confidence level, and what was actually correct. Help the student understand why their confidence was misplaced and improve self-assessment accuracy.",
    verificationRequired: true,
  },
  careless_mistake: {
    repairIntent: "error_awareness",
    objective: "Focus on deliberate verification and error-checking. Help the student identify what they missed and practice systematic checking. Do NOT assign a concept lesson.",
    verificationRequired: true,
  },
  not_sure: {
    repairIntent: "clarification",
    objective: "The student is uncertain about what went wrong. Collect enough information to determine an appropriate intervention before committing to a specific repair strategy.",
    verificationRequired: false,
  },
};

// ─── Builder ────────────────────────────────────────────────

/**
 * Build a RepairRequest from a student's self-reported failure.
 *
 * This is a pure, deterministic function.
 * It does NOT use R2 diagnostic scoring.
 * It does NOT access the database.
 * It does NOT call APIs.
 *
 * @param input - The student's failure report and question context
 * @returns A bounded RepairRequest ready for R3.2 consumption
 * @throws Error if failureReason is invalid
 */
export function buildRepairRequest(input: RepairRequestInput): RepairRequest {
  const mapping = FAILURE_TO_REPAIR[input.failureReason];

  if (!mapping) {
    throw new Error(
      `Unknown failureReason: "${input.failureReason}". ` +
      `Valid values: ${Object.keys(FAILURE_TO_REPAIR).join(", ")}`
    );
  }

  return {
    requestId: crypto.randomUUID(),
    failureReason: input.failureReason,
    conceptId: input.conceptId,
    questionContext: input.questionContext ?? null,
    repairIntent: mapping.repairIntent,
    objective: mapping.objective,
    verificationRequired: mapping.verificationRequired,
    status: "pending",
    createdAt: new Date(),
  };
}

/**
 * Look up the repair intent for a given failure reason without
 * building a full RepairRequest. Useful for display/preview.
 */
export function getRepairIntent(failureReason: FailureReason): RepairIntent {
  const mapping = FAILURE_TO_REPAIR[failureReason];
  if (!mapping) {
    throw new Error(`Unknown failureReason: "${failureReason}"`);
  }
  return mapping.repairIntent;
}

/**
 * All valid failure reasons. Exported for validation in API routes.
 */
export const ALL_FAILURE_REASONS: readonly FailureReason[] = Object.keys(
  FAILURE_TO_REPAIR
) as FailureReason[];

/**
 * All valid repair intents, derived from the failure → repair mapping.
 * Single source of truth for intent validation (R3.3 verification, future executors).
 */
export const ALL_REPAIR_INTENTS: readonly RepairIntent[] = Array.from(
  new Set(Object.values(FAILURE_TO_REPAIR).map((m) => m.repairIntent))
);
