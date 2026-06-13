/**
 * Cognitive Orchestration API — Phase 4.5.
 *
 * POST /api/ai/orchestrate
 *   Body: { conceptIds?: string[], backfill?: boolean, limit?: number, layers?: string[] }
 *
 *   - conceptIds: orchestrate specific concepts
 *   - backfill: true → hydrate all concepts missing intelligence
 *   - limit: max concepts to process (default 10, max 25)
 *   - layers: specific layers to run (default: all)
 *
 * GET /api/ai/orchestrate?action=status&conceptId=xxx
 *   Returns processing state for a concept (which layers exist).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import {
  cognitiveOrchestrationService,
  type LayerName,
} from "@/lib/ai/services/cognitive-orchestration.service";

const VALID_LAYERS: LayerName[] = [
  "notes", "relationships", "pyq_matching", "context", "questions", "revision",
];
const MAX_LIMIT = 25;

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status }
  );
}

// ─── GET: Processing status ──────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const action = request.nextUrl.searchParams.get("action");
    const conceptId = request.nextUrl.searchParams.get("conceptId");

    if (action === "status" && conceptId) {
      // Check which layers exist for this concept
      const { noteRepository } = await import("@/lib/repositories/note.repository");
      const { conceptContextRepository } = await import("@/lib/repositories/concept-context.repository");
      const { conceptQuestionsRepository } = await import("@/lib/repositories/concept-questions.repository");
      const { revisionRepository } = await import("@/lib/repositories/revision.repository");

      const [note, context, questions, mastery] = await Promise.all([
        noteRepository.findLatestByConceptId(conceptId).catch(() => null),
        conceptContextRepository.findByConcept(conceptId).catch(() => null),
        conceptQuestionsRepository.findByConcept(conceptId).catch(() => null),
        revisionRepository.getMastery(user.id, conceptId).catch(() => null),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          conceptId,
          layers: {
            notes: note ? "completed" : "pending",
            context: context ? "completed" : "pending",
            questions: questions ? "completed" : "pending",
            revision: mastery ? "completed" : "pending",
          },
        },
      });
    }

    return errorResponse("Use ?action=status&conceptId=xxx");
  } catch (err) {
    console.error("[ORCHESTRATE GET] Error:", err);
    return errorResponse("Failed to check status", 500);
  }
}

// ─── POST: Execute orchestration ─────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const {
      conceptIds,
      backfill = false,
      limit = 10,
      layers: rawLayers,
    } = body as {
      conceptIds?: string[];
      backfill?: boolean;
      limit?: number;
      layers?: string[];
    };

    // Validate layers if provided
    let layers: LayerName[] | undefined;
    if (rawLayers && Array.isArray(rawLayers)) {
      layers = rawLayers.filter((l): l is LayerName =>
        VALID_LAYERS.includes(l as LayerName)
      );
    }

    const safeLimit = Math.min(limit, MAX_LIMIT);

    // ─── Mode 1: Backfill ────────────────────────────────
    if (backfill) {
      const result = await cognitiveOrchestrationService.backfillUser({
        userId: user.id,
        limit: safeLimit,
        layers,
      });

      // Refresh adaptive intelligence after backfill
      await cognitiveOrchestrationService.refreshAdaptive(user.id);

      return NextResponse.json({
        success: true,
        data: {
          mode: "backfill",
          totalConcepts: result.totalConcepts,
          processed: result.processed,
          skipped: result.skipped,
          totalDurationMs: result.totalDurationMs,
          results: result.results,
        },
      });
    }

    // ─── Mode 2: Specific concepts ───────────────────────
    if (conceptIds && Array.isArray(conceptIds) && conceptIds.length > 0) {
      const concepts = await conceptRepository.findByIds(
        conceptIds.slice(0, safeLimit)
      );

      if (concepts.length === 0) {
        return errorResponse("No valid concepts found");
      }

      const results = await cognitiveOrchestrationService.orchestrateBatch({
        concepts,
        userId: user.id,
        layers,
      });

      // Refresh adaptive intelligence
      await cognitiveOrchestrationService.refreshAdaptive(user.id);

      return NextResponse.json({
        success: true,
        data: {
          mode: "targeted",
          processed: results.length,
          results,
        },
      });
    }

    return errorResponse("Provide conceptIds or set backfill: true");
  } catch (err) {
    console.error("[ORCHESTRATE POST] Error:", err);
    return errorResponse("Orchestration failed", 500);
  }
}
