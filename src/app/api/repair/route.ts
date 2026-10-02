/**
 * Repair API — R3.2a
 *
 * POST /api/repair
 *   Body: { conceptId, failureReason, questionContext? }
 *   Orchestrates: R3.1 (RepairRequest) → R3.2 (Executor) → ConceptTeachingRepair
 *
 * Handles the failure reasons that have an executor:
 *   concept_not_understood → concept_teaching       (R3.2a)
 *   could_not_recall       → active_recall          (R3.5)
 *   misunderstood_question → question_interpretation (R3.6)
 *   guessed                → uncertainty_resolution  (R3.7)
 *   overconfident           → calibration            (R3.8)
 *   careless_mistake        → error_awareness         (R3.9)
 * Other repair intents will be added in subsequent R3.2 tasks.
 *
 * Does NOT modify SM-2, mastery, or any existing learning system.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import {
  buildRepairRequest,
  ALL_FAILURE_REASONS,
} from "@/lib/repair/repair-request.builder";
import type { RepairQuestionContext } from "@/lib/repair/repair-request.builder";
import { executeConceptTeaching } from "@/lib/repair/concept-teaching.executor";
import { executeActiveRecall } from "@/lib/repair/active-recall.executor";
import { executeQuestionInterpretation } from "@/lib/repair/question-interpretation.executor";
import { executeUncertaintyResolution } from "@/lib/repair/uncertainty-resolution.executor";
import { executeCalibration } from "@/lib/repair/calibration.executor";
import { executeErrorAwareness } from "@/lib/repair/error-awareness.executor";
import type { FailureReason } from "@/lib/evidence/evidence.types";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status },
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { conceptId, failureReason, questionContext } = body;

    // ─── Validation ─────────────────────────────────────

    if (!conceptId || typeof conceptId !== "string") {
      return errorResponse("conceptId is required");
    }

    if (!failureReason || !ALL_FAILURE_REASONS.includes(failureReason as FailureReason)) {
      return errorResponse(
        `Valid failureReason required. Got: "${failureReason}". ` +
        `Valid: ${ALL_FAILURE_REASONS.join(", ")}`
      );
    }

    // ─── R3.1: Build RepairRequest ──────────────────────

    const repairRequest = buildRepairRequest({
      failureReason: failureReason as FailureReason,
      conceptId,
      questionContext: questionContext as RepairQuestionContext | undefined,
    });

    // ─── R3.2: Route to executor ────────────────────────

    if (
      repairRequest.repairIntent === "concept_teaching" ||
      repairRequest.repairIntent === "active_recall" ||
      repairRequest.repairIntent === "question_interpretation" ||
      repairRequest.repairIntent === "uncertainty_resolution" ||
      repairRequest.repairIntent === "calibration" ||
      repairRequest.repairIntent === "error_awareness"
    ) {
      // Look up concept metadata
      const concept = await conceptRepository.findById(conceptId);
      if (!concept) {
        return errorResponse("Concept not found", 404);
      }

      // Verify concept belongs to this user
      if (concept.userId !== user.id) {
        return errorResponse("Concept not found", 404);
      }

      const executorInput = {
        request: repairRequest,
        conceptName: concept.displayName || concept.name,
        conceptSubject: concept.subject,
        conceptKeywords: concept.keywords ?? [],
      };

      if (repairRequest.repairIntent === "concept_teaching") {
        // Execute concept teaching repair (R3.2a)
        const repair = await executeConceptTeaching(executorInput);

        return NextResponse.json({
          success: true,
          data: {
            repair: {
              requestId: repair.requestId,
              conceptId: repair.conceptId,
              failureReason: repair.failureReason,
              repairIntent: repair.repairIntent,
              explanation: repair.explanation,
              verification: repair.verification,
              status: repair.status,
            },
          },
        });
      }

      if (repairRequest.repairIntent === "active_recall") {
        // Execute active recall repair (R3.5)
        const repair = await executeActiveRecall(executorInput);

        return NextResponse.json({
          success: true,
          data: {
            repair: {
              requestId: repair.requestId,
              conceptId: repair.conceptId,
              failureReason: repair.failureReason,
              repairIntent: repair.repairIntent,
              retrieval: repair.retrieval,
              reveal: repair.reveal,
              verification: repair.verification,
              status: repair.status,
            },
          },
        });
      }

      if (repairRequest.repairIntent === "question_interpretation") {
        // Execute question interpretation repair (R3.6)
        const repair = await executeQuestionInterpretation(executorInput);

        return NextResponse.json({
          success: true,
          data: {
            repair: {
              requestId: repair.requestId,
              conceptId: repair.conceptId,
              failureReason: repair.failureReason,
              repairIntent: repair.repairIntent,
              breakdown: repair.breakdown,
              verification: repair.verification,
              status: repair.status,
            },
          },
        });
      }

      if (repairRequest.repairIntent === "uncertainty_resolution") {
        // Execute uncertainty resolution repair (R3.7)
        const repair = await executeUncertaintyResolution(executorInput);

        return NextResponse.json({
          success: true,
          data: {
            repair: {
              requestId: repair.requestId,
              conceptId: repair.conceptId,
              failureReason: repair.failureReason,
              repairIntent: repair.repairIntent,
              breakdown: repair.breakdown,
              verification: repair.verification,
              status: repair.status,
            },
          },
        });
      }

      if (repairRequest.repairIntent === "calibration") {
        // Execute calibration repair (R3.8)
        const repair = await executeCalibration(executorInput);

        return NextResponse.json({
          success: true,
          data: {
            repair: {
              requestId: repair.requestId,
              conceptId: repair.conceptId,
              failureReason: repair.failureReason,
              repairIntent: repair.repairIntent,
              breakdown: repair.breakdown,
              verification: repair.verification,
              status: repair.status,
            },
          },
        });
      }

      // Execute error awareness repair (R3.9)
      const repair = await executeErrorAwareness(executorInput);

      return NextResponse.json({
        success: true,
        data: {
          repair: {
            requestId: repair.requestId,
            conceptId: repair.conceptId,
            failureReason: repair.failureReason,
            repairIntent: repair.repairIntent,
            breakdown: repair.breakdown,
            verification: repair.verification,
            status: repair.status,
          },
        },
      });
    }

    // Other intents not yet implemented
    return NextResponse.json({
      success: true,
      data: {
        repair: null,
        message: `Repair intent "${repairRequest.repairIntent}" is not yet implemented. ` +
          `Available: "concept_teaching" (R3.2a), "active_recall" (R3.5), ` +
          `"question_interpretation" (R3.6), "uncertainty_resolution" (R3.7), ` +
          `"calibration" (R3.8), "error_awareness" (R3.9).`,
        repairRequest: {
          requestId: repairRequest.requestId,
          failureReason: repairRequest.failureReason,
          repairIntent: repairRequest.repairIntent,
          status: repairRequest.status,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repair execution failed";
    console.error("[REPAIR POST] Error:", message);
    return errorResponse(message, 500);
  }
}
