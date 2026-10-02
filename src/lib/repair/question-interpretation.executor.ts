/**
 * R3.6 — Question Interpretation Repair Executor
 *
 * Executes the "question_interpretation" repair intent.
 * Consumes a RepairRequest (from R3.1) where failureReason = "misunderstood_question".
 *
 * The student said "I misunderstood the question/options." The problem was
 * reading the TASK, not necessarily the underlying concept, so this executor
 * does not reteach the topic. It takes the failed question apart:
 *
 *   A. What it asked — the actual task, restated plainly
 *   B. Decisive wording — the qualifier, constraint or framing that mattered
 *   C. Why your answer missed — how the selection failed that specific task
 *   D. What to look for — a transferable cue for similar UPSC questions
 *   E. Verification — the SAME R3.3 MCQ mechanism the other executors use
 *
 * Anchored to the actual failed question. With no question context there is
 * no misread to explain, so the repair stays at the level of how questions of
 * this kind are framed rather than inventing a misreading that never happened.
 *
 * Does NOT:
 *   - Convert misunderstood_question into concept_not_understood
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
 * The breakdown of what the question was actually asking.
 * Four fields, each answering one of the repair's stated objectives.
 */
export interface QuestionInterpretationBreakdown {
  /** The task the question actually set, restated plainly. */
  whatItAsked: string;
  /** The specific wording, qualifier, constraint or framing that decided it. */
  decisiveWording: string;
  /**
   * Why the student's selection did not satisfy that task.
   * null when no question context was available to explain a misread.
   */
  whyYourAnswerMissed: string | null;
  /** A transferable cue for reading similar UPSC questions correctly. */
  whatToLookFor: string;
}

/**
 * Verification MCQ testing INTERPRETATION rather than recall of the original
 * answer. Structurally identical to the other executors' verification so it
 * flows through the same R3.3 endpoint and the same PracticeCard UI.
 */
export interface QuestionInterpretationVerification {
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

/** Complete question interpretation repair output. */
export interface QuestionInterpretationRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved, never reinterpreted. */
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

const SYSTEM_PROMPT = `
You are a focused UPSC question-reading coach.

The student misread what a practice MCQ was ASKING. This is an interpretation
failure, not necessarily a knowledge failure.

STRICT RULES:
1. Respond ONLY with valid JSON.
2. No markdown.
3. No conversational text.
4. This is NOT a concept lesson. Do not explain the topic from scratch.
5. Focus on the QUESTION: its task verb, qualifiers, negations, "except"/"not", scope limiters, and option framing.
6. Quote or name the exact wording that decided the answer.
7. Explain why the student's chosen option failed the TASK, not why the topic is important.
8. "whatToLookFor" must be a transferable reading cue, not a fact about this topic.
9. The verification question MUST test INTERPRETATION — whether the student can identify what a question is asking — not recall of the original answer.
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
INTERPRETATION TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}

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

/** Mirrors the sibling executors' input so the API route treats all alike. */
export interface QuestionInterpretationInput {
  request: RepairRequest;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute a question interpretation repair.
 *
 * @param input - RepairRequest + concept metadata
 * @returns QuestionInterpretationRepair ready for student consumption
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeQuestionInterpretation(
  input: QuestionInterpretationInput,
): Promise<QuestionInterpretationRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords } = input;

  // Guard: only handle question_interpretation intent
  if (request.repairIntent !== "question_interpretation") {
    throw new Error(
      `QuestionInterpretationExecutor only handles "question_interpretation" intent, ` +
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
    questionInterpretationResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Question interpretation AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

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
