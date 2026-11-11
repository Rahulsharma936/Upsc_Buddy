/**
 * Story threads — the same news story followed across editions (pure).
 *
 * Every newspaper concept carries a `storyId` in its extraction metadata. A
 * new article that the model judges to be a development of an earlier story
 * inherits that story's id; otherwise it starts a new story. No new tables.
 *
 * The model only sees a short, indexed list of recent stories that share
 * specific terms with the page, and a continuation is accepted only if the
 * index is valid AND the article shares a specific term with that story.
 */

import { specificTerms, articleLinkText, type NewspaperArticle } from "./newspaper";

export const STORY_WINDOW_DAYS = 30;
export const MAX_STORIES_IN_PROMPT = 20;

export interface StoryEntry {
  storyId: string;
  conceptId: string;
  editionDate: string;
  pageNumber: number;
  topic: string;
  headline: string;
  keywords: string[];
}

interface ConceptLike {
  id: string;
  displayName: string;
  keywords?: string[] | null;
  extractionMetadata: unknown;
}

/** A concept's story id; concepts saved before story threads started their own story. */
export function storyIdOf(c: { id: string; extractionMetadata: unknown }): string {
  const m = (c.extractionMetadata ?? {}) as Record<string, unknown>;
  return typeof m.storyId === "string" && m.storyId ? m.storyId : c.id;
}

export function toStoryEntry(c: ConceptLike): StoryEntry {
  const m = (c.extractionMetadata ?? {}) as Record<string, unknown>;
  return {
    storyId: storyIdOf(c),
    conceptId: c.id,
    editionDate: String(m.editionDate ?? ""),
    pageNumber: Number(m.pageNumber ?? 0),
    topic: c.displayName,
    headline: String(m.headline ?? ""),
    keywords: c.keywords ?? [],
  };
}

function laterThan(a: StoryEntry, b: StoryEntry): boolean {
  return a.editionDate > b.editionDate || (a.editionDate === b.editionDate && a.pageNumber > b.pageNumber);
}

/** The latest development of each story, newest first. */
export function latestPerStory(entries: StoryEntry[]): StoryEntry[] {
  const best = new Map<string, StoryEntry>();
  for (const e of entries) {
    const cur = best.get(e.storyId);
    if (!cur || laterThan(e, cur)) best.set(e.storyId, e);
  }
  return [...best.values()].sort((a, b) => (laterThan(a, b) ? -1 : laterThan(b, a) ? 1 : 0));
}

function storyTerms(s: StoryEntry): Set<string> {
  return specificTerms([s.topic, s.headline, ...s.keywords].join(" "));
}

/**
 * Stories worth offering for one chunk of page text: those sharing the most
 * specific terms with it (at least one), capped to keep the prompt small.
 */
export function pickRecentStories(stories: StoryEntry[], text: string, limit: number = MAX_STORIES_IN_PROMPT): StoryEntry[] {
  const page = specificTerms(text);
  return stories
    .map((s, order) => {
      let hits = 0;
      for (const t of storyTerms(s)) if (page.has(t)) hits++;
      return { s, hits, order };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.s);
}

/** The earlier story this article continues, if the model said so and the article shares a specific term with it. */
export function resolveContinuation(article: NewspaperArticle, offered: StoryEntry[]): StoryEntry | null {
  const i = article.continuesStory;
  if (i === null || !Number.isInteger(i) || i < 0 || i >= offered.length) return null;
  const story = offered[i];
  const own = specificTerms(articleLinkText(article));
  for (const t of storyTerms(story)) if (own.has(t)) return story;
  return null;
}

// ─── Focused confirmation ───────────────────────────────────
//
// The continuation field sits inside a large analysis reply and is easy for
// the model to skip. Articles left unlinked that share at least two specific
// terms with an offered story get one short, batched yes/no check instead.

export const MIN_SHARED_FOR_CHECK = 2;

/** Offered stories sharing at least `minShared` specific terms with the article, best first. */
export function storyCandidates(article: NewspaperArticle, offered: StoryEntry[], minShared: number = MIN_SHARED_FOR_CHECK, limit = 2): StoryEntry[] {
  const own = specificTerms(articleLinkText(article));
  return offered
    .map((s) => {
      let hits = 0;
      for (const t of storyTerms(s)) if (own.has(t)) hits++;
      return { s, hits };
    })
    .filter((x) => x.hits >= minShared)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.s);
}

export interface StoryPair {
  article: NewspaperArticle;
  story: StoryEntry;
}

export const CONFIRM_SYSTEM_PROMPT = `You decide whether a newspaper article is a new development of an earlier news story.
"Same story" means the same specific event, case, policy decision or dispute, followed up: a reaction to it, a ruling or action that follows from it, its implementation, or its reversal.
A different event on a similar theme, or involving the same institution or office, is NOT the same story (an RBI digital-rupee pilot does not continue an RBI interest-rate decision).
Respond ONLY with valid JSON: {"results":[{"pair":0,"same":true}]}`;

export function buildConfirmPrompt(pairs: StoryPair[]): string {
  return pairs
    .map(
      (p, i) =>
        `PAIR ${i}\nNEW ARTICLE: ${p.article.headline}. ${p.article.summary}\nEARLIER STORY (${p.story.editionDate}): ${p.story.topic}. ${p.story.headline}`,
    )
    .join("\n\n");
}

/** Pairs the model confirmed as the same story; each article keeps its first confirmed story. */
export function confirmedPairs(pairs: StoryPair[], results: Array<{ pair: number; same: boolean }>): StoryPair[] {
  const out: StoryPair[] = [];
  const seen = new Set<NewspaperArticle>();
  for (const r of results) {
    const p = pairs[r.pair];
    if (!r.same || !p || seen.has(p.article)) continue;
    seen.add(p.article);
    out.push(p);
  }
  return out;
}

/** ISO date `days` before the given ISO date. */
export function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
