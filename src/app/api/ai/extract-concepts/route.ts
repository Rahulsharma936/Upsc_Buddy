/**
 * POST /api/ai/extract-concepts
 * Triggers concept extraction for a daily log entry.
 *
 * Supports `force: true` for re-extraction (Task 3 — Audit 1).
 * Returns structured extraction status for frontend error visibility (Task 4).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { conceptExtractionService } from "@/lib/ai/services/concept-extraction.service";
import { dailyLogRepository } from "@/lib/repositories/daily-log.repository";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

const extractConceptsSchema = z.object({
  dailyLogId: z.string().uuid("Invalid daily log ID"),
  force: z.boolean().optional().default(false),
});

/**
 * Classify extraction result into an actionable status for the frontend.
 * Added per Audit 1 — Task 4 (extraction error visibility).
 */
function classifyExtractionStatus(result: {
  warnings: string[];
  stats: { totalExtracted: number; persisted: number; skippedInvalidSubject: number };
  jobId: string;
}): {
  extractionStatus: "success" | "empty" | "ai_unavailable" | "in_flight" | "partial" | "error";
  userMessage: string;
} {
  const { warnings, stats, jobId } = result;

  // AI provider not reachable
  if (warnings.some((w) => w.includes("AI provider is not available"))) {
    return {
      extractionStatus: "ai_unavailable",
      userMessage: "AI service is not available. Please ensure Ollama is running and try again.",
    };
  }

  // Job still processing
  if (warnings.includes("Job is still in-flight")) {
    return {
      extractionStatus: "in_flight",
      userMessage: "Extraction is still processing. Please wait a moment and refresh.",
    };
  }

  // All concepts rejected due to subject resolution
  if (stats.totalExtracted > 0 && stats.persisted === 0 && stats.skippedInvalidSubject > 0) {
    return {
      extractionStatus: "partial",
      userMessage: `Extracted ${stats.totalExtracted} concepts but all were filtered (subject mismatch). Try re-extracting.`,
    };
  }

  // AI returned 0 concepts
  if (stats.totalExtracted === 0 && jobId !== "") {
    return {
      extractionStatus: "empty",
      userMessage: "AI returned no concepts. Try adding more detail to your study log, or re-extract.",
    };
  }

  // No jobId = pre-flight failure (health check or other)
  if (jobId === "") {
    return {
      extractionStatus: "error",
      userMessage: warnings[0] || "Extraction could not be started.",
    };
  }

  // Success
  if (stats.persisted > 0) {
    return {
      extractionStatus: "success",
      userMessage: `Successfully extracted ${stats.persisted} concepts.`,
    };
  }

  // Fallback
  return {
    extractionStatus: "error",
    userMessage: warnings[0] || "Extraction completed with unexpected results.",
  };
}

export async function POST(request: NextRequest) {
  try {
    console.log("[ROUTE] extract-concepts: STEP 1 — Auth check");

    // Authenticate
    const user = await getAuthenticatedUser();
    if (!user) {
      return unauthorizedResponse();
    }

    console.log("[ROUTE] extract-concepts: STEP 2 — Parsing body");

    // Validate input
    const body = await request.json();
    const parsed = extractConceptsSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    console.log("[ROUTE] extract-concepts: STEP 3 — Looking up daily log", parsed.data.dailyLogId);

    // Verify the daily log exists and belongs to this user
    const targetLog = await dailyLogRepository.findByIdAndUser(
      parsed.data.dailyLogId,
      user.id
    );

    if (!targetLog) {
      return notFoundResponse("Daily log not found");
    }

    // Check if there's enough content to extract from
    if (!targetLog.rawInput || targetLog.rawInput.trim().length < 10) {
      return validationErrorResponse({
        rawInput: [
          "Study log must contain at least 10 characters for concept extraction",
        ],
      });
    }

    console.log("[ROUTE] extract-concepts: STEP 4 — Starting extraction pipeline");

    // Run concept extraction (idempotent unless force=true)
    const extractionInput = {
      dailyLogId: parsed.data.dailyLogId,
      userId: user.id,
      rawInput: targetLog.rawInput,
      subjects: targetLog.subjects as string[],
    };

    const result = parsed.data.force
      ? await conceptExtractionService.reExtract(extractionInput)
      : await conceptExtractionService.extract(extractionInput);

    console.log("[ROUTE] extract-concepts: STEP 5 — Extraction complete, returning response");

    // ─── Classify extraction status for frontend (Audit 1, Task 4) ────
    const statusInfo = classifyExtractionStatus(result);

    // ─── STEP 6: Fire-and-forget downstream orchestration ────
    // Runs in background — does NOT block the response.
    if (result.stats.persisted > 0) {
      const { conceptRepository } = await import("@/lib/repositories/concept.repository");
      const { cognitiveOrchestrationService } = await import(
        "@/lib/ai/services/cognitive-orchestration.service"
      );

      // Load the persisted concepts for this log
      conceptRepository
        .findByDailyLog(parsed.data.dailyLogId, user.id)
        .then((concepts) => {
          if (concepts.length > 0) {
            console.log(`[ROUTE] extract-concepts: STEP 6 — Orchestrating ${concepts.length} concepts (background)`);
            cognitiveOrchestrationService
              .orchestrateBatch({ concepts, userId: user.id })
              .then(() => cognitiveOrchestrationService.refreshAdaptive(user.id))
              .catch((err) => console.error("[ORCHESTRATE-BG] Error:", err));
          }
        })
        .catch((err) => console.error("[ORCHESTRATE-BG] Load error:", err));
    }

    return successResponse({ ...result, ...statusInfo }, undefined, 201);
  } catch (error) {
    console.error("[ROUTE] extract-concepts: FATAL ERROR:", error);
    return serverErrorResponse();
  }
}
