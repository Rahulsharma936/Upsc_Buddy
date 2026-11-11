/**
 * Newspaper service — analyse one page and save its UPSC-relevant articles as
 * regular concepts (note + audited questions + revision schedule), linked to
 * the student's existing notes. Nothing of the paper itself is stored.
 */

import { conceptRepository } from "@/lib/repositories/concept.repository";
import { noteRepository } from "@/lib/repositories/note.repository";
import { conceptQuestionsRepository } from "@/lib/repositories/concept-questions.repository";
import { relationshipRepository } from "@/lib/repositories/relationship.repository";
import { dailyLogRepository } from "@/lib/repositories/daily-log.repository";
import { revisionIntelligenceService } from "@/lib/ai/services/revision-intelligence.service";
import { auditMcqKeys } from "@/lib/ai/services/mcq-audit";
import { validateAIResponse } from "@/lib/ai/utils/response-validator";
import { normalizeConceptName, toDisplayName, normalizeKeywords } from "@/lib/ai/utils/normalize";
import { groqChat, groqVisionText } from "@/lib/ai/groq-direct";
import {
  NEWSPAPER_SOURCE,
  NEWSPAPER_SYSTEM_PROMPT,
  analysisSchema,
  buildAnalysisPrompt,
  chunkText,
  mergeAnalyses,
  matchStudentTopics,
  articleLinkText,
  renderNoteMarkdown,
  type NewspaperArticle,
  type NewspaperAnalysis,
} from "./newspaper";
import {
  STORY_WINDOW_DAYS,
  daysBefore,
  latestPerStory,
  pickRecentStories,
  resolveContinuation,
  storyIdOf,
  toStoryEntry,
  storyCandidates,
  buildConfirmPrompt,
  confirmedPairs,
  CONFIRM_SYSTEM_PROMPT,
  type StoryEntry,
  type StoryPair,
} from "./stories";
import { z } from "zod";

const confirmSchema = z.object({
  results: z.array(z.object({ pair: z.number().int(), same: z.boolean().catch(false) })).catch([]),
});
import { buildCompilation, periodRange, type Compilation, type CompilationPeriod } from "./compilation";

const ANALYSIS_MAX_TOKENS = 3_500;

export class NewspaperError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

export interface StoryStep {
  conceptId: string;
  editionDate: string;
  pageNumber: number;
  headline: string;
}

export interface SavedArticle {
  conceptId: string;
  newspaper: string;
  editionDate: string;
  pageNumber: number;
  storyId: string;
  /** Other developments of the same story (any edition), oldest first. */
  story: StoryStep[];
  topic: string;
  headline: string;
  kind: string;
  relevance: string;
  subject: string;
  gsPapers: string[];
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  staticLinkage: string[];
  mainsAngle: string;
  linkedNotes: Array<{ id: string; name: string }>;
  prelimsCount: number;
  mainsQuestion: string | null;
}

export interface PageResult {
  newspaper: string;
  editionDate: string;
  pageNumber: number;
  articles: SavedArticle[];
  skipped: Array<{ headline: string; reason: string }>;
  model: string | null;
  cached: boolean;
}

function analysisModels(): string[] {
  const primary = process.env.NEWSPAPER_MODEL || "openai/gpt-oss-120b";
  const fallback = process.env.NEWSPAPER_FALLBACK_MODEL || "openai/gpt-oss-20b";
  return primary === fallback ? [primary] : [primary, fallback];
}

function toSaved(c: { id: string; displayName: string; subject: string; extractionMetadata: unknown }, note: { coreIdea: string; examTriggers: string[]; staticCurrentLink: string[]; answerWritingAngles: string[] } | undefined, prelimsCount: number, mains: string | null): SavedArticle {
  const m = (c.extractionMetadata ?? {}) as Record<string, unknown>;
  return {
    conceptId: c.id,
    newspaper: String(m.newspaper ?? ""),
    editionDate: String(m.editionDate ?? ""),
    pageNumber: Number(m.pageNumber ?? 0),
    storyId: storyIdOf(c),
    story: [],
    topic: c.displayName,
    headline: String(m.headline ?? ""),
    kind: String(m.kind ?? "news"),
    relevance: String(m.relevance ?? "medium"),
    subject: c.subject,
    gsPapers: Array.isArray(m.gsPapers) ? (m.gsPapers as string[]) : [],
    summary: note?.coreIdea ?? "",
    whyItMatters: String(m.whyItMatters ?? ""),
    keyFacts: note?.examTriggers ?? [],
    staticLinkage: note?.staticCurrentLink ?? [],
    mainsAngle: note?.answerWritingAngles?.[0] ?? "",
    linkedNotes: Array.isArray(m.linkedNotes) ? (m.linkedNotes as Array<{ id: string; name: string }>) : [],
    prelimsCount,
    mainsQuestion: mains,
  };
}

export const newspaperService = {
  /** OCR fallback for a page with no text layer (image-only e-paper). */
  async pageTextFromImage(image: string): Promise<string> {
    const { text } = await groqVisionText(
      [image],
      "This is a newspaper page. Transcribe the text of every article exactly. Put each headline on its own line and separate articles with a blank line. Skip advertisements. Do not summarise.",
      6_000,
    );
    return text;
  },

  /** Saved results for a page, if it was analysed before. */
  async getPage(userId: string, newspaper: string, editionDate: string, pageNumber: number): Promise<PageResult | null> {
    const concepts = await conceptRepository.findNewspaperConcepts(userId, { newspaper, editionDate, pageNumber });
    if (concepts.length === 0) return null;
    const { articles } = await this.hydrate(concepts);
    return { newspaper, editionDate, pageNumber, articles: await this.attachStories(userId, articles), skipped: [], model: null, cached: true };
  },

  /** Fill each article's other story developments (one query for all). */
  async attachStories(userId: string, articles: SavedArticle[]): Promise<SavedArticle[]> {
    const storyIds = [...new Set(articles.map((a) => a.storyId))];
    if (storyIds.length === 0) return articles;
    const members = await conceptRepository.findNewspaperConcepts(userId, { storyIds }, 1_000).catch(() => []);
    const byStory = new Map<string, StoryStep[]>();
    for (const c of members) {
      const e = toStoryEntry(c);
      const list = byStory.get(e.storyId) ?? [];
      list.push({ conceptId: c.id, editionDate: e.editionDate, pageNumber: e.pageNumber, headline: e.headline });
      byStory.set(e.storyId, list);
    }
    return articles.map((a) => ({
      ...a,
      story: (byStory.get(a.storyId) ?? [])
        .filter((s) => s.conceptId !== a.conceptId)
        .sort((x, y) => x.editionDate.localeCompare(y.editionDate) || x.pageNumber - y.pageNumber),
    }));
  },

  /** Weekly or monthly compilation of Newspaper Notes, stories folded together, grouped by GS paper. */
  async compile(userId: string, period: CompilationPeriod, anchor: string): Promise<Compilation> {
    const range = periodRange(period, anchor);
    const concepts = await conceptRepository.findNewspaperConcepts(userId, { editionFrom: range.from, editionTo: range.to }, 1_500);
    if (concepts.length === 0) return buildCompilation(range, []);
    const { articles } = await this.hydrate(concepts);
    return buildCompilation(range, await this.attachStories(userId, articles));
  },

  async hydrate(concepts: Awaited<ReturnType<typeof conceptRepository.findNewspaperConcepts>>): Promise<{ articles: SavedArticle[] }> {
    const ids = concepts.map((c) => c.id);
    const [notes, questions] = await Promise.all([
      noteRepository.findLatestForConcepts(ids),
      conceptQuestionsRepository.findByConcepts(ids),
    ]);
    const qById = new Map(questions.map((q) => [q.conceptId, q]));
    return {
      articles: concepts.map((c) => {
        const q = qById.get(c.id);
        const mains = Array.isArray(q?.mainsQuestions) && q!.mainsQuestions.length ? String((q!.mainsQuestions as Array<{ question: string }>)[0].question) : null;
        return toSaved(c, notes.get(c.id), Array.isArray(q?.prelimsMcqs) ? (q!.prelimsMcqs as unknown[]).length : 0, mains);
      }),
    };
  },

  async analysePage(params: {
    userId: string;
    newspaper: string;
    editionDate: string;
    readDate: string;
    pageNumber: number;
    text: string;
  }): Promise<PageResult> {
    const { userId, newspaper, editionDate, readDate, pageNumber } = params;

    // A page is analysed once; its concepts then carry the student's revision evidence.
    const cached = await this.getPage(userId, newspaper, editionDate, pageNumber);
    if (cached) return cached;

    const chunks = chunkText(params.text);
    if (chunks.length === 0) throw new NewspaperError("No readable text on this page.");

    const studentConcepts = (await conceptRepository.findByUser(userId, 500).catch(() => []))
      .filter((c) => (c.extractionMetadata as Record<string, unknown> | null)?.source !== NEWSPAPER_SOURCE);
    const studentTopics = studentConcepts.map((c) => c.displayName);

    // Stories from the last month (this page excluded) that this page may continue.
    const recentStories = latestPerStory(
      (
        await conceptRepository
          .findNewspaperConcepts(userId, { editionFrom: daysBefore(editionDate, STORY_WINDOW_DAYS), editionTo: editionDate }, 1_000)
          .catch(() => [])
      )
        .map(toStoryEntry)
        .filter((e) => !(e.editionDate === editionDate && e.pageNumber === pageNumber)),
    );

    // Analyse chunks sequentially (per-minute token limit).
    const parts: NewspaperAnalysis[] = [];
    /** Earlier story each article continues (resolved per chunk, since each chunk is offered its own list). */
    const continues = new Map<NewspaperArticle, StoryEntry>();
    const unconfirmed: StoryPair[] = [];
    let model: string | null = null;
    for (const [i, chunk] of chunks.entries()) {
      const offered = pickRecentStories(recentStories, chunk);
      const res = await groqChat({
        models: analysisModels(),
        system: NEWSPAPER_SYSTEM_PROMPT,
        user: buildAnalysisPrompt({ chunk, newspaper, editionDate, pageNumber, part: i + 1, parts: chunks.length, studentTopics, recentStories: offered }),
        maxTokens: ANALYSIS_MAX_TOKENS,
        json: true,
      });
      model = res.model;
      const v = validateAIResponse(res.content, analysisSchema);
      if (v.success && v.data) {
        parts.push(v.data);
        for (const a of v.data.articles) {
          const story = resolveContinuation(a, offered);
          if (story) continues.set(a, story);
          else for (const s of storyCandidates(a, offered)) unconfirmed.push({ article: a, story: s });
        }
      } else console.warn("[NEWSPAPER] Unparseable analysis for chunk", i + 1, v.errors.slice(0, 2));
    }

    // Focused yes/no check for likely continuations the analysis left unlinked (one small call).
    if (unconfirmed.length > 0) {
      try {
        const res = await groqChat({
          models: analysisModels(),
          system: CONFIRM_SYSTEM_PROMPT,
          user: buildConfirmPrompt(unconfirmed),
          maxTokens: 600,
          json: true,
          temperature: 0,
        });
        const v = validateAIResponse(res.content, confirmSchema);
        if (v.success && v.data) {
          for (const p of confirmedPairs(unconfirmed, v.data.results)) if (!continues.has(p.article)) continues.set(p.article, p.story);
        }
      } catch (err) {
        console.warn("[NEWSPAPER] Story confirmation skipped:", err instanceof Error ? err.message : err);
      }
    }
    if (parts.length === 0) throw new NewspaperError("Could not analyse this page. Please try again.", 502);
    const merged = mergeAnalyses(parts);

    if (merged.articles.length === 0) {
      return { newspaper, editionDate, pageNumber, articles: [], skipped: merged.skipped, model, cached: false };
    }

    // Answer-key audit across all articles in one pass (both model families).
    const allMcqs = merged.articles.flatMap((a) => a.prelimsMcqs);
    const audit = await auditMcqKeys(allMcqs);
    const keptSet = new Set(audit.kept);

    // The day's study log (one per date) anchors the concepts; reading the paper counts as study.
    let log = await dailyLogRepository.findByUserAndDate(userId, readDate);
    if (!log) {
      log = await dailyLogRepository.create({
        userId,
        date: readDate,
        rawInput: `Read ${newspaper} (${editionDate}).`,
        subjects: [...new Set(merged.articles.map((a) => a.subject))],
        concepts: [],
      });
    }

    // Link each article to the student's notes the model judged related. Names are
    // checked against the student's real topics; word overlap alone is not used,
    // because it links "RBI Governor" news to a note on State Governors.
    const linksFor = new Map(
      merged.articles.map((a) => [
        a,
        matchStudentTopics(a.relatedTopics, studentConcepts, articleLinkText(a)).map((c) => ({ id: c.id, name: c.displayName })),
      ]),
    );

    const created = await conceptRepository.createMany(
      merged.articles.map((a) => ({
        userId,
        dailyLogId: log!.id,
        // Suffix keeps news concepts distinct from the student's own concepts of the same name.
        normalizedName: `${normalizeConceptName(a.topic)} news ${editionDate} p${pageNumber}`,
        displayName: toDisplayName(a.topic),
        name: a.headline,
        subject: a.subject,
        keywords: normalizeKeywords(a.keywords),
        difficulty: "intermediate",
        extractionConfidence: a.relevance === "high" ? 0.8 : 0.65,
        extractionMetadata: {
          source: NEWSPAPER_SOURCE,
          newspaper,
          editionDate,
          pageNumber,
          headline: a.headline,
          kind: a.kind,
          relevance: a.relevance,
          gsPapers: a.gsPapers,
          whyItMatters: a.whyItMatters,
          linkedNotes: linksFor.get(a) ?? [],
          storyId: continues.get(a)?.storyId ?? crypto.randomUUID(),
          ...(continues.get(a) ? { continuesConceptId: continues.get(a)!.conceptId } : {}),
          model,
        },
      })),
    );

    const byName = new Map(created.map((c) => [c.normalizedName, c]));
    const articles: SavedArticle[] = [];
    for (const a of merged.articles) {
      const c = byName.get(`${normalizeConceptName(a.topic)} news ${editionDate} p${pageNumber}`);
      if (!c) continue;

      const prelims = a.prelimsMcqs.filter((m) => keptSet.has(m)).map((m) => ({ ...m, difficulty: "moderate", questionId: crypto.randomUUID() }));
      const mains = a.mainsQuestion ? [{ ...a.mainsQuestion, paperRelevance: a.gsPapers.find((p) => p.startsWith("GS")) ?? "GS2" }] : [];

      const linked = linksFor.get(a) ?? [];

      await Promise.all([
        noteRepository.create({
          conceptId: c.id,
          version: 1,
          content: renderNoteMarkdown(a, { newspaper, editionDate, pageNumber }),
          coreIdea: a.summary,
          examTriggers: a.keyFacts,
          staticCurrentLink: a.staticLinkage,
          answerWritingAngles: a.mainsAngle ? [a.mainsAngle] : [],
          memoryHooks: [],
          generatedBy: `newspaper:${model ?? "unknown"}`,
          generationMetadata: { source: NEWSPAPER_SOURCE, newspaper, editionDate, pageNumber },
        }),
        conceptQuestionsRepository.upsert({
          conceptId: c.id,
          prelimsMcqs: prelims,
          mainsQuestions: mains,
          interviewPrompts: [],
          generationConfidence: "0.70",
          generationMetadata: { version: "np1", source: NEWSPAPER_SOURCE, audited: audit.audited, auditors: audit.auditors, auditDropped: a.prelimsMcqs.length - prelims.length, model },
        }),
        ...linked.map((l) =>
          relationshipRepository.create({
            sourceConceptId: c.id,
            targetConceptId: l.id,
            relationshipType: "current_affairs_connection",
            relationshipStrength: 0.6,
            relationshipReason: `In the news: ${a.headline}`.slice(0, 300),
            crossSubject: studentConcepts.find((s) => s.id === l.id)?.subject !== a.subject,
            generatedBy: NEWSPAPER_SOURCE,
          }).catch(() => null),
        ),
        // Story thread edge: this development → the previous one.
        ...(continues.get(a)
          ? [
              relationshipRepository
                .create({
                  sourceConceptId: c.id,
                  targetConceptId: continues.get(a)!.conceptId,
                  relationshipType: "current_affairs_connection",
                  relationshipStrength: 0.9,
                  relationshipReason: `Later development (${editionDate}) of the story first reported as: ${continues.get(a)!.headline}`.slice(0, 300),
                  crossSubject: false,
                  generatedBy: "newspaper-story",
                })
                .catch(() => null),
            ]
          : []),
        revisionIntelligenceService.initializeForConcept({ userId, conceptId: c.id }).catch(() => null),
      ]);

      articles.push({
        ...toSaved(c, { coreIdea: a.summary, examTriggers: a.keyFacts, staticCurrentLink: a.staticLinkage, answerWritingAngles: a.mainsAngle ? [a.mainsAngle] : [] }, prelims.length, mains[0]?.question ?? null),
        whyItMatters: a.whyItMatters,
        linkedNotes: linked,
      });
    }

    return { newspaper, editionDate, pageNumber, articles: await this.attachStories(userId, articles), skipped: merged.skipped, model, cached: false };
  },

  /** All Newspaper Notes, grouped by edition (newest first). */
  async listNotes(userId: string): Promise<Array<{ newspaper: string; editionDate: string; articles: SavedArticle[] }>> {
    const concepts = await conceptRepository.findNewspaperConcepts(userId);
    if (concepts.length === 0) return [];
    const articles = await this.attachStories(userId, (await this.hydrate(concepts)).articles);
    const byId = new Map(articles.map((a) => [a.conceptId, a]));
    const groups = new Map<string, { newspaper: string; editionDate: string; articles: SavedArticle[] }>();
    for (const c of concepts) {
      const m = (c.extractionMetadata ?? {}) as Record<string, unknown>;
      const key = `${m.newspaper}|${m.editionDate}`;
      if (!groups.has(key)) groups.set(key, { newspaper: String(m.newspaper), editionDate: String(m.editionDate), articles: [] });
      const a = byId.get(c.id);
      if (a) groups.get(key)!.articles.push(a);
    }
    return [...groups.values()].sort((x, y) => y.editionDate.localeCompare(x.editionDate));
  },
};

export type { NewspaperArticle };
