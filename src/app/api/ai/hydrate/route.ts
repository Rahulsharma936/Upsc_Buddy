/**
 * Historical Hydration API — Phase 4.5+.
 *
 * GET /api/ai/hydrate
 *   Returns hydration audit: which concepts are missing which layers.
 *
 * POST /api/ai/hydrate
 *   Body: { limit?: number, offset?: number, layers?: string[] }
 *   Runs hydration batch for historical concepts.
 *
 * Designed for safe, paginated, observable hydration of historical concepts
 * that were created before the orchestration pipeline existed.
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

// ─── GET: Hydration Audit ────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    // Load ALL concepts (oldest first)
    const allConcepts = await conceptRepository.findAllByUser(user.id);

    if (allConcepts.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          totalConcepts: 0,
          fullyHydrated: 0,
          needsHydration: 0,
          coverage: {},
          concepts: [],
        },
      });
    }

    // Check each layer for each concept
    const { noteRepository } = await import("@/lib/repositories/note.repository");
    const { conceptQuestionsRepository } = await import("@/lib/repositories/concept-questions.repository");
    const { revisionRepository } = await import("@/lib/repositories/revision.repository");

    const audit: {
      conceptId: string;
      conceptName: string;
      subject: string;
      createdAt: string;
      layers: Record<string, "exists" | "missing" | "empty">;
    }[] = [];

    let fullyHydrated = 0;
    const layerCoverage: Record<string, { exists: number; missing: number }> = {
      notes: { exists: 0, missing: 0 },
      questions: { exists: 0, missing: 0 },
      revision: { exists: 0, missing: 0 },
    };

    for (const concept of allConcepts) {
      const layers: Record<string, "exists" | "missing" | "empty"> = {};

      // Notes
      try {
        const note = await noteRepository.findLatestByConceptId(concept.id);
        layers.notes = note ? "exists" : "missing";
      } catch {
        layers.notes = "missing";
      }

      // Questions
      try {
        const q = await conceptQuestionsRepository.findByConcept(concept.id);
        if (q) {
          const p = (q.prelimsMcqs as any[])?.length ?? 0;
          const m = (q.mainsQuestions as any[])?.length ?? 0;
          const i = (q.interviewPrompts as any[])?.length ?? 0;
          layers.questions = (p > 0 || m > 0 || i > 0) ? "exists" : "empty";
        } else {
          layers.questions = "missing";
        }
      } catch {
        layers.questions = "missing";
      }

      // Revision mastery
      try {
        const mastery = await revisionRepository.getMastery(user.id, concept.id);
        layers.revision = mastery ? "exists" : "missing";
      } catch {
        layers.revision = "missing";
      }

      // Track coverage
      for (const [key, status] of Object.entries(layers)) {
        if (layerCoverage[key]) {
          if (status === "exists") layerCoverage[key].exists++;
          else layerCoverage[key].missing++;
        }
      }

      const isFullyHydrated = Object.values(layers).every((s) => s === "exists");
      if (isFullyHydrated) fullyHydrated++;

      audit.push({
        conceptId: concept.id,
        conceptName: concept.displayName,
        subject: concept.subject,
        createdAt: concept.createdAt.toISOString(),
        layers,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        totalConcepts: allConcepts.length,
        fullyHydrated,
        needsHydration: allConcepts.length - fullyHydrated,
        coverage: Object.fromEntries(
          Object.entries(layerCoverage).map(([key, val]) => [
            key,
            {
              ...val,
              percent: Math.round((val.exists / allConcepts.length) * 100),
            },
          ])
        ),
        concepts: audit,
      },
    });
  } catch (err) {
    console.error("[HYDRATE GET] Error:", err);
    return errorResponse("Hydration audit failed", 500);
  }
}

// ─── POST: Execute Hydration ─────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const {
      limit = 5,
      offset = 0,
      layers: rawLayers,
    } = body as {
      limit?: number;
      offset?: number;
      layers?: string[];
    };

    // Validate layers
    let layers: LayerName[] | undefined;
    if (rawLayers && Array.isArray(rawLayers)) {
      layers = rawLayers.filter((l): l is LayerName =>
        VALID_LAYERS.includes(l as LayerName)
      );
    }

    const safeLimit = Math.min(limit, MAX_LIMIT);

    console.log(`[HYDRATE] Starting historical hydration: limit=${safeLimit}, offset=${offset}, layers=${layers?.join(",") ?? "all"}`);

    const result = await cognitiveOrchestrationService.backfillUser({
      userId: user.id,
      limit: safeLimit,
      offset,
      layers,
    });

    // Refresh adaptive intelligence after hydration
    await cognitiveOrchestrationService.refreshAdaptive(user.id);

    return NextResponse.json({
      success: true,
      data: {
        totalConcepts: result.totalConcepts,
        processed: result.processed,
        skipped: result.skipped,
        totalDurationMs: result.totalDurationMs,
        results: result.results.map((r) => ({
          conceptId: r.conceptId,
          conceptName: r.conceptName,
          completed: r.completedCount,
          failed: r.failedCount,
          layers: r.layers.map((l) => ({
            name: l.layer,
            status: l.status,
            durationMs: l.durationMs,
            error: l.error,
          })),
        })),
        // Suggest next offset for continued hydration
        nextOffset: result.processed > 0 || result.skipped > 0
          ? offset + result.processed + result.skipped
          : null,
      },
    });
  } catch (err) {
    console.error("[HYDRATE POST] Error:", err);
    return errorResponse("Hydration failed", 500);
  }
}
