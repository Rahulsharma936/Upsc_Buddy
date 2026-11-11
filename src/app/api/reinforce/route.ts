/**
 * Reinforcement API — retrieval only.
 *
 * GET /api/reinforce?conceptId=<uuid>
 *                   &failureReason=<FailureReason>     (optional)
 *                   &outcome=<ReinforcementOutcome>    (optional, default no_repair)
 *                   &excludeQuestionId=<id>            (optional — the MCQ just missed)
 *                   &excludeQuestionIndex=<n>          (optional — legacy MCQs without an id)
 *
 * Returns the EXISTING Knowledge most useful right after a miss: the concept's
 * own note, matched PYQs, related-concept dominoes, and one unseen transfer
 * MCQ — ordered by the student's reported failureReason and repair outcome.
 *
 * No LLM. No new tables. Never touches SM-2 or mastery.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";
import { ALL_FAILURE_REASONS } from "@/lib/repair/repair-request.builder";
import type { FailureReason } from "@/lib/evidence/evidence.types";
import { reinforcementService } from "@/lib/reinforcement/reinforcement.service";
import {
  ALL_REINFORCEMENT_OUTCOMES,
  type ReinforcementOutcome,
} from "@/lib/reinforcement/reinforcement.engine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const conceptId = searchParams.get("conceptId");
    const failureReasonRaw = searchParams.get("failureReason");
    const outcomeRaw = searchParams.get("outcome") ?? "no_repair";
    const excludeQuestionId = searchParams.get("excludeQuestionId");
    const excludeQuestionIndexRaw = searchParams.get("excludeQuestionIndex");
    // Comma-separated: every question already on screen (Practice shows the
    // whole inventory, so the panel must not repeat one of them).
    const excludeQuestionIds = (searchParams.get("excludeQuestionIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 200)
      .slice(0, 100);
    const excludeQuestionIndexesRaw = (searchParams.get("excludeQuestionIndexes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 100);

    const errors: Record<string, string[]> = {};

    if (!conceptId) {
      errors.conceptId = ["conceptId query parameter is required"];
    }

    let failureReason: FailureReason | null = null;
    if (failureReasonRaw) {
      if (ALL_FAILURE_REASONS.includes(failureReasonRaw as FailureReason)) {
        failureReason = failureReasonRaw as FailureReason;
      } else {
        errors.failureReason = [`Must be one of: ${ALL_FAILURE_REASONS.join(", ")}`];
      }
    }

    if (!ALL_REINFORCEMENT_OUTCOMES.includes(outcomeRaw as ReinforcementOutcome)) {
      errors.outcome = [`Must be one of: ${ALL_REINFORCEMENT_OUTCOMES.join(", ")}`];
    }

    let excludeQuestionIndex: number | null = null;
    if (excludeQuestionIndexRaw !== null && excludeQuestionIndexRaw !== "") {
      const n = Number(excludeQuestionIndexRaw);
      if (Number.isInteger(n) && n >= 0) {
        excludeQuestionIndex = n;
      } else {
        errors.excludeQuestionIndex = ["Must be a non-negative integer"];
      }
    }

    const excludeQuestionIndexes: number[] = [];
    for (const raw of excludeQuestionIndexesRaw) {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) excludeQuestionIndexes.push(n);
      else errors.excludeQuestionIndexes = ["Must be comma-separated non-negative integers"];
    }

    if (Object.keys(errors).length > 0) {
      return validationErrorResponse(errors);
    }

    const session = await reinforcementService.build({
      userId: user.id,
      conceptId: conceptId!,
      failureReason,
      outcome: outcomeRaw as ReinforcementOutcome,
      excludeQuestionId,
      excludeQuestionIndex,
      excludeQuestionIds,
      excludeQuestionIndexes,
    });

    if (!session) return notFoundResponse("Concept not found");

    return successResponse(session);
  } catch (error) {
    console.error("[ROUTE] reinforce GET:", error);
    return serverErrorResponse();
  }
}
