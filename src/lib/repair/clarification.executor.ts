/**
 * R3.10 — Clarification Repair Executor
 *
 * Handles the "clarification" repair intent for failureReason = "not_sure".
 *
 * When a student reports "I'm not sure what went wrong", they cannot identify
 * their own failure mode. This executor respects that uncertainty absolutely:
 * it does NOT assume a specific gap, does NOT reteach a concept the student
 * may already know, and does NOT guess at the error. Instead, it surfaces
 * enough context for the student to begin to locate their own difficulty.
 *
 *   A. whatTheQuestionNeeded — the prerequisite knowledge or skill the question
 *      demands, stated neutrally without implying the student lacks it
 *   B. possibleStumblingPoints — 2–3 concrete places where someone might get
 *      stuck on this type of question, without diagnosing which one applies
 *   C. howToNarrowItDown — a self-diagnostic procedure the student can follow
 *      to determine what specifically blocked them
 *   D. nextTimeStrategy — a general approach strategy for similar questions
 *
 * This executor is unique in the R3 pipeline:
 *   - verificationRequired = false in the RepairRequest
 *   - No verification MCQ is generated — the student hasn't identified their
 *     failure mode yet, so we cannot verify remediation of an unknown gap
 *   - The output is exploratory, not corrective
 *
 * When question context exists, the clarification is anchored to the actual
 * failed question. Without context, it addresses common confusion points for
 * the concept without inventing a specific failure that didn't happen.
 *
 * Boundaries (enforced by tests, not just convention):
 *   - No concept reteaching — the student may already know it
 *   - No failure reason reinterpretation — not_sure stays not_sure
 *   - No diagnosis — we never claim the student "doesn't understand X"
 *   - No R2 diagnostic scoring, gap classification, or mastery mutation
 *   - No database access, no event logging, no side effects
 *   - No verification MCQ — cannot verify remediation of an unidentified gap
 *
 * @see RepairRequest in repair-request.builder.ts
 * @see error-awareness.executor.ts — structurally parallel executor (R3.9)
 */

import { z } from "zod";
import { formatNoteGrounding } from "./note-grounding";
import type { RepairNoteGrounding } from "./note-grounding";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * Surfaces the prerequisite context and helps the student self-diagnose.
 *
 * Each field maps to one of the executor's stated objectives:
 *   whatTheQuestionNeeded   → "What did this question require?"
 *   possibleStumblingPoints → "Where might I have gotten stuck?"
 *   howToNarrowItDown       → "How do I figure out what went wrong?"
 *   nextTimeStrategy        → "What should I try on similar questions?"
 */
export interface ClarificationBreakdown {
  /** The prerequisite knowledge or skill the question demanded, stated neutrally. */
  whatTheQuestionNeeded: string;
  /**
   * 2–3 concrete places where someone might get stuck on this type of
   * question. Presented as possibilities, not diagnoses.
   */
  possibleStumblingPoints: string[];
  /**
   * A self-diagnostic procedure the student can follow to determine
   * what specifically blocked them.
   *
   * null when no question context was available — we refuse to invent
   * a diagnostic procedure for a question we can't see.
   */
  howToNarrowItDown: string | null;
  /** A general approach strategy for similar questions in the future. */
  nextTimeStrategy: string;
}

/** Complete clarification repair output, ready for student consumption. */
export interface ClarificationRepair {
  requestId: string;
  conceptId: string;
  /** The student's original failure reason — preserved exactly, never reinterpreted. */
  failureReason: "not_sure";
  /** The repair intent — always "clarification" for this executor. */
  repairIntent: "clarification";
  questionContext: RepairQuestionContext | null;
  breakdown: ClarificationBreakdown;
  /**
   * Always null — clarification repairs do not include verification.
   * The student hasn't identified their failure mode yet, so there is
   * nothing to verify remediation of.
   */
  verification: null;
  status: "ready";
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

/**
 * Validates the raw AI JSON response before it becomes a ClarificationRepair.
 *
 * Constraints are calibrated for UPSC-prep content:
 *   - min(10) on required strings prevents hollow one-word answers
 *   - max limits prevent runaway generation
 *   - possibleStumblingPoints enforces 2–3 entries to ensure the student
 *     gets multiple angles without being overwhelmed
 *   - howToNarrowItDown uses .catch(null) so non-string values degrade
 *     gracefully to null rather than crashing the repair pipeline
 */
export const clarificationResponseSchema = z.object({
  whatTheQuestionNeeded: z.string().min(10).max(800).trim(),
  possibleStumblingPoints: z
    .array(z.string().min(10).max(500).trim())
    .min(2)
    .max(3),
  howToNarrowItDown: z.string().max(800).trim().nullable().catch(null),
  nextTimeStrategy: z.string().min(10).max(800).trim(),
});

type ValidatedResponse = z.infer<typeof clarificationResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

/**
 * System prompt for the clarification AI call.
 *
 * Organised into three sections for AI comprehension:
 *   1. Role & context — what the AI is and what happened
 *   2. Content rules — what each output field should contain, with
 *      concrete good/bad examples to anchor generation quality
 *   3. Boundaries — hard prohibitions that prevent mode collapse
 *      into concept reteaching or unsolicited diagnosis
 *
 * The EXPLORATORY framing is the critical lever: every rule steers
 * the AI away from assuming what went wrong and toward helping the
 * student discover it themselves.
 */
const SYSTEM_PROMPT = `
You are a UPSC study coach helping a student who is unsure what went wrong.

The student answered a practice MCQ incorrectly and self-reported:
"I'm not sure what went wrong." They cannot identify their own failure mode —
they may lack the concept, may have misread the question, may have been
confused between options, or something else entirely.

RESPONSE FORMAT:
1. Respond ONLY with valid JSON. No markdown, no prose, no code fences.

CONTENT RULES:
2. "whatTheQuestionNeeded" — State the prerequisite knowledge or skill the
   question required, neutrally. Bad: "You don't understand federalism."
   Good: "This question required distinguishing between federal and unitary
   features of the Indian Constitution."
3. "possibleStumblingPoints" — Provide exactly 2 or 3 concrete, distinct
   places where someone might get stuck. Present them as possibilities,
   NOT diagnoses. Bad: ["You forgot the answer."]
   Good: ["The question uses 'NOT', which inverts what you're looking for.",
   "Options A and C are similar enough to cause confusion if the distinction
   between quasi-federal and purely federal isn't clear."]
4. "howToNarrowItDown" — A self-diagnostic procedure: a series of questions
   or steps the student can walk through to pinpoint what specifically
   blocked them. Bad: "Think harder."
   Good: "Ask yourself: (1) Can I state the core idea of this concept in
   one sentence? If not, it may be a knowledge gap. (2) Did I read every
   word of the stem including qualifiers? If not, it may be a reading
   issue. (3) Could I eliminate at least two options? If not, it may be
   an uncertainty issue."
   Set to null ONLY when no question context is provided.
5. "nextTimeStrategy" — A general approach for similar questions in the
   future. This should be actionable and non-diagnostic.

BOUNDARIES:
6. Do NOT diagnose the student. Never claim they "don't understand",
   "have forgotten", or have any specific gap. You do not know what
   went wrong — that is the entire point.
7. Do NOT reteach the concept. The student may already know it.
8. Do NOT generate a verification question. Clarification repairs have
   no verification.
9. Present stumbling points as POSSIBILITIES, not conclusions.
10. Do NOT fabricate constitutional articles, committee names, schemes, or facts.
11. Maintain UPSC-level factual accuracy throughout.
`;

/**
 * Builds the user-facing prompt with concept metadata and question context.
 *
 * Two modes:
 *   - With question context → anchored to the specific failed question, with
 *     the student's selection and the correct answer shown explicitly
 *   - Without question context → addresses common confusion points for
 *     the concept, with an explicit prohibition against inventing specifics
 */
function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
  conceptNote: RepairNoteGrounding | null = null,
): string {
  let prompt = `
CLARIFICATION TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}
${formatNoteGrounding(conceptNote)}
The student answered a practice MCQ about this concept incorrectly and reported:
"I'm not sure what went wrong."
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
- State what prerequisite knowledge or skill the question required
- Identify 2-3 concrete possible stumbling points (present as possibilities)
- Provide a self-diagnostic procedure to help the student pinpoint their difficulty
- Suggest a general approach strategy for similar questions
`;
  } else {
    prompt += `
No specific question context is available. Do NOT invent details about what
the student selected or what the question asked. Address the most common
confusion points for this concept and set howToNarrowItDown to null.
`;
  }

  prompt += `
Generate a targeted clarification intervention. Be precise and concise.
Do NOT include a verification question — clarification repairs have no verification.

Respond in this EXACT JSON format:

{
  "whatTheQuestionNeeded": "The prerequisite knowledge or skill this question required (1-3 sentences)",
  "possibleStumblingPoints": [
    "First concrete place where someone might get stuck (1-2 sentences)",
    "Second concrete place where someone might get stuck (1-2 sentences)"
  ],
  "howToNarrowItDown": "A self-diagnostic procedure to pinpoint the difficulty (2-4 sentences, or null if no question context)",
  "nextTimeStrategy": "A general approach strategy for similar questions (1-2 sentences)"
}
`;

  return prompt;
}

// ─── Executor Input ─────────────────────────────────────────

/** Mirrors the sibling executors' input shape so the API route treats all alike. */
export interface ClarificationInput {
  request: RepairRequest;
  conceptName: string;
  conceptSubject: string;
  conceptKeywords: string[];
  /** Latest Knowledge note for this concept — grounding only, never regenerated. */
  conceptNote?: RepairNoteGrounding | null;
}

// ─── Executor ───────────────────────────────────────────────

/**
 * Execute a clarification repair.
 *
 * Flow: guard → prompt → AI call → validate → transform
 *
 * The guard fires before the AI call, ensuring we never burn tokens
 * on a request that was mis-routed to this executor.
 *
 * Unlike all other executors, this one does NOT produce a verification
 * MCQ — the student hasn't identified their failure mode yet.
 *
 * @param input - RepairRequest + concept metadata
 * @returns ClarificationRepair ready for the student
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeClarification(
  input: ClarificationInput,
): Promise<ClarificationRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords, conceptNote = null } = input;

  // ── Intent guard ──────────────────────────────────────
  // Fires before the AI call so we never waste tokens on a mis-routed request.
  if (request.repairIntent !== "clarification") {
    throw new Error(
      `ClarificationExecutor only handles "clarification" intent, ` +
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
    maxTokens: 1200,
    format: "json",
  });

  // ── Validate AI response against schema ───────────────
  const validation = validateAIResponse(
    aiResponse.content,
    clarificationResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Clarification AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedResponse = validation.data;

  // ── Transform validated data into the repair output ───
  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "not_sure",
    repairIntent: "clarification",
    questionContext: request.questionContext,
    breakdown: {
      whatTheQuestionNeeded: data.whatTheQuestionNeeded,
      possibleStumblingPoints: data.possibleStumblingPoints,
      howToNarrowItDown: data.howToNarrowItDown,
      nextTimeStrategy: data.nextTimeStrategy,
    },
    verification: null,
    status: "ready",
    generatedAt: new Date(),
  };
}
