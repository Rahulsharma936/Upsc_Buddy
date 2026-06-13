/**
 * Practice Intelligence API — Cognitive Surfacing.
 *
 * GET /api/practice
 *   Returns today's curated practice set (surfaced from inventory).
 *   NOT a dump of all generated questions.
 *
 * GET /api/practice?mode=inventory
 *   Returns full question inventory (for "View All" mode).
 *
 * POST /api/practice
 *   Body: { action: "backfill" } — triggers question generation for unhydrated concepts.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import {
  computeDailyPractice,
  type ConceptInventory,
  type MasterySignal,
} from "@/lib/ai/services/question-surfacing.engine";

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { message } },
    { status }
  );
}

// ─── GET: Surfaced practice set ──────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const mode = request.nextUrl.searchParams.get("mode");

    // ─── Inventory-first loading (Audit 2 remediation) ─────────
    // Single JOIN query: concepts × concept_questions
    // Only returns concepts with non-empty question arrays.
    // No arbitrary LIMIT — result set bounded by hydration rate.
    // Replaces old findByUser(50) + N+1 findByConcept() loop.
    let inventory: ConceptInventory[] = [];
    let totalConcepts = 0;

    try {
      const { conceptQuestionsRepository } = await import(
        "@/lib/repositories/concept-questions.repository"
      );

      const hydratedConcepts = await conceptQuestionsRepository.findAllWithConceptByUser(user.id);

      inventory = hydratedConcepts.map((row) => ({
        conceptId: row.concept.id,
        conceptName: row.concept.displayName,
        subject: row.concept.subject,
        difficulty: row.concept.difficulty,
        createdAt: row.concept.createdAt,
        prelimsMcqs: row.questions.prelimsMcqs,
        mainsQuestions: row.questions.mainsQuestions,
        interviewPrompts: row.questions.interviewPrompts,
      }));

      // Lightweight count of total concepts (for hydration %)
      // Uses index-only scan on concepts_user_id_idx
      totalConcepts = await conceptRepository.countByUser(user.id);
    } catch {
      // Tables may not exist yet
    }

    if (totalConcepts === 0 && inventory.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          mode: mode ?? "daily",
          surfaced: [],
          totalConcepts: 0,
          inventorySize: 0,
          hydratedPercent: 0,
        },
      });
    }

    // ─── Mode: Full inventory ────────────────────────────
    if (mode === "inventory") {
      return NextResponse.json({
        success: true,
        data: {
          mode: "inventory",
          concepts: inventory.map((inv) => ({
            conceptId: inv.conceptId,
            conceptName: inv.conceptName,
            subject: inv.subject,
            counts: {
              prelims: inv.prelimsMcqs.length,
              mains: inv.mainsQuestions.length,
              interview: inv.interviewPrompts.length,
            },
            prelimsMcqs: inv.prelimsMcqs,
            mainsQuestions: inv.mainsQuestions,
            interviewPrompts: inv.interviewPrompts,
          })),
          totalConcepts,
          inventorySize: inventory.length,
          hydratedPercent: totalConcepts > 0
            ? Math.round((inventory.length / totalConcepts) * 100)
            : 0,
        },
      });
    }

    // ─── Mode: Daily surfaced practice ───────────────────
    let mastery: MasterySignal[] = [];
    try {
      const { revisionRepository } = await import(
        "@/lib/repositories/revision.repository"
      );
      const allMastery = await revisionRepository.getAllMastery(user.id);
      const now = new Date();

      mastery = allMastery.map((m) => {
        const nextReview = m.nextReviewAt ? new Date(m.nextReviewAt) : null;
        const daysOverdue = nextReview
          ? Math.max(0, Math.floor((now.getTime() - nextReview.getTime()) / (1000 * 60 * 60 * 24)))
          : 0;

        return {
          conceptId: m.conceptId,
          masteryLevel: m.masteryLevel,
          isWeakArea: m.isWeakArea,
          confidenceScore: Number(m.confidenceScore),
          nextReviewAt: nextReview,
          daysOverdue,
        };
      });
    } catch {
      // Mastery table may not exist
    }

    const dailySet = computeDailyPractice({ inventory, mastery });

    return NextResponse.json({
      success: true,
      data: {
        mode: "daily",
        ...dailySet,
        totalConcepts,
        inventorySize: inventory.length,
        hydratedPercent: totalConcepts > 0
          ? Math.round((inventory.length / totalConcepts) * 100)
          : 0,
      },
    });
  } catch (err) {
    console.error("[PRACTICE GET] Error:", err);
    return errorResponse("Failed to load practice", 500);
  }
}

// ─── POST: Trigger backfill ──────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { action } = body;

    if (action === "backfill") {
      const { cognitiveOrchestrationService } = await import(
        "@/lib/ai/services/cognitive-orchestration.service"
      );

      const result = await cognitiveOrchestrationService.backfillUser({
        userId: user.id,
        limit: 10,
        layers: ["questions", "revision"],
      });

      return NextResponse.json({
        success: true,
        data: {
          action: "backfill",
          processed: result.processed,
          skipped: result.skipped,
          totalDurationMs: result.totalDurationMs,
        },
      });
    }

    return errorResponse("Unknown action. Use { action: 'backfill' }");
  } catch (err) {
    console.error("[PRACTICE POST] Error:", err);
    return errorResponse("Backfill failed", 500);
  }
}
