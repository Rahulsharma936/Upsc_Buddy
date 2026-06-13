/**
 * Relationship extraction service — Phase 2D.
 *
 * Pipeline:
 * Concept → Job → AI Provider → JSON Repair + Zod →
 * Type Validation → Reason Normalization → Target Resolution →
 * Cross-Subject Detection → Strength Calibration → Dedup →
 * Persistence → Job Completion
 *
 * Follows exact same patterns as concept-extraction.service
 * and note-generation.service.
 */

import { executeWithRetry } from "@/lib/ai/client";
import { getAIConfig } from "@/lib/ai/constants";
import { getRelationshipExtractionPrompt, RELATIONSHIP_VERSION } from "@/lib/ai/prompts";
import { relationshipExtractionResponseSchema } from "@/lib/ai/schemas";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import {
  normalizeReason,
  normalizeRelationshipType,
  isCrossSubject,
  calibrateStrength,
  spreadClusteredScores,
  generateDedupKey,
  MIN_RELATIONSHIP_STRENGTH,
} from "@/lib/ai/utils/relationship-normalize";
import { createAILogger } from "@/lib/ai/utils/logger";
import { aiProcessingService } from "./ai-processing.service";
import { relationshipRepository } from "@/lib/repositories/relationship.repository";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import type {
  RelationshipExtractionInput,
  RelationshipExtractionResult,
  RelationshipExtractionStats,
  RelationshipExtractionMetadata,
  ExtractedRelationship,
} from "@/lib/ai/types";

const log = createAILogger("relationship-extraction");

export const relationshipExtractionService = {
  /**
   * Extract relationships for a single concept.
   */
  async extract(input: RelationshipExtractionInput): Promise<RelationshipExtractionResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const stats: RelationshipExtractionStats = {
      totalExtracted: 0,
      persisted: 0,
      skippedSelfLoop: 0,
      skippedDuplicate: 0,
      skippedWeakStrength: 0,
      skippedUnknownTarget: 0,
      crossSubjectCount: 0,
    };

    console.log("[REL-EXTRACT] STEP 1: Validating source concept");

    // ─── Validate source concept ─────────────────────────────
    const sourceConcept = await conceptRepository.findById(input.conceptId);
    if (!sourceConcept) {
      throw new Error(`Source concept not found: ${input.conceptId}`);
    }

    // ─── Idempotency: check existing relationships ───────────
    if (!input.force) {
      console.log("[REL-EXTRACT] STEP 2: Idempotency check");
      const existing = await relationshipRepository.findBySource(input.conceptId);

      if (existing.length > 0) {
        log.info("Relationships already exist — returning cached", {
          conceptId: input.conceptId,
          count: existing.length,
        });

        // Resolve target concept names for cached results
        const targetIds = existing.map((r) => r.targetConceptId);
        const targetConcepts = await conceptRepository.findByIds(targetIds);
        const nameMap = new Map(targetConcepts.map((c) => [c.id, c.displayName]));

        return {
          jobId: "",
          sourceConceptId: input.conceptId,
          relationships: existing.map((r) => ({
            targetConceptName: nameMap.get(r.targetConceptId) ?? "Unknown",
            relationshipType: r.relationshipType as ExtractedRelationship["relationshipType"],
            reason: r.relationshipReason,
            strength: r.relationshipStrength,
          })),
          warnings: [],
          stats: { ...stats, persisted: existing.length },
          processingTimeMs: 0,
        };
      }
    } else {
      // Force mode: delete existing relationships first
      const deleted = await relationshipRepository.deleteBySource(input.conceptId);
      if (deleted > 0) {
        log.info("Force mode: deleted existing relationships", {
          conceptId: input.conceptId,
          deleted,
        });
      }
    }

    // ─── Create processing job ───────────────────────────────
    console.log("[REL-EXTRACT] STEP 3: Creating job");
    const job = await aiProcessingService.createJob({
      userId: input.userId,
      jobType: "relationship_extraction",
    });

    try {
      await aiProcessingService.startJob(job.id);

      // ─── Build prompt ──────────────────────────────────────
      // Build the list of other concept names the AI can link to
      const userConcepts = await conceptRepository.findByUser(input.userId, 200);
      const otherConceptNames = userConcepts
        .filter((c) => c.id !== input.conceptId)
        .map((c) => c.displayName);

      console.log("[REL-EXTRACT] STEP 4: Calling AI provider", {
        sourceConcept: input.conceptName,
        availableTargets: otherConceptNames.length,
        targetNames: otherConceptNames,
      });

      if (otherConceptNames.length === 0) {
        log.info("No other concepts to link — skipping AI call", {
          conceptId: input.conceptId,
        });

        await aiProcessingService.completeJob(job.id, {
          generationVersion: RELATIONSHIP_VERSION,
        });

        return {
          jobId: job.id,
          sourceConceptId: input.conceptId,
          relationships: [],
          warnings: ["No other concepts available for relationship extraction"],
          stats,
          processingTimeMs: Date.now() - startTime,
        };
      }

      const prompt = getRelationshipExtractionPrompt({
        conceptName: input.conceptName,
        subject: input.subject,
        existingConcepts: otherConceptNames.map((n) => `- ${n}`).join("\n"),
      });

      const config = getAIConfig();
      const aiResponse = await executeWithRetry({
        prompt: prompt.user,
        systemPrompt: prompt.system,
        temperature: config.defaultTemperature,
        maxTokens: config.defaultMaxTokens,
        format: "json",
      });

      console.log("[REL-EXTRACT] STEP 4: AI response received", {
        latencyMs: aiResponse.latencyMs,
        contentLength: aiResponse.content.length,
      });

      // ─── Validate AI output ────────────────────────────────
      console.log("[REL-EXTRACT] STEP 5: Validating AI output");
      console.log("[REL-EXTRACT] Raw AI response:", aiResponse.content.slice(0, 500));

      const validationResult = validateAIResponse(
        aiResponse.content,
        relationshipExtractionResponseSchema
      );

      if (!validationResult.success) {
        const errorMsg = `Relationship validation failed: ${validationResult.errors.join("; ")}`;
        log.error(errorMsg, { jobId: job.id, conceptId: input.conceptId });

        await aiProcessingService.failJob(job.id, errorMsg, {
          latencyMs: aiResponse.latencyMs,
          model: aiResponse.model,
          provider: aiResponse.provider,
          parserStrategyUsed: validationResult.jsonRepairApplied,
        });

        return {
          jobId: job.id,
          sourceConceptId: input.conceptId,
          relationships: [],
          warnings: [errorMsg],
          stats,
          processingTimeMs: Date.now() - startTime,
        };
      }

      const rawRelationships = validationResult.data!.relationships;
      stats.totalExtracted = rawRelationships.length;

      console.log("[REL-EXTRACT] STEP 6: Processing", rawRelationships.length, "relationships");

      // ─── Build user's concept lookup map (reuse already-fetched userConcepts) ───
      const conceptNameMap = new Map<string, typeof userConcepts[0]>();
      for (const c of userConcepts) {
        conceptNameMap.set(c.normalizedName, c);
        conceptNameMap.set(c.displayName.toLowerCase(), c);
        conceptNameMap.set(c.name.toLowerCase(), c);
      }

      console.log("[REL-EXTRACT] Concept lookup map has", conceptNameMap.size, "entries");

      // ─── Process each relationship ─────────────────────────
      const seenDedupKeys = new Set<string>();
      const toInsert: Array<{
        sourceConceptId: string;
        targetConceptId: string;
        relationshipType: string;
        relationshipStrength: number;
        relationshipReason: string;
        crossSubject: boolean;
        generatedBy: string;
        relationshipMetadata: RelationshipExtractionMetadata;
      }> = [];

      const validRelationships: ExtractedRelationship[] = [];

      for (const raw of rawRelationships) {
        console.log("[REL-EXTRACT] Processing relationship:", {
          targetName: raw.targetConceptName,
          type: raw.relationshipType,
          strength: raw.strength,
        });

        // Validate relationship type
        const normalizedType = normalizeRelationshipType(raw.relationshipType);
        if (!normalizedType) {
          warnings.push(`Invalid relationship type: ${raw.relationshipType}`);
          console.log("[REL-EXTRACT] SKIP: Invalid type:", raw.relationshipType);
          continue;
        }

        // Resolve target concept — multi-tier matching
        const targetKey = raw.targetConceptName.toLowerCase().trim();
        let targetConcept = conceptNameMap.get(targetKey);

        // Fallback: fuzzy match (AI often slightly modifies names)
        if (!targetConcept) {
          for (const c of userConcepts) {
            const dn = c.displayName.toLowerCase();
            const nn = c.normalizedName;
            // Check if AI name contains the concept name or vice versa
            if (
              dn.includes(targetKey) ||
              targetKey.includes(dn) ||
              nn.includes(targetKey) ||
              targetKey.includes(nn)
            ) {
              targetConcept = c;
              console.log("[REL-EXTRACT] Fuzzy match:", targetKey, "→", c.displayName);
              break;
            }
          }
        }

        if (!targetConcept) {
          stats.skippedUnknownTarget++;
          console.log("[REL-EXTRACT] SKIP: Target not found (exact + fuzzy):", {
            searchKey: targetKey,
            availableNames: userConcepts.map((c) => c.displayName),
          });
          continue;
        }

        // Prevent self-loops
        if (targetConcept.id === input.conceptId) {
          stats.skippedSelfLoop++;
          continue;
        }

        // Normalize reason
        const reason = normalizeReason(raw.reason);

        // Detect cross-subject
        const crossSubject = isCrossSubject(sourceConcept.subject, targetConcept.subject);
        if (crossSubject) stats.crossSubjectCount++;

        // Calibrate strength
        const strength = calibrateStrength({
          rawStrength: raw.strength,
          crossSubject,
          reasonLength: reason.length,
          relationshipType: normalizedType,
          reason,
        });

        // Filter weak relationships
        if (strength < MIN_RELATIONSHIP_STRENGTH) {
          stats.skippedWeakStrength++;
          warnings.push(`Weak relationship filtered: ${raw.targetConceptName} (${strength})`);
          continue;
        }

        // Dedup check (in-batch)
        const dedupKey = generateDedupKey(input.conceptId, targetConcept.id, normalizedType);
        if (seenDedupKeys.has(dedupKey)) {
          stats.skippedDuplicate++;
          continue;
        }
        seenDedupKeys.add(dedupKey);

        // Dedup check (database — including mirror direction)
        const existsInDB = await relationshipRepository.existsEdge(
          input.conceptId,
          targetConcept.id,
          normalizedType
        );
        if (existsInDB) {
          stats.skippedDuplicate++;
          continue;
        }

        const metadata: RelationshipExtractionMetadata = {
          extractionVersion: RELATIONSHIP_VERSION,
          provider: aiResponse.provider,
          model: aiResponse.model,
          generationTimeMs: aiResponse.latencyMs,
          parserStrategyUsed: validationResult.jsonRepairApplied,
          validationWarnings: warnings,
          sourceConceptName: input.conceptName,
          sourceSubject: input.subject,
        };

        toInsert.push({
          sourceConceptId: input.conceptId,
          targetConceptId: targetConcept.id,
          relationshipType: normalizedType,
          relationshipStrength: strength,
          relationshipReason: reason,
          crossSubject,
          generatedBy: `${aiResponse.provider}:${aiResponse.model}`,
          relationshipMetadata: metadata,
        });

        validRelationships.push({
          targetConceptName: targetConcept.displayName,
          relationshipType: normalizedType,
          reason,
          strength,
        });
      }

      // ─── Spread clustered scores ────────────────────────────
      if (toInsert.length > 1) {
        // Sort by strength descending, then enforce minimum gap
        toInsert.sort((a, b) => b.relationshipStrength - a.relationshipStrength);
        const MIN_GAP = 0.03;
        for (let i = 1; i < toInsert.length; i++) {
          const diff = toInsert[i - 1].relationshipStrength - toInsert[i].relationshipStrength;
          if (diff < MIN_GAP) {
            toInsert[i].relationshipStrength = Math.max(
              0.30,
              Math.round((toInsert[i - 1].relationshipStrength - MIN_GAP) * 100) / 100
            );
          }
        }
        // Sync to validRelationships (same order as toInsert after loop)
        for (let i = 0; i < validRelationships.length && i < toInsert.length; i++) {
          validRelationships[i].strength = toInsert[i].relationshipStrength;
        }
      }

      // ─── Batch persist ─────────────────────────────────────
      console.log("[REL-EXTRACT] STEP 7: Pipeline summary:", {
        totalFromAI: stats.totalExtracted,
        readyToPersist: toInsert.length,
        skippedUnknownTarget: stats.skippedUnknownTarget,
        skippedDuplicate: stats.skippedDuplicate,
        skippedWeakStrength: stats.skippedWeakStrength,
        skippedSelfLoop: stats.skippedSelfLoop,
        crossSubject: stats.crossSubjectCount,
      });
      console.log("[REL-EXTRACT] STEP 7: Persisting", toInsert.length, "relationships");

      if (toInsert.length > 0) {
        try {
          const persisted = await relationshipRepository.createMany(toInsert);
          stats.persisted = persisted.length;
        } catch (persistError) {
          const msg = persistError instanceof Error ? persistError.message : String(persistError);
          log.error("Relationship persistence failed", { jobId: job.id, error: msg });

          await aiProcessingService.failJob(job.id, `Persistence failed: ${msg}`, {
            latencyMs: aiResponse.latencyMs,
            model: aiResponse.model,
            provider: aiResponse.provider,
          });

          return {
            jobId: job.id,
            sourceConceptId: input.conceptId,
            relationships: validRelationships,
            warnings: [`Persistence failed: ${msg}`],
            stats,
            processingTimeMs: Date.now() - startTime,
          };
        }
      }

      // ─── Complete job ──────────────────────────────────────
      console.log("[REL-EXTRACT] STEP 8: Job complete");
      const processingTimeMs = Date.now() - startTime;

      await aiProcessingService.completeJob(job.id, {
        latencyMs: aiResponse.latencyMs,
        model: aiResponse.model,
        provider: aiResponse.provider,
        generationVersion: RELATIONSHIP_VERSION,
        parserStrategyUsed: validationResult.jsonRepairApplied,
      });

      log.info("Relationship extraction completed", {
        jobId: job.id,
        conceptId: input.conceptId,
        processingTimeMs,
        stats,
      });

      return {
        jobId: job.id,
        sourceConceptId: input.conceptId,
        relationships: validRelationships,
        warnings,
        stats,
        processingTimeMs,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Relationship extraction failed", { jobId: job.id, error: errorMessage });
      await aiProcessingService.failJob(job.id, errorMessage);

      return {
        jobId: job.id,
        sourceConceptId: input.conceptId,
        relationships: [],
        warnings: [errorMessage],
        stats,
        processingTimeMs: Date.now() - startTime,
      };
    }
  },

  /**
   * Get all relationships for a concept.
   */
  async getRelationships(conceptId: string) {
    return relationshipRepository.findByConcept(conceptId);
  },
};
