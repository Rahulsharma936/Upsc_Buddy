/**
 * GS Mapping + Context Intelligence API — Phase 3A.
 *
 * POST /api/ai/gs-context
 *   Generates GS mapping + analytical context for a concept.
 *   Body: { conceptId: string, force?: boolean }
 *
 * GET /api/ai/gs-context?conceptId=xxx
 *   Retrieves existing context intelligence for a concept.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { contextIntelligenceService } from "@/lib/ai/services/context-intelligence.service";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status }
  );
}

// ─── GET: Retrieve existing context ─────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const conceptId = request.nextUrl.searchParams.get("conceptId");
    if (!conceptId) return errorResponse("conceptId is required");

    const context = await contextIntelligenceService.getContext(conceptId);

    return NextResponse.json({
      success: true,
      data: {
        context: context ?? null,
        hasContext: !!context,
      },
    });
  } catch (err) {
    console.error("[GS-CONTEXT GET] Error:", err);
    return errorResponse("Failed to retrieve context", 500);
  }
}

// ─── POST: Generate GS mapping + context ────────────────────

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

    const result = await contextIntelligenceService.generate({
      conceptId,
      userId: user.id,
      force: !!force,
    });

    return NextResponse.json({
      success: true,
      data: {
        context: result.context,
        gsMapping: {
          primaryPaper: result.gsMapping.primaryPaper,
          mappings: result.gsMapping.mappings,
          confidence: result.gsMapping.mappingConfidence,
        },
        stats: result.stats,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Context generation failed";
    console.error("[GS-CONTEXT POST] Error:", message);

    if (message.includes("not found") || message.includes("access denied")) {
      return errorResponse(message, 404);
    }

    return errorResponse(message, 500);
  }
}
