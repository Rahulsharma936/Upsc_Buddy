/**
 * Revision Intelligence API — Phase 3C.
 *
 * GET /api/revision
 *   ?action=recommendations — Priority-ranked revision list
 *   ?action=stats          — Revision analytics
 *   ?action=weak-areas     — Weak area details
 *
 * POST /api/revision
 *   Record a review event or skip.
 *   Body: { conceptId, action: "review"|"skip"|"mcq_attempt"|"self_assessment",
 *           quality?, mcqCorrect?, mcqQuestionIndex?,
 *           mcqQuestionId?, selectedAnswer?, correctAnswer?, confidence?,
 *           selfAssessment?, failureReason? }
 *   R1.2: mcqQuestionId/selectedAnswer/correctAnswer/confidence are optional MCQ evidence.
 *   R1.3: selfAssessment is optional revision evidence ("remembered"|"partially"|"forgot").
 *   Post-R2: failureReason is student's authoritative cause for wrong MCQ.
 *         All evidence flows into eventMetadata but does NOT affect SM-2 quality.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revisionIntelligenceService } from "@/lib/ai/services/revision-intelligence.service";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status }
  );
}

// ─── GET ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const action = request.nextUrl.searchParams.get("action") ?? "recommendations";
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "15");

    switch (action) {
      case "recommendations": {
        try {
          const recommendations = await revisionIntelligenceService.getRecommendations({
            userId: user.id,
            limit,
          });
          return NextResponse.json({
            success: true,
            data: { recommendations, count: recommendations.length },
          });
        } catch {
          // Table may not exist yet — return empty
          return NextResponse.json({
            success: true,
            data: { recommendations: [], count: 0 },
          });
        }
      }

      case "stats": {
        try {
          const stats = await revisionIntelligenceService.getStats(user.id);
          return NextResponse.json({
            success: true,
            data: { stats },
          });
        } catch {
          return NextResponse.json({
            success: true,
            data: {
              stats: {
                totalConcepts: 0, mastered: 0, reviewing: 0,
                learning: 0, unseen: 0, weakAreas: 0,
                dueNow: 0, averageConfidence: 0,
              },
            },
          });
        }
      }

      case "weak-areas": {
        try {
          const weakAreas = await revisionIntelligenceService.getWeakAreas(user.id);
          return NextResponse.json({
            success: true,
            data: { weakAreas, count: weakAreas.length },
          });
        } catch {
          return NextResponse.json({
            success: true,
            data: { weakAreas: [], count: 0 },
          });
        }
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[REVISION GET] Error:", err);
    return errorResponse("Failed to retrieve revision data", 500);
  }
}

// ─── POST ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const {
      conceptId, action, quality, mcqCorrect, mcqQuestionIndex,
      // R1.2 MCQ evidence — all optional, backwards-compatible
      mcqQuestionId, selectedAnswer, correctAnswer, confidence,
      // R1.3 Revision evidence — optional
      selfAssessment,
      // Post-R2: student's authoritative failure reason for wrong MCQ
      failureReason,
    } = body;

    if (!conceptId || typeof conceptId !== "string") {
      return errorResponse("conceptId is required");
    }

    if (!action || !["review", "skip", "mcq_attempt", "self_assessment", "initialize"].includes(action)) {
      return errorResponse("Valid action required: review, skip, mcq_attempt, self_assessment, initialize");
    }

    // Handle initialization
    if (action === "initialize") {
      const mastery = await revisionIntelligenceService.initializeForConcept({
        userId: user.id,
        conceptId,
      });
      return NextResponse.json({
        success: true,
        data: { mastery, action: "initialized" },
      });
    }

    // Handle skip
    if (action === "skip") {
      const mastery = await revisionIntelligenceService.recordSkip({
        userId: user.id,
        conceptId,
      });
      return NextResponse.json({
        success: true,
        data: { mastery, action: "skipped" },
      });
    }

    // Handle review / mcq_attempt / self_assessment
    const q = typeof quality === "number" ? quality : 3;

    const result = await revisionIntelligenceService.recordReview({
      userId: user.id,
      conceptId,
      quality: q,
      eventType: action as "review" | "mcq_attempt" | "self_assessment",
      mcqCorrect,
      mcqQuestionIndex,
      // R1.2: Forward MCQ evidence — these are optional and
      // do NOT affect SM-2 quality. Stored in eventMetadata only.
      mcqQuestionId,
      selectedAnswer,
      correctAnswer,
      confidence,
      // R1.3: Forward revision self-assessment evidence
      selfAssessment,
      // Post-R2: Forward failure reason evidence
      failureReason,
    });

    return NextResponse.json({
      success: true,
      data: {
        mastery: result.mastery,
        nextReviewAt: result.nextReviewAt.toISOString(),
        intervalDays: result.intervalDays,
        action,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Revision recording failed";
    console.error("[REVISION POST] Error:", message);
    return errorResponse(message, 500);
  }
}
