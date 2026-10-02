/**
 * R3.8 — Calibration Repair Executor
 *
 * Handles the "calibration" repair intent for failureReason = "overconfident".
 *
 * When a student reports "I was confident, but got it wrong", they're asserting
 * they believed they had the knowledge but their confidence didn't match the
 * outcome. This executor makes that mismatch visible and actionable:
 *
 *   A. whatYouBelieved — the assumption the student held with certainty
 *   B. whatWasActuallyCorrect — the fact, distinction, or rule that decided it
 *   C. whereConfidenceBroke — why the belief felt right but was wrong
 *   D. selfCheck — a concrete question the student can ask themselves next time
 *   E. verification — a new MCQ with a similar trap (reuses the R3.3 pipeline)
 *
 * When question context exists, the repair is anchored to the actual failed
 * question. Without context, it addresses the most commonly over-confidently
 * confused aspect of the concept without inventing a mismatch that never happened.
 *
 * Boundaries (enforced by tests, not just convention):
 *   - No concept reteaching — the student thought they knew it
 *   - No failure reason reinterpretation — overconfident stays overconfident
 *   - No R2 diagnostic scoring, gap classification, or mastery mutation
 *   - No database access, no event logging, no side effects
 *   - No novel verification mechanism — uses the shared R3.3 MCQ pipeline
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
 * Surfaces the mismatch between what the student believed and what was true.
 *
 * Each field maps to one of the executor's stated objectives:
 *   whatYouBelieved         → "What did I think was true?"
 *   whatWasActuallyCorrect  → "What was actually correct?"
 *   whereConfidenceBroke    → "Why did my belief feel right but turn out wrong?"
 *   selfCheck               → "What should I ask myself next time?"
 */
export interface CalibrationBreakdown {
  /** The assumption or belief the student held with confidence. */
  whatYouBelieved: string;
  /** The fact, distinction, or rule that actually decided the answer. */
  whatWasActuallyCorrect: string;
  /**
   * Why the student's belief felt right but was wrong — the source of
   * the overconfidence (e.g., partial truth, common confusion, plausible
   * but outdated information).
   *
   * null when no question context was available — we refuse to invent
   * a mismatch source for an overconfidence we can't pinpoint.
   */
  whereConfidenceBroke: string | null;
  /** A concrete self-check question the student can ask themselves next time. */
  selfCheck: string;
}

/**
 * Verification MCQ testing whether the student can now DISTINGUISH the correct
 * from the believed-correct.
 *
 * Structurally identical to every other executor's verification, so it flows
 * through the same R3.3 endpoint and PracticeCard UI without special-casing.
 */
export interface CalibrationVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete calibration repair output, ready for student consumption. */
export interface CalibrationRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved exactly, never reinterpreted. */
  failureReason: "overconfident";
  /** The repair intent — always "calibration" for this executor. */
  repairIntent: "calibration";
  questionContext: RepairQuestionContext | null;
  /** The calibration breakdown. */
  breakdown: CalibrationBreakdown;
  /** The verification MCQ. */
  verification: CalibrationVerification;
  status: "ready";
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

/**
 * Validates the raw AI JSON response before it becomes a CalibrationRepair.
 *
 * Constraints are calibrated for UPSC-prep content:
 *   - min(10) on required strings prevents hollow one-word answers
 *   - max limits prevent runaway generation
 *   - whereConfidenceBroke uses .catch(null) so non-string values (e.g. a number)
 *     degrade gracefully to null rather than crashing the repair pipeline
 */
export const calibrationResponseSchema = z.object({
  whatYouBelieved: z.string().min(10).max(800).trim(),
  whatWasActuallyCorrect: z.string().min(10).max(1000).trim(),
  whereConfidenceBroke: z.string().max(1000).trim().nullable().catch(null),
  selfCheck: z.string().min(10).max(800).trim(),
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

type ValidatedResponse = z.infer<typeof calibrationResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

/**
 * System prompt for the calibration AI call.
 *
 * Organised into three sections for AI comprehension:
 *   1. RESPONSE FORMAT — output shape and encoding rules
 *   2. CONTENT RULES — what each output field should contain, with
 *      concrete good/bad examples to anchor generation quality
 *   3. BOUNDARIES — hard prohibitions that prevent mode collapse
 *      into concept reteaching or diagnosis
 *
 * The MISMATCH framing is the critical lever: every rule steers
 * the AI away from knowledge remediation and toward confidence
 * calibration.
 */
const SYSTEM_PROMPT = `
You are a UPSC calibration coach specialising in overconfidence interventions.

The student answered a practice MCQ incorrectly and self-reported:
"I was confident, but got it wrong." They believe they possessed the required
knowledge but their confidence did not match their outcome — a calibration
failure, not necessarily a knowledge failure.

RESPONSE FORMAT:
1. Respond ONLY with valid JSON. No markdown, no prose, no code fences.

CONTENT RULES:
2. "whatYouBelieved" — Name the specific assumption or belief the student
   likely held with confidence: a partial truth, a commonly confused rule,
   or a plausible-sounding but incorrect fact.
3. "whatWasActuallyCorrect" — State the fact, distinction, or rule that
   actually decided the answer. Focus on the decisive difference.
4. "whereConfidenceBroke" — Identify the SOURCE of the overconfidence:
   a partial truth, a common confusion, a plausible-sounding but incorrect
   rule, or outdated information. Bad: "You were wrong."
   Good: "The 42nd Amendment covers many topics, making it a plausible
   answer, but it predates the anti-defection law by nearly a decade."
   Set to null ONLY when no question context is provided.
5. "selfCheck" — A concrete question the student can ask themselves before
   committing to an answer next time. Bad: "Study more carefully."
   Good: "Ask yourself: 'Do I remember the specific year and Schedule
   number, or am I guessing from a famous amendment?'"
6. The verification question MUST test whether the student can DISTINGUISH
   the correct from the believed-correct. It must be a NEW question — never
   the original. All distractors must be plausible at UPSC level.

BOUNDARIES:
7. Do NOT reteach the concept. The student believed they already knew it.
8. Do NOT diagnose the student. Never claim they "don't understand the concept",
   "have forgotten it", or have any kind of knowledge gap.
9. Focus exclusively on the MISMATCH: what was believed, what was true, and
   why the belief felt right but was wrong.
10. Do NOT fabricate constitutional articles, committee names, schemes, or facts.
11. Maintain UPSC-level factual accuracy throughout.
12. Be precise and accurate — UPSC-level correctness is required.
`;

/**
 * Builds the user-facing prompt with concept metadata and question context.
 *
 * Two modes:
 *   - With question context → anchored to the specific failed question, with
 *     the student's confident selection and the correct answer shown explicitly
 *   - Without question context → addresses the most commonly over-confidently
 *     confused aspect of the concept, with an explicit prohibition against
 *     inventing a mismatch that didn't happen
 */
function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
): string {
  let prompt = `
CALIBRATION TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}

The student answered a practice MCQ about this concept incorrectly and reported:
"I was confident, but got it wrong."
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
Student confidently selected: ${questionContext.selectedAnswer}`;
    }
    if (questionContext.correctAnswer) {
      prompt += `
Correct answer: ${questionContext.correctAnswer}`;
    }
    prompt += `

Use this context to:
- Identify the assumption the student likely held with confidence
- Show what was actually correct and why
- Explain why their belief felt right but was wrong
- Give a self-check question that would have caught this mismatch
`;
  } else {
    prompt += `
No specific question context is available. Do NOT invent a mismatch that did not
happen. Address the most commonly over-confidently confused aspect of this
concept and set whereConfidenceBroke to null.
`;
  }

  prompt += `
Generate a targeted calibration intervention. Keep it SHORT.

Respond in this EXACT JSON format:

{
  "whatYouBelieved": "The assumption the student likely held with confidence (1-3 sentences)",
  "whatWasActuallyCorrect": "The fact, distinction, or rule that actually decided it (1-3 sentences)",
  "whereConfidenceBroke": "Why the belief felt right but was wrong — the source of the overconfidence (1-3 sentences, or null if no question context)",
  "selfCheck": "A concrete question the student can ask themselves next time before committing (1-2 sentences)",
  "verification": {
    "question": "A NEW MCQ testing whether the student can DISTINGUISH the correct from the believed-correct",
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
export interface CalibrationInput {
  request: RepairRequest;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute a calibration repair.
 *
 * Flow: guard → prompt → AI call → validate → transform
 *
 * The guard fires before the AI call, ensuring we never burn tokens
 * on a request that was mis-routed to this executor.
 *
 * @param input - RepairRequest + concept metadata
 * @returns CalibrationRepair ready for student consumption
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeCalibration(
  input: CalibrationInput,
): Promise<CalibrationRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords } = input;

  // ── Intent guard ──────────────────────────────────────
  // Fires before the AI call so we never waste tokens on a mis-routed request.
  if (request.repairIntent !== "calibration") {
    throw new Error(
      `CalibrationExecutor only handles "calibration" intent, ` +
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
    calibrationResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Calibration AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

  // ── Transform validated data into the repair output ───
  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "overconfident",
    repairIntent: "calibration",
    questionContext: request.questionContext,
    breakdown: {
      whatYouBelieved: data.whatYouBelieved,
      whatWasActuallyCorrect: data.whatWasActuallyCorrect,
      whereConfidenceBroke: data.whereConfidenceBroke,
      selfCheck: data.selfCheck,
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
