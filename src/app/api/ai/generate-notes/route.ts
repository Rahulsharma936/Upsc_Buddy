/**
 * POST /api/ai/generate-notes
 * Generates revision notes for a specific concept.
 * 
 * GET /api/ai/generate-notes?conceptId=xxx
 * Retrieves the latest note for a concept.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { noteGenerationService } from "@/lib/ai/services/note-generation.service";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

// ─── POST: Generate notes ───────────────────────────────────

const generateNotesSchema = z.object({
  conceptId: z.string().uuid("Invalid concept ID"),
  force: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    console.log("[ROUTE] generate-notes: STEP 1 — Auth check");
    const user = await getAuthenticatedUser();
    if (!user) {
      return unauthorizedResponse();
    }

    console.log("[ROUTE] generate-notes: STEP 2 — Parsing body");
    const body = await request.json();
    const parsed = generateNotesSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    console.log("[ROUTE] generate-notes: STEP 3 — Verifying concept ownership");
    // Verify concept exists and belongs to user
    const concept = await conceptRepository.findById(parsed.data.conceptId);
    if (!concept || concept.userId !== user.id) {
      return notFoundResponse("Concept not found");
    }

    console.log("[ROUTE] generate-notes: STEP 4 — Starting note generation");
    const result = await noteGenerationService.generate({
      conceptId: concept.id,
      userId: user.id,
      conceptName: concept.displayName,
      subject: concept.subject,
      keywords: concept.keywords,
      difficulty: concept.difficulty,
      force: parsed.data.force,
    });

    console.log("[ROUTE] generate-notes: STEP 5 — Complete");
    return successResponse(result, undefined, 201);

  } catch (error) {
    console.error("[ROUTE] generate-notes: FATAL ERROR:", error);
    return serverErrorResponse();
  }
}

// ─── GET: Retrieve notes ────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const conceptId = searchParams.get("conceptId");

    if (!conceptId) {
      return validationErrorResponse({
        conceptId: ["conceptId query parameter is required"],
      });
    }

    // Verify concept belongs to user
    const concept = await conceptRepository.findById(conceptId);
    if (!concept || concept.userId !== user.id) {
      return notFoundResponse("Concept not found");
    }

    const includeVersions = searchParams.get("versions") === "true";

    if (includeVersions) {
      const versions = await noteGenerationService.getNoteVersions(conceptId);
      return successResponse({ conceptId, versions });
    }

    const latestNote = await noteGenerationService.getLatestNote(conceptId);
    if (!latestNote) {
      return notFoundResponse("No notes generated for this concept yet");
    }

    return successResponse({
      conceptId,
      note: latestNote,
    });

  } catch (error) {
    console.error("[ROUTE] generate-notes GET: ERROR:", error);
    return serverErrorResponse();
  }
}
