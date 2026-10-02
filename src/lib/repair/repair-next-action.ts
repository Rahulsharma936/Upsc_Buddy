/**
 * R3.4 — Repair Next Action
 *
 * Decides the one next thing to do with a repair card, given what happened on
 * the verification question and what the student said afterwards.
 *
 * Pipeline position:
 *   R3.1 RepairRequest → R3.2 Repair (+ verification MCQ)
 *   → R3.3 repair_verification → R3.3 repair_understanding
 *   → R3.4 decideNextAction()  ← you are here
 *
 * This module is PURE and TOTAL: no DB, no AI, no network, no side effects,
 * and every one of its seven possible inputs returns a valid action.
 *
 * What this is:
 *   A lookup over two facts the student and the system already recorded.
 *
 * What this is NOT:
 *   - NOT a diagnostic engine. The input domain is seven discrete states.
 *   - NOT a score. Nothing here produces a number, a ranking, or an index.
 *   - NOT a resolution verdict. No concept is ever marked permanently
 *     "resolved"; nothing is persisted; SM-2 and mastery are never touched.
 *   - NOT a psychological model. Conflicting evidence stays conflicting.
 *
 * The governing rule, in one line:
 *
 *   The student's report chooses the action. The verification result may only
 *   CONFIRM a completion the student already claimed — it can never
 *   manufacture one, and it can never veto a request for more help.
 *
 * That is why a correct verification answer paired with "I still don't
 * understand it" offers another repair rather than declaring success, and why
 * a wrong verification answer paired with "I understand it" is left for normal
 * revision rather than being turned into a diagnosis.
 *
 * @see repair-verification.ts (R3.3 — where verificationCorrect comes from)
 * @see repair-understanding.ts (R3.3 — where postRepairUnderstanding comes from)
 */

import type { PostRepairUnderstanding } from "@/lib/evidence/evidence.types";

// ─── Contract ───────────────────────────────────────────────

/**
 * The next thing to do with this repair. Each value names an ACTION, never a
 * claim about the student's mind.
 */
export type RepairNextAction =
  /** Both signals agree, positively. Close the loop for now. */
  | "repair_complete"
  /** The student asked for more help. Re-offer the repair. */
  | "offer_another_repair"
  /**
   * Claim nothing and do nothing extra. The concept is already back in the
   * normal revision queue — the original wrong MCQ wrote quality 1 through
   * /api/revision, so SM-2 has already reset its interval.
   */
  | "leave_for_revision";

/**
 * The two facts the decision reads. Deliberately nothing else.
 *
 * `failureReason` and `repairIntent` are NOT inputs: only one repair path
 * (concept_not_understood → concept_teaching) is currently reachable, so a
 * parameter here could not be branched on without writing dead code.
 */
export interface RepairOutcomeEvidence {
  /** Whether the student answered the post-repair verification MCQ correctly. */
  verificationCorrect: boolean;
  /**
   * The student's own post-repair report.
   *
   * null when they answered the verification and then left without reporting.
   * The reverse cannot happen: /api/repair/understanding 404s without a stored
   * verification, so a report always has a verification behind it.
   */
  postRepairUnderstanding: PostRepairUnderstanding | null;
}

/**
 * How many EXTRA repair offers a single question may produce in one session.
 *
 * Each re-offer is a fresh AI call, and a student can keep reporting
 * "I still don't understand it" indefinitely. One extra attempt is allowed;
 * after that the concept is left for normal revision.
 *
 * Session-local by design — the caller owns the counter. Nothing about this
 * budget is persisted, and it is not evidence.
 */
export const MAX_ADDITIONAL_REPAIR_OFFERS = 1;

// ─── Decision ───────────────────────────────────────────────

/**
 * Decide the next action from the recorded outcome of one repair.
 *
 * Pure, deterministic and total: the same evidence always yields the same
 * action, the input is never mutated, and all 3 × 2 + 1 states are covered.
 *
 * @param evidence - The verification outcome and the student's own report
 */
export function decideNextAction(
  evidence: RepairOutcomeEvidence,
): RepairNextAction {
  const { verificationCorrect, postRepairUnderstanding } = evidence;

  // 1. The student explicitly asked for more help. Nothing overrides this —
  //    not even a correct verification answer.
  if (postRepairUnderstanding === "still_not_understood") {
    return "offer_another_repair";
  }

  // 2. The student said they understand it AND the verification agrees.
  //    Both signals point the same way, so the loop can close.
  if (postRepairUnderstanding === "understood" && verificationCorrect) {
    return "repair_complete";
  }

  // 3. Everything else — "somewhat unsure", the understood/incorrect conflict,
  //    and an abandoned self-report. Claim nothing; normal revision covers it.
  return "leave_for_revision";
}

/**
 * Apply the session re-offer budget to a decided action.
 *
 * Keeps the loop finite without touching the decision rules themselves: a
 * student who has already used their extra repair for this question is left
 * for normal revision instead of being offered a third explanation.
 *
 * Only ever downgrades `offer_another_repair`. The other two actions pass
 * through untouched.
 *
 * @param action - The action decided from the evidence
 * @param additionalOffersUsed - Extra repairs already served for this question
 *   in this session (0 for the first pass through the loop)
 */
export function applyReofferLimit(
  action: RepairNextAction,
  additionalOffersUsed: number,
): RepairNextAction {
  if (
    action === "offer_another_repair" &&
    additionalOffersUsed >= MAX_ADDITIONAL_REPAIR_OFFERS
  ) {
    return "leave_for_revision";
  }
  return action;
}
