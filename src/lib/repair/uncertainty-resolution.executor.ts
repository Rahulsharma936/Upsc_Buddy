/**
 * R3.7 — Uncertainty Resolution Repair Executor
 *
 * Executes the "uncertainty_resolution" repair intent.
 * Consumes a RepairRequest (from R3.1) where failureReason = "guessed".
 *
 * The student said "I wasn't sure and guessed." The ONLY authoritative fact is
 * that they were uncertain. This executor does not decide WHY:
 *
 *   - It does NOT conclude the student has a concept gap.
 *   - It does NOT conclude the student has a memory gap.
 *   - It does NOT classify the uncertainty at all.
 *
 * Instead it resolves the uncertainty around the specific question, turning
 * "I wasn't sure, so I guessed" into "I know what to look for next time":
 *
 *   A. Key distinction — the evidence separating the answer from the distractors
 *   B. Why it is better supported — the case for the correct option
 *   C. Competing option — the most plausible rival, addressed where useful
 *   D. How to decide — a targeted rule for telling them apart next time
 *   E. Verification — the SAME R3.3 MCQ mechanism the other executors use
 *
 * Does NOT:
 *   - Re-diagnose the student, or use R2 diagnostic scoring
 *   - Modify SM-2 or mastery
 *   - Mark the student as "resolved"
 *   - Create database records
 *   - Introduce a second verification mechanism
 *
 * @see RepairRequest in repair-request.builder.ts
 * @see concept-teaching.executor.ts — the executor pattern this follows
 */

import { z } from "zod";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * What separates the correct option from the ones that tempted the student.
 * Four fields, each answering one of the repair's stated objectives.
 */
export interface UncertaintyResolutionBreakdown {
  /** The distinction or evidence that separates correct from distractors. */
  keyDistinction: string;
  /** Why the correct option is the better-supported one. */
  whyBetterSupported: string;
  /**
   * The most plausible competing option and why it falls short.
   * null when no question context made a specific rival identifiable.
   */
  competingOption: string | null;
  /** A targeted way to tell these apart next time. */
  howToDecide: string;
}

/**
 * Verification MCQ testing the DISTINCTION the student was unsure about.
 * Structurally identical to the other executors' verification so it flows
 * through the same R3.3 endpoint and the same PracticeCard UI.
 */
export interface UncertaintyResolutionVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete uncertainty resolution repair output. */
export interface UncertaintyResolutionRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved, never reinterpreted. */
  failureReason: "guessed";
  /** The repair intent — always "uncertainty_resolution" for this executor. */
  repairIntent: "uncertainty_resolution";
  questionContext: RepairQuestionContext | null;
  /** The uncertainty breakdown. */
  breakdown: UncertaintyResolutionBreakdown;
  /** The verification MCQ. */
  verification: UncertaintyResolutionVerification;
  status: "ready";
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

export const uncertaintyResolutionResponseSchema = z.object({
  keyDistinction: z.string().min(10).max(800).trim(),
  whyBetterSupported: z.string().min(10).max(1000).trim(),
  competingOption: z.string().max(1000).trim().nullable().catch(null),
  howToDecide: z.string().min(10).max(800).trim(),
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

type ValidatedResponse = z.infer<typeof uncertaintyResolutionResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

const SYSTEM_PROMPT = `
You are a focused UPSC discrimination coach.

The student was UNSURE on a practice MCQ and guessed. The only thing you know is
that they could not choose confidently between the options.

STRICT RULES:
1. Respond ONLY with valid JSON.
2. No markdown.
3. No conversational text.
4. Do NOT diagnose the student. Never claim they "don't understand the concept",
   "have forgotten it", or have any kind of gap. You do not know why they guessed.
5. Do not reteach the topic from scratch. Resolve the specific uncertainty.
6. Focus on what DISTINGUISHES the correct option from the tempting ones —
   the evidence, criterion, date, scope, authority or definition that decides it.
7. Address the most plausible competing option where the context identifies one.
   Use null if no specific rival can be identified.
8. "howToDecide" must be an actionable discrimination rule the student can apply
   to a similar set of options next time.
9. The verification question MUST test the SAME distinction from a DIFFERENT angle —
   never the original question with reworded options.
10. All distractors in the verification must be plausible.
11. Do NOT invent constitutional articles, committee names, schemes, or facts.
12. Be precise and accurate — UPSC-level correctness is required.
`;

function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
): string {
  let prompt = `
UNCERTAINTY TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}

The student answered a practice MCQ about this concept incorrectly and reported:
"I wasn't sure and guessed."
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
Student guessed: ${questionContext.selectedAnswer}`;
    }
    if (questionContext.correctAnswer) {
      prompt += `
Correct answer: ${questionContext.correctAnswer}`;
    }
    prompt += `

Use this context to:
- Name the distinction that separates the correct option from the guessed one
- Show why the correct option is better supported
- Address the option the student guessed as the competing candidate
- Give a discrimination rule that transfers to similar option sets
`;
  } else {
    prompt += `
No specific question context is available. Do NOT invent a competing option that
was never presented. Give the distinction most often confused within this concept
and set competingOption to null.
`;
  }

  prompt += `
Generate a targeted uncertainty resolution. Keep it SHORT.

Respond in this EXACT JSON format:

{
  "keyDistinction": "The distinction or evidence that separates the correct option from the distractors (1-3 sentences)",
  "whyBetterSupported": "Why the correct option is the better-supported one (1-3 sentences)",
  "competingOption": "The most plausible competing option and why it falls short (1-3 sentences, or null if none identifiable)",
  "howToDecide": "An actionable rule for telling these apart next time (1-2 sentences)",
  "verification": {
    "question": "A NEW MCQ testing the SAME distinction from a DIFFERENT angle",
    "options": {"a": "...", "b": "...", "c": "...", "d": "..."},
    "correctAnswer": "b",
    "explanation": "Why the correct answer is correct"
  }
}
`;

  return prompt;
}

// ─── Executor Input ─────────────────────────────────────────

/** Mirrors the sibling executors' input so the API route treats all alike. */
export interface UncertaintyResolutionInput {
  request: RepairRequest;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute an uncertainty resolution repair.
 *
 * @param input - RepairRequest + concept metadata
 * @returns UncertaintyResolutionRepair ready for student consumption
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeUncertaintyResolution(
  input: UncertaintyResolutionInput,
): Promise<UncertaintyResolutionRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords } = input;

  // Guard: only handle uncertainty_resolution intent
  if (request.repairIntent !== "uncertainty_resolution") {
    throw new Error(
      `UncertaintyResolutionExecutor only handles "uncertainty_resolution" intent, ` +
      `got "${request.repairIntent}"`
    );
  }

  const userPrompt = buildUserPrompt(
    conceptName,
    conceptSubject,
    conceptKeywords,
    request.questionContext,
  );

  const aiResponse = await executeWithRetry({
    prompt: userPrompt,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 1400,
    format: "json",
  });

  const validation = validateAIResponse(
    aiResponse.content,
    uncertaintyResolutionResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Uncertainty resolution AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "guessed",
    repairIntent: "uncertainty_resolution",
    questionContext: request.questionContext,
    breakdown: {
      keyDistinction: data.keyDistinction,
      whyBetterSupported: data.whyBetterSupported,
      competingOption: data.competingOption,
      howToDecide: data.howToDecide,
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
