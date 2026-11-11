/**
 * GET /api/notes
 * Returns all concepts with their latest notes for the authenticated user.
 * Safe: degrades gracefully if ai_notes table hasn't been migrated yet.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import {
  successResponse,
  unauthorizedResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject");
    const conceptId = searchParams.get("conceptId");
    // Default high enough that Knowledge and Revision see every concept —
    // the old default of 50 hid older concepts and starved Revision's note lookup.
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "500"), 1000);

    let concepts;
    try {
      if (conceptId) {
        const single = await conceptRepository.findById(conceptId);
        concepts = single && single.userId === user.id ? [single] : [];
      } else {
        concepts = subject
          ? await conceptRepository.findBySubject(user.id, subject)
          : await conceptRepository.findByUser(user.id, limit);
      }
    } catch (dbError) {
      console.error("[ROUTE] notes: DB error fetching concepts:", dbError);
      return successResponse({
        items: [],
        summary: { totalConcepts: 0, withNotes: 0, withoutNotes: 0 },
      });
    }

    if (concepts.length === 0) {
      return successResponse({
        items: [],
        summary: { totalConcepts: 0, withNotes: 0, withoutNotes: 0 },
      });
    }

    // Fetch latest notes — degrade gracefully if migration pending
    let notesMap = new Map<string, Record<string, unknown>>();
    try {
      const { noteRepository } = await import("@/lib/repositories/note.repository");
      const conceptIds = concepts.map((c) => c.id);
      notesMap = await noteRepository.findLatestForConcepts(conceptIds);
    } catch (noteError) {
      console.error("[ROUTE] notes: Notes query failed (migration may be pending):", noteError);
    }

    const enriched = concepts.map((concept) => {
      const note = notesMap.get(concept.id) as Record<string, unknown> | undefined;
      return {
        concept: {
          id: concept.id,
          displayName: concept.displayName,
          subject: concept.subject,
          keywords: concept.keywords,
          difficulty: concept.difficulty,
          confidence: concept.extractionConfidence,
        },
        note: note
          ? {
              id: note.id,
              version: note.version,
              coreIdea: note.coreIdea ?? "",
              examTriggers: note.examTriggers ?? [],
              staticCurrentLink: note.staticCurrentLink ?? [],
              answerWritingAngles: note.answerWritingAngles ?? [],
              memoryHooks: note.memoryHooks ?? [],
              generatedBy: note.generatedBy,
              createdAt: note.createdAt,
            }
          : null,
        hasNote: !!note,
      };
    });

    const withNotes = enriched.filter((e) => e.hasNote).length;

    return successResponse({
      items: enriched,
      summary: {
        totalConcepts: concepts.length,
        withNotes,
        withoutNotes: concepts.length - withNotes,
      },
    });

  } catch (error) {
    console.error("[ROUTE] notes: FATAL ERROR:", error);
    return serverErrorResponse();
  }
}
