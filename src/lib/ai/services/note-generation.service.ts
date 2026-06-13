/**
 * Note generation service — Phase 2C cognitive-compression model.
 *
 * Pipeline:
 * Concept → Idempotency Check → Job → AI Call → JSON Repair + Zod →
 * Section Normalization → Content Hash → Dedup → Version → Persist → Complete
 *
 * New output sections:
 * coreIdea, examTriggers, staticCurrentLink, answerWritingAngles, memoryHooks
 */

import { executeWithRetry } from "@/lib/ai/client";
import { getAIConfig } from "@/lib/ai/constants";
import { getNoteGenerationPrompt, NOTE_GENERATION_VERSION } from "@/lib/ai/prompts";
import { generatedNoteResponseSchema } from "@/lib/ai/schemas";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import {
  normalizeNote,
  hashNoteContent,
  renderNoteToMarkdown,
} from "@/lib/ai/utils/note-normalize";
import { createAILogger } from "@/lib/ai/utils/logger";
import { aiProcessingService } from "./ai-processing.service";
import { noteRepository } from "@/lib/repositories/note.repository";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import type {
  NoteGenerationInput,
  NoteGenerationResult,
  NoteGenerationStats,
  NoteGenerationMetadata,
  GeneratedNote,
} from "@/lib/ai/types";

const log = createAILogger("note-generation");

// Compat constant — references extraction version for metadata
const EXTRACTION_VERSION_COMPAT = "2b.2";

export const noteGenerationService = {
  /**
   * Generate revision notes for a single concept.
   */
  async generate(input: NoteGenerationInput): Promise<NoteGenerationResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const stats: NoteGenerationStats = {
      sectionsGenerated: 0,
      sectionsRepaired: 0,
      contentLength: 0,
      examTriggerCount: 0,
      memoryHookCount: 0,
    };

    console.log("[NOTE-GEN] STEP 1: Checking concept exists");

    // ─── Validate concept exists ──────────────────────────────
    const concept = await conceptRepository.findById(input.conceptId);
    if (!concept) {
      throw new Error(`Concept not found: ${input.conceptId}`);
    }

    // ─── Idempotency: check if latest note already exists ─────
    if (!input.force) {
      console.log("[NOTE-GEN] STEP 2: Idempotency check");
      const existingNote = await noteRepository.findLatestByConceptId(input.conceptId);

      if (existingNote) {
        log.info("Note already exists — returning cached version", {
          conceptId: input.conceptId,
          noteId: existingNote.id,
          version: existingNote.version,
        });

        return {
          jobId: "",
          noteId: existingNote.id,
          version: existingNote.version,
          note: {
            coreIdea: existingNote.coreIdea,
            examTriggers: existingNote.examTriggers,
            staticCurrentLink: existingNote.staticCurrentLink,
            answerWritingAngles: existingNote.answerWritingAngles,
            memoryHooks: existingNote.memoryHooks,
          },
          warnings: [],
          stats: {
            sectionsGenerated: 0,
            sectionsRepaired: 0,
            contentLength: existingNote.content.length,
            examTriggerCount: existingNote.examTriggers.length,
            memoryHookCount: existingNote.memoryHooks.length,
          },
          processingTimeMs: 0,
        };
      }
    }

    // ─── Create processing job ────────────────────────────────
    console.log("[NOTE-GEN] STEP 3: Creating job");
    const job = await aiProcessingService.createJob({
      userId: input.userId,
      jobType: "note_generation",
    });

    try {
      await aiProcessingService.startJob(job.id);

      // ─── Build prompt ──────────────────────────────────────
      console.log("[NOTE-GEN] STEP 4: Calling AI provider");
      const prompt = getNoteGenerationPrompt({
        conceptName: input.conceptName,
        subject: input.subject,
        keywords: input.keywords.join(", "),
        difficulty: input.difficulty,
      });

      const config = getAIConfig();
      const aiResponse = await executeWithRetry({
        prompt: prompt.user,
        systemPrompt: prompt.system,
        temperature: config.defaultTemperature,
        maxTokens: config.defaultMaxTokens,
        format: "json",
      });

      console.log("[NOTE-GEN] STEP 4: AI response received", {
        latencyMs: aiResponse.latencyMs,
        contentLength: aiResponse.content.length,
      });

      // ─── Validate AI output ─────────────────────────────────
      console.log("[NOTE-GEN] STEP 5: Validating AI output");
      const validationResult = validateAIResponse(
        aiResponse.content,
        generatedNoteResponseSchema
      );

      const sectionsRepaired: string[] = [];

      if (!validationResult.success) {
        const errorMsg = `Note validation failed: ${validationResult.errors.join("; ")}`;
        log.error(errorMsg, { jobId: job.id, conceptId: input.conceptId });

        await aiProcessingService.failJob(job.id, errorMsg, {
          latencyMs: aiResponse.latencyMs,
          model: aiResponse.model,
          provider: aiResponse.provider,
          parserStrategyUsed: validationResult.jsonRepairApplied,
        });

        return {
          jobId: job.id,
          noteId: null,
          version: 0,
          note: null,
          warnings: [errorMsg],
          stats,
          processingTimeMs: Date.now() - startTime,
        };
      }

      const rawNote = validationResult.data!;

      // ─── Track repaired sections ────────────────────────────
      if (rawNote.staticCurrentLink.length === 0) {
        sectionsRepaired.push("staticCurrentLink");
        warnings.push("Static-current link section was empty or malformed — skipped");
      }
      if (rawNote.answerWritingAngles.length === 0) {
        sectionsRepaired.push("answerWritingAngles");
        warnings.push("Answer-writing angles section was empty or malformed — skipped");
      }
      if (rawNote.memoryHooks.length === 0) {
        sectionsRepaired.push("memoryHooks");
        warnings.push("Memory hooks section was empty or malformed — skipped");
      }

      stats.sectionsRepaired = sectionsRepaired.length;

      // ─── Normalize ──────────────────────────────────────────
      console.log("[NOTE-GEN] STEP 6: Normalizing note content");
      const normalizedNote: GeneratedNote = normalizeNote({
        coreIdea: rawNote.coreIdea,
        examTriggers: rawNote.examTriggers,
        staticCurrentLink: rawNote.staticCurrentLink,
        answerWritingAngles: rawNote.answerWritingAngles,
        memoryHooks: rawNote.memoryHooks,
      });

      // Count valid sections
      stats.sectionsGenerated =
        (normalizedNote.coreIdea.length > 0 ? 1 : 0) +
        (normalizedNote.examTriggers.length > 0 ? 1 : 0) +
        (normalizedNote.staticCurrentLink.length > 0 ? 1 : 0) +
        (normalizedNote.answerWritingAngles.length > 0 ? 1 : 0) +
        (normalizedNote.memoryHooks.length > 0 ? 1 : 0);

      stats.examTriggerCount = normalizedNote.examTriggers.length;
      stats.memoryHookCount = normalizedNote.memoryHooks.length;

      // ─── Content hash + dedup ───────────────────────────────
      console.log("[NOTE-GEN] STEP 7: Content hash dedup check");
      const contentHash = hashNoteContent(normalizedNote);

      const isDuplicate = await noteRepository.existsByContentHash(
        input.conceptId,
        contentHash
      );

      if (isDuplicate && !input.force) {
        log.info("Duplicate note detected via content hash — skipping", {
          conceptId: input.conceptId,
          contentHash,
        });

        const existing = await noteRepository.findLatestByConceptId(input.conceptId);
        await aiProcessingService.completeJob(job.id, {
          latencyMs: aiResponse.latencyMs,
          model: aiResponse.model,
          provider: aiResponse.provider,
          generationVersion: NOTE_GENERATION_VERSION,
          noteId: existing?.id,
          noteVersion: existing?.version,
        });

        return {
          jobId: job.id,
          noteId: existing?.id ?? null,
          version: existing?.version ?? 0,
          note: normalizedNote,
          warnings: ["Identical note already exists — skipped persistence"],
          stats,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // ─── Version computation ────────────────────────────────
      const nextVersion = await noteRepository.getNextVersion(input.conceptId);

      // ─── Render markdown content ────────────────────────────
      const markdownContent = renderNoteToMarkdown(
        input.conceptName,
        normalizedNote
      );
      stats.contentLength = markdownContent.length;

      // ─── Persist ────────────────────────────────────────────
      console.log("[NOTE-GEN] STEP 8: Persisting note version", nextVersion);

      const generationMeta: NoteGenerationMetadata = {
        generationVersion: NOTE_GENERATION_VERSION,
        provider: aiResponse.provider,
        model: aiResponse.model,
        promptVersion: NOTE_GENERATION_VERSION,
        generationTimeMs: aiResponse.latencyMs,
        retryCount: aiResponse.attempts - 1,
        parserStrategyUsed: validationResult.jsonRepairApplied,
        validationWarnings: warnings,
        sourceConceptVersion: EXTRACTION_VERSION_COMPAT,
        contentHash,
        sectionsRepaired,
      };

      let persistedNote;
      try {
        persistedNote = await noteRepository.create({
          conceptId: input.conceptId,
          version: nextVersion,
          content: markdownContent,
          coreIdea: normalizedNote.coreIdea,
          examTriggers: normalizedNote.examTriggers,
          staticCurrentLink: normalizedNote.staticCurrentLink,
          answerWritingAngles: normalizedNote.answerWritingAngles,
          memoryHooks: normalizedNote.memoryHooks,
          contentHash,
          generatedBy: `${aiResponse.provider}:${aiResponse.model}`,
          generationMetadata: generationMeta,
        });
      } catch (persistError) {
        const msg = persistError instanceof Error ? persistError.message : String(persistError);
        log.error("Note persistence failed — compensating", {
          jobId: job.id,
          error: msg,
        });

        await aiProcessingService.failJob(job.id, `Persistence failed: ${msg}`, {
          latencyMs: aiResponse.latencyMs,
          model: aiResponse.model,
          provider: aiResponse.provider,
        });

        return {
          jobId: job.id,
          noteId: null,
          version: 0,
          note: normalizedNote,
          warnings: [`Persistence failed: ${msg}`],
          stats,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // ─── Complete job ───────────────────────────────────────
      console.log("[NOTE-GEN] STEP 9: Job complete");
      const processingTimeMs = Date.now() - startTime;

      await aiProcessingService.completeJob(job.id, {
        latencyMs: aiResponse.latencyMs,
        model: aiResponse.model,
        provider: aiResponse.provider,
        generationVersion: NOTE_GENERATION_VERSION,
        parserStrategyUsed: validationResult.jsonRepairApplied,
        validationWarnings: warnings,
        noteVersion: nextVersion,
        noteId: persistedNote.id,
      });

      log.info("Note generation completed", {
        jobId: job.id,
        noteId: persistedNote.id,
        version: nextVersion,
        conceptId: input.conceptId,
        processingTimeMs,
        stats,
      });

      return {
        jobId: job.id,
        noteId: persistedNote.id,
        version: nextVersion,
        note: normalizedNote,
        warnings,
        stats,
        processingTimeMs,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Note generation failed", { jobId: job.id, error: errorMessage });
      await aiProcessingService.failJob(job.id, errorMessage);

      return {
        jobId: job.id,
        noteId: null,
        version: 0,
        note: null,
        warnings: [errorMessage],
        stats,
        processingTimeMs: Date.now() - startTime,
      };
    }
  },

  /**
   * Get the latest note for a concept.
   */
  async getLatestNote(conceptId: string) {
    return noteRepository.findLatestByConceptId(conceptId);
  },

  /**
   * Get all note versions for a concept.
   */
  async getNoteVersions(conceptId: string) {
    return noteRepository.findAllVersionsByConceptId(conceptId);
  },
};
