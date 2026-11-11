/**
 * R3.6 — Question Interpretation Repair Executor
 *
 * Handles the "question_interpretation" repair intent for
 * failureReason = "misunderstood_question".
 *
 * When a student reports "I misunderstood the question/options", they're
 * asserting they may know the topic but failed to parse what the question
 * was actually ASKING — an interpretation failure, not necessarily a
 * knowledge failure. This executor respects that distinction absolutely:
 *
 *   A. whatItAsked        — the actual task, restated plainly
 *   B. decisiveWording    — the qualifier, constraint or framing that mattered
 *   C. whyYourAnswerMissed — how the selection failed that specific task
 *   D. whatToLookFor      — a transferable cue for similar UPSC questions
 *   E. verification       — a new MCQ via the SAME R3.3 pipeline
 *
 * When question context exists, the repair is anchored to the actual failed
 * question. Without context, it addresses how questions of this kind are
 * typically framed without inventing a misreading that never happened.
 *
 * Boundaries (enforced by tests, not just convention):
 *   - No concept reteaching — this is NOT a concept lesson
 *   - No failure reason reinterpretation — misunderstood_question stays
 *   - No R2 diagnostic scoring, gap classification, or mastery mutation
 *   - No database access, no event logging, no side effects
 *   - No novel verification mechanism — uses the shared R3.3 MCQ pipeline
 *
 * @see RepairRequest in repair-request.builder.ts
 * @see error-awareness.executor.ts — the gold-standard executor pattern (R3.9)
 */

import { z } from "zod";
import { formatRepairGuidance } from "./note-grounding";
import type { RepairNoteGrounding } from "./note-grounding";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * Surfaces the interpretation failure and equips the student with a
 * transferable reading strategy.
 *
 * Each field maps to one of the executor's stated objectives:
 *   whatItAsked        → "What was the question actually asking?"
 *   decisiveWording    → "What specific wording decided the answer?"
 *   whyYourAnswerMissed → "Why didn't my chosen option work?"
 *   whatToLookFor      → "What should I watch for next time?"
 */
export interface QuestionInterpretationBreakdown {
  /** The task the question actually set, restated plainly. */
  whatItAsked: string;
  /** The specific wording, qualifier, constraint or framing that decided it. */
  decisiveWording: string;
  /**
   * Why the student's selection did not satisfy that task.
   *
   * null when no question context was available — we refuse to invent
   * an explanation for a misreading we can't identify.
   */
  whyYourAnswerMissed: string | null;
  /** A transferable cue for reading similar UPSC questions correctly. */
  whatToLookFor: string;
}

/**
 * Verification MCQ that tests whether the student can identify what a
 * question is ASKING — testing INTERPRETATION, not recall of the original
 * answer.
 *
 * Structurally identical to every other executor's verification, so it flows
 * through the same R3.3 endpoint and PracticeCard UI without special-casing.
 */
export interface QuestionInterpretationVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete question interpretation repair output, ready for student consumption. */
export interface QuestionInterpretationRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved exactly, never reinterpreted. */
  failureReason: "misunderstood_question";
  /** The repair intent — always "question_interpretation" for this executor. */
  repairIntent: "question_interpretation";
  questionContext: RepairQuestionContext | null;
  /** The interpretation breakdown. */
  breakdown: QuestionInterpretationBreakdown;
  /** The verification MCQ. */
  verification: QuestionInterpretationVerification;
  status: "ready";
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

/**
 * Validates the raw AI JSON response before it becomes a
 * QuestionInterpretationRepair.
 *
 * Constraints are calibrated for UPSC-prep content:
 *   - min(10) on required strings prevents hollow one-word answers
 *   - min(5) on decisiveWording / explanation allows tight but meaningful text
 *   - max limits cap runaway generation (800 for paragraphs, 1500 for MCQ stems)
 *   - whyYourAnswerMissed uses .catch(null) so non-string values (e.g. a number
 *     from a hallucinating model) degrade gracefully to null rather than
 *     crashing the repair pipeline
 */
export const questionInterpretationResponseSchema = z.object({
  whatItAsked: z.string().min(10).max(800).trim(),
  decisiveWording: z.string().min(5).max(800).trim(),
  whyYourAnswerMissed: z.string().max(1000).trim().nullable().catch(null),
  whatToLookFor: z.string().min(10).max(800).trim(),
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

type ValidatedResponse = z.infer<typeof questionInterpretationResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

/**
 * System prompt for the question interpretation AI call.
 *
 * Organised into three sections for AI comprehension:
 *   1. RESPONSE FORMAT — JSON-only output rules
 *   2. CONTENT RULES — what each output field should contain, with
 *      concrete good/bad examples to anchor generation quality
 *   3. BOUNDARIES — hard prohibitions that prevent mode collapse
 *      into concept reteaching
 *
 * The INTERPRETATION framing is the critical lever: every rule steers
 * the AI away from knowledge remediation and toward question-reading
 * intervention.
 */
const SYSTEM_PROMPT = `
You are a focused UPSC question-reading coach.

The student misread what a practice MCQ was ASKING. This is an interpretation
failure, not necessarily a knowledge failure.

RESPONSE FORMAT:
1. Respond ONLY with valid JSON. No markdown, no prose, no code fences.

CONTENT RULES:
2. "whatItAsked" — Restate the question's actual task in plain terms.
   Focus on the task verb and what it requires.
   Bad: "It asked about Article 19."
   Good: "It asked which listed ground is NOT permitted under Article 19(2) — an exception question requiring you to find the odd one out."
3. "decisiveWording" — Quote or name the exact qualifier, negation, scope limiter
   or framing that decided the answer. This is NOT a concept lesson. Do not explain the topic from scratch.
4. "whyYourAnswerMissed" — Explain why the student's chosen option failed the
   TASK, not why the topic is important.
   Bad: "Article 19 is important for fundamental rights."
   Good: "Option b (public order) IS a listed ground, so it answers 'which is valid' — the opposite of what was asked."
   Set to null ONLY when no question context is provided.
5. "whatToLookFor" — A transferable reading cue, not a fact about this topic.
   Bad: "Read the question more carefully."
   Good: "Identify the task verb ('NOT', 'EXCEPT', 'All of the following') before reading options."
6. Focus on the QUESTION: its task verb, qualifiers, negations, "except"/"not",
   scope limiters, and option framing.
7. The verification question MUST test INTERPRETATION — whether the student can
   identify what a question is asking — not recall of the original answer.
   All distractors must be plausible at UPSC level.

BOUNDARIES:
8. This is NOT a concept lesson. Do not explain the topic from scratch.
9. Do NOT diagnose the student. Never claim they "don't understand the concept",
   "have forgotten it", or have any kind of knowledge gap.
10. Do NOT fabricate constitutional articles, committee names, schemes, or facts.
11. Maintain UPSC-level factual accuracy throughout.
12. Be precise and accurate — UPSC-level correctness is required.
`;

/**
 * Builds the user-facing prompt with concept metadata and question context.
 *
 * Two modes:
 *   - With question context → anchored to the specific failed question, with
 *     the student's misread selection and the correct answer shown explicitly
 *   - Without question context → addresses how questions on this concept are
 *     typically framed, with an explicit prohibition against inventing a
 *     misreading that never happened
 */
function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
  conceptNote: RepairNoteGrounding | null = null,
): string {
  let prompt = `
INTERPRETATION TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}
${formatRepairGuidance(conceptNote)}
The student answered a practice MCQ about this concept incorrectly and reported:
"I misunderstood the question/options."
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
- Restate what THIS question actually asked
- Name the exact wording that decided it
- Explain why the student's option failed that task
- Give a reading cue that transfers to similar questions
`;
  } else {
    prompt += `
No specific question context is available. Do NOT invent a misreading that did not
happen. Explain how questions on this concept are typically framed and which
qualifiers decide them, and set whyYourAnswerMissed to null.
`;
  }

  prompt += `
Generate a targeted interpretation breakdown. Keep it SHORT.

Respond in this EXACT JSON format:

{
  "whatItAsked": "What the question actually asked, in plain terms (1-3 sentences)",
  "decisiveWording": "The exact qualifier, negation, scope limiter or framing that decided it (1-2 sentences)",
  "whyYourAnswerMissed": "Why the student's option did not satisfy that task (1-3 sentences, or null if no question context)",
  "whatToLookFor": "A transferable cue for reading similar UPSC questions (1-2 sentences)",
  "verification": {
    "question": "A NEW MCQ testing whether the student can identify what a question is asking",
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
export interface QuestionInterpretationInput {
  request: RepairRequest;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
  /** Latest Knowledge note for this concept — grounding only, never regenerated. */
  conceptNote?: RepairNoteGrounding | null;
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute a question interpretation repair.
 *
 * Flow: guard → prompt → AI call → validate → transform
 *
 * The guard fires before the AI call, ensuring we never burn tokens
 * on a request that was mis-routed to this executor.
 *
 * @param input - RepairRequest + concept metadata
 * @returns QuestionInterpretationRepair ready for student consumption
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeQuestionInterpretation(
  input: QuestionInterpretationInput,
): Promise<QuestionInterpretationRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords, conceptNote = null } = input;

  // ── Intent guard ──────────────────────────────────────
  // Fires before the AI call so we never waste tokens on a mis-routed request.
  if (request.repairIntent !== "question_interpretation") {
    throw new Error(
      `QuestionInterpretationExecutor only handles "question_interpretation" intent, ` +
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
    questionInterpretationResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Question interpretation AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

  // ── Transform validated data into the repair output ───
  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "misunderstood_question",
    repairIntent: "question_interpretation",
    questionContext: request.questionContext,
    breakdown: {
      whatItAsked: data.whatItAsked,
      decisiveWording: data.decisiveWording,
      whyYourAnswerMissed: data.whyYourAnswerMissed,
      whatToLookFor: data.whatToLookFor,
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
