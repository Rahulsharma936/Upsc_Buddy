/**
 * POST /api/ai/extract-relationships
 * Triggers relationship extraction for a specific concept.
 *
 * GET /api/ai/extract-relationships?conceptId=xxx
 * Retrieves existing relationships for a concept.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { relationshipExtractionService } from "@/lib/ai/services/relationship-extraction.service";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

// ─── POST: Extract relationships ────────────────────────────

const extractRelationshipsSchema = z.object({
  conceptId: z.string().uuid("Invalid concept ID"),
  force: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    console.log("[ROUTE] extract-relationships: STEP 1 — Auth check");
    const user = await getAuthenticatedUser();
    if (!user) {
      return unauthorizedResponse();
    }

    console.log("[ROUTE] extract-relationships: STEP 2 — Parsing body");
    const body = await request.json();
    const parsed = extractRelationshipsSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    console.log("[ROUTE] extract-relationships: STEP 3 — Verifying concept ownership");
    const concept = await conceptRepository.findById(parsed.data.conceptId);
    if (!concept || concept.userId !== user.id) {
      return notFoundResponse("Concept not found");
    }

    // Get all user concepts for target resolution
    const userConcepts = await conceptRepository.findByUser(user.id, 200);
    const existingConceptNames = userConcepts.map((c) => c.displayName);

    console.log("[ROUTE] extract-relationships: STEP 4 — Starting extraction");
    const result = await relationshipExtractionService.extract({
      conceptId: concept.id,
      userId: user.id,
      conceptName: concept.displayName,
      subject: concept.subject,
      keywords: concept.keywords,
      existingConceptNames,
      force: parsed.data.force,
    });

    console.log("[ROUTE] extract-relationships: STEP 5 — Complete");
    return successResponse(result, undefined, 201);

  } catch (error) {
    console.error("[ROUTE] extract-relationships: FATAL ERROR:", error);
    return serverErrorResponse();
  }
}

// ─── GET: Retrieve relationships ────────────────────────────

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

    const concept = await conceptRepository.findById(conceptId);
    if (!concept || concept.userId !== user.id) {
      return notFoundResponse("Concept not found");
    }

    const relationships = await relationshipExtractionService.getRelationships(conceptId);

    // Enrich with concept names — batch query instead of N+1
    const conceptIds = new Set<string>();
    for (const rel of relationships) {
      conceptIds.add(rel.sourceConceptId);
      conceptIds.add(rel.targetConceptId);
    }

    const relatedConcepts = conceptIds.size > 0
      ? await conceptRepository.findByIds(Array.from(conceptIds))
      : [];

    const conceptMap = new Map<string, { displayName: string; subject: string }>();
    for (const c of relatedConcepts) {
      conceptMap.set(c.id, { displayName: c.displayName, subject: c.subject });
    }

    const enriched = relationships.map((rel) => ({
      id: rel.id,
      sourceConcept: conceptMap.get(rel.sourceConceptId) ?? { displayName: "Unknown", subject: "" },
      targetConcept: conceptMap.get(rel.targetConceptId) ?? { displayName: "Unknown", subject: "" },
      relationshipType: rel.relationshipType,
      strength: rel.relationshipStrength,
      reason: rel.relationshipReason,
      crossSubject: rel.crossSubject,
      createdAt: rel.createdAt,
    }));

    return successResponse({
      conceptId,
      relationships: enriched,
      count: enriched.length,
    });

  } catch (error) {
    console.error("[ROUTE] extract-relationships GET: ERROR:", error);
    return serverErrorResponse();
  }
}
