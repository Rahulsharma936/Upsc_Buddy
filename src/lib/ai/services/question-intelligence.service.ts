/**
 * Question Intelligence Service — Phase 3B.
 *
 * Generates UPSC-authentic practice questions for concepts.
 *
 * Flow:
 * 1. Load concept + existing intelligence (notes, GS mapping)
 * 2. Generate questions via AI (prelims MCQs, mains, interview)
 * 3. Validate with Zod
 * 4. Sanitize (strip generic/repetitive questions)
 * 5. Persist
 *
 * Anti-hallucination safeguards:
 * - Zod validation on all question structures
 * - MCQ answer validation (correctAnswer must be a/b/c/d)
 * - Generic question detection and stripping
 * - Duplicate question detection
 * - Graceful degradation on AI failure
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { conceptQuestionsRepository } from "@/lib/repositories/concept-questions.repository";
import { conceptContextRepository } from "@/lib/repositories/concept-context.repository";
import { getQuestionIntelligencePrompt, QUESTION_INTELLIGENCE_VERSION } from "@/lib/ai/prompts";
import {
  questionIntelligenceResponseSchema,
  type ValidatedQuestionIntelligence,
  type ValidatedPrelimsMcq,
  type ValidatedMainsQuestion,
  type ValidatedInterviewPrompt,
} from "@/lib/ai/schemas";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import { createProvider } from "@/lib/ai/provider";
import { getAIConfig } from "@/lib/ai/constants";
import { createAILogger } from "@/lib/ai/utils/logger";
import { resolvePapersForSubject } from "@/lib/ontology";
import type { ConceptQuestionsRecord } from "@/types/database.types";

const log = createAILogger("question-intelligence");

// ─── Generic question patterns to detect and strip ──────────

const GENERIC_MCQ_PATTERNS = [
  /^which of the following is (true|correct|false|incorrect)\?$/i,
  /^what is .*\?$/i,
  /^when was .* (established|created|formed)\?$/i,
  /^who (founded|established|created) .*\?$/i,
];

const GENERIC_MAINS_PATTERNS = [
  /^discuss\.?$/i,
  /^write a note on .*\.?$/i,
  /^what do you know about .*\?$/i,
];

function isGenericMcq(q: ValidatedPrelimsMcq): boolean {
  return GENERIC_MCQ_PATTERNS.some((p) => p.test(q.question.trim()));
}

function isGenericMains(q: ValidatedMainsQuestion): boolean {
  return GENERIC_MAINS_PATTERNS.some((p) => p.test(q.question.trim()));
}

function isGenericInterview(p: ValidatedInterviewPrompt): boolean {
  const lower = p.prompt.toLowerCase();
  return (
    lower.includes("tell me about yourself") ||
    lower.includes("why do you want to join") ||
    lower.includes("what are your hobbies")
  );
}

/** Check for duplicate questions within a set. */
function deduplicateByField<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Service ────────────────────────────────────────────────

export const questionIntelligenceService = {
  /**
   * Generate practice questions for a concept.
   */
  async generate(params: {
    conceptId: string;
    userId: string;
    force?: boolean;
  }): Promise<{
    questions: ConceptQuestionsRecord;
    stats: {
      totalGenerated: number;
      totalSanitized: number;
      prelimsCount: number;
      mainsCount: number;
      interviewCount: number;
      generationTimeMs: number;
    };
  }> {
    const startTime = Date.now();
    const stats = {
      totalGenerated: 0,
      totalSanitized: 0,
      prelimsCount: 0,
      mainsCount: 0,
      interviewCount: 0,
      generationTimeMs: 0,
    };

    console.log("[QUESTIONS] STEP 1: Loading concept");

    // ─── Load concept ────────────────────────────────────
    const concept = await conceptRepository.findById(params.conceptId);
    if (!concept || concept.userId !== params.userId) {
      throw new Error("Concept not found or access denied");
    }

    // ─── Idempotency check ───────────────────────────────
    if (!params.force) {
      const existing = await conceptQuestionsRepository.findByConcept(params.conceptId);
      if (existing) {
        const existingPrelims = (existing.prelimsMcqs as any[])?.length ?? 0;
        const existingMains = (existing.mainsQuestions as any[])?.length ?? 0;
        const existingInterview = (existing.interviewPrompts as any[])?.length ?? 0;
        const hasContent = existingPrelims > 0 || existingMains > 0 || existingInterview > 0;

        if (hasContent) {
          // Truly populated — return cached
          console.log("[QUESTIONS] Returning cached questions (populated)");
          return {
            questions: existing,
            stats: {
              ...stats,
              prelimsCount: existingPrelims,
              mainsCount: existingMains,
              interviewCount: existingInterview,
            },
          };
        }

        // Record exists but empty (failed previous gen) — delete and regenerate
        console.log("[QUESTIONS] Existing record is empty — regenerating");
        await conceptQuestionsRepository.deleteByConcept(params.conceptId);
      }
    } else {
      await conceptQuestionsRepository.deleteByConcept(params.conceptId);
    }

    // ─── Gather intelligence context ─────────────────────
    console.log("[QUESTIONS] STEP 2: Gathering context");

    const papers = resolvePapersForSubject(concept.subject);
    const primaryPaper = papers.length > 0 ? papers[0] : "GS1";

    // Try to get existing context intelligence for richer prompts
    const contextRecord = await conceptContextRepository.findByConcept(params.conceptId);
    const coreIdea = contextRecord?.staticDynamicLink
      ?? contextRecord?.governanceRelevance
      ?? contextRecord?.constitutionalRelevance
      ?? `${concept.displayName} is a ${concept.subject} concept relevant to ${primaryPaper}.`;

    // ─── AI generation ───────────────────────────────────
    console.log("[QUESTIONS] STEP 3: AI question generation");

    const prompt = getQuestionIntelligencePrompt({
      conceptName: concept.displayName,
      subject: concept.subject,
      keywords: (concept.keywords ?? []).join(", "),
      difficulty: concept.difficulty,
      primaryPaper,
      coreIdea,
    });

    let aiResult: ValidatedQuestionIntelligence = {
      prelimsMcqs: [],
      mainsQuestions: [],
      interviewPrompts: [],
      confidence: 0.5,
    };

    try {
      const config = getAIConfig();
      const provider = createProvider(config);

      const aiResponse = await provider.complete({
        prompt: prompt.user,
        systemPrompt: prompt.system,
        temperature: 0.35, // Slightly creative for question diversity
        maxTokens: 4096,
        format: "json",
      });

      stats.generationTimeMs = aiResponse.latencyMs;

      const validationResult = validateAIResponse(
        aiResponse.content,
        questionIntelligenceResponseSchema
      );

      if (validationResult.success && validationResult.data) {
        aiResult = validationResult.data;
      } else {
        log.warn("Question intelligence validation failed — attempting per-question recovery", {
          errors: validationResult.errors,
          conceptId: params.conceptId,
        });

        // ─── Per-question fallback: parse raw JSON and validate individually ───
        try {
          const rawJson = JSON.parse(aiResponse.content);

          // Try to salvage individual questions from the raw output
          if (Array.isArray(rawJson?.prelimsMcqs)) {
            for (const mcq of rawJson.prelimsMcqs) {
              try {
                // Pre-truncate long fields
                if (mcq?.explanation && typeof mcq.explanation === "string" && mcq.explanation.length > 1000) {
                  mcq.explanation = mcq.explanation.slice(0, 1000) + "…";
                }
                // Validate via the full schema's array, then take individual results
                const singleResult = questionIntelligenceResponseSchema.shape.prelimsMcqs
                  .removeDefault()
                  .element.parse(mcq);
                aiResult.prelimsMcqs.push(singleResult);
              } catch {
                // Skip this individual MCQ
              }
            }
          }
          if (Array.isArray(rawJson?.mainsQuestions)) {
            for (const mq of rawJson.mainsQuestions) {
              try {
                const singleResult = questionIntelligenceResponseSchema.shape.mainsQuestions
                  .removeDefault()
                  .element.parse(mq);
                aiResult.mainsQuestions.push(singleResult);
              } catch {
                // Skip
              }
            }
          }
          if (Array.isArray(rawJson?.interviewPrompts)) {
            for (const ip of rawJson.interviewPrompts) {
              try {
                if (ip?.prompt && typeof ip.prompt === "string" && ip.prompt.length > 1000) {
                  ip.prompt = ip.prompt.slice(0, 1000) + "…";
                }
                const singleResult = questionIntelligenceResponseSchema.shape.interviewPrompts
                  .removeDefault()
                  .element.parse(ip);
                aiResult.interviewPrompts.push(singleResult);
              } catch {
                // Skip
              }
            }
          }

          log.info("Per-question recovery completed", {
            recovered: {
              prelims: aiResult.prelimsMcqs.length,
              mains: aiResult.mainsQuestions.length,
              interview: aiResult.interviewPrompts.length,
            },
            conceptId: params.conceptId,
          });
        } catch {
          log.warn("Per-question recovery also failed", { conceptId: params.conceptId });
        }
      }
    } catch (err) {
      log.error("Question intelligence AI call failed", {
        error: err instanceof Error ? err.message : String(err),
        conceptId: params.conceptId,
      });
      // Graceful degradation — persist empty question set
    }

    // ─── Sanitize ────────────────────────────────────────
    console.log("[QUESTIONS] STEP 4: Sanitizing questions");

    const rawPrelims = aiResult.prelimsMcqs.length;
    const rawMains = aiResult.mainsQuestions.length;
    const rawInterview = aiResult.interviewPrompts.length;
    stats.totalGenerated = rawPrelims + rawMains + rawInterview;

    // Filter generic questions
    let prelims = aiResult.prelimsMcqs.filter((q) => !isGenericMcq(q));
    let mains = aiResult.mainsQuestions.filter((q) => !isGenericMains(q));
    let interview = aiResult.interviewPrompts.filter((p) => !isGenericInterview(p));

    // Deduplicate
    prelims = deduplicateByField(prelims, (q) => q.question);
    mains = deduplicateByField(mains, (q) => q.question);
    interview = deduplicateByField(interview, (p) => p.prompt);

    stats.prelimsCount = prelims.length;
    stats.mainsCount = mains.length;
    stats.interviewCount = interview.length;
    stats.totalSanitized = stats.totalGenerated - (prelims.length + mains.length + interview.length);

    console.log("[QUESTIONS] Sanitized:", {
      prelims: `${rawPrelims} → ${prelims.length}`,
      mains: `${rawMains} → ${mains.length}`,
      interview: `${rawInterview} → ${interview.length}`,
      stripped: stats.totalSanitized,
    });

    // ─── Persist ─────────────────────────────────────────
    console.log("[QUESTIONS] STEP 5: Persisting");

    const questions = await conceptQuestionsRepository.upsert({
      conceptId: params.conceptId,
      prelimsMcqs: prelims,
      mainsQuestions: mains,
      interviewPrompts: interview,
      generationConfidence: String(aiResult.confidence),
      generationMetadata: {
        version: QUESTION_INTELLIGENCE_VERSION,
        generationTimeMs: stats.generationTimeMs,
        totalGenerated: stats.totalGenerated,
        totalSanitized: stats.totalSanitized,
        conceptName: concept.displayName,
        conceptSubject: concept.subject,
        primaryPaper,
      },
    });

    console.log("[QUESTIONS] STEP 6: Complete", {
      conceptId: params.conceptId,
      totalQuestions: prelims.length + mains.length + interview.length,
      totalTimeMs: Date.now() - startTime,
    });

    return { questions, stats };
  },

  /**
   * Get existing questions for a concept.
   */
  async getQuestions(conceptId: string): Promise<ConceptQuestionsRecord | undefined> {
    return conceptQuestionsRepository.findByConcept(conceptId);
  },
};
