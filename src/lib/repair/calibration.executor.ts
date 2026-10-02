/**
 * R3.8 — Calibration Repair Executor
 *
 * Executes the "calibration" repair intent.
 * Consumes a RepairRequest (from R3.1) where failureReason = "overconfident".
 *
 * The student said "I was confident, but got it wrong." The ONLY authoritative
 * fact is that their confidence did not match their outcome. This executor
 * makes that mismatch visible and actionable:
 *
 *   A. What you believed — the assumption that felt certain
 *   B. What was actually correct — the fact, distinction, or rule that decided it
 *   C. Where the confidence broke — why the belief felt right but was wrong
 *   D. Self-check — a concrete question the student can ask themselves next time
 *   E. Verification — the SAME R3.3 MCQ mechanism the other executors use
 *
 * Anchored to the actual failed question. With no question context the repair
 * addresses the most commonly over-confidently confused aspect of the concept
 * rather than inventing a mismatch that never happened.
 *
 * Does NOT:
 *   - Reteach the concept from scratch — the student thought they knew it
 *   - Convert overconfident into concept_not_understood or could_not_recall
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
 * Surfaces the mismatch between what the student believed and what was true.
 * Four fields, each answering one of the repair's stated objectives.
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
   * null when no question context was available to pinpoint the mismatch.
   */
  whereConfidenceBroke: string | null;
  /** A concrete self-check question the student can ask themselves next time. */
  selfCheck: string;
}

/**
 * Verification MCQ testing whether the student can now DISTINGUISH the correct
 * from the believed-correct. Structurally identical to the other executors'
 * verification so it flows through the same R3.3 endpoint and PracticeCard UI.
 */
export interface CalibrationVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete calibration repair output. */
export interface CalibrationRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved, never reinterpreted. */
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

const SYSTEM_PROMPT = `
You are a focused UPSC calibration coach.

The student was CONFIDENT on a practice MCQ but got it wrong. The only thing
you know is that their confidence did not match their outcome.

STRICT RULES:
1. Respond ONLY with valid JSON.
2. No markdown.
3. No conversational text.
4. Do NOT reteach the concept from scratch. The student believed they already knew it.
5. Do NOT diagnose the student. Never claim they "don't understand the concept",
   "have forgotten it", or have any kind of gap. You do not know the deeper cause.
6. Focus on the MISMATCH: what the student likely believed, what was actually
   correct, and why the belief felt right but was wrong.
7. "whereConfidenceBroke" must identify the source of the overconfidence — a
   partial truth, a common confusion, a plausible-sounding but incorrect rule,
   or outdated information. Use null only when no question context exists.
8. "selfCheck" must be a concrete question the student can ask themselves before
   committing to an answer next time — not generic advice like "study more".
9. The verification question MUST test whether the student can now DISTINGUISH
   the correct from the believed-correct — never the original question.
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

/** Mirrors the sibling executors' input so the API route treats all alike. */
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
 * @param input - RepairRequest + concept metadata
 * @returns CalibrationRepair ready for student consumption
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeCalibration(
  input: CalibrationInput,
): Promise<CalibrationRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords } = input;

  // Guard: only handle calibration intent
  if (request.repairIntent !== "calibration") {
    throw new Error(
      `CalibrationExecutor only handles "calibration" intent, ` +
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
    calibrationResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Calibration AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

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
