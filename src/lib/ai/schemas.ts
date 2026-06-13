/**
 * AI output validation schemas.
 * NEVER trust raw AI output — validate everything with Zod before persistence.
 *
 * Phase 2B: Concept extraction validation
 * Phase 2C: Cognitive-compression note validation
 *   Sections: coreIdea, examTriggers, staticCurrentLink,
 *   answerWritingAngles, memoryHooks
 */

import { z } from "zod";
import { UPSC_SUBJECTS } from "./subjects";

// ─── Concept Extraction Schema ──────────────────────────────

export const rawExtractedConceptSchema = z.object({
  name: z
    .string()
    .min(1, "Concept name is required")
    .max(300, "Concept name too long")
    .trim(),
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(100, "Subject too long")
    .trim(),
  keywords: z
    .array(z.string().trim())
    .max(10, "Too many keywords")
    .default([])
    .transform((arr) => arr.filter((s) => s.length > 0)),
  difficulty: z
    .enum(["beginner", "intermediate", "advanced"])
    .catch("intermediate"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .catch(0.5),
});

export const conceptExtractionResponseSchema = z.object({
  concepts: z
    .array(rawExtractedConceptSchema)
    .max(20)
    .default([]),
});

export type RawExtractedConcept = z.infer<typeof rawExtractedConceptSchema>;
export type RawConceptExtractionResponse = z.infer<typeof conceptExtractionResponseSchema>;

export const validatedSubjectSchema = z.enum(UPSC_SUBJECTS);

// ─── Note Generation Schema (cognitive-compression model) ───

/**
 * Validates the new 5-section cognitive-compression note structure.
 * coreIdea and examTriggers are mandatory.
 * staticCurrentLink, answerWritingAngles, memoryHooks degrade gracefully.
 */
export const generatedNoteResponseSchema = z.object({
  coreIdea: z
    .string()
    .min(5, "Core idea too short")
    .max(1500, "Core idea too long")
    .trim(),
  examTriggers: z
    .array(
      z.string().trim().min(1, "Empty exam trigger not allowed")
    )
    .min(1, "At least one exam trigger required")
    .max(12, "Too many exam triggers")
    .transform((arr) => arr.filter((s) => s.length > 0)),
  staticCurrentLink: z
    .array(
      z.string().trim().min(1)
    )
    .max(8, "Too many static-current links")
    .default([])
    .catch([])
    .transform((arr) => arr.filter((s) => s.length > 0)),
  answerWritingAngles: z
    .array(
      z.string().trim().min(1)
    )
    .max(10, "Too many answer-writing angles")
    .default([])
    .catch([])
    .transform((arr) => arr.filter((s) => s.length > 0)),
  memoryHooks: z
    .array(
      z.string().trim().min(1)
    )
    .max(8, "Too many memory hooks")
    .default([])
    .catch([])
    .transform((arr) => arr.filter((s) => s.length > 0)),
});

export type ValidatedGeneratedNote = z.infer<typeof generatedNoteResponseSchema>;

// ─── Relationship Extraction Schema (Phase 2D) ─────────────

import { RELATIONSHIP_TYPES } from "./types";

/**
 * Validates a single extracted relationship.
 * relationship_type is constrained to the allowed UPSC-relevant types.
 * Reason must be substantive (min 10 chars) to prevent vague associations.
 */
export const extractedRelationshipSchema = z.object({
  targetConceptName: z
    .string()
    .min(1, "Target concept name required")
    .max(300, "Target concept name too long")
    .trim(),
  relationshipType: z
    .enum(RELATIONSHIP_TYPES)
    .catch("governance_link"), // Graceful fallback for invalid types
  reason: z
    .string()
    .min(10, "Relationship reason too vague")
    .max(500, "Relationship reason too long")
    .trim(),
  strength: z
    .number()
    .min(0)
    .max(1)
    .catch(0.5),
});

export const relationshipExtractionResponseSchema = z.object({
  relationships: z
    .array(extractedRelationshipSchema)
    .min(0)
    .max(15)
    .default([]),
});

export type ValidatedExtractedRelationship = z.infer<typeof extractedRelationshipSchema>;
export type ValidatedRelationshipResponse = z.infer<typeof relationshipExtractionResponseSchema>;

// ─── Context Intelligence Schema (Phase 3A) ─────────────

/**
 * Validates AI-generated context dimensions.
 * All dimensions are nullable — sparse intelligence is intentional.
 */
export const contextIntelligenceResponseSchema = z.object({
  constitutionalRelevance: z.string().max(500).nullable().catch(null),
  governanceRelevance: z.string().max(500).nullable().catch(null),
  ethicalDimension: z.string().max(500).nullable().catch(null),
  policyImplications: z.string().max(500).nullable().catch(null),
  economicImplications: z.string().max(500).nullable().catch(null),
  currentAffairsSignificance: z.string().max(500).nullable().catch(null),
  staticDynamicLink: z.string().max(500).nullable().catch(null),
  confidence: z.number().min(0).max(1).catch(0.5),
});

export type ValidatedContextIntelligence = z.infer<typeof contextIntelligenceResponseSchema>;

// ─── Question Intelligence Schema (Phase 3B) ────────────

/** Single prelims MCQ. */
const prelimsMcqSchema = z.object({
  question: z.string().min(10).max(1500).trim(),
  options: z.object({
    a: z.string().min(1).max(500).trim(),
    b: z.string().min(1).max(500).trim(),
    c: z.string().min(1).max(500).trim(),
    d: z.string().min(1).max(500).trim(),
  }),
  correctAnswer: z.enum(["a", "b", "c", "d"]),
  explanation: z.string().min(5).trim()
    .transform((s) => s.length > 1000 ? s.slice(0, 1000) + "…" : s),
  difficulty: z.enum(["easy", "moderate", "hard"]).catch("moderate"),
});

/** Single mains question. */
const mainsQuestionSchema = z.object({
  question: z.string().min(15).max(1000).trim(),
  guidancePoints: z
    .array(z.string().trim().min(5))
    .min(1)
    .max(6)
    .default([])
    .transform((arr) => arr.filter((s) => s.length > 0)),
  estimatedMarks: z.union([z.literal(10), z.literal(15)]).catch(15),
  paperRelevance: z.string().max(20).trim().catch(""),
});

/** Single interview prompt. */
const interviewPromptSchema = z.object({
  prompt: z.string().min(10).trim()
    .transform((s) => s.length > 1000 ? s.slice(0, 1000) + "…" : s),
  expectedDimensions: z
    .array(z.string().trim().min(2))
    .min(1)
    .max(5)
    .default([])
    .transform((arr) => arr.filter((s) => s.length > 0)),
  difficulty: z.enum(["moderate", "advanced"]).catch("moderate"),
});

/** Full question intelligence response. */
export const questionIntelligenceResponseSchema = z.object({
  prelimsMcqs: z
    .array(prelimsMcqSchema)
    .min(0)
    .max(5)
    .default([]),
  mainsQuestions: z
    .array(mainsQuestionSchema)
    .min(0)
    .max(4)
    .default([]),
  interviewPrompts: z
    .array(interviewPromptSchema)
    .min(0)
    .max(3)
    .default([]),
  confidence: z.number().min(0).max(1).catch(0.5),
});

export type ValidatedPrelimsMcq = z.infer<typeof prelimsMcqSchema>;
export type ValidatedMainsQuestion = z.infer<typeof mainsQuestionSchema>;
export type ValidatedInterviewPrompt = z.infer<typeof interviewPromptSchema>;
export type ValidatedQuestionIntelligence = z.infer<typeof questionIntelligenceResponseSchema>;
