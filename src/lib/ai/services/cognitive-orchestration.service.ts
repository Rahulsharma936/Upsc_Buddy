/**
 * Cognitive Orchestration Service — Phase 4.5.
 *
 * Connects all intelligence pipelines into a lifecycle.
 * After concept creation, automatically hydrates downstream systems:
 *
 * Concept → Notes → Relationships → PYQs → GS/Context → Questions → Revision
 *
 * Design rules:
 * - Each layer is isolated: failure in one does NOT block others
 * - All layers are idempotent: safe to retry
 * - No tight coupling: orchestrator calls services, never the reverse
 * - Processing state tracked per concept per layer
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteGenerationService } from "./note-generation.service";
import { relationshipExtractionService } from "./relationship-extraction.service";
import { pyqMatchingService } from "./pyq-matching.service";
import { contextIntelligenceService } from "./context-intelligence.service";
import { questionIntelligenceService } from "./question-intelligence.service";
import { revisionIntelligenceService } from "./revision-intelligence.service";
import { adaptiveIntelligenceService } from "./adaptive-intelligence.service";
import type { Concept } from "@/types/database.types";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type LayerName =
  | "notes"
  | "relationships"
  | "pyq_matching"
  | "context"
  | "questions"
  | "revision";

export type LayerStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

export interface LayerResult {
  layer: LayerName;
  status: LayerStatus;
  durationMs: number;
  error?: string;
}

export interface OrchestrationResult {
  conceptId: string;
  conceptName: string;
  layers: LayerResult[];
  totalDurationMs: number;
  completedCount: number;
  failedCount: number;
}

export interface BackfillResult {
  totalConcepts: number;
  processed: number;
  skipped: number;
  results: OrchestrationResult[];
  totalDurationMs: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER DEFINITIONS (ordered by dependency)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Layer execution order respects dependencies:
 * 1. Notes (standalone)
 * 2. Relationships (needs concept + other concepts for linking)
 * 3. PYQ matching (needs concept)
 * 4. Context/GS mapping (needs concept)
 * 5. Questions (benefits from notes + context)
 * 6. Revision init (needs concept)
 */
const LAYER_ORDER: LayerName[] = [
  "notes",
  "relationships",
  "pyq_matching",
  "context",
  "questions",
  "revision",
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVICE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const cognitiveOrchestrationService = {
  /**
   * Orchestrate all intelligence layers for a single concept.
   * Each layer is isolated — failure in one doesn't block others.
   */
  async orchestrateConcept(params: {
    concept: Concept;
    userId: string;
    /** Only run specific layers (default: all) */
    layers?: LayerName[];
  }): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const { concept, userId } = params;
    const targetLayers = params.layers ?? LAYER_ORDER;
    const results: LayerResult[] = [];

    console.log(`[ORCHESTRATE] Starting for concept: ${concept.displayName} (${concept.id})`);

    for (const layer of LAYER_ORDER) {
      if (!targetLayers.includes(layer)) {
        results.push({ layer, status: "skipped", durationMs: 0 });
        continue;
      }

      const layerStart = Date.now();
      try {
        await executeLayer(layer, concept, userId);
        results.push({
          layer,
          status: "completed",
          durationMs: Date.now() - layerStart,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[ORCHESTRATE] Layer ${layer} failed for ${concept.displayName}:`, message);
        results.push({
          layer,
          status: "failed",
          durationMs: Date.now() - layerStart,
          error: message,
        });
        // Continue to next layer — isolated failure
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const completedCount = results.filter((r) => r.status === "completed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    console.log(
      `[ORCHESTRATE] Done: ${concept.displayName} — ${completedCount} completed, ${failedCount} failed, ${totalDurationMs}ms`
    );

    return {
      conceptId: concept.id,
      conceptName: concept.displayName,
      layers: results,
      totalDurationMs,
      completedCount,
      failedCount,
    };
  },

  /**
   * Orchestrate all intelligence layers for a batch of concepts.
   * Processes sequentially to avoid overwhelming the AI provider.
   */
  async orchestrateBatch(params: {
    concepts: Concept[];
    userId: string;
    layers?: LayerName[];
  }): Promise<OrchestrationResult[]> {
    const results: OrchestrationResult[] = [];

    for (const concept of params.concepts) {
      const result = await this.orchestrateConcept({
        concept,
        userId: params.userId,
        layers: params.layers,
      });
      results.push(result);
    }

    return results;
  },

  /**
   * Backfill: hydrate all existing concepts that are missing intelligence.
   * Loads ALL concepts (oldest-first), detects which layers are missing,
   * and generates only the missing ones.
   *
   * Processes in batches to avoid overwhelming the AI provider.
   * limit = max concepts to actually PROCESS (not load).
   */
  async backfillUser(params: {
    userId: string;
    limit?: number;
    layers?: LayerName[];
    /** Starting offset — for manual pagination across API calls */
    offset?: number;
  }): Promise<BackfillResult> {
    const startTime = Date.now();
    const maxProcess = params.limit ?? 10;
    const offset = params.offset ?? 0;
    const targetLayers = params.layers ?? LAYER_ORDER;

    console.log(`[BACKFILL] Starting for user ${params.userId}, maxProcess=${maxProcess}, offset=${offset}`);

    // Load ALL concepts (oldest-first for hydration)
    const allConcepts = await conceptRepository.findAllByUser(params.userId);

    if (allConcepts.length === 0) {
      return {
        totalConcepts: 0,
        processed: 0,
        skipped: 0,
        results: [],
        totalDurationMs: Date.now() - startTime,
      };
    }

    // Apply offset for pagination
    const conceptsToAudit = allConcepts.slice(offset);

    console.log(`[BACKFILL] Total concepts: ${allConcepts.length}, auditing from offset ${offset}: ${conceptsToAudit.length}`);

    const results: OrchestrationResult[] = [];
    let skipped = 0;
    let audited = 0;

    for (const concept of conceptsToAudit) {
      // Stop if we've processed enough
      if (results.length >= maxProcess) break;

      audited++;

      // Detect which layers are missing for this concept
      const missingLayers = await detectMissingLayers(concept, params.userId, targetLayers);

      if (missingLayers.length === 0) {
        skipped++;
        continue;
      }

      console.log(
        `[BACKFILL] ${concept.displayName}: missing [${missingLayers.join(", ")}]`
      );

      const result = await this.orchestrateConcept({
        concept,
        userId: params.userId,
        layers: missingLayers,
      });
      results.push(result);
    }

    const totalDurationMs = Date.now() - startTime;
    console.log(
      `[BACKFILL] Done: ${results.length} processed, ${skipped} skipped, ${audited} audited, ${totalDurationMs}ms`
    );

    return {
      totalConcepts: allConcepts.length,
      processed: results.length,
      skipped,
      results,
      totalDurationMs,
    };
  },

  /**
   * Trigger adaptive intelligence recomputation for a user.
   * Called after batch orchestration completes.
   */
  async refreshAdaptive(userId: string): Promise<void> {
    try {
      await adaptiveIntelligenceService.getAdaptiveIntelligence({
        userId,
        force: true,
      });
      console.log("[ORCHESTRATE] Adaptive intelligence refreshed");
    } catch (err) {
      console.error("[ORCHESTRATE] Adaptive refresh failed:", err);
      // Non-critical — don't throw
    }
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYER EXECUTORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function executeLayer(
  layer: LayerName,
  concept: Concept,
  userId: string
): Promise<void> {
  switch (layer) {
    case "notes":
      await noteGenerationService.generate({
        conceptId: concept.id,
        userId,
        conceptName: concept.displayName,
        subject: concept.subject,
        keywords: (concept.keywords as string[]) ?? [],
        difficulty: concept.difficulty ?? "intermediate",
        force: false, // Idempotent — skip if exists
      });
      break;

    case "relationships": {
      // Get all concepts for this user (for cross-concept linking)
      const allConcepts = await conceptRepository.findByUser(userId, 200);
      const existingNames = allConcepts
        .filter((c) => c.id !== concept.id)
        .map((c) => c.displayName);

      await relationshipExtractionService.extract({
        conceptId: concept.id,
        userId,
        conceptName: concept.displayName,
        subject: concept.subject,
        keywords: (concept.keywords as string[]) ?? [],
        existingConceptNames: existingNames,
        force: false,
      });
      break;
    }

    case "pyq_matching":
      await pyqMatchingService.matchConcept({
        conceptId: concept.id,
        userId,
        force: false,
      });
      break;

    case "context":
      await contextIntelligenceService.generate({
        conceptId: concept.id,
        userId,
        force: false,
      });
      break;

    case "questions":
      await questionIntelligenceService.generate({
        conceptId: concept.id,
        userId,
        force: false,
      });
      break;

    case "revision":
      await revisionIntelligenceService.initializeForConcept({
        userId,
        conceptId: concept.id,
      });
      break;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MISSING LAYER DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Detect which layers are missing for a concept.
 * Uses repository checks (not AI calls) — fast and safe.
 */
async function detectMissingLayers(
  concept: Concept,
  userId: string,
  targetLayers: LayerName[]
): Promise<LayerName[]> {
  const missing: LayerName[] = [];

  // Import repositories lazily to avoid circular deps
  const { noteRepository } = await import("@/lib/repositories/note.repository");
  const { relationshipRepository } = await import("@/lib/repositories/relationship.repository");
  const { pyqMatchRepository } = await import("@/lib/repositories/pyq-match.repository");
  const { conceptContextRepository } = await import("@/lib/repositories/concept-context.repository");
  const { conceptQuestionsRepository } = await import("@/lib/repositories/concept-questions.repository");
  const { revisionRepository } = await import("@/lib/repositories/revision.repository");

  for (const layer of targetLayers) {
    try {
      let exists = false;

      switch (layer) {
        case "notes":
          exists = !!(await noteRepository.findLatestByConceptId(concept.id));
          break;
        case "relationships":
          exists = (await relationshipRepository.findByConcept(concept.id)).length > 0;
          break;
        case "pyq_matching":
          exists = (await pyqMatchRepository.findByConcept(concept.id)).length > 0;
          break;
        case "context":
          exists = !!(await conceptContextRepository.findByConcept(concept.id));
          break;
        case "questions": {
          const qRecord = await conceptQuestionsRepository.findByConcept(concept.id);
          // Treat empty-array records as missing (failed previous generation)
          if (qRecord) {
            const p = (qRecord.prelimsMcqs as any[])?.length ?? 0;
            const m = (qRecord.mainsQuestions as any[])?.length ?? 0;
            const i = (qRecord.interviewPrompts as any[])?.length ?? 0;
            exists = p > 0 || m > 0 || i > 0;
          }
          break;
        }
        case "revision":
          exists = !!(await revisionRepository.getMastery(userId, concept.id));
          break;
      }

      if (!exists) missing.push(layer);
    } catch {
      // Table may not exist yet — treat as missing
      missing.push(layer);
    }
  }

  return missing;
}
