/**
 * Page chat — ask questions about one newspaper page, from a UPSC angle (pure).
 *
 * Grounding, in order of authority:
 *   1. the page itself (only the passages relevant to the question, to fit the
 *      provider's per-minute token limit),
 *   2. the student's own notes on related topics,
 *   3. matching syllabus topics and verified past UPSC questions from the app's bank.
 * Anything the model adds from general knowledge goes in a separate, labelled
 * "beyond" field. References to notes, syllabus topics and past questions are
 * returned by index and checked against what was actually supplied, and any
 * "UPSC asked this in <year>" claim that is not backed by a supplied past
 * question is flagged.
 *
 * Nothing here is stored: the chat lives in the browser tab.
 */

import { z } from "zod";
import { isIsoDate, MAX_PAGE_CHARS, DEFAULT_NEWSPAPER, MAX_PAGE_IMAGE_CHARS } from "./newspaper";

export const PASSAGE_CHARS = 1_200;
/** Page text budget per question (~1.5k tokens). */
export const PAGE_CONTEXT_CHARS = 6_000;
export const MAX_QUESTION_CHARS = 1_000;
export const MAX_HISTORY_MESSAGES = 6;
const HISTORY_CHARS_EACH = 1_200;

// ─── Request / response contracts ───────────────────────────

export const chatRequestSchema = z.object({
  newspaper: z.string().trim().min(2).max(80).default(DEFAULT_NEWSPAPER),
  editionDate: z.string().refine(isIsoDate, "editionDate must be YYYY-MM-DD"),
  pageNumber: z.number().int().min(1).max(200),
  text: z.string().max(MAX_PAGE_CHARS * 2).default(""),
  image: z
    .string()
    .max(MAX_PAGE_IMAGE_CHARS)
    .refine((s) => /^data:image\/(png|jpeg|webp);base64,/.test(s), "image must be a PNG, JPEG or WebP data URL")
    .optional(),
  question: z.string().trim().min(2).max(MAX_QUESTION_CHARS),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8_000) }))
    .max(20)
    .default([]),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatModelSchema = z.object({
  answer: z.string().trim().min(1).max(6_000),
  beyond: z.string().trim().max(3_000).catch(""),
  notesUsed: z.array(z.number().int()).max(10).catch([]),
  syllabusUsed: z.array(z.number().int()).max(10).catch([]),
  pastQuestionsUsed: z.array(z.number().int()).max(10).catch([]),
  outOfScope: z.boolean().catch(false),
});

export type ChatModelOutput = z.infer<typeof chatModelSchema>;

// ─── Retrieval ──────────────────────────────────────────────

const CHAT_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "these", "those", "which", "what", "when", "where", "who", "whom",
  "why", "how", "are", "was", "were", "has", "have", "had", "its", "into", "about", "their", "there", "them", "they",
  "not", "can", "could", "would", "should", "will", "shall", "may", "might", "does", "did", "done", "doing", "been",
  "being", "than", "then", "also", "any", "all", "some", "more", "most", "such", "only", "very", "much", "many",
  "page", "article", "articles", "news", "paper", "newspaper", "story", "stories", "today", "explain", "tell", "give",
  "please", "mean", "means", "meaning", "upsc", "exam", "prelims", "mains", "question", "questions", "answer", "important",
  "relevant", "relevance", "matter", "matters", "point", "points", "summary", "summarise", "summarize", "about",
  "said", "says", "say", "one", "two", "three", "new", "india", "indian", "notes", "note", "connect", "connects",
  "link", "linked", "links", "between", "other", "like", "just", "make", "made", "use", "used", "our", "your", "you",
]);

/** Content terms for retrieval: ≥3 chars (keeps RBI, MPC, GST), stop words removed, plural folding. */
export function retrievalTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (raw.length < 3 || CHAT_STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.push(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

export interface Passage {
  index: number;
  text: string;
}

/** Split a page into passages of about PASSAGE_CHARS, at paragraph then line boundaries. */
export function splitPassages(text: string, size: number = PASSAGE_CHARS): Passage[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const para of text.slice(0, MAX_PAGE_CHARS).split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length > size) {
      flush();
      let cur = "";
      for (const line of p.split(/\n|(?<=[.!?])\s+/)) {
        if ((cur + " " + line).length > size && cur) {
          out.push(cur.trim());
          cur = "";
        }
        cur += (cur ? " " : "") + line;
      }
      if (cur.trim()) out.push(cur.trim());
      continue;
    }
    if ((buf + "\n\n" + p).length > size) flush();
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return out.map((t, index) => ({ index, text: t }));
}

/**
 * Choose the passages that best answer the query within a character budget,
 * returned in page order. The whole page is used when it fits. A query with
 * no matching terms ("what matters on this page?") gets the page from the top.
 */
export function selectPassages(passages: Passage[], query: string, budget: number = PAGE_CONTEXT_CHARS): { passages: Passage[]; partial: boolean } {
  const total = passages.reduce((n, p) => n + p.text.length, 0);
  if (total <= budget) return { passages, partial: false };

  const q = [...new Set(retrievalTerms(query))];
  const termSets = passages.map((p) => new Set(retrievalTerms(p.text)));
  const df = new Map(q.map((t) => [t, termSets.filter((s) => s.has(t)).length]));
  const scored = passages.map((p, i) => ({
    p,
    score: q.reduce((s, t) => (termSets[i].has(t) ? s + Math.log(1 + passages.length / (df.get(t) || 1)) : s), 0),
  }));

  const order = scored.some((s) => s.score > 0)
    ? [...scored].sort((a, b) => b.score - a.score || a.p.index - b.p.index)
    : scored;
  const chosen: Passage[] = [];
  let used = 0;
  for (const { p, score } of order) {
    if (scored.some((s) => s.score > 0) && score === 0) break;
    if (used + p.text.length > budget) continue;
    chosen.push(p);
    used += p.text.length;
  }
  return { passages: chosen.sort((a, b) => a.index - b.index), partial: true };
}

/**
 * Rank items by shared retrieval terms with a text. An item needs `minHits`
 * shared terms (or all of its terms, if it has fewer), so one common word is
 * not enough to pull in an unrelated note.
 */
export function rankByTerms<T>(items: T[], text: string, terms: (item: T) => string, limit: number, minHits = 1): T[] {
  const pool = new Set(retrievalTerms(text));
  return items
    .map((item) => {
      const own = new Set(retrievalTerms(terms(item)));
      let hits = 0;
      for (const t of own) if (pool.has(t)) hits++;
      return { item, hits, need: Math.max(1, Math.min(minHits, own.size)), density: own.size ? hits / own.size : 0 };
    })
    .filter((x) => x.hits >= x.need)
    .sort((a, b) => b.hits - a.hits || b.density - a.density)
    .slice(0, limit)
    .map((x) => x.item);
}

/** Recent conversation, newest last, each message trimmed. */
export function trimHistory(history: ChatRequest["history"]): ChatRequest["history"] {
  return history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content.length > HISTORY_CHARS_EACH ? `${m.content.slice(0, HISTORY_CHARS_EACH)}…` : m.content,
  }));
}

/** The text used to retrieve passages: this question plus the previous one (for follow-ups like "why?"). */
export function retrievalQuery(question: string, history: ChatRequest["history"]): string {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  return lastUser ? `${question}\n${lastUser.content}` : question;
}

// ─── Prompt ─────────────────────────────────────────────────

export interface ChatNote {
  name: string;
  coreIdea: string;
  facts: string[];
}
export interface ChatSyllabusTopic {
  paper: string;
  domain: string;
  topic: string;
}
export interface ChatPastQuestion {
  year: number;
  stage: string;
  paper: string;
  question: string;
}

export const CHAT_SYSTEM_PROMPT = `You are a senior UPSC Civil Services mentor helping an aspirant study one page of today's newspaper.
Rules:
- Answer from the PAGE first. Put in "answer" only what the page says, or what the student's NOTES say (say "your note on X" when you use one).
- If useful background is not on the page or in the notes (static concepts, constitutional articles, history of an issue), put it in "beyond", never in "answer". Keep it accurate and standard; if you are unsure of a fact, leave it out.
- If the page does not cover what is asked, say so plainly in "answer" and give what you can in "beyond".
- Editorials and op-eds are opinion: report them as "the author argues", not as fact.
- Past UPSC questions: refer only to the PAST QUESTIONS listed, by their index, with their year exactly as given. Never claim that UPSC asked something in any other year or paper.
- Syllabus: map to GS papers using the SYLLABUS TOPICS listed where they fit.
- Be exam-focused and concise: short paragraphs or "- " bullet lines, no tables, no markdown headings, no emojis.
- If the question has nothing to do with this page or UPSC preparation, set "outOfScope": true and reply in one sentence that you answer questions about this page for UPSC preparation.
Respond ONLY with valid JSON:
{"answer":"...","beyond":"","notesUsed":[0],"syllabusUsed":[0],"pastQuestionsUsed":[],"outOfScope":false}`;

export function buildChatPrompt(params: {
  newspaper: string;
  editionDate: string;
  pageNumber: number;
  passages: Passage[];
  partial: boolean;
  notes: ChatNote[];
  syllabus: ChatSyllabusTopic[];
  pastQuestions: ChatPastQuestion[];
  history: ChatRequest["history"];
  question: string;
}): string {
  const parts: string[] = [];
  parts.push(
    `PAGE: ${params.newspaper}, edition ${params.editionDate}, page ${params.pageNumber}${params.partial ? " (only the passages most relevant to the question are shown)" : ""}`,
    `"""\n${params.passages.map((p) => p.text).join("\n\n[...]\n\n")}\n"""`,
  );
  parts.push(
    params.notes.length
      ? `STUDENT'S NOTES (index: name: summary; key points):\n${params.notes
          .map((n, i) => `${i}: ${n.name}: ${n.coreIdea}${n.facts.length ? `; ${n.facts.join("; ")}` : ""}`)
          .join("\n")}`
      : "STUDENT'S NOTES: none related.",
  );
  parts.push(
    params.syllabus.length
      ? `SYLLABUS TOPICS (index: paper > area > topic):\n${params.syllabus.map((s, i) => `${i}: ${s.paper} > ${s.domain} > ${s.topic}`).join("\n")}`
      : "SYLLABUS TOPICS: none matched.",
  );
  parts.push(
    params.pastQuestions.length
      ? `PAST QUESTIONS (verified; index: year, stage, paper: question):\n${params.pastQuestions
          .map((q, i) => `${i}: ${q.year}, ${q.stage}, ${q.paper}: ${q.question}`)
          .join("\n")}`
      : "PAST QUESTIONS: none matched. Do not mention any past-year UPSC question.",
  );
  if (params.history.length) {
    parts.push(`CONVERSATION SO FAR:\n${params.history.map((m) => `${m.role === "user" ? "Student" : "Mentor"}: ${m.content}`).join("\n")}`);
  }
  parts.push(`STUDENT'S QUESTION: ${params.question}`);
  return parts.join("\n\n");
}

// ─── Checks on the reply ────────────────────────────────────

/**
 * Put bullet points the model ran into one line ("it highlights: - a; - b")
 * on their own lines. Only a dash with spaces on both sides that follows ":",
 * ";" or "." counts, so ranges and hyphenated words are untouched.
 */
export function tidyBullets(text: string): string {
  return text.replace(/([:;.])[ \t]+-[ \t]+(?=\S)/g, "$1\n- ");
}

/** Indices that point at supplied items, in order, without duplicates. */
export function validIndices(indices: number[], length: number): number[] {
  return [...new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < length))];
}

const EXAM_WORD = /\b(?:upsc|cse|prelims?|mains|pyqs?|gs\s?[1-4])\b/i;
const ASKED_CUE = /\b(?:asked|appeared|came up|pyqs?|previous[- ]years?|past[- ](?:year|paper|question)s?|question(?:s|ed)?\s+(?:in|from))\b|\b(?:upsc|prelims?|mains|cse)\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s+(?:upsc|prelims?|mains|cse)\b/i;

/**
 * Years cited as UPSC past papers that are not among the supplied past
 * questions' years. A sentence counts as a past-paper claim only if it names
 * the exam AND speaks of a question being asked ("asked in 2019", "UPSC 2021",
 * "a 2018 Prelims question"), so "relevant for Prelims; the 2011 Census" is not one.
 */
export function unverifiedPyqYears(text: string, allowedYears: number[]): number[] {
  const allowed = new Set(allowedYears);
  const found = new Set<number>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!EXAM_WORD.test(sentence) || !ASKED_CUE.test(sentence)) continue;
    for (const m of sentence.matchAll(/\b((?:19|20)\d{2})\b/g)) {
      const y = Number(m[1]);
      if (!allowed.has(y)) found.add(y);
    }
  }
  return [...found].sort();
}
