/**
 * Question Intelligence API — Phase 3B.
 *
 * POST /api/ai/questions
 *   Generates practice questions for a concept.
 *   Body: { conceptId: string, force?: boolean }
 *
 * GET /api/ai/questions?conceptId=xxx
 *   Retrieves existing questions for a concept.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { questionIntelligenceService } from "@/lib/ai/services/question-intelligence.service";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status }
  );
}

// ─── GET: Retrieve existing questions ───────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const conceptId = request.nextUrl.searchParams.get("conceptId");
    if (!conceptId) return errorResponse("conceptId is required");

    const questions = await questionIntelligenceService.getQuestions(conceptId);

    const prelimsCount = (questions?.prelimsMcqs as any[])?.length ?? 0;
    const mainsCount = (questions?.mainsQuestions as any[])?.length ?? 0;
    const interviewCount = (questions?.interviewPrompts as any[])?.length ?? 0;
    const hasQuestions = prelimsCount > 0 || mainsCount > 0 || interviewCount > 0;

    return NextResponse.json({
      success: true,
      data: {
        questions: questions ?? null,
        hasQuestions,
        recordExists: !!questions,
        counts: {
          prelims: prelimsCount,
          mains: mainsCount,
          interview: interviewCount,
        },
      },
    });
  } catch (err) {
    console.error("[QUESTIONS GET] Error:", err);
    return errorResponse("Failed to retrieve questions", 500);
  }
}

// ─── POST: Generate questions ───────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { conceptId, force } = body;

    if (!conceptId || typeof conceptId !== "string") {
      return errorResponse("conceptId is required");
    }

    const result = await questionIntelligenceService.generate({
      conceptId,
      userId: user.id,
      force: !!force,
    });

    return NextResponse.json({
      success: true,
      data: {
        questions: result.questions,
        stats: result.stats,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Question generation failed";
    console.error("[QUESTIONS POST] Error:", message);

    if (message.includes("not found") || message.includes("access denied")) {
      return errorResponse(message, 404);
    }

    return errorResponse(message, 500);
  }
}
