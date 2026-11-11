/**
 * Written-answer evaluation — contract, prompts and scoring (pure).
 *
 * A student writes an answer — typed, or on paper and photographed — and it is
 * marked against the reference the app already holds (a repair's model answer,
 * a Mains question's marking points, the student's own note). Photos are first
 * transcribed by a vision model; marking is done by the main text model.
 *
 * No I/O here: the service performs the calls, this module builds prompts,
 * validates inputs and outputs, and maps marks onto SM-2 quality.
 */

import { z } from "zod";

// ─── Limits ─────────────────────────────────────────────────

export const MAX_IMAGES = 3;
/** Base64 data-URL length cap per image (Groq accepts ≤ 4 MB base64). */
export const MAX_IMAGE_DATA_URL_LENGTH = 4_000_000;
export const MAX_TYPED_LENGTH = 8_000;
export const MAX_REFERENCE_LENGTH = 4_000;
export const MIN_ANSWER_LENGTH = 5;
export const MAX_SCORE = 10;

export type AnswerMode = "recall" | "mains";
export type AnswerSource = "typed" | "photo" | "both";

const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

// ─── Request ────────────────────────────────────────────────

export const evaluateRequestSchema = z
  .object({
    conceptId: z.uuid(),
    mode: z.enum(["recall", "mains"]),
    question: z.string().trim().min(5).max(2_000),
    typedAnswer: z.string().max(MAX_TYPED_LENGTH).optional(),
    images: z
      .array(z.string().max(MAX_IMAGE_DATA_URL_LENGTH).regex(IMAGE_DATA_URL, "must be a PNG, JPEG or WebP data URL"))
      .max(MAX_IMAGES)
      .optional(),
    /** What a good answer contains: a model answer, or examiner marking points. */
    reference: z.union([z.string().max(MAX_REFERENCE_LENGTH), z.array(z.string().max(600)).max(12)]).optional(),
    marks: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export type EvaluateRequest = z.infer<typeof evaluateRequestSchema>;

// ─── Evaluation result ──────────────────────────────────────

export const VERDICTS = ["excellent", "good", "partial", "weak", "off_topic"] as const;

export const evaluationSchema = z.object({
  score: z.number().min(0).max(MAX_SCORE),
  verdict: z.enum(VERDICTS),
  covered: z.array(z.string().trim().min(1)).max(6).catch([]),
  missed: z.array(z.string().trim().min(1)).max(6).catch([]),
  inaccuracies: z.array(z.string().trim().min(1)).max(5).catch([]),
  structure: z.string().trim().nullable().optional().catch(null),
  improvement: z.string().trim().min(1).max(600),
});

export type AnswerEvaluation = z.infer<typeof evaluationSchema>;

export interface EvaluateResponse {
  answerText: string;
  transcription: string | null;
  source: AnswerSource;
  evaluation: AnswerEvaluation;
  /** SM-2 quality derived from the score. */
  quality: number;
}

// ─── Scoring ────────────────────────────────────────────────

/**
 * Marks out of 10 → SM-2 quality, on the scale the app already uses
 * (correct MCQ → 4, wrong → 1). 7+ → 4, 5+ → 3 (pass), 3+ → 2, else 1.
 * Quality 5 is never awarded: one written answer is not proof of mastery.
 */
export function scoreToQuality(score: number, max: number = MAX_SCORE): number {
  if (!Number.isFinite(score) || max <= 0) return 1;
  const s = (Math.max(0, Math.min(score, max)) / max) * 10;
  if (s >= 7) return 4;
  if (s >= 5) return 3;
  if (s >= 3) return 2;
  return 1;
}

/** Round to one decimal and clamp to [0, 10]. */
export function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.max(0, Math.min(MAX_SCORE, score)) * 10) / 10;
}

// ─── Transcription ──────────────────────────────────────────

export const TRANSCRIPTION_PROMPT = `Transcribe the handwritten answer in the image(s) exactly as written, in reading order.
- Preserve paragraphs, headings, bullet points and numbering.
- Do NOT correct spelling, grammar or facts. Do NOT summarise, translate or add anything.
- Write [illegible] for any word you cannot read.
- Ignore printed page furniture (ruled lines, margins, page numbers).
- If there is no handwritten or written answer in the image, reply exactly: NO_TEXT
Reply with the transcription only.`;

/** Strip model reasoning blocks and the NO_TEXT sentinel; trim. */
export function sanitizeTranscription(raw: string): string {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```[a-z]*\n?|\n?```$/gi, "")
    .trim();
  return /^no_text\.?$/i.test(text) ? "" : text;
}

/** Combine typed text and transcription into the text that gets marked. */
export function combineAnswer(typed: string | undefined, transcription: string | null): { text: string; source: AnswerSource } {
  const t = (typed ?? "").trim();
  const p = (transcription ?? "").trim();
  if (t && p) return { text: `${t}\n\n${p}`, source: "both" };
  if (p) return { text: p, source: "photo" };
  return { text: t, source: "typed" };
}

// ─── Marking prompt ─────────────────────────────────────────

export const EVALUATION_SYSTEM_PROMPT = `You are a strict, fair UPSC Civil Services examiner.
Mark the candidate's answer against what the QUESTION asks, using the reference and your own subject knowledge.
Rules:
- The candidate's study note is context only. Do NOT mark down an answer for omitting note items the question does not ask for.
- A correct, well-explained answer to what was asked deserves 6–7 even if it does not mirror the reference wording.
- Mark content, not length. Padding, repetition and generic statements earn nothing. A list of keywords is not an answer.
- Penalise factual errors; list each one in "inaccuracies".
- Calibrate like the real exam: 4/10 is an average answer, 6/10 is good, 8/10 is rare.
- An empty, irrelevant or copied-question answer scores 0 with verdict "off_topic".
- "covered" and "missed" must be specific points (a provision, case, fact, argument), not vague labels.
- "improvement" is one concrete instruction (max 40 words), addressed to the candidate.
- Respond ONLY with valid JSON. No markdown.`;

/**
 * The word target for an answer: a limit stated in the question ("(150 words)")
 * wins; otherwise Mains follows the marks (15 → 250, else 150) and recall is 100.
 */
export function wordTarget(mode: AnswerMode, question: string, marks?: number): number {
  const stated = question.match(/\((\d{2,4})\s*words?\)/i);
  if (stated) {
    const n = Number(stated[1]);
    if (n >= 20 && n <= 1000) return n;
  }
  if (mode === "mains") return marks && marks >= 15 ? 250 : 150;
  return 100;
}

export function referenceToText(reference: EvaluateRequest["reference"]): string {
  if (!reference) return "";
  if (Array.isArray(reference)) return reference.filter((r) => r.trim()).map((r) => `- ${r.trim()}`).join("\n");
  return reference.trim();
}

export function buildEvaluationPrompt(params: {
  mode: AnswerMode;
  question: string;
  answer: string;
  reference?: string;
  note?: { coreIdea?: string | null; examTriggers?: string[] | null; staticCurrentLink?: string[] | null } | null;
  marks?: number;
}): string {
  const { mode, question, answer, reference, note, marks } = params;
  const wordLimit = wordTarget(mode, question, marks);

  let prompt = `QUESTION (${mode === "mains" ? `Mains, ${marks ?? 10} marks, ~${wordLimit} words` : `short recall answer, ~${wordLimit} words`}):
${question}
`;
  if (reference) prompt += `
REFERENCE — what a good answer must contain:
${reference}
`;
  if (note?.coreIdea) {
    prompt += `
CANDIDATE'S OWN STUDY NOTE (context; the answer need not copy it):
${note.coreIdea}`;
    if (note.examTriggers?.length) prompt += `\nKey facts: ${note.examTriggers.slice(0, 6).join("; ")}`;
    if (note.staticCurrentLink?.length) prompt += `\nCurrent linkages: ${note.staticCurrentLink.slice(0, 3).join("; ")}`;
    prompt += "\n";
  }
  prompt += `
CANDIDATE'S ANSWER:
"""
${answer.slice(0, MAX_TYPED_LENGTH)}
"""
`;
  prompt += mode === "mains"
    ? `
Also judge structure: introduction, body organised by dimension, examples/data, balanced view, conclusion or way forward. Put one sentence on structure in "structure".`
    : `
This is a recall check: judge accuracy and completeness of the key points. Set "structure" to null.`;

  prompt += `

Respond in this exact JSON format:
{
  "score": 0-10 (one decimal allowed),
  "verdict": "excellent" | "good" | "partial" | "weak" | "off_topic",
  "covered": ["specific point the answer got right", "..."],
  "missed": ["specific point a good answer needed", "..."],
  "inaccuracies": ["factual error in the answer", "..."],
  "structure": ${mode === "mains" ? '"one sentence on structure"' : "null"},
  "improvement": "one concrete instruction"
}`;
  return prompt;
}
