/**
 * R3.2a — Concept Teaching Repair Executor
 *
 * Executes the "concept_teaching" repair intent.
 * Consumes a RepairRequest (from R3.1) where failureReason = "concept_not_understood".
 *
 * Generates a targeted teaching intervention using the existing AI infrastructure:
 *   A. Core idea — explain the concept simply
 *   B. Why it matters — underlying logic the student missed
 *   C. Example — concrete illustration
 *   D. Key distinction — why the wrong answer was tempting
 *   E. Verification — a new MCQ testing understanding (not memorization)
 *
 * Uses the failed question context to make the repair specific.
 *
 * Does NOT:
 *   - Re-diagnose the student
 *   - Use R2 diagnostic scoring
 *   - Modify SM-2 or mastery
 *   - Mark the student as "resolved"
 *   - Create database records
 *
 * @see RepairRequest in repair-request.builder.ts
 */

import { z } from "zod";
import { formatRepairGuidance } from "./note-grounding";
import type { RepairNoteGrounding } from "./note-grounding";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * The teaching explanation generated for the student.
 */
export interface ConceptTeachingExplanation {
  /** Core idea — what the concept is, in simple terms. */
  coreIdea: string;
  /** Why it matters / how it works — the underlying logic. */
  whyItMatters: string;
  /** A concrete, short example (optional — omitted if not helpful). */
  example: string | null;
  /**
   * Key distinction — why the student's wrong answer was tempting
   * and what makes the correct answer correct.
   * null if no question context was available.
   */
  keyDistinction: string | null;
}

/**
 * Verification MCQ that tests understanding of the repaired concept.
 * Must test understanding, not memorization of the original answer.
 */
export interface ConceptTeachingVerification {
  /** The verification question text. */
  question: string;
  /** Four options. */
  options: { a: string; b: string; c: string; d: string };
  /** Correct answer key. */
  correctAnswer: "a" | "b" | "c" | "d";
  /** Explanation of why the correct answer is correct. */
  explanation: string;
}

/**
 * Complete concept teaching repair output.
 * This is what R3.2a produces. R3.3 (verification) will consume it.
 */
export interface ConceptTeachingRepair {
  /** Links back to the originating RepairRequest. */
  requestId: string;
  /** The concept being repaired. */
  conceptId: string;
  /** The student's original failure reason — preserved. */
  failureReason: "concept_not_understood";
  /** The repair intent — always "concept_teaching" for this executor. */
  repairIntent: "concept_teaching";
  /** The failed question context — preserved for downstream. */
  questionContext: RepairQuestionContext | null;
  /** The generated teaching explanation. */
  explanation: ConceptTeachingExplanation;
  /** The verification MCQ. */
  verification: ConceptTeachingVerification;
  /** Status of the repair. */
  status: "ready";
  /** When the repair was generated. */
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

const conceptTeachingResponseSchema = z.object({
  coreIdea: z.string().min(10).max(2000).trim(),
  whyItMatters: z.string().min(10).max(2000).trim(),
  example: z.string().max(1500).trim().nullable().catch(null),
  keyDistinction: z.string().max(1500).trim().nullable().catch(null),
  verification: z.object({
    question: z.string().min(10).max(1500).trim(),
    options: z.object({
      a: z.string().min(1).max(500).trim(),
      b: z.string().min(1).max(500).trim(),
      c: z.string().min(1).max(500).trim(),
      d: z.string().min(1).max(500).trim(),
    }),
    correctAnswer: z.enum(["a", "b", "c", "d"]),
    explanation: z.string().min(5).max(1000).trim(),
  }),
});

type ValidatedConceptTeachingResponse = z.infer<typeof conceptTeachingResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

const SYSTEM_PROMPT = `
You are a focused UPSC concept tutor.

Your task is to REPAIR a student's understanding of a specific concept they got wrong in a practice MCQ.

STRICT RULES:
1. Respond ONLY with valid JSON.
2. No markdown.
3. No conversational text.
4. Keep the explanation SHORT and TARGETED — this is a repair, not a lecture.
5. Focus on the specific concept involved, not the entire topic.
6. If question context is provided, address WHY the student's choice was wrong.
7. The verification question MUST test understanding of the SAME concept but from a DIFFERENT angle — never repeat the original question.
8. All distractors in the verification must be plausible.
9. Do NOT invent constitutional articles, committee names, schemes, or facts.
10. Be precise and accurate — UPSC-level correctness is required.
`;

function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
  conceptNote: RepairNoteGrounding | null = null,
): string {
  let prompt = `
REPAIR TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}
${formatRepairGuidance(conceptNote)}
The student answered a practice MCQ about this concept incorrectly and reported:
"I didn't understand the concept."
`;

  if (questionContext) {
    prompt += `
FAILED QUESTION CONTEXT`;
    if (questionContext.questionText) {
      prompt += `
Question: ${questionContext.questionText}`;
    }
    if (questionContext.selectedAnswer) {
      prompt += `
Student selected: ${questionContext.selectedAnswer}`;
    }
    if (questionContext.correctAnswer) {
      prompt += `
Correct answer: ${questionContext.correctAnswer}`;
    }
    prompt += `

Use this context to:
- Explain WHY the student's selection was wrong
- Explain the distinction that makes the correct answer correct
- Address the specific misconception
`;
  } else {
    prompt += `
No specific question context is available. Provide a general targeted explanation of this concept.
`;
  }

  prompt += `
Generate a targeted teaching intervention. Keep it SHORT.

Respond in this EXACT JSON format:

{
  "coreIdea": "What the concept is, in simple precise terms (2-4 sentences max)",
  "whyItMatters": "The underlying logic or relationship the student needs to understand (2-4 sentences max)",
  "example": "A concrete short example that illustrates the concept (1-3 sentences, or null if not helpful)",
  "keyDistinction": "Why the student's wrong answer was tempting and what makes the correct answer correct (2-3 sentences, or null if no question context)",
  "verification": {
    "question": "A NEW MCQ question testing understanding of the SAME concept from a DIFFERENT angle",
    "options": {"a": "...", "b": "...", "c": "...", "d": "..."},
    "correctAnswer": "b",
    "explanation": "Why the correct answer is correct"
  }
}
`;

  return prompt;
}

// ─── Executor Input ─────────────────────────────────────────

/**
 * Input to the concept teaching executor.
 * Combines the RepairRequest with concept metadata from the database.
 */
export interface ConceptTeachingInput {
  /** The R3.1 RepairRequest. */
  request: RepairRequest;
  /** Concept metadata from the concepts table. */
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
  /** Latest Knowledge note for this concept — grounding only, never regenerated. */
  conceptNote?: RepairNoteGrounding | null;
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute a concept teaching repair.
 *
 * Takes a RepairRequest + concept metadata and generates a targeted
 * teaching intervention using the existing AI infrastructure.
 *
 * @param input - RepairRequest + concept metadata
 * @returns ConceptTeachingRepair ready for student consumption
 * @throws Error if AI call fails or response validation fails
 */
export async function executeConceptTeaching(
  input: ConceptTeachingInput,
): Promise<ConceptTeachingRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords, conceptNote = null } = input;

  // Guard: only handle concept_teaching intent
  if (request.repairIntent !== "concept_teaching") {
    throw new Error(
      `ConceptTeachingExecutor only handles "concept_teaching" intent, ` +
      `got "${request.repairIntent}"`
    );
  }

  // Build prompt with question context
  const userPrompt = buildUserPrompt(
    conceptName,
    conceptSubject,
    conceptKeywords,
    request.questionContext,
    conceptNote,
  );

  // Execute AI call using existing infrastructure
  const aiResponse = await executeWithRetry({
    prompt: userPrompt,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 1500,
    format: "json",
  });

  // Validate response using existing pipeline (JSON repair + Zod)
  const validation = validateAIResponse(
    aiResponse.content,
    conceptTeachingResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Concept teaching AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedConceptTeachingResponse = validation.data;

  // Build the repair output
  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "concept_not_understood",
    repairIntent: "concept_teaching",
    questionContext: request.questionContext,
    explanation: {
      coreIdea: data.coreIdea,
      whyItMatters: data.whyItMatters,
      example: data.example,
      keyDistinction: data.keyDistinction,
    },
    verification: {
      question: data.verification.question,
      options: data.verification.options,
      correctAnswer: data.verification.correctAnswer,
      explanation: data.verification.explanation,
    },
    status: "ready",
    generatedAt: new Date(),
  };
}
