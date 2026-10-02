/**
 * R3.7 — Uncertainty Resolution Repair Executor
 *
 * Handles the "uncertainty_resolution" repair intent for failureReason = "guessed".
 *
 * When a student reports "I wasn't sure and guessed", they're asserting they
 * could not choose confidently between the options. The ONLY authoritative fact
 * is that they were uncertain. This executor does not decide WHY:
 *
 *   - It does NOT conclude the student has a concept gap.
 *   - It does NOT conclude the student has a memory gap.
 *   - It does NOT classify the uncertainty at all.
 *
 * Instead it resolves the uncertainty around the specific question, turning
 * "I wasn't sure, so I guessed" into "I know what to look for next time":
 *
 *   A. keyDistinction      — the evidence separating the answer from the distractors
 *   B. whyBetterSupported  — the case for the correct option
 *   C. competingOption     — the most plausible rival, addressed where useful
 *   D. howToDecide         — a targeted rule for telling them apart next time
 *   E. verification        — the SAME R3.3 MCQ mechanism the other executors use
 *
 * When question context exists, the repair is anchored to the actual failed
 * question. Without context, it addresses common distinction-confusion patterns
 * for the concept without inventing a competing option that was never presented.
 *
 * Boundaries (enforced by tests, not just convention):
 *   - No diagnosis — the executor NEVER concludes a concept gap, memory gap,
 *     or any gap; it does not know why the student guessed
 *   - No concept reteaching — resolve the specific uncertainty, nothing more
 *   - No failure reason reinterpretation — "guessed" stays "guessed"
 *   - No R2 diagnostic scoring, gap classification, or mastery mutation
 *   - No database access, no event logging, no side effects
 *   - No novel verification mechanism — uses the shared R3.3 MCQ pipeline
 *
 * @see RepairRequest in repair-request.builder.ts
 * @see error-awareness.executor.ts — structurally parallel executor (R3.9)
 */

import { z } from "zod";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * What separates the correct option from the ones that tempted the student.
 *
 * Each field maps to one of the executor's stated objectives:
 *   keyDistinction    → "What separates the right answer from the wrong ones?"
 *   whyBetterSupported → "Why is the correct option the right one?"
 *   competingOption   → "Which option was most tempting and why is it wrong?"
 *   howToDecide       → "How do I tell them apart next time?"
 */
export interface UncertaintyResolutionBreakdown {
  /** The distinction or evidence that separates correct from distractors. */
  keyDistinction: string;
  /** Why the correct option is the better-supported one. */
  whyBetterSupported: string;
  /**
   * The most plausible competing option and why it falls short.
   *
   * null when no question context made a specific rival identifiable —
   * we refuse to invent a competitor that was never presented.
   */
  competingOption: string | null;
  /** A targeted way to tell these apart next time. */
  howToDecide: string;
}

/**
 * Verification MCQ testing the DISTINCTION the student was unsure about.
 *
 * Structurally identical to every other executor's verification, so it flows
 * through the same R3.3 endpoint and PracticeCard UI without special-casing.
 */
export interface UncertaintyResolutionVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete uncertainty resolution repair output, ready for student consumption. */
export interface UncertaintyResolutionRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved exactly, never reinterpreted. */
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

/**
 * Validates the raw AI JSON response before it becomes an UncertaintyResolutionRepair.
 *
 * Constraints are calibrated for UPSC-prep content:
 *   - min(10) on required strings prevents hollow one-word answers
 *   - max limits prevent runaway generation (800–1000 chars depending on field)
 *   - competingOption uses .catch(null) so non-string values (e.g. a number)
 *     degrade gracefully to null rather than crashing the repair pipeline
 */
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

/**
 * System prompt for the uncertainty resolution AI call.
 *
 * Organised into three sections for AI comprehension:
 *   1. RESPONSE FORMAT — JSON-only rules
 *   2. CONTENT RULES — what each output field should contain, with
 *      concrete good/bad examples to anchor generation quality
 *   3. BOUNDARIES — hard prohibitions, especially the NO-DIAGNOSIS rule
 *      that prevents mode collapse into concept reteaching
 *
 * The DISCRIMINATION framing is the critical lever: every rule steers
 * the AI toward resolving the specific uncertainty between options,
 * not toward diagnosing or reteaching the underlying concept.
 */
const SYSTEM_PROMPT = `
You are a focused UPSC discrimination coach.

The student was UNSURE on a practice MCQ and guessed. The only thing you know is
that they could not choose confidently between the options.

RESPONSE FORMAT:
1. Respond ONLY with valid JSON. No markdown, no prose, no code fences.

CONTENT RULES:
2. "keyDistinction" — Name the specific evidence, criterion, or definition that
   DISTINGUISHES the correct option from the distractors. Focus on the deciding
   factor, not on restating the concept from scratch.
   Bad: "You need to understand the concept better."
   Good: "The Finance Commission recommends future allocation; the CAG checks past spending. Ask: advise or audit?"
3. "whyBetterSupported" — Explain why the correct option is better supported
   than the alternatives, citing the specific constitutional provision, date,
   scope, or authority that anchors it.
4. "competingOption" — Identify the most plausible rival option and explain why
   it falls short. Use null ONLY when no question context is provided and
   no specific rival can be identified. Do NOT invent a competing option.
5. "howToDecide" — An actionable discrimination rule the student can apply to a
   similar set of options next time. Must be a concrete test, not generic advice.
   Bad: "Study the topic more carefully."
   Good: "Ask whether the body ADVISES on future allocation or CHECKS past spending — that separates the Finance Commission from the CAG every time."
6. The verification question MUST test the SAME distinction from a DIFFERENT angle —
   never the original question with reworded options. All distractors must be
   plausible at UPSC level.

BOUNDARIES:
7. Do NOT diagnose the student. Never claim they "don't understand the concept",
   "have forgotten it", or have any kind of gap. You do not know why they guessed.
8. Do NOT reteach the topic from scratch. Resolve the specific uncertainty.
9. Focus on what DISTINGUISHES the correct option from the tempting ones —
   the evidence, criterion, date, scope, authority or definition that decides it.
10. Do NOT fabricate constitutional articles, committee names, schemes, or facts.
11. Maintain UPSC-level factual accuracy throughout.
`;

/**
 * Builds the user-facing prompt with concept metadata and question context.
 *
 * Two modes:
 *   - With question context → anchored to the specific failed question, with
 *     the student's guessed selection and the correct answer shown explicitly
 *   - Without question context → addresses common distinction-confusion patterns
 *     for the concept, with an explicit prohibition against inventing a rival
 */
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

/** Mirrors the sibling executors' input shape so the API route treats all alike. */
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
 * Flow: guard → prompt → AI call → validate → transform
 *
 * The guard fires before the AI call, ensuring we never burn tokens
 * on a request that was mis-routed to this executor.
 *
 * @param input - RepairRequest + concept metadata
 * @returns UncertaintyResolutionRepair ready for the student
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeUncertaintyResolution(
  input: UncertaintyResolutionInput,
): Promise<UncertaintyResolutionRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords } = input;

  // ── Intent guard ──────────────────────────────────────
  // Fires before the AI call so we never waste tokens on a mis-routed request.
  if (request.repairIntent !== "uncertainty_resolution") {
    throw new Error(
      `UncertaintyResolutionExecutor only handles "uncertainty_resolution" intent, ` +
      `got "${request.repairIntent}"`
    );
  }

  // ── Build prompt and call AI ──────────────────────────
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

  // ── Validate AI response against schema ───────────────
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

  // ── Transform validated data into the repair output ───
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
