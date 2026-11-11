"use client";

/** Newspaper Notes — every saved article, grouped by edition, newest first. */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { SavedArticle } from "@/lib/newspaper/newspaper.service";
import { ArticleCard } from "./ArticleCard";
import { NewspaperCompilation } from "./NewspaperCompilation";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "edition", label: "By edition" },
  { id: "week", label: "Weekly compilation" },
  { id: "month", label: "Monthly compilation" },
] as const;

interface Edition {
  newspaper: string;
  editionDate: string;
  articles: SavedArticle[];
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function NewspaperNotes({ refreshKey }: { refreshKey: number }) {
  const [editions, setEditions] = useState<Edition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"edition" | "week" | "month">("edition");

  useEffect(() => {
    let alive = true;
    fetch("/api/newspaper/notes")
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json?.success) setEditions(json.data.editions);
        else setError(json?.error?.message ?? "Could not load Newspaper Notes.");
      })
      .catch(() => {
        if (alive) setError("Could not load Newspaper Notes.");
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <section className="space-y-3" id="np-notes">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Newspaper Notes</h2>
          <p className="text-xs text-muted-foreground">
            Saved articles. Their questions appear in Practice and they come up for Revision like your other notes.
          </p>
        </div>
        <div className="flex rounded-md border border-border p-0.5 text-xs" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              id={`np-view-${v.id}`}
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "rounded px-2.5 py-1",
                view === v.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {view !== "edition" && <NewspaperCompilation key={view} period={view} refreshKey={refreshKey} />}
      {view === "edition" && (
        <>
          {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
          {!editions && !error && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {editions && editions.length === 0 && (
            <p className="text-xs text-muted-foreground">No newspaper notes yet. Open an e-paper and summarise a page.</p>
          )}
          {editions?.map((e) => {
            const key = `${e.newspaper}|${e.editionDate}`;
            const isOpen = open === key;
            return (
              <div key={key} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted/50"
                  aria-expanded={isOpen}
                >
                  <span>
                    <span className="font-medium">{e.newspaper}</span>
                    <span className="text-muted-foreground">, {formatDate(e.editionDate)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.articles.length} article{e.articles.length === 1 ? "" : "s"}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-border p-4">
                    {e.articles.map((a) => (
                      <ArticleCard key={a.conceptId} article={a} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
