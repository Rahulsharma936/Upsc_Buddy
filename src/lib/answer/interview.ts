/**
 * Interview (Personality Test) answers — contract, delivery metrics, rubric (pure).
 *
 * The student answers an interview prompt aloud. Audio → Whisper transcript
 * (with timing) → deterministic delivery metrics (pace, fillers, pauses,
 * length) → board-style evaluation of the content by the main model.
 *
 * No I/O here.
 */

import { z } from "zod";

// ─── Limits ─────────────────────────────────────────────────

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ~10 MB; a 3-minute opus clip is ~1–2 MB
export const MAX_RECORDING_SECONDS = 180;
export const ALLOWED_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"];

/** Base MIME type without codec parameters. */
export function baseMime(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export function isAllowedAudio(type: string): boolean {
  return ALLOWED_AUDIO_TYPES.includes(baseMime(type));
}

// ─── Transcription prompt ───────────────────────────────────

/**
 * Whisper drops disfluencies unless its prompt contains them. Seeding the
 * prompt with fillers keeps "um", "uh" in the transcript so delivery feedback
 * is honest; concept terms improve spelling of names and acronyms.
 */
export function whisperPrompt(conceptName: string, keywords: string[]): string {
  const terms = [conceptName, ...keywords].filter(Boolean).slice(0, 12).join(", ");
  return `Umm, so, uh, I think, you know, like, I mean... An interview answer about ${terms}.`.slice(0, 600);
}

// ─── Delivery metrics (deterministic) ───────────────────────

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface DeliveryMetrics {
  durationSeconds: number;
  words: number;
  wordsPerMinute: number;
  fillerCount: number;
  fillersPerMinute: number;
  topFillers: Array<{ filler: string; count: number }>;
  longPauses: number; // gaps ≥ 3 s between segments
  paceLabel: "too slow" | "measured" | "conversational" | "fast" | "too fast";
  lengthLabel: "too short" | "good length" | "long" | "too long";
}

const FILLERS = ["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "you know", "i mean", "basically", "actually", "sort of", "kind of", "like"];
const LONG_PAUSE_SECONDS = 3;

function countPhrase(text: string, phrase: string): number {
  const re = new RegExp(`(?<![a-z])${phrase.replace(/ /g, "\\s+")}(?![a-z])`, "gi");
  return (text.match(re) ?? []).length;
}

/**
 * "like" is only a filler when used as one; count it when surrounded by
 * commas/pauses or in "like, " constructions, not as a verb ("I like").
 */
function countFillerLike(text: string): number {
  return (text.match(/(?:^|[,.…]\s*|\s)like(?=\s*[,.…])/gi) ?? []).length;
}

export function computeDelivery(transcript: string, durationSeconds: number, segments: TranscriptSegment[] = []): DeliveryMetrics {
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const minutes = Math.max(durationSeconds, 1) / 60;

  const counts = FILLERS.map((f) => ({ filler: f, count: f === "like" ? countFillerLike(transcript) : countPhrase(transcript, f) }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const fillerCount = counts.reduce((a, c) => a + c.count, 0);

  let longPauses = 0;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start - sorted[i - 1].end >= LONG_PAUSE_SECONDS) longPauses++;
  }

  const wpm = Math.round(words / minutes);
  const paceLabel: DeliveryMetrics["paceLabel"] =
    wpm < 90 ? "too slow" : wpm < 120 ? "measured" : wpm <= 165 ? "conversational" : wpm <= 190 ? "fast" : "too fast";
  const lengthLabel: DeliveryMetrics["lengthLabel"] =
    durationSeconds < 30 ? "too short" : durationSeconds <= 120 ? "good length" : durationSeconds <= 150 ? "long" : "too long";

  return {
    durationSeconds: Math.round(durationSeconds),
    words,
    wordsPerMinute: wpm,
    fillerCount,
    fillersPerMinute: Math.round((fillerCount / minutes) * 10) / 10,
    topFillers: counts.slice(0, 3),
    longPauses,
    paceLabel,
    lengthLabel,
  };
}

// ─── Board-style evaluation ─────────────────────────────────

export const DIMENSION_RATINGS = ["strong", "adequate", "weak", "missing"] as const;

export const interviewEvaluationSchema = z.object({
  score: z.number().min(0).max(10),
  verdict: z.enum(["excellent", "good", "partial", "weak", "off_topic"]),
  dimensions: z
    .array(z.object({ name: z.string().trim().min(1), rating: z.enum(DIMENSION_RATINGS).catch("weak"), comment: z.string().trim().catch("") }))
    .max(8)
    .catch([]),
  strengths: z.array(z.string().trim().min(1)).max(4).catch([]),
  gaps: z.array(z.string().trim().min(1)).max(5).catch([]),
  inaccuracies: z.array(z.string().trim().min(1)).max(4).catch([]),
  balance: z.string().trim().catch(""),
  delivery: z.string().trim().catch(""),
  followUp: z.string().trim().catch(""),
  strongerAnswer: z.array(z.string().trim().min(1)).max(5).catch([]),
  improvement: z.string().trim().min(1).max(600),
});

export type InterviewEvaluation = z.infer<typeof interviewEvaluationSchema>;

export interface InterviewResponse {
  transcript: string;
  delivery: DeliveryMetrics;
  evaluation: InterviewEvaluation;
  /** SM-2 quality derived from the score (same scale as written answers). */
  quality: number;
}

export const INTERVIEW_SYSTEM_PROMPT = `You are a member of the UPSC Civil Services Personality Test board.
You judge a candidate's spoken answer from its transcript, as a board member would:
- Relevance: does it answer what was asked, directly, early?
- Depth and accuracy: specific facts, schemes, institutions, data, examples — no bluffing.
- Balance: considers more than one stakeholder or viewpoint; acknowledges trade-offs.
- Administrative orientation: practical, implementable steps; awareness of ground reality.
- Clarity and structure: a clear position, organised reasoning, a crisp close.
- Ethics and temperament: fairness, sensitivity, maturity.
Calibrate strictly: 5/10 is an average answer, 7/10 good, 9/10 rare. A rambling or evasive answer cannot score above 5.
Judge content, not grammar; the transcript is speech. Use the delivery metrics provided only for the "delivery" comment.
Respond ONLY with valid JSON. No markdown.`;

export function buildInterviewPrompt(params: {
  prompt: string;
  dimensions: string[];
  transcript: string;
  delivery: DeliveryMetrics;
  conceptName: string;
  note?: { coreIdea?: string | null; staticCurrentLink?: string[] | null } | null;
}): string {
  const { prompt, dimensions, transcript, delivery: d, conceptName, note } = params;
  let p = `INTERVIEW QUESTION (topic: ${conceptName}):
${prompt}
`;
  if (dimensions.length) p += `
DIMENSIONS THE BOARD EXPECTS: ${dimensions.join(" | ")}
`;
  if (note?.coreIdea) {
    p += `
CANDIDATE'S STUDY NOTE (context only; do not require its contents): ${note.coreIdea}`;
    if (note.staticCurrentLink?.length) p += ` | Current linkages: ${note.staticCurrentLink.slice(0, 3).join("; ")}`;
    p += "\n";
  }
  p += `
DELIVERY METRICS (measured): ${d.durationSeconds}s, ${d.words} words, ${d.wordsPerMinute} words/min (${d.paceLabel}), ${d.fillerCount} fillers${d.topFillers.length ? ` (${d.topFillers.map((f) => `"${f.filler}" ×${f.count}`).join(", ")})` : ""}, ${d.longPauses} pauses ≥3s, length: ${d.lengthLabel}. Ideal: 60–120 s, 120–165 words/min, few fillers.

TRANSCRIPT OF THE CANDIDATE'S SPOKEN ANSWER:
"""
${transcript.slice(0, 6000)}
"""

Respond in this exact JSON format:
{
  "score": 0-10 (one decimal allowed),
  "verdict": "excellent" | "good" | "partial" | "weak" | "off_topic",
  "dimensions": [{"name": "<each expected dimension>", "rating": "strong" | "adequate" | "weak" | "missing", "comment": "one specific sentence"}],
  "strengths": ["specific strength", "..."],
  "gaps": ["specific point a strong candidate would have made", "..."],
  "inaccuracies": ["factual error", "..."],
  "balance": "one sentence on whether multiple viewpoints/stakeholders were weighed",
  "delivery": "one sentence on pace, fillers, length, using the measured metrics",
  "followUp": "the follow-up question a board member would most likely ask next",
  "strongerAnswer": ["3–4 bullet outline of how a strong candidate would structure this answer"],
  "improvement": "one concrete instruction for the next attempt"
}`;
  return p;
}

export function normalizeInterviewScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
}
