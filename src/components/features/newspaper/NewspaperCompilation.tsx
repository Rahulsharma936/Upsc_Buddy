"use client";

/**
 * NewspaperCompilation — the week's or month's current affairs from the
 * student's Newspaper Notes: one entry per story (developments folded into a
 * timeline), grouped by GS paper, printable.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { compilationHtml, shortDate, type Compilation, type CompilationPeriod, type CompiledStory } from "@/lib/newspaper/compilation";
import { localIsoDate } from "@/lib/newspaper/page-text";
import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

export function NewspaperCompilation({ period, refreshKey }: { period: CompilationPeriod; refreshKey: number }) {
  const [anchor, setAnchor] = useState(() => localIsoDate());
  const [loaded, setLoaded] = useState<{ key: string; data: Compilation | null; error: string | null } | null>(null);
  const key = `${period}|${anchor}|${refreshKey}`;

  useEffect(() => {
    let alive = true;
    fetch(`/api/newspaper/compilation?period=${period}&date=${anchor}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        setLoaded(
          json?.success
            ? { key, data: json.data, error: null }
            : { key, data: null, error: json?.error?.message ?? "Could not load the compilation." },
        );
      })
      .catch(() => {
        if (alive) setLoaded({ key, data: null, error: "Could not load the compilation." });
      });
    return () => {
      alive = false;
    };
  }, [key, period, anchor]);

  const current = loaded?.key === key ? loaded : null;
  const c = current?.data ?? null;
  const today = localIsoDate();

  function print() {
    if (!c) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(compilationHtml(c, `Current affairs: ${c.range.label}`));
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="space-y-4" id="np-compilation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous period"
            id="np-comp-prev"
            disabled={!c}
            onClick={() => c && setAnchor(c.range.prevAnchor)}
            className="rounded-md border border-border p-1 hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-medium" id="np-comp-label">
            {c?.range.label ?? " "}
          </span>
          <button
            type="button"
            aria-label="Next period"
            id="np-comp-next"
            disabled={!c || c.range.to >= today}
            onClick={() => c && setAnchor(c.range.nextAnchor)}
            className="rounded-md border border-border p-1 hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          id="np-comp-print"
          onClick={print}
          disabled={!c || c.totals.stories === 0}
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted disabled:opacity-40"
        >
          Print or save as PDF
        </button>
      </div>

      {!current && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {current?.error && <p className="text-xs text-red-700 dark:text-red-300">{current.error}</p>}

      {c && c.totals.stories === 0 && <p className="text-xs text-muted-foreground">No newspaper notes in this period.</p>}

      {c && c.totals.stories > 0 && (
        <>
          <p className="text-xs text-muted-foreground" id="np-comp-totals">
            {c.totals.stories} stor{c.totals.stories === 1 ? "y" : "ies"} from {c.totals.articles} article
            {c.totals.articles === 1 ? "" : "s"}
            {c.totals.continuing > 0 && `, ${c.totals.continuing} followed across editions`}, {c.totals.questions} question
            {c.totals.questions === 1 ? "" : "s"} in Practice.{" "}
            <Link href={`${ROUTES.PRACTICE}?scope=current`} className="font-medium text-foreground underline-offset-2 hover:underline">
              Practise
            </Link>{" "}
            or{" "}
            <Link href={`${ROUTES.REVISION}?scope=current`} className="font-medium text-foreground underline-offset-2 hover:underline">
              revise
            </Link>{" "}
            current affairs.
          </p>
          {c.papers.map((p) => (
            <section key={p.paper} className="space-y-3" data-paper={p.paper}>
              <h3 className="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.label}</h3>
              {p.stories.map((s) => (
                <StoryEntry key={s.storyId} story={s} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function StoryEntry({ story: s }: { story: CompiledStory }) {
  const l = s.latest;
  const isOpinion = s.kind === "editorial" || s.kind === "opinion";
  const followed = s.developments.length > 1 || s.earlierCount > 0;
  return (
    <article className="space-y-2 rounded-lg border border-border bg-card p-4" data-story-id={s.storyId}>
      <header className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{s.subject}</span>
          {isOpinion && <span className="text-amber-800 dark:text-amber-300">Opinion</span>}
          {s.relevance === "high" && <span className="text-foreground">High relevance</span>}
          {followed && <span className="text-foreground">Developing story</span>}
        </div>
        <h4 className="text-sm font-semibold leading-snug">{s.topic}</h4>
      </header>

      {followed ? (
        <ol className="space-y-0.5 text-xs" data-part="developments">
          {s.earlierCount > 0 && (
            <li className="text-muted-foreground">
              {s.earlierCount} earlier report{s.earlierCount === 1 ? "" : "s"} before this period
            </li>
          )}
          {s.developments.map((d) => (
            <li key={d.conceptId} className="text-muted-foreground">
              <span className="tabular-nums text-foreground">{shortDate(d.editionDate)}</span>: {d.headline}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {shortDate(l.editionDate)}, p{l.pageNumber}: {l.headline}
        </p>
      )}

      <p className="text-sm leading-relaxed">{l.summary}</p>
      {l.keyFacts.length > 0 && !isOpinion && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {l.keyFacts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {l.staticLinkage.length > 0 && <p className="text-xs text-muted-foreground">Static linkage: {l.staticLinkage.join("; ")}</p>}
      {l.mainsAngle && <p className="text-xs text-muted-foreground">Mains angle: {l.mainsAngle}</p>}
    </article>
  );
}
