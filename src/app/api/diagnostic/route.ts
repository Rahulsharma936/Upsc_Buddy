/**
 * Diagnostic API — R2.5 + R2 Enhancement
 *
 * GET /api/diagnostic?conceptId=<id>
 *   Returns ConceptDiagnosticReport + features for a single concept.
 *
 * GET /api/diagnostic?action=overview
 *   Returns diagnostic overview across all concepts for the user.
 *
 * POST /api/diagnostic
 *   Submit student self-report: { conceptId, difficulty }
 *   Stores as a self_report event in revision_events.
 *
 * All diagnostic logic is delegated to the diagnostic service.
 * This route only handles auth, parameter validation, and response formatting.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { diagnosticService } from "@/lib/diagnostic/diagnostic.service";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import type { StudentDifficulty } from "@/lib/evidence/evidence.types";

const VALID_DIFFICULTIES: StudentDifficulty[] = [
  "concept_understanding",
  "memory_retrieval",
  "question_performance",
  "revision_need",
  "uncertain",
];

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status }
  );
}

export async function GET(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const params = request.nextUrl.searchParams;
    const action = params.get("action");
    const conceptId = params.get("conceptId");

    // ── Overview endpoint ────────────────────────────────
    if (action === "overview") {
      const overview = await diagnosticService.diagnoseOverviewForUser(user.id);
      return NextResponse.json({
        success: true,
        data: overview,
      });
    }

    // ── Single concept endpoint ──────────────────────────
    if (conceptId) {
      if (typeof conceptId !== "string" || conceptId.trim().length === 0) {
        return errorResponse("Invalid conceptId");
      }

      const result = await diagnosticService.diagnoseConceptForUser(
        user.id,
        conceptId.trim()
      );

      return NextResponse.json({
        success: true,
        data: {
          report: {
            ...result.report,
            generatedAt: result.report.generatedAt.toISOString(),
          },
          features: result.features,
        },
      });
    }

    // ── No valid params ──────────────────────────────────
    return errorResponse(
      "Provide either conceptId=<id> or action=overview"
    );
  } catch (err) {
    console.error("[DIAGNOSTIC GET] Error:", err);
    const message = err instanceof Error ? err.message : "Diagnostic retrieval failed";
    return errorResponse(message, 500);
  }
}

// ─── POST: Submit Student Self-Report ───────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { conceptId, difficulty } = body;

    if (!conceptId || typeof conceptId !== "string") {
      return errorResponse("conceptId is required");
    }

    if (!difficulty || !VALID_DIFFICULTIES.includes(difficulty)) {
      return errorResponse(
        `difficulty must be one of: ${VALID_DIFFICULTIES.join(", ")}`
      );
    }

    // Store as a revision event with eventType = "self_report"
    // The studentDifficulty goes into eventMetadata JSONB —
    // same pattern as R1.2 confidence and R1.3 selfAssessment.
    await revisionRepository.logEvent({
      userId: user.id,
      conceptId,
      eventType: "self_report",
      eventMetadata: { studentDifficulty: difficulty },
    });

    return NextResponse.json({
      success: true,
      data: { conceptId, difficulty, stored: true },
    });
  } catch (err) {
    console.error("[DIAGNOSTIC POST] Error:", err);
    const message = err instanceof Error ? err.message : "Self-report submission failed";
    return errorResponse(message, 500);
  }
}

