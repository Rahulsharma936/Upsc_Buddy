/**
 * Weekly and monthly current-affairs compilations (pure, browser-safe).
 *
 * A compilation gathers the student's Newspaper Notes for a period, folds
 * articles of the same story into one entry with a timeline of developments,
 * and groups stories by GS paper.
 */

export type CompilationPeriod = "week" | "month";

export interface PeriodRange {
  period: CompilationPeriod;
  from: string;
  to: string;
  label: string;
  prevAnchor: string;
  nextAnchor: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(isoDate: string, n: number): string {
  const d = utc(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
export function shortDate(isoDate: string): string {
  const d = utc(isoDate);
  return Number.isNaN(d.getTime()) ? isoDate : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Week = Monday to Sunday containing the anchor; month = its calendar month. */
export function periodRange(period: CompilationPeriod, anchor: string): PeriodRange {
  const a = utc(anchor);
  if (period === "week") {
    const dow = (a.getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(anchor, -dow);
    const to = addDays(from, 6);
    const year = utc(to).getUTCFullYear();
    return { period, from, to, label: `Week of ${shortDate(from)} to ${shortDate(to)} ${year}`, prevAnchor: addDays(from, -7), nextAnchor: addDays(from, 7) };
  }
  const y = a.getUTCFullYear();
  const m = a.getUTCMonth();
  const from = iso(new Date(Date.UTC(y, m, 1)));
  const to = iso(new Date(Date.UTC(y, m + 1, 0)));
  return {
    period,
    from,
    to,
    label: `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m]} ${y}`,
    prevAnchor: iso(new Date(Date.UTC(y, m - 1, 1))),
    nextAnchor: iso(new Date(Date.UTC(y, m + 1, 1))),
  };
}

export const PAPER_ORDER = ["GS1", "GS2", "GS3", "GS4", "Essay", "Prelims"] as const;
export const PAPER_LABEL: Record<string, string> = {
  GS1: "GS1: History, culture, geography and society",
  GS2: "GS2: Polity, governance and international relations",
  GS3: "GS3: Economy, environment, science and security",
  GS4: "GS4: Ethics",
  Essay: "Essay",
  Prelims: "Prelims only",
};

/** The paper a story is filed under: its first Mains paper, else Prelims. */
export function primaryPaper(gsPapers: string[]): string {
  return gsPapers.find((p) => p !== "Prelims" && (PAPER_ORDER as readonly string[]).includes(p)) ?? "Prelims";
}

export interface CompilableArticle {
  conceptId: string;
  storyId: string;
  editionDate: string;
  pageNumber: number;
  newspaper: string;
  topic: string;
  headline: string;
  kind: string;
  relevance: string;
  subject: string;
  gsPapers: string[];
  summary: string;
  keyFacts: string[];
  staticLinkage: string[];
  mainsAngle: string;
  prelimsCount: number;
  mainsQuestion: string | null;
  /** Other developments of the same story, any date. */
  story: Array<{ conceptId: string; editionDate: string; pageNumber: number; headline: string }>;
}

export interface CompiledStory {
  storyId: string;
  topic: string;
  subject: string;
  paper: string;
  kind: string;
  relevance: string;
  /** Developments inside the period, oldest first. */
  developments: CompilableArticle[];
  latest: CompilableArticle;
  /** Developments of this story dated before the period. */
  earlierCount: number;
  questionCount: number;
}

export interface Compilation {
  range: PeriodRange;
  totals: { articles: number; stories: number; questions: number; continuing: number };
  papers: Array<{ paper: string; label: string; stories: CompiledStory[] }>;
}

function byDate(a: CompilableArticle, b: CompilableArticle): number {
  return a.editionDate.localeCompare(b.editionDate) || a.pageNumber - b.pageNumber;
}

export function buildCompilation(range: PeriodRange, articles: CompilableArticle[]): Compilation {
  const inRange = articles.filter((a) => a.editionDate >= range.from && a.editionDate <= range.to);
  const byStory = new Map<string, CompilableArticle[]>();
  for (const a of inRange) {
    const list = byStory.get(a.storyId) ?? [];
    if (!list.some((x) => x.conceptId === a.conceptId)) list.push(a);
    byStory.set(a.storyId, list);
  }

  const stories: CompiledStory[] = [...byStory.entries()].map(([storyId, devs]) => {
    const developments = [...devs].sort(byDate);
    const latest = developments[developments.length - 1];
    const known = new Set(developments.map((d) => d.conceptId));
    const earlier = new Set<string>();
    for (const d of developments) for (const s of d.story) if (!known.has(s.conceptId) && s.editionDate < range.from) earlier.add(s.conceptId);
    return {
      storyId,
      topic: latest.topic,
      subject: latest.subject,
      paper: primaryPaper(latest.gsPapers),
      kind: latest.kind,
      relevance: developments.some((d) => d.relevance === "high") ? "high" : "medium",
      developments,
      latest,
      earlierCount: earlier.size,
      questionCount: developments.reduce((n, d) => n + d.prelimsCount + (d.mainsQuestion ? 1 : 0), 0),
    };
  });

  const papers = PAPER_ORDER.map((paper) => ({
    paper,
    label: PAPER_LABEL[paper],
    stories: stories
      .filter((s) => s.paper === paper)
      .sort(
        (a, b) =>
          (a.relevance === b.relevance ? 0 : a.relevance === "high" ? -1 : 1) ||
          b.developments.length - a.developments.length ||
          b.latest.editionDate.localeCompare(a.latest.editionDate),
      ),
  })).filter((p) => p.stories.length > 0);

  return {
    range,
    totals: {
      articles: inRange.length,
      stories: stories.length,
      questions: stories.reduce((n, s) => n + s.questionCount, 0),
      continuing: stories.filter((s) => s.developments.length > 1 || s.earlierCount > 0).length,
    },
    papers,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A self-contained, print-friendly HTML document of a compilation (all text escaped). */
export function compilationHtml(c: Compilation, title: string): string {
  const body = c.papers
    .map(
      (p) => `<h2>${esc(p.label)}</h2>${p.stories
        .map((s) => {
          const l = s.latest;
          const timeline =
            s.developments.length > 1 || s.earlierCount > 0
              ? `<p class="meta">Developments: ${s.developments.map((d) => `${esc(shortDate(d.editionDate))}: ${esc(d.headline)}`).join("; ")}${s.earlierCount ? ` (and ${s.earlierCount} earlier)` : ""}</p>`
              : `<p class="meta">${esc(shortDate(l.editionDate))}: ${esc(l.headline)}</p>`;
          const isOpinion = s.kind === "editorial" || s.kind === "opinion";
          return `<section><h3>${esc(s.topic)}${isOpinion ? " (opinion)" : ""}</h3>${timeline}<p>${esc(l.summary)}</p>${
            l.keyFacts.length && !isOpinion ? `<ul>${l.keyFacts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""
          }${l.staticLinkage.length ? `<p class="meta">Static linkage: ${l.staticLinkage.map(esc).join("; ")}</p>` : ""}${
            l.mainsAngle ? `<p class="meta">Mains angle: ${esc(l.mainsAngle)}</p>` : ""
          }</section>`;
        })
        .join("")}`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:11pt/1.45 Georgia,serif;color:#111;max-width:46rem;margin:2rem auto;padding:0 1rem}
h1{font-size:16pt;margin:0 0 .25rem}h2{font-size:12.5pt;border-bottom:1px solid #999;margin:1.5rem 0 .5rem;padding-bottom:.2rem}
h3{font-size:11.5pt;margin:.9rem 0 .2rem}p,ul{margin:.25rem 0}.meta{color:#444;font-size:9.5pt}section{break-inside:avoid}
</style></head><body><h1>${esc(title)}</h1><p class="meta">${c.totals.stories} stories from ${c.totals.articles} articles</p>${body || "<p>No newspaper notes in this period.</p>"}</body></html>`;
}
