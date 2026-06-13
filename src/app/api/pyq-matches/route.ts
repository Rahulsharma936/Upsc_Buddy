/**
 * POST /api/pyq-matches — Trigger PYQ matching for a concept.
 * GET  /api/pyq-matches?conceptId=xxx — Retrieve PYQ matches.
 *
 * Phase 2E: PYQ intelligence layer.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { pyqMatchingService } from "@/lib/ai/services/pyq-matching.service";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

// ─── POST: Match PYQs ───────────────────────────────────────

const matchPyqSchema = z.object({
  conceptId: z.string().uuid("Invalid concept ID"),
  force: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const parsed = matchPyqSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    const concept = await conceptRepository.findById(parsed.data.conceptId);
    if (!concept || concept.userId !== user.id) {
      return notFoundResponse("Concept not found");
    }

    const result = await pyqMatchingService.matchConcept({
      conceptId: concept.id,
      userId: user.id,
      force: parsed.data.force,
    });

    return successResponse(result, undefined, 201);
  } catch (error) {
    console.error("[ROUTE] pyq-matches POST:", error);
    return serverErrorResponse();
  }
}

// ─── GET: Retrieve PYQ matches ──────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const conceptId = searchParams.get("conceptId");

    if (!conceptId) {
      return validationErrorResponse({
        conceptId: ["conceptId query parameter is required"],
      });
    }

    const concept = await conceptRepository.findById(conceptId);
    if (!concept || concept.userId !== user.id) {
      return notFoundResponse("Concept not found");
    }

    const matches = await pyqMatchingService.getMatches(conceptId);

    return successResponse({
      conceptId,
      matches,
      count: matches.length,
    });
  } catch (error) {
    console.error("[ROUTE] pyq-matches GET:", error);
    return serverErrorResponse();
  }
}
