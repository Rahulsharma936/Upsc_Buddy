/**
 * Concept extraction service — Phase 2B.
 * 
 * Full pipeline:
 * Daily Log
 *   → Idempotency Check
 *   → Create Job
 *   → AI Provider Call
 *   → JSON Repair + Zod Validation
 *   → Subject Normalization (reject invalid)
 *   → Name Normalization
 *   → Keyword Cleanup
 *   → Deterministic Confidence Scoring
 *   → In-batch Deduplication
 *   → Cross-log Deduplication
 *   → Safe Persistence (conflict-tolerant)
 *   → Job Completion with Extraction Metadata
 * 
 * Safety guarantees:
 * - Idempotent (re-calling returns cached result)
 * - Partial failure safe (valid concepts persist, invalid are logged)
 * - Compensating transaction (persistence failure = job marked failed)
 * - Full observability (every step logged with structured metadata)
 */

import { executeWithRetry, checkAIHealth } from "@/lib/ai/client";
import { getAIConfig, AI_PROCESSING } from "@/lib/ai/constants";
import { getConceptExtractionPrompt, EXTRACTION_VERSION } from "@/lib/ai/prompts";
import { conceptExtractionResponseSchema } from "@/lib/ai/schemas";
import { resolveSubject } from "@/lib/ai/subjects";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import { normalizeConceptName, toDisplayName, normalizeKeywords } from "@/lib/ai/utils/normalize";
import { computeConfidence } from "@/lib/ai/utils/confidence";
import { deduplicateConcepts, filterAgainstExisting } from "@/lib/ai/utils/deduplication";
import { createAILogger } from "@/lib/ai/utils/logger";
import { aiProcessingService } from "./ai-processing.service";
import { aiJobRepository } from "@/lib/repositories/ai-job.repository";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import type {
  ConceptExtractionInput,
  ConceptExtractionResult,
  ExtractedConcept,
  ConceptExtractionMetadata,
} from "@/lib/ai/types";

const log = createAILogger("concept-extraction");

export const conceptExtractionService = {
  /**
   * Extract concepts from a daily study log.
   */
  async extract(input: ConceptExtractionInput): Promise<ConceptExtractionResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const stats = {
      totalExtracted: 0,
      persisted: 0,
      skippedInvalidSubject: 0,
      skippedLowConfidence: 0,
      deduplicated: 0,
    };

    // ─── Idempotency guard ────────────────────────────────
    console.log("[EXTRACTION] STEP 1: Idempotency check");
    const existingJob = await aiJobRepository.findActiveByDailyLogAndType(
      input.dailyLogId,
      "concept_extraction"
    );
    console.log("[EXTRACTION] STEP 1: Done. Existing job:", existingJob?.id ?? "none");

    if (existingJob) {
      log.info("Skipping duplicate extraction — active/completed job exists", {
        existingJobId: existingJob.id,
        status: existingJob.status,
      });

      if (existingJob.status === "completed") {
        const existingConcepts = await conceptRepository.findByDailyLog(
          input.dailyLogId,
          input.userId
        );

        // ─── Completed-empty cache fix (Audit 1, Task 2) ───
        // If a prior extraction completed but persisted 0 concepts,
        // treat it as stale and allow a fresh extraction attempt.
        // This prevents permanently locking out a daily log after
        // a subject-resolution failure or empty AI response.
        if (existingConcepts.length === 0) {
          log.info("Previous extraction completed with 0 concepts — treating as stale", {
            staleJobId: existingJob.id,
          });
          // Mark the old job as superseded so the idempotency guard
          // won't find it again (it only searches non-failed statuses).
          await aiJobRepository.markSuperseded(
            existingJob.id,
            "Superseded: completed with 0 concepts, allowing re-extraction"
          );
          // Fall through to create a new job below
        } else {
          return {
            jobId: existingJob.id,
            concepts: existingConcepts.map(dbConceptToExtracted),
            warnings: [],
            stats: { totalExtracted: existingConcepts.length, persisted: existingConcepts.length, skippedInvalidSubject: 0, skippedLowConfidence: 0, deduplicated: 0 },
            processingTimeMs: 0,
          };
        }
      } else {
        // Status is "pending" | "processing" | "retrying" — genuinely in-flight
        return {
          jobId: existingJob.id,
          concepts: [],
          warnings: ["Job is still in-flight"],
          stats,
          processingTimeMs: 0,
        };
      }
    }

    // ─── Pre-flight AI health check (Audit 1, Task 5) ────
    // Avoid creating a job that will immediately fail if the
    // AI provider is unreachable.
    console.log("[EXTRACTION] STEP 2: Pre-flight AI health check");
    const aiAvailable = await checkAIHealth();
    if (!aiAvailable) {
      log.warn("AI provider is not available — skipping extraction");
      return {
        jobId: "",
        concepts: [],
        warnings: ["AI provider is not available. Please ensure Ollama is running and try again."],
        stats,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // ─── Create processing job ────────────────────────────
    console.log("[EXTRACTION] STEP 3: Creating job");
    const job = await aiProcessingService.createJob({
      userId: input.userId,
      dailyLogId: input.dailyLogId,
      jobType: "concept_extraction",
    });
    console.log("[EXTRACTION] STEP 3: Job created:", job.id);

    try {
      console.log("[EXTRACTION] STEP 3: Marking job started");
      await aiProcessingService.startJob(job.id);

      // ─── AI call ──────────────────────────────────────────
      const prompt = getConceptExtractionPrompt({
        rawInput: input.rawInput,
        subjects: input.subjects.join(", "),
      });

      console.log("[EXTRACTION] STEP 4: Calling AI provider (this may take 30-120s on CPU)...");

      const config = getAIConfig();
      const aiResponse = await executeWithRetry({
        prompt: prompt.user,
        systemPrompt: prompt.system,
        temperature: config.defaultTemperature,
        maxTokens: config.defaultMaxTokens,
        format: "json",
      });
      console.log("[EXTRACTION] STEP 4: AI response received!", {
        latencyMs: aiResponse.latencyMs,
        contentLength: aiResponse.content.length,
        attempts: aiResponse.attempts,
      });

      // ─── Validate raw AI output ───────────────────────────
      console.log("[EXTRACTION] STEP 5: Validating AI output");
      const validationResult = validateAIResponse(
        aiResponse.content,
        conceptExtractionResponseSchema
      );
      console.log("[EXTRACTION] STEP 5: Validation result:", validationResult.success);

      if (!validationResult.success) {
        const errorMsg = `Validation failed: ${validationResult.errors.join("; ")}`;
        log.error(errorMsg, { jobId: job.id });

        await aiProcessingService.failJob(job.id, errorMsg, {
          latencyMs: aiResponse.latencyMs,
          model: aiResponse.model,
          provider: aiResponse.provider,
          parserStrategyUsed: validationResult.jsonRepairApplied,
          attempts: aiResponse.attempts,
        });

        return { jobId: job.id, concepts: [], warnings: [errorMsg], stats, processingTimeMs: Date.now() - startTime };
      }

      const rawConcepts = validationResult.data!.concepts;
      stats.totalExtracted = rawConcepts.length;

      // ─── Pipeline: Normalize → Validate subjects → Score → Dedup ─
      const processed: ExtractedConcept[] = [];

      for (const raw of rawConcepts) {
        // 1. Subject normalization
        const resolvedSubject = resolveSubject(raw.subject);
        if (!resolvedSubject) {
          stats.skippedInvalidSubject++;
          warnings.push(`Skipped concept "${raw.name}": invalid subject "${raw.subject}"`);
          log.warn(`Invalid subject rejected`, {
            jobId: job.id,
            concept: raw.name,
            subject: raw.subject,
          });
          continue;
        }

        // 2. Name normalization
        const normalizedName = normalizeConceptName(raw.name);
        const displayName = toDisplayName(raw.name);

        if (normalizedName.length === 0) {
          warnings.push(`Skipped concept with empty normalized name: "${raw.name}"`);
          continue;
        }

        // 3. Keyword normalization
        const keywords = normalizeKeywords(raw.keywords);

        // 4. Deterministic confidence scoring
        const confidence = computeConfidence(
          {
            name: raw.name,
            subject: raw.subject,
            keywords: raw.keywords,
            difficulty: raw.difficulty,
            aiReportedConfidence: raw.confidence,
          },
          resolvedSubject,
          validationResult.jsonRepairApplied !== null
        );

        // 5. Confidence threshold
        if (confidence.score < AI_PROCESSING.MIN_CONFIDENCE_THRESHOLD) {
          stats.skippedLowConfidence++;
          warnings.push(`Skipped "${raw.name}": confidence ${confidence.score} < threshold ${AI_PROCESSING.MIN_CONFIDENCE_THRESHOLD}`);
          continue;
        }

        processed.push({
          normalizedName,
          displayName,
          originalName: raw.name,
          subject: resolvedSubject,
          keywords,
          difficulty: raw.difficulty,
          confidence: confidence.score,
          confidenceSignals: confidence.signals,
        });
      }

      // ─── In-batch deduplication ─────────────────────────────
      const deduped = deduplicateConcepts(processed);
      stats.deduplicated += deduped.duplicates.length;

      for (const dup of deduped.duplicates) {
        warnings.push(`Deduplicated "${dup.item.originalName}" (${dup.reason}, duplicate of "${dup.duplicateOf}")`);
      }

      // ─── Cross-log deduplication ────────────────────────────
      const existingKeys = await conceptRepository.getExistingNormalizedKeys(
        input.dailyLogId,
        input.userId
      );

      const crossDeduped = filterAgainstExisting(deduped.unique, existingKeys);
      stats.deduplicated += crossDeduped.duplicates.length;

      for (const dup of crossDeduped.duplicates) {
        warnings.push(`Skipped "${dup.item.originalName}": already exists in database`);
      }

      const finalConcepts = crossDeduped.unique;

      // ─── Safe persistence ───────────────────────────────────
      let persistedConcepts;
      try {
        persistedConcepts = await conceptRepository.createMany(
          finalConcepts.map((c) => ({
            userId: input.userId,
            dailyLogId: input.dailyLogId,
            normalizedName: c.normalizedName,
            displayName: c.displayName,
            name: c.originalName,
            subject: c.subject,
            keywords: c.keywords,
            difficulty: c.difficulty,
            extractionConfidence: c.confidence,
            extractionMetadata: {
              extractionVersion: EXTRACTION_VERSION,
              provider: aiResponse.provider,
              model: aiResponse.model,
              confidenceSignals: c.confidenceSignals,
              parserStrategyUsed: validationResult.jsonRepairApplied,
              originalSubject: c.originalName, // Will set correctly below
              subjectResolved: true,
            } satisfies ConceptExtractionMetadata,
          }))
        );
        stats.persisted = persistedConcepts.length;
      } catch (persistError) {
        const msg = persistError instanceof Error ? persistError.message : String(persistError);
        log.error("Concept persistence failed — compensating", { jobId: job.id, error: msg });

        await aiProcessingService.failJob(job.id, `Persistence failed: ${msg}`, {
          latencyMs: aiResponse.latencyMs,
          model: aiResponse.model,
          provider: aiResponse.provider,
          attempts: aiResponse.attempts,
        });

        return { jobId: job.id, concepts: [], warnings: [msg], stats, processingTimeMs: Date.now() - startTime };
      }

      // ─── Complete job with full metadata ────────────────────
      const processingTimeMs = Date.now() - startTime;
      await aiProcessingService.completeJob(job.id, {
        inputLength: input.rawInput.length,
        outputLength: aiResponse.content.length,
        tokenUsage: aiResponse.tokenUsage,
        latencyMs: aiResponse.latencyMs,
        model: aiResponse.model,
        provider: aiResponse.provider,
        attempts: aiResponse.attempts,
        extractionVersion: EXTRACTION_VERSION,
        parserStrategyUsed: validationResult.jsonRepairApplied,
        validationWarnings: warnings,
        conceptsExtracted: stats.totalExtracted,
        conceptsSkipped: stats.skippedInvalidSubject + stats.skippedLowConfidence,
        conceptsDeduplicated: stats.deduplicated,
      });

      log.info("Concept extraction completed", {
        jobId: job.id,
        stats,
        processingTimeMs,
        warningCount: warnings.length,
      });

      return { jobId: job.id, concepts: finalConcepts, warnings, stats, processingTimeMs };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Concept extraction failed", { jobId: job.id, error: errorMessage });
      await aiProcessingService.failJob(job.id, errorMessage);

      return {
        jobId: job.id,
        concepts: [],
        warnings: [errorMessage],
        stats,
        processingTimeMs: Date.now() - startTime,
      };
    }
  },

  async getConceptsForLog(dailyLogId: string, userId: string) {
    return conceptRepository.findByDailyLog(dailyLogId, userId);
  },

  async reExtract(input: ConceptExtractionInput): Promise<ConceptExtractionResult> {
    await conceptRepository.deleteByDailyLog(input.dailyLogId, input.userId);

    const existingJob = await aiJobRepository.findActiveByDailyLogAndType(
      input.dailyLogId,
      "concept_extraction"
    );
    if (existingJob) {
      await aiJobRepository.markFailed(existingJob.id, "Superseded by re-extraction");
    }

    return this.extract(input);
  },
};

// ─── Helpers ────────────────────────────────────────────────

/** Convert a DB concept row to an ExtractedConcept shape. */
function dbConceptToExtracted(c: Awaited<ReturnType<typeof conceptRepository.findByDailyLog>>[number]): ExtractedConcept {
  const meta = (c.extractionMetadata ?? {}) as Record<string, unknown>;
  const signals = (meta.confidenceSignals ?? {}) as ExtractedConcept["confidenceSignals"];

  return {
    normalizedName: c.normalizedName,
    displayName: c.displayName,
    originalName: c.name,
    subject: c.subject,
    keywords: c.keywords,
    difficulty: c.difficulty as "beginner" | "intermediate" | "advanced",
    confidence: c.extractionConfidence,
    confidenceSignals: signals,
  };
}
