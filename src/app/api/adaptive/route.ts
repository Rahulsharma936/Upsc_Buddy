/**
 * Adaptive Intelligence API — Phase 4.
 *
 * GET /api/adaptive
 *   ?action=profile        — Full adaptive intelligence profile
 *   ?action=strengths      — Subject strength scores only
 *   ?action=coverage       — Syllabus coverage only
 *   ?action=gaps           — Concept gaps only
 *   ?action=recommendations — Recommendations only
 *   ?action=difficulty&conceptId=xxx — Adaptive difficulty for a concept
 *
 * POST /api/adaptive
 *   { force: true } — Force recomputation
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adaptiveIntelligenceService } from "@/lib/ai/services/adaptive-intelligence.service";

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

    const action = request.nextUrl.searchParams.get("action") ?? "profile";

    // Special case: adaptive difficulty for a single concept
    if (action === "difficulty") {
      const conceptId = request.nextUrl.searchParams.get("conceptId");
      if (!conceptId) return errorResponse("conceptId is required for difficulty action");

      const difficulty = await adaptiveIntelligenceService.getAdaptiveDifficulty({
        userId: user.id,
        conceptId,
      });

      return NextResponse.json({ success: true, data: difficulty });
    }

    // Full or partial profile
    const result = await adaptiveIntelligenceService.getAdaptiveIntelligence({
      userId: user.id,
    });

    switch (action) {
      case "profile":
        return NextResponse.json({ success: true, data: result });

      case "strengths":
        return NextResponse.json({
          success: true,
          data: { subjectStrengths: result.subjectStrengths },
        });

      case "coverage":
        return NextResponse.json({
          success: true,
          data: { syllabusCoverage: result.syllabusCoverage },
        });

      case "gaps":
        return NextResponse.json({
          success: true,
          data: { conceptGaps: result.conceptGaps, count: result.conceptGaps.length },
        });

      case "weaknesses":
        return NextResponse.json({
          success: true,
          data: { subjectWeaknesses: result.subjectWeaknesses },
        });

      case "patterns":
        return NextResponse.json({
          success: true,
          data: { studyPatterns: result.studyPatterns },
        });

      case "recommendations":
        return NextResponse.json({
          success: true,
          data: { recommendations: result.recommendations, count: result.recommendations.length },
        });

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[ADAPTIVE GET] Error:", err);
    return errorResponse("Failed to retrieve adaptive intelligence", 500);
  }
}

// ─── POST ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const result = await adaptiveIntelligenceService.getAdaptiveIntelligence({
      userId: user.id,
      force: true,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[ADAPTIVE POST] Error:", err);
    return errorResponse("Failed to compute adaptive intelligence", 500);
  }
}
