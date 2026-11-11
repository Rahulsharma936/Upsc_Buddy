/**
 * Newspaper analysis — contract, text handling and prompts (pure).
 *
 * The PDF never leaves the student's browser: pages are rendered and their
 * text extracted client-side (pdf.js); only one page's text is sent when the
 * student asks for a summary. Only derived notes and questions are stored.
 *
 * A page is split into chunks that fit the provider's per-minute token limit,
 * each chunk is analysed for UPSC relevance, and only relevant articles are
 * turned into concepts with notes, questions and a revision schedule.
 */

import { z } from "zod";
import { UPSC_SUBJECTS } from "@/lib/ai/subjects";

export const NEWSPAPER_SOURCE = "newspaper";
export const DEFAULT_NEWSPAPER = "The Hindu";
/** ~2.2k tokens of page text per chunk keeps one request under an 8k-tokens/min limit with room for output. */
export const MAX_CHUNK_CHARS = 9_000;
export const MAX_PAGE_CHARS = 40_000;

// ─── Page text ──────────────────────────────────────────────

export { MIN_TEXT_LAYER_CHARS, assemblePageText, needsOcr, type PdfTextItem } from "./page-text";

/** Split page text into chunks ≤ maxChars at paragraph, then line, boundaries. */
export function chunkText(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const clean = text.slice(0, MAX_PAGE_CHARS).trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
  for (const para of clean.split(/\n{2,}/)) {
    const piece = para.trim();
    if (!piece) continue;
    if (piece.length > maxChars) {
      pushCurrent();
      let buf = "";
      for (const line of piece.split("\n")) {
        if ((buf + "\n" + line).length > maxChars && buf) { chunks.push(buf.trim()); buf = ""; }
        if (line.length > maxChars) {
          for (let i = 0; i < line.length; i += maxChars) chunks.push(line.slice(i, i + maxChars).trim());
        } else buf += (buf ? "\n" : "") + line;
      }
      if (buf.trim()) chunks.push(buf.trim());
      continue;
    }
    if ((current + "\n\n" + piece).length > maxChars) pushCurrent();
    current += (current ? "\n\n" : "") + piece;
  }
  pushCurrent();
  return chunks;
}

// ─── Analysis contract ──────────────────────────────────────

const mcqSchema = z.object({
  question: z.string().trim().min(20),
  options: z.object({ a: z.string().min(1), b: z.string().min(1), c: z.string().min(1), d: z.string().min(1) }),
  correctAnswer: z.enum(["a", "b", "c", "d"]),
  explanation: z.string().trim().min(10),
});

export const articleSchema = z.object({
  headline: z.string().trim().min(3).max(300),
  kind: z.enum(["news", "editorial", "opinion", "explainer", "other"]).catch("news"),
  relevance: z.enum(["high", "medium"]).catch("medium"),
  topic: z.string().trim().min(3).max(120),
  subject: z.enum(UPSC_SUBJECTS).catch("CurrentAffairs"),
  gsPapers: z.array(z.enum(["Prelims", "GS1", "GS2", "GS3", "GS4", "Essay"])).max(4).catch(["Prelims"]),
  summary: z.string().trim().min(20).max(1_200),
  whyItMatters: z.string().trim().min(10).max(600),
  keyFacts: z.array(z.string().trim().min(3)).max(6).catch([]),
  staticLinkage: z.array(z.string().trim().min(3)).max(5).catch([]),
  keywords: z.array(z.string().trim().min(2)).max(8).catch([]),
  /** Names copied from the student's studied topics that this article genuinely connects to. */
  relatedTopics: z.array(z.string().trim()).max(5).catch([]),
  /** Index into RECENT STORIES when this article is a new development of one of them. */
  continuesStory: z.number().int().nullable().catch(null),
  mainsAngle: z.string().trim().max(500).catch(""),
  prelimsMcqs: z.array(mcqSchema).max(2).catch([]),
  mainsQuestion: z
    .object({ question: z.string().trim().min(20), guidancePoints: z.array(z.string().trim()).max(6).catch([]), estimatedMarks: z.number().int().catch(10) })
    .nullable()
    .catch(null),
});

/** Keep the valid entries of a list; one malformed article must not discard the rest. */
function validEntries<T extends z.ZodTypeAny>(schema: T, max: number) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((x) => {
      const r = schema.safeParse(x);
      return r.success ? [r.data as z.infer<T>] : [];
    }).slice(0, max));
}

export const analysisSchema = z.object({
  articles: validEntries(articleSchema, 12),
  skipped: z.array(z.object({ headline: z.string().trim(), reason: z.string().trim().catch("") })).max(40).catch([]),
});

export type NewspaperArticle = z.infer<typeof articleSchema>;
export type NewspaperAnalysis = z.infer<typeof analysisSchema>;

// ─── Prompts ────────────────────────────────────────────────

export const NEWSPAPER_SYSTEM_PROMPT = `You are a senior UPSC Civil Services mentor reading today's newspaper for an aspirant.
Your job is to FILTER, not to summarise everything:
- Keep only articles with genuine UPSC value: governance, polity, constitution, judiciary, economy, policy, international relations, environment, science and technology, security, society, ethics, history/culture, geography, schemes, reports and indices.
- Skip sports results, crime and city news, celebrity, markets/stock tips, advertisements and obituaries, unless there is a clear policy angle. List skipped items briefly.
- Editorials and op-eds are OPINION: mark kind "editorial"/"opinion", summarise as "The author argues...", and use them for the Mains angle, never as Prelims facts.
- Facts must be accurate and come from the article or established knowledge. Never invent numbers, dates, articles or scheme names. If unsure, leave it out.
- "staticLinkage": the static syllabus topics THIS article connects to, each written as "<syllabus topic> — <how this article connects to it>". Every item must be specific to this article; use [] if there is no real link.
- "gsPapers": GS1 = history, culture, geography, society; GS2 = polity, governance, constitution, social justice, international relations; GS3 = economy, agriculture, environment, science and technology, internal security, disaster management; GS4 = ethics. Add "Prelims" when there are testable facts.
- "topic": a short, stable concept name for the student's notes (the underlying issue, not the headline).
- Questions: Prelims MCQs at UPSC standard (prefer "How many of the above statements are correct?" with options Only one / Only two / All three / None, or Statement-I/Statement-II); test the static concept behind the news, not trivia like dates of a press release. Every Prelims question must be answerable from standard static knowledge alone, without having read this article: each question is re-solved by an examiner who never sees the article, and questions that need it are discarded; the explanation must cover every statement. One Mains question with a word limit and 4–6 concrete marking points.
Respond ONLY with valid JSON. No markdown.`;

export function buildAnalysisPrompt(params: {
  chunk: string;
  newspaper: string;
  editionDate: string;
  pageNumber: number;
  part: number;
  parts: number;
  studentTopics: string[];
  /** Earlier stories this page may continue (already filtered to ones sharing terms with the page). */
  recentStories?: Array<{ editionDate: string; topic: string; headline: string }>;
}): string {
  const topics = params.studentTopics.slice(0, 40);
  const stories = params.recentStories ?? [];
  return `NEWSPAPER: ${params.newspaper}, edition ${params.editionDate}, page ${params.pageNumber}${params.parts > 1 ? ` (part ${params.part} of ${params.parts})` : ""}
${topics.length ? `\nTOPICS THE STUDENT HAS ALREADY STUDIED: ${topics.join("; ")}\nFor "relatedTopics", copy names EXACTLY from this list, only where a student revising that topic would use this article as a current example of it. Sharing a word is not enough: an RBI Governor is not a State Governor. Most articles match zero or one topic; use [] if none.\n` : ""}${
    stories.length
      ? `\nRECENT STORIES FROM EARLIER EDITIONS (index: date: topic: headline):\n${stories
          .map((s, i) => `${i}: ${s.editionDate}: ${s.topic}: ${s.headline.slice(0, 90)}`)
          .join("\n")}\nSet "continuesStory" to the index ONLY when the article reports a new development of that same specific story (same event, case, policy or dispute: a follow-up, reaction, ruling, implementation or reversal). A different event on a similar theme is NOT a continuation. Otherwise null.\n`
      : ""
  }
PAGE TEXT (may be from several articles; columns can be interleaved):
"""
${params.chunk}
"""

Respond in this exact JSON format:
{
  "articles": [
    {
      "headline": "...",
      "kind": "news" | "editorial" | "opinion" | "explainer" | "other",
      "relevance": "high" | "medium",
      "topic": "short concept name",
      "subject": ${UPSC_SUBJECTS.map((s) => `"${s}"`).join(" | ")},
      "gsPapers": ["Prelims", "GS2"],
      "summary": "2-3 neutral sentences",
      "whyItMatters": "why this matters for UPSC, 1-2 sentences",
      "keyFacts": ["Prelims-relevant fact", "..."],
      "staticLinkage": ["static syllabus topic", "..."],
      "keywords": ["...", "..."],
      "relatedTopics": ["exact name from the studied list"],
      "continuesStory": null,
      "mainsAngle": "how this could be used in a Mains answer",
      "prelimsMcqs": [{"question": "...", "options": {"a": "...", "b": "...", "c": "...", "d": "..."}, "correctAnswer": "b", "explanation": "..."}],
      "mainsQuestion": {"question": "... (150 words)", "guidancePoints": ["...", "..."], "estimatedMarks": 10}
    }
  ],
  "skipped": [{"headline": "...", "reason": "sports result"}]
}`;
}

// ─── Merging and records ────────────────────────────────────

/** Words too broad to show two topics are about the same thing. */
const GENERIC_LINK_WORDS = new Set([
  "policy", "policies", "public", "management", "governance", "government", "development", "role", "issue", "issues",
  "national", "framework", "relation", "relations", "system", "systems", "india", "indian", "state", "states",
  "economy", "economic", "social", "society", "act", "law", "laws", "reform", "reforms", "challenge", "challenges",
  "impact", "analysis", "concept", "basics", "introduction", "overview", "current", "affairs", "news",
]);

/** Specific content terms of a text (generic UPSC words removed, simple plural folding). */
export function specificTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (w.length < 4 || GENERIC_LINK_WORDS.has(w)) continue;
    out.add(w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w);
  }
  return out;
}

/**
 * Map the model's chosen names onto the student's real topics. A link is kept
 * only if the name matches a real topic (case/punctuation-insensitive) AND the
 * topic shares a specific term with the article: the model alone links too
 * loosely ("urban floods" → "Geopolitics"), word overlap alone links wrongly
 * ("RBI Governor" → State Governors). Requiring both avoids each failure.
 */
export function matchStudentTopics<T extends { displayName: string; keywords?: string[] | null }>(
  names: string[],
  topics: T[],
  articleText: string,
  limit = 3,
): T[] {
  const byKey = new Map(topics.map((t) => [topicKey(t.displayName), t]));
  const article = specificTerms(articleText);
  const out: T[] = [];
  for (const n of names) {
    const t = byKey.get(topicKey(n));
    if (!t || out.includes(t)) continue;
    const terms = specificTerms([t.displayName, ...(t.keywords ?? [])].join(" "));
    if (![...terms].some((w) => article.has(w))) continue;
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** The article text a link must share a specific term with. */
export function articleLinkText(a: NewspaperArticle): string {
  return [a.topic, a.headline, a.summary, ...a.keyFacts, ...a.staticLinkage, ...a.keywords].join(" ");
}

export function topicKey(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Merge chunk analyses; an article split across chunks is kept once (first, high relevance wins). */
export function mergeAnalyses(parts: NewspaperAnalysis[]): NewspaperAnalysis {
  const byTopic = new Map<string, NewspaperArticle>();
  const skipped: NewspaperAnalysis["skipped"] = [];
  for (const p of parts) {
    for (const a of p.articles) {
      const k = topicKey(a.topic);
      const prev = byTopic.get(k);
      if (!prev || (prev.relevance === "medium" && a.relevance === "high")) byTopic.set(k, a);
    }
    skipped.push(...p.skipped);
  }
  const articles = [...byTopic.values()].sort((a, b) => (a.relevance === b.relevance ? 0 : a.relevance === "high" ? -1 : 1));
  return { articles, skipped };
}

/** Markdown body of the newspaper note stored in ai_notes.content. */
export function renderNoteMarkdown(a: NewspaperArticle, meta: { newspaper: string; editionDate: string; pageNumber: number }): string {
  const lines = [
    `# ${a.topic}`,
    `*${meta.newspaper}, ${meta.editionDate}, page ${meta.pageNumber} — "${a.headline}"${a.kind === "editorial" || a.kind === "opinion" ? " (opinion)" : ""}*`,
    `**Papers:** ${a.gsPapers.join(", ")}`,
    "",
    "## Summary",
    a.summary,
    "",
    "## Why it matters for UPSC",
    a.whyItMatters,
  ];
  if (a.keyFacts.length) lines.push("", "## Key facts (Prelims)", ...a.keyFacts.map((f) => `- ${f}`));
  if (a.staticLinkage.length) lines.push("", "## Static linkage", ...a.staticLinkage.map((s) => `- ${s}`));
  if (a.mainsAngle) lines.push("", "## Mains angle", a.mainsAngle);
  return lines.join("\n");
}

/** Local calendar date as YYYY-MM-DD, validated. */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

// ─── API contract ───────────────────────────────────────────

/** Rendered page image (data URL) is only used when the PDF has no text layer. */
export const MAX_PAGE_IMAGE_CHARS = 6_000_000;

export const analyseRequestSchema = z.object({
  newspaper: z.string().trim().min(2).max(80).default(DEFAULT_NEWSPAPER),
  editionDate: z.string().refine(isIsoDate, "editionDate must be YYYY-MM-DD"),
  readDate: z.string().refine(isIsoDate, "readDate must be YYYY-MM-DD"),
  pageNumber: z.number().int().min(1).max(200),
  text: z.string().max(MAX_PAGE_CHARS * 2).default(""),
  image: z
    .string()
    .max(MAX_PAGE_IMAGE_CHARS)
    .refine((s) => /^data:image\/(png|jpeg|webp);base64,/.test(s), "image must be a PNG, JPEG or WebP data URL")
    .optional(),
});

export type AnalyseRequest = z.infer<typeof analyseRequestSchema>;

