/**
 * Check-question selection — pure.
 *
 * After a repair, the check question must test the student, not their
 * short-term memory of the screen. Preference order:
 *   1. an audited question from the student's own bank on the SAME concept
 *   2. an audited question on a RELATED concept — linked in the concept graph,
 *      or sharing key terms with what the repair just discussed
 *   3. the executor's generated question (held to the verification standard)
 *
 * Every candidate is rejected if it is the question just missed, a
 * near-duplicate of the recall prompt or the missed question, or if its
 * answer is stated in the repair text.
 */

import { findVerificationLeak } from "./verification-leak";

export interface CheckMcq {
  questionId: string | null;
  question: string;
  options: { a: string; b: string; c: string; d: string };
  correctAnswer: "a" | "b" | "c" | "d";
  explanation: string;
}

export interface CheckSource {
  kind: "bank" | "related" | "generated";
  conceptName?: string;
}

export interface CheckCandidate {
  mcq: CheckMcq;
  source: CheckSource;
  /** Whether the student has already attempted this exact question. */
  seen: boolean;
}

// ─── Text similarity ────────────────────────────────────────

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "which", "what", "following", "statements",
  "statement", "consider", "correct", "incorrect", "above", "given", "how", "many", "one", "two", "three",
  "all", "none", "only", "are", "was", "were", "has", "have", "its", "into", "under", "about", "their",
  "india", "indian", "respect", "regarding", "these", "those", "not", "both", "neither", "nor",
]);

export function contentTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Jaccard similarity of content words. */
export function similarity(a: string, b: string): number {
  const A = contentTokens(a);
  const B = contentTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export const NEAR_DUPLICATE_THRESHOLD = 0.5;

export function isNearDuplicate(a: string, b: string): boolean {
  return similarity(a, b) >= NEAR_DUPLICATE_THRESHOLD;
}

// ─── Problems with a candidate ──────────────────────────────

export interface CheckContext {
  /** Everything the repair showed before the check question. */
  shownText: string;
  /** Questions the check must not repeat: the recall prompt, the missed question. */
  avoidQuestions: string[];
  /** The missed question's identity. */
  missedQuestionId?: string | null;
  missedQuestionText?: string | null;
}

export function checkProblem(mcq: Pick<CheckMcq, "question" | "options" | "correctAnswer" | "questionId">, ctx: CheckContext): string | null {
  if (ctx.missedQuestionId && mcq.questionId && mcq.questionId === ctx.missedQuestionId) return "is the question just missed";
  if (ctx.missedQuestionText && mcq.question.trim() === ctx.missedQuestionText.trim()) return "is the question just missed";
  for (const q of ctx.avoidQuestions) {
    if (q && isNearDuplicate(mcq.question, q)) return "repeats the recall prompt or the missed question";
  }
  const leak = findVerificationLeak(ctx.shownText, mcq);
  if (leak) return `answer "${leak}" is stated in the repair`;
  return null;
}

// ─── Related concepts by shared terms ───────────────────────

export interface ConceptLite {
  id: string;
  displayName: string;
  keywords: string[];
}

/**
 * Rank concepts by how many of their name/keyword terms appear in the repair
 * text — e.g. a repair mentioning "Scheduled Castes" and "Ninth Schedule"
 * surfaces the student's concepts on reservation and on the Ninth Schedule.
 */
export function rankByTermOverlap(shownText: string, concepts: ConceptLite[], excludeId: string, limit = 3): ConceptLite[] {
  const shown = ` ${shownText.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return concepts
    .filter((c) => c.id !== excludeId)
    .map((c) => {
      const terms = [c.displayName, ...c.keywords]
        .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
        .filter((t) => t.length >= 4 && !STOP.has(t));
      const hits = new Set(terms.filter((t) => shown.includes(` ${t} `))).size;
      return { c, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.c);
}

// ─── Choice ─────────────────────────────────────────────────

/**
 * Pick the check question. Bank questions on the same concept come first, then
 * related concepts; unseen before seen. Returns null when no bank candidate is
 * clean — the caller then uses the generated question.
 */
export function chooseCheckQuestion(candidates: CheckCandidate[], ctx: CheckContext): CheckCandidate | null {
  const rank = (c: CheckCandidate) => (c.source.kind === "bank" ? 0 : 1) * 2 + (c.seen ? 1 : 0);
  const clean = candidates.filter((c) => checkProblem(c.mcq, ctx) === null);
  clean.sort((a, b) => rank(a) - rank(b));
  return clean[0] ?? null;
}
