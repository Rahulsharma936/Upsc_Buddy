"use client";

import type { SavedArticle } from "@/lib/newspaper/newspaper.service";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/newspaper/compilation";

const KIND_LABEL: Record<string, string> = {
  news: "News",
  editorial: "Editorial",
  opinion: "Opinion",
  explainer: "Explainer",
  other: "Other",
};

export function ArticleCard({ article: a }: { article: SavedArticle }) {
  const isOpinion = a.kind === "editorial" || a.kind === "opinion";
  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-4" data-concept-id={a.conceptId}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5",
              isOpinion ? "border-amber-600/40 text-amber-800 dark:text-amber-300" : "border-border text-muted-foreground",
            )}
          >
            {KIND_LABEL[a.kind] ?? a.kind}
          </span>
          {a.gsPapers.map((p) => (
            <span key={p} className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
              {p}
            </span>
          ))}
          <span className="text-muted-foreground">{a.subject}</span>
          {a.relevance === "high" && <span className="text-foreground">High relevance</span>}
        </div>
        <h3 className="text-sm font-semibold leading-snug">{a.topic}</h3>
        {a.headline && <p className="text-[11px] italic text-muted-foreground">&ldquo;{a.headline}&rdquo;</p>}
      </header>

      <p className="text-sm leading-relaxed">{a.summary}</p>

      {a.whyItMatters && (
        <Section title="Why it matters">
          <p>{a.whyItMatters}</p>
        </Section>
      )}
      {a.keyFacts.length > 0 && !isOpinion && (
        <Section title="Key facts for Prelims">
          <ul className="list-disc space-y-0.5 pl-4">
            {a.keyFacts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </Section>
      )}
      {a.staticLinkage.length > 0 && (
        <Section title="Static linkage">
          <ul className="list-disc space-y-0.5 pl-4">
            {a.staticLinkage.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}
      {a.mainsAngle && (
        <Section title="Mains angle">
          <p>{a.mainsAngle}</p>
        </Section>
      )}

      {a.story.length > 0 && <StoryTimeline article={a} />}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span>
          {a.prelimsCount} Prelims question{a.prelimsCount === 1 ? "" : "s"}
          {a.mainsQuestion ? ", 1 Mains question" : ""}
        </span>
        {a.linkedNotes.length > 0 && (
          <span>
            Connects to your notes: <span className="text-foreground">{a.linkedNotes.map((n) => n.name).join(", ")}</span>
          </span>
        )}
      </footer>
    </article>
  );
}

const MAX_STEPS = 6;

/** The same story across editions, oldest first, with this report marked. */
function StoryTimeline({ article: a }: { article: SavedArticle }) {
  const steps = [...a.story, { conceptId: a.conceptId, editionDate: a.editionDate, pageNumber: a.pageNumber, headline: a.headline }].sort(
    (x, y) => x.editionDate.localeCompare(y.editionDate) || x.pageNumber - y.pageNumber,
  );
  const hidden = Math.max(0, steps.length - MAX_STEPS);
  return (
    <Section title={`Story so far: ${steps.length} reports`}>
      <ol className="space-y-0.5" data-part="story">
        {hidden > 0 && (
          <li className="text-muted-foreground">
            {hidden} earlier report{hidden === 1 ? "" : "s"}
          </li>
        )}
        {steps.slice(hidden).map((s) => {
          const current = s.conceptId === a.conceptId;
          return (
            <li key={s.conceptId} className={cn(current ? "font-medium text-foreground" : "text-muted-foreground")}>
              <span className="tabular-nums">
                {shortDate(s.editionDate)}, p{s.pageNumber}
              </span>
              : {s.headline}
              {current && " (this report)"}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 text-xs leading-relaxed">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}
