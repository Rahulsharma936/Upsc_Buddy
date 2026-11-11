/**
 * R3.9 — Error Awareness Repair Executor
 *
 * Handles the "error_awareness" repair intent for failureReason = "careless_mistake".
 *
 * When a student reports "I made a careless mistake", they're asserting they
 * possess the knowledge but failed to apply it — a process failure, not a
 * knowledge failure. This executor respects that distinction absolutely:
 *
 *   A. whatWasOverlooked — the specific procedural step that was skipped
 *   B. theTrap — why this question's design makes that mistake likely
 *   C. checkingStep — a concrete pre-commit verification procedure
 *   D. patternAwareness — the error class, for recognition in future questions
 *   E. verification — a new MCQ with a similar trap (reuses the R3.3 pipeline)
 *
 * When question context exists, the repair is anchored to the actual failed
 * question. Without context, it addresses common careless-error patterns for
 * the concept without inventing an oversight that didn't happen.
 *
 * Boundaries (enforced by tests, not just convention):
 *   - No concept reteaching — the student says they already know it
 *   - No failure reason reinterpretation — careless_mistake stays careless_mistake
 *   - No R2 diagnostic scoring, gap classification, or mastery mutation
 *   - No database access, no event logging, no side effects
 *   - No novel verification mechanism — uses the shared R3.3 MCQ pipeline
 *
 * @see RepairRequest in repair-request.builder.ts
 * @see calibration.executor.ts — structurally parallel executor (R3.8)
 */

import { z } from "zod";
import { formatRepairGuidance } from "./note-grounding";
import type { RepairNoteGrounding } from "./note-grounding";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * Surfaces the procedural error and equips the student with a checking tool.
 *
 * Each field maps to one of the executor's stated objectives:
 *   whatWasOverlooked → "What did I miss?"
 *   theTrap          → "Why was it easy to miss?"
 *   checkingStep     → "How do I catch this next time?"
 *   patternAwareness → "What does this class of error look like?"
 */
export interface ErrorAwarenessBreakdown {
  /** The specific thing the student likely overlooked or skipped. */
  whatWasOverlooked: string;
  /** Why this kind of mistake is easy to make on this type of question. */
  theTrap: string;
  /**
   * A concrete verification step the student could have applied before
   * committing to their answer.
   *
   * null when no question context was available — we refuse to invent
   * a checking procedure for an oversight we can't identify.
   */
  checkingStep: string | null;
  /** What to watch for in similar questions to avoid the same class of error. */
  patternAwareness: string;
}

/**
 * Verification MCQ that tests whether the student can apply CAREFUL READING
 * to a question containing a similar process trap.
 *
 * Structurally identical to every other executor's verification, so it flows
 * through the same R3.3 endpoint and PracticeCard UI without special-casing.
 */
export interface ErrorAwarenessVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete error awareness repair output, ready for student consumption. */
export interface ErrorAwarenessRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved exactly, never reinterpreted. */
  failureReason: "careless_mistake";
  /** The repair intent — always "error_awareness" for this executor. */
  repairIntent: "error_awareness";
  questionContext: RepairQuestionContext | null;
  breakdown: ErrorAwarenessBreakdown;
  verification: ErrorAwarenessVerification;
  status: "ready";
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

/**
 * Validates the raw AI JSON response before it becomes an ErrorAwarenessRepair.
 *
 * Constraints are calibrated for UPSC-prep content:
 *   - min(10) on required strings prevents hollow one-word answers
 *   - max limits prevent runaway generation
 *   - checkingStep uses .catch(null) so non-string values (e.g. a number)
 *     degrade gracefully to null rather than crashing the repair pipeline
 */
export const errorAwarenessResponseSchema = z.object({
  whatWasOverlooked: z.string().min(10).max(800).trim(),
  theTrap: z.string().min(10).max(1000).trim(),
  checkingStep: z.string().max(800).trim().nullable().catch(null),
  patternAwareness: z.string().min(10).max(800).trim(),
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

type ValidatedResponse = z.infer<typeof errorAwarenessResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

/**
 * System prompt for the error awareness AI call.
 *
 * Organised into three sections for AI comprehension:
 *   1. Role & context — what the AI is and what happened
 *   2. Content rules — what each output field should contain, with
 *      concrete good/bad examples to anchor generation quality
 *   3. Boundaries — hard prohibitions that prevent mode collapse
 *      into concept reteaching
 *
 * The PROCESS ERROR framing is the critical lever: every rule steers
 * the AI away from knowledge remediation and toward procedural intervention.
 */
const SYSTEM_PROMPT = `
You are a UPSC error-awareness coach specialising in careless-mistake interventions.

The student answered a practice MCQ incorrectly and self-reported:
"I made a careless mistake." They believe they possess the required knowledge
but selected the wrong answer due to a procedural oversight — a misread stem,
a skipped qualifier, or a hasty selection.

RESPONSE FORMAT:
1. Respond ONLY with valid JSON. No markdown, no prose, no code fences.

CONTENT RULES:
2. "whatWasOverlooked" — Name the specific procedural oversight: a negation
   the student likely skipped, a qualifier they glossed over, a distractor
   they conflated with the correct option, or a stem they misread.
3. "theTrap" — Explain why the QUESTION'S DESIGN makes this mistake likely.
   Focus on question structure (negation placement, similar-looking options,
   double negatives), not on concept difficulty.
4. "checkingStep" — A concrete, mechanical verification procedure the student
   could have executed before committing. Bad: "Read more carefully."
   Good: "Re-read the stem and underline any negation before looking at the
   options." Set to null ONLY when no question context is provided.
5. "patternAwareness" — Describe the CLASS of careless error so the student
   recognises it across future questions, not just this one.
6. The verification question MUST contain a similar process trap (negation,
   qualifier, look-alike options) that rewards careful, deliberate reading.
   It must be a NEW question — never the original. All distractors must be
   plausible at UPSC level.

BOUNDARIES:
7. Do NOT reteach the concept. The student says they already know it.
8. Do NOT diagnose the student. Never claim they "don't understand the concept",
   "have forgotten it", or have any kind of knowledge gap.
9. Focus exclusively on the PROCESS ERROR: what was overlooked, why the question
   made it easy to overlook, and how to catch it mechanically next time.
10. Do NOT fabricate constitutional articles, committee names, schemes, or facts.
11. Maintain UPSC-level factual accuracy throughout.
`;

/**
 * Builds the user-facing prompt with concept metadata and question context.
 *
 * Two modes:
 *   - With question context → anchored to the specific failed question, with
 *     the student's careless selection and the correct answer shown explicitly
 *   - Without question context → addresses common careless-error traps for
 *     the concept, with an explicit prohibition against inventing oversight
 */
function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
  conceptNote: RepairNoteGrounding | null = null,
): string {
  let prompt = `
ERROR-CHECKING TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}
${formatRepairGuidance(conceptNote)}
The student answered a practice MCQ about this concept incorrectly and reported:
"I made a careless mistake."
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
Student carelessly selected: ${questionContext.selectedAnswer}`;
    }
    if (questionContext.correctAnswer) {
      prompt += `
Correct answer: ${questionContext.correctAnswer}`;
    }
    prompt += `

Use this context to:
- Identify exactly what the student likely overlooked (negation, qualifier, similar option)
- Explain why this specific mistake is easy to make given the question's structure
- Provide a concrete, mechanical checking step that would have caught this error
- Describe the broader error pattern so they recognise it in future questions
`;
  } else {
    prompt += `
No specific question context is available. Do NOT invent an oversight that did not
happen. Address the most common careless-error traps for questions on this concept
(negations, qualifiers, similar-sounding terms) and set checkingStep to null.
`;
  }

  prompt += `
Generate a targeted error-awareness intervention. Be precise and concise.

Respond in this EXACT JSON format:

{
  "whatWasOverlooked": "The specific thing the student likely missed or skipped (1-3 sentences)",
  "theTrap": "Why this kind of mistake is easy to make on this type of question (1-3 sentences)",
  "checkingStep": "A concrete verification procedure they could have applied before committing (1-2 sentences, or null if no question context)",
  "patternAwareness": "What to watch for in similar questions to avoid this class of error (1-2 sentences)",
  "verification": {
    "question": "A NEW MCQ with a similar trap that rewards CAREFUL reading",
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
export interface ErrorAwarenessInput {
  request: RepairRequest;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
  /** Latest Knowledge note for this concept — grounding only, never regenerated. */
  conceptNote?: RepairNoteGrounding | null;
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute an error awareness repair.
 *
 * Flow: guard → prompt → AI call → validate → transform
 *
 * The guard fires before the AI call, ensuring we never burn tokens
 * on a request that was mis-routed to this executor.
 *
 * @param input - RepairRequest + concept metadata
 * @returns ErrorAwarenessRepair ready for the student
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeErrorAwareness(
  input: ErrorAwarenessInput,
): Promise<ErrorAwarenessRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords, conceptNote = null } = input;

  // ── Intent guard ──────────────────────────────────────
  // Fires before the AI call so we never waste tokens on a mis-routed request.
  if (request.repairIntent !== "error_awareness") {
    throw new Error(
      `ErrorAwarenessExecutor only handles "error_awareness" intent, ` +
      `got "${request.repairIntent}"`
    );
  }

  // ── Build prompt and call AI ──────────────────────────
  const userPrompt = buildUserPrompt(
    conceptName,
    conceptSubject,
    conceptKeywords,
    request.questionContext,
    conceptNote,
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
    errorAwarenessResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Error awareness AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

  // ── Transform validated data into the repair output ───
  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "careless_mistake",
    repairIntent: "error_awareness",
    questionContext: request.questionContext,
    breakdown: {
      whatWasOverlooked: data.whatWasOverlooked,
      theTrap: data.theTrap,
      checkingStep: data.checkingStep,
      patternAwareness: data.patternAwareness,
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
