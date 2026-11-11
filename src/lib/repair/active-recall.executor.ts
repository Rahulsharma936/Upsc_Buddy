/**
 * R3.5 — Active Recall Repair Executor
 *
 * Executes the "active_recall" repair intent.
 * Consumes a RepairRequest (from R3.1) where failureReason = "could_not_recall".
 *
 * The student said "I knew it, but couldn't recall it." That is a RETRIEVAL
 * report, not a comprehension one, so this executor does NOT reteach the
 * concept. It makes the student pull the answer from memory first:
 *
 *   A. Retrieval prompt — a targeted cue the student answers from memory
 *   B. Cue — an optional nudge that aids retrieval without giving it away
 *   C. Expected answer — revealed only AFTER the attempt
 *   D. Feedback — a concise note so the student can compare their recall
 *   E. Verification — the SAME R3.3 MCQ mechanism concept_teaching uses
 *
 * Uses the failed question context to make the cue specific, so the prompt is
 * about the thing the student actually blanked on rather than a generic
 * "what do you remember about this topic?".
 *
 * Does NOT:
 *   - Re-diagnose the student, or treat could_not_recall as a concept gap
 *   - Use R2 diagnostic scoring
 *   - Modify SM-2 or mastery
 *   - Mark the student as "resolved"
 *   - Create database records
 *   - Introduce a second verification mechanism — R3.3 handles verification
 *     for this intent exactly as it does for concept_teaching
 *
 * @see RepairRequest in repair-request.builder.ts
 * @see concept-teaching.executor.ts — the sibling executor this mirrors
 */

import { z } from "zod";
import { formatRepairGuidance } from "./note-grounding";
import type { RepairNoteGrounding } from "./note-grounding";
import { executeWithRetry } from "@/lib/ai/client";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import type { RepairRequest, RepairQuestionContext } from "./repair-request.builder";

// ─── Output Types ───────────────────────────────────────────

/**
 * The retrieval attempt shown BEFORE anything is revealed.
 * This is the part that makes the repair active rather than a re-read.
 */
export interface ActiveRecallRetrieval {
  /**
   * A short, targeted prompt the student answers from memory.
   * Aimed at the specific fact/relationship they blanked on.
   */
  prompt: string;
  /**
   * An optional one-line cue that narrows the search without answering it.
   * null when the prompt is already specific enough.
   */
  cue: string | null;
}

/**
 * What the student sees AFTER attempting retrieval.
 * Deliberately short — this is a memory correction, not a lesson.
 */
export interface ActiveRecallReveal {
  /** The answer/key idea the student was trying to retrieve. */
  expectedAnswer: string;
  /**
   * A concise note letting the student compare their recall with the
   * correct one — including a brief clarification only where the failed
   * question genuinely needs it.
   */
  feedback: string;
}

/**
 * Verification MCQ testing whether the student can now retrieve the idea.
 *
 * Structurally identical to the concept_teaching verification on purpose:
 * both flow through the same R3.3 `/api/repair/verify` endpoint and the same
 * PracticeCard UI. Declared locally so each executor stays self-contained.
 */
export interface ActiveRecallVerification {
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
 * Complete active recall repair output.
 * This is what R3.5 produces. R3.3 (verification) consumes `verification`.
 */
export interface ActiveRecallRepair {
  /** Links back to the originating RepairRequest. */
  requestId: string;
  /** The concept being repaired. */
  conceptId: string;
  /** The student's original failure reason — preserved, never reinterpreted. */
  failureReason: "could_not_recall";
  /** The repair intent — always "active_recall" for this executor. */
  repairIntent: "active_recall";
  /** The failed question context — preserved for downstream. */
  questionContext: RepairQuestionContext | null;
  /** The retrieval attempt, shown first. */
  retrieval: ActiveRecallRetrieval;
  /** The reveal, shown only after the student has tried. */
  reveal: ActiveRecallReveal;
  /** The verification MCQ. */
  verification: ActiveRecallVerification;
  /** Status of the repair. */
  status: "ready";
  /** When the repair was generated. */
  generatedAt: Date;
}

// ─── Zod Schema for AI Response Validation ──────────────────

/**
 * Bounds are tighter than the teaching executor's on purpose: a retrieval cue
 * that runs long has become an explanation, which is the failure mode this
 * repair exists to avoid.
 */
export const activeRecallResponseSchema = z.object({
  retrievalPrompt: z.string().min(10).max(600).trim(),
  cue: z.string().max(300).trim().nullable().catch(null),
  expectedAnswer: z.string().min(5).max(800).trim(),
  feedback: z.string().min(5).max(1000).trim(),
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

type ValidatedActiveRecallResponse = z.infer<typeof activeRecallResponseSchema>;

// ─── Prompt Construction ────────────────────────────────────

const SYSTEM_PROMPT = `
You are a focused UPSC retrieval coach.

The student KNEW this material but could not pull it from memory during a practice MCQ.
This is a RETRIEVAL failure, not a comprehension failure.

STRICT RULES:
1. Respond ONLY with valid JSON.
2. No markdown.
3. No conversational text.
4. Do NOT reteach the concept from scratch. The student already understands it.
5. The retrieval prompt must make the student RECALL something specific — never "what do you remember about X?".
6. The retrieval prompt must be answerable from memory in one or two sentences.
7. The cue must narrow the search WITHOUT containing the answer. Use null if the prompt is already specific.
8. Keep expectedAnswer and feedback SHORT. Clarify only what the failed question actually requires.
9. The verification question MUST test retrieval of the SAME idea from a DIFFERENT angle — never repeat the original question.
10. All distractors in the verification must be plausible.
11. Do NOT invent constitutional articles, committee names, schemes, or facts.
12. Be precise and accurate — UPSC-level correctness is required.
`;

function buildUserPrompt(
  conceptName: string,
  subject: string,
  keywords: string[],
  questionContext: RepairQuestionContext | null,
  conceptNote: RepairNoteGrounding | null = null,
): string {
  let prompt = `
RETRIEVAL TARGET
Concept: ${conceptName}
Subject: ${subject}
Keywords: ${keywords.join(", ") || "none"}
${formatRepairGuidance(conceptNote)}
The student answered a practice MCQ about this concept incorrectly and reported:
"I knew it, but couldn't recall it."
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
- Target the retrieval prompt at the SPECIFIC fact or relationship the student blanked on
- Keep the cue tied to that same point
- Clarify the distinction in feedback ONLY if the failed question genuinely requires it
`;
  } else {
    prompt += `
No specific question context is available. Target the retrieval prompt at the most
exam-relevant fact or relationship within this concept.
`;
  }

  prompt += `
Generate a retrieval exercise. Make the student recall BEFORE anything is revealed. Keep it SHORT.

Respond in this EXACT JSON format:

{
  "retrievalPrompt": "A specific question the student answers from memory (1 sentence)",
  "cue": "A short nudge that narrows the search without giving the answer (or null)",
  "expectedAnswer": "The fact or idea the student was trying to retrieve (1-3 sentences)",
  "feedback": "A concise note so the student can compare their recall with the correct one (1-3 sentences)",
  "verification": {
    "question": "A NEW MCQ testing retrieval of the SAME idea from a DIFFERENT angle",
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
 * Input to the active recall executor.
 * Combines the RepairRequest with concept metadata from the database.
 * Mirrors ConceptTeachingInput so the API route treats both alike.
 */
export interface ActiveRecallInput {
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
 * Execute an active recall repair.
 *
 * Takes a RepairRequest + concept metadata and generates a retrieval exercise
 * using the existing AI infrastructure and the existing validation pipeline.
 *
 * @param input - RepairRequest + concept metadata
 * @returns ActiveRecallRepair ready for student consumption
 * @throws Error if the intent is wrong, the AI call fails, or validation fails
 */
export async function executeActiveRecall(
  input: ActiveRecallInput,
): Promise<ActiveRecallRepair> {
  const { request, conceptName, conceptSubject, conceptKeywords, conceptNote = null } = input;

  // Guard: only handle active_recall intent
  if (request.repairIntent !== "active_recall") {
    throw new Error(
      `ActiveRecallExecutor only handles "active_recall" intent, ` +
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
    maxTokens: 1200,
    format: "json",
  });

  // Validate response using existing pipeline (JSON repair + Zod)
  const validation = validateAIResponse(
    aiResponse.content,
    activeRecallResponseSchema,
  );

  if (!validation.success || !validation.data) {
    throw new Error(
      `Active recall AI response validation failed: ${validation.errors.join("; ")}`
    );
  }

  const data: ValidatedActiveRecallResponse = validation.data;

  // Build the repair output
  return {
    requestId: request.requestId,
    conceptId: request.conceptId,
    failureReason: "could_not_recall",
    repairIntent: "active_recall",
    questionContext: request.questionContext,
    retrieval: {
      prompt: data.retrievalPrompt,
      cue: data.cue,
    },
    reveal: {
      expectedAnswer: data.expectedAnswer,
      feedback: data.feedback,
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
