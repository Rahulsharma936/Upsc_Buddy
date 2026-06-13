/**
 * Context Intelligence Service — Phase 3A.
 *
 * Orchestrates: GS Mapping (deterministic) → Context Generation (AI) → Persistence.
 *
 * Flow:
 * 1. Deterministic GS mapping via ontology engine
 * 2. AI-generated analytical context dimensions
 * 3. Validation (Zod + hallucination safeguards)
 * 4. Persistence via concept-context repository
 *
 * Anti-hallucination safeguards:
 * - GS mappings are PURELY deterministic (no AI)
 * - Context dimensions validated via Zod (nullable fields)
 * - Empty dimensions are intentional and desirable
 * - Generic filler is detected and stripped
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { conceptContextRepository } from "@/lib/repositories/concept-context.repository";
import { mapConceptToSyllabus, type GSMappingResult } from "./gs-mapping.engine";
import { getContextIntelligencePrompt, CONTEXT_INTELLIGENCE_VERSION } from "@/lib/ai/prompts";
import { contextIntelligenceResponseSchema, type ValidatedContextIntelligence } from "@/lib/ai/schemas";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import { createProvider } from "@/lib/ai/provider";
import { getAIConfig } from "@/lib/ai/constants";
import { createAILogger } from "@/lib/ai/utils/logger";
import type { Concept, ConceptContextRecord } from "@/types/database.types";

const log = createAILogger("context-intelligence");

// ─── Generic filler phrases to detect and strip ─────────────

const GENERIC_FILLER_PATTERNS = [
  /^this (topic|concept|subject) is (very |extremely |quite )?(important|relevant|significant)/i,
  /^(it is|this is) (a |an )?(crucial|vital|essential|key) (topic|area|concept)/i,
  /^(upsc|the exam) (often |frequently )?(asks|tests|covers)/i,
  /^aspirants (should|must|need to) (study|understand|know)/i,
];

function isGenericFiller(text: string | null): boolean {
  if (!text) return false;
  return GENERIC_FILLER_PATTERNS.some((p) => p.test(text.trim()));
}

function sanitizeDimension(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length < 10) return null; // Too short to be useful
  if (isGenericFiller(trimmed)) return null; // Generic coaching fluff
  return trimmed;
}

// ─── Service ────────────────────────────────────────────────

export const contextIntelligenceService = {
  /**
   * Generate GS mapping + context intelligence for a concept.
   */
  async generate(params: {
    conceptId: string;
    userId: string;
    force?: boolean;
  }): Promise<{
    context: ConceptContextRecord;
    gsMapping: GSMappingResult;
    stats: {
      mappingTimeMs: number;
      contextTimeMs: number;
      dimensionsGenerated: number;
      dimensionsSanitized: number;
    };
  }> {
    const startTime = Date.now();
    const stats = {
      mappingTimeMs: 0,
      contextTimeMs: 0,
      dimensionsGenerated: 0,
      dimensionsSanitized: 0,
    };

    console.log("[GS-CONTEXT] STEP 1: Loading concept");

    // ─── Load concept ────────────────────────────────────
    const concept = await conceptRepository.findById(params.conceptId);
    if (!concept || concept.userId !== params.userId) {
      throw new Error("Concept not found or access denied");
    }

    // ─── Idempotency check ───────────────────────────────
    if (!params.force) {
      const existing = await conceptContextRepository.findByConcept(params.conceptId);
      if (existing) {
        console.log("[GS-CONTEXT] Returning cached context");
        return {
          context: existing,
          gsMapping: {
            primaryPaper: existing.primaryPaper as any,
            mappings: (existing.gsMappings as any[]) ?? [],
            mappingConfidence: Number(existing.mappingConfidence),
            stats: { candidatesEvaluated: 0, mappingsAccepted: 0, mappingsRejected: 0 },
          },
          stats,
        };
      }
    } else {
      await conceptContextRepository.deleteByConcept(params.conceptId);
    }

    // ─── Step 2: Deterministic GS mapping ────────────────
    console.log("[GS-CONTEXT] STEP 2: Deterministic GS mapping");
    const mappingStart = Date.now();
    const gsMapping = mapConceptToSyllabus(concept);
    stats.mappingTimeMs = Date.now() - mappingStart;

    console.log("[GS-CONTEXT] GS mapping result:", {
      primaryPaper: gsMapping.primaryPaper,
      mappings: gsMapping.mappings.length,
      confidence: gsMapping.mappingConfidence,
    });

    // ─── Step 3: AI context generation ───────────────────
    console.log("[GS-CONTEXT] STEP 3: AI context generation");
    const contextStart = Date.now();

    const gsMappingSummary = gsMapping.mappings.length > 0
      ? gsMapping.mappings.map((m) => `${m.paper} → ${m.domain} → ${m.subtopic}`).join("; ")
      : `${gsMapping.primaryPaper} (no specific subtopic match)`;

    const prompt = getContextIntelligencePrompt({
      conceptName: concept.displayName,
      subject: concept.subject,
      keywords: (concept.keywords ?? []).join(", "),
      primaryPaper: gsMapping.primaryPaper,
      gsMappings: gsMappingSummary,
    });

    let contextDimensions: ValidatedContextIntelligence = {
      constitutionalRelevance: null,
      governanceRelevance: null,
      ethicalDimension: null,
      policyImplications: null,
      economicImplications: null,
      currentAffairsSignificance: null,
      staticDynamicLink: null,
      confidence: 0.5,
    };

    try {
      const config = getAIConfig();
      const provider = createProvider(config);

      const aiResponse = await provider.complete({
        prompt: prompt.user,
        systemPrompt: prompt.system,
        temperature: 0.2,
        maxTokens: 2048,
        format: "json",
      });

      const validationResult = validateAIResponse(
        aiResponse.content,
        contextIntelligenceResponseSchema
      );

      if (validationResult.success && validationResult.data) {
        contextDimensions = validationResult.data;
      } else {
        log.warn("Context intelligence validation failed", {
          errors: validationResult.errors,
          conceptId: params.conceptId,
        });
      }
    } catch (err) {
      log.error("Context intelligence AI call failed", {
        error: err instanceof Error ? err.message : String(err),
        conceptId: params.conceptId,
      });
      // Graceful degradation — proceed with empty dimensions
    }

    stats.contextTimeMs = Date.now() - contextStart;

    // ─── Step 4: Sanitize dimensions ─────────────────────
    console.log("[GS-CONTEXT] STEP 4: Sanitizing dimensions");

    const sanitized = {
      constitutionalRelevance: sanitizeDimension(contextDimensions.constitutionalRelevance),
      governanceRelevance: sanitizeDimension(contextDimensions.governanceRelevance),
      ethicalDimension: sanitizeDimension(contextDimensions.ethicalDimension),
      policyImplications: sanitizeDimension(contextDimensions.policyImplications),
      economicImplications: sanitizeDimension(contextDimensions.economicImplications),
      currentAffairsSignificance: sanitizeDimension(contextDimensions.currentAffairsSignificance),
      staticDynamicLink: sanitizeDimension(contextDimensions.staticDynamicLink),
    };

    // Count dimensions
    const dimensionKeys = Object.keys(sanitized) as (keyof typeof sanitized)[];
    for (const key of dimensionKeys) {
      if (contextDimensions[key]) stats.dimensionsGenerated++;
      if (contextDimensions[key] && !sanitized[key]) stats.dimensionsSanitized++;
    }

    console.log("[GS-CONTEXT] Dimensions:", {
      generated: stats.dimensionsGenerated,
      sanitized: stats.dimensionsSanitized,
      kept: stats.dimensionsGenerated - stats.dimensionsSanitized,
    });

    // ─── Step 5: Persist ─────────────────────────────────
    console.log("[GS-CONTEXT] STEP 5: Persisting");

    const context = await conceptContextRepository.upsert({
      conceptId: params.conceptId,
      primaryPaper: gsMapping.primaryPaper,
      gsMappings: gsMapping.mappings,
      ...sanitized,
      mappingConfidence: String(gsMapping.mappingConfidence),
      contextConfidence: String(contextDimensions.confidence),
      generationMetadata: {
        version: CONTEXT_INTELLIGENCE_VERSION,
        mappingStats: gsMapping.stats,
        totalTimeMs: Date.now() - startTime,
        dimensionsGenerated: stats.dimensionsGenerated,
        dimensionsSanitized: stats.dimensionsSanitized,
      },
    });

    console.log("[GS-CONTEXT] STEP 6: Complete", {
      conceptId: params.conceptId,
      primaryPaper: gsMapping.primaryPaper,
      mappings: gsMapping.mappings.length,
      totalTimeMs: Date.now() - startTime,
    });

    return { context, gsMapping, stats };
  },

  /**
   * Get existing context intelligence for a concept.
   */
  async getContext(conceptId: string): Promise<ConceptContextRecord | undefined> {
    return conceptContextRepository.findByConcept(conceptId);
  },
};
